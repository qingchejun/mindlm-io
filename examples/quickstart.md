# mindlm-mcp

## What it does

### Turns text, web pages and PDFs into a mind map
### Outputs a Markdown outline plus a standalone HTML file
### Runs with no API key — a key is optional, not required

## Three ways to run it

### MCP server
- Add it to Claude Desktop, Claude Code or Cursor
- Four tools: text, url, pdf, export
- Your own client model refines the outline

### Command line
- `mindlm-mcp text notes.md -o notes.html`
- `mindlm-mcp url https://example.com/article`
- `mindlm-mcp pdf paper.pdf --pages 1-20`

### Library
- `import { textToOutline } from 'mindlm-mcp'`
- Blocks in, outline out, render when you want

## How the outline is made

### heuristic
- Rules only, no network, always available
- Headings become branches, key sentences become leaves

### client
- The default over MCP without a key
- Server hands over a draft plus the cleaned source
- The client model rewrites it and calls export_mindmap

### llm
- Used when ANTHROPIC_API_KEY or OPENAI_API_KEY is set
- Any OpenAI-compatible endpoint works too

## The exported file

### One HTML file, no network needed
### Pan, zoom, collapse and expand branches
### Open it, mail it, or commit it
