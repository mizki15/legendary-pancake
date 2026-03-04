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

@work_optimize2_bp.route("/work_optimize2")
def index():
    return render_template("work_optimize2.html")

@work_optimize2_bp.route("/convert", methods=["POST"])
def convert():
    print("\n--- [DEBUG] 変換処理を開始します ---")

    # 1. フォームデータの取得とデバッグ表示
    flight_number_raw = request.form.get("flight_number", "")
    print(f"[DEBUG] 受信した便番号(raw):\n{flight_number_raw}")

    flight_numbers = [line.strip() for line in flight_number_raw.splitlines() if line.strip()]
    print(f"[DEBUG] 分割後の便番号リスト: {flight_numbers}")

    route = request.form.get("routes", "")
    sale_from = request.form.get("sale_from", "")
    sale_to = request.form.get("sale_to", "")
    flight_from = request.form.get("flight_from", "")
    flight_to = request.form.get("flight_to", "")
    day = request.form.get("day", "")
    airport = request.form.get("airport", "")
    participants = request.form.get("participants", "")
    print(f"[DEBUG] 基本情報: 路線={route}, 空港={airport}, 日数={day}, 参加者={participants}")

    # 2. 利益率の取得処理
    def get_and_debug_profits(type_label, name, allweek_name):
        raw_list = request.form.getlist(name)
        # 7要素に調整（空文字は0に）
        profits = [(v if v else "0") for v in raw_list]
        while len(profits) < 7:
            profits.append("0")
        
        is_allweek = request.form.get(allweek_name) == "1"
        if is_allweek:
            final_profits = [profits[0]] * 7
            print(f"[DEBUG] {type_label}利益率: 全曜日適用 (値: {profits[0]})")
        else:
            final_profits = profits[:7]
            print(f"[DEBUG] {type_label}利益率: 個別設定 {final_profits}")
        return final_profits

    adult_profits = get_and_debug_profits("大人", "profit_adult[]", "profit_adult_allweek")
    child_profits = get_and_debug_profits("子供", "profit_child[]", "profit_child_allweek")
    infant_profits = get_and_debug_profits("幼児", "profit_infant[]", "profit_infant_allweek")

    # 3. CSV用行データの生成
    youbi_list = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
    participants_map = {"1": "1人", "2": "2人以上", "全て": "全て"}
    participants_disp = participants_map.get(participants, participants)

    JST = zoneinfo.ZoneInfo("Asia/Tokyo")
    now_str = datetime.now(JST).strftime("%Y/%m/%d %H:%M:%S")

    row_count = 0
    csv_rows = []
    for f_num in flight_numbers:
        for idx, youbi in enumerate(youbi_list):
            csv_rows.append([
                f_num, route, sale_from, sale_to, flight_from, flight_to,
                day, airport, participants_disp, now_str, youbi,
                adult_profits[idx], child_profits[idx], infant_profits[idx]
            ])
            row_count += 1
    
    print(f"[DEBUG] 生成された総行数: {row_count} 行 (ヘッダー除く)")

    # 4. CSV書き込み
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    
    # ヘッダー
    writer.writerow([
        "便番号","路線","販売期間(From)","販売期間(To)",
        "搭乗期間(From)","搭乗期間(To)","日数","発空港コード",
        "参加者","作成日時","曜日","大人利益率","子供利益率","幼児利益率"
    ])
    
    # データ
    writer.writerows(csv_rows)
    
    # 5. 内容の確認と送信
    csv_content = output.getvalue()
    print(f"[DEBUG] CSV文字列の長さ: {len(csv_content)} 文字")
    
    if len(csv_content) == 0:
        print("[ERROR] CSVの内容が空です。書き込み処理に問題があります。")
    
    # Shift_JISに変換
    csv_bytes = csv_content.encode("shift_jis", errors="replace")
    print(f"[DEBUG] 最終バイナリサイズ: {len(csv_bytes)} バイト")
    
    output.close()

    return send_file(
        io.BytesIO(csv_bytes),
        mimetype="text/csv",
        as_attachment=True,
        download_name="converted.csv",
    )
