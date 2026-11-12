-- Inspeções documentais do estoque legado: evidência independente e auditável.
-- Não cria inspeção técnica no SGQ nem presume aprovação a partir de DOCX.
create table if not exists public.sgq_estoque_inspecoes_documentais(
 id uuid primary key default gen_random_uuid(),
 amostra_id uuid not null references public.amostras(id) on delete restrict,
 arquivo_nome text not null check(length(arquivo_nome) between 5 and 200),
 storage_path text not null unique,
 resultado text not null default 'nao_classificado'
  check(resultado in ('nao_classificado','aprovado','reprovado','com_ressalvas')),
 observacao text check(length(observacao)<=1800),
 data_inspecao date,
 criado_por uuid not null references auth.users(id),
 criado_em timestamptz not null default now()
);
create index if not exists sgq_estoque_documental_amostra_idx
 on public.sgq_estoque_inspecoes_documentais(amostra_id,criado_em desc);
alter table public.sgq_estoque_inspecoes_documentais enable row level security;
drop policy if exists sgq_estoque_documental_select on public.sgq_estoque_inspecoes_documentais;
create policy sgq_estoque_documental_select
 on public.sgq_estoque_inspecoes_documentais for select to authenticated using(
 private.current_sgq_role() in('administrador','gestor','inspetor','consulta'));
drop policy if exists sgq_estoque_documental_insert on public.sgq_estoque_inspecoes_documentais;
create policy sgq_estoque_documental_insert
 on public.sgq_estoque_inspecoes_documentais for insert to authenticated with check(
 criado_por=(select auth.uid()) and
 private.current_sgq_role() in('administrador','gestor','inspetor')
 and exists(select 1 from public.amostras a where a.id=amostra_id and a.inspecao_id is null)
 and storage_path like (select auth.uid())::text||'/'||amostra_id::text||'/%'
);
revoke all on public.sgq_estoque_inspecoes_documentais from anon;
grant select,insert on public.sgq_estoque_inspecoes_documentais to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('sgq-estoque-word','sgq-estoque-word',false,15728640,
  array['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public=false,file_size_limit=15728640,
 allowed_mime_types=array['application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
drop policy if exists sgq_estoque_word_insert on storage.objects;
create policy sgq_estoque_word_insert on storage.objects for insert to authenticated
 with check(bucket_id='sgq-estoque-word'
  and private.current_sgq_role() in('administrador','gestor','inspetor')
  and split_part(name,'/',1)=(select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.docx$'
  and exists(select 1 from public.amostras a
   where a.id=split_part(name,'/',2)::uuid and a.inspecao_id is null));
drop policy if exists sgq_estoque_word_select on storage.objects;
create policy sgq_estoque_word_select on storage.objects for select to authenticated
 using(bucket_id='sgq-estoque-word'
  and private.current_sgq_role() in('administrador','gestor','inspetor','consulta')
  and exists(select 1 from public.sgq_estoque_inspecoes_documentais d where d.storage_path=name));
