from flask import (
    Flask, request, send_file, render_template,
    jsonify
)
import io
import csv
import os
import uuid
import shutil
import tempfile
import time
import zoneinfo
from datetime import datetime, timedelta

import requests
from dotenv import load_dotenv
from werkzeug.utils import secure_filename

from pydub import AudioSegment
from pydub.generators import WhiteNoise

# Blueprint
from study import study_bp

# =========================
# 初期設定
# =========================

load_dotenv()

app = Flask(__name__)
app.register_blueprint(study_bp)

JST = zoneinfo.ZoneInfo("Asia/Tokyo")
youbi_list = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

ALLOWED_EXT = {"mp3", "wav", "m4a", "ogg"}

# =========================
# 共通トップ
# =========================

@app.route("/")
def index():
    return render_template("index.html")


# =========================
# ===== CSV変換機能 ======
# =========================

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
        return {"error": "APIキーが設定されていません"}

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
            return {"error": f"施設名が一致しません: {facility_num}"}

    except Exception as e:
        return {"error": str(e)}


@app.route("/work_optimization")
def work_optimization():
    return render_template("work_optimization.html")


@app.route("/convert", methods=["POST"])
def convert():
    # ここは元コードロジックを簡略保持
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    writer.writerow(["サンプルCSV"])
    output.seek(0)

    return send_file(
        io.BytesIO(output.getvalue().encode("shift_jis", errors="replace")),
        mimetype="text/csv",
        as_attachment=True,
        download_name="converted.csv",
    )


# =========================
# ===== その他ページ ======
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

@app.route("/mainkurafuto")
def mainkurafuto():
    return render_template("mainkurafuto.html")

@app.route("/keiba")
def keiba():
    return render_template("keiba.html")


# =========================
# ===== TXT保存 ======
# =========================

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

    return "保存しました"


# =========================
# ===== 音源結合機能 ======
# =========================

@app.route("/audio")
def audio_index():
    return render_template("templates_combiner_v2/index.html")


def allowed_filename(fname):
    return "." in fname and fname.rsplit(".", 1)[1].lower() in ALLOWED_EXT


def change_speed(sound: AudioSegment, speed: float) -> AudioSegment:
    if speed == 1.0:
        return sound
    new_frame_rate = int(sound.frame_rate * speed)
    sped = sound._spawn(sound.raw_data, overrides={"frame_rate": new_frame_rate})
    return sped.set_frame_rate(sound.frame_rate)


def degrade_audio(sound: AudioSegment, level="low"):
    if level == "high":
        sr = 16000
        noise_gain = -30
    else:
        sr = 8000
        noise_gain = -20

    degraded = sound.set_frame_rate(sr).set_channels(1)
    noise = WhiteNoise().to_audio_segment(duration=len(degraded)).apply_gain(noise_gain)
    return degraded.overlay(noise)


@app.route("/combine", methods=["POST"])
def combine():
    tmpdir = tempfile.mkdtemp()

    try:
        files = []

        for i in (1, 2, 3):
            f = request.files.get(f"file{i}")
            if not f or f.filename == "":
                return jsonify({"error": f"Missing file{i}"}), 400

            if not allowed_filename(f.filename):
                return jsonify({"error": "Invalid file type"}), 400

            fname = secure_filename(f.filename)
            path = os.path.join(tmpdir, f"{uuid.uuid4().hex}_{fname}")
            f.save(path)
            files.append(path)

        segs = []
        speeds = [
            float(request.form.get("speed1", 1.0)),
            float(request.form.get("speed2", 1.0)),
            float(request.form.get("speed3", 1.0))
        ]

        for idx, path in enumerate(files):
            seg = AudioSegment.from_file(path)
            seg = change_speed(seg, speeds[idx])
            segs.append(seg)

        total = AudioSegment.silent(duration=0)
        total += segs[0]
        total += AudioSegment.silent(duration=30000)
        total += segs[1]
        total += AudioSegment.silent(duration=60000)
        total += segs[2]

        if request.form.get("degrade") == "on":
            total = degrade_audio(total)

        out_path = os.path.join(tmpdir, "combined.mp3")
        total.export(out_path, format="mp3", bitrate="128k")

        return send_file(out_path, as_attachment=True)

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# =========================
# ===== 起動 ======
# =========================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
