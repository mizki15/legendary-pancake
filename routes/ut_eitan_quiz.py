import json
import random
from flask import Blueprint, render_template, request, jsonify

# Blueprintの定義（環境に合わせて名前などは調整してください）
ut_eitan_quiz_bp = Blueprint('ut_eitan_quiz', __name__)

def load_data():
    """データをロードする関数（パスは環境に合わせて変更してください）"""
    with open('data/questions.json', 'r', encoding='utf-8') as f:
        questions = json.load(f)
    with open('data/words.json', 'r', encoding='utf-8') as f:
        words = json.load(f)
    return questions, words


@ut_eitan_quiz_bp.route('/ut-eitan-quiz/')
def quiz_home():
    questions, words = load_data()
    
    # クエリパラメータから現在の問題インデックスを取得
    q_idx_str = request.args.get('q', '0')
    try:
        current_idx = int(q_idx_str)
    except ValueError:
        current_idx = 0
        
    if current_idx < 0 or current_idx >= len(questions):
        current_idx = 0

    question = questions[current_idx]
    
    # 問題データから変数を取り出し（※お使いのJsonのキー名に合わせてください）
    sentence_template = question['sentence_template']
    targets = question['targets']  # 空欄に入る実際の答え（活用形など）のリスト
    targets_count = len(targets)
    
    # ========================================================
    # 【アプローチ2対応】ヒント単語の抽出ロジック（常にぴったり10語）
    # ========================================================
    
    # 1. 現在の問題と同じChapter/Numberに属する単語（正解の原形候補）をすべて抽出
    correct_hints = set()
    for w in words:
        if str(w['chapter']) == str(question['chapter']) and str(w['number']) == str(question['number']):
            # アプローチ2: w['words'] はリストなので update() でセットに一括追加
            correct_hints.update(w['words'])
            
    # 2. ダミー単語のプールを作成（すべての単語から正解セクションのヒントを除外）
    all_words = set()
    for w in words:
        all_words.update(w['words'])  # すべての単語をセットに集める
        
    dummy_pool = [dw for dw in all_words if dw not in correct_hints]
    random.shuffle(dummy_pool)
    
    # 3. 常に10語ぴったりになるように調整
    hint_set = set(correct_hints)
    
    if len(hint_set) > 10:
        # 【ケースA】同じセクションの単語だけで10語を超えている場合
        # 空欄の答え（活用形）の文字列と部分一致するものを優先して10語に絞り込む
        target_lowers = [t.lower() for t in targets]
        priority_hints = []
        other_hints = []
        
        for h in hint_set:
            h_lower = h.lower()
            if any(h_lower in t or t in h_lower for t in target_lowers):
                priority_hints.append(h)
            else:
                other_hints.append(h)
        
        final_hints = priority_hints + other_hints
        hint_list = final_hints[:10]
        
    else:
        # 【ケースB】10語に満たない場合（通常はこちら）
        # ぴったり10語になるまで、シャッフルしたダミープールから単語を補充
        for dw in dummy_pool:
            if len(hint_set) >= 10:
                break
            hint_set.add(dw)
        hint_list = list(hint_set)
        
    # 4. 最後に順番をランダムにシャッフル（正解の位置をバラバラにする）
    random.shuffle(hint_list)
    
    # ========================================================

    # サイドバー用のツリー構造を作るロジック（既存のものを維持）
    sidebar_tree = {}
    for idx, q in enumerate(questions):
        ch = q['chapter']
        sec = q['number']
        if ch not in sidebar_tree:
            sidebar_tree[ch] = {}
        if sec not in sidebar_tree[ch]:
            sidebar_tree[ch][sec] = []
        sidebar_tree[ch][sec].append({
            'idx': idx,
            'q_num': q.get('question_number', idx + 1)
        })

    return render_template(
        'ut_eitan_quiz/quiz.html',
        sentence_template=sentence_template,
        targets_count=targets_count,
        current_idx=current_idx,
        total_questions=len(questions),
        chapter=question['chapter'],
        number=question['number'],
        question_number=question.get('question_number', current_idx + 1),
        hints=hint_list,  # 画面に渡す10語のヒント
        sidebar_tree=sidebar_tree
    )
