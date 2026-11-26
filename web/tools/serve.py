#!/usr/bin/env python3
"""Serves the web folder on localhost for development, with caching switched off, so the browser always loads the current code. The plain `python3 -m http.server` lets Chrome keep
imported modules for a while, and a change then seems not to have happened. It serves this folder only, never the repository root, because that holds the documents, the datasets and the keys. Inside this folder it refuses any
path with a part that starts with a dot (.env.local, .vercel, .git), because that is where the deploy keys are.
Usage: python3 web/tools/serve.py [port]      then open http://127.0.0.1:8765/
With --collect DIR it also accepts POST /collect, which saves the training frames the page sends (web/tools/collect_store.py), under DIR. Without the flag it accepts no writes at all."""
import functools
import http.server
import json
import pathlib
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import collect_store  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent  # the web folder


class Server(http.server.ThreadingHTTPServer):
    # The page asks for about forty modules at once. The default queue holds five waiting connections, and the rest were reset, so the scene sometimes failed to load.
    request_queue_size = 128


class NoStore(http.server.SimpleHTTPRequestHandler):
    def send_head(self):  # GET and HEAD both come through here
        parts = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path).split('/')
        if any(part.startswith('.') for part in parts if part):
            self.send_error(404)
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    collect_root = None  # set from --collect; None means no writes are accepted

    def do_POST(self):
        if self.path != '/collect' or self.collect_root is None:
            return self.reply(404, 'not found')
        # A page on another site must not be able to make this browser write files here: the type must be JSON (which a cross-site form cannot send), and an Origin, if there is one, must be this server.
        origin, port = self.headers.get('Origin'), self.server.server_address[1]
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json' or (origin is not None and origin not in (f'http://127.0.0.1:{port}', f'http://localhost:{port}')):
            return self.reply(403, 'forbidden')
        try:
            length = int(self.headers.get('Content-Length', ''))
        except ValueError:
            return self.reply(411, 'length required')
        if not 0 < length <= collect_store.MAX_BODY:
            return self.reply(413, 'too large')
        try:
            name = collect_store.save(self.collect_root, json.loads(self.rfile.read(length)))
        except (collect_store.BadFrame, json.JSONDecodeError, UnicodeDecodeError) as error:
            return self.reply(400, str(error))
        return self.reply(200, name)

    def reply(self, code, text):
        body = text.encode()
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--collect' in args:  # --collect DIR
        at = args.index('--collect'); NoStore.collect_root = pathlib.Path(args[at + 1]).resolve(); del args[at:at + 2]
    port = int(args[0]) if args else 8765
    handler = functools.partial(NoStore, directory=str(ROOT))
    print(f'Serving {ROOT} at http://127.0.0.1:{port}/ (Ctrl+C to stop)')
    Server(('127.0.0.1', port), handler).serve_forever()
