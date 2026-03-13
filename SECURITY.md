# Security Policy

## Content Security Policy

All public HTML pages in this project set a `Content-Security-Policy` meta tag.
The policy is intentionally strict and follows these principles:

### `script-src` — no bare `'self'`

Allowing `script-src 'self'` permits any script file served from the same origin
to execute, including any accidentally committed debug script or a compromised
static asset.  Instead, each page uses the minimum required permission:

| Page | Approach | Rationale |
|------|----------|-----------|
| `index.html` | `'none'` | No script is loaded |
| `demos.html` | `'none'` | No script is loaded |
| `gallery.html` | `'none'` | No script is loaded |
| `demo.html` | SHA-256 hash + `'strict-dynamic'` | Restricts execution to the single known inline bootstrap import |

#### Hash-based policy for `demo.html`

`demo.html` boots the application with a single inline module:

```html
<script type="module">import '/src/main.ts'</script>
```

The SHA-256 hash of that exact inline content (`import '/src/main.ts'`) is
pre-computed and embedded in the `script-src` directive:

```
script-src 'sha256-NDWEjzGVmgdl6gIijt3W2YpACKUzjdbNjuRCLQIRDKo=' 'strict-dynamic'
```

`'strict-dynamic'` propagates the trust granted by the hash to any modules
dynamically imported by that script (i.e. the rest of the application bundle).
Older browsers that do not understand `'strict-dynamic'` ignore it and fall back
to the hash alone.

#### Recomputing the hash

If the inline bootstrap script ever changes, recompute the hash with:

```bash
printf "import '/src/main.ts'" | openssl dgst -sha256 -binary | base64
```

Replace the `sha256-…` value in `demo.html` with the new output.

### Other directives

| Directive | Value | Reason |
|-----------|-------|--------|
| `object-src` | `'none'` | Disables Flash and other plug-in content |
| `base-uri` | `'self'` | Prevents base-tag hijacking |
| `default-src` | `'self'` | Safe fallback for unlisted resource types |
| `connect-src` | `'self' ws://localhost:* …` | Permits Vite HMR WebSocket in development |
| `unsafe-eval` | absent | Disallows `eval()` and similar constructs |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please open a GitHub
issue with the label **security**.  For sensitive reports you may contact the
maintainers directly via the repository's GitHub profile.
