# Cloud Run 用。build context は hs-verify-gate/ (docker build -f gcp/Dockerfile .)。
FROM node:22-slim
WORKDIR /app
# 依存は gcp/ 配下だけ(worker.js 本体は外部依存ゼロ)
COPY gcp/package.json ./gcp/package.json
RUN cd gcp && npm install --omit=dev --no-audit --no-fund
# アプリ本体(無改変の worker.js とその src、GCP 入口)
COPY src ./src
COPY gcp ./gcp
ENV PORT=8080
# Cloud Run は "CPU always allocated" 推奨(cron sweep と waitUntil の後始末のため)
CMD ["node", "gcp/server.mjs"]
