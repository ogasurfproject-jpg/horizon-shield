# HORIZON SHIELD hs-mcp : local stdio MCP server for registry crawlers (Glama etc.)
# Runs the server (workers/hs-mcp/src/mcp.js) in-process over stdio via stdio.js.
# Introspection (initialize, tools/list, prompts/list) needs no external egress.
# Build context is the repository root.
# The tool names this image advertises are the canonical verb+object set: 14 tools,
# unchanged since 2026-07-23 (commit 2808915c). The pre-2026-07-23 names still exist
# inside src/mcp.js as call aliases for older clients, but tools/list does not return
# them. Verified locally: `node stdio.js` + tools/list -> the 14 canonical names.
FROM node:22-slim
WORKDIR /app/workers/hs-mcp
COPY workers/hs-mcp/package.json ./package.json
COPY workers/hs-mcp/src ./src
COPY workers/hs-mcp/stdio.js ./stdio.js
CMD ["node", "stdio.js"]
