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
    print("\n--- [Server Log] 処理開始 ---")
    
    # 1. データの取得
    flight_number_raw = request.form.get("flight_number", "")
    # 改行で分割し、空行を除外してリスト化
    flight_numbers = [line.strip() for line in flight_number_raw.splitlines() if line.strip()]
    if not flight_numbers: flight_numbers = [""]

    route = request.form.get("routes", "")
    sale_from = request.form.get("sale_from", "")
    sale_to = request.form.get("sale_to", "")
    flight_from = request.form.get("flight_from", "")
    flight_to = request.form.get("flight_to", "")
    day = request.form.get("day", "")
    airport = request.form.get("airport", "")
    participants = request.form.get("participants", "")

    # 利益率取得ロジック
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

    # 2. CSVの書き込み
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)

    # ヘッダー
    writer.writerow([
        "便番号","路線","販売期間(From)","販売期間(To)",
        "搭乗期間(From)","搭乗期間(To)","日数","発空港コード",
        "参加者","作成日時","曜日","大人利益率","子供利益率","幼児利益率"
    ])

    youbi_list = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
    JST = zoneinfo.ZoneInfo("Asia/Tokyo")
    now_str = datetime.now(JST).strftime("%Y/%m/%d %H:%M:%S")

    # 便番号 × 7曜日のループ
    for f_num in flight_numbers:
        for idx, youbi in enumerate(youbi_list):
            writer.writerow([
                f_num, route, sale_from, sale_to, flight_from, flight_to,
                day, airport, participants, now_str, youbi,
                adult_p[idx], child_p[idx], infant_p[idx]
            ])

    # --------------------------------------------------
    # 【重要】重要：0バイト対策
    # --------------------------------------------------
    # 1. StringIOの中身をすべて取り出し、Shift_JISにエンコード
    csv_data = output.getvalue().encode("shift_jis", errors="replace")
    output.close() # StringIOはもう不要なので閉じる

    print(f"[Server Log] 生成バイナリサイズ: {len(csv_data)} バイト")

    # 2. バイナリデータをBytesIOにラップして送信
    # この時、ポインタは自動的に先頭にセットされる
    return send_file(
        io.BytesIO(csv_data),
        mimetype="text/csv",
        as_attachment=True,
        download_name="converted.csv"
    )
