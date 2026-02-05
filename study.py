import csv
import requests
from flask import Blueprint, render_template, jsonify, request

# Blueprintの設定
study_bp = Blueprint('study', __name__)

CSV_FILE = 'words.csv'
GAS_URL = 'https://script.google.com/macros/s/AKfycbxP5DgHlp_5CjSird3b3rLBJfczItCkpbpIHI8ib8MLNDtu_r2GVipaJW3VY_P5Ut5t0g/exec'

def fetch_words():
    words = []
    try:
        with open(CSV_FILE, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            words = list(reader)
    except FileNotFoundError:
        pass
    return words

@study_bp.route('/study')
def study_page():
    return render_template('study.html')

@study_bp.route('/api/get_word')
def get_word():
    # 1. GASから現在の進捗を取得
    res = requests.get(GAS_URL)
    current_index = res.json().get('index', 0)
    
    # 2. CSV読み込み
    words = fetch_words()
    
    if current_index < len(words):
        return jsonify({
            'id': words[current_index][0],
            'en': words[current_index][1],
            'jp': words[current_index][2],
            'index': current_index,
            'total': len(words)
        })
    return jsonify({'error': 'Finished'})

@study_bp.route('/api/submit', methods=['POST'])
def submit():
    data = request.json # {status, word_id, current_index}
    
    # GASへ進捗更新と単語記録をまとめて送信
    payload = {
        'next_index': data['current_index'] + 1,
        'word_id': data['word_id'],
        'status': data['status']
    }
    requests.post(GAS_URL, json=payload)
    
    return jsonify({'status': 'ok'})
