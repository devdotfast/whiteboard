//! Async HTTP and retry delays through WASI.
use anyhow::anyhow;
use http_body_util::BodyExt;
use std::time::Duration;
use wasip3::http::types::{ErrorCode, Fields, Method, Request, RequestOptions, Scheme};
use wasip3::http_compat::{http_from_wasi_response, BodyWriter};

pub async fn post(
    url: &str,
    headers: &[(&'static str, String)],
    body: &str,
    timeout_ms: u64,
) -> anyhow::Result<(u16, Vec<u8>)> {
    let uri: ::http::Uri = url.parse()?;
    let scheme = match uri.scheme_str() {
        Some("https") => Scheme::Https,
        Some("http") => Scheme::Http,
        _ => anyhow::bail!("endpoint must use http or https"),
    };
    let options = RequestOptions::new();
    let timeout = Some(timeout_ms.saturating_mul(1_000_000));
    options
        .set_connect_timeout(timeout)
        .map_err(|_| anyhow!("connect timeout"))?;
    options
        .set_first_byte_timeout(timeout)
        .map_err(|_| anyhow!("response timeout"))?;
    options
        .set_between_bytes_timeout(timeout)
        .map_err(|_| anyhow!("read timeout"))?;
    let mut fields = vec![
        ("content-type".to_owned(), b"application/json".to_vec()),
        (
            "content-length".to_owned(),
            body.len().to_string().into_bytes(),
        ),
    ];
    fields.extend(
        headers
            .iter()
            .map(|(name, value)| ((*name).to_owned(), value.as_bytes().to_vec())),
    );
    let fields = Fields::from_list(&fields).map_err(|e| anyhow!("HTTP headers: {e:?}"))?;
    let (writer, contents, trailers) = BodyWriter::new();
    // The transmission future is held until the response body is read:
    // wasmtime-wasi-http 49.0.2 ends the connection as soon as the guest
    // drops it, which cuts a response body short.
    let (request, transmitted) = Request::new(fields, Some(contents), trailers, Some(options));
    request
        .set_method(&Method::Post)
        .map_err(|()| anyhow!("HTTP method"))?;
    request
        .set_scheme(Some(&scheme))
        .map_err(|()| anyhow!("invalid endpoint URL"))?;
    request
        .set_authority(uri.authority().map(|authority| authority.as_str()))
        .map_err(|()| anyhow!("invalid endpoint URL"))?;
    request
        .set_path_with_query(uri.path_and_query().map(|path| path.as_str()))
        .map_err(|()| anyhow!("invalid endpoint URL"))?;
    let mut contents = http_body_util::Full::new(bytes::Bytes::copy_from_slice(body.as_bytes()));
    wasip3::spawn_local(async move {
        _ = writer.send_http_body(&mut contents).await;
    });
    let response = wasip3::http::client::send(request)
        .await
        .map_err(|e| anyhow!("HTTP response: {e:?}"))?;
    let response =
        http_from_wasi_response(response).map_err(|e| anyhow!("HTTP response: {e:?}"))?;
    let status = response.status().as_u16();
    let body = response
        .into_body()
        .collect()
        .await
        .map_err(|e| anyhow!("HTTP body: {e:?}"))?;
    transmitted
        .await
        .map_err(|e: ErrorCode| anyhow!("HTTP request: {e:?}"))?;
    Ok((status, body.to_bytes().to_vec()))
}

pub async fn sleep(duration: Duration) {
    wasip3::clocks::monotonic_clock::wait_for(duration.as_nanos().min(u64::MAX as u128) as u64)
        .await;
}
