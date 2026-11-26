# Security

How the page and the code are protected. To report a problem, see [SECURITY.md](../SECURITY.md).

This is a model of a traffic junction, not for running a real signal. The page is static, with no accounts, no database and no server code.

## What reaches the page, and what leaves it

- **In.** Only `?flat` (a yes or no) and `?seed=N` (a whole number, ignored otherwise). The weather reply is checked: a whole number from 0 to 99, folded into one of five names. Text from the weather service is never shown.
- **Out.** The weather request carries the coordinates of a city chosen from the time zone, never the visitor's own position, and no cookie. jsDelivr and Open-Meteo see the visitor's address, as any server does. Vercel's Web Analytics and Speed Insights record the page, the browser, the country and the timings. The detector's pictures never leave the browser.
- **Never used.** `innerHTML`, `eval`, `new Function`, `document.write`, `postMessage` and `javascript:` addresses. Elements are made with `textContent`. `Math.random` is used for look and sound only.
- **Permissions.** The camera, microphone, location, payment and USB are switched off.

## The page's policy

`index.html` sets `default-src 'none'`. Scripts come only from the page, the one inline import map (by its hash) and the CDN. Connections go only to the page and the weather service. No inline or `eval` code is allowed, apart from `'wasm-unsafe-eval'`, which lets WebAssembly compile for the detector. `web/test/index.test.js` fails if the policy loosens or a Three.js file is not pinned.

`web/vercel.json` adds `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `frame-ancestors 'none'`, a Permissions-Policy and `Cross-Origin-Opener-Policy`. The build copies only what the page needs, so documents, tests and tools are never served. `web/test/hosting.test.js` checks this.

## What the page loads from outside

- **Three.js 0.160.0** from jsDelivr, pinned by version and SHA-384 hash. A wrong hash blocks the file, and the page falls back to the 2D view.
- **ONNX Runtime Web 1.20.1** from jsDelivr, pinned by version, only when the detector is on. A hash cannot be set on an import made inside a worker.
- **The detector model** from this site. It holds weights and a graph, and no code. A bad model file cannot reach the page, the network or storage, and a corrupt one just fails to start.

## The development tools

- **The dev server** (`web/tools/serve.py`) listens on 127.0.0.1 and serves only `web/`. It refuses any path with a part that starts with a dot, in plain, encoded and `..` forms. It accepts no writes without `--collect`. `tests/test_serve.py` checks this.
- **The collection route** (`POST /collect`, only with `--collect`) saves training pictures. It accepts only JSON from this server's own origin, caps the body at 4 MB, and validates every field. A bad request writes nothing. `tests/test_collect_store.py` has 39 tests.
- **Python and firmware** use no network, no shell and no dependencies. The serial line is bounded at 24 characters, checksummed, and rejects unknown signal states.

## Secrets

The code reads no secret, so there is no `.env.example`. A search of every tracked file and commit found no keys, passwords, tokens or connection strings.
