import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

// Run locally by GitHub Actions AFTER 'supabase start' in an ephemeral folder.
// Reads the real STORAGE policies from the checked-in inventory migration.
// Never uses the project hosted at *.supabase.co.
const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261113080000_sgq_inventario_cego_omie_fotos.sql'), 'utf8',
)
const from = migration.indexOf('insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)')
const to = migration.indexOf('-- Reopen/editing a closed count', from)
assert(from >= 0 && to > from, 'Storage policy section must be present in the real SGQ migration')
const realStoragePolicies = migration.slice(from, to)
for (const text of [
  'sgq_inventario_cego_fotos_insert', 'sgq_inventario_cego_fotos_select',
  "bucket_id='sgq-inventario-cego'", 'private.current_sgq_role()',
]) assert(realStoragePolicies.includes(text), 'Missing SGQ storage contract: ' + text)

const fixture = `
-- Local test fixtures ONLY. \"private.current_sgq_role\" is simulated;
-- the storage policy SQL below is imported verbatim from SGQ migration.
create schema if not exists private;
grant usage on schema private to authenticated;

create table public.sgq_qc_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  perfil text not null check (perfil in ('gestor','inspetor','consulta'))
);
revoke all on public.sgq_qc_roles from PUBLIC, anon, authenticated;

create function private.current_sgq_role() returns text
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select r.perfil from public.sgq_qc_roles r
  where r.user_id = (select auth.uid())
$$;
revoke all on function private.current_sgq_role() from PUBLIC, anon;
grant execute on function private.current_sgq_role() to authenticated;

create table public.sgq_inventarios_cegos (
  id uuid primary key,
  status text not null check(status in ('aberto','fechado','cancelado'))
);
alter table public.sgq_inventarios_cegos enable row level security;
revoke all on public.sgq_inventarios_cegos from PUBLIC,anon,authenticated;
grant select on public.sgq_inventarios_cegos to authenticated;
create policy sgq_qc_inventory_read on public.sgq_inventarios_cegos
  for select to authenticated using (
    private.current_sgq_role() in ('gestor','inspetor','consulta')
  );

-- Guard: do not expand grants of Storage objects beyond the stock Supabase stack.
` + realStoragePolicies

const pgurl = process.env.SGQ_QC_DB_URL
assert(pgurl, 'SGQ_QC_DB_URL must be set to local stack')
const db = new URL(pgurl)
assert(['127.0.0.1', 'localhost'].includes(db.hostname), 'Only LOCAL Supabase DB is allowed')
const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', pgurl], {
  input: fixture, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
})
if (result.status !== 0) {
  console.error(result.stderr || result.stdout)
  process.exit(result.status || 1)
}
console.log('SGQ_LOCAL_SCHEMA_PASS: original storage migration section loaded into ephemeral Supabase')
