# Security policy

Do not commit credentials, API keys, production data exports, or customer manifests. Report security issues privately to the repository owner rather than opening a public issue.

Before production deployment, replace all sample secrets, enable TLS at the edge, use private service networking, restrict `MANIFEST_ALLOWED_HOSTS`, and keep Chromium/Node/Redis images patched.
