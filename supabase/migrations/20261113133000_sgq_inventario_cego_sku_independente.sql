-- Two valid, independent blind-count workflows:
-- (1) direct Omie SKU, with no FST process; (2) FST process verified with client.
-- Keep existing role, open-session, image and audit controls in both paths.
drop policy if exists sgq_inventario_cego_itens_insert on public.sgq_inventario_cego_itens;
create policy sgq_inventario_cego_itens_insert
 on public.sgq_inventario_cego_itens
 for insert to authenticated
 with check (
  criado_por = (select auth.uid())
  and private.current_sgq_role() in ('administrador','gestor','inspetor')
  and foto_status = 'pendente'
  and foto_omie_url is null
  and foto_omie_sincronizada_em is null
  and length(btrim(endereco)) > 0
  and exists (
   select 1 from public.sgq_inventarios_cegos s
   where s.id=inventario_id and s.status='aberto'
  )
  and (
   (
    processo_id is null
    and processo_codigo is null
    and cliente_nome is null
    and cliente_confirmado is false
    and verificacao_cadastro is not null
    and verificacao_cadastro->>'modo' = 'codigo_omie'
    and upper(btrim(verificacao_cadastro->>'sku'))=upper(btrim(codigo_omie))
   )
   or
   (
    processo_id is not null
    and cliente_confirmado
    and length(btrim(coalesce(cliente_nome,'')))>0
    and verificacao_cadastro is not null
    and exists (
     select 1 from public.processos p
     where p.id=processo_id
      and p.codigo=processo_codigo
      and p.excluido_em is null
    )
   )
  )
 );

drop policy if exists sgq_inventario_cego_itens_update on public.sgq_inventario_cego_itens;
create policy sgq_inventario_cego_itens_update
 on public.sgq_inventario_cego_itens
 for update to authenticated
 using (
  private.current_sgq_role() in ('administrador','gestor','inspetor')
  and foto_status='pendente'
  and exists (
   select 1 from public.sgq_inventarios_cegos s
   where s.id=inventario_id and s.status='aberto'
  )
 )
 with check (
  private.current_sgq_role() in ('administrador','gestor','inspetor')
  and foto_status='pendente'
  and length(btrim(endereco))>0
  and exists (
   select 1 from public.sgq_inventarios_cegos s
   where s.id=inventario_id and s.status='aberto'
  )
  and (
   (
    processo_id is null
    and processo_codigo is null
    and cliente_nome is null
    and cliente_confirmado is false
    and verificacao_cadastro is not null
    and verificacao_cadastro->>'modo'='codigo_omie'
    and upper(btrim(verificacao_cadastro->>'sku'))=upper(btrim(codigo_omie))
   )
   or
   (
    processo_id is not null
    and cliente_confirmado
    and length(btrim(coalesce(cliente_nome,'')))>0
    and verificacao_cadastro is not null
    and exists (
     select 1 from public.processos p
     where p.id=processo_id
      and p.codigo=processo_codigo
      and p.excluido_em is null
    )
   )
  )
 );
