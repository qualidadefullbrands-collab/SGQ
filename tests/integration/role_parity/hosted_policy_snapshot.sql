-- SGQ quality-policy parity fixture, 2026-11-14.
-- Policy expressions and role resolver below were inspected read-only from the
-- hosted SGQ pg_policies / pg_get_functiondef at this date. Business rows,
-- identities, and tables are synthetic/minimal; never apply this file to prod.
\set ON_ERROR_STOP on

create schema if not exists private;
grant usage on schema private to authenticated;

create table public.profiles(
  id uuid primary key references auth.users(id),
  nome text, perfil text not null, ativo boolean not null default true
);
create table public.processos(
  id uuid primary key, codigo text not null, cliente text,
  status text not null default 'aberto'
);
create table public.inspecoes(
  id uuid primary key, numero text not null, status text not null default 'aberta'
);
create table public.inspecao_fotos(
  id uuid primary key, inspecao_id uuid not null references public.inspecoes(id),
  storage_path text not null, legenda text
);
alter table public.profiles enable row level security;
alter table public.processos enable row level security;
alter table public.inspecoes enable row level security;
alter table public.inspecao_fotos enable row level security;

-- Hosted SGQ has table privileges for anon/authenticated but relies on RLS.
-- Keep SQL GRANTs permissive so tests detect a missing policy.
grant select,insert,update,delete on public.profiles, public.processos,
  public.inspecoes, public.inspecao_fotos to anon,authenticated;

-- Exact SQL definition of private.current_sgq_role() as inspected (14 Nov).
CREATE OR REPLACE FUNCTION private.current_sgq_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p.perfil
  from public.profiles p
  where p.id = auth.uid() and p.ativo = true
  limit 1
$function$;
revoke all on function private.current_sgq_role() from PUBLIC,anon;
grant execute on function private.current_sgq_role() to authenticated;

-- These role predicates match hosted pg_policies on processes, inspections and
-- inspection-photos. Do not substitute owner_id=auth.uid(): SGQ is team based.
do $$
declare tbl text;
begin
  foreach tbl in array array['processos','inspecoes','inspecao_fotos']
  loop
    execute format(
      'create policy sgq_select on public.%I for select to authenticated using (private.current_sgq_role() = ANY (ARRAY[''administrador''::text, ''inspetor''::text, ''gestor''::text, ''consulta''::text]))',
      tbl);
    execute format(
      'create policy sgq_insert on public.%I for insert to authenticated with check (private.current_sgq_role() = ANY (ARRAY[''administrador''::text, ''inspetor''::text, ''gestor''::text]))',
      tbl);
    execute format(
      'create policy sgq_update on public.%I for update to authenticated using (private.current_sgq_role() = ANY (ARRAY[''administrador''::text, ''inspetor''::text, ''gestor''::text])) with check (private.current_sgq_role() = ANY (ARRAY[''administrador''::text, ''inspetor''::text, ''gestor''::text]))',
      tbl);
    execute format(
      'create policy sgq_delete on public.%I for delete to authenticated using (private.current_sgq_role() = ANY (ARRAY[''administrador''::text, ''gestor''::text]))',
      tbl);
  end loop;
end $$;

-- Hosted profiles policy: anyone with a profile sees their own row; only
-- administrator/gestor sees other profiles; only admin edits profiles.
create policy profiles_select on public.profiles for select to authenticated
using ((id = (select auth.uid())) or
  private.current_sgq_role() = ANY (ARRAY['administrador'::text, 'gestor'::text]));
create policy profiles_admin_update on public.profiles for update to authenticated
using (private.current_sgq_role() = 'administrador'::text)
with check (private.current_sgq_role() = 'administrador'::text);

-- Hosted bucket metadata on 14 Nov: private and no bucket-specific file/mime
-- limits. We do NOT change the hosted bucket; these are local values only.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('inspecao-fotos','inspecao-fotos',false,null,null)
on conflict(id) do update set public=false,file_size_limit=null,
  allowed_mime_types=null;

-- Hosted sgq_inspecao_fotos_* Storage policies (no UPDATE policy).
create policy sgq_inspecao_fotos_insert on storage.objects
  for insert to authenticated
  with check ((bucket_id = 'inspecao-fotos'::text) and
    (private.current_sgq_role() = any
      (array['administrador'::text, 'inspetor'::text, 'gestor'::text])));
create policy sgq_inspecao_fotos_select on storage.objects
  for select to authenticated
  using ((bucket_id = 'inspecao-fotos'::text) and
    (private.current_sgq_role() = any
      (array['administrador'::text, 'inspetor'::text, 'gestor'::text, 'consulta'::text])));
create policy sgq_inspecao_fotos_delete on storage.objects
  for delete to authenticated
  using ((bucket_id = 'inspecao-fotos'::text) and
    (private.current_sgq_role() = any
      (array['administrador'::text, 'gestor'::text])));

-- Placeholder identities are UUIDs supplied by local GoTrue ONLY.
insert into public.profiles(id,nome,perfil,ativo) values
 ('__ADMIN__','QA Admin','administrador',true),
 ('__MANAGER__','QA Gestor','gestor',true),
 ('__INSPECTOR__','QA Inspetor','inspetor',true),
 ('__CONSULT__','QA Consulta','consulta',true),
 ('__DISABLED__','QA Inativo','consulta',false);
insert into public.processos(id,codigo,cliente) values
 ('11111111-1111-4111-8111-111111111111','FST-QA-ROLE','Cliente QA sintético'),
 ('22222222-2222-4222-8222-222222222222','FST-QA-OUTRO','Outro cliente QA');
insert into public.inspecoes(id,numero,status) values
 ('33333333-3333-4333-8333-333333333333','INS-QA-ROLE','concluida');
insert into public.inspecao_fotos(id,inspecao_id,storage_path,legenda) values
 ('44444444-4444-4444-8444-444444444444',
  '33333333-3333-4333-8333-333333333333',
  'qa/roles/comprovante.png','Foto sintética de inspeção');

notify pgrst, 'reload schema';
select pg_sleep(1);

-- Real catalog check: wrong "extra" UPDATE policy would invalidate this.
do $$
begin
  if (select count(*) from pg_policies
      where schemaname='storage' and tablename='objects'
        and policyname like 'sgq_inspecao_fotos_%') != 3 then
    raise exception 'QC invalid storage policy count';
  end if;
end $$;
