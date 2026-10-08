"""A local stand-in for Gemini's generateContent: canned pseudocode, no model."""

import json
import sys
import re
from http.server import BaseHTTPRequestHandler, HTTPServer

FOLD = re.compile(r"^- fold (\d+): lines (\d+)-(\d+)", re.M)
LINE = re.compile(r"^\s*(\d+) \| (.*)$", re.M)


def pseudocode(prompt):
    match = FOLD.search(prompt)
    fold, first, last = (int(group) for group in match.groups())
    lines = {int(n): text for n, text in LINE.findall(prompt)}
    body = [lines[n].strip() for n in range(first, last + 1) if n in lines]
    body = [line for line in body if line and line not in ("{", "}", "};", "})", "});")]
    picked = body[:: max(1, len(body) // 4)][:4]
    return fold, "\n".join(f"[mock] {line[:60]}" for line in picked)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        prompt = request["contents"][0]["parts"][0]["text"]
        fold, text = pseudocode(prompt)
        answer = json.dumps({"summaries": [{"id": fold, "summary": "", "pseudocode": text}]})
        body = json.dumps({"candidates": [{"content": {"parts": [{"text": answer}]}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
