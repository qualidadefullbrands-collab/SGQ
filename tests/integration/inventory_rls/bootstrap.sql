-- PostgreSQL 16 real e descartável. Nenhuma massa ou credencial produtiva.
\set ON_ERROR_STOP on
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function private.current_sgq_role() returns text language sql stable as $$
  select nullif(current_setting('sgq_test.role', true), '')
$$;
grant usage on schema auth,private,public to authenticated;
grant execute on function auth.uid(),private.current_sgq_role() to authenticated;

create table public.processos (
 id uuid primary key,
 codigo text not null,
 excluido_em timestamptz
);
create table public.sgq_inventarios_cegos (
 id uuid primary key,
 status text not null,
 processo_codigo text,
 endereco text not null,
 cliente_nome text,
 dados_confirmados_em timestamptz
);
create table public.sgq_inventario_cego_itens (
 id uuid primary key,
 inventario_id uuid not null references public.sgq_inventarios_cegos(id),
 codigo_omie text not null,
 endereco text not null,
 processo_id uuid references public.processos(id),
 processo_codigo text,
 cliente_nome text,
 cliente_confirmado boolean not null,
 verificacao_cadastro jsonb,
 quantidade_contada numeric not null default 1,
 criado_por uuid not null,
 foto_status text not null default 'pendente',
 foto_omie_url text,
 foto_omie_sincronizada_em timestamptz
);
alter table public.sgq_inventario_cego_itens enable row level security;
grant select on public.sgq_inventarios_cegos,public.processos to authenticated;
grant select,insert,update on public.sgq_inventario_cego_itens to authenticated;
create policy test_select on public.sgq_inventario_cego_itens
for select to authenticated using (true);

insert into public.processos values ('99999999-9999-4999-8999-999999999999','FST99999-A',null);
insert into public.sgq_inventarios_cegos values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aberto','FST99999-A','RUA 01','CLIENTE ALFA',now()),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aberto',null,'ARM 00',null,null),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','fechado','FST99999-A','RUA 01','CLIENTE ALFA',now());
