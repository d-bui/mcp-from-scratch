# ユーザー管理 API + MCP レイヤードデモ

Node.js（JS のみ）で作る小さなデモ。「同じ API を **人間ユーザー** と **AI エージェント** の
両方に、別々の認証・別々の公開範囲で提供し、AI 側には **MCP サーバー（API 説明層）** を被せる」
という構成をレイヤーごとに見せるための発表用サンプルです。

設計の元ネタは `spx-learning-square` の実運用 MCP（`spx-learning-square/mcp/`、65 ツール、
`.mcpb` 配布）。このデモはその考え方を最小構成に落としたものです。

## 全体像

```
 人間ユーザー ──ログイン──▶ セッショントークン ─┐
                                                  │ Authorization: Bearer
 AI (Claude) ──▶ MCP サーバー ──PAT──────────────┤
              （mcp/index.mjs                     ▼
                = API 説明層）          ┌─────────────────────────┐
                                        │ API サーバー (Express)  │
                                        │  認証層（2 系統）       │
                                        │  エージェント公開       │
                                        │  レジストリ             │
                                        │  controller             │
                                        │  service                │
                                        │  repository（メモリ）   │
                                        └─────────────────────────┘
```

## レイヤー構成

| 層 | ファイル | 役割 |
|---|---|---|
| 認証層（人間） | `api/auth/userAuth.mjs` | ログイン → セッショントークン発行。`userOnly` ガード |
| 認証層（AI） | `api/auth/agentAuth.mjs` | PAT（事前発行キー）の検証。ログイン不要 |
| 公開レジストリ | `api/agentRegistry.mjs` | **AI に開放する API の登録リスト**。未登録 API は認証が通っても 403 |
| コントローラ層 | `api/usersController.mjs` | HTTP ⇄ サービスの変換 + ルートごとのガード宣言 |
| サービス層 | `api/usersService.mjs` | 業務ルール（バリデーション・重複チェック）。HTTP を知らない |
| リポジトリ層 | `api/usersRepository.mjs` | データ保存（デモはメモリ。実務では MySQL 等に差し替え） |
| MCP 層（API 説明層） | `mcp/index.mjs` | AI に API の使い方を日本語で説明しつつ仲介。権限は持たない |

## 権限マトリクス（デモの肝）

| API | 人間ユーザー | AI エージェント |
|---|:--:|:--:|
| GET /api/users（一覧） | ✅ | ✅ 登録済み |
| GET /api/users/:id（取得） | ✅ | ✅ 登録済み |
| POST /api/users（作成） | ✅ | ✅ 登録済み |
| PUT /api/users/:id（更新） | ✅ | ❌ `user_only` |
| DELETE /api/users/:id（削除） | ✅ | ❌ `user_only` |
| GET /api/agent/apis（公開一覧） | ✅ | ✅ 登録済み |

破壊的操作（更新・削除）はレジストリに**登録しない**ことで人間専用にしている。
「AI に何を許すか」が `agentRegistry.mjs` の 1 ファイルで一覧できるのがポイント。

## 動かし方

### 1. API サーバー

```bash
npm install
npm run api          # http://localhost:3000
```

Docker で起動する場合（コンテナ化するのは API のみ）:

```bash
npm run docker       # = docker compose up --build → http://localhost:3000
```

> MCP 層（`mcp/index.mjs`）は **コンテナに入れない**。Claude Desktop / Claude Code が
> 利用者のマシン上で stdio 起動するプロセスなので、配布は Docker ではなく `.mcpb` で行う。
> ここも発表ポイント: API はサーバー側（Docker/ECS）、MCP はクライアント側（.mcpb）と
> デプロイ単位が分かれる。

人間ユーザーの流れ（ログイン → CRUD）:

```bash
# ログイン（デモ: alice / demo）
TOKEN=$(curl -s -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"login_id":"alice","password":"demo"}' | node -p 'JSON.parse(require("fs").readFileSync(0)).data.token')

curl -s localhost:3000/api/users -H "Authorization: Bearer $TOKEN"          # 一覧
curl -s -X DELETE localhost:3000/api/users/3 -H "Authorization: Bearer $TOKEN"  # 削除も OK
```

AI エージェントの流れ（PAT、既定キー `agent-demo-key`）:

```bash
curl -s localhost:3000/api/users -H "Authorization: Bearer agent-demo-key"       # ✅ 200
curl -s localhost:3000/api/agent/apis -H "Authorization: Bearer agent-demo-key"  # ✅ 公開一覧
curl -s -X DELETE localhost:3000/api/users/2 \
  -H "Authorization: Bearer agent-demo-key"                                       # ❌ 403 user_only
```

エラーコードは 2 種類ある:
`user_only` = 人間専用ガード付きの API（更新・削除）、
`agent_not_allowed` = ガードは `forAgent` だがレジストリ未登録の API。

### 2. MCP サーバー（API 説明層）

デバッグ UI（MCP Inspector）:

```bash
npm run inspect
```

Claude Code に登録:

```bash
claude mcp add users-demo -- node /Users/d.bui/Documents/project/mcp-from-scratch/mcp/index.mjs
```

会話例: 「ユーザー一覧見せて」→ `list_users`、「新しいメンバー登録して」→ `create_user`、
「3 番を削除して」→ ツールが無いので **管理画面を案内**（instructions で指示済み）。

### 3. E2E テスト（MCP を「Claude の代わり」に叩く）

```bash
npm test             # test/mcp-client.test.mjs
```

MCP SDK のクライアントで `mcp/index.mjs` に stdio 接続し（Claude と同じ経路）、
API 起動 → 全ツール + リソース + 異常系（存在しない ID / email 重複 / スキーマ違反）を
自動検証する。発表時のライブデモにも使える。

### 4. Claude Desktop 向けに `.mcpb` で配布

`.mcpb` = manifest.json + コードを zip した Desktop Extension。ダブルクリックで
インストールでき、利用者は Node のインストールも設定ファイル編集も不要。
API URL とアクセスキーは **user_config**（インストール時のフォーム）から env に注入される
（`sensitive: true` のキーは OS のキーチェーンに保存）。

```bash
npx @anthropic-ai/mcpb validate manifest.json
npm run pack         # → dist/users-mcp-demo.mcpb（node_modules ごと同梱）
```

ビルド成果物は `dist/` に出力される（git 管理外）。`.mcpbignore` により
API のコードや Docker 関連ファイルは拡張機能に同梱されない —
バンドルに入るのは manifest.json + `mcp/` + `node_modules` だけ。

## 発表スライド

`slides/index.html` をブラウザで開くとそのまま発表できる（← → キーで移動、14 枚、
オフライン動作）。全体像 → 各レイヤーのコードショット → 権限マトリクス → 配布 →
デモ手順 → 実運用の学び、の構成。

## 発表ポイント（spx-learning-square の実運用から）

- **MCP 層は権限を持たない。** DB に触れず、PAT で REST API を呼ぶだけ。権限判定・
  バリデーションはすべて API 側 1 箇所 — MCP が壊れても UI にできない事故は起きない。
- **認証は 2 系統に分離。** 人間 = ログイン + セッション、AI = 事前発行 PAT。
  トークンの出自が違えば失効・監査・レート制限も別々に設計できる。
- **AI への公開は「明示的な登録制」。** パスのプレフィックスで開放すると、隣の
  センシティブな API まで意図せず開く事故が起きる（実際に起きかけた教訓）。
  レジストリはそのまま「AI 向け API 仕様書」としても機能する。
- **ツールの説明文はモデルへの指示書。** 「ID は推測せず list_users で解決」「削除は
  管理画面へ案内」のような運用ルールを description / instructions に書くことで、
  AI の振る舞いをコードではなく文章で制御できる。
- **エラーは throw せず `isError` + 機械可読 code で返す。** モデルが code を読んで
  自分でリカバリーできる（email_taken → 別案を提案、など）。
- **stdout は JSON-RPC 専用。** stdio サーバーで `console.log` すると通信が壊れる。
  ログは必ず `console.error`。

## 参考

- MCP 仕様・ドキュメント: https://modelcontextprotocol.io
- TypeScript/JS SDK: https://github.com/modelcontextprotocol/typescript-sdk
- MCPB（manifest 仕様 + CLI）: https://github.com/anthropics/mcpb
- 実運用版の実装: `../spx-learning-square/mcp/`（esbuild 1 ファイルバンドル、
  環境ラベル焼き込み、backend が `.mcpb` を動的生成する構成）
