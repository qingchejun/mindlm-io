# Contributing

Issues and pull requests are welcome. Small and focused beats large and thorough.

## Getting set up

Node ≥ 22.12.

```bash
npm ci
npm run lint         # biome
npm run typecheck    # tsc --noEmit
npm test             # vitest; builds dist/ first, so the e2e tests are real
npm run build        # tsdown → dist/
```

`npm run format` rewrites files with biome. Run the four checks above before opening a PR — CI runs
exactly the same ones on Node 22 and 24.

To work on the docs site:

```bash
npm run build && npm run demo:gen   # renders examples/*.md into docs/demo/
npm run check:links                 # the outbound-link rules the Pages deploy enforces
```

Then open `docs/index.html`. `docs/demo/` is generated and gitignored.

## Scope

The tool does one thing: text, a URL or a PDF goes in; a Markdown outline and one standalone HTML
mind map come out. Things that keep it that way are easy to accept. Things that add a hosted
service, an account, telemetry, or a required API key are not — zero-key operation is the point.

## House rules

- **No secrets, ever.** No keys, tokens, internal hostnames or personal paths, not even in a
  comment or a test fixture. Use `<your-key>` placeholders. `.env.example` values stay empty.
- **`src/` mentions no website and no backend.** CI greps for it. The single exception is
  `src/render/branding.ts`, which holds the opt-in footer link and nothing else.
- **No telemetry and no update check.**
- Tests go with the change: a unit test for logic, and an e2e test if it crosses the CLI or the MCP
  boundary. Network-dependent tests use the local server in `test/helpers/http-server.ts`.
- Fixtures under `test/fixtures/` are small and synthetic — never a copy of a real page or document.
  The PDFs are generated: `node scripts/make-fixture-pdf.mjs` rewrites `sample.pdf` (bookmarks,
  numbered headings) and `wrapped.pdf` (a print-to-PDF with soft-wrapped paragraphs).
- Keep comments about *why*, not *what*. Match the style already in the file.
- Conventional commit subjects (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) — the changelog is
  written from them.

## Reporting a vulnerability

Privately, please — see [SECURITY.md](SECURITY.md).

## License

Contributions are accepted under the [MIT license](LICENSE).
