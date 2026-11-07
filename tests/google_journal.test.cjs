const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');

function harness() {
  const rows = [['id', 'version', 'deleted_at', 'payload', 'idea_photo_id', 'memory_photo_id']];
  const files = new Map(); const deleted = []; const failed = new Set();
  const secret = 'test-only-signature-key-that-is-long-enough';
  const props = {MK_SHARED_SECRET:secret, MK_SPREADSHEET_ID:'sheet-id', MK_PHOTO_FOLDER_ID:'private-folder', MK_ROOT_FOLDER_ID:'private-folder', MK_SUPABASE_URL:'https://test-project.supabase.co', MK_SUPABASE_KEY:'sb_secret_'+'x'.repeat(40)};
  const remote = {rows:[], requests:[], failed:false, timeoutAfterImport:false, backups:0};
  let serial = 0;
  const sheet = {
    getLastRow: () => rows.length,
    getRange: (row, col, count = 1, width = 1) => ({
      getValues: () => rows.slice(row - 1, row - 1 + count).map(value => value.slice(col - 1, col - 1 + width)),
      setNumberFormat() { return this; },
      setValues(values) { rows[row - 1] = [...values[0]]; return this; },
    }),
    getDataRange: () => ({ getValues: () => rows }),
    deleteRow: row => rows.splice(row - 1, 1),
  };
  const iterator = list => { let index = 0; return { hasNext: () => index < list.length, next: () => list[index++] }; };
  const folder = {
    getId: () => 'private-folder', getSharingAccess: () => 'PRIVATE',
    createFile(blob) {
      const id = `photo-${++serial}`;
      const file = { getId: () => id, getName: () => blob.name, getDateCreated: () => new Date(), getParents: () => iterator([folder]), getBlob: () => ({ getBytes: () => [...blob.bytes] }) };
      files.set(id, file); return file;
    },
    getFiles: () => iterator([...files.values()]),
  };
  const context = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => props[name], setProperty(name,value) {props[name]=value;return this;} }) },
    UrlFetchApp: {fetch(url,options) {
      remote.requests.push({url,options});
      if(remote.failed) throw new Error('private upstream details');
      let result=null;
      if(options.method==='get') {const offset=Number(new URL(url).searchParams.get('offset'));result=remote.rows.slice(offset,offset+500);}
      if(options.method==='post') {
        if(remote.rows.length) return {getResponseCode:()=>409,getContentText:()=>''};
        remote.rows=JSON.parse(options.payload).p_rows;result=remote.rows.length;
        if(remote.timeoutAfterImport) throw new Error('timeout after successful commit');
      }
      if(options.method==='delete') {
        const params=new URL(url).searchParams;
        remote.rows=remote.rows.filter(row=>row.id!==params.get('id').slice(3)||row.version!==Number(params.get('version').slice(3)));
      }
      return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(result)};
    }},
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }), flush() {} },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    Utilities: {
      computeHmacSha256Signature: (data, key) => [...crypto.createHmac('sha256', key).update(data).digest()],
      base64Decode: value => [...Buffer.from(value, 'base64')], base64Encode: value => Buffer.from(value).toString('base64'),
      newBlob: (bytes, type, name) => ({ bytes, name, getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
    },
    DriveApp: { Access: { PRIVATE: 'PRIVATE' }, getFolderById: () => folder, getFileById: id => { if(id==='sheet-id') return {makeCopy:()=>({getId:()=>`backup-${++remote.backups}`})}; if (!files.has(id)) throw new Error('File not found'); return files.get(id); } },
    Drive: { Files: {
      get: id => { if (!files.has(id)) throw new Error('404 File not found'); return { id, parents: ['private-folder'] }; },
      remove: id => { if (failed.has(id)) throw new Error('temporary Drive failure'); files.delete(id); deleted.push(id); },
    } },
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(__dirname, '../apps/mizkiandkaren/google/Code.gs'), 'utf8'), context);
  vm.runInContext(readFileSync(path.join(__dirname, '../apps/mizkiandkaren/google/Supabase.gs'), 'utf8'), context);
  function call(payload, wrongSignature = false) {
    const envelope = { timestamp: String(Math.floor(Date.now() / 1000)), nonce: crypto.randomBytes(16).toString('hex'), payload: Buffer.from(JSON.stringify(payload)).toString('base64') };
    envelope.signature = crypto.createHmac('sha256', secret).update(`${envelope.timestamp}\n${envelope.nonce}\n${envelope.payload}`).digest('hex');
    if (wrongSignature) envelope.signature = '0'.repeat(64);
    return JSON.parse(context.doPost({ postData: { contents: JSON.stringify(envelope) } }).text);
  }
  return { context, rows, files, deleted, failed, call, props, remote };
}
const sample = () => ({ id: crypto.randomUUID(), deleted_at: null, payload: { title: '海辺のカフェ', note: 'ふたりで', has_idea_photo: false, has_memory_photo: false } });
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]).toString('base64');

test('anonymous and incorrectly signed requests reveal no rows', () => {
  const h = harness();
  assert.equal(JSON.parse(h.context.doGet().text).ok, false);
  assert.equal(h.call({ action: 'list' }, true).error, 'unauthorized');
  assert.equal(h.rows.length, 1);
});
test('signed UTF-8 create/read and version conflict preserve the first edit', () => {
  const h = harness(), record = sample();
  assert.equal(h.call({ action: 'save', record, expected: 0 }).result.version, 1);
  const first = { ...record, payload: { ...record.payload, note: '最初の端末の変更' } };
  assert.equal(h.call({ action: 'save', record: first, expected: 1 }).result.version, 2);
  assert.equal(h.call({ action: 'save', record, expected: 1 }).error, 'conflict');
  assert.equal(h.call({ action: 'list' }).result[0].payload.note, '最初の端末の変更');
});
test('idea and memory each hold one photo and replacements delete only the old slot', () => {
  const h = harness(), record = sample();
  h.call({ action: 'save', record, expected: 0, photos: { idea: webp, memory: webp } });
  const firstIdea = h.rows[1][4], firstMemory = h.rows[1][5];
  assert.equal(h.files.size, 2);
  assert.equal(h.call({ action: 'photo', id: record.id, kind: 'memory' }).result, webp);
  h.call({ action: 'save', record, expected: 1, photos: { idea: webp } });
  assert.equal(h.files.size, 2); assert.ok(h.deleted.includes(firstIdea));
  assert.equal(h.rows[1][5], firstMemory);
});
test('30-day expiry blocks reads and restores, then permanently removes both photos', () => {
  const h = harness(), record = sample();
  h.call({ action: 'save', record, expected: 0, photos: { idea: webp, memory: webp } });
  h.rows[1][2] = new Date(Date.now() - 31 * 86400000).toISOString();
  assert.equal(h.call({ action: 'list' }).result.length, 0);
  assert.equal(h.call({ action: 'photo', id: record.id, kind: 'idea' }).result, null);
  assert.equal(h.call({ action: 'save', record, expected: 1 }).error, 'conflict');
  h.context.purgeExpiredJournal();
  assert.equal(h.rows.length, 1); assert.equal(h.files.size, 0); assert.equal(h.deleted.length, 2);
});
test('a failed second-photo purge is retried without losing the record or deleting it early', () => {
  const h = harness(), record = sample();
  h.call({ action: 'save', record, expected: 0, photos: { idea: webp, memory: webp } });
  h.context.purgeExpiredJournal(); assert.equal(h.files.size, 2);
  h.rows[1][2] = new Date(Date.now() - 31 * 86400000).toISOString();
  h.failed.add(h.rows[1][5]);
  assert.throws(() => h.context.purgeExpiredJournal(), /temporary Drive failure/);
  assert.equal(h.rows.length, 2); assert.equal(h.files.size, 1);
  h.failed.clear(); h.context.purgeExpiredJournal();
  assert.equal(h.rows.length, 1); assert.equal(h.files.size, 0);
});

test('migration backs up and preserves every field, photo ID and version; old writes stop', () => {
  const h=harness(), record=sample();
  h.call({action:'save',record,expected:0,photos:{idea:webp,memory:webp}});
  const source=JSON.stringify(h.rows);
  h.remote.timeoutAfterImport=true;
  h.context.migrateJournalToSupabase();
  assert.equal(h.remote.backups,1);
  assert.equal(h.remote.rows.length,1);
  assert.equal(h.remote.rows[0].idea_photo_id,h.rows[1][4]);
  assert.equal(h.remote.rows[0].memory_photo_id,h.rows[1][5]);
  assert.deepEqual(h.remote.rows[0].payload,JSON.parse(h.rows[1][3]));
  assert.equal(h.props.MK_SUPABASE_MIGRATED,'yes');
  assert.equal(h.call({action:'save',record,expected:1}).error,'unavailable');
  h.context.migrateJournalToSupabase();
  assert.equal(h.remote.backups,1); assert.equal(JSON.stringify(h.rows),source);
});

test('migration refuses a nonempty different destination without freezing source or overwriting', () => {
  const h=harness(); h.remote.rows=[{...sample(),version:1}];
  assert.throws(()=>h.context.migrateJournalToSupabase(),/上書きせず停止/);
  assert.equal(h.remote.backups,0); assert.equal(h.props.MK_STORAGE_BACKEND,undefined);
  assert.equal(h.remote.requests.filter(r=>r.options.method==='post').length,0);
});

test('failed import remains read-only and can be retried without another backup', () => {
  const h=harness(), record=sample(); h.call({action:'save',record,expected:0});
  const fetch=h.context.UrlFetchApp.fetch;
  h.context.UrlFetchApp.fetch=(url,options)=>options.method==='post'?{getResponseCode:()=>500,getContentText:()=>''}:fetch(url,options);
  assert.throws(()=>h.context.migrateJournalToSupabase(),/移行結果が一致/);
  assert.equal(h.props.MK_STORAGE_BACKEND,'supabase'); assert.equal(h.props.MK_SUPABASE_MIGRATED,undefined);
  const requests=h.remote.requests.length; h.context.purgeExpiredJournal();
  assert.equal(h.remote.requests.length,requests); // An incomplete migration cannot collect source photos.
  h.context.UrlFetchApp.fetch=fetch; h.context.migrateJournalToSupabase();
  assert.equal(h.props.MK_SUPABASE_MIGRATED,'yes'); assert.equal(h.remote.backups,1);
});

test('private immutable photo uploads need signed requests and work without the sheet', () => {
  const h=harness(), record=sample();
  assert.equal(h.call({action:'upload_file',id:record.id,kind:'idea',data:webp}).error,'unavailable');
  h.props.MK_STORAGE_BACKEND='supabase';
  h.props.MK_SUPABASE_MIGRATED='yes';
  assert.equal(h.call({action:'upload_file',id:record.id,kind:'idea',data:webp},true).error,'unauthorized');
  h.context.SpreadsheetApp.openById=()=>{throw new Error('must not read sheet');};
  const first=h.call({action:'upload_file',id:record.id,kind:'idea',data:webp}).result;
  const second=h.call({action:'upload_file',id:record.id,kind:'idea',data:webp}).result;
  assert.notEqual(first,second); assert.equal(h.files.size,2);
  assert.equal(h.call({action:'read_file',file_id:first}).result,webp);
  assert.equal(h.call({action:'upload_file',id:record.id,kind:'idea',data:'bm90IGEgcGhvdG8='}).error,'invalid');
  const original=h.files.get(first);
  h.files.set(first,{...original,getParents:()=>({hasNext:()=>false})});
  assert.equal(h.call({action:'read_file',file_id:first}).error,'invalid');
});

test('Supabase purge protects referenced photos, retries failed removal and stops on DB failure', () => {
  const h=harness(), record=sample();
  h.call({action:'save',record,expected:0,photos:{idea:webp,memory:webp}});
  h.context.migrateJournalToSupabase();
  h.remote.failed=true;
  assert.throws(()=>h.context.purgeExpiredJournal(),/unavailable/);
  assert.equal(h.files.size,2);
  h.remote.failed=false;
  h.remote.rows[0].deleted_at=new Date(Date.now()-31*86400000).toISOString();
  h.failed.add(h.rows[1][5]);
  assert.throws(()=>h.context.purgeExpiredJournal(),/temporary Drive failure/);
  assert.equal(h.remote.rows.length,1); assert.equal(h.files.size,1);
  h.failed.clear();h.context.purgeExpiredJournal();
  assert.equal(h.remote.rows.length,0); assert.equal(h.files.size,0);
  assert.equal(h.rows.length,2); // Original sheet remains a backup, never authoritative.
});

test('orphan collection uses Supabase references and grants fresh uploads a 24h commit window', () => {
  const h=harness(), record=sample();
  h.call({action:'save',record,expected:0,photos:{idea:webp}});
  h.context.migrateJournalToSupabase();
  const referenced=h.rows[1][4];
  const orphan=h.call({action:'upload_file',id:record.id,kind:'memory',data:webp}).result;
  const fresh=h.call({action:'upload_file',id:record.id,kind:'memory',data:webp}).result;
  for(const id of [referenced,orphan]) h.files.set(id,{...h.files.get(id),getDateCreated:()=>new Date(Date.now()-2*86400000)});
  h.rows[1][4]='';h.rows[1][5]=orphan; // Old sheet intentionally disagrees.
  h.context.purgeExpiredJournal();
  assert.equal(h.files.has(referenced),true); assert.equal(h.files.has(orphan),false); assert.equal(h.files.has(fresh),true);
});
