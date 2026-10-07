use super::*;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;

const FUNCTION: &str = "summarize:function";

/// Project with the summarizer's queries, which run only when it is on.
fn project(path: &str, before: &str, after: &str) -> (FileChange, Pairing<protocol::Source>) {
    project_with(path, before, after, DiffOptions::default())
}

fn project_with(
    path: &str,
    before: &str,
    after: &str,
    options: DiffOptions,
) -> (FileChange, Pairing<protocol::Source>) {
    let params =
        Config::from_toml("[plugins.shape.bundled.summarize]\nenabled = true\napi_key = 'test'\n")
            .unwrap()
            .compile()
            .unwrap();
    project_compiled(path, before, after, &params, options)
}

const LARGE: &str = "def f():\n    a()\n    b()\n    c()\n\ndef g(): d()\n";

/// One request the test server received.
struct Received {
    line: String,
    headers: Vec<String>,
    body: String,
}

/// Answer each request with the next canned response.
fn serve_requests(
    responses: Vec<(u16, String)>,
) -> (String, std::thread::JoinHandle<Vec<Received>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let handle = std::thread::spawn(move || {
        let mut received = Vec::new();
        for (status, body) in responses {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let mut headers = Vec::new();
            let mut length = 0;
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).unwrap();
                if header == "\r\n" {
                    break;
                }
                let header = header.trim_end().to_ascii_lowercase();
                if let Some(value) = header.strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                headers.push(header);
            }
            let mut request = vec![0; length];
            reader.read_exact(&mut request).unwrap();
            received.push(Received {
                line: line.trim_end().to_owned(),
                headers,
                body: String::from_utf8(request).unwrap(),
            });
            let reason = if status == 200 { "OK" } else { "Error" };
            let response = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            reader.get_mut().write_all(response.as_bytes()).unwrap();
        }
        received
    });
    (endpoint, handle)
}

/// Answer each request with the next canned response; the request bodies.
fn serve(responses: Vec<(u16, String)>) -> (String, std::thread::JoinHandle<Vec<String>>) {
    let (endpoint, handle) = serve_requests(responses);
    let bodies = std::thread::spawn(move || {
        handle
            .join()
            .unwrap()
            .into_iter()
            .map(|request| request.body)
            .collect()
    });
    (endpoint, bodies)
}

/// The label of the only function body on the after side. The scope fold
/// the context queries wrap around it is not one.
fn fold_label(sides: &Pairing<Source>) -> String {
    let mut labels = Vec::new();
    walk(std::slice::from_ref(&rhs(sides).root), &mut |region| {
        if is_fold(region) && has_tag(region, FUNCTION) {
            labels.push(region.visibility.label.clone());
        }
    });
    assert_eq!(labels.len(), 1, "{labels:?}");
    labels.remove(0)
}

fn gemini_answer(text: &str) -> String {
    json!({"candidates": [{"content": {"parts": [{"text": text}]}}]}).to_string()
}

fn summarizer(endpoint: &str, retries: u32) -> Pipeline {
    summarizer_with(json!({
        "api_key": "test-key",
        "endpoint": endpoint,
        "retries": retries,
        "request_timeout_ms": 5000,
        "min_lines": 3,
    }))
}

/// A summarizer with the bundled defaults and `overrides`.
fn summarizer_with(overrides: serde_json::Value) -> Pipeline {
    bundled("summarize", overrides)
}

/// The first numbered line of each body the summarizer sends.
fn select(sides: &Pairing<Source>, min_lines: usize, test_min_lines: Option<usize>) -> Vec<u32> {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let mut selected = Vec::new();
        loop {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(10)))
                .unwrap();
            let mut reader = BufReader::new(&mut socket);
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap() == 0 {
                return selected;
            }
            let mut length = 0;
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
            let prompt = body["contents"][0]["parts"][0]["text"].as_str().unwrap();
            let first = prompt
                .lines()
                .find_map(|line| line.split_once(" | ")?.0.trim().parse::<u32>().ok())
                .unwrap();
            selected.push(first);
            let response = gemini_answer("");
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
        }
    });
    let mut options = builtin::manifest("summarize").unwrap().defaults();
    options.extend(json!({"api_key":"test", "endpoint":format!("http://{address}"), "min_lines":min_lines,
        "tests":test_min_lines.is_some(), "test_min_lines":test_min_lines.unwrap_or(3), "retries":0}).as_object().unwrap().clone());
    let pipeline = bundled("summarize", serde_json::Value::Object(options));
    let file = crate::git::FileChange::standalone("selection", "selection");
    let result = shape(&pipeline, &file.manifest_entry(), &mut sides.clone());
    // Tell the server this traversal has emitted all of its node requests.
    drop(std::net::TcpStream::connect(address));
    let selected = server.join().unwrap();
    result.unwrap();
    selected
}

#[test]
fn selection_takes_new_bodies_of_at_least_min_lines() {
    let (_, sides) = project("a.py", "", LARGE);
    assert_eq!(select(&sides, 3, None), [2]);
    let (_, sides) = project("a.py", LARGE, LARGE);
    assert!(select(&sides, 3, None).is_empty());
}

#[test]
fn long_summaries_are_discarded_without_changing_initial_folding() {
    let (file, mut sides) = project("a.py", "", LARGE);
    let (endpoint, server) = serve(vec![(200, gemini_answer("a()\nb()\nc()"))]);
    shape(&summarizer(&endpoint, 0), &file, &mut sides).unwrap();
    server.join().unwrap();
    let mut folds = Vec::new();
    walk(rhs(&sides).root.children(), &mut |region| {
        if is_fold(region) && has_tag(region, FUNCTION) {
            folds.push((region.visibility.collapsed, region.visibility.label.clone()));
        }
    });
    // A discarded summary leaves the original open body unchanged.
    assert_eq!(folds, vec![(false, String::new())]);
}

#[test]
fn summaries_collapse_selected_folds_behind_pseudocode() {
    let (file, mut sides) = project("a.py", "", LARGE);
    let (endpoint, server) = serve(vec![(200, gemini_answer("a b c"))]);
    shape(&summarizer(&endpoint, 0), &file, &mut sides).unwrap();
    let bodies = server.join().unwrap();
    assert!(bodies[0].contains("thinkingBudget"));
    assert!(bodies[0].contains("    2 | "));
    // `g` is a one-line function, whose body is not a region.
    assert_eq!(fold_label(&sides), "a b c");
    let mut collapsed = Vec::new();
    walk(rhs(&sides).root.children(), &mut |region| {
        if is_fold(region) && has_tag(region, FUNCTION) {
            collapsed.push(region.visibility.collapsed);
        }
    });
    assert_eq!(collapsed, [true]);
}

#[test]
fn a_docstring_heads_the_pseudocode_with_its_first_line() {
    let after = "/// Sums three numbers.\n/// Used by tests.\nfn total(a: u32, b: u32, c: u32) -> u32 {\n    let x = a;\n    let y = b;\n    let z = c;\n    x + y + z\n}\n";
    let (file, mut sides) = project("a.rs", "", after);
    let (endpoint, server) = serve(vec![(200, gemini_answer("return a + b + c"))]);
    shape(&summarizer(&endpoint, 0), &file, &mut sides).unwrap();
    server.join().unwrap();
    let (mut body, mut docstring) = (None, None);
    walk(rhs(&sides).root.children(), &mut |region| {
        if is_fold(region) && has_tag(region, FUNCTION) {
            body = Some((region.fold_state_id, region.visibility.label.clone()));
        }
        if has_tag(region, "summarize:docstring") {
            docstring = Some(region.fold_state_id);
        }
    });
    let (state, label) = body.unwrap();
    assert_eq!(label, "/// Sums three numbers.\nreturn a + b + c");
    // The docstring folds with the body.
    assert_eq!(docstring, Some(state));
}

#[test]
fn hard_failures_and_exhausted_retries_are_run_failures() {
    let (file, sides) = project("a.py", "", LARGE);
    let (endpoint, server) = serve(vec![(400, "{\"error\": \"bad key\"}".to_owned())]);
    let error = shape(&summarizer(&endpoint, 3), &file, &mut sides.clone()).unwrap_err();
    server.join().unwrap();
    assert!(error.downcast_ref::<MutationFailed>().is_some());
    assert!(format!("{error:#}").starts_with("mutation summarize: summarizer: "));
    assert!(format!("{error:#}").contains("HTTP 400"), "{error:#}");
    let (endpoint, server) = serve(vec![(500, "{}".to_owned()), (500, "{}".to_owned())]);
    let error = shape(&summarizer(&endpoint, 1), &file, &mut sides.clone()).unwrap_err();
    server.join().unwrap();
    assert!(
        format!("{error:#}").contains("after 2 attempts"),
        "{error:#}"
    );
}

#[test]
fn tests_are_selected_only_when_added_even_if_already_collapsed() {
    for (path, before, after) in [
        (
            "a.py",
            "def test_it():\n    setup()\n    act()\n    check()\n",
            "def test_it():\n    setup()\n    act()\n    check_new()\n",
        ),
        (
            "a.rs",
            "#[test]\nfn it_works() {\n    setup();\n    act();\n    check();\n}\n",
            "#[test]\nfn it_works() {\n    setup();\n    act();\n    check_new();\n}\n",
        ),
        (
            "a.go",
            "package a\nfunc TestIt(t *testing.T) {\n    setup()\n    act()\n    check()\n}\n",
            "package a\nfunc TestIt(t *testing.T) {\n    setup()\n    act()\n    checkNew()\n}\n",
        ),
        (
            "a.ts",
            "test('it', () => {\n    setup();\n    act();\n    check();\n});\n",
            "test('it', () => {\n    setup();\n    act();\n    checkNew();\n});\n",
        ),
    ] {
        for old in ["", before, after] {
            // Entirely identical files bypass parsing. Keep a change outside
            // the test to exercise an unchanged body in a diffed file.
            let comment = if path.ends_with(".py") { "#" } else { "//" };
            let after = format!("{after}\n{comment} changed elsewhere\n");
            let (file, mut sides) = project(path, old, &after);
            let added = usize::from(old.is_empty());
            assert_eq!(select(&sides, 3, Some(3)).len(), added, "{path}: {old}");
            assert!(select(&sides, 3, None).is_empty());
            assert!(select(&sides, 3, Some(30)).is_empty());
            run("test-bodies", json!({"min_lines": 3}), &file, &mut sides);
            assert_eq!(select(&sides, 3, Some(3)).len(), added);
        }
    }
}

#[test]
fn each_provider_sends_its_own_request_and_reads_its_own_answer() {
    for (provider, path, response, auth) in [
        (
            "openai",
            "/v1",
            json!({"choices": [{"message": {"role": "assistant", "content": "a b c"}}]}),
            "authorization: bearer test-key",
        ),
        (
            "anthropic",
            "",
            json!({"content": [{"type": "thinking", "thinking": "hmm"}, {"type": "text", "text": "a b c"}]}),
            "x-api-key: test-key",
        ),
    ] {
        let (file, mut sides) = project("a.py", "", LARGE);
        let (endpoint, server) = serve_requests(vec![(200, response.to_string())]);
        let pipeline = summarizer_with(json!({
            "provider": provider,
            "model": "test-model",
            "api_key": "test-key",
            "endpoint": format!("{endpoint}{path}"),
            "min_lines": 3,
            "retries": 0,
        }));
        shape(&pipeline, &file, &mut sides).unwrap();
        assert_eq!(fold_label(&sides), "a b c", "{provider}");
        let request = server.join().unwrap().remove(0);
        let body: serde_json::Value = serde_json::from_str(&request.body).unwrap();
        assert!(
            request.headers.contains(&auth.to_owned()),
            "{provider}: {:?}",
            request.headers
        );
        assert_eq!(body["model"], "test-model");
        match provider {
            "openai" => {
                assert_eq!(request.line, "POST /v1/chat/completions HTTP/1.1");
                assert_eq!(body["messages"][0]["role"], "system");
                assert!(body["messages"][1]["content"]
                    .as_str()
                    .unwrap()
                    .contains("    2 | "));
                assert!(body.get("temperature").is_none());
            }
            _ => {
                assert_eq!(request.line, "POST /v1/messages HTTP/1.1");
                assert!(request
                    .headers
                    .contains(&"anthropic-version: 2023-06-01".to_owned()));
                assert_eq!(body["max_tokens"], 4096);
                assert!(body.get("temperature").is_none());
                assert_eq!(
                    body["system"],
                    builtin::manifest("summarize").unwrap().defaults()["system_prompt"]
                );
            }
        }
    }
}
