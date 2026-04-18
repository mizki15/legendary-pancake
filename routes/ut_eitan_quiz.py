from flask import Blueprint, render_template, request, session
import random
import re

# Blueprint定義
quiz_bp = Blueprint('quiz', __name__)

# データ
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

# 問題表示
@quiz_bp.route("/")
def index():
    # 正解の文を先に決める
    sentence = random.choice(sentence_list)
    correct_word = sentence[2]

    # 正解 + ダミー5個（←重要改善）
    dummy_words = [w for w in words_list if w[1] != correct_word]
    choices = random.sample(dummy_words, 5)
    choices.append((None, correct_word))
    random.shuffle(choices)

    # 空欄化
    display_sentence = re.sub(r"\[.*?\]", "_____", sentence[3])

    # セッション保存
    session["answer"] = correct_word

    return render_template(
        "index.html",
        words=choices,
        sentence=display_sentence
    )

# 回答処理
@quiz_bp.route("/answer", methods=["POST"])
def answer():
    user_input = request.form["answer"]
    correct = session.get("answer")

    if user_input.strip().lower() == correct.lower():
        result = "○"
    else:
        result = f"× (正解: {correct})"

    return render_template("result.html", result=result)
