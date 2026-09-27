<!-- PLACEHOLDER: launch materials and MCP directory submissions — owned by the outreach lead. -->

# Launch materials and directory listings — PLACEHOLDER

> **This page is intentionally empty.** It is owned by the outreach lead, not by the code.
> Nothing here is written, reviewed or approved yet. Do not copy anything from this file into
> the README, the Pages site or any submission until the outreach lead has filled it in.
>
> It is not linked from the site and is excluded from `sitemap.xml` and `robots.txt`.

## 1. Launch materials — *to be written by the outreach lead*

- [ ] Show HN title and body
- [ ] `awesome-mcp-servers` PR entry
- [ ] Reddit r/ClaudeAI post
- [ ] Reddit r/opensource post
- [ ] Anything else the outreach lead wants to add

## 2. MCP directory submissions — *to be checked and filed by the outreach lead*

| Directory | Submission requirements | Status | Listing URL |
|---|---|---|---|
| Official MCP Registry (`registry.modelcontextprotocol.io`) | *to verify* | not submitted | — |
| mcp.so | *to verify* | not submitted | — |
| Glama | *to verify* | not submitted | — |
| Smithery | *to verify* | not submitted | — |
| PulseMCP | *to verify* | not submitted | — |
| *(add others here)* | | | |

## 3. What the repository already provides

Facts and assets that exist today, so the outreach lead does not have to dig for them. This is the
only section maintained by the code side.

| Item | Where it lives |
|---|---|
| One-line description | `package.json` → `description` |
| Install command | `npx -y mindlm-mcp demo` |
| Three client configs | `examples/configs/` |
| Tool descriptions and schemas | `README.md` → Tools; `src/mcp/schemas.ts` |
| Registry metadata | `server.json` (`name` matches `package.json` → `mcpName`) |
| Pages site | <https://qingchejun.github.io/mindlm-io/> |
| Repository | <https://github.com/qingchejun/mindlm-io> |
| npm package | `mindlm-mcp` |
| License | MIT |
| Screenshots / demo GIF | `docs/assets/` — **demo.gif not recorded yet** |

## 4. Technical prerequisites

- The official MCP Registry requires the package to be published to npm **first**, and
  `server.json`'s `name` must equal `package.json`'s `mcpName` (`io.github.qingchejun/mindlm-mcp`).
- Verify `server.json` against the current registry schema before submitting; the `$schema` URL in
  that file is pinned to a dated revision and may have moved on.
- If a directory requires an extra file in the repository (a specific YAML or JSON manifest), list
  it here and the code side will add it.
