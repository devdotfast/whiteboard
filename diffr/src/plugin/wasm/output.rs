//! Guest stdout and stderr, forwarded to diffr's stderr a line at a time
//! with the plugin's name in front, so stdout carries only the diff stream.
use bytes::Bytes;
use std::io::Write as _;
use std::sync::{Arc, Mutex};
use wasmtime_wasi::cli::{IsTerminal, StdoutStream};
use wasmtime_wasi::p2::{OutputStream, Pollable, StreamError, StreamResult};

/// One of a guest's output streams, stdout or stderr, and what it has
/// written since its last newline.
struct Pending {
    name: Arc<str>,
    line: Vec<u8>,
}

impl Pending {
    /// Write one line to diffr's stderr with the plugin's name in front.
    fn write_line(&self, line: &[u8]) -> std::io::Result<()> {
        let line = String::from_utf8_lossy(line);
        writeln!(std::io::stderr().lock(), "[{}] {line}", self.name)
    }
}

/// Whatever a guest wrote without ending the line still reaches diffr's
/// stderr, when the store the streams belong to is dropped.
impl Drop for Pending {
    fn drop(&mut self) {
        if !self.line.is_empty() {
            let line = std::mem::take(&mut self.line);
            let _ = self.write_line(&line);
        }
    }
}

/// A guest's stdout or stderr, written to diffr's stderr a line at a time,
/// each line prefixed with `[<plugin name>] `.
#[derive(Clone)]
pub(super) struct Prefixed(Arc<Mutex<Pending>>);

impl Prefixed {
    pub(super) fn new(name: Arc<str>) -> Self {
        Self(Arc::new(Mutex::new(Pending {
            name,
            line: Vec::new(),
        })))
    }
}

impl StdoutStream for Prefixed {
    fn p2_stream(&self) -> Box<dyn OutputStream> {
        Box::new(self.clone())
    }

    fn async_stream(&self) -> Box<dyn tokio::io::AsyncWrite + Send + Sync> {
        Box::new(self.clone())
    }
}

impl IsTerminal for Prefixed {
    fn is_terminal(&self) -> bool {
        false
    }
}

impl tokio::io::AsyncWrite for Prefixed {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        _cx: &mut std::task::Context<'_>,
        bytes: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        std::task::Poll::Ready(
            OutputStream::write(&mut *self, Bytes::copy_from_slice(bytes))
                .map(|()| bytes.len())
                .map_err(std::io::Error::other),
        )
    }

    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        _cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::task::Poll::Ready(OutputStream::flush(&mut *self).map_err(std::io::Error::other))
    }

    fn poll_shutdown(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        self.poll_flush(cx)
    }
}

#[wasmtime_wasi::async_trait]
impl Pollable for Prefixed {
    async fn ready(&mut self) {}
}

impl OutputStream for Prefixed {
    fn write(&mut self, bytes: Bytes) -> StreamResult<()> {
        let mut pending = self
            .0
            .lock()
            .expect("no write panics while it holds a guest's output");
        pending.line.extend_from_slice(&bytes);
        while let Some(end) = pending.line.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = pending.line.drain(..=end).take(end).collect();
            pending
                .write_line(&line)
                .map_err(|error| StreamError::LastOperationFailed(error.into()))?;
        }
        Ok(())
    }

    fn flush(&mut self) -> StreamResult<()> {
        std::io::stderr()
            .flush()
            .map_err(|error| StreamError::LastOperationFailed(error.into()))
    }

    fn check_write(&mut self) -> StreamResult<usize> {
        Ok(1024 * 1024)
    }
}
