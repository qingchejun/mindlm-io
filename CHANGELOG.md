# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — unreleased

First release. Nothing has been published to npm yet; this entry describes what 0.1.0 will contain.

### Added

- **MCP server** over stdio with four tools — `text_to_mindmap`, `url_to_mindmap`,
  `pdf_to_mindmap` and `export_mindmap` — plus a `mindmap_outline` prompt. Every result carries
  both readable text and `structuredContent`.
- **Zero-key operation.** Without an API key the server returns a rule-based draft, the cleaned
  source text and instructions, and the client's own model writes the final outline (`client`
  mode). The CLI falls back to the deterministic heuristic instead.
- **Optional LLM mode.** Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (with `OPENAI_BASE_URL` and
  `MINDMAP_LLM_MODEL` for any OpenAI-compatible endpoint) and the server calls that model itself,
  over plain `fetch`, falling back to the heuristic if the call fails.
- **CLI** `mindlm-mcp` with `serve`, `demo`, `text`, `url`, `pdf`, `export` and `doctor`. It starts
  the MCP server when no terminal is attached.
- **Extraction** for plain text and Markdown, http(s) pages (charset detection, Readability
  article extraction, PDF handoff) and local PDFs (page text plus bookmarks, page ranges).
- **Offline HTML export.** markmap output as a single file with d3, markmap-view and the toolbar
  inlined; no remote assets. KaTeX and highlight.js are disabled because they load from a CDN, and
  `markdown-it` runs with `html: false`.
- **SSRF guard** blocking loopback, private, link-local, CGNAT, NAT64 and multicast addresses,
  re-checked on every redirect, with size, timeout, redirect and content-type limits. Opt out with
  `MINDMAP_ALLOW_PRIVATE_HOSTS=true`.
- **Programmatic API**: `textToOutline`, `urlToOutline`, `pdfToOutline`, `outlineFromDocument`,
  `renderMindmapHtml`, `exportMindmap` and the types behind them.
- Documentation, a GitHub Pages site with a live embedded demo, and CI covering lint, types, tests,
  build, package contents, the offline-export smoke test, the outbound-link rules and gitleaks.

### Notes

- Exported HTML carries no attribution by default. `--branding` / `branding: true` adds one small
  footer line.
- No telemetry, no update check, no hosted backend.

[unreleased]: https://github.com/qingchejun/mindlm-io/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/qingchejun/mindlm-io/releases/tag/v0.1.0
