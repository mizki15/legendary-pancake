from flask import Blueprint, render_template

howtoimprovecrawl_bp = Blueprint(
    "howtoimprovecrawl", __name__, template_folder="templates"
)


@howtoimprovecrawl_bp.route("/howtoimprovecrawl")
def howtoimprovecrawl():
    return render_template("how-to-improve-crawl.html")
