// ── コントローラ層 ──────────────────────────────────────────────
// HTTP ⇄ サービス層の変換だけを担当する:
//   リクエストの取り出し → サービス呼び出し → 封筒形式 { success, data } で返す。
// 業務ルールはここに書かない（サービス層へ）。
//
// 各ルートのガードが「誰が使えるか」を宣言する:
//   forAgent("名前") … レジストリ登録済みなら AI エージェントも可
//   userOnly         … 人間ユーザー専用（破壊的操作）

import { Router } from "express";
import { usersService, ServiceError } from "./usersService.mjs";
import { userOnly } from "./auth/userAuth.mjs";
import { forAgent } from "./agentRegistry.mjs";

// 成功封筒 / 失敗封筒。MCP 層はこの封筒を剥がして data だけ扱う。
const ok = (res, data, status = 200) =>
  res.status(status).json({ success: true, data });

// ServiceError → HTTP レスポンスへの変換を 1 箇所に集約するラッパー。
const handle = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (e) {
    if (e instanceof ServiceError) {
      return res.status(e.status).json({
        success: false,
        error: { code: e.code, message: e.message },
      });
    }
    console.error("unexpected error:", e);
    return res.status(500).json({
      success: false,
      error: { code: "internal_error", message: "サーバー内部エラー" },
    });
  }
};

export const usersRouter = Router();

usersRouter.get(
  "/",
  forAgent("list_users"),
  handle((req, res) => ok(res, usersService.list())),
);

usersRouter.get(
  "/:id",
  forAgent("get_user"),
  handle((req, res) => ok(res, usersService.get(Number(req.params.id)))),
);

usersRouter.post(
  "/",
  forAgent("create_user"),
  handle((req, res) => ok(res, usersService.create(req.body ?? {}), 201)),
);

// 更新・削除は人間専用（レジストリにも登録していない）
usersRouter.put(
  "/:id",
  userOnly,
  handle((req, res) =>
    ok(res, usersService.update(Number(req.params.id), req.body ?? {})),
  ),
);

usersRouter.delete(
  "/:id",
  userOnly,
  handle((req, res) => {
    usersService.remove(Number(req.params.id));
    ok(res, { deleted: true });
  }),
);
