# main.py — FastAPI + fastapi-mcp で作る MCP サーバーデモ（1 ファイル・ローカル専用）
#
# 部品は 5 つ:
#   ① 土台の API     … ふつうの CRUD エンドポイント
#   ② 入口（受付）   … 人間 = ログイン → セッショントークン ／ AI = 合鍵（PAT）
#   ③ やっていいことリスト … include_operations（ここに書いた操作だけ AI の道具になる）
#   ④ AI への説明係   … fastapi-mcp が自動生成（docstring がそのまま道具の説明文になる）
#   ⑤ つなぎ方       … ローカル URL（/mcp）でつなぐ。.mcpb は任意（mcpb/ 参照）
#
# 起動:  uvicorn main:app --port 8000
# 接続:  Claude Code → claude mcp add --transport http users \
#            http://localhost:8000/mcp --header "Authorization: Bearer agent-demo-key"
#        Cursor → .cursor/mcp.json に url + headers を書く

import secrets

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi_mcp import AuthConfig, FastApiMCP
from pydantic import BaseModel

# ── データ（デモ用メモリ保存）────────────────────────────────────
users = [
    {"id": 1, "name": "佐藤 太郎", "email": "sato@example.com"},
    {"id": 2, "name": "鈴木 花子", "email": "suzuki@example.com"},
    {"id": 3, "name": "田中 一郎", "email": "tanaka@example.com"},
]

# ── ② 入口(受付) ─────────────────────────────────────────────────
# 人間: ログインしてセッショントークン（usr_...）をもらう
# AI:   事前発行の合鍵（PAT）。デモでは固定。実務では DB にハッシュ保存して発行・失効を管理
LOGIN_USERS = {"alice": "demo"}
AGENT_KEYS = {"agent-demo-key"}
sessions: dict[str, str] = {}  # token -> login_id


def get_actor(authorization: str | None = Header(None)) -> dict:
    """Bearer トークンを見て「人間か AI か」を確定する（入口は 1 箇所）。"""
    token = (authorization or "").removeprefix("Bearer ").strip()
    if token in sessions:
        return {"type": "user", "login_id": sessions[token]}
    if token in AGENT_KEYS:
        return {"type": "agent"}
    raise HTTPException(401, "有効なトークンがありません")


def user_only(actor: dict = Depends(get_actor)) -> dict:
    """人間ユーザー専用ガード（破壊的操作に付ける）。AI の合鍵なら 403。"""
    if actor["type"] != "user":
        raise HTTPException(403, "この操作は人間ユーザー専用です")
    return actor


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


# ── ① 土台の API（docstring = ④ AI への説明文になる）──────────────
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


@app.delete("/users/{id}", operation_id="delete_user")
def delete_user(id: int, actor: dict = Depends(user_only)):
    """ユーザーを削除する（人間専用。AI の道具にもしない = 二重ガード）。"""
    for user in users:
        if user["id"] == id:
            users.remove(user)
            return {"deleted": True}
    raise HTTPException(404, "そのユーザーはいません")


# ── ③ やっていいことリスト + ④ 説明係 ────────────────────────────
# include_operations に書いた操作だけが AI の道具箱に入る。
# delete_user と login はわざと入れない（AI からは見えない道具になる）。
# さらに /mcp 自体にも合鍵チェック（AuthConfig）— リスト外 + 認証の二段構え。
mcp = FastApiMCP(
    app,
    name="Users MCP",
    include_operations=["list_users", "get_user", "create_user"],
    auth_config=AuthConfig(dependencies=[Depends(get_actor)]),
)
mcp.mount_http()  # → http://localhost:8000/mcp

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
