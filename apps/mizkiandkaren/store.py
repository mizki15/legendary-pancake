"""Private JSON records and compressed photos; no public asset URLs."""

import base64
import hashlib
import hmac
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests


class Unavailable(RuntimeError):
    pass


class Conflict(RuntimeError):
    pass


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def cutoff():
    return (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()


class SQLiteStore:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS mk_ideas (
                    id TEXT PRIMARY KEY, payload TEXT NOT NULL,
                    version INTEGER NOT NULL, deleted_at TEXT
                );
                CREATE TABLE IF NOT EXISTS mk_photos (
                    idea_id TEXT REFERENCES mk_ideas(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL, data BLOB NOT NULL,
                    PRIMARY KEY (idea_id, kind)
                );
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def list(self):
        with self.connection() as db:
            db.execute("DELETE FROM mk_ideas WHERE deleted_at <= ?", (cutoff(),))
            rows = db.execute("SELECT * FROM mk_ideas ORDER BY id").fetchall()
        return [{**dict(row), "payload": json.loads(row["payload"])} for row in rows]

    def save(self, record, expected, photos=None, remove_photos=()):
        with self.connection() as db:
            values = (json.dumps(record["payload"], ensure_ascii=False), record["deleted_at"], record["id"])
            if expected == 0:
                try:
                    db.execute("INSERT INTO mk_ideas(payload,deleted_at,id,version) VALUES(?,?,?,1)", values)
                except sqlite3.IntegrityError:
                    raise Conflict from None
            else:
                cursor = db.execute("UPDATE mk_ideas SET payload=?,deleted_at=?,version=version+1 WHERE id=? AND version=?", (*values, expected))
                if cursor.rowcount != 1:
                    raise Conflict
            for kind in remove_photos:
                db.execute("DELETE FROM mk_photos WHERE idea_id=? AND kind=?", (record["id"], kind))
            for kind, photo in (photos or {}).items():
                db.execute("INSERT INTO mk_photos(idea_id,kind,data) VALUES(?,?,?) ON CONFLICT(idea_id,kind) DO UPDATE SET data=excluded.data", (record["id"], kind, photo))
        return {**record, "version": expected + 1}

    def photo(self, idea_id, kind):
        with self.connection() as db:
            row = db.execute("SELECT data FROM mk_photos p JOIN mk_ideas i ON i.id=p.idea_id WHERE idea_id=? AND kind=? AND (i.deleted_at IS NULL OR i.deleted_at > ?)", (idea_id, kind, cutoff())).fetchone()
        return row["data"] if row else None


class GoogleStore:
    def __init__(self, url, secret):
        self.url = url
        self.secret = secret

    def request(self, action, **values):
        payload = base64.b64encode(json.dumps({"action": action, **values}, ensure_ascii=False, separators=(",", ":")).encode()).decode("ascii")
        timestamp, nonce = str(int(time.time())), uuid.uuid4().hex
        message = f"{timestamp}\n{nonce}\n{payload}"
        signature = hmac.new(self.secret.encode(), message.encode(), hashlib.sha256).hexdigest()
        try:
            response = requests.post(self.url, json={"timestamp": timestamp, "nonce": nonce, "payload": payload, "signature": signature}, timeout=(5, 40))
        except requests.RequestException:
            raise Unavailable from None
        if not response.ok:
            raise Unavailable
        try:
            result = response.json()
            if result.get("error") == "conflict":
                raise Conflict
            if not result.get("ok"):
                raise Unavailable
            return result["result"]
        except (ValueError, KeyError, AttributeError):
            raise Unavailable from None

    def list(self):
        rows = self.request("list")
        if not isinstance(rows, list):
            raise Unavailable
        return [row for row in rows if not row["deleted_at"] or row["deleted_at"] > cutoff()]

    def save(self, record, expected, photos=None, remove_photos=()):
        result = self.request("save", record=record, expected=expected, remove_photos=list(remove_photos), photos={kind: base64.b64encode(photo).decode("ascii") for kind, photo in (photos or {}).items()})
        if not isinstance(result, dict):
            raise Unavailable
        return result

    def photo(self, idea_id, kind):
        data = self.request("photo", id=idea_id, kind=kind)
        try:
            return base64.b64decode(data, validate=True) if data else None
        except (ValueError, TypeError):
            raise Unavailable from None
