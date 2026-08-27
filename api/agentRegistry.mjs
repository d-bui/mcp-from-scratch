// ── AI エージェント公開 API レジストリ ──────────────────────────
// 「AI エージェントに開放する API」の一覧。ここに登録された API だけが
// エージェントのトークンで呼べる。登録が無い API は認証が通っても 403。
//
// なぜ必要か（spx-learning-square の教訓）:
//   パスのプレフィックスだけで開放すると、隣のセンシティブな API まで
//   意図せず開いてしまう。1 本ずつ明示的に登録する方が安全で、
//   この一覧がそのまま「エージェント向け API 仕様書」にもなる。
//
// description は日本語 — MCP 層（mcp/index.mjs）のツール説明と 1:1 で対応させる。

export const AGENT_APIS = [
  {
    name: "list_users",
    method: "GET",
    path: "/api/users",
    description: "ユーザー一覧を取得する",
  },
  {
    name: "get_user",
    method: "GET",
    path: "/api/users/:id",
    description: "ユーザーを 1 件取得する",
  },
  {
    name: "create_user",
    method: "POST",
    path: "/api/users",
    description: "ユーザーを新規作成する（name, email, role）",
  },
  {
    name: "list_agent_apis",
    method: "GET",
    path: "/api/agent/apis",
    description: "エージェントに公開されている API の一覧（この表自身）を取得する",
  },
  // update_user / delete_user は意図的に登録しない = 破壊的操作は人間専用。
];

// ガード: ルート定義に forAgent("名前") を付けると、
//   - 人間ユーザー → 常に通す（人間はエージェント公開範囲に縛られない）
//   - エージェント → レジストリに登録済みの場合だけ通す
export const forAgent = (name) => (req, res, next) => {
  if (req.actor?.type === "user") return next();
  if (AGENT_APIS.some((a) => a.name === name)) return next();
  return res.status(403).json({
    success: false,
    error: {
      code: "agent_not_allowed",
      message: "この API は AI エージェントには公開されていません",
    },
  });
};
