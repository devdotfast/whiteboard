//! A component using generated WIT bindings only: no diffr Rust SDK.
use http_body_util::BodyExt;
use serde::Deserialize;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant, SystemTime};

mod bindings {
    wit_bindgen::generate!({
        path: "../../../crates/diffr-plugin-sdk/wit",
        world: "diffr-plugin",
        additional_derives: [PartialEq, Eq],
    });
}
use bindings::diffr::plugin::host::Cursor;
use bindings::diffr::plugin::types::{FileSides, MoveError};
use bindings::diffr::plugin::types::{Side, Visit};
use bindings::exports::diffr::plugin::api::{Guest, GuestPlugin};

type Error = Box<dyn std::error::Error + Send + Sync>;

#[derive(Deserialize)]
struct Options {
    endpoint: String,
    /// When set, every file computes this long at its first node without
    /// awaiting, labels that node with when it did, and makes no request.
    #[serde(default)]
    spin_ms: u64,
}
struct Probe {
    options: Options,
    calls: AtomicU32,
}
impl Guest for Probe {
    type Plugin = Self;
}

impl GuestPlugin for Probe {
    fn new(options: String) -> Result<Self, String> {
        let options = serde_json::from_str(&options).map_err(|error| error.to_string())?;
        Ok(Self {
            options,
            calls: AtomicU32::new(0),
        })
    }
    async fn visit(&self, cursor: &Cursor, phase: Visit) -> Result<bool, String> {
        if phase == Visit::Post {
            unreachable!("Pre false must skip Post");
        }
        if self.options.spin_ms > 0 {
            let millis = || {
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_millis()
            };
            let start = millis();
            let started = Instant::now();
            while started.elapsed() < Duration::from_millis(self.options.spin_ms) {
                std::hint::spin_loop();
            }
            cursor
                .set_label(cursor.id(), Some(&format!("spun:{start}:{}", millis())))
                .map_err(|error| format!("{error:?}"))?;
            return Ok(false);
        }
        let result: Result<bool, Error> = async {
            let call = self.calls.fetch_add(1, Ordering::Relaxed) + 1;
            let id = cursor.id();
            let path = match cursor.file().file {
                FileSides::Both((_, rhs)) | FileSides::RightOnly(rhs) => rhs.path,
                FileSides::LeftOnly(lhs) => lhs.path,
            };
            let source = cursor.source(Side::Rhs).unwrap();
            cursor.set_label(id, Some(&format!("waiting for {path}")))?;
            let request = http::Request::get(format!("{}/{}", self.options.endpoint, path))
                .body(http_body_util::Empty::<bytes::Bytes>::new())?;
            let request = wasip3::http_compat::http_into_wasi_request(request)?;
            let response = wasip3::http::client::send(request).await?;
            let response = wasip3::http_compat::http_from_wasi_response(response)?;
            let body = response.into_body().collect().await?.to_bytes();
            let body = std::str::from_utf8(&body)?;
            assert_eq!(
                cursor.id(),
                id,
                "the host must preserve this callback's position across await"
            );
            assert_eq!(cursor.source(Side::Rhs).as_deref(), Some(source.as_str()));
            let node = cursor.get(id)?;
            assert_eq!(node.data.visibility.label, format!("waiting for {path}"));
            let body = match body {
                "fail" => return Err("probe failed after an edit".into()),
                "trap" => panic!("probe trapped after an edit"),
                "edit-error" => {
                    cursor.cut(0, 1)?;
                    unreachable!()
                }
                "recover" => {
                    assert_eq!(cursor.cut(0, 1).unwrap_err(), MoveError::NoRegion(0));
                    "A"
                }
                body => body,
            };
            cursor.set_label(id, Some(&format!("{body}:{call}:{id}")))?;
            Ok(false)
        }
        .await;
        result.map_err(|error| error.to_string())
    }
}

bindings::export!(Probe with_types_in bindings);
