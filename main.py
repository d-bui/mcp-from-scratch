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
# 接続:  Claude Code → claude mcp add --transport http employee \
#            http://localhost:8000/mcp --header "Authorization: Bearer agent-demo-key"
#        Cursor → .cursor/mcp.json に url + headers を書く

import secrets

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi_mcp import AuthConfig, FastApiMCP
from pydantic import BaseModel

# ── データ（デモ用メモリ保存）────────────────────────────────────
employees = [
    {"id": 1, "name": "John Doe", "salary": 500},
    {"id": 2, "name": "Jane Smith", "salary": 700},
    {"id": 3, "name": "Jim Beam", "salary": 600},
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


app = FastAPI(title="Employee API")


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
@app.get("/employees", operation_id="list_employees")
def list_employees(actor: dict = Depends(get_actor)):
    """全社員の一覧（id・名前・給与）を返す。ID が必要な操作の前にまずこれで確認する。"""
    return {"employees": employees}


@app.get("/employees/{id}", operation_id="get_employee")
def get_employee(id: int, actor: dict = Depends(get_actor)):
    """社員を 1 人返す。id は list_employees で確認した実在の ID を使う（推測しない）。"""
    for emp in employees:
        if emp["id"] == id:
            return {"employee": emp}
    raise HTTPException(404, "その社員はいません")


class EmployeeBody(BaseModel):
    name: str
    salary: int


@app.post("/employees", operation_id="create_employee")
def create_employee(body: EmployeeBody, actor: dict = Depends(get_actor)):
    """社員を給与つきで追加し、追加した社員を返す。"""
    emp = {"id": max((e["id"] for e in employees), default=0) + 1, **body.model_dump()}
    employees.append(emp)
    return {"employee": emp}


@app.delete("/employees/{id}", operation_id="delete_employee")
def delete_employee(id: int, actor: dict = Depends(user_only)):
    """社員を削除する（人間専用。AI の道具にもしない = 二重ガード）。"""
    for emp in employees:
        if emp["id"] == id:
            employees.remove(emp)
            return {"deleted": True}
    raise HTTPException(404, "その社員はいません")


# ── ③ やっていいことリスト + ④ 説明係 ────────────────────────────
# include_operations に書いた操作だけが AI の道具箱に入る。
# delete_employee と login はわざと入れない（AI からは見えない道具になる）。
# さらに /mcp 自体にも合鍵チェック（AuthConfig）— リスト外 + 認証の二段構え。
mcp = FastApiMCP(
    app,
    name="Employee MCP",
    include_operations=["list_employees", "get_employee", "create_employee"],
    auth_config=AuthConfig(dependencies=[Depends(get_actor)]),
)
mcp.mount_http()  # → http://localhost:8000/mcp

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
