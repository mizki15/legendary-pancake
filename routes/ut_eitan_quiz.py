from flask import Blueprint, render_template, request, session
import random
import re
import csv
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load_words():
    path = os.path.join(BASE_DIR, "statics", "words.csv")
    words = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            words.append((int(row["id"]), row["word"]))
    return words

def load_sentences():
    path = os.path.join(BASE_DIR, "statics", "sentences.csv")
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

ut_eitan_quiz_bp = Blueprint(
    'ut_eitan_quiz',
    __name__,
    url_prefix="/ut_eitan_quiz"
)

words_list = [
    (1, "go"),
    (2, "eat"),
    (3, "play"),
    (4, "run"),
    (5, "study"),
    (6, "write"),
    (7, "read"),
]

sentence_list = [
    (1, 1, "went", "I [went] to school yesterday."),
    (2, 2, "ate", "She [ate] an apple."),
    (3, 3, "played", "They [played] soccer."),
]

@ut_eitan_quiz_bp.route("/", methods=["GET", "POST"])
def index():
    result = None
    correct = None

    # POST → 回答判定
    if request.method == "POST":
        user_input = request.form["answer"]
        correct = session.get("answer")

        if user_input.strip().lower() == correct.lower():
            result = "○"
        else:
            result = f"✗ 正解: {correct}"

    # 新しい問題を生成（毎回）
    sentence = random.choice(sentence_list)
    correct_word = sentence[2]

    dummy_words = [w for w in words_list if w[1] != correct_word]
    choices = random.sample(dummy_words, min(5, len(dummy_words)))
    choices.append((None, correct_word))
    random.shuffle(choices)

    display_sentence = re.sub(r"\[.*?\]", "_____", sentence[3])

    session["answer"] = correct_word

    return render_template(
        "ut_eitan_quiz.html",
        words=choices,
        sentence=display_sentence,
        result=result
    )
