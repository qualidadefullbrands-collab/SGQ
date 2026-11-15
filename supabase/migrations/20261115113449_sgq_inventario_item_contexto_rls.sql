-- SGQ #95: corrigir correlação explícita entre linha física e sessão FST/Omie.
-- NÃO ajustar quantidades, fotos, estoque ou dados preexistentes.
-- Migração aditiva ao histórico: policies anteriores estão em
-- 20261113180000_sgq_inventario_fluxo_unico_fotos.sql.
--
-- Homologação antes de executar em produção: contagem agregada de divergências
-- entre i e s deve ser zero para verificacao_cadastro->>'modo'='processo_omie'.

drop policy if exists sgq_inventario_cego_itens_insert on public.sgq_inventario_cego_itens;
create policy sgq_inventario_cego_itens_insert on public.sgq_inventario_cego_itens
for insert to authenticated with check (
  criado_por = (select auth.uid())
  and private.current_sgq_role() in ('administrador','gestor','inspetor')
  and foto_status = 'pendente'
  and foto_omie_url is null
  and foto_omie_sincronizada_em is null
  and length(btrim(endereco)) > 0
  and exists (
    select 1 from public.sgq_inventarios_cegos s
    where s.id = sgq_inventario_cego_itens.inventario_id and s.status = 'aberto'
  )
  and (
    -- Modo SKU direto: sem FST, preservado.
    (processo_id is null and processo_codigo is null and cliente_nome is null
      and cliente_confirmado is false and verificacao_cadastro is not null
      and verificacao_cadastro->>'modo' = 'codigo_omie'
      and upper(btrim(verificacao_cadastro->>'sku')) = upper(btrim(codigo_omie)))
    or
    -- Modo processo já cadastrado no SGQ, preservado.
    (processo_id is not null and cliente_confirmado
      and length(btrim(coalesce(cliente_nome,''))) > 0
      and verificacao_cadastro is not null
      and exists (select 1 from public.processos p
        where p.id = sgq_inventario_cego_itens.processo_id
          and p.codigo = sgq_inventario_cego_itens.processo_codigo
          and p.excluido_em is null))
    or
    -- Modo FST consultado no Omie, sem processo SGQ: relação real linha ↔ sessão.
    (processo_id is null
      and processo_codigo ~ '^FST[0-9]{1,8}(-[A-Z0-9]+)?$'
      and cliente_confirmado and length(btrim(coalesce(cliente_nome,''))) > 0
      and verificacao_cadastro is not null
      and verificacao_cadastro->>'modo' = 'processo_omie'
      and verificacao_cadastro->>'processo' = sgq_inventario_cego_itens.processo_codigo
      and verificacao_cadastro->>'sku' = sgq_inventario_cego_itens.codigo_omie
      and exists (select 1 from public.sgq_inventarios_cegos s
        where s.id = sgq_inventario_cego_itens.inventario_id
          and s.processo_codigo = sgq_inventario_cego_itens.processo_codigo
          and s.endereco = sgq_inventario_cego_itens.endereco
          and s.cliente_nome = sgq_inventario_cego_itens.cliente_nome
          and s.dados_confirmados_em is not null))
  )
);

drop policy if exists sgq_inventario_cego_itens_update on public.sgq_inventario_cego_itens;
create policy sgq_inventario_cego_itens_update on public.sgq_inventario_cego_itens
for update to authenticated
using (
  private.current_sgq_role() in ('administrador','gestor','inspetor')
  and foto_status = 'pendente'
  and exists (select 1 from public.sgq_inventarios_cegos s
    where s.id = sgq_inventario_cego_itens.inventario_id and s.status = 'aberto')
)
with check (
  private.current_sgq_role() in ('administrador','gestor','inspetor')
  and foto_status = 'pendente'
  and length(btrim(endereco)) > 0
  and exists (select 1 from public.sgq_inventarios_cegos s
    where s.id = sgq_inventario_cego_itens.inventario_id and s.status = 'aberto')
  and (
    (processo_id is null and processo_codigo is null and cliente_nome is null
      and cliente_confirmado is false and verificacao_cadastro is not null
      and verificacao_cadastro->>'modo' = 'codigo_omie'
      and upper(btrim(verificacao_cadastro->>'sku')) = upper(btrim(codigo_omie)))
    or
    (processo_id is not null and cliente_confirmado
      and length(btrim(coalesce(cliente_nome,''))) > 0
      and verificacao_cadastro is not null
      and exists (select 1 from public.processos p
        where p.id = sgq_inventario_cego_itens.processo_id
          and p.codigo = sgq_inventario_cego_itens.processo_codigo
          and p.excluido_em is null))
    or
    (processo_id is null
      and processo_codigo ~ '^FST[0-9]{1,8}(-[A-Z0-9]+)?$'
      and cliente_confirmado and length(btrim(coalesce(cliente_nome,''))) > 0
      and verificacao_cadastro is not null
      and verificacao_cadastro->>'modo' = 'processo_omie'
      and verificacao_cadastro->>'processo' = sgq_inventario_cego_itens.processo_codigo
      and verificacao_cadastro->>'sku' = sgq_inventario_cego_itens.codigo_omie
      and exists (select 1 from public.sgq_inventarios_cegos s
        where s.id = sgq_inventario_cego_itens.inventario_id
          and s.processo_codigo = sgq_inventario_cego_itens.processo_codigo
          and s.endereco = sgq_inventario_cego_itens.endereco
          and s.cliente_nome = sgq_inventario_cego_itens.cliente_nome
          and s.dados_confirmados_em is not null))
  )
);

comment on policy sgq_inventario_cego_itens_insert on public.sgq_inventario_cego_itens is
  'SGQ #95: modo processo_omie exige igualdade explícita do FST, cliente e localização do item com a sessão confirmada.';
comment on policy sgq_inventario_cego_itens_update on public.sgq_inventario_cego_itens is
  'SGQ #95: bloqueia edição de item FST/Omie com contexto diferente da sessão.';
