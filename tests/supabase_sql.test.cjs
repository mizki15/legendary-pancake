const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {PGlite} = require('@electric-sql/pglite');

const id = '1d3650ac-a84f-4b51-b45f-a3eea5a4f917';
test('Postgres schema: private permissions, atomic import, CAS and expired restore', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
    const sql = readFileSync('apps/mizkiandkaren/supabase/schema.sql','utf8');
    await db.exec(sql); await db.exec(sql); // Safe to rerun schema setup.
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from public.mk_ideas'), /permission denied/);
      await assert.rejects(db.query('select public.mk_import_ideas($1::jsonb)', ['[]']), /permission denied/);
      await assert.rejects(db.query('select public.mk_save_idea($1,0,$2,null,null,null)', [id,'{"title":"private"}']), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const original={id,version:7,payload:{title:'海辺のカフェ',note:'ふたりで',has_idea_photo:true,has_memory_photo:false},deleted_at:null,idea_photo_id:'drive-original',memory_photo_id:null};
    await db.query('select public.mk_import_ideas($1::jsonb)',[JSON.stringify([original])]);
    assert.deepEqual((await db.query('select * from public.mk_ideas')).rows[0],original);
    await assert.rejects(db.query('select public.mk_import_ideas($1::jsonb)',[JSON.stringify([original])]),/destination_not_empty/);
    const save=(version,payload,date=null,photo=null)=>db.query('select public.mk_save_idea($1,$2,$3::jsonb,$4,$5,null) as saved',[id,version,JSON.stringify(payload),date,photo]);
    const saved=(await save(7,{title:'海辺のカフェ',favorite:true},null,'new-photo')).rows[0].saved;
    assert.equal(saved.version,8); assert.equal(saved.payload.has_idea_photo,true);
    await assert.rejects(save(7,{title:'古い端末'}),/conflict/);
    await assert.rejects(save(0,{title:'重複'}),/conflict/);
    assert.equal((await db.query('select payload from public.mk_ideas')).rows[0].payload.favorite,true);
    await assert.rejects(save(8,{}),/check constraint/);
    assert.equal((await db.query('select version from public.mk_ideas')).rows[0].version,8);
    const removed=(await save(8,{title:'海辺のカフェ'})).rows[0].saved;
    assert.equal(removed.idea_photo_id,null); assert.equal(removed.payload.has_idea_photo,false);
    await db.exec("update public.mk_ideas set deleted_at=now()-interval '31 days'");
    await assert.rejects(save(9,{title:'期限切れの復元'}),/conflict/);
  } finally {await db.close();}
});
