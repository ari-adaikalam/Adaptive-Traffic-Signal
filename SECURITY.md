# Security policy

## Reporting a problem

Please do not open a public issue for a security problem. Use the Security tab of this repository (Report a vulnerability), or email ariadaikalam1234@gmail.com. Say what you found, where, and how to see it.

Ari Adaikalam maintains this repository and replies when possible.

## Scope

This is a model of a traffic junction. It is not for running a real traffic signal.

- **The page** at <https://adaptive-traffic-signal.ariadaikalam.com>. It is static, with no accounts, no cookies and no server code.
- **The code in this repository**, including the development server in `web/tools/serve.py`.
- **What the page loads from outside:** Three.js, ONNX Runtime Web and the weather request.

What was checked is in [docs/security.md](docs/security.md).
