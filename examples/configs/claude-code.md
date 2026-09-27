# Client configuration

Every client runs the same command: `npx -y mindlm-mcp serve`. No API key is needed —
without one the server hands your own model a draft outline and the cleaned source text,
and your model writes the final outline.

## Claude Code

```bash
claude mcp add mindlm -- npx -y mindlm-mcp serve
```

Scope it to a project instead of your user account with `--scope project`, and pass
environment variables with `-e`:

```bash
claude mcp add mindlm -e MINDMAP_OUTPUT_DIR=~/Documents/mindmaps -- npx -y mindlm-mcp serve
```

Check it is connected with `claude mcp list`, or `/mcp` inside a session.

## Claude Desktop

Copy [`claude-desktop.json`](./claude-desktop.json) into your config file and restart the app:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

## Cursor

Copy [`cursor.json`](./cursor.json) into `~/.cursor/mcp.json` (global) or `.cursor/mcp.json`
(one project). It is the same file with the optional LLM variables filled in — delete the
`ANTHROPIC_API_KEY` and `MINDMAP_LLM_MODEL` lines unless you want the server to call a model
itself, and never commit a real key.

## Optional environment variables

| Variable | Meaning |
|---|---|
| `MINDMAP_OUTPUT_DIR` | Where exported HTML files go. Defaults to `./mindmaps`. |
| `ANTHROPIC_API_KEY` | Switches `mode: "auto"` from `client` to `llm`. |
| `OPENAI_API_KEY` | Same, for any OpenAI-compatible endpoint. |
| `OPENAI_BASE_URL` | The endpoint to use with `OPENAI_API_KEY`. |
| `MINDMAP_LLM_MODEL` | Model name. Optional for Anthropic (defaults to `claude-sonnet-5`), required for OpenAI-compatible endpoints. |
| `MINDMAP_ALLOW_PRIVATE_HOSTS` | Set to `true` to let `url_to_mindmap` reach localhost and private networks. Off by default. |
| `MINDMAP_MAX_INPUT_CHARS` | Cap on characters read from any one input. Default 200000. |
| `MINDMAP_CLIENT_MAX_CHARS` | Cap on the source text returned in `client` mode. Default 60000. |

## Trying it without a client

```bash
npx -y mindlm-mcp demo          # render and open a built-in example
npx -y mindlm-mcp doctor        # what is configured, and where files will be written
```
