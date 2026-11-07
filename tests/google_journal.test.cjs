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
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => ({ MK_SHARED_SECRET: secret, MK_SPREADSHEET_ID: 'sheet-id', MK_PHOTO_FOLDER_ID: 'private-folder' })[name] }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }), flush() {} },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    Utilities: {
      computeHmacSha256Signature: (data, key) => [...crypto.createHmac('sha256', key).update(data).digest()],
      base64Decode: value => [...Buffer.from(value, 'base64')], base64Encode: value => Buffer.from(value).toString('base64'),
      newBlob: (bytes, type, name) => ({ bytes, name, getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
    },
    DriveApp: { Access: { PRIVATE: 'PRIVATE' }, getFolderById: () => folder, getFileById: id => { if (!files.has(id)) throw new Error('File not found'); return files.get(id); } },
    Drive: { Files: {
      get: id => { if (!files.has(id)) throw new Error('404 File not found'); return { id, parents: ['private-folder'] }; },
      remove: id => { if (failed.has(id)) throw new Error('temporary Drive failure'); files.delete(id); deleted.push(id); },
    } },
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(__dirname, '../apps/mizkiandkaren/google/Code.gs'), 'utf8'), context);
  function call(payload, wrongSignature = false) {
    const envelope = { timestamp: String(Math.floor(Date.now() / 1000)), nonce: crypto.randomBytes(16).toString('hex'), payload: Buffer.from(JSON.stringify(payload)).toString('base64') };
    envelope.signature = crypto.createHmac('sha256', secret).update(`${envelope.timestamp}\n${envelope.nonce}\n${envelope.payload}`).digest('hex');
    if (wrongSignature) envelope.signature = '0'.repeat(64);
    return JSON.parse(context.doPost({ postData: { contents: JSON.stringify(envelope) } }).text);
  }
  return { context, rows, files, deleted, failed, call };
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
