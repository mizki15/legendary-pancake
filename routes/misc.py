from flask import Blueprint, request, render_template
import requests

misc_bp = Blueprint('misc', __name__)

@misc_bp.route("/txtstore")
def txtstore():
    return render_template("txtstore.html")

@misc_bp.route("/txtstore/save", methods=["POST"])
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

@misc_bp.route("/mainkurafuto")
def mainkurafuto():
    return render_template("mainkurafuto.html")

@misc_bp.route("/keiba")
def keiba():
    return render_template("keiba.html")

@misc_bp.route("/pingpong")
def pingpong():
    return render_template("pingpong.html")
