#!/usr/bin/env python3
"""Static dev server for the CatCop build.

Plain http.server lets the browser cache ES modules, which makes iterating on
src/*.js maddening. This serves the same tree with caching disabled.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "404" in (fmt % args):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5310
    root = sys.argv[2] if len(sys.argv) > 2 else "game"
    handler = partial(NoCacheHandler, directory=root)
    print(f"catcop dev server on http://localhost:{port} (root={root})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
