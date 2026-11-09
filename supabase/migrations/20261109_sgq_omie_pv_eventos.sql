-- SGQ: fila Omie para pré-cadastro de inspeções (não altera processos já existentes).
-- Executada em produção pelo MCP Supabase na migração sgq_omie_pv_eventos_pre_cadastros_alertas.
-- Não registre o token secreto nesta migração. Configure o SHA-256 em ambiente administrativo.
create table if not exists public.sgq_omie_webhook_config (
  app_hash text primary key,
  token_sha256 text not null check (length(token_sha256)=64),
  criado_em timestamptz not null default now()
);
alter table public.sgq_omie_webhook_config enable row level security;

create table if not exists public.sgq_omie_eventos (
  message_id text primary key,
  app_hash text not null,
  topic text not null,
  omie_codigo_pedido bigint,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'recebido'
    check (status in ('recebido','processando','processado','erro','ignorado')),
  erro text,
  recebido_em timestamptz not null default now(),
  processado_em timestamptz
);
alter table public.sgq_omie_eventos enable row level security;
create index if not exists sgq_omie_eventos_status_idx
  on public.sgq_omie_eventos(status,recebido_em);

create table if not exists public.sgq_omie_pedidos (
  id uuid primary key default gen_random_uuid(),
  app_hash text not null,
  omie_codigo_pedido bigint not null unique,
  numero_pedido text not null,
  codigo_cliente_omie bigint,
  cliente text,
  codigo_projeto_omie bigint,
  fst_referencia text,
  status text not null default 'novo'
    check(status in ('novo','alterado','cancelado','pendente_dados','erro')),
  itens jsonb not null default '[]'::jsonb,
  numero_itens integer not null default 0,
  origem_omie text,
  ultimo_evento text,
  erro text,
  recebido_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.sgq_omie_pedidos enable row level security;
create index if not exists sgq_omie_pedidos_criado_idx on public.sgq_omie_pedidos(recebido_em desc);
create index if not exists sgq_omie_pedidos_fst_idx on public.sgq_omie_pedidos(fst_referencia);

drop policy if exists sgq_omie_pedidos_leitura_qualidade on public.sgq_omie_pedidos;
create policy sgq_omie_pedidos_leitura_qualidade
on public.sgq_omie_pedidos for select to authenticated using(
  exists (select 1 from public.profiles p
    where p.id=(select auth.uid()) and p.ativo is true
      and p.perfil in ('administrador','gestor','inspetor'))
);
create table if not exists public.sgq_omie_pedidos_lidos (
  pedido_id uuid not null references public.sgq_omie_pedidos(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  lido_em timestamptz not null default now(),
  primary key (pedido_id,usuario_id)
);
alter table public.sgq_omie_pedidos_lidos enable row level security;
drop policy if exists sgq_omie_lidos_select on public.sgq_omie_pedidos_lidos;
drop policy if exists sgq_omie_lidos_insert on public.sgq_omie_pedidos_lidos;
create policy sgq_omie_lidos_select on public.sgq_omie_pedidos_lidos
for select to authenticated using (usuario_id=(select auth.uid()));
create policy sgq_omie_lidos_insert on public.sgq_omie_pedidos_lidos
for insert to authenticated with check (
  usuario_id=(select auth.uid())
  and exists (select 1 from public.sgq_omie_pedidos p where p.id=pedido_id)
);
