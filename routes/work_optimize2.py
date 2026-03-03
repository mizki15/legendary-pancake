from flask import Blueprint, request, send_file, render_template
import io
import csv
import os
import requests
import time
import zoneinfo
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Blueprintの定義
work_optimize2_bp = Blueprint('work_optimize2', __name__)

# .envの読み込み（個別のファイルでも念のため実行）
load_dotenv()


# =========================
# ルート（Blueprint用）
# =========================

@work_optimize2_bp.route("/work_optimize2")
def index():
    return render_template("work_optimize2.html")

@work_optimize2_bp.route("/convert", methods=["POST"])
def convert():
    # 利益率テーブルの値をlistで取得
    profit_list = request.form.getlist("profit_margin[]")
    # 便番号など他の値も取得
    flight_number = request.form.get("flight_number", "")
    route = request.form.get("routes", "")
    sale_from = request.form.get("sale_from", "")
    sale_to = request.form.get("sale_to", "")
    flight_from = request.form.get("flight_from", "")
    flight_to = request.form.get("flight_to", "")
    day = request.form.get("day", "")
    airport = request.form.get("airport", "")
    participants = request.form.get("participants", "")

    # 利益率テーブルのlist展開（[大人全,大人日,大人月,...,子供全,子供日,...,幼児全,幼児日,...]の順）
    # 1行目:大人, 2行目:子供, 3行目:幼児, 各9列
    def get_profit_row(row):
        base = row * 9
        allweek_checked = profit_list[base] == ("1" or 1 or True)
        # [全曜日, 日, 月, 火, 水, 木, 金, 土]
        if profit_list[base] == "1":
            # 全曜日適用がチェックされている場合、日曜日の値を全曜日に適用
            sun_value = profit_list[base+1]
            return [sun_value]*7
        else:
            return [
                profit_list[base+1], # 日
                profit_list[base+2], # 月
                profit_list[base+3], # 火
                profit_list[base+4], # 水
                profit_list[base+5], # 木
                profit_list[base+6], # 金
                profit_list[base+7], # 土
            ]

    adult_profits = get_profit_row(0)
    child_profits = get_profit_row(1)
    infant_profits = get_profit_row(2)
    youbi_list = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

    # 人数表記
    participants_map = {"1": "1人", "2": "2人以上", "全て": "全て"}
    participants_disp = participants_map.get(participants, participants)

    # 作成日時
    JST = zoneinfo.ZoneInfo("Asia/Tokyo")
    now_str = datetime.now(JST).strftime("%Y/%m/%d %H:%M:%S")

    # CSV出力
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    for idx, youbi in enumerate(youbi_list):
        writer.writerow([
            flight_number,
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
