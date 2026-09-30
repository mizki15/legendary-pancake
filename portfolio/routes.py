from flask import Blueprint, render_template

from portfolio.projects import PROJECTS

portfolio_bp = Blueprint(
    "portfolio", __name__, template_folder="templates", static_folder="static",
    static_url_path="/static",
)


@portfolio_bp.route("/")
def index_top():
    cards = [card for project in PROJECTS if project["visible"] for card in project["cards"]]
    return render_template("index.html", cards=cards)
