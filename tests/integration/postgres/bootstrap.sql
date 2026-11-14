-- QA/QC SGQ: isolated PostgreSQL fixture. GitHub Actions creates and destroys
-- this database. These identities, roles and records are synthetic ONLY.
-- We intentionally run the *real checked-in migrations* after this bootstrap.
\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;

create schema auth;
create schema private;
create table auth.users (id uuid primary key);

create function auth.uid() returns uuid
language sql stable security invoker
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Test seam: emulate SGQ role resolver without copying production role
-- implementation or requiring real Supabase Auth. RLS/permissions are exercised
-- in PostgreSQL, but this fixture is NOT an end-to-end Auth/RLS attestation.
create function private.current_sgq_role() returns text
language sql stable security invoker
as $$
  select nullif(current_setting('sgq_test.role', true), '')
$$;

grant usage on schema auth, private, public to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function private.current_sgq_role() to authenticated;

create table public.sgq_inventarios_cegos (
  id uuid primary key,
  processo_codigo text,
  status text not null default 'aberto'
    check (status in ('aberto','fechado')),
  fechado_por uuid references auth.users(id),
  fechado_em timestamptz
);

create table public.sgq_inventario_cego_itens (
  id uuid primary key,
  inventario_id uuid not null references public.sgq_inventarios_cegos(id),
  quantidade_contada numeric(18,3) not null check (quantidade_contada >= 0)
);

-- All row identifiers are visibly synthetic; no production data is replicated.
insert into auth.users (id) values
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222'),
 ('33333333-3333-4333-8333-333333333333');

insert into public.sgq_inventarios_cegos (id, processo_codigo) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'FST99999-A'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'FST99999-B'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'FST99998-A');

insert into public.sgq_inventario_cego_itens (id,inventario_id,quantidade_contada) values
 ('aaaaaaaa-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 12.500),
 ('bbbbbbbb-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 10.000);

-- Test-only request context, never an authorization substitute in production.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config('sgq_test.role', 'gestor', false);
