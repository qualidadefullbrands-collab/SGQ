-- SGQ E2E: isolated, minimal SQL fixture for a *real* local Supabase stack.
-- No production snapshot, no production credentials. This is NOT a substitute
-- for full production migrations/policies. UUIDs and business data are synthetic.
\set ON_ERROR_STOP on

create table public.profiles (
  id uuid primary key references auth.users(id),
  owner_id uuid not null references auth.users(id),
  nome text not null, perfil text not null, ativo boolean not null default true
);
create table public.instrucoes_trabalho (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  codigo text not null, titulo text not null
);
create table public.it_versoes (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  instrucoes_trabalho_id uuid references public.instrucoes_trabalho(id),
  versao integer not null, arquivo_storage_path text,
  arquivo_nome text, arquivo_mime text
);
create table public.processos (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  codigo text not null, cliente text not null,
  it_versao_id uuid references public.it_versoes(id),
  excluido_em timestamptz
);
create table public.grupos_inspecao (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  processo_id uuid not null references public.processos(id),
  codigo text not null, subprocesso_codigo text,
  nota_fiscal text, nome text, origem text, transporte text,
  chegada_cd date
);
create table public.inspecoes (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  numero text not null, grupo_inspecao_id uuid not null references public.grupos_inspecao(id),
  it_versao_id uuid references public.it_versoes(id),
  responsavel_id uuid references public.profiles(id),
  status text not null, resultado text, observacoes text, excluido_em timestamptz,
  data_inspecao date, nivel_inspecao text, tamanho_lote numeric,
  tamanho_amostra numeric, total_inspecionado numeric, total_nao_conforme numeric,
  limite_rejeicao numeric, dimensionais_finalizados boolean,
  testes_finalizados boolean, codigo_amostragem text, caixas_recebidas numeric,
  caixas_avaliar numeric, criado_em timestamptz default now(),
  documento_gerado_em timestamptz
);
create table public.produtos (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  sku text not null, nome text not null, codigo text,
  foto_principal_path text
);
create table public.processo_itens (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  produto_id uuid references public.produtos(id),
  quantidade numeric, caixas_recebidas numeric,
  caixas_inspecionadas numeric, quantidade_por_caixa numeric
);
create table public.grupo_inspecao_itens (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  grupo_inspecao_id uuid references public.grupos_inspecao(id),
  processo_item_id uuid references public.processo_itens(id),
  unidades_por_conjunto numeric
);
create table public.inspecao_fotos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  inspecao_id uuid not null references public.inspecoes(id),
  storage_path text not null, legenda text,
  nc_id uuid, excluido_por uuid, substituida_por uuid,
  excluido_em timestamptz, criado_em timestamptz default now(),
  unique(inspecao_id,storage_path)
);
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  entidade text not null, entidade_id uuid not null,
  acao text not null, dados jsonb not null default '{}'::jsonb
);
alter table public.audit_log enable row level security;
grant select,insert on public.audit_log to authenticated;
create policy qa_audit_read on public.audit_log for select to authenticated
  using (usuario_id=(select auth.uid()));
create policy qa_audit_insert on public.audit_log for insert to authenticated
  with check (usuario_id=(select auth.uid()));
-- Synthetic inventory tables for real HTTP registration/replay. Quantities
-- remain immutable under the test API; no Omie endpoint is connected.
create table public.sgq_inventarios_cegos (
 id uuid primary key, owner_id uuid not null references auth.users(id),
 status text not null default 'aberto' check(status in ('aberto','fechado','cancelado'))
);
create table public.sgq_inventario_cego_itens (
 id uuid primary key, owner_id uuid not null references auth.users(id),
 inventario_id uuid not null references public.sgq_inventarios_cegos(id),
 codigo_omie text not null, criado_por uuid not null references auth.users(id),
 quantidade_contada numeric not null check(quantidade_contada>=0)
);
create table public.sgq_inventario_cego_imagens (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id),
 item_id uuid not null unique references public.sgq_inventario_cego_itens(id),
 codigo_omie text not null,
 criado_por uuid not null references auth.users(id),
 storage_path text not null unique,
 status text not null default 'pendente'
);
create table public.it_checklist (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  it_versao_id uuid references public.it_versoes(id),
  ativo boolean default true, ordem integer
);
create table public.inspecao_checklist_resultados (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  inspecao_id uuid references public.inspecoes(id),
  checklist_id uuid references public.it_checklist(id), resultado text
);
create table public.it_parametros_dimensionais (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  it_versao_id uuid references public.it_versoes(id),
  ativo boolean default true, ordem integer, nome text
);
create table public.inspecao_dimensional_configuracoes (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  inspecao_id uuid references public.inspecoes(id),
  processo_item_id uuid references public.processo_itens(id),
  parametro_id uuid references public.it_parametros_dimensionais(id),
  nao_aplicavel boolean default false,
  minimo_aceitavel numeric, maximo_aceitavel numeric
);
create table public.inspecao_dimensionais (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  inspecao_id uuid references public.inspecoes(id),
  processo_item_id uuid references public.processo_itens(id),
  parametro_id uuid references public.it_parametros_dimensionais(id),
  sequencia_amostra integer, valor numeric, conforme boolean
);
create table public.it_testes_especiais (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  it_versao_id uuid references public.it_versoes(id),
  ativo boolean default true, ordem integer
);
create table public.inspecao_testes_resultados (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  inspecao_id uuid references public.inspecoes(id),
  teste_id uuid references public.it_testes_especiais(id),
  resultado text
);

-- Unlike a mock HTTP route, PostgREST now enforces row-level policies.
-- These owner-isolation rules are deliberately minimal TEST fixtures.
-- They are NOT claimed to be the production SGQ role/tenant policies.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'profiles','instrucoes_trabalho','it_versoes','processos',
    'grupos_inspecao','inspecoes','produtos','processo_itens',
    'grupo_inspecao_itens','inspecao_fotos','it_checklist',
    'inspecao_checklist_resultados','it_parametros_dimensionais',
    'inspecao_dimensional_configuracoes','inspecao_dimensionais',
    'it_testes_especiais','inspecao_testes_resultados',
    'sgq_inventarios_cegos','sgq_inventario_cego_itens',
    'sgq_inventario_cego_imagens'
  ] loop
    execute format('alter table public.%I enable row level security',tbl);
    execute format('revoke all on public.%I from public, anon, authenticated',tbl);
    execute format('grant select on public.%I to authenticated',tbl);
    execute format(
      'create policy qa_select_owner on public.%I for select to authenticated using (owner_id = (select auth.uid()))',
      tbl
    );
  end loop;
end $$;

-- The real API is now exercised for photo registration/replacement; these
-- permissions are limited to this synthetic fixture and remain isolated.
grant insert,update on public.inspecao_fotos to authenticated;
create policy qa_photo_insert on public.inspecao_fotos for insert to authenticated
  with check (owner_id=(select auth.uid()));
create policy qa_photo_update on public.inspecao_fotos for update to authenticated
  using (owner_id=(select auth.uid()))
  with check (owner_id=(select auth.uid()));
grant insert on public.sgq_inventario_cego_imagens to authenticated;
create policy qa_inventory_photo_insert on public.sgq_inventario_cego_imagens
 for insert to authenticated
 with check(owner_id=(select auth.uid()) and criado_por=(select auth.uid())
  and exists(select 1 from public.sgq_inventario_cego_itens i
    join public.sgq_inventarios_cegos s on s.id=i.inventario_id
    where i.id=item_id and i.owner_id=(select auth.uid())
     and i.codigo_omie=codigo_omie and s.status='aberto'));
grant update on public.inspecoes to authenticated;
create policy qa_inspection_update on public.inspecoes for update to authenticated
  using (owner_id=(select auth.uid()))
  with check (owner_id=(select auth.uid()));

-- Local-only schema extensions to exercise the actual inspection-create API.
-- All inserts remain owner scoped. No production migrations are changed.
alter table public.processos alter column id set default gen_random_uuid(),
 alter column owner_id set default auth.uid(),
 add column nota_fiscal text, add column origem text, add column transporte text,
 add column chegada_cd date, add column status text, add column data_processo date,
 add column criado_por uuid, add column atualizado_em timestamptz;
alter table public.processos add unique(codigo);
alter table public.grupos_inspecao alter column id set default gen_random_uuid(),
 alter column owner_id set default auth.uid(),
 add column tipo text default 'individual', add column tamanho_lote_estatistico numeric,
 add column status text;
alter table public.grupos_inspecao add unique(processo_id,subprocesso_codigo);
alter table public.produtos alter column id set default gen_random_uuid(),
 alter column owner_id set default auth.uid();
alter table public.produtos add unique(sku);
alter table public.processo_itens alter column id set default gen_random_uuid(),
 alter column owner_id set default auth.uid(),
 add column processo_id uuid references public.processos(id),
 add column codigo_cliente text, add column quantidade_pv numeric,
 add column pv_numero text, add column pv_fst text, add column lote text,
 add column material text, add column capacidade text, add column distribuicao_caixas jsonb;
alter table public.grupo_inspecao_itens alter column id set default gen_random_uuid(),
 alter column owner_id set default auth.uid(), add column quantidade_componente numeric, add column papel text;
alter table public.inspecoes alter column id set default gen_random_uuid(),
 alter column owner_id set default auth.uid(), add column processo_item_id uuid references public.processo_itens(id),
 add column limite_aceitacao numeric, add column nivel_inspecao_origem text,
 add column regime_inspecao text, add column tipo_plano text,
 add column nqa_critico numeric, add column nqa_grave numeric, add column nqa_toleravel numeric,
 add column iniciada_em timestamptz, add column observacao_interna text,
 add column parametros_amostragem jsonb;
create table public.grupo_inspecao_its(
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(),
 grupo_inspecao_id uuid references public.grupos_inspecao(id),
 it_versao_id uuid references public.it_versoes(id), principal boolean
);
alter table public.grupo_inspecao_its enable row level security;
grant select on public.grupo_inspecao_its to authenticated;
create policy qa_select_owner on public.grupo_inspecao_its for select to authenticated using(owner_id=(select auth.uid()));
do $$
declare tbl text;
begin
 foreach tbl in array array['processos','grupos_inspecao','produtos','processo_itens','grupo_inspecao_itens','grupo_inspecao_its','inspecoes'] loop
  execute format('grant insert on public.%I to authenticated',tbl);
  execute format('create policy qa_create_owner on public.%I for insert to authenticated with check(owner_id=(select auth.uid()))',tbl);
 end loop;
 foreach tbl in array array['processos','produtos'] loop
  execute format('grant update on public.%I to authenticated',tbl);
  execute format('create policy qa_update_owner on public.%I for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()))',tbl);
 end loop;
end $$;

insert into public.profiles(id,owner_id,nome,perfil,ativo) values
 ('__OWNER_UUID__','__OWNER_UUID__','Inspetor QA Sintético','gestor',true);

insert into public.instrucoes_trabalho(id,owner_id,codigo,titulo) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','__OWNER_UUID__','IT001','IT QA');
insert into public.it_versoes(id,owner_id,instrucoes_trabalho_id,versao) values
 ('66666666-6666-4666-8666-666666666666','__OWNER_UUID__',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1);
insert into public.processos(id,owner_id,codigo,cliente,it_versao_id) values
 ('11111111-1111-4111-8111-111111111111','__OWNER_UUID__','FST99999',
 'CLIENTE SINTETICO SGQ','66666666-6666-4666-8666-666666666666');
insert into public.grupos_inspecao
 (id,owner_id,processo_id,codigo,subprocesso_codigo,nota_fiscal,nome,origem,transporte,chegada_cd)
values
 ('22222222-2222-4222-8222-222222222222','__OWNER_UUID__',
  '11111111-1111-4111-8111-111111111111','FST99999-A','A','QA-NF-001',
  'COMPONENTE A','TESTE SINTETICO','RODOVIARIO','2026-11-13'),
 ('33333333-3333-4333-8333-333333333333','__OWNER_UUID__',
  '11111111-1111-4111-8111-111111111111','FST99999-B','B','QA-NF-002',
  'COMPONENTE B','TESTE SINTETICO','RODOVIARIO','2026-11-13');
insert into public.inspecoes
 (id,owner_id,numero,grupo_inspecao_id,it_versao_id,responsavel_id,
  status,resultado,observacoes,data_inspecao,nivel_inspecao,tamanho_lote,
  tamanho_amostra,total_inspecionado,total_nao_conforme,limite_rejeicao,
  dimensionais_finalizados,testes_finalizados,codigo_amostragem,
  caixas_recebidas,caixas_avaliar)
values
 ('44444444-4444-4444-8444-444444444444','__OWNER_UUID__','INS-QA-A',
  '22222222-2222-4222-8222-222222222222','66666666-6666-4666-8666-666666666666',
  '__OWNER_UUID__','concluida','aprovado','INSPECAO A SINTETICA',
  '2026-11-14','II',40,5,5,0,1,true,true,'D',1,1),
 ('55555555-5555-4555-8555-555555555555','__OWNER_UUID__','INS-QA-B',
  '33333333-3333-4333-8333-333333333333','66666666-6666-4666-8666-666666666666',
  '__OWNER_UUID__','concluida','aprovado','INSPECAO B SINTETICA',
  '2026-11-14','II',40,5,5,0,1,true,true,'D',1,1);
insert into public.produtos(id,owner_id,sku,nome,codigo) values
 ('aaaaaaaa-1111-4111-8111-111111111111','__OWNER_UUID__',
  'QA-SKU-A','COMPONENTE A SINTETICO','QA-SKU-A'),
 ('bbbbbbbb-1111-4111-8111-111111111111','__OWNER_UUID__',
  'QA-SKU-B','COMPONENTE B SINTETICO','QA-SKU-B');
insert into public.processo_itens
 (id,owner_id,produto_id,quantidade,caixas_recebidas,caixas_inspecionadas,quantidade_por_caixa)
values
 ('88888888-8888-4888-8888-888888888888','__OWNER_UUID__',
  'aaaaaaaa-1111-4111-8111-111111111111',40,1,1,40),
 ('99999999-9999-4999-8999-999999999999','__OWNER_UUID__',
  'bbbbbbbb-1111-4111-8111-111111111111',40,1,1,40);
insert into public.grupo_inspecao_itens(id,owner_id,grupo_inspecao_id,processo_item_id) values
 ('11111111-2222-4333-8444-555555555555','__OWNER_UUID__',
  '22222222-2222-4222-8222-222222222222','88888888-8888-4888-8888-888888888888'),
 ('22222222-3333-4444-8555-666666666666','__OWNER_UUID__',
  '33333333-3333-4333-8333-333333333333','99999999-9999-4999-8999-999999999999');
insert into public.inspecao_fotos(id,owner_id,inspecao_id,storage_path,legenda) values
 ('33333333-4444-4555-8666-777777777777','__OWNER_UUID__',
  '44444444-4444-4444-8444-444444444444',
  '__OWNER_UUID__/44444444-4444-4444-8444-444444444444/evidence-a.png','FOTO QA A'),
 ('44444444-5555-4666-8777-888888888888','__OWNER_UUID__',
  '55555555-5555-4555-8555-555555555555',
  '__OWNER_UUID__/55555555-5555-4555-8555-555555555555/evidence-b.png','FOTO QA B');

insert into public.sgq_inventarios_cegos(id,owner_id,status) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','__OWNER_UUID__','aberto'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','__OWNER_UUID__','fechado');
insert into public.sgq_inventario_cego_itens(
 id,owner_id,inventario_id,codigo_omie,criado_por,quantidade_contada
) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','__OWNER_UUID__',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','QA-SKU-INVENTARIO','__OWNER_UUID__',37),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','__OWNER_UUID__',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','QA-SKU-FECHADO','__OWNER_UUID__',12);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('inspecao-fotos','inspecao-fotos',false,8388608,array['image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=8388608,
  allowed_mime_types=array['image/png','image/jpeg'];

-- Test-only inspection photo policy, scoped to owner+inspection and private read.
-- These policies must be compared against hosted project separately.
create policy qa_inspection_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id='inspecao-fotos'
    and (
      (split_part(name,'/',1)=(select auth.uid())::text
       and exists (select 1 from public.inspecoes i
         where i.id::text=split_part(name,'/',2)
           and i.owner_id=(select auth.uid())))
      or
      (split_part(name,'/',2)='gerais'
       and exists (select 1 from public.inspecoes i
         where i.id::text=split_part(name,'/',1)
           and i.owner_id=(select auth.uid())))
    )
  );
create policy qa_inspection_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id='inspecao-fotos'
    and (
      (split_part(name,'/',1)=(select auth.uid())::text
       and exists (select 1 from public.inspecoes i
         where i.id::text=split_part(name,'/',2)
           and i.owner_id=(select auth.uid())))
      or
      (split_part(name,'/',2)='gerais'
       and exists (select 1 from public.inspecoes i
         where i.id::text=split_part(name,'/',1)
           and i.owner_id=(select auth.uid())))
    )
  );

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values ('sgq-inventario-cego','sgq-inventario-cego',false,8388608,array['image/jpeg','image/png'])
 on conflict(id) do update set public=false,file_size_limit=8388608,
 allowed_mime_types=excluded.allowed_mime_types;
create policy qa_inventory_storage_insert on storage.objects
 for insert to authenticated with check (
  bucket_id='sgq-inventario-cego'
  and split_part(name,'/',1)=(select auth.uid())::text
  and exists(select 1 from public.sgq_inventarios_cegos s
    where s.id::text=split_part(name,'/',2) and s.owner_id=(select auth.uid())
      and s.status='aberto')
 );
create policy qa_inventory_storage_select on storage.objects
 for select to authenticated using(
  bucket_id='sgq-inventario-cego'
  and split_part(name,'/',1)=(select auth.uid())::text
 );

notify pgrst, 'reload schema';
select pg_sleep(1);
