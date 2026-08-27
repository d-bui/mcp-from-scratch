# MCP サーバーを作る ― FastAPI デモ

FastAPI 製の小さなユーザー管理 API に、**AI（Claude など）向けの MCP** を載せる最小デモ。
[fastapi-mcp](https://github.com/tadata-org/fastapi_mcp) が API から MCP を自動生成する
ので、本体は **`main.py` 1 ファイル（約 130 行）**。ローカル専用。

```
mcp-from-scratch/
├── main.py            # 本体（API + 認証 + MCP、これだけ読めば全部わかる）
├── requirements.txt
├── .mcp.json          # Claude Code 用の接続設定（URL + ヘッダ）
├── mcpb/              # 任意: Claude Desktop 用 .mcpb（橋渡しだけの小さな拡張）
└── slides/index.html  # 発表スライド（ブラウザで開く）
```

## 部品は 5 つ（すべて main.py 内）

| 部品 | main.py の場所 | やること |
|---|---|---|
| ① 土台の API | `@app.get("/users")` など | ふつうの CRUD |
| ② 入口（受付） | `login()` / `AGENT_KEYS` / `get_actor()` / `user_only()` | 人間 = ログイン、AI = 合鍵。入口で見分ける |
| ③ やっていいことリスト | `include_operations=[...]` | ここに書いた操作だけ AI の道具になる |
| ④ AI への説明係 | `FastApiMCP(app, ...)` | docstring から道具＋説明文を自動生成 |
| ⑤ つなぎ方 | `/mcp`（URL 接続） | ローカル URL でつなぐ（.mcpb は任意） |

## 権限マトリクス

| 操作 | 人間 | AI |
|---|:--:|:--:|
| ログイン | ✔（入口） | ― |
| 一覧・1 人取得・追加 | ✔ | ✔ リストにある |
| 削除 | ✔ | ✘ 403（人間専用ガード） |
| /mcp につなぐ | ― | ✔ 合鍵必須 |

削除は「③ リストに入れない（AI から見えない）」＋「`user_only` ガードで 403」の
**二段構え**。

## 動かし方

```bash
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
./venv/bin/uvicorn main:app --port 8000     # MCP は http://localhost:8000/mcp
```

人間の流れ（デモユーザー: alice / demo）:

```bash
TOKEN=$(curl -s -X POST localhost:8000/login -H 'Content-Type: application/json' \
  -d '{"login_id":"alice","password":"demo"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s localhost:8000/users -H "Authorization: Bearer $TOKEN"           # 一覧
curl -s -X DELETE localhost:8000/users/3 -H "Authorization: Bearer $TOKEN"  # 削除も OK
```

AI の流れ（合鍵の既定値: `agent-demo-key`）:

```bash
curl -s localhost:8000/users -H "Authorization: Bearer agent-demo-key"        # ✔ 200
curl -s -X DELETE localhost:8000/users/2 -H "Authorization: Bearer agent-demo-key"  # ✘ 403
```

## AI クライアントからつなぐ

```bash
# Claude Code（このフォルダで開けば .mcp.json が自動検出されるので不要）
claude mcp add --transport http users http://localhost:8000/mcp \
  --header "Authorization: Bearer agent-demo-key"
```

Cursor は `.cursor/mcp.json` に `url` + `headers` を書くだけ。

会話例: 「ユーザー一覧見せて」→ `list_users`。「2 番を削除して」→ AI は削除の道具を
持っていないので断ってくる（③ の見せ場）。

## Claude Desktop 用 `.mcpb`（任意）

HTTP 型の MCP はそのまま .mcpb にできないため、`mcpb/` に
[mcp-remote](https://github.com/geelen/mcp-remote) への橋渡しだけを詰めた拡張を用意:

```bash
cd mcpb && npm install
npx @anthropic-ai/mcpb pack . ../dist/users-mcp-local.mcpb
```

できた .mcpb をダブルクリック → URL とアクセスキーをフォーム入力。FastAPI サーバー
自体は手元で起動しておく。

## 発表スライド

`slides/index.html` をブラウザで開くとそのまま発表できる（← → キーで移動、14 枚、
オフライン動作）。導入 → 全体像 → 部品①〜⑤（コードショット付き）→ デモ手順 →
持ち帰りポイント、の構成。

## 参考・注意

- **バージョン固定**: fastapi-mcp 0.4.x は `mcp` 2.x と非互換（`Server` の引数変更）。
  `requirements.txt` で `mcp>=1.12,<2` に固定している。
- MCP はオープン規格 — Claude 以外の AI クライアント（ChatGPT / Cursor / Gemini など）
  からも同じサーバーにつなげる。`.mcpb` だけが Claude Desktop 専用の配布形式。
- MCP 仕様・ドキュメント: https://modelcontextprotocol.io
- fastapi-mcp: https://github.com/tadata-org/fastapi_mcp
- MCPB（manifest 仕様 + CLI）: https://github.com/anthropics/mcpb
