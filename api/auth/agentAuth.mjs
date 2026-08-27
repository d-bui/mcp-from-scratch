// ── 認証層（AI エージェント用）──────────────────────────────────
// MCP サーバーなどの AI エージェントが使う経路。
// 人間のログインとは完全に別系統: 事前発行の PAT (Personal Access Token) を
// Authorization: Bearer ヘッダで渡す。spx-learning-square と同じ方式。
//
// ポイント:
//   - PAT はセッションを持たない（ログイン不要・失効は発行側で管理）
//   - 「認証 OK」でも使える API はレジストリ（agentRegistry.mjs）で別途制限する

// デモでは env からキーを読む（カンマ区切りで複数可）。
//
// 実務では DB に保存する（spx-learning-square の実装と同じ考え方）:
//   - 管理者ごとにプロフィール画面から発行し、api_keys テーブル等に「ハッシュ化して」保存
//     （平文は発行時に一度だけ表示。DB が漏れても键は復元できない）
//   - トークン → 所有者を引けるので「誰の権限で・誰が呼んだか」を監査ログに残せる
//   - 無効化・再発行（ローテーション）が DB の 1 レコード操作でできる
//   - 有効期限や最終使用日時のカラムを持たせると棚卸しも容易
const AGENT_KEYS = (process.env.AGENT_API_KEYS ?? "agent-demo-key")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// トークン → エージェント情報。該当しなければ null。
export function resolveAgentToken(token) {
  return AGENT_KEYS.includes(token) ? { key: token } : null;
}
