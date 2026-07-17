"""
Local SQLite persistence for Chat History.

Fully offline - uses Python's built-in sqlite3, no external services.
The DB file lives next to this module so it survives backend restarts
(and survives container restarts too, as long as /app is volume-mounted).
"""

import sqlite3
import threading
import uuid
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "chat_history.db"

# sqlite3 connections aren't thread-safe by default; FastAPI can handle
# requests on different threads, so guard writes with a lock and open a
# fresh connection per call (cheap for sqlite, avoids cross-thread issues).
_lock = threading.Lock()


def _connect():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_db():
    with _lock, _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages (chat_id)"
        )


def _now():
    return datetime.utcnow().isoformat()


def create_chat(title: str = "New Chat") -> dict:
    chat_id = str(uuid.uuid4())
    now = _now()
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (chat_id, title, now, now),
        )
    return {"id": chat_id, "title": title, "created_at": now, "updated_at": now}


def list_chats() -> list:
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at, updated_at FROM chats ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_chat(chat_id: str) -> dict | None:
    with _lock, _connect() as conn:
        row = conn.execute(
            "SELECT id, title, created_at, updated_at FROM chats WHERE id = ?",
            (chat_id,),
        ).fetchone()
    return dict(row) if row else None


def rename_chat(chat_id: str, title: str) -> bool:
    with _lock, _connect() as conn:
        cur = conn.execute(
            "UPDATE chats SET title = ?, updated_at = ? WHERE id = ?",
            (title, _now(), chat_id),
        )
        return cur.rowcount > 0


def delete_chat(chat_id: str) -> bool:
    with _lock, _connect() as conn:
        conn.execute("DELETE FROM messages WHERE chat_id = ?", (chat_id,))
        cur = conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
        return cur.rowcount > 0


def touch_chat(chat_id: str):
    with _lock, _connect() as conn:
        conn.execute(
            "UPDATE chats SET updated_at = ? WHERE id = ?", (_now(), chat_id)
        )


def add_message(chat_id: str, role: str, content: str) -> dict:
    msg_id = str(uuid.uuid4())
    now = _now()
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            (msg_id, chat_id, role, content, now),
        )
        conn.execute(
            "UPDATE chats SET updated_at = ? WHERE id = ?", (now, chat_id)
        )
    return {"id": msg_id, "chat_id": chat_id, "role": role, "content": content, "created_at": now}


def get_messages(chat_id: str, limit: int | None = None) -> list:
    with _lock, _connect() as conn:
        if limit:
            rows = conn.execute(
                """
                SELECT * FROM (
                    SELECT id, chat_id, role, content, created_at
                    FROM messages WHERE chat_id = ?
                    ORDER BY created_at DESC LIMIT ?
                ) ORDER BY created_at ASC
                """,
                (chat_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, chat_id, role, content, created_at FROM messages "
                "WHERE chat_id = ? ORDER BY created_at ASC",
                (chat_id,),
            ).fetchall()
    return [dict(r) for r in rows]


def auto_title_from_text(text: str, max_len: int = 40) -> str:
    text = " ".join(text.strip().split())
    if len(text) <= max_len:
        return text or "New Chat"
    return text[:max_len].rstrip() + "…"
