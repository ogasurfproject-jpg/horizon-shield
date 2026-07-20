FROM node:20-slim
RUN npm install -g mcp-remote
CMD ["mcp-remote","https://hs-mcp.oga-surf-project.workers.dev"]
