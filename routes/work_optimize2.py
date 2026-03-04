from flask import Blueprint, request, send_file, render_template
import io
import csv
import zoneinfo
from datetime import datetime
from dotenv import load_dotenv

# Blueprintの定義
work_optimize2_bp = Blueprint('work_optimize2', __name__)

# .env の読み込み
load_dotenv()

def transform_data_to_rows(form_data):
    """
    フォームデータを解析し、CSV用の行リストを作成する
    """
    # 便番号を改行で分割し、空行を除去
    flight_number_raw = form_data.get("flight_number", "")
    flight_numbers = [line.strip() for line in flight_number_raw.splitlines() if line.strip()]
    
    if not flight_numbers:
        flight_numbers = [""]

    route = form_data.get("routes", "")
    sale_from = form_data.get("sale_from", "")
    sale_to = form_data.get("sale_to", "")
    flight_from = form_data.get("flight_from", "")
    flight_to = form_data.get("flight_to", "")
    day = form_data.get("day", "")
    airport = form_data.get("airport", "")
    participants = form_data.get("participants", "")

    # 利益率の取得
    def get_profits(type_name):
        raw_list = form_data.getlist(f"profit_{type_name}[]")
        # 7要素にパディング
        profits = [ (v if v else "0") for v in raw_list ]
        while len(profits) < 7:
            profits.append("0")
        
        # 全曜日適用チェック
        if form_data.get(f"profit_{type_name}_allweek") == "1":
            return [profits[0]] * 7
        return profits[:7]

    adult_profits = get_profits("adult")
    child_profits = get_profits("child")
    infant_profits = get_profits("infant")

    youbi_list = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
    participants_map = {"1": "1人", "2": "2人以上", "全て": "全て"}
    participants_disp = participants_map.get(participants, participants)

    # 作成日時 JST
    JST = zoneinfo.ZoneInfo("Asia/Tokyo")
    now_str = datetime.now(JST).strftime("%Y/%m/%d %H:%M:%S")

    row_list = []
    # 各便番号ごとに7曜日分の行を生成
    for f_num in flight_numbers:
        for idx, youbi in enumerate(youbi_list):
            row_list.append([
                f_num, route, sale_from, sale_to, flight_from, flight_to,
                day, airport, participants_disp, now_str, youbi,
                adult_profits[idx], child_profits[idx], infant_profits[idx]
            ])
    
    return row_list

@work_optimize2_bp.route("/work_optimize2")
def index():
    return render_template("work_optimize2.html")

@work_optimize2_bp.route("/convert", methods=["POST"])
def convert():
    # 1. データの変換（行リストの作成）
    csv_rows = transform_data_to_rows(request.form)

    # 2. CSVの書き込み（work_optimize1.py と同じフロー）
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    
    # ヘッダーの書き込み
    writer.writerow([
        "便番号","路線","販売期間(From)","販売期間(To)",
        "搭乗期間(From)","搭乗期間(To)","日数","発空港コード",
        "参加者","作成日時","曜日","大人利益率","子供利益率","幼児利益率"
    ])
    
    # データ行の書き込み
    for row in csv_rows:
        writer.writerow(row)
    
    # ポインタを先頭に戻し、Shift_JISでエンコードして送信
    output.seek(0)
    return send_file(
        io.BytesIO(output.getvalue().encode("shift_jis", errors="replace")),
        mimetype="text/csv",
        as_attachment=True,
        download_name="converted.csv",
    )
