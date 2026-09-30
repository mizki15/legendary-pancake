from flask import Blueprint, render_template

mainkurafuto_bp = Blueprint('mainkurafuto', __name__, template_folder='templates')


@mainkurafuto_bp.route("/mainkurafuto")
def mainkurafuto():
    return render_template("mainkurafuto.html")
