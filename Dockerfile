# ── API サーバー用 Dockerfile ───────────────────────────────────
# コンテナ化するのは API サーバー（api/）だけ。
# MCP 層（mcp/index.mjs）は入れない: Claude Desktop / Claude Code が
# 利用者のマシン上で stdio 起動するため（配布は .mcpb で行う）。

FROM node:22-alpine

WORKDIR /app

# 依存だけ先にインストールしてレイヤーキャッシュを効かせる
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# API のコードのみコピー（mcp/ や dist/ は .dockerignore で除外）
COPY api ./api

ENV PORT=3000
EXPOSE 3000

CMD ["node", "api/server.mjs"]
