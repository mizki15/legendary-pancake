# Supabaseへの切り替え

文字情報はSupabaseのPostgres、写真は現在の非公開Driveフォルダに保存します。合言葉・URL・画面操作は変わりません。Supabase Authへの登録や、ブラウザへのAPIキー設定は不要です。

サイトの一覧取得・文字だけの追加や編集・お気に入り・ゴミ箱・復元ではGoogleへ通信しません。検索や絞り込みは従来どおり取得した一覧に対してブラウザで行います。写真の追加・キャッシュにない写真の表示・定期削除はApps Script経由です。Renderの休止からの復帰時間はこの変更では短縮されません。

## 1. テーブルを準備する

Supabaseの対象プロジェクトで **SQL Editor → New query** を開き、同じフォルダの `schema.sql` の全文を貼り、**Run** を押します。既存テーブルを削除するSQLではなく、同じファイルを再実行してもデータを保持します。実行後、Table Editorに `mk_ideas` が表示されます。

SQLはRLSを有効にし、`anon` / `authenticated` からの読み書きと関数実行を禁止します。ポリシーを追加して公開する必要はありません。RenderとApps Scriptだけがサーバー用キーを使います。

## 2. Project URLとサーバー用キーを確認する

Supabaseの **Project Settings → API Keys** で **Secret key（`sb_secret_...`）** を確認します。古い形式のプロジェクトでは **Legacy API Keys → service_role** も使えます。Publishable key / anon keyは使いません。

Project URLはConnectやData APIの設定画面で確認できる `https://<project-ref>.supabase.co` です。ダッシュボードのURLではありません。キーはチャット・Git・スクリーンショットに含めないでください。

## 3. サイトとApps Scriptを更新する

この変更をmainへマージし、まずRenderへ新しいコードをデプロイします。この時点では `MIZKI_KAREN_STORAGE` を未設定のままにします。旧Google保存を継続できる状態です。

現在データを保存しているGoogleアカウントで、**既存のApps Scriptプロジェクト**を開きます。新しいプロジェクトやシートを作り直す必要はありません。

1. `コード.gs` を `google/Code.gs` の内容で置き換えます。
2. エディタの「＋ → スクリプト」で `Supabase` を追加し、`google/Supabase.gs` の内容を貼ります。
3. プロジェクト設定でマニフェスト表示を有効にし、`appsscript.json` を `google/appsscript.json` の内容で更新します。外部API通信の権限が追加されます。
4. スクリプトプロパティに次の2件を追加します。既存プロパティは残します。

| スクリプトプロパティ | 値 |
| --- | --- |
| `MK_SUPABASE_URL` | Project URL |
| `MK_SUPABASE_KEY` | Secret key または従来のservice_role key |

`MK_STORAGE_BACKEND` や `MK_SUPABASE_MIGRATED` は移行処理が管理します。手で設定する必要はありません。

続いて **デプロイ → デプロイを管理 → 編集 → 新バージョン → デプロイ** で既存Webアプリを更新します。同じデプロイを編集すれば `/exec` のURLと共有秘密を維持できます。コードを保存するだけではWebアプリの更新になりません。**移行を実行する前に必ず更新してください。** 旧バージョンのままでは移行中の書き込み停止が効きません。

## 4. 既存データを移行する

まず関数一覧から **`checkSupabaseConnection`** を実行し、「Supabase接続成功」が出ることを確認します。読み取りだけを行い、データや移行フラグを変更しません。エラーの場合は以下を確認してください。

| 表示 | 確認すること |
| --- | --- |
| HTTP 401 | URLと同じプロジェクトのサーバー用キーか。Secret keyで失敗する場合はLegacy API Keysのservice_role keyも利用可能 |
| HTTP 403 / 42501 | Publishable/anonではなくサーバー用キーか。schema.sqlの権限設定を実行済みか |
| PGRST205 / 42P01 | 対象プロジェクトでschema.sqlを実行し、public.mk_ideasを作成済みか |
| HTTP 404 | Project URLが正しいか。Data APIが有効か。テーブルがあるか |
| HTTP 429 / 503 | 利用制限、休止や起動中の状態になっていないか |

接続エラーのHTTP番号と既知のエラーコードだけを表示し、キーや応答本文はログへ出しません。問い合わせ時はこのエラー行だけを共有してください。サーバー用キーを取り直した場合は、Apps ScriptとRenderに設定する値も揃えます。

2人ともサイトでの編集をいったん止め、Apps Scriptの関数一覧から **`migrateJournalToSupabase`** を選んで実行します。追加権限の承認を求められたら、保存用アカウントで許可してください。

処理は次を行います。

- 元のシートを同じ保存フォルダへ複製し、バックアップを残す。
- 旧Google保存の書き込みと旧シートを基準にした写真削除を止める。
- 30日を過ぎたゴミ箱を除き、タイトル・メモ・予算・季節・日付・版番号・写真のDrive IDをコピーする。写真自体の再アップロードは不要。
- 全項目を読み戻して照合し、完了したときだけ移行完了フラグを立てる。

実行ログに **「移行・全項目照合完了: ○件」** が出たら成功です。移行先が空でなく元データと異なる場合は上書きせず停止します。通信が切れた場合も、同じ関数を再実行して読み戻し照合できます。移行未完了の間は定期処理が写真を削除しません。

ここからRenderの切り替え完了までは、旧サイトの保存がエラーになります。元のシートは変更しないでください。

## 5. Renderを切り替える

Renderの対象Web Serviceの **Environment** に次の3項目を追加し、保存・再デプロイします。

| 環境変数 | 値 |
| --- | --- |
| `MIZKI_KAREN_STORAGE` | `supabase` |
| `MIZKI_KAREN_SUPABASE_URL` | 手順2のProject URL |
| `MIZKI_KAREN_SUPABASE_KEY` | 手順2のサーバー用キー |

既存の `MIZKI_KAREN_GAS_URL` / `MIZKI_KAREN_GAS_SECRET` は写真用に引き続き必要です。合言葉・署名鍵・記念日の設定もそのまま残します。`MIZKI_KAREN_LOCAL_DB` は本番では設定しません。

保存先は明示的に切り替えます。設定不備や接続失敗があっても、GoogleやRenderの一時ファイルへ自動で保存し直すことはありません。

## 6. 2端末で確認する

1. 移行前の案・思い出・お気に入り・写真が表示される。
2. 新しい案を追加し、別端末で「最新に更新」すると表示される。
3. メモ・予算・お気に入りを変更し、SupabaseのTable Editorにも反映される。
4. 案の写真と達成写真をそれぞれ追加・差し替え・削除できる。
5. ゴミ箱への移動と復元ができる。
6. Apps Scriptの `purgeExpiredJournal` が1時間ごとのトリガーとして残っている。実行履歴に失敗がない。

元シートと移行前バックアップは残しますが、切り替え後の編集はSupabaseだけに保存されます。元シートへ自動同期しないため、保存先をGoogleへ戻すだけでは最新データを復元できません。

## 写真の定期削除

時間トリガーはSupabaseを参照し、30日を過ぎたゴミ箱の写真を完全削除してから案を削除します。途中の失敗は行を残して次回再試行します。DBへ接続できない場合はDriveの削除を始めません。

差し替え・削除で未参照になった写真や、DB保存に失敗した新規アップロードは、作成から24時間以上経ったものを定期回収します。通信切断後に保存が成功していた写真を誤って消さないためです。旧シートに残る写真IDは削除の判断に使いません。無料枠の休止・実行制限・承認失効では物理削除が遅れるため、実行履歴を確認してください。

## 開発時の検証

```bash
.venv/bin/python -m unittest discover -s tests
npm ci
npm test
```

Nodeの開発依存PGliteでPostgresのSQL・RLS権限・同時編集と期限切れを検証し、Apps ScriptとHTTPはモックで検証します。NodeやPGliteはRenderの実行には不要です。これらは実際のSupabase・Google接続や速度の測定ではありません。
