import hashlib
import hmac
import io
import json
import os
import re
import secrets
import threading
import time
import uuid
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

from flask import Blueprint, current_app, g, jsonify, redirect, render_template, request, send_file, url_for
from itsdangerous import BadSignature, URLSafeTimedSerializer
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.security import check_password_hash

from .domain import Invalid, compress_photo, validate_idea
from .photo_cache import PhotoCache
from .store import Conflict, GoogleStore, SQLiteStore, Unavailable, now_iso
from .supabase_store import SupabaseStore

mizkiandkaren_bp = Blueprint("mizkiandkaren", __name__, url_prefix="/mizkiandkaren", template_folder="templates", static_folder="static")
COOKIE = "mk_journal"
LOGIN_COOKIE = "mk_login"
PHOTO_KINDS = ("idea", "memory")
attempts = defaultdict(list)
attempt_lock = threading.Lock()
photo_cache = PhotoCache()


def config(name):
    return current_app.config.get(name, os.environ.get(name, ""))


def photo_namespace():
    # Never reuse a photo when the configured Google account or local database changes.
    values = tuple(config(name) for name in ("MIZKI_KAREN_LOCAL_DB", "MIZKI_KAREN_GAS_URL", "MIZKI_KAREN_GAS_SECRET", "MIZKI_KAREN_SECRET_KEY", "MIZKI_KAREN_STORAGE", "MIZKI_KAREN_SUPABASE_URL", "MIZKI_KAREN_SUPABASE_KEY")) + (os.environ.get("RENDER", ""),)
    return hashlib.sha256("\0".join(values).encode()).hexdigest()


def signer():
    secret = config("MIZKI_KAREN_SECRET_KEY")
    password_hash = config("MIZKI_KAREN_PASSPHRASE_HASH")
    if len(secret) < 32 or not password_hash:
        return None
    return URLSafeTimedSerializer(secret, salt="mk-journal-" + hashlib.sha256(password_hash.encode()).hexdigest())


def secure_cookie():
    return not config("MIZKI_KAREN_LOCAL_DB") or bool(os.environ.get("RENDER"))


def set_cookie(response, name, value, age):
    response.set_cookie(name, value, max_age=age, httponly=True, secure=secure_cookie(), samesite="Lax", path="/mizkiandkaren")


def authenticated():
    serializer = signer()
    if serializer is None:
        return None
    try:
        value = serializer.loads(request.cookies.get(COOKIE, ""), max_age=30 * 86400)
        if not isinstance(value, dict) or not isinstance(value.get("csrf"), str):
            return None
        serializer.loads(request.cookies.get(COOKIE, ""), max_age=(30 * 86400 if value.get("remember") else 12 * 3600))
        return value
    except BadSignature:
        return None


def same_origin():
    origin = request.headers.get("Origin")
    if origin and origin != request.host_url.rstrip("/"):
        # Render terminates TLS before forwarding to gunicorn.
        public = config("MIZKI_KAREN_PUBLIC_ORIGIN").rstrip("/")
        if origin != public and not (secure_cookie() and origin == "https://" + request.host):
            return False
    return request.headers.get("Sec-Fetch-Site") != "cross-site"


@mizkiandkaren_bp.before_request
def protect():
    g.journal_auth = None
    if request.endpoint == "mizkiandkaren.static":
        return
    request.max_content_length = 26_000_000
    if request.method not in ("GET", "HEAD", "OPTIONS") and not same_origin():
        return jsonify(error="このページからもう一度操作してください。"), 403
    if request.endpoint == "mizkiandkaren.login":
        return
    g.journal_auth = authenticated()
    if not g.journal_auth:
        if "/api/" in request.path or "/photos/" in request.path:
            return jsonify(error="合言葉を入力して、もう一度ログインしてください。"), 401
        return redirect(url_for("mizkiandkaren.login", next=request.path))
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        token = request.headers.get("X-CSRF-Token", "") or request.form.get("csrf", "")
        if not hmac.compare_digest(token.encode(), g.journal_auth["csrf"].encode()):
            return jsonify(error="ページを開き直してから、もう一度操作してください。"), 403


@mizkiandkaren_bp.after_request
def private_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    if request.endpoint != "mizkiandkaren.static":
        if request.endpoint != "mizkiandkaren.photo" or response.status_code not in (200, 304):
            response.headers["Cache-Control"] = "no-store, private"
        response.headers["Vary"] = "Cookie"
    return response


@mizkiandkaren_bp.route("/login", methods=["GET", "POST"])
def login():
    serializer = signer()
    if serializer is None:
        return render_template("mizkiandkaren/login.html", configured=False, error="ただいま準備中です。少し待ってから開き直してください。"), 503
    if authenticated():
        return redirect(url_for("mizkiandkaren.home"))
    error, status = "", 200
    next_path = request.values.get("next", "")
    if next_path not in ("/mizkiandkaren/", "/mizkiandkaren/date_idea"):
        next_path = url_for("mizkiandkaren.home")
    if request.method == "POST":
        token = request.form.get("login_token", "")
        try:
            if not hmac.compare_digest(token.encode(), request.cookies.get(LOGIN_COOKIE, "").encode()):
                raise BadSignature("mismatch")
            serializer.loads(token, salt="login", max_age=3600)
        except BadSignature:
            error, status = "ページを開き直してから、もう一度入力してください。", 403
        if not error:
            now = time.monotonic()
            address = request.remote_addr or "unknown"
            with attempt_lock:
                for key in list(attempts):
                    attempts[key] = [t for t in attempts[key] if t > now - 900]
                    if not attempts[key]:
                        del attempts[key]
                limited = len(attempts[address]) >= 10
                if not limited:
                    attempts[address].append(now)
            password = request.form.get("passphrase", "")
            if limited:
                error, status = "入力回数が多いため、15分ほど待ってから試してください。", 429
            elif len(password) > 512 or not check_password_hash(config("MIZKI_KAREN_PASSPHRASE_HASH"), password):
                error, status = "合言葉が違うようです。もう一度入力してください。", 401
            else:
                with attempt_lock:
                    attempts.pop(address, None)
                remember = request.form.get("remember") == "on"
                response = redirect(next_path)
                set_cookie(response, COOKIE, serializer.dumps({"csrf": secrets.token_urlsafe(32), "remember": remember}), 30 * 86400 if remember else 12 * 3600)
                response.delete_cookie(LOGIN_COOKIE, path="/mizkiandkaren")
                return response
    token = serializer.dumps(secrets.token_urlsafe(24), salt="login")
    response = current_app.make_response((render_template("mizkiandkaren/login.html", configured=True, error=error, login_token=token, next_path=next_path), status))
    set_cookie(response, LOGIN_COOKIE, token, 3600)
    if status == 429:
        response.headers["Retry-After"] = "900"
    return response


@mizkiandkaren_bp.post("/logout")
def logout():
    response = redirect(url_for("mizkiandkaren.login"))
    response.delete_cookie(COOKIE, path="/mizkiandkaren")
    return response


@mizkiandkaren_bp.get("/")
def home():
    start = None
    try:
        value = datetime.fromisoformat(config("MIZKI_KAREN_ANNIVERSARY_START"))
        if value.tzinfo is not None:
            start = value.astimezone(ZoneInfo("Asia/Tokyo"))
    except (TypeError, ValueError):
        pass
    return render_template("mizkiandkaren/home.html", csrf=g.journal_auth["csrf"], page="home", anniversary_start=start)


@mizkiandkaren_bp.get("/date_idea")
def date_ideas():
    return render_template("mizkiandkaren/ideas.html", csrf=g.journal_auth["csrf"], page="ideas")


def store():
    local = config("MIZKI_KAREN_LOCAL_DB")
    if local and not os.environ.get("RENDER"):
        return SQLiteStore(local)
    url, secret = config("MIZKI_KAREN_GAS_URL"), config("MIZKI_KAREN_GAS_SECRET")
    if not re.fullmatch(r"https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec", url) or len(secret) < 32:
        raise Unavailable
    google = GoogleStore(url, secret)
    backend = config("MIZKI_KAREN_STORAGE") or "google"
    if backend == "google":
        return google
    if backend != "supabase":
        raise Unavailable
    supabase_url = config("MIZKI_KAREN_SUPABASE_URL").rstrip("/")
    key = config("MIZKI_KAREN_SUPABASE_KEY")
    if not re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co", supabase_url) or len(key) < 32:
        raise Unavailable
    return SupabaseStore(supabase_url, key, google)


def find_record(storage, idea_id):
    row = storage.get(idea_id) if hasattr(storage, "get") else next((row for row in storage.list() if row["id"] == idea_id), None)
    if not row:
        raise Invalid("このデート案は見つかりません。画面を更新してください。")
    return row


def public_record(record):
    result = {**record["payload"], "id": record["id"], "version": record["version"], "deleted_at": record["deleted_at"]}
    for kind in PHOTO_KINDS:
        result[f"{kind}_photo_url"] = url_for("mizkiandkaren.photo", idea_id=record["id"], kind=kind, v=record["version"]) if result.get(f"has_{kind}_photo") else None
    return result


@mizkiandkaren_bp.get("/api/ideas")
def list_ideas():
    rows = store().list()
    photo_cache.reconcile(photo_namespace(), rows)
    return jsonify(ideas=[public_record(row) for row in rows])


def read_form():
    if request.is_json:
        data = request.get_json(silent=True)
    else:
        try:
            data = json.loads(request.form.get("data", ""))
        except ValueError:
            data = None
    if not isinstance(data, dict):
        raise Invalid("保存する内容を確認してください。")
    version = data.pop("version", 0)
    if type(version) is not int or version < 0:
        raise Invalid("画面を更新してから、もう一度操作してください。")
    removes = data.pop("remove_photos", [])
    if not isinstance(removes, list) or any(kind not in PHOTO_KINDS for kind in removes):
        raise Invalid("写真の指定を確認してください。")
    photos = {}
    if set(request.files) - {"idea_photo", "memory_photo"} or any(len(request.files.getlist(key)) > 1 for key in request.files):
        raise Invalid("写真は案と達成記録に1枚ずつ選んでください。")
    for kind in PHOTO_KINDS:
        upload = request.files.get(f"{kind}_photo")
        if upload and upload.filename:
            photos[kind] = compress_photo(upload)
    return data, version, removes, photos


@mizkiandkaren_bp.post("/api/ideas")
def create_idea():
    data, version, removes, photos = read_form()
    if version:
        raise Invalid("新しい案の入力を確認してください。")
    payload = validate_idea(data)
    payload.update(created_at=now_iso(), updated_at=now_iso())
    for kind in PHOTO_KINDS:
        payload[f"has_{kind}_photo"] = kind in photos
    row = {"id": str(uuid.uuid4()), "payload": payload, "deleted_at": None}
    saved = store().save(row, 0, photos, removes)
    photo_cache.invalidate(photo_namespace(), row["id"])
    return jsonify(idea=public_record(saved)), 201


@mizkiandkaren_bp.patch("/api/ideas/<uuid:idea_id>")
def edit_idea(idea_id):
    data, version, removes, photos = read_form()
    storage = store()
    row = find_record(storage, str(idea_id))
    if row["deleted_at"]:
        raise Invalid("ゴミ箱から戻してから編集してください。")
    row["payload"] = validate_idea(data, row["payload"])
    row["payload"]["updated_at"] = now_iso()
    for kind in PHOTO_KINDS:
        if kind in removes:
            row["payload"][f"has_{kind}_photo"] = False
        if kind in photos:
            row["payload"][f"has_{kind}_photo"] = True
    saved = storage.save(row, version, photos, removes)
    photo_cache.invalidate(photo_namespace(), row["id"])
    return jsonify(idea=public_record(saved))


@mizkiandkaren_bp.post("/api/ideas/<uuid:idea_id>/<action>")
def move_idea(idea_id, action):
    if action not in ("trash", "restore"):
        return jsonify(error="操作が見つかりません。"), 404
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        raise Invalid("操作する内容を確認してください。")
    version = data.get("version")
    if type(version) is not int or version < 1:
        raise Invalid("画面を更新してから、もう一度操作してください。")
    storage = store()
    row = find_record(storage, str(idea_id))
    if action == "trash" and row["deleted_at"]:
        raise Conflict
    row["deleted_at"] = now_iso() if action == "trash" else None
    row["payload"]["updated_at"] = now_iso()
    saved = storage.save(row, version)
    photo_cache.invalidate(photo_namespace(), row["id"])
    return jsonify(idea=public_record(saved))


@mizkiandkaren_bp.get("/photos/<uuid:idea_id>/<kind>")
def photo(idea_id, kind):
    if kind not in PHOTO_KINDS:
        return "", 404
    version = request.args.get("v", "")
    key = (photo_namespace(), str(idea_id), kind, version) if re.fullmatch(r"[0-9]{1,18}", version) else None
    data = photo_cache.get(key) if key else None
    if data is None:
        data = store().photo(str(idea_id), kind)
        if data is not None and key:
            photo_cache.put(key, data)
    if data is None:
        return "", 404
    response = send_file(io.BytesIO(data), mimetype="image/webp", download_name="memory.webp", etag=hashlib.sha256(data).hexdigest(), conditional=True, max_age=0)
    # A cached browser image must still pass authentication before receiving 304.
    response.headers["Cache-Control"] = "private, no-cache, max-age=0, must-revalidate"
    return response


@mizkiandkaren_bp.errorhandler(Invalid)
def invalid(error):
    return jsonify(error=str(error)), 400


@mizkiandkaren_bp.errorhandler(Conflict)
def conflict(error):
    return jsonify(error="別の端末で変更されています。最新の内容を確認してから、もう一度保存してください。", conflict=True), 409


@mizkiandkaren_bp.errorhandler(Unavailable)
def unavailable(error):
    return jsonify(error="保存先につながりませんでした。少し待って画面を更新し、反映されているか確認してください。"), 503


@mizkiandkaren_bp.errorhandler(RequestEntityTooLarge)
def too_large(error):
    return jsonify(error="写真は1枚12MB以内にして、もう一度選んでください。"), 413
