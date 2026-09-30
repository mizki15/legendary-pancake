# legendary-pancake

Flask 製のポートフォリオサイトです。Render の起動コマンドは `gunicorn app:app` です。

## 構成

- `app.py`: Blueprint の登録と、移動前の公開 CSV URL の互換ルート
- `portfolio/`: トップページ、カード一覧の設定、トップページ用 CSS・画像
- `apps/<アプリ名>/`: 各アプリのルート、HTML、CSS、データ。クイズの各版は `apps/ut_eitan_quiz/` にまとめています
- `requirements.txt`、`render.yaml`: Render のデプロイ設定

例えば CSV ツールは `apps/work_optimize2/routes.py`、`apps/work_optimize2/templates/`、`apps/work_optimize2/static/` だけを見れば編集できます。公開 URL（`/opt2/work_optimize2` など）は整理前と同じです。

## トップページでの表示・非表示

[`portfolio/projects.py`](portfolio/projects.py) の対象アプリの `visible` を `True` または `False` に変更します。ロケットのようにカードが複数あるアプリは、1つの設定でまとめて切り替わります。`False` にしても直接 URL でアクセスできます。カードの表示順・名前・説明・画像・リンク先もこのファイルで編集できます。

## ローカル起動

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/gunicorn app:app --bind 127.0.0.1:8000
```

トップページは `http://127.0.0.1:8000/` です。動作確認は `.venv/bin/python -m unittest discover -s tests` で実行できます。楽天 API を使う業務効率化ツールには `RAKUTEN_APP_ID`、`RAKUTEN_ACCESS_KEY`、`RAKUTEN_AFFILIATE_ID` が必要です。学習とテキスト保存の外部 API への通信も別途必要です。

新しいアプリの追加方法は [新しいアプリを作るとき.md](新しいアプリを作るとき.md) を参照してください。
