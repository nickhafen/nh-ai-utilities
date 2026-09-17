"""Local test server for the Batch Download script (see README.md here).

Serves fixed responses on http://127.0.0.1:8765 so hostile.csv can exercise
every success and failure path without touching real sites.
Run:  py tests/fixtures/test-server.py
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
ZIP = b"PK\x03\x04" + b"\x00" * 60
EXE = b"MZ\x90\x00" + b"\x00" * 60
HTML = b"<!DOCTYPE html>\n<html><head><title>Sign in</title></head><body>Please sign in</body></html>"
DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

ROUTES = {
    "/ok.pdf": (200, "application/pdf", PDF),
    "/ok.docx": (200, DOCX_TYPE, ZIP),
    "/login.pdf": (200, "text/html; charset=utf-8", HTML),
    "/forbidden.pdf": (403, "text/html", b"Forbidden"),
    "/busy.pdf": (503, "text/html", b"Busy"),
    "/empty.pdf": (200, "application/pdf", b""),
    "/auto-pdf": (200, "application/octet-stream", PDF),
    "/auto-docx": (200, DOCX_TYPE, ZIP),
    "/auto-exe": (200, "application/octet-stream", EXE),
    "/auto-html": (200, "text/html", HTML),
    "/auto-text": (200, "text/plain; charset=utf-8", b"plain text file\n"),
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        status, ctype, body = ROUTES.get(path, (404, "text/html", b"Not found"))
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print("Batch Download test server on http://127.0.0.1:8765 (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
