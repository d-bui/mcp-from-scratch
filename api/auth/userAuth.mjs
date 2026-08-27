// ── 認証層（人間ユーザー用）────────────────────────────────────
// 管理画面などから人間がログインする経路。
// ログイン成功 → セッショントークン（usr_ プレフィックス）を発行し、メモリに保持。
// 実務では JWT + httpOnly Cookie 等にする（spx-learning-square は JWT 30日 Cookie）。

import { randomUUID } from "node:crypto";

// デモ用の固定ログインユーザー（実務では DB + パスワードハッシュ）
const LOGIN_USERS = [{ login_id: "alice", password: "demo", name: "Alice" }];

const sessions = new Map(); // token → { login_id, name }

// ログイン。成功ならトークンを返し、失敗なら null。
export function login(login_id, password) {
  const found = LOGIN_USERS.find(
    (u) => u.login_id === login_id && u.password === password,
  );
  if (!found) return null;
  const token = "usr_" + randomUUID();
  sessions.set(token, { login_id: found.login_id, name: found.name });
  return token;
}

// トークン → セッション解決。見つからなければ null。
export function resolveUserToken(token) {
  return sessions.get(token) ?? null;
}

// ガード: 「人間ユーザー専用」API に付ける。
// AI エージェントのトークンで来たら 403（例: 更新・削除などの破壊的操作）。
export function userOnly(req, res, next) {
  if (req.actor?.type === "user") return next();
  return res.status(403).json({
    success: false,
    error: { code: "user_only", message: "この API は人間ユーザー専用です" },
  });
}
