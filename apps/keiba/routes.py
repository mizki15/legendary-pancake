from flask import Blueprint, render_template

keiba_bp = Blueprint('keiba', __name__, template_folder='templates')


@keiba_bp.route("/keiba")
def keiba():
    return render_template("keiba.html")
