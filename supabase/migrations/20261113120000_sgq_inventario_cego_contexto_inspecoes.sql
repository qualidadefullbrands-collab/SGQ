-- Inventário às cegas: contexto de processo/cliente, endereços físicos,
-- conferência documentada Omie x SGQ e laudos de inspeção por processo.
-- Nenhuma alteração automática de saldos, inspeções oficiais ou cadastros Omie.
alter table public.sgq_inventario_cego_itens
 add column if not exists processo_id uuid references public.processos(id) on delete restrict,
 add column if not exists processo_codigo text,
 add column if not exists cliente_nome text,
 add column if not exists cliente_confirmado boolean not null default false,
 add column if not exists verificacao_cadastro jsonb,
 add column if not exists endereco_armario text not null default '',
 add column if not exists endereco_prateleira text not null default '',
 add column if not exists endereco_caixa text not null default '';

-- The same SKU/location may belong to different confirmed processes.
alter table public.sgq_inventario_cego_itens
 drop constraint if exists sgq_inventario_cego_itens_inventario_id_codigo_omie_enderec_key;
create unique index if not exists sgq_inventario_cego_item_process_location
 on public.sgq_inventario_cego_itens(inventario_id,codigo_omie,endereco,processo_id)
 nulls not distinct;

alter table public.sgq_inventario_cego_itens
 add constraint sgq_inv_cliente_confirmacao
 check(cliente_nome is null or length(btrim(cliente_nome)) between 1 and 180),
 add constraint sgq_inv_processo_codigo
 check(processo_codigo is null or length(btrim(processo_codigo)) between 3 and 40),
 add constraint sgq_inv_endereco_campos
 check(length(endereco)<=120 and length(endereco_armario)<=100 and length(endereco_prateleira)<=100 and length(endereco_caixa)<=100),
 add constraint sgq_inv_verificacao_object
 check(verificacao_cadastro is null or jsonb_typeof(verificacao_cadastro)='object');

grant update(processo_id,processo_codigo,cliente_nome,cliente_confirmado,verificacao_cadastro,
 endereco_armario,endereco_prateleira,endereco_caixa) on public.sgq_inventario_cego_itens to authenticated;

-- A physical count must carry a real, active SGQ process, confirmed client,
-- address and a recorded comparison against Omie. Existing history remains readable.
drop policy if exists sgq_inventario_cego_itens_insert on public.sgq_inventario_cego_itens;
create policy sgq_inventario_cego_itens_insert on public.sgq_inventario_cego_itens
 for insert to authenticated
 with check(criado_por=(select auth.uid())
  and private.current_sgq_role() in ('administrador','gestor','inspetor')
  and foto_status='pendente' and foto_omie_url is null and foto_omie_sincronizada_em is null
  and length(btrim(endereco)) > 0
  and cliente_confirmado and length(btrim(coalesce(cliente_nome,''))) > 0
  and verificacao_cadastro is not null
  and exists (select 1 from public.processos p
   where p.id=processo_id and p.codigo=processo_codigo and p.excluido_em is null)
  and exists (select 1 from public.sgq_inventarios_cegos s
   where s.id=inventario_id and s.status='aberto'));

drop policy if exists sgq_inventario_cego_itens_update on public.sgq_inventario_cego_itens;
create policy sgq_inventario_cego_itens_update on public.sgq_inventario_cego_itens
 for update to authenticated
 using(private.current_sgq_role() in ('administrador','gestor','inspetor')
  and foto_status='pendente'
  and exists(select 1 from public.sgq_inventarios_cegos s where s.id=inventario_id and s.status='aberto'))
 with check(private.current_sgq_role() in ('administrador','gestor','inspetor')
  and foto_status='pendente'
  and length(btrim(endereco)) > 0
  and cliente_confirmado and length(btrim(coalesce(cliente_nome,''))) > 0
  and verificacao_cadastro is not null
  and exists (select 1 from public.processos p
   where p.id=processo_id and p.codigo=processo_codigo and p.excluido_em is null)
  and exists(select 1 from public.sgq_inventarios_cegos s where s.id=inventario_id and s.status='aberto'));

-- Inspection evidence belongs to the selected SGQ process and blind session,
-- without altering the official inspecoes table.
create table if not exists public.sgq_inventario_cego_inspecoes (
 id uuid primary key default gen_random_uuid(),
 inventario_id uuid not null references public.sgq_inventarios_cegos(id) on delete restrict,
 processo_id uuid not null references public.processos(id) on delete restrict,
 arquivo_nome text not null check(length(btrim(arquivo_nome)) between 1 and 200),
 mime_type text not null check(mime_type in (
  'application/pdf','image/jpeg','image/png','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
 storage_path text not null unique,
 observacao text not null default '' check(length(observacao)<=1000),
 criado_por uuid not null references auth.users(id) on delete restrict,
 criado_em timestamptz not null default now(),
 constraint sgq_inventario_cego_inspecoes_path_check check(
  split_part(storage_path,'/',1)=criado_por::text
  and split_part(storage_path,'/',2)=inventario_id::text
  and split_part(storage_path,'/',3)=processo_id::text
  and length(split_part(storage_path,'/',4))>5
  and split_part(storage_path,'/',5)=''
 )
);
create index if not exists sgq_inventario_inspecoes_by_process
 on public.sgq_inventario_cego_inspecoes(inventario_id,processo_id,criado_em desc);
alter table public.sgq_inventario_cego_inspecoes enable row level security;
revoke all on public.sgq_inventario_cego_inspecoes from anon,authenticated;
grant select,insert on public.sgq_inventario_cego_inspecoes to authenticated;
drop policy if exists sgq_inventario_cego_inspecoes_select on public.sgq_inventario_cego_inspecoes;
create policy sgq_inventario_cego_inspecoes_select on public.sgq_inventario_cego_inspecoes
 for select to authenticated using(private.current_sgq_role() in ('administrador','gestor','inspetor','consulta'));
drop policy if exists sgq_inventario_cego_inspecoes_insert on public.sgq_inventario_cego_inspecoes;
create policy sgq_inventario_cego_inspecoes_insert on public.sgq_inventario_cego_inspecoes
 for insert to authenticated
 with check(criado_por=(select auth.uid())
  and private.current_sgq_role() in ('administrador','gestor','inspetor')
  and exists(select 1 from public.sgq_inventarios_cegos s where s.id=inventario_id and s.status='aberto')
  and exists(select 1 from public.processos p where p.id=processo_id and p.excluido_em is null));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('sgq-inventario-inspecoes','sgq-inventario-inspecoes',false,15728640,array[
 'application/pdf','image/jpeg','image/png','application/msword',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public=false,file_size_limit=15728640,
 allowed_mime_types=array['application/pdf','image/jpeg','image/png','application/msword',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

drop policy if exists sgq_inventario_inspecoes_storage_insert on storage.objects;
create policy sgq_inventario_inspecoes_storage_insert on storage.objects
 for insert to authenticated with check(bucket_id='sgq-inventario-inspecoes'
  and split_part(name,'/',1)=(select auth.uid())::text
  and private.current_sgq_role() in ('administrador','gestor','inspetor')
  and exists(select 1 from public.sgq_inventarios_cegos s
    where s.id::text=split_part(name,'/',2) and s.status='aberto')
  and exists(select 1 from public.processos p
    where p.id::text=split_part(name,'/',3) and p.excluido_em is null)
  and split_part(name,'/',5)='');
drop policy if exists sgq_inventario_inspecoes_storage_select on storage.objects;
create policy sgq_inventario_inspecoes_storage_select on storage.objects
 for select to authenticated using(bucket_id='sgq-inventario-inspecoes'
  and private.current_sgq_role() in ('administrador','gestor','inspetor','consulta'));

comment on table public.sgq_inventario_cego_inspecoes is
 'Anexos de inspeção por processo e sessão de inventário cego, sem alterar laudos oficiais.';
