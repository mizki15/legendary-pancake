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

    # ===== 基本情報 =====
    flight_number = request.form.get("flight_number", "").strip()
    route = request.form.get("routes", "")
    sale_from = request.form.get("sale_from", "").strip()
    sale_to = request.form.get("sale_to", "").strip()
    flight_from = request.form.get("flight_from", "").strip()
    flight_to = request.form.get("flight_to", "").strip()
    day = request.form.get("day", "").strip()
    airport = request.form.get("airport", "").strip()
    participants = request.form.get("participants", "")

    # ===== 利益率取得（name="profit_adult[]" でも "profit_adult" でも対応） =====
    def safe_getlist(base_name):
        lst = request.form.getlist(base_name)
        if not lst:
            lst = request.form.getlist(base_name + "[]")
        return [v if v is not None else "" for v in lst]

    adult_raw = safe_getlist("profit_adult")
    child_raw = safe_getlist("profit_child")
    infant_raw = safe_getlist("profit_infant")

    def pad_to_7(lst):
        out = list(lst[:7])
        while len(out) < 7:
            out.append("0")
        return out

    adult_raw = pad_to_7(adult_raw)
    child_raw = pad_to_7(child_raw)
    infant_raw = pad_to_7(infant_raw)

    adult_allweek = request.form.get("profit_adult_allweek") == "1"
    child_allweek = request.form.get("profit_child_allweek") == "1"
    infant_allweek = request.form.get("profit_infant_allweek") == "1"

    def expand_allweek(raw_list, flag):
        if flag:
            sun_value = raw_list[0] if raw_list else "0"
            return [sun_value] * 7
        return raw_list

    adult_profits = expand_allweek(adult_raw, adult_allweek)
    child_profits = expand_allweek(child_raw, child_allweek)
    infant_profits = expand_allweek(infant_raw, infant_allweek)

    youbi_list = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

    participants_map = {"1": "1人", "2": "2人以上", "全て": "全て"}
    participants_disp = participants_map.get(participants, participants)

    JST = zoneinfo.ZoneInfo("Asia/Tokyo")
    now_str = datetime.now(JST).strftime("%Y/%m/%d %H:%M:%S")

    # ===== CSV生成 =====
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)

    writer.writerow([
        "便番号","路線","販売期間(From)","販売期間(To)",
        "搭乗期間(From)","搭乗期間(To)","日数","発空港コード",
        "参加者","作成日時","曜日","大人利益率","子供利益率","幼児利益率"
    ])

    # 便番号が複数行の場合にも対応
    flight_numbers = [f.strip() for f in flight_number.splitlines() if f.strip()]
    if not flight_numbers:
        flight_numbers = [""]

    for fn in flight_numbers:
        for idx, youbi in enumerate(youbi_list):
            writer.writerow([
                fn,
                route,
                sale_from,
                sale_to,
                flight_from,
                flight_to,
                day,
                airport,
                participants_disp,
                now_str,
                youbi,
                adult_profits[idx],
                child_profits[idx],
                infant_profits[idx],
            ])

    output.seek(0)

    return send_file(
        io.BytesIO(output.getvalue().encode("shift_jis", errors="replace")),
        mimetype="text/csv",
        as_attachment=True,
        download_name="converted.csv",
    )
