// ── API サーバー本体（層の組み立て）─────────────────────────────
// レイヤー構成:
//   認証層     auth/userAuth.mjs（人間: ログイン→セッション）
//              auth/agentAuth.mjs（AI エージェント: PAT）
//   公開制御   agentRegistry.mjs（エージェントに開放する API の登録リスト）
//   controller usersController.mjs（HTTP ⇄ サービス）
//   service    usersService.mjs（業務ルール）
//   repository usersRepository.mjs（データ保存）
//
// 起動:  npm run api   （ポートは PORT、既定 3000）

import express from "express";
import { login, resolveUserToken } from "./auth/userAuth.mjs";
import { resolveAgentToken } from "./auth/agentAuth.mjs";
import { AGENT_APIS, forAgent } from "./agentRegistry.mjs";
import { usersRouter } from "./usersController.mjs";

const app = express();
app.use(express.json());

// ── ログイン（唯一の認証不要 API）──────────────────────────────
app.post("/api/auth/login", (req, res) => {
  const { login_id, password } = req.body ?? {};
  const token = login(login_id, password);
  if (!token) {
    return res.status(401).json({
      success: false,
      error: { code: "login_failed", message: "login_id か password が違います" },
    });
  }
  res.json({ success: true, data: { token } });
});

// ── 認証の入り口 ────────────────────────────────────────────────
// Bearer トークンを見て actor（誰が呼んでいるか）を確定する。
// 以降の各ルートは req.actor.type ("user" | "agent") でガードする。
app.use("/api", (req, res, next) => {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const session = resolveUserToken(token);
  if (session) {
    req.actor = { type: "user", name: session.name };
    return next();
  }
  const agent = resolveAgentToken(token);
  if (agent) {
    req.actor = { type: "agent" };
    return next();
  }
  res.status(401).json({
    success: false,
    error: { code: "unauthorized", message: "有効なトークンがありません" },
  });
});

// ── ルート ──────────────────────────────────────────────────────
// エージェント公開一覧: エージェント自身が「自分は何を使えるか」を取得できる
app.get("/api/agent/apis", forAgent("list_agent_apis"), (req, res) => {
  res.json({ success: true, data: AGENT_APIS });
});

app.use("/api/users", usersRouter);

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.error(`users API listening on http://localhost:${PORT}`);
});
