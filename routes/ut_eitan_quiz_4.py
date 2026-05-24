import os
import json
import re
import random
from flask import Blueprint, render_template, request, jsonify, session

ut_eitan_quiz_bp_4 = Blueprint(
    'ut_eitan_quiz_4',
    __name__,
    url_prefix='/ut-eitan-quiz-2',
    template_folder='../templates'
)

# JSONデータの読み込み関数
def load_data():
    # 実行環境のパスに合わせて調整できるようにする
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    sentences_path = os.path.join(base_dir, 'sentences_4.json')
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
        # 【修正】フォールバック用デモデータも配列形式 ("words") に修正
        words = [
            {"chapter": "1", "number": "1", "words": ["accumulate"]},
            {"chapter": "1", "number": "2", "words": ["civilization"]},
            {"chapter": "1", "number": "3", "words": ["claim"]}
        ]
    else:
        with open(words_path, 'r', encoding='utf-8') as f:
            words = json.load(f)
            
    return sentences, words


@ut_eitan_quiz_bp_4.route('/')
def quiz_home():
    sentences, words = load_data()
    
    pattern = re.compile(r'\[[a-zA-Z\s\']+\]')
    quiz_pool = []
    
    # 1. 出題可能な問題をプール
    for s in sentences:
        if pattern.search(s['sentence']):
            quiz_pool.append(s)
            
    if not quiz_pool:
        return "有効なクイズ問題が見つかりませんでした。"
    
    # 2. サイドバー用の階層構造ツリーを作る
    sidebar_tree = {}
    for idx, q in enumerate(quiz_pool):
        ch = q['chapter']
        num = q['number']
        q_num = q['question_number']
        
        if ch not in sidebar_tree:
            sidebar_tree[ch] = {}
        if num not in sidebar_tree[ch]:
            sidebar_tree[ch][num] = []
            
        sidebar_tree[ch][num].append({
            'idx': idx,
            'q_num': q_num
        })

    # 3. 現在の問題インデックスを取得
    q_idx = request.args.get('q', default=None, type=int)
    if q_idx is None or q_idx < 0 or q_idx >= len(quiz_pool):
        q_idx = random.randint(0, len(quiz_pool) - 1)
        
    question = quiz_pool[q_idx]
    original_sentence = question["sentence"]
    
    raw_targets = pattern.findall(original_sentence)
    targets = [re.sub(r'[\[\]]', '', t) for t in raw_targets]
    
    replaced_sentence = original_sentence
    for i, target in enumerate(raw_targets):
        replaced_sentence = replaced_sentence.replace(target, f"__INPUT_{i}__", 1)
        
    # ========================================================
    # 【修正方法A対応】ヒント単語の抽出ロジック（常にぴったり10語）
    # ========================================================
    
    # 1. 現在の問題と同じChapter/Numberに属する単語（正解の原形候補）をすべて抽出
    correct_hints = set()
    for w in words:
        if str(w['chapter']) == str(question['chapter']) and str(w['number']) == str(question['number']):
            # w['words'] 内の要素を update() で一括展開して追加
            correct_hints.update(w['words'])
            
    # 2. ダミー単語のプール（正解セクションに含まれない他のすべての単語）を作成
    all_words = set()
    for w in words:
        all_words.update(w['words'])
        
    dummy_pool = [dw for dw in all_words if dw not in correct_hints]
    random.shuffle(dummy_pool)
    
    # 3. 常に10語ぴったりになるように調整
    hint_set = set(correct_hints)
    
    if len(hint_set) > 10:
        # 【ケースA】同じセクションの単語だけで10語を超えている場合
        # 今回の空欄（targets）に使われている単語と関連性が高いものを優先して10語に絞り込む
        target_lowers = [t.lower() for t in targets]
        priority_hints = []
        other_hints = []
        
        for h in hint_set:
            h_lower = h.lower()
            if any(h_lower in t or t in h_lower for t in target_lowers):
                priority_hints.append(h)
            else:
                other_hints.append(h)
        
        # 優先度の高い順に並べ替えて先頭から10語を取得
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
        
    # 4. 最後に順番をランダムにシャッフル（正解がどこにあるか分からなくするため）
    random.shuffle(hint_list)
    
    # === 修正ここまで ===
    
    session['current_targets'] = targets
    
    # 4. sidebar_tree を追加してレンダリング
    return render_template(
        'ut_eitan_quiz/quiz.html',
        sentence_template=replaced_sentence,
        hints=hint_list,
        targets_count=len(targets),
        chapter=question['chapter'],
        number=question['number'],
        question_number=question['question_number'],
        total_questions=len(quiz_pool),
        current_idx=q_idx,
        sidebar_tree=sidebar_tree
    )

@ut_eitan_quiz_bp_4.route('/check', methods=['POST'])
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