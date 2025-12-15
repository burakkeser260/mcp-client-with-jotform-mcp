# Jotform MCP Client

Connects to Jotform MCP and dumps available tools to JSON.

## Run

```bash
node index.js [--chatgpt|--chatgpt-app|--default]
```

### Endpoints

| Flag | URL | Output File |
|------|-----|-------------|
| `--chatgpt` (default) | `https://mcp.jotform.com/chatgpt` | `output-chatgpt.json` |
| `--chatgpt-app` | `https://mcp.jotform.com/chatgpt-app` | `output-chatgpt-app.json` |
| `--default` | `https://mcp.jotform.com` | `output-default.json` |

First run opens browser for OAuth. After that, just runs and exits.

## Example

```bash
# Use chatgpt endpoint (default)
node index.js
# → output-chatgpt.json

# Use chatgpt-app endpoint
node index.js --chatgpt-app
# → output-chatgpt-app.json

# Use default endpoint
node index.js --default
# → output-default.json
```

## Example Output

```
[2025-01-01T00:00:00.000Z] Starting Jotform MCP Client...
[2025-01-01T00:00:00.000Z] Endpoint: chatgpt
[2025-01-01T00:00:00.000Z] MCP URL: https://mcp.jotform.com/chatgpt
[2025-01-01T00:00:00.000Z] Connecting to Jotform MCP...
Session: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
Connected! 5 tools available
[2025-01-01T00:00:00.000Z] Connected! Session: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
[2025-01-01T00:00:00.000Z] Found 5 tools
[2025-01-01T00:00:00.000Z] Output saved to output-chatgpt.json
```

## Output JSON

```json
{
  "timestamp": "...",
  "endpoint": "chatgpt",
  "mcpUrl": "https://mcp.jotform.com/chatgpt",
  "session": { "id": "...", "connected": true },
  "tools": [...]
}
```

## Files

- `output-{endpoint}.json` - Tools and session data
- `db/` - OAuth tokens (delete to re-authenticate)

## Reset Auth

```bash
rm -rf db/*
```
