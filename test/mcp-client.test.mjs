// ── MCP E2E テスト ──────────────────────────────────────────────
// 「Claude の代わり」に MCP SDK のクライアントで mcp/index.mjs へ stdio 接続し、
// 全ツール + リソース + エラー系を実際に叩いて検証する。
//
// 流れ:
//   1. API サーバー（api/server.mjs）をテスト用ポート 3100 で起動
//   2. MCP サーバーを stdio で spawn し、SDK クライアントで接続
//   3. tools/list・resources・tools/call（正常系 + 異常系）を検証
//   4. 全部 PASS なら exit 0、1 つでも FAIL なら exit 1
//
// 実行:  npm test

import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const API_PORT = 3100;
const API_URL = `http://localhost:${API_PORT}/api`;
const API_KEY = "agent-demo-key";

// ── 小さなアサーションヘルパー ─────────────────────────────────
let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
// ツール結果のテキスト部分を取り出す（structuredContent 検証と併用）
const text = (r) => r.content?.map((c) => c.text).join("\n") ?? "";

// ── 1. API サーバー起動（テスト用ポート）───────────────────────
console.log(`starting API server on :${API_PORT} ...`);
const api = spawn("node", ["api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT) },
  stdio: ["ignore", "ignore", "inherit"],
});
// 起動待ち: /api/users が 200 を返すまでポーリング（最大 5 秒）
let up = false;
for (let i = 0; i < 25 && !up; i++) {
  await new Promise((r) => setTimeout(r, 200));
  up = await fetch(`${API_URL}/users`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  })
    .then((r) => r.ok)
    .catch(() => false);
}
if (!up) {
  console.error("API server did not start");
  api.kill();
  process.exit(1);
}

// ── 2. MCP サーバーへ stdio 接続（Claude と同じ経路）───────────
const transport = new StdioClientTransport({
  command: "node",
  args: ["mcp/index.mjs"],
  env: { ...process.env, DEMO_API_URL: API_URL, DEMO_API_KEY: API_KEY },
});
const client = new Client({ name: "e2e-test-client", version: "0.0.1" });

try {
  await client.connect(transport);
  const info = client.getServerVersion();
  console.log(`connected: ${info?.name} v${info?.version}\n`);
  check("initialize: サーバー名", info?.name === "users-mcp-demo");

  // ── 3a. ツール一覧（レジストリと 1:1 のはず）─────────────────
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  check(
    "tools/list: 期待する 5 ツール",
    JSON.stringify(names) ===
      JSON.stringify(
        ["create_user", "get_user", "list_agent_apis", "list_users", "server_info"].sort(),
      ),
    `actual: ${names.join(",")}`,
  );
  check(
    "tools/list: 破壊的ツール（update/delete）が存在しない",
    !names.some((n) => n.includes("update") || n.includes("delete")),
  );

  // ── 3b. リソース（API 説明書）─────────────────────────────────
  const guide = await client.readResource({ uri: "guide://api" });
  check(
    "resources/read: guide://api が読める",
    guide.contents?.[0]?.text?.includes("エージェントにできないこと"),
  );

  // ── 3c. 正常系 ────────────────────────────────────────────────
  const list = await client.callTool({ name: "list_users", arguments: {} });
  check("list_users: シードユーザーが返る", text(list).includes("sato@example.com"));

  const one = await client.callTool({ name: "get_user", arguments: { user_id: 1 } });
  check("get_user(1): 取得できる", text(one).includes('"id": 1') && !one.isError);

  const created = await client.callTool({
    name: "create_user",
    arguments: { name: "テスト 太郎", email: "test-taro@example.com" },
  });
  check(
    "create_user: 作成できる（role 既定 member）",
    text(created).includes('"role": "member"') && !created.isError,
  );

  const apis = await client.callTool({ name: "list_agent_apis", arguments: {} });
  check("list_agent_apis: 公開一覧が返る", text(apis).includes("list_users"));

  const sinfo = await client.callTool({ name: "server_info", arguments: {} });
  check("server_info: 接続先 API URL を答えられる", text(sinfo).includes(API_URL));

  // ── 3d. 異常系（isError + 機械可読 code で返ること）──────────
  const nf = await client.callTool({ name: "get_user", arguments: { user_id: 999 } });
  check(
    "get_user(999): isError + user_not_found",
    nf.isError === true && text(nf).includes("user_not_found"),
  );

  const dup = await client.callTool({
    name: "create_user",
    arguments: { name: "重複", email: "test-taro@example.com" },
  });
  check(
    "create_user 重複 email: isError + email_taken",
    dup.isError === true && text(dup).includes("email_taken"),
  );

  // 入力スキーマ違反（name 欠落）は SDK がツール実行前に弾く。
  // 返り方は SDK バージョンで異なる: 例外を投げるか、isError + "Input validation error"
  // （-32602）を in-band で返すか。どちらでも「実行前に拒否された」なら OK。
  let schemaRejected = false;
  try {
    const bad = await client.callTool({
      name: "create_user",
      arguments: { email: "x@example.com" },
    });
    schemaRejected = bad.isError === true && /validation|-32602/i.test(text(bad));
  } catch {
    schemaRejected = true;
  }
  check("create_user name欠落: zod スキーマで拒否", schemaRejected);
} finally {
  await client.close().catch(() => {});
  api.kill();
}

// ── 4. 結果 ─────────────────────────────────────────────────────
console.log(failures === 0 ? "\nALL PASS ✅" : `\n${failures} FAILURE(S) ❌`);
process.exit(failures === 0 ? 0 : 1);
