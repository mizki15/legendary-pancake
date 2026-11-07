/** Server-only bridge. Add this as Supabase.gs alongside the existing Code.gs. */
function supabaseRequest_(method, path, data) {
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('MK_SUPABASE_URL') || '').trim().replace(/\/$/, '');
  const key = String(props.getProperty('MK_SUPABASE_KEY') || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || key.length < 32) throw new Error('unavailable: MK_SUPABASE_URLとMK_SUPABASE_KEYの設定を確認してください。');
  const headers = { apikey: key, Accept: 'application/json' };
  if (!key.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + key;
  const options = { method: method, headers: headers, muteHttpExceptions: true, followRedirects: false };
  if (data !== undefined) { options.contentType = 'application/json'; options.payload = JSON.stringify(data); }
  let response;
  try { response = UrlFetchApp.fetch(url + '/rest/v1/' + path, options); }
  catch (_) { throw new Error('unavailable: Supabaseへ通信できません。外部通信の権限・接続先・プロジェクトの稼働状態を確認してください。'); }
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw supabaseResponseError_(response);
  try { return response.getContentText() ? JSON.parse(response.getContentText()) : null; }
  catch (_) { throw new Error('unavailable'); }
}

function supabaseResponseError_(response) {
  const status = response.getResponseCode();
  // Only fixed, known error codes may appear in logs. Never log upstream
  // messages, details, hints, request headers or response bodies.
  const hints = {
    PGRST000: 'Data APIからDBへ接続できません。SupabaseのAPIログとDBの稼働状態を確認してください。',
    PGRST001: 'Data API内部のDB接続エラーです。SupabaseのAPIログを確認してください。',
    PGRST002: 'Data APIのスキーマキャッシュを構築できません。Data APIのExposed schemasとAPIログを確認してください。',
    PGRST003: 'Data APIのDB接続待ちがタイムアウトしました。接続数とAPIログを確認してください。',
    PGRST205: 'schema.sqlを対象プロジェクトで実行し、public.mk_ideasを作成してください。',
    '42P01': 'schema.sqlを対象プロジェクトで実行し、public.mk_ideasを作成してください。',
    '42501': 'サーバー用キーとschema.sqlのservice_role権限を確認してください。',
    PGRST301: 'APIキーが有効か、URLと同じプロジェクトのものか確認してください。',
    PGRST302: 'Secret keyまたはLegacyのservice_role keyを設定してください。',
    PGRST106: 'SupabaseのData APIでpublicスキーマが公開対象か確認してください。'
  };
  let code = '';
  try {
    const parsed = JSON.parse(response.getContentText());
    if (Object.prototype.hasOwnProperty.call(hints, parsed.code)) code = parsed.code;
  } catch (_) {}
  const byStatus = {
    401: 'キーの種類・値・対象プロジェクトを確認してください。Apps ScriptではLegacyのservice_role keyも利用できます。',
    403: 'サーバー用キーとテーブル権限、Data APIの設定を確認してください。',
    404: 'Project URL、Data APIの有効化、public.mk_ideasの作成を確認してください。',
    429: '利用制限の可能性があります。少し待って再実行してください。',
    503: 'Data APIや中継先が利用できません。Healthyの場合もAPIログ・Data API設定・公式Project URLを確認してください。'
  };
  return new Error('unavailable: Supabase HTTP ' + status + (code ? ' / ' + code : '')
    + '。' + (hints[code] || byStatus[status] || 'Supabaseのプロジェクト設定と稼働状態を確認してください。'));
}

/** Read-only preflight: run this before migration, or to diagnose connection errors. */
function checkSupabaseConnection() {
  const rows = supabaseRequest_('get', 'mk_ideas?select=id&limit=1');
  if (!Array.isArray(rows)) throw new Error('unavailable: Supabaseの応答形式を確認してください。');
  console.log('Supabase接続成功。public.mk_ideasを参照できました。データは変更していません。');
}

function supabaseRows_() {
  const all = [];
  while (true) {
    const rows = supabaseRequest_('get', 'mk_ideas?select=*&order=id&limit=500&offset=' + all.length);
    if (!Array.isArray(rows)) throw new Error('unavailable');
    all.push(...rows);
    if (rows.length < 500) return all;
  }
}

function supabaseFileAction_(request) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('MK_STORAGE_BACKEND') !== 'supabase' || props.getProperty('MK_SUPABASE_MIGRATED') !== 'yes') throw new Error('unavailable');
  if (request.action === 'read_file') {
    if (typeof request.file_id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(request.file_id)) throw new Error('invalid');
    return Utilities.base64Encode(ownedPhoto_(request.file_id).getBlob().getBytes());
  }
  if (!MK_UUID.test(request.id) || !['idea', 'memory'].includes(request.kind)
      || typeof request.data !== 'string' || request.data.length > 466668) throw new Error('invalid');
  const bytes = Utilities.base64Decode(request.data);
  const ascii = part => String.fromCharCode(...part.map(n => (n + 256) % 256));
  if (bytes.length > 350000 || bytes.length < 12 || ascii(bytes.slice(0, 4)) !== 'RIFF' || ascii(bytes.slice(8, 12)) !== 'WEBP') throw new Error('invalid');
  const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('MK_PHOTO_FOLDER_ID'));
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('invalid');
  return folder.createFile(Utilities.newBlob(bytes, 'image/webp', 'mk-' + request.id + '-' + request.kind + '.webp')).getId();
}

function canonicalJournal_(value) {
  if (Array.isArray(value)) return value.map(canonicalJournal_);
  if (value && typeof value === 'object') {
    const result = {};
    Object.keys(value).sort().forEach(key => { result[key] = canonicalJournal_(value[key]); });
    return result;
  }
  return value;
}

function sameJournalRows_(left, right) {
  const normalize = rows => rows.map(row => ({
    id: row.id, version: row.version, payload: row.payload,
    deleted_at: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    idea_photo_id: row.idea_photo_id || null, memory_photo_id: row.memory_photo_id || null
  })).sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(canonicalJournal_(normalize(left))) === JSON.stringify(canonicalJournal_(normalize(right)));
}

/** Run once after schema.sql and the two MK_SUPABASE_* script properties. */
function migrateJournalToSupabase() {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('MK_SUPABASE_MIGRATED') === 'yes') {
      console.log('移行は完了済みです。Render側の設定を確認してください。'); return;
    }
    // Validate connectivity before freezing writes. No changes to source data.
    let destination = supabaseRows_();
    const sheet = journalSheet_();
    const source = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues() : [];
    const rows = source.filter(row => row[0] && !expired_(row[2])).map(row => ({
      ...record_(row), idea_photo_id: row[4] ? String(row[4]) : null,
      memory_photo_id: row[5] ? String(row[5]) : null
    }));
    if (destination.length && !sameJournalRows_(rows, destination)) throw new Error('移行先に異なるデータがあります。上書きせず停止しました。');
    if (!props.getProperty('MK_SUPABASE_BACKUP_ID')) {
      const parent = DriveApp.getFolderById(props.getProperty('MK_ROOT_FOLDER_ID'));
      const original = DriveApp.getFileById(props.getProperty('MK_SPREADSHEET_ID'));
      const backup = original.makeCopy('Date ideas — before Supabase ' + new Date().toISOString(), parent);
      props.setProperty('MK_SUPABASE_BACKUP_ID', backup.getId());
    }
    props.setProperty('MK_STORAGE_BACKEND', 'supabase');
    if (!destination.length && rows.length) {
      try { supabaseRequest_('post', 'rpc/mk_import_ideas', { p_rows: rows }); }
      catch (_) { /* A timeout can follow a successful commit. Verify before retrying. */ }
    }
    destination = supabaseRows_();
    if (!sameJournalRows_(rows, destination)) throw new Error('移行結果が一致しません。旧サイトの書き込みを停止したままにしています。設定を確認して再実行してください。');
    props.setProperty('MK_SUPABASE_MIGRATED', 'yes');
    console.log('移行・全項目照合完了: ' + rows.length + '件。元シートとバックアップは保持しています。RenderをSupabaseへ切り替えてください。');
  } finally { lock.releaseLock(); }
}

/** Existing hourly trigger calls this in Supabase mode, even without site visits. */
function purgeSupabaseJournal_() {
  if (PropertiesService.getScriptProperties().getProperty('MK_SUPABASE_MIGRATED') !== 'yes') return;
  // If DB access fails, stop before touching ANY Drive file. Never use the old
  // sheet's stale references to decide which files belong to the new website.
  const rows = supabaseRows_();
  const referenced = new Set(rows.flatMap(row => [row.idea_photo_id, row.memory_photo_id]).filter(Boolean));
  const limit = new Date(Date.now() - 30 * MK_DAY).toISOString();
  for (const row of rows) if (expired_(row.deleted_at)) {
    // A failure retains the record and both references for an hourly retry.
    removePhoto_(row.idea_photo_id); removePhoto_(row.memory_photo_id);
    supabaseRequest_('delete', 'mk_ideas?id=eq.' + encodeURIComponent(row.id)
      + '&version=eq.' + row.version + '&deleted_at=lte.' + encodeURIComponent(limit));
  }
  const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('MK_PHOTO_FOLDER_ID'));
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    // Immutable uploads get 24h to commit; referenced files are never removed.
    if (file.getName().startsWith('mk-') && !referenced.has(file.getId())
        && file.getDateCreated().getTime() < Date.now() - MK_DAY) removePhoto_(file.getId());
  }
}
