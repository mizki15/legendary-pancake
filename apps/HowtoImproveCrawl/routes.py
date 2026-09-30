from flask import Blueprint, render_template

howtoimprovecrawl = Blueprint('howtoimprovecrawl', __name__, template_folder='templates')


@howtoimprovecrawl.route("/")
def howtoimprovecrawl():
    return render_template("how-to-improve-crawl.html")