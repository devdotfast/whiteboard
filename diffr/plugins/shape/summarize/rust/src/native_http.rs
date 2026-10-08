//! HTTP and retry delays through a host that links the plugin in: the
//! SDK's native `http`, which answers each call before it returns.
use std::time::Duration;

pub async fn post(
    url: &str,
    headers: &[(&'static str, String)],
    body: &str,
    timeout_ms: u64,
) -> anyhow::Result<(u16, Vec<u8>)> {
    diffr_plugin_sdk::native::http::post(url, headers, body, timeout_ms).map_err(anyhow::Error::msg)
}

pub async fn sleep(duration: Duration) {
    diffr_plugin_sdk::native::http::sleep(duration);
}
