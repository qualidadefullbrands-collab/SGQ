-- Inventário cego por código Omie. Nenhum saldo do ERP é copiado para estas tabelas.
-- A contagem jamais lança ajustes no Omie automaticamente.
create table if not exists public.sgq_inventarios_cegos (
 id uuid primary key default gen_random_uuid(),
 codigo text not null unique,
 endereco text not null default '',
 observacao text not null default '',
 status text not null default 'aberto' check (status in ('aberto','fechado','cancelado')),
 criado_por uuid not null references auth.users(id) on delete restrict,
 criado_em timestamptz not null default now(),
 fechado_por uuid references auth.users(id),
 fechado_em timestamptz
);

create table if not exists public.sgq_inventario_cego_itens (
 id uuid primary key default gen_random_uuid(),
 inventario_id uuid not null references public.sgq_inventarios_cegos(id) on delete restrict,
 codigo_omie text not null check(length(btrim(codigo_omie)) between 1 and 60),
 descricao_omie text not null check(length(btrim(descricao_omie)) between 2 and 240),
 endereco text not null default '',
 quantidade_contada numeric(18,3) not null check(quantidade_contada >= 0),
 observacao text not null default '',
 foto_storage_path text,
 foto_sgq_path text,
 foto_para_omie boolean not null default false,
 foto_status text not null default 'pendente' check(foto_status in ('pendente','enviando','sincronizada','erro')),
 foto_omie_url text,
 fotos_omie_anteriores jsonb,
 foto_omie_erro text,
 foto_omie_sincronizada_em timestamptz,
 foto_omie_sincronizada_por uuid references auth.users(id),
 criado_por uuid not null references auth.users(id) on delete restrict,
 criado_em timestamptz not null default now(),
 atualizado_em timestamptz not null default now(),
 unique(inventario_id,codigo_omie,endereco),
 constraint sgq_foto_para_omie_com_evidencia
 check(not foto_para_omie or foto_storage_path is not null)
);
create index if not exists sgq_inventario_cego_itens_sessao_idx
 on public.sgq_inventario_cego_itens(inventario_id,criado_em desc);
create index if not exists sgq_inventario_cego_itens_fotos_pendentes_idx
 on public.sgq_inventario_cego_itens(foto_status,criado_em)
 where foto_para_omie and foto_status <> 'sincronizada';

create table if not exists public.sgq_inventario_cego_foto_logs (
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.sgq_inventario_cego_itens(id) on delete restrict,
 executado_por uuid not null references auth.users(id),
 status text not null check(status in ('sincronizada','erro')),
 url_publicada text,
 imagens_anteriores jsonb,
 detalhe text,
 criado_em timestamptz not null default now()
);

alter table public.sgq_inventarios_cegos enable row level security;
alter table public.sgq_inventario_cego_itens enable row level security;
alter table public.sgq_inventario_cego_foto_logs enable row level security;
revoke all on public.sgq_inventarios_cegos,public.sgq_inventario_cego_itens,public.sgq_inventario_cego_foto_logs from anon,authenticated;
grant select,insert on public.sgq_inventarios_cegos to authenticated;
grant update(status,fechado_por,fechado_em) on public.sgq_inventarios_cegos to authenticated;
grant select,insert on public.sgq_inventario_cego_itens to authenticated;
grant update(quantidade_contada,observacao,foto_storage_path,foto_sgq_path,foto_para_omie,atualizado_em)
 on public.sgq_inventario_cego_itens to authenticated;
grant select on public.sgq_inventario_cego_foto_logs to authenticated;

drop policy if exists sgq_inventarios_cegos_select on public.sgq_inventarios_cegos;
create policy sgq_inventarios_cegos_select on public.sgq_inventarios_cegos
 for select to authenticated
 using(private.current_sgq_role() in ('administrador','gestor','inspetor','consulta'));
drop policy if exists sgq_inventarios_cegos_insert on public.sgq_inventarios_cegos;
create policy sgq_inventarios_cegos_insert on public.sgq_inventarios_cegos
 for insert to authenticated
 with check(criado_por=(select auth.uid()) and status='aberto'
  and private.current_sgq_role() in ('administrador','gestor','inspetor'));
drop policy if exists sgq_inventarios_cegos_update on public.sgq_inventarios_cegos;
create policy sgq_inventarios_cegos_update on public.sgq_inventarios_cegos
 for update to authenticated
 using(private.current_sgq_role() in ('administrador','gestor') and status='aberto')
 with check(private.current_sgq_role() in ('administrador','gestor') and status in ('fechado','cancelado'));

drop policy if exists sgq_inventario_cego_itens_select on public.sgq_inventario_cego_itens;
create policy sgq_inventario_cego_itens_select on public.sgq_inventario_cego_itens
 for select to authenticated
 using(private.current_sgq_role() in ('administrador','gestor','inspetor','consulta'));
drop policy if exists sgq_inventario_cego_itens_insert on public.sgq_inventario_cego_itens;
create policy sgq_inventario_cego_itens_insert on public.sgq_inventario_cego_itens
 for insert to authenticated
 with check(criado_por=(select auth.uid())
  and private.current_sgq_role() in ('administrador','gestor','inspetor')
  and foto_status='pendente' and foto_omie_url is null and foto_omie_sincronizada_em is null
  and exists(select 1 from public.sgq_inventarios_cegos s where s.id=inventario_id and s.status='aberto'));
drop policy if exists sgq_inventario_cego_itens_update on public.sgq_inventario_cego_itens;
create policy sgq_inventario_cego_itens_update on public.sgq_inventario_cego_itens
 for update to authenticated
 using(private.current_sgq_role() in ('administrador','gestor','inspetor')
  and foto_status='pendente'
  and exists(select 1 from public.sgq_inventarios_cegos s where s.id=inventario_id and s.status='aberto'))
 with check(private.current_sgq_role() in ('administrador','gestor','inspetor')
  and foto_status='pendente'
  and exists(select 1 from public.sgq_inventarios_cegos s where s.id=inventario_id and s.status='aberto'));

drop policy if exists sgq_inventario_cego_foto_logs_select on public.sgq_inventario_cego_foto_logs;
create policy sgq_inventario_cego_foto_logs_select on public.sgq_inventario_cego_foto_logs
 for select to authenticated using(private.current_sgq_role() in ('administrador','gestor'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('sgq-inventario-cego','sgq-inventario-cego',false,8388608,array['image/jpeg','image/png'])
on conflict (id) do update set public=false,file_size_limit=8388608,allowed_mime_types=array['image/jpeg','image/png'];

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('sgq-catalogo-omie','sgq-catalogo-omie',true,8388608,array['image/jpeg','image/png'])
on conflict (id) do update set public=true,file_size_limit=8388608,allowed_mime_types=array['image/jpeg','image/png'];
-- The public catalog bucket is written by the authenticated Edge Function using
-- server-side credentials. No INSERT/UPDATE permission is granted to end users.

drop policy if exists sgq_inventario_cego_fotos_insert on storage.objects;
create policy sgq_inventario_cego_fotos_insert on storage.objects
 for insert to authenticated
 with check(bucket_id='sgq-inventario-cego'
  and split_part(name,'/',1)=(select auth.uid())::text
  and exists(select 1 from public.sgq_inventarios_cegos s
    where s.id=split_part(name,'/',2)::uuid and s.status='aberto')
  and private.current_sgq_role() in ('administrador','gestor','inspetor'));
drop policy if exists sgq_inventario_cego_fotos_select on storage.objects;
create policy sgq_inventario_cego_fotos_select on storage.objects
 for select to authenticated
 using(bucket_id='sgq-inventario-cego'
  and private.current_sgq_role() in ('administrador','gestor','inspetor','consulta'));

-- Reopen/editing a closed count requires a separately reviewed process.
comment on table public.sgq_inventarios_cegos is
 'Contagem física sem saldo de sistema; não gera movimentação contábil ou de estoque.';
comment on table public.sgq_inventario_cego_itens is
 'SKU confirmado no Omie, contagem física e foto sugerida para aprovação antes de alterar o catálogo.';
