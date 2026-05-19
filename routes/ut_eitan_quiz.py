import os
import json
import re
import random
from flask import Blueprint, render_template, request, jsonify, session

ut_eitan_quiz_bp = Blueprint(
    'ut_eitan_quiz',
    __name__,
    url_prefix='/ut-eitan-quiz',
    template_folder='../templates'
)

# JSONデータの読み込み関数
def load_data():
    # 実行環境のパスに合わせて調整できるようにする
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    sentences_path = os.path.join(base_dir, 'sentences.json')
    words_path = os.path.join(base_dir, 'words.json')
    
    # 万が一ファイルがない場合のフォールバック（デモデータ）
    if not os.path.exists(sentences_path):
        sentences = [
            {"chapter": "1", "number": "1", "question_number": "1", "sentence": "The researchers [accumulated] hundreds of photographs of irregular plant growth caused by chemical fertilizers."},
            {"chapter": "1", "number": "1", "question_number": "2", "sentence": "An [accumulation] of small misfortunes eventually [led] to the government's collapse."},
            {"chapter": "1", "number": "2", "question_number": "1", "sentence": "Colonialists often see themselves as bringing [civilization] to less fortunate peoples."},
            {"chapter": "1", "number": "2", "question_number": "2", "sentence": "The society which produced the pyramids certainly deserves to be called a [civilization]."},
            {"chapter": "1", "number": "3", "question_number": "1", "sentence": "The moon hoax theory claims that people have never traveled to the moon."}
        ]
    else:
        with open(sentences_path, 'r', encoding='utf-8') as f:
            sentences = json.load(f)
            
    if not os.path.exists(words_path):
        words = [
            {"chapter": "1", "number": "1", "word": "accumulate"},
            {"chapter": "1", "number": "2", "word": "civilization"},
            {"chapter": "1", "number": "3", "word": "claim"}
        ]
    else:
        with open(words_path, 'r', encoding='utf-8') as f:
            words = json.load(f)
            
    return sentences, words

@ut_eitan_quiz_bp.route('/')
def quiz_home():
    sentences, words = load_data()
    
    # クイズとして出題可能な（ブラケット [...] が含まれる）文だけをフィルタリング
    pattern = re.compile(r'\[[a-zA-Z\s\']+\]')
    quiz_pool = []
    
    for s in sentences:
        if pattern.search(s['sentence']):
            quiz_pool.append(s)
            
    if not quiz_pool:
        return "有効なクイズ問題が見つかりませんでした。sentences.json の形式を確認してください。"
    
    # ランダムに1問選択（またはセッションでインデックスを管理することも可能）
    # 今回はシンプルにランダム、またはクエリパラメータで指定できるようにします
    q_idx = request.args.get('q', default=None, type=int)
    if q_idx is None or q_idx < 0 or q_idx >= len(quiz_pool):
        q_idx = random.randint(0, len(quiz_pool) - 1)
        
    question = quiz_pool[q_idx]
    original_sentence = question["sentence"]
    
    # ターゲット（正解となる単語、カッコを除去したもの）を抽出
    # 複数ある場合を考慮（例: ['accumulation', 'led']）
    raw_targets = pattern.findall(original_sentence)
    targets = [re.sub(r'[\[\]]', '', t) for t in raw_targets]
    
    # カッコ部分を [     ] または番号付きの [ 1 ], [ 2 ] に置換
    # フロントエンド側でインプットボックスに置き換えやすいように、特殊マークに変換します
    replaced_sentence = original_sentence
    for i, target in enumerate(raw_targets):
        replaced_sentence = replaced_sentence.replace(target, f"__INPUT_{i}__", 1)
        
    # 画面上部に表示する「原形の英単語（ヒント候補）」の作成
    # 1. 本問の正解に関連する原形単語（words.json から chapter, number で紐付け）
    hint_words = set()
    for w in words:
        if w['chapter'] == question['chapter'] and w['number'] == question['number']:
            hint_words.add(w['word'])
            
    # 2. ダミーの選択肢もいくつか混ぜる（難易度調整用）
    all_words = [w['word'] for w in words]
    dummy_pool = [w for w in all_words if w not in hint_words]
    
    # ダミーから最大3つランダムに選択して追加
    random.shuffle(dummy_pool)
    for dw in dummy_pool[:3]:
        hint_words.add(dw)
        
    hint_list = list(hint_words)
    random.shuffle(hint_list) # 選択肢をシャッフル
    
    # 正解データをセッションに一時保存（簡易的な検証用）
    session['current_targets'] = targets
    session['current_question_idx'] = q_idx
    
    return render_template(
        'ut_eitan_quiz/quiz.html',
        sentence_template=replaced_sentence,
        hints=hint_list,
        targets_count=len(targets),
        chapter=question['chapter'],
        number=question['number'],
        question_number=question['question_number'],
        total_questions=len(quiz_pool),
        current_idx=q_idx
    )

@ut_eitan_quiz_bp.route('/check', methods=['POST'])
def check_answer():
    """解答を判定するAPI endpoint"""
    data = request.get_json() or {}
    user_answers = data.get('answers', [])
    correct_answers = session.get('current_targets', [])
    
    if not correct_answers:
        return jsonify({'error': 'セッションがタイムアウトしたか、問題データが存在しません。'}), 400
        
    results = []
    is_all_correct = True
    
    for i, correct in enumerate(correct_answers):
        # ユーザーの解答（空欄対応）
        user_ans = user_answers[i].strip() if i < len(user_answers) else ""
        
        # 大文字小文字を区別せずに比較
        is_correct = user_ans.lower() == correct.lower()
        if not is_correct:
            is_all_correct = False
            
        results.append({
            'index': i,
            'user_answer': user_ans,
            'correct_answer': correct,
            'is_correct': is_correct
        })
        
    return jsonify({
        'is_all_correct': is_all_correct,
        'results': results
    })
