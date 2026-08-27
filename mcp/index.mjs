// ── MCP 層（API 説明層）────────────────────────────────────────
// AI（Claude）に「この API をどう使うか」を説明しながら仲介する薄い層。
// DB には触れず、エージェント用 PAT で REST API を呼ぶだけ。
// 権限は API 側（認証層 + レジストリ）が決める — MCP 層は権限を持たない。
//
// ツールは agentRegistry.mjs の登録内容と 1:1 対応:
//   list_users / get_user / create_user / list_agent_apis
//   （update / delete はエージェント非公開なのでツール化しない）
//
// 環境変数（.mcpb では manifest の user_config から注入される）:
//   DEMO_API_URL  API のベース URL（既定 http://localhost:3000/api）
//   DEMO_API_KEY  エージェント用アクセスキー（既定 agent-demo-key）
//
// 注意: stdio サーバーでは stdout に console.log してはいけない
// （stdout は JSON-RPC 専用）。ログは console.error（stderr）へ。
//
// 補足: MCP はオープン規格（https://modelcontextprotocol.io）。このサーバーは
// Claude 以外の MCP 対応クライアント（ChatGPT / Cursor / Gemini CLI など）からも
// .mcp.json 相当の JSON 設定（command + args + env）でそのまま使える。
// .mcpb（manifest.json + zip）だけは Claude Desktop 専用の配布形式で、
// Web ベースのクライアントにつなぐ場合は stdio ではなくリモート（HTTP）で公開する。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const VERSION = "0.1.0";
const API_URL =
  (process.env.DEMO_API_URL ?? "").trim() || "http://localhost:3000/api";
const API_KEY = (process.env.DEMO_API_KEY ?? "").trim() || "agent-demo-key";

// ── 薄い API クライアント ──────────────────────────────────────
// 封筒 { success, data, error:{code,message} } を 1 箇所で剥がす。
class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": `users-mcp-demo/${VERSION}`, // 名乗っておくと API 側のログで MCP 経由と分かる
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError(`API に接続できません: ${e.message}`, "network_error", 0);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new ApiError(err.message ?? res.statusText, err.code, res.status);
  }
  return json?.data ?? json;
}

// ── 結果ヘルパー ────────────────────────────────────────────────
const ok = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  structuredContent: Array.isArray(data) ? { data } : data,
});
// エラーは throw せず isError で返す → モデルが読んで対処できる
const fail = (message) => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

const readAnnotations = { readOnlyHint: true, openWorldHint: true };
const createAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

// registerTool のラッパー: try/catch を 1 箇所に集約し、
// ApiError を「コード付きの読めるメッセージ」に整形する。
function tool(server, name, config, fn) {
  server.registerTool(name, config, async (args) => {
    try {
      return await fn(args ?? {});
    } catch (e) {
      if (e instanceof ApiError)
        return fail(`${e.code ?? "error"} (HTTP ${e.status}): ${e.message}`);
      return fail(String(e?.message ?? e));
    }
  });
}

// ── サーバー ────────────────────────────────────────────────────
const server = new McpServer(
  { name: "users-mcp-demo", version: VERSION, title: "ユーザー管理デモ MCP" },
  {
    // instructions = 接続時にモデルへ渡す運用ルール（日本語で OK）
    instructions: `ユーザー管理 API を会話から操作する MCP サーバーです。まず guide://api を読んでください。
- ID は推測せず、必ず list_users で解決すること。
- 作成前に同じ email が無いか list_users で確認すること。
- 更新・削除はこのツールではできません（人間専用 API）。頼まれたら管理画面を案内してください。`,
  },
);

// リソース: モデルがツールを呼ぶ前に読める「API の説明書」
server.registerResource(
  "api-guide",
  "guide://api",
  {
    title: "API ガイド",
    description: "ユーザー管理 API の構成と、エージェントに公開されている範囲の説明",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: `# ユーザー管理 API ガイド

## データモデル
user = { id, name, email, role }。role は admin / member。

## エージェントに公開されている API（レジストリ登録済み）
- list_users (GET /users) — 一覧
- get_user (GET /users/:id) — 1 件取得
- create_user (POST /users) — 新規作成
- list_agent_apis (GET /agent/apis) — この公開一覧そのもの

## エージェントにできないこと
更新（PUT）と削除（DELETE)は人間ユーザー専用。呼ぶと agent_not_allowed (403) になる。
頼まれた場合は「管理画面から操作してください」と案内すること。

## エラー封筒
失敗時は { error: { code, message } }。code で対処を判断する
（user_not_found → id を確認、email_taken → 別の email を提案、など）。`,
      },
    ],
  }),
);

// ── ツール（レジストリと 1:1）──────────────────────────────────
tool(
  server,
  "list_users",
  {
    title: "ユーザー一覧",
    description:
      "ユーザー全件を取得する（id, name, email, role）。ID が必要な操作の前に必ずこれで解決すること。",
    annotations: readAnnotations,
  },
  async () => ok(await api("GET", "/users")),
);

tool(
  server,
  "get_user",
  {
    title: "ユーザー取得",
    description:
      "ユーザーを 1 件取得する。user_id は list_users で確認した実在の ID を使うこと（推測しない）。",
    inputSchema: { user_id: z.number().int().describe("ユーザー ID") },
    annotations: readAnnotations,
  },
  async ({ user_id }) => ok(await api("GET", `/users/${user_id}`)),
);

tool(
  server,
  "create_user",
  {
    title: "ユーザー作成",
    description:
      "ユーザーを新規作成する。email が既存と重複すると失敗する（email_taken）ので、事前に list_users で確認するとよい。role 未指定は member。",
    inputSchema: {
      name: z.string().min(1).describe("氏名"),
      email: z.string().describe("メールアドレス（重複不可）"),
      role: z.enum(["admin", "member"]).optional().describe("権限（既定 member）"),
    },
    annotations: createAnnotations,
  },
  async ({ name, email, role }) =>
    ok(await api("POST", "/users", { name, email, role })),
);

tool(
  server,
  "list_agent_apis",
  {
    title: "エージェント公開 API 一覧",
    description:
      "この MCP（AI エージェント）に公開されている API の一覧を取得する。『何ができるか』を聞かれたらこれを呼んで答える。",
    annotations: readAnnotations,
  },
  async () => ok(await api("GET", "/agent/apis")),
);

// server_info: ホストが serverInfo をモデルに渡すとは限らないため、
// 「どのサーバー・どのバージョン・どの API に繋がっているか」をツールでも答えられるようにする。
tool(
  server,
  "server_info",
  {
    title: "サーバー情報",
    description:
      "この MCP サーバーの名前・バージョン・接続先 API の URL を返す。バージョンを聞かれたらこれを呼ぶ。",
    annotations: readAnnotations,
  },
  async () => ok({ name: "users-mcp-demo", version: VERSION, api_url: API_URL }),
);

// ── 起動 ────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("users-mcp-demo: server error:", err);
  process.exit(1);
});
