from flask import Flask, render_template
from dotenv import load_dotenv

# 1. 各Blueprintをインポート
from routes.study import study_bp
from routes.work_optimize1 import work_optimize1_bp
from routes.work_optimize2 import work_optimize2_bp
from routes.rocket import rocket_bp
from routes.misc import misc_bp

# .env読み込み
load_dotenv()

app = Flask(__name__)

# インデックス（トップページ）
@app.route("/")
def index_top():
    return render_template("index.html")

# =========================
# Blueprint 登録
# =========================
app.register_blueprint(study_bp)
app.register_blueprint(work_optimize1_bp)
app.register_blueprint(work_optimize2_bp)
app.register_blueprint(rocket_bp)
app.register_blueprint(misc_bp)

if __name__ == '__main__':
    # 開発環境ではdebug=True
    app.run(debug=True)





