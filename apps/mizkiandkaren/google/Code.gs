/** Run setupJournal once while signed in to the Google account that will own the data. */
const MK_HEADERS = ['id', 'version', 'deleted_at', 'payload', 'idea_photo_id', 'memory_photo_id'];
const MK_DAY = 86400000;
const MK_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function setupJournal() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty('MK_SHARED_SECRET')) props.setProperty('MK_SHARED_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
    let parent;
    if (!props.getProperty('MK_ROOT_FOLDER_ID')) {
      parent = DriveApp.createFolder('Mizki & Karen');
      props.setProperty('MK_ROOT_FOLDER_ID', parent.getId());
    } else parent = DriveApp.getFolderById(props.getProperty('MK_ROOT_FOLDER_ID'));
    if (!props.getProperty('MK_PHOTO_FOLDER_ID')) {
      const folder = parent.createFolder('Photos — private');
      props.setProperty('MK_PHOTO_FOLDER_ID', folder.getId());
    }
    if (!props.getProperty('MK_SPREADSHEET_ID')) {
      const book = SpreadsheetApp.create('Mizki & Karen — Date ideas');
      const sheet = book.getSheets()[0];
      sheet.setName('DateIdeas');
      sheet.getRange(1, 1, 1, MK_HEADERS.length).setValues([MK_HEADERS]);
      sheet.setFrozenRows(1);
      sheet.getRange('A:F').setNumberFormat('@');
      sheet.getRange(1, 1, 1, 6).setBackground('#e9e0cf').setFontColor('#493d32').setFontWeight('bold');
      sheet.setColumnWidths(1, 3, 170);
      sheet.setColumnWidth(4, 480);
      sheet.setColumnWidths(5, 2, 220);
      DriveApp.getFileById(book.getId()).moveTo(parent);
      props.setProperty('MK_SPREADSHEET_ID', book.getId());
    }
    const sheet = journalSheet_();
    if (JSON.stringify(sheet.getRange(1, 1, 1, 6).getValues()[0]) !== JSON.stringify(MK_HEADERS)) throw new Error('The DateIdeas header does not match. Do not change the header row.');
    if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'purgeExpiredJournal')) ScriptApp.newTrigger('purgeExpiredJournal').timeBased().everyHours(1).create();
    console.log('保存用フォルダ: ' + parent.getUrl());
    console.log('保存用シート: ' + SpreadsheetApp.openById(props.getProperty('MK_SPREADSHEET_ID')).getUrl());
    console.log('準備完了。プロジェクトの設定 → スクリプト プロパティの MK_SHARED_SECRET を Render の MIZKI_KAREN_GAS_SECRET に設定してください。秘密の値をチャットやログへ貼らないでください。');
  } finally { lock.releaseLock(); }
}

function doGet() {
  return output_({ ok: false, error: 'unauthorized' });
}

function doPost(event) {
  let lock;
  try {
    if (!event || !event.postData || event.postData.contents.length > 1600000) throw new Error('unauthorized');
    const envelope = JSON.parse(event.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty('MK_SHARED_SECRET');
    if (!secret || typeof envelope.timestamp !== 'string' || !/^\d{10}$/.test(envelope.timestamp) || Math.abs(Date.now() / 1000 - Number(envelope.timestamp)) > 300 || typeof envelope.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(envelope.nonce) || typeof envelope.payload !== 'string') throw new Error('unauthorized');
    const expected = Utilities.computeHmacSha256Signature(envelope.timestamp + '\n' + envelope.nonce + '\n' + envelope.payload, secret).map(value => ('0' + ((value + 256) % 256).toString(16)).slice(-2)).join('');
    if (!constantEqual_(expected, envelope.signature)) throw new Error('unauthorized');
    const payload = JSON.parse(Utilities.newBlob(Utilities.base64Decode(envelope.payload)).getDataAsString('UTF-8'));
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('busy');
    if (['upload_file', 'read_file'].includes(payload.action)) {
      return output_({ ok: true, result: supabaseFileAction_(payload) });
    }
    // Once migration starts, the old website is read-only until Render switches.
    if (payload.action === 'save' && PropertiesService.getScriptProperties().getProperty('MK_STORAGE_BACKEND') === 'supabase') throw new Error('unavailable');
    const sheet = journalSheet_();
    const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues() : [];
    let result;
    if (payload.action === 'list') result = rows.filter(row => row[0] && !expired_(row[2])).map(record_);
    else if (payload.action === 'photo') result = photo_(rows, payload.id, payload.kind);
    else if (payload.action === 'save') result = save_(sheet, rows, payload);
    else throw new Error('invalid');
    return output_({ ok: true, result: result });
  } catch (error) {
    // Never return stack traces, IDs, Drive URLs, secrets or submitted content.
    const safe = ['unauthorized', 'conflict', 'invalid', 'busy'].includes(error.message) ? error.message : 'unavailable';
    return output_({ ok: false, error: safe });
  } finally { if (lock) lock.releaseLock(); }
}

function output_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function constantEqual_(left, right) {
  if (typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
function journalSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('MK_SPREADSHEET_ID');
  const sheet = SpreadsheetApp.openById(id).getSheetByName('DateIdeas');
  if (!sheet) throw new Error('unavailable');
  return sheet;
}
function expired_(deleted) { return deleted && Date.parse(String(deleted)) + 30 * MK_DAY <= Date.now(); }
function record_(row) { return { id: String(row[0]), version: Number(row[1]), deleted_at: row[2] ? String(row[2]) : null, payload: JSON.parse(row[3]) }; }
function photo_(rows, id, kind) {
  if (!MK_UUID.test(id) || !['idea', 'memory'].includes(kind)) throw new Error('invalid');
  const row = rows.find(row => row[0] === id);
  if (!row || expired_(row[2])) return null;
  const fileId = row[kind === 'idea' ? 4 : 5];
  if (!fileId) return null;
  const file = ownedPhoto_(String(fileId));
  return Utilities.base64Encode(file.getBlob().getBytes());
}
function ownedPhoto_(id) {
  const file = DriveApp.getFileById(id), parents = file.getParents();
  const folderId = PropertiesService.getScriptProperties().getProperty('MK_PHOTO_FOLDER_ID');
  let owned = false;
  while (parents.hasNext()) if (parents.next().getId() === folderId) owned = true;
  if (!owned) throw new Error('invalid');
  return file;
}
function removePhoto_(id) {
  if (!id) return;
  try {
    const info = Drive.Files.get(String(id), { fields: 'id,parents' });
    const folderId = PropertiesService.getScriptProperties().getProperty('MK_PHOTO_FOLDER_ID');
    if (!info.parents || !info.parents.includes(folderId)) throw new Error('invalid');
    Drive.Files.remove(String(id));
  }
  catch (error) {
    // Already deleted is idempotent. Other failures leave the row for the next hourly retry.
    if (!/File not found|notFound|404/i.test(String(error))) throw error;
  }
}
function save_(sheet, rows, request) {
  const record = request.record;
  if (!record || !MK_UUID.test(record.id) || !Number.isInteger(request.expected) || request.expected < 0 || !record.payload || typeof record.payload.title !== 'string' || !record.payload.title.trim() || record.payload.title.length > 120) throw new Error('invalid');
  if (record.deleted_at !== null && (typeof record.deleted_at !== 'string' || !Number.isFinite(Date.parse(record.deleted_at)))) throw new Error('invalid');
  const index = rows.findIndex(row => row[0] === record.id), previous = index < 0 ? null : rows[index];
  if ((!previous && request.expected !== 0) || (previous && (Number(previous[1]) !== request.expected || expired_(previous[2])))) throw new Error('conflict');
  const photos = request.photos || {}, removes = request.remove_photos || [];
  if (Object.keys(photos).some(kind => !['idea', 'memory'].includes(kind)) || !Array.isArray(removes) || removes.some(kind => !['idea', 'memory'].includes(kind))) throw new Error('invalid');
  const ids = previous ? [previous[4], previous[5]] : ['', ''];
  const created = [];
  let committed = false;
  try {
    for (const [kind, column] of [['idea', 0], ['memory', 1]]) {
      if (removes.includes(kind)) ids[column] = '';
      if (photos[kind] !== undefined) {
        if (typeof photos[kind] !== 'string' || photos[kind].length > 466668) throw new Error('invalid');
        const bytes = Utilities.base64Decode(photos[kind]);
        if (bytes.length > 350000 || bytes.length < 12 || String.fromCharCode(...bytes.slice(0, 4).map(n => (n + 256) % 256)) !== 'RIFF' || String.fromCharCode(...bytes.slice(8, 12).map(n => (n + 256) % 256)) !== 'WEBP') throw new Error('invalid');
        const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('MK_PHOTO_FOLDER_ID'));
        if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('invalid');
        const file = folder.createFile(Utilities.newBlob(bytes, 'image/webp', 'mk-' + record.id + '-' + kind + '.webp'));
        ids[column] = file.getId(); created.push(file.getId());
      }
    }
    record.payload.has_idea_photo = Boolean(ids[0]);
    record.payload.has_memory_photo = Boolean(ids[1]);
    const json = JSON.stringify(record.payload);
    if (json.length > 40000) throw new Error('invalid');
    const values = [record.id, request.expected + 1, record.deleted_at || '', json, String(ids[0] || ''), String(ids[1] || '')];
    const destination = sheet.getRange(index < 0 ? sheet.getLastRow() + 1 : index + 2, 1, 1, 6);
    destination.setNumberFormat('@').setValues([values]);
    SpreadsheetApp.flush(); committed = true;
    if (previous) for (const column of [4, 5]) if (previous[column] && previous[column] !== values[column]) {
      try { removePhoto_(previous[column]); } catch (_) { /* Hourly orphan cleanup retries. */ }
    }
    return record_(values);
  } catch (error) {
    // If a write timed out after committing, retain any file now referenced by the sheet.
    if (!committed) {
      const live = sheet.getDataRange().getValues();
      for (const id of created) if (!live.some(row => row[4] === id || row[5] === id)) { try { removePhoto_(id); } catch (_) {} }
    }
    throw error;
  }
}

/** Deletes expired records and both private photos, even when the site is not visited. */
function purgeExpiredJournal() {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (PropertiesService.getScriptProperties().getProperty('MK_STORAGE_BACKEND') === 'supabase') {
      purgeSupabaseJournal_();
      return;
    }
    const sheet = journalSheet_();
    const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues() : [];
    for (let index = rows.length - 1; index >= 0; index--) if (expired_(rows[index][2])) {
      removePhoto_(rows[index][4]); removePhoto_(rows[index][5]); sheet.deleteRow(index + 2);
    }
    const remaining = sheet.getDataRange().getValues();
    const referenced = new Set(remaining.slice(1).flatMap(row => [String(row[4]), String(row[5])]).filter(Boolean));
    const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('MK_PHOTO_FOLDER_ID'));
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (file.getName().startsWith('mk-') && !referenced.has(file.getId()) && file.getDateCreated().getTime() < Date.now() - MK_DAY) removePhoto_(file.getId());
    }
  } finally { lock.releaseLock(); }
}
