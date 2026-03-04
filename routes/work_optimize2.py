from flask import Blueprint, request, send_file, render_template
import io
import csv
import zoneinfo
from datetime import datetime
from dotenv import load_dotenv

work_optimize2_bp = Blueprint('work_optimize2', __name__)
load_dotenv()

@work_optimize2_bp.route("/work_optimize2")
def index():
    return render_template("work_optimize2.html")

@work_optimize2_bp.route("/convert", methods=["POST"])
def convert():
    print("\n--- [Server Log] 変換処理開始 ---")
    
    # フォームデータの取得
    flight_number = request.form.get("flight_number", "")
    route = request.form.get("routes", "")
    sale_from = request.form.get("sale_from", "")
    sale_to = request.form.get("sale_to", "")
    flight_from = request.form.get("flight_from", "")
    flight_to = request.form.get("flight_to", "")
    day = request.form.get("day", "")
    airport = request.form.get("airport", "")
    participants = request.form.get("participants", "")

    # 利益率の取得（リスト形式）
    def get_profits(type_name):
        raw = request.form.getlist(f"profit_{type_name}[]")
        p = [(v if v else "0") for v in raw]
        while len(p) < 7: p.append("0")
        if request.form.get(f"profit_{type_name}_allweek") == "1":
            return [p[0]] * 7
        return p[:7]

    adult_p = get_profits("adult")
    child_p = get_profits("child")
    infant_p = get_profits("infant")

    # CSV生成
    # io.StringIOの作成
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)

    # ヘッダー
    writer.writerow([
        "便番号","路線","販売期間(From)","販売期間(To)",
        "搭乗期間(From)","搭乗期間(To)","日数","発空港コード",
        "参加者","作成日時","曜日","大人利益率","子供利益率","幼児利益率"
    ])

    # データ行（7曜日分）
    youbi_list = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
    JST = zoneinfo.ZoneInfo("Asia/Tokyo")
    now_str = datetime.now(JST).strftime("%Y/%m/%d %H:%M:%S")

    for idx, youbi in enumerate(youbi_list):
        writer.writerow([
            flight_number, route, sale_from, sale_to,
            flight_from, flight_to, day, airport,
            participants, now_str, youbi,
            adult_p[idx], child_p[idx], infant_p[idx]
        ])

    # --- 重要: ここからが0バイト対策 ---
    
    # 1. StringIOから全文字列を取得
    csv_str = output.getvalue()
    print(f"[Server Log] 生成された文字数: {len(csv_str)} 文字")

    # 2. Shift_JISに変換（バイナリ化）
    csv_bytes = csv_str.encode("shift_jis", errors="replace")
    print(f"[Server Log] 送信バイナリサイズ: {len(csv_bytes)} バイト")

    # 3. BytesIOに包み直し、ポインタを先頭に戻す
    mem_file = io.BytesIO(csv_bytes)
    mem_file.seek(0) 

    print("[Server Log] データを送信します。")
    
    return send_file(
        mem_file,
        mimetype="text/csv",
        as_attachment=True,
        download_name="converted.csv"
    )
