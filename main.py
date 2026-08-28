# main.py — FastAPI + fastapi-mcp で作る MCP サーバーデモ（1 ファイル・ローカル専用）
#
# 前半は「ふつうの Web アプリ」、後半に「AI のための追加」をまとめてある:
#   読む① データと人間のログイン … デモデータ + ログイン → セッショントークン
#   読む② 受付と門番            … 入口で「人間か AI か」を見分け、破壊的操作は人間専用に
#   読む③ ふつうの CRUD          … ただの FastAPI（docstring があとで効く）
#   ── ここから AI のための追加 ──
#   読む④ AI の合鍵と MCP 化     … 合鍵 1 行 + リストに書いた操作だけ AI の道具になる
#   読む⑤ 動かしてつなぐ         … python main.py で起動（ポート 8000 固定）→ /mcp につなぐ
#
# 起動:  python main.py（ポートは 8000 固定）
# 接続:  Claude Code → cp .mcp.json.example .mcp.json してこのフォルダで開く（/mcp でツール確認）
#        Cursor → .cursor/mcp.json に url + headers を書く ／ Claude Desktop → mcpb/ 参照

import os
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi_mcp import AuthConfig, FastApiMCP
from pydantic import BaseModel

# ── 読む① データと人間のログイン ────────────────────────────────
# デモデータはメモリ保存。
users = [
    {"id": 1, "name": "佐藤 太郎", "email": "sato@example.com"},
    {"id": 2, "name": "鈴木 花子", "email": "suzuki@example.com"},
    {"id": 3, "name": "田中 一郎", "email": "tanaka@example.com"},
]

# 人間はログインしてセッショントークン（usr_...）をもらう — いつもの Web と同じ
LOGIN_USERS = {"alice": "demo"}
sessions: dict[str, str] = {}  # token -> login_id

# テスト用スイッチ（既定 OFF）: AUTH_SKIP=1 python main.py で起動すると、
# トークン無しのリクエストを人間ユーザー扱いにする（ログイン省略）。発表デモでは使わない。
AUTH_SKIP = os.environ.get("AUTH_SKIP") == "1"

app = FastAPI(title="Users API")


class LoginBody(BaseModel):
    login_id: str
    password: str


@app.post("/login", operation_id="login")
def login(body: LoginBody):
    """ログイン。成功するとセッショントークンを返す（人間の入口）。"""
    if LOGIN_USERS.get(body.login_id) != body.password:
        raise HTTPException(401, "login_id か password が違います")
    token = "usr_" + secrets.token_hex(16)
    sessions[token] = body.login_id
    return {"token": token}


# ── 読む② 受付と門番 ───────────────────────────────────────────
def get_actor(authorization: str | None = Header(None)) -> dict:
    """Bearer トークンを見て「人間か AI か」を確定する（入口は 1 箇所）。"""
    token = (authorization or "").removeprefix("Bearer ").strip()
    if token in sessions:
        return {"type": "user", "login_id": sessions[token]}
    if token in AGENT_KEYS:  # AI 用の合鍵。定義は下の「AI のための追加」（読む④）
        return {"type": "agent"}
    if AUTH_SKIP:  # テスト用: トークン無し = 人間扱い（合鍵を出した AI はここに来ない）
        return {"type": "user", "login_id": "dev"}
    raise HTTPException(401, "有効なトークンがありません")


def user_only(actor: dict = Depends(get_actor)) -> dict:
    """門番: 破壊的操作に付ける。AI の合鍵なら 403。"""
    if actor["type"] != "user":
        raise HTTPException(403, "この操作は人間ユーザー専用です")
    return actor


# ── 読む③ ふつうの CRUD（docstring = 読む④ で AI への説明文になる）─
@app.get("/users", operation_id="list_users")
def list_users(actor: dict = Depends(get_actor)):
    """全ユーザーの一覧（id・名前・email）を返す。ID が必要な操作の前にまずこれで確認する。"""
    return {"users": users}


@app.get("/users/{id}", operation_id="get_user")
def get_user(id: int, actor: dict = Depends(get_actor)):
    """ユーザーを 1 人返す。id は list_users で確認した実在の ID を使う（推測しない）。"""
    for user in users:
        if user["id"] == id:
            return {"user": user}
    raise HTTPException(404, "そのユーザーはいません")


class UserBody(BaseModel):
    name: str
    email: str


@app.post("/users", operation_id="create_user")
def create_user(body: UserBody, actor: dict = Depends(get_actor)):
    """ユーザーを追加し、追加したユーザーを返す。"""
    user = {"id": max((u["id"] for u in users), default=0) + 1, **body.model_dump()}
    users.append(user)
    return {"user": user}


@app.put("/users/{id}", operation_id="update_user")
def update_user(id: int, body: UserBody, actor: dict = Depends(user_only)):
    """ユーザーの名前と email を書き換える（人間専用。AI の道具にもしない）。"""
    for user in users:
        if user["id"] == id:
            user.update(body.model_dump())
            return {"user": user}
    raise HTTPException(404, "そのユーザーはいません")


@app.delete("/users/{id}", operation_id="delete_user")
def delete_user(id: int, actor: dict = Depends(user_only)):
    """ユーザーを削除する（人間専用。AI の道具にもしない = 二重ガード）。"""
    for user in users:
        if user["id"] == id:
            users.remove(user)
            return {"deleted": True}
    raise HTTPException(404, "そのユーザーはいません")


# ════ ここから AI のための追加 ══════════════════════════════════
# ── 読む④ AI の合鍵と MCP 化 ───────────────────────────────────
# AI は事前発行の合鍵（PAT）で入る。デモは固定 1 本。
# 実務では DB にハッシュ保存して発行・失効・記録を管理する。
AGENT_KEYS = {"agent-demo-key"}

# include_operations（やっていいことリスト）に書いた操作だけが AI の道具箱に入り、
# 説明文は各エンドポイントの docstring から自動生成される。
# さらに /mcp 自体にも合鍵チェック（AuthConfig）— リスト外 + 認証の二段構え。
mcp = FastApiMCP(
    app,
    name="Users MCP",
    include_operations=[
        "list_users", "get_user", "create_user",
        # update_user・delete_user・login はわざと書かない = AI から見えない道具
    ],
    auth_config=AuthConfig(dependencies=[Depends(get_actor)]),
)
mcp.mount_http()  # 読む⑤ ここから → http://localhost:8000/mcp で待ち受け

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
