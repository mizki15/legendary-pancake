from pathlib import Path

from flask import Flask, send_from_directory
from dotenv import load_dotenv

from portfolio.routes import portfolio_bp
from apps.study.routes import study_bp
from apps.work_optimize1.routes import work_optimize1_bp
from apps.work_optimize2.routes import work_optimize2_bp
from apps.rocket.routes import rocket_bp
from apps.txtstore.routes import txtstore_bp
from apps.keiba.routes import keiba_bp
from apps.mainkurafuto.routes import mainkurafuto_bp
from apps.pingpong.routes import pingpong_bp
from apps.ut_eitan_quiz.ut_eitan_quiz import ut_eitan_quiz_bp
from apps.ut_eitan_quiz.ut_eitan_quiz_1 import ut_eitan_quiz_bp_1
from apps.ut_eitan_quiz.ut_eitan_quiz_2 import ut_eitan_quiz_bp_2
from apps.ut_eitan_quiz.ut_eitan_quiz_3 import ut_eitan_quiz_bp_3
from apps.ut_eitan_quiz.ut_eitan_quiz_4 import ut_eitan_quiz_bp_4
from apps.ut_eitan_quiz.ut_eitan_quiz_5 import ut_eitan_quiz_bp_5
from apps.ut_eitan_quiz.ut_eitan_quiz_6 import ut_eitan_quiz_bp_6

load_dotenv()

app = Flask(__name__, static_folder=None)
app.secret_key = "secret_key"

app.register_blueprint(portfolio_bp)
app.register_blueprint(study_bp)
app.register_blueprint(work_optimize1_bp, url_prefix="/opt1")
app.register_blueprint(work_optimize2_bp, url_prefix="/opt2")
app.register_blueprint(rocket_bp)
app.register_blueprint(txtstore_bp)
app.register_blueprint(keiba_bp)
app.register_blueprint(mainkurafuto_bp)
app.register_blueprint(pingpong_bp)
app.register_blueprint(ut_eitan_quiz_bp)
app.register_blueprint(ut_eitan_quiz_bp_1)
app.register_blueprint(ut_eitan_quiz_bp_2)
app.register_blueprint(ut_eitan_quiz_bp_3)
app.register_blueprint(ut_eitan_quiz_bp_4)
app.register_blueprint(ut_eitan_quiz_bp_5)
app.register_blueprint(ut_eitan_quiz_bp_6)


@app.route("/static/words.csv", defaults={"filename": "words.csv"})
@app.route("/static/sentences.csv", defaults={"filename": "sentences.csv"})
def legacy_study_static(filename):
    """Keep existing public CSV links after moving the files into the study app."""
    return send_from_directory(Path(__file__).parent / "apps/study/static", filename)


@app.route("/static/css/work_optimization_style.css", defaults={"name": "work_optimization_style.css"})
@app.route("/static/css/work_optimization_style2.css", defaults={"name": "work_optimization_style2.css"})
def legacy_tool_style(name):
    """Keep the previous CSS URLs available for existing links."""
    tool = "work_optimize2" if name.endswith("style2.css") else "work_optimize1"
    return send_from_directory(Path(__file__).parent / "apps" / tool / "static/css", name)


if __name__ == "__main__":
    app.run(debug=True)
