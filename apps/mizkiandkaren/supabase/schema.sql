-- Run the entire file in Supabase SQL Editor. No real dates or credentials here.
-- Only the server's secret/service_role key can read or write journal records.
begin;

create table if not exists public.mk_ideas (
  id uuid primary key,
  version integer not null check (version > 0),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object' and payload ? 'title'
    and jsonb_typeof(payload->'title') = 'string'
    and length(btrim(payload->>'title')) between 1 and 120
  ),
  deleted_at timestamptz,
  idea_photo_id text,
  memory_photo_id text
);
create index if not exists mk_ideas_deleted_at_idx on public.mk_ideas(deleted_at)
  where deleted_at is not null;
alter table public.mk_ideas enable row level security;
revoke all on public.mk_ideas from public, anon, authenticated;
grant select, insert, update, delete on public.mk_ideas to service_role;

create or replace function public.mk_save_idea(
  p_id uuid, p_expected integer, p_payload jsonb, p_deleted_at timestamptz,
  p_idea_photo_id text, p_memory_photo_id text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved public.mk_ideas;
begin
  p_payload := p_payload || jsonb_build_object(
    'has_idea_photo', p_idea_photo_id is not null,
    'has_memory_photo', p_memory_photo_id is not null);
  if p_expected = 0 then
    insert into public.mk_ideas(id, version, payload, deleted_at, idea_photo_id, memory_photo_id)
      values(p_id, 1, p_payload, p_deleted_at, p_idea_photo_id, p_memory_photo_id)
      on conflict do nothing returning * into saved;
  elsif p_expected > 0 then
    update public.mk_ideas set version = version + 1, payload = p_payload,
      deleted_at = p_deleted_at, idea_photo_id = p_idea_photo_id, memory_photo_id = p_memory_photo_id
      where id = p_id and version = p_expected
        and (deleted_at is null or deleted_at > now() - interval '30 days')
      returning * into saved;
  end if;
  if saved.id is null then
    raise sqlstate 'PT409' using message = 'conflict';
  end if;
  return to_jsonb(saved);
end;
$$;

-- One atomic import into an EMPTY destination. Never overwrite live records.
create or replace function public.mk_import_ideas(p_rows jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare imported integer;
begin
  lock table public.mk_ideas in exclusive mode;
  if exists(select 1 from public.mk_ideas) then
    raise sqlstate 'PT409' using message = 'destination_not_empty';
  end if;
  insert into public.mk_ideas(id, version, payload, deleted_at, idea_photo_id, memory_photo_id)
    select id, version, payload, deleted_at, idea_photo_id, memory_photo_id
    from jsonb_to_recordset(p_rows) as r(id uuid, version integer, payload jsonb,
      deleted_at timestamptz, idea_photo_id text, memory_photo_id text);
  get diagnostics imported = row_count;
  return imported;
end;
$$;

revoke all on function public.mk_save_idea(uuid, integer, jsonb, timestamptz, text, text)
  from public, anon, authenticated;
revoke all on function public.mk_import_ideas(jsonb) from public, anon, authenticated;
grant execute on function public.mk_save_idea(uuid, integer, jsonb, timestamptz, text, text)
  to service_role;
grant execute on function public.mk_import_ideas(jsonb) to service_role;
commit;
