-- Tela única: sessão por localização e processo; evidência de NF/cliente;
-- fotos independentes por contagem, enviadas para o SKU correspondente no Omie.
alter table public.sgq_inventarios_cegos
 add column if not exists processo_codigo text,
 add column if not exists nf_entrada text,
 add column if not exists data_nf date,
 add column if not exists cliente_nome text,
 add column if not exists nf_data_tipo text,
 add column if not exists dados_confirmados_em timestamptz;

alter table public.sgq_inventarios_cegos
 add constraint sgq_inv_unified_valid_process
 check (processo_codigo is null or processo_codigo ~ '^FST[0-9]{1,8}(-[A-Z0-9]+)?$'),
 add constraint sgq_inv_unified_nf
 check (nf_entrada is null or length(btrim(nf_entrada)) between 1 and 30),
 add constraint sgq_inv_unified_client
 check (cliente_nome is null or length(btrim(cliente_nome)) between 1 and 180),
 add constraint sgq_inv_unified_date_type
 check (nf_data_tipo is null or nf_data_tipo in ('registro_omie','emissao_omie','informada','chegada_sgq'));

create unique index if not exists sgq_inv_unified_open_process_address
 on public.sgq_inventarios_cegos (upper(processo_codigo),upper(endereco))
 where status='aberto' and processo_codigo is not null;

-- Previous SKU-only and confirmed SGQ process modes are preserved.
-- New Omie-process mode stores the exact FST code and the recorded validation,
-- even if the project is not yet registered as an SGQ process.
drop policy if exists sgq_inventario_cego_itens_insert on public.sgq_inventario_cego_itens;
create policy sgq_inventario_cego_itens_insert on public.sgq_inventario_cego_itens
 for insert to authenticated with check (
 criado_por=(select auth.uid())
 and private.current_sgq_role() in ('administrador','gestor','inspetor')
 and foto_status='pendente' and foto_omie_url is null and foto_omie_sincronizada_em is null
 and length(btrim(endereco))>0
 and exists (select 1 from public.sgq_inventarios_cegos s
   where s.id=inventario_id and s.status='aberto')
 and (
  (processo_id is null and processo_codigo is null and cliente_nome is null
    and cliente_confirmado is false and verificacao_cadastro is not null
    and verificacao_cadastro->>'modo'='codigo_omie'
    and upper(btrim(verificacao_cadastro->>'sku'))=upper(btrim(codigo_omie)))
  or
  (processo_id is not null and cliente_confirmado
    and length(btrim(coalesce(cliente_nome,'')))>0 and verificacao_cadastro is not null
    and exists(select 1 from public.processos p where p.id=processo_id
      and p.codigo=processo_codigo and p.excluido_em is null))
  or
  (processo_id is null and processo_codigo ~ '^FST[0-9]{1,8}(-[A-Z0-9]+)?$'
    and cliente_confirmado and length(btrim(coalesce(cliente_nome,'')))>0
    and verificacao_cadastro is not null
    and verificacao_cadastro->>'modo'='processo_omie'
    and verificacao_cadastro->>'processo'=processo_codigo
    and verificacao_cadastro->>'sku'=codigo_omie
    and exists(select 1 from public.sgq_inventarios_cegos s
      where s.id=inventario_id and s.processo_codigo=processo_codigo
      and s.endereco=endereco and s.cliente_nome=cliente_nome
      and s.dados_confirmados_em is not null))
 )
);
drop policy if exists sgq_inventario_cego_itens_update on public.sgq_inventario_cego_itens;
create policy sgq_inventario_cego_itens_update on public.sgq_inventario_cego_itens
 for update to authenticated
 using(private.current_sgq_role() in ('administrador','gestor','inspetor')
  and foto_status='pendente' and exists(select 1 from public.sgq_inventarios_cegos s
   where s.id=inventario_id and s.status='aberto'))
 with check(private.current_sgq_role() in ('administrador','gestor','inspetor')
  and foto_status='pendente' and length(btrim(endereco))>0
  and exists(select 1 from public.sgq_inventarios_cegos s
   where s.id=inventario_id and s.status='aberto')
  and (
   (processo_id is null and processo_codigo is null and cliente_nome is null
    and cliente_confirmado is false and verificacao_cadastro is not null
    and verificacao_cadastro->>'modo'='codigo_omie'
    and upper(btrim(verificacao_cadastro->>'sku'))=upper(btrim(codigo_omie)))
   or
   (processo_id is not null and cliente_confirmado
    and length(btrim(coalesce(cliente_nome,'')))>0 and verificacao_cadastro is not null
    and exists(select 1 from public.processos p where p.id=processo_id
     and p.codigo=processo_codigo and p.excluido_em is null))
   or
   (processo_id is null and processo_codigo ~ '^FST[0-9]{1,8}(-[A-Z0-9]+)?$'
    and cliente_confirmado and length(btrim(coalesce(cliente_nome,'')))>0
    and verificacao_cadastro is not null
    and verificacao_cadastro->>'modo'='processo_omie'
    and verificacao_cadastro->>'processo'=processo_codigo
    and verificacao_cadastro->>'sku'=codigo_omie
    and exists(select 1 from public.sgq_inventarios_cegos s where s.id=inventario_id
     and s.processo_codigo=processo_codigo and s.endereco=endereco
     and s.cliente_nome=cliente_nome and s.dados_confirmados_em is not null))
  )
 );

-- One record per captured photograph: never collapse multiple pictures into a
-- single "foto principal" field. The Omie catalogue supports at most six slots.
create table if not exists public.sgq_inventario_cego_imagens (
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.sgq_inventario_cego_itens(id) on delete restrict,
 codigo_omie text not null check(length(btrim(codigo_omie)) between 1 and 60),
 storage_path text not null unique,
 criado_por uuid not null references auth.users(id) on delete restrict,
 status text not null default 'pendente'
  check(status in ('pendente','enviando','sincronizada','erro')),
 omie_url text,
 erro text,
 criado_em timestamptz not null default now(),
 atualizado_em timestamptz not null default now(),
 sincronizada_em timestamptz,
 constraint sgq_blind_photo_path check (
   split_part(storage_path,'/',1)=criado_por::text
   and split_part(storage_path,'/',3)=item_id::text
   and split_part(storage_path,'/',5)=''
 )
);
create index if not exists sgq_blind_photo_by_item
 on public.sgq_inventario_cego_imagens (item_id,criado_em desc);
create unique index if not exists sgq_blind_photo_one_sync_per_sku
 on public.sgq_inventario_cego_imagens (upper(codigo_omie))
 where status='enviando';

alter table public.sgq_inventario_cego_imagens enable row level security;
revoke all on public.sgq_inventario_cego_imagens from anon,authenticated;
grant select,insert on public.sgq_inventario_cego_imagens to authenticated;
create policy sgq_blind_photos_select on public.sgq_inventario_cego_imagens
 for select to authenticated
 using (private.current_sgq_role() in ('administrador','gestor','inspetor','consulta'));
create policy sgq_blind_photos_insert on public.sgq_inventario_cego_imagens
 for insert to authenticated
 with check (
  criado_por=(select auth.uid())
  and private.current_sgq_role() in ('administrador','gestor','inspetor')
  and status='pendente' and omie_url is null and sincronizada_em is null
  and exists(
   select 1 from public.sgq_inventario_cego_itens i
   join public.sgq_inventarios_cegos s on s.id=i.inventario_id
   where i.id=sgq_inventario_cego_imagens.item_id
     and i.codigo_omie=sgq_inventario_cego_imagens.codigo_omie
     and i.criado_por=sgq_inventario_cego_imagens.criado_por and s.status='aberto'
     and split_part(storage_path,'/',2)=s.id::text
  )
 );

comment on table public.sgq_inventario_cego_imagens is
 'Fotos individuais de cada SKU contado, com status de envio imediato ao Omie e trilha de auditoria';


-- One photo for each counted SKU; do not accumulate multiple uploaded files
-- against the same inventory line.
create unique index if not exists sgq_blind_photo_one_per_item
 on public.sgq_inventario_cego_imagens(item_id);

-- Allow authorized counters to select and register a real Rua/Armário.
-- No edit/delete permissions added by these policies.
drop policy if exists sgq_inventory_locations_select on public.localizacoes_estoque;
create policy sgq_inventory_locations_select on public.localizacoes_estoque
 for select to authenticated
 using(private.current_sgq_role() in ('administrador','gestor','inspetor','consulta'));
drop policy if exists sgq_inventory_locations_insert on public.localizacoes_estoque;
create policy sgq_inventory_locations_insert on public.localizacoes_estoque
 for insert to authenticated with check(
  private.current_sgq_role() in ('administrador','gestor','inspetor')
  and length(btrim(codigo)) between 3 and 80
  and (upper(codigo) like 'RUA %' or upper(codigo) like 'ARM %')
  and ativo
 );

create table if not exists public.sgq_inventario_cego_documentos(
 id uuid primary key default gen_random_uuid(),
 inventario_id uuid not null references public.sgq_inventarios_cegos(id) on delete restrict,
 processo_codigo text not null check(processo_codigo ~ '^FST[0-9]{1,8}(-[A-Z0-9]+)?$'),
 arquivo_nome text not null check(length(btrim(arquivo_nome)) between 1 and 200),
 mime_type text not null check(mime_type in('application/pdf','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png')),
 storage_path text not null unique,
 criado_por uuid not null references auth.users(id) on delete restrict,
 criado_em timestamptz not null default now(),
 constraint sgq_inv_document_path check(
  split_part(storage_path,'/',1)=criado_por::text
  and split_part(storage_path,'/',2)=inventario_id::text
  and split_part(storage_path,'/',3)=processo_codigo
  and split_part(storage_path,'/',5)=''
 )
);
create index if not exists sgq_inv_doc_proc_idx
 on public.sgq_inventario_cego_documentos(processo_codigo,criado_em desc);
alter table public.sgq_inventario_cego_documentos enable row level security;
revoke all on public.sgq_inventario_cego_documentos from anon,authenticated;
grant select,insert on public.sgq_inventario_cego_documentos to authenticated;
create policy sgq_inv_doc_read on public.sgq_inventario_cego_documentos
 for select to authenticated
 using(private.current_sgq_role() in ('administrador','gestor','inspetor','consulta'));
create policy sgq_inv_doc_write on public.sgq_inventario_cego_documentos
 for insert to authenticated with check (
  criado_por=(select auth.uid())
  and private.current_sgq_role() in ('administrador','gestor','inspetor')
  and exists(select 1 from public.sgq_inventarios_cegos s where s.id=inventario_id
   and s.status='aberto' and s.processo_codigo=sgq_inventario_cego_documentos.processo_codigo)
 );

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('sgq-inventario-documentos','sgq-inventario-documentos',false,15728640,
 array['application/pdf','application/msword',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png'])
 on conflict(id) do update set public=false,file_size_limit=15728640,
 allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists sgq_inv_doc_upload on storage.objects;
create policy sgq_inv_doc_upload on storage.objects
 for insert to authenticated
 with check(bucket_id='sgq-inventario-documentos'
  and split_part(name,'/',1)=(select auth.uid())::text
  and split_part(name,'/',5)=''
  and private.current_sgq_role() in ('administrador','gestor','inspetor')
  and exists(select 1 from public.sgq_inventarios_cegos s
   where s.id::text=split_part(name,'/',2)
    and s.processo_codigo=split_part(name,'/',3) and s.status='aberto'));
drop policy if exists sgq_inv_doc_download on storage.objects;
create policy sgq_inv_doc_download on storage.objects
 for select to authenticated
 using(bucket_id='sgq-inventario-documentos'
  and private.current_sgq_role() in ('administrador','gestor','inspetor','consulta'));
