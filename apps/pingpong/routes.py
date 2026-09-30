from flask import Blueprint, render_template

pingpong_bp = Blueprint('pingpong', __name__, template_folder='templates')


@pingpong_bp.route("/pingpong")
def pingpong():
    return render_template("pingpong.html")
