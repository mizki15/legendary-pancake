from flask import Blueprint, request, send_file, render_template
import io
import csv
import zoneinfo
from datetime import datetime
from dotenv import load_dotenv

# Blueprintの定義
work_optimize2_bp = Blueprint('work_optimize2', __name__)

# .env の読み込み（念のため）
load_dotenv()

@work_optimize2_bp.route("/work_optimize2")
def index():
    return render_template("work_optimize2.html")

@work_optimize2_bp.route("/convert", methods=["POST"])
def convert():
    """
    修正点:
    - チェックボックスは個別 name (profit_adult_allweek 等)
    - 数値入力はそれぞれ profit_adult[], profit_child[], profit_infant[]
    - 各配列は7要素になるように不足分は "0" でパディング
    - allweek チェックが入っていれば日曜日(インデックス0)の値を7日分に展開
    """

    # ----- 基本情報 -----
    flight_number = request.form.get("flight_number", "")
    route = request.form.get("routes", "")
    sale_from = request.form.get("sale_from", "")
    sale_to = request.form.get("sale_to", "")
    flight_from = request.form.get("flight_from", "")
    flight_to = request.form.get("flight_to", "")
    day = request.form.get("day", "")
    airport = request.form.get("airport", "")
    participants = request.form.get("participants", "")

    # ----- 利益率（各年齢層ごとに7要素を期待） -----
    def safe_getlist(name):
        lst = request.form.getlist(name)
        # 空文字や None の場合を避けるため文字列に揃える
        return [ (v if v is not None else "") for v in lst ]

    adult_raw = safe_getlist("profit_adult[]")    # expected 7 items
    child_raw = safe_getlist("profit_child[]")
    infant_raw = safe_getlist("profit_infant[]")

    # パディング: 足りなければ "0" で埋める（defensive）
    def pad_to_7(lst):
        out = list(lst[:7])
        while len(out) < 7:
            out.append("0")
        return out

    adult_raw = pad_to_7(adult_raw)
    child_raw = pad_to_7(child_raw)
    infant_raw = pad_to_7(infant_raw)

    # 全曜日適用チェック（checkbox の value="1" を期待）
    adult_allweek = request.form.get("profit_adult_allweek") == "1"
    child_allweek = request.form.get("profit_child_allweek") == "1"
    infant_allweek = request.form.get("profit_infant_allweek") == "1"

    def expand_allweek(raw_list, allweek_flag):
        if allweek_flag:
            # 日曜日(フォーム上は最初の入力を日曜日にしている想定)
            sun_value = raw_list[0] if len(raw_list) > 0 else "0"
            return [sun_value] * 7
        else:
            return raw_list[:7]

    adult_profits = expand_allweek(adult_raw, adult_allweek)
    child_profits = expand_allweek(child_raw, child_allweek)
    infant_profits = expand_allweek(infant_raw, infant_allweek)

    youbi_list = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

    # 人数表記
    participants_map = {"1": "1人", "2": "2人以上", "全て": "全て"}
    participants_disp = participants_map.get(participants, participants)

    # 作成日時 JST
    JST = zoneinfo.ZoneInfo("Asia/Tokyo")
    now_str = datetime.now(JST).strftime("%Y/%m/%d %H:%M:%S")

    # CSV 出力（Shift_JIS でダウンロード）
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)

    # ヘッダ（必要なら）
    writer.writerow([
        "便番号","路線","販売期間(From)","販売期間(To)",
        "搭乗期間(From)","搭乗期間(To)","日数","発空港コード",
        "参加者","作成日時","曜日","大人利益率","子供利益率","幼児利益率"
    ])

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
