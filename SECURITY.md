# Security

## Reporting a vulnerability

Please report privately, not in a public issue:

1. Open a report under
   [Security → Advisories → Report a vulnerability](https://github.com/qingchejun/mindlm-io/security/advisories/new).
2. If private reporting is unavailable to you, open a normal issue that says only
   *"security report, please contact me"* — with no details — and wait to be contacted.

Include what you did, what happened, and the version (`mindlm-mcp --version`). A proof of concept
helps a great deal. Expect an acknowledgement within a week. Fixes go out as a patch release, and
you will be credited in the advisory unless you would rather not be.

Only the latest published version is supported.

## Threat model

`mindlm-mcp` is a local tool. It runs on your machine, under your user account, started either by
you or by your MCP client. Two things flow into it that you did not write: the content of the web
pages and PDFs you point it at, and the tool arguments your model chooses. Both are treated as
untrusted.

It has no server side. There is no account, no hosted API, no analytics and no update check. The
only outbound requests are the URL you asked for, and — only if *you* configured `ANTHROPIC_API_KEY`
or `OPENAI_API_KEY` — your own LLM endpoint.

## What the code does about it

### SSRF guard

`url_to_mindmap` (and `mindlm-mcp url`) resolves the hostname before fetching and refuses any
address in a private or infrastructure range:

- IPv4 — `0.0.0.0/8`, `10/8`, `100.64/10` (CGNAT), `127/8`, `169.254/16` (link-local, which is where
  the `169.254.169.254` cloud metadata endpoint lives), `172.16/12`, `192.0.0/24`, `192.168/16`,
  `198.18/15`, `224/4`, `240/4`
- IPv6 — `::/128`, `::1/128`, `64:ff9b::/96` (NAT64), `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8`
- IPv4-mapped and IPv4-compatible IPv6 addresses are judged as IPv4, so `::ffff:127.0.0.1` is
  blocked too. An IPv6 literal that will not parse is refused rather than guessed at.

Only `http:` and `https:` are accepted; `file:`, `gopher:`, `data:` and the rest are rejected before
any I/O. Redirects are followed at most 5 times and **each hop is re-checked**, so a public URL
cannot redirect into your network.

Set `MINDMAP_ALLOW_PRIVATE_HOSTS=true` to switch the guard off deliberately — for example to map a
page on `localhost`. Leave it off if a model can choose the URL.

### Known limitation: DNS rebinding

There is an unavoidable gap between resolving a hostname and connecting the socket. A hostile DNS
server can answer with a public address for our check and a private one microseconds later, when
Node's `fetch` resolves the name again for the actual connection. Closing this properly means
pinning the connection to the address we validated with a custom dispatcher.

We have not done that. For a local tool whose worst case is reading an intranet page you could read
anyway, the trade was not worth the complexity. The guard's real job is to stop prompt-injected
content from casually steering the fetcher at `169.254.169.254` or a router admin page. If you run
`mindlm-mcp` somewhere the distinction matters — a shared runner, a container with network access to
things you do not trust — treat `url_to_mindmap` as reaching anything the host can reach, and
restrict it at the network layer.

### Resource limits

| Limit | Value | Configurable |
|---|---|---|
| Fetched response body | 5 MB, enforced while streaming | no |
| Fetch timeout | 15 s for the whole request | no |
| Redirects | 5 | no |
| PDF size / pages | 50 MB, 300 pages | no |
| Characters read from any input | 200 000 | `MINDMAP_MAX_INPUT_CHARS` |
| Source text returned in `client` mode | 60 000 | `MINDMAP_CLIENT_MAX_CHARS` |

Content types are allow-listed: HTML, XHTML, plain text, Markdown and PDF. A declared
`Content-Length` over the cap is refused before the body is read.

### Exported HTML

- `markdown-it` runs with `html: false`, so raw HTML in an outline — which may have come from a web
  page or a PDF — is escaped, never rendered.
- Inlined JSON has `</script>` escaped so it cannot break out of its own tag.
- The KaTeX and highlight.js markmap plugins are disabled. They load CDN stylesheets, which would
  both break offline exports and add third-party origins to a file you open locally.
- Offline exports contain no `<script src="http…">` at all; CI asserts this on every build.

### Files and processes

- Files are only written where you point them: `outputPath` / `-o`, or `MINDMAP_OUTPUT_DIR`,
  defaulting to `./mindmaps`. Existing files are never overwritten unless `overwrite` is set.
- The only process ever spawned is the platform's own file opener (`open` / `xdg-open` / `start`),
  and only for `--open` / `demo`. The server never spawns it.
- `.env` files are read only when you pass `--env-file`. Nothing is loaded implicitly.

### Secrets

Your API key is read from the environment, sent only to the endpoint that key belongs to, and never
logged, echoed or written into an export. `mindlm-mcp doctor` reports *which* provider is configured
and never the key. CI runs gitleaks over the full history on every push.

### Supply chain

Published from GitHub Actions with npm Trusted Publishing (OIDC) and
[provenance](https://docs.npmjs.com/generating-provenance-statements) — there is no npm token in
this repository. Dependabot watches npm and Actions weekly. The published tarball contains `dist/`,
`README.md`, `LICENSE` and `package.json`, and CI fails if anything else appears in it.
