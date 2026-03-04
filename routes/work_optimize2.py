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
    # ----- 基本情報 -----
    # 改行で分割し、空行を除去してリスト化
    flight_number_raw = request.form.get("flight_number", "")
    flight_numbers = [line.strip() for line in flight_number_raw.splitlines() if line.strip()]

    # 入力がない場合のガード
    if not flight_numbers:
        flight_numbers = [""]

    route = request.form.get("routes", "")
    sale_from = request.form.get("sale_from", "")
    sale_to = request.form.get("sale_to", "")
    flight_from = request.form.get("flight_from", "")
    flight_to = request.form.get("flight_to", "")
    day = request.form.get("day", "")
    airport = request.form.get("airport", "")
    participants = request.form.get("participants", "")

    # ----- 利益率の取得と展開 -----
    def safe_getlist(name):
        return [ (v if v else "0") for v in request.form.getlist(name) ]

    def pad_and_expand(name, allweek_name):
        raw = safe_getlist(name)
        # 7要素にパディング
        while len(raw) < 7:
            raw.append("0")
        
        # 全曜日適用チェック
        if request.form.get(allweek_name) == "1":
            return [raw[0]] * 7
        return raw[:7]

    adult_profits = pad_and_expand("profit_adult[]", "profit_adult_allweek")
    child_profits = pad_and_expand("profit_child[]", "profit_child_allweek")
    infant_profits = pad_and_expand("profit_infant[]", "profit_infant_allweek")

    youbi_list = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
    participants_map = {"1": "1人", "2": "2人以上", "全て": "全て"}
    participants_disp = participants_map.get(participants, participants)

    # 作成日時 JST
    JST = zoneinfo.ZoneInfo("Asia/Tokyo")
    now_str = datetime.now(JST).strftime("%Y/%m/%d %H:%M:%S")

    # ----- CSV 生成 -----
    # newline="" を指定してExcelでの空行発生を防止
    output = io.StringIO(newline="")
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)

    # ヘッダ
    writer.writerow([
        "便番号","路線","販売期間(From)","販売期間(To)",
        "搭乗期間(From)","搭乗期間(To)","日数","発空港コード",
        "参加者","作成日時","曜日","大人利益率","子供利益率","幼児利益率"
    ])

    # データの書き込み
    for f_num in flight_numbers:
        for idx, youbi in enumerate(youbi_list):
            writer.writerow([
                f_num, route, sale_from, sale_to, flight_from, flight_to,
                day, airport, participants_disp, now_str, youbi,
                adult_profits[idx], child_profits[idx], infant_profits[idx],
            ])

    # StringIOの内容をShift_JISに変換してBytesIOに格納
    csv_data = output.getvalue().encode("shift_jis", errors="replace")
    output.close() # メモリ解放

    return send_file(
        io.BytesIO(csv_data),
        mimetype="text/csv",
        as_attachment=True,
        download_name="converted.csv",
    )
