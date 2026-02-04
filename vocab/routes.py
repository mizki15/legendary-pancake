# vocab/routes.py
import csv, json, os, requests
from flask import Blueprint, jsonify, request, render_template

vocab_bp = Blueprint(
    "vocab",
    __name__,
    url_prefix="/vocab",
    template_folder="../templates",
    static_folder="../static"
)

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

WORDS_FILE = os.path.join(DATA_DIR, "words.csv")
PROGRESS_FILE = os.path.join(DATA_DIR, "vocab_progress.json")

GAS_URL = "https://script.google.com/macros/s/XXXXX/exec"
GAS_TOKEN = "SECRET_TOKEN"

if not os.path.exists(PROGRESS_FILE):
    with open(PROGRESS_FILE, "w") as f:
        json.dump({"index": 0}, f)


@vocab_bp.route("/vocab")
def vocab_page():
    return render_template("vocab.html")


@vocab_bp.route("/api/words")
def vocab_words():
    words = []
    with open(WORDS_FILE, encoding="utf-8") as f:
        for r in csv.reader(f):
            if len(r) >= 3:
                words.append({
                    "num": int(r[0]),
                    "en": r[1],
                    "jp": r[2]
                })
    return jsonify(words)


@vocab_bp.route("/api/progress", methods=["GET", "POST"])
def vocab_progress():
    if request.method == "GET":
        return jsonify(json.load(open(PROGRESS_FILE)))
    idx = request.json.get("index", 0)
    json.dump({"index": idx}, open(PROGRESS_FILE, "w"))
    return jsonify(ok=True)


@vocab_bp.route("/api/unknown", methods=["POST"])
def vocab_unknown():
    payload = request.json
    payload["token"] = GAS_TOKEN
    requests.post(GAS_URL, json=payload, timeout=5)
    return jsonify(ok=True)