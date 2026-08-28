# シンプルな MCP サーバーを作る ― FastAPI デモ

FastAPI 製の小さなユーザー管理 API に、**AI（Claude など）向けの MCP** を載せる最小デモ。
[fastapi-mcp](https://github.com/tadata-org/fastapi_mcp) が API から MCP を自動生成する
ので、本体は **`main.py` 1 ファイルだけ**。ローカル専用。

```
mcp-from-scratch/
├── main.py            # 本体（API + 認証 + MCP、これだけ読めば全部わかる）
├── requirements.txt
├── .mcp.json.example  # Claude Code 用の接続設定例（コピーして使う）
├── mcpb/              # 任意: Claude Desktop 用 .mcpb（橋渡しだけの小さな拡張）
└── slides/index.html  # 発表スライド（ブラウザで開く）
```

## 読みどころは 5 つ（main.py を上から順に）

| 読む順 | main.py の場所 | 内容 |
|---|---|---|
| ① データと人間のログイン | `users` / `LOGIN_USERS` / `login()` | ふつうのログイン（セッショントークン発行） |
| ② 受付と門番 | `get_actor()` / `user_only()` | 入口で見分け、破壊的操作は人間専用に |
| ③ ふつうの CRUD | `@app.get("/users")` など | ただの FastAPI（docstring があとで効く） |
| ④ AI の合鍵と MCP 化 | `AGENT_KEYS` / `FastApiMCP(...)` | ここからが AI のための追加。リストに書いた操作だけ道具に |
| ⑤ 動かしてつなぐ | `mcp.mount_http()` → `/mcp` | ローカル URL でつなぐ（.mcpb は任意） |

## 権限マトリクス

| 操作 | 人間 | AI |
|---|:--:|:--:|
| ログイン | ✔（入口） | ― |
| 一覧・1 人取得・追加 | ✔ | ✔ リストにある |
| 削除 | ✔ | ✘ 403（人間専用ガード） |
| /mcp につなぐ | ― | ✔ 合鍵必須 |

削除は「リストに入れない（AI から見えない）」＋「`user_only` の門番で 403」の
**二段構え**。

## 動かし方

```bash
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
./venv/bin/python main.py                   # ポートは 8000 固定。MCP は http://localhost:8000/mcp
```

急いでテストしたいとき: `AUTH_SKIP=1 ./venv/bin/python main.py` で起動すると
**トークン無しのリクエストが人間扱い**になりログイン不要（合鍵を出した AI は通常どおり）。
テスト用スイッチなので、発表デモや共有時は付けない。

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
# Claude Code ― 設定例をコピーすれば、このフォルダで開くだけで自動検出される
cp .mcp.json.example .mcp.json

# （コピーせずコマンドで登録する場合はこちら）
claude mcp add --transport http users http://localhost:8000/mcp \
  --header "Authorization: Bearer agent-demo-key"
```

Cursor は `.cursor/mcp.json` に `url` + `headers` を書くだけ。

会話例: 「ユーザー一覧見せて」→ `list_users`。「2 番を削除して」→ AI は削除の道具を
持っていないので断ってくる（読む④ の見せ場）。

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

`slides/index.html` をブラウザで開くとそのまま発表できる（← → キーで移動、
本編 10 枚 + 付録 3 枚、10 分発表向け、オフライン動作）。
**コードリーディング形式**: なぜ作るか → MCP は「道具箱」 → 5 つのブロックの地図 →
読む①②ログインと受付 → ③ふつうの CRUD → ④AI の合鍵と MCP 化（docstring のたね明かし）→
⑤動かしてつなぐ → まとめ。
そのあとに**付録（手順書 3 枚: 起動・接続・.mcpb 作成）** — 発表はまとめで終了、
付録は配布後に読者が自分で手を動かすためのガイド（.mcpb の話は付録に寄せてある）。

## 参考・注意

- **バージョン固定**: fastapi-mcp 0.4.x は `mcp` 2.x と非互換（`Server` の引数変更）。
  `requirements.txt` で `mcp>=1.12,<2` に固定している。
- MCP はオープン規格 — Claude 以外の AI クライアント（ChatGPT / Cursor / Gemini など）
  からも同じサーバーにつなげる。`.mcpb` だけが Claude Desktop 専用の配布形式。
- AI 側の認証はデモでは PAT（固定キー）。リモート公開して本格運用するなら、
  MCP 標準の OAuth フローにする設計もある。
- MCP 仕様・ドキュメント: https://modelcontextprotocol.io
- fastapi-mcp: https://github.com/tadata-org/fastapi_mcp
- MCPB（manifest 仕様 + CLI）: https://github.com/anthropics/mcpb
