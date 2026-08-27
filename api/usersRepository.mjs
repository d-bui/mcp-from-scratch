// ── リポジトリ層 ────────────────────────────────────────────────
// データの保存・取得「だけ」を担当する。業務ルールも HTTP も知らない。
// 今回はデモなのでメモリ上の Map。実務では MySQL 等に差し替える層。

const users = new Map(); // id → user
let nextId = 1;

// デモ用シードデータ
for (const u of [
  { name: "佐藤 太郎", email: "sato@example.com", role: "admin" },
  { name: "鈴木 花子", email: "suzuki@example.com", role: "member" },
  { name: "田中 一郎", email: "tanaka@example.com", role: "member" },
]) {
  users.set(nextId, { id: nextId, ...u });
  nextId++;
}

export const usersRepository = {
  list() {
    return [...users.values()];
  },
  get(id) {
    return users.get(id) ?? null;
  },
  findByEmail(email) {
    return this.list().find((u) => u.email === email) ?? null;
  },
  create({ name, email, role }) {
    const user = { id: nextId++, name, email, role };
    users.set(user.id, user);
    return user;
  },
  update(id, fields) {
    const cur = users.get(id);
    if (!cur) return null;
    const updated = { ...cur, ...fields, id };
    users.set(id, updated);
    return updated;
  },
  delete(id) {
    return users.delete(id);
  },
};
