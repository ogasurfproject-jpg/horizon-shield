# HORIZON SHIELD hs-mcp : local stdio MCP server for registry crawlers (Glama etc.)
# Runs the server (workers/hs-mcp/src/mcp.js) in-process over stdio via stdio.js.
# Introspection (initialize, tools/list, prompts/list) needs no external egress.
# Build context is the repository root.
FROM node:22-slim
WORKDIR /app/workers/hs-mcp
COPY workers/hs-mcp/package.json ./package.json
COPY workers/hs-mcp/src ./src
COPY workers/hs-mcp/stdio.js ./stdio.js
CMD ["node", "stdio.js"]
