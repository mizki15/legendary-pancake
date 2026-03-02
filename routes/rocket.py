from flask import Blueprint, render_template

# Blueprintの定義
rocket_bp = Blueprint('rocket', __name__)

@rocket_bp.route("/rocket")
def rocket():
    return render_template("rocket.html")

@rocket_bp.route("/rocket_orbit")
def rocket_orbit():
    return render_template("rocket_orbit.html")

@rocket_bp.route("/rocket_mobile")
def rocket_mobile():
    return render_template("rocket_mobile.html")

@rocket_bp.route("/rocket_mobile_orbit")
def rocket_mobile_orbit():
    return render_template("rocket_mobile_orbit.html")
