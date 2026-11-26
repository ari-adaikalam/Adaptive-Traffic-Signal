"""The development server must queue a burst of connections: the page opens about forty at once, and a queue of five reset the rest (the scene then failed to load)."""
import importlib.util
from pathlib import Path

SERVE = Path(__file__).resolve().parents[1] / "web" / "tools" / "serve.py"


def test_server_queues_a_burst_of_connections() -> None:
    spec = importlib.util.spec_from_file_location("serve", SERVE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.Server.request_queue_size >= 64


def _load():
    spec = importlib.util.spec_from_file_location("serve", SERVE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_server_refuses_dotfiles_and_still_serves_the_page(tmp_path: Path) -> None:
    """web/ holds .env.local and .vercel, which hold deploy keys, and the dev server must never hand them out."""
    import functools
    import http.client
    import threading

    module = _load()
    (tmp_path / ".env.local").write_text("VERCEL_OIDC_TOKEN=secret")
    (tmp_path / ".vercel").mkdir()
    (tmp_path / ".vercel" / "project.json").write_text("{}")
    (tmp_path / "index.html").write_text("<p>page</p>")
    server = module.Server(("127.0.0.1", 0), functools.partial(module.NoStore, directory=str(tmp_path)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        port = server.server_address[1]

        def ask(method: str, path: str) -> tuple[int, bytes]:
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            connection.request(method, path)
            reply = connection.getresponse()
            body = reply.read()
            connection.close()
            return reply.status, body

        assert ask("GET", "/index.html")[0] == 200
        for path in ("/.env.local", "/%2eenv.local", "/.vercel/project.json", "/.vercel/", "/a/../.env.local", "/.git/config"):
            status, body = ask("GET", path)
            assert status == 404, path
            assert b"secret" not in body, path
        assert ask("HEAD", "/.env.local")[0] == 404
    finally:
        server.shutdown()
        server.server_close()
