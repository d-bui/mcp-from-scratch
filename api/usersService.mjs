// ── サービス層 ──────────────────────────────────────────────────
// 業務ルール（バリデーション・重複チェックなど）を担当する。
// HTTP を知らない: リクエストもレスポンスも扱わず、エラーは ServiceError で表現。
// 「誰が呼んでいるか（人間 / AI エージェント）」も知らない — それは認証層の仕事。

import { usersRepository } from "./usersRepository.mjs";

// code はプログラム用（英語固定）、message は人間・AI への説明（日本語）。
export class ServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const VALID_ROLES = ["admin", "member"];

function validate({ name, email, role }) {
  if (!name?.trim()) throw new ServiceError(400, "name_required", "name は必須です");
  if (!email?.includes("@"))
    throw new ServiceError(400, "email_invalid", "email の形式が不正です");
  if (role && !VALID_ROLES.includes(role))
    throw new ServiceError(400, "role_invalid", `role は ${VALID_ROLES.join(" / ")} のいずれかです`);
}

export const usersService = {
  list() {
    return usersRepository.list();
  },

  get(id) {
    const user = usersRepository.get(id);
    if (!user) throw new ServiceError(404, "user_not_found", `ユーザー ${id} は存在しません`);
    return user;
  },

  create(input) {
    validate(input);
    if (usersRepository.findByEmail(input.email))
      throw new ServiceError(409, "email_taken", "その email は既に使われています");
    return usersRepository.create({
      name: input.name.trim(),
      email: input.email,
      role: input.role ?? "member",
    });
  },

  update(id, fields) {
    const cur = this.get(id); // 存在チェック（無ければ 404）
    const merged = { ...cur, ...fields };
    validate(merged);
    const dup = usersRepository.findByEmail(merged.email);
    if (dup && dup.id !== id)
      throw new ServiceError(409, "email_taken", "その email は既に使われています");
    return usersRepository.update(id, fields);
  },

  remove(id) {
    this.get(id); // 存在チェック
    usersRepository.delete(id);
  },
};
