from flask import Flask, request, send_file, render_template
import io
import csv
import os
from dotenv import load_dotenv
import requests
from datetime import datetime, timezone, timedelta
import time
import zoneinfo

# 1. 各Blueprintをインポート
from study import study_bp
from todai_listening import todai_bp  # <--- 追加

# .env読み込み
load_dotenv()

app = Flask(__name__)

# index
@app.route("/")
def index_top():
    return render_template("index.html")

# =========================
# 楽天API関連のロジック (既存コード維持)
# =========================
youbi_list = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
JST = zoneinfo.ZoneInfo("Asia/Tokyo")

def convert_date_to_slash_format(date_str):
    if "/" in date_str and len(date_str) == 10:
        return date_str
    try:
        date = datetime.strptime(date_str, "%Y%m%d")
        return date.strftime("%Y/%m/%d")
    except ValueError:
        return None

def get_data_from_api(facility_num, facility_name):
    time.sleep(0.1)
    app_id = os.getenv("RAKUTEN_APP_ID")
    affiliate_id = os.getenv("RAKUTEN_AFFILIATE_ID")

    if not app_id or not affiliate_id:
        return {"error": "APIキーが設定されていません (.env を確認してください)"}

    url = "https://app.rakuten.co.jp/services/api/Travel/SimpleHotelSearch/20170426"
    params = {
        "format": "json",
        "responseType": "large",
        "hotelNo": facility_num,
        "applicationId": app_id,
        "affiliateId": affiliate_id
    }

    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()

        hotel = data["hotels"][0]["hotel"]
        hotel_name = hotel[0]["hotelBasicInfo"]["hotelName"]
        middle_class_code = hotel[2]["hotelDetailInfo"]["middleClassCode"]
        small_class_code = hotel[2]["hotelDetailInfo"]["smallClassCode"]

        if facility_name.strip() == hotel_name.strip():
            return {
                "施設番号": facility_num,
                "施設名": hotel_name,
                "都道府県コード": middle_class_code,
                "市区町村コード": small_class_code,
            }
        else:
            return {"error": f"施設名が一致しません: {facility_num} ({facility_name} ≠ {hotel_name})"}

    except Exception as e:
        return {"error": f"APIエラー: {str(e)}"}

def make_row_list_from_dict(data_dict):
    return [
        data_dict.get("施設番号", ""),
        data_dict.get("施設名", ""),
        data_dict.get("都道府県コード", ""),
        data_dict.get("市区町村コード", ""),
        "",
        data_dict.get("販売期間(from)", ""),
        data_dict.get("販売期間(to)", ""),
        data_dict.get("出発期間(from)", ""),
        data_dict.get("出発期間(to)", ""),
        data_dict.get("発空港", ""),
        data_dict.get("参加人数オプション", ""),
        data_dict.get("時間", ""),
        data_dict.get("時間", ""),
        data_dict.get("曜日", ""),
        data_dict.get("粗利率1", ""),
        data_dict.get("粗利率2", ""),
        data_dict.get("粗利率3", ""),
        "Ａ"
    ]

def get_active_days(start_date_str, end_date_str):
    try:
        start_date = datetime.strptime(start_date_str, "%Y/%m/%d")
        end_date = datetime.strptime(end_date_str, "%Y/%m/%d")
    except ValueError:
        return set()

    if (end_date - start_date).days >= 6:
        return set(youbi_list)

    active_days = set()
    current_date = start_date
    weekday_map = {0: "MON", 1: "TUE", 2: "WED", 3: "THU", 4: "FRI", 5: "SAT", 6: "SUN"}

    while current_date <= end_date:
        wd = current_date.weekday()
        active_days.add(weekday_map[wd])
        current_date += timedelta(days=1)
    
    return active_days

def transform_data_for_csv(data_dict):
    errors = []
    facilities_raw = data_dict["施設番号"].strip().splitlines()
    rate_lines_raw = data_dict["出発期間+粗利率"].strip().splitlines()
    rate_lines = []

    for line in rate_lines_raw:
        parts = line.split()
        if len(parts) == 5:
            rate_lines.append(parts)
        else:
            errors.append(f"出発期間+粗利率の形式が不正です: {line}")

    hatsu_airport = data_dict["発空港"]
    ninzu = data_dict["参加人数オプション"]
    hanbai_from = convert_date_to_slash_format(data_dict["販売期間(from)"])
    hanbai_to = convert_date_to_slash_format(data_dict["販売期間(to)"])

    if not hanbai_from:
        errors.append("販売期間(from)の日付形式が不正です")
    if not hanbai_to:
        errors.append("販売期間(to)の日付形式が不正です")

    target_ninzu_list = []
    if ninzu == "全て":
        target_ninzu_list = ["1", "2"]
    elif ninzu in ["1", "2"]:
        target_ninzu_list = [ninzu]
    else:
        errors.append("参加人数オプションが選択されていません")

    if errors:
        return {"error": "\n".join(errors)}

    row_list = []

    for line in facilities_raw:
        parts = line.strip().split(maxsplit=1) 
        
        if len(parts) < 2:
            errors.append(f"施設番号と施設名の形式が不正です: {line}")
            continue

        facility_num, facility_name = parts[0], parts[1]
        api_result = get_data_from_api(facility_num, facility_name)

        if "error" in api_result:
            errors.append(api_result["error"])
            continue

        for rate in rate_lines:
            dep_from = convert_date_to_slash_format(rate[0])
            dep_to = convert_date_to_slash_format(rate[1])
            if not dep_from or not dep_to:
                errors.append(f"出発期間の日付形式が不正です: {' '.join(rate[:2])}")
                continue

            active_days_in_period = get_active_days(dep_from, dep_to)

            for current_ninzu in target_ninzu_list:
                new_dict = api_result.copy()
                new_dict["販売期間(from)"] = hanbai_from
                new_dict["販売期間(to)"] = hanbai_to
                new_dict["出発期間(from)"] = dep_from
                new_dict["出発期間(to)"] = dep_to
                new_dict["発空港"] = hatsu_airport
                new_dict["参加人数オプション"] = current_ninzu 
                new_dict["粗利率1"] = rate[2]
                new_dict["粗利率2"] = rate[3]
                new_dict["粗利率3"] = rate[4]
                new_dict["時間"] = datetime.now(JST).strftime("%Y/%m/%d %H:%M:%S")

                for youbi in youbi_list:
                    if youbi in active_days_in_period:
                        tmp = new_dict.copy()
                        tmp["曜日"] = youbi
                        row_list.append(make_row_list_from_dict(tmp))

    if errors:
        return {"error": "\n".join(errors)}

    return {"rows": row_list}

@app.route("/work_optimization")
def index():
    return render_template("work_optimization.html")

@app.route("/convert", methods=["POST"])
def convert():
    data_dict = {
        "出発期間+粗利率": request.form.get("departure_rate", ""),
        "施設番号": request.form.get("facility", ""),
        "販売期間(from)": request.form.get("sale_from", ""),
        "販売期間(to)": request.form.get("sale_to", ""),
        "発空港": request.form.get("airport", ""),
        "参加人数オプション": request.form.get("participants", ""),
    }

    result = transform_data_for_csv(data_dict)

    if "error" in result:
        return f"<h1>エラー:</h1><h2>{result['error'].replace(chr(10), '<br>')}</h2>", 400

    csv_rows = result["rows"]

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    for row in csv_rows:
        writer.writerow(row)
    output.seek(0)

    return send_file(
        io.BytesIO(output.getvalue().encode("shift_jis", errors="replace")),
        mimetype="text/csv",
        as_attachment=True,
        download_name="converted.csv",
    )

# =========================
# その他のルート (既存コード維持)
# =========================

@app.route("/rocket")
def rocket():
    return render_template("rocket.html")

@app.route("/rocket_orbit")
def rocket_orbit():
    return render_template("rocket_orbit.html")

@app.route("/rocket_mobile")
def rocket_mobile():
    return render_template("rocket_mobile.html")

@app.route("/rocket_mobile_orbit")
def rocket_mobile_orbit():
    return render_template("rocket_mobile_orbit.html")

@app.route("/txtstore")
def txtstore():
    return render_template("txtstore.html")

@app.route("/txtstore/save", methods=["POST"])
def txtstore_save():
    text = request.form.get("text", "")
    try:
        res = requests.post(
            "https://script.google.com/macros/s/AKfycbwms2TFCe_m-uHQsaJUZ3SQbWKddtFm413BSNblBAKwxP2faJkz47DAYx2Vwb2zXL2p/exec",
            data={"text": text},
            timeout=5
        )
        res.raise_for_status()
    except Exception as e:
        return f"保存失敗: {e}", 500
    return "保存しました（外部）"

@app.route("/mainkurafuto")
def mainkurafuto():
    return render_template("mainkurafuto.html")

@app.route("/keiba")
def keiba():
    return render_template("keiba.html")

# =========================
# Blueprint 登録
# =========================
app.register_blueprint(study_bp)
app.register_blueprint(todai_bp) # <--- 追加

if __name__ == '__main__':
    app.run(debug=True)
