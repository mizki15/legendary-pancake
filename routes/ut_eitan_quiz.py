from flask import Blueprint, render_template, request, session
import random
import re
import csv
import os

# =========================
# パス設定
# =========================
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# =========================
# CSV読み込み
# =========================
def load_words():
    path = os.path.join(BASE_DIR, "static", "words.csv")
    words = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            words.append((int(row["id"]), row["word"]))
    return words


def load_sentences():
    path = os.path.join(BASE_DIR, "static", "sentences.csv")
    sentences = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sentences.append((
                int(row["id"]),
                int(row["word_id"]),
                row["conjugated"],
                row["sentence"]
            ))
    return sentences


# =========================
# データを起動時に1回読み込み（重要）
# =========================
WORDS_LIST = load_words()
SENTENCE_LIST = load_sentences()

# =========================
# Blueprint
# =========================
ut_eitan_quiz_bp = Blueprint(
    'ut_eitan_quiz',
    __name__,
    url_prefix="/ut_eitan_quiz"
)

# =========================
# メイン処理
# =========================
@ut_eitan_quiz_bp.route("/", methods=["GET", "POST"])
def index():
    result = None

    # ---------------------
    # POST（回答処理）
    # ---------------------
    if request.method == "POST":
        user_input = request.form.get("answer", "")
        correct_word = session.get("answer")
        sentence = session.get("sentence")

        if not correct_word or not sentence:
            # セッション切れ対策
            return "セッションが切れました。ページを再読み込みしてください。"

        if user_input.strip().lower() == correct_word.lower():
            result = "○"
        else:
            result = f"✗ 正解: {correct_word}"

    # ---------------------
    # GET（新しい問題生成）
    # ---------------------
    if request.method == "GET":
        sentence = random.choice(SENTENCE_LIST)
        correct_word = sentence[2]

        session["sentence"] = sentence
        session["answer"] = correct_word

    # ---------------------
    # 表示用データ取得
    # ---------------------
    sentence = session.get("sentence")
    correct_word = session.get("answer")

    if not sentence or not correct_word:
        return "データ取得エラー"

    # ダミー単語作成
    dummy_words = [w for w in WORDS_LIST if w[1] != correct_word]
    choices = random.sample(dummy_words, min(5, len(dummy_words)))
    choices.append((None, correct_word))
    random.shuffle(choices)

    # 空欄化
    display_sentence = re.sub(r"\[.*?\]", "_____", sentence[3])

    return render_template(
        "quiz.html",
        words=choices,
        sentence=display_sentence,
        result=result
    )
