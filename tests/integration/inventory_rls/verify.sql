-- Executar DEPOIS da migration real de #95, em PostgreSQL descartável.
\set ON_ERROR_STOP on

-- pg_policies deve preservar explicitamente as referências da linha do item.
do $$
declare record_policy record;
begin
 for record_policy in
   select policyname, with_check
   from pg_policies
   where schemaname='public' and tablename='sgq_inventario_cego_itens'
     and cmd in ('INSERT','UPDATE')
 loop
   if record_policy.with_check like '%s.processo_codigo = s.processo_codigo%'
      or record_policy.with_check like '%s.endereco = s.endereco%'
      or record_policy.with_check like '%s.cliente_nome = s.cliente_nome%'
   then raise exception 'POLICY_UNSAFE_SELF_COMPARISON: %',record_policy.policyname; end if;
   if record_policy.with_check not like '%s.processo_codigo = sgq_inventario_cego_itens.processo_codigo%'
      or record_policy.with_check not like '%s.endereco = sgq_inventario_cego_itens.endereco%'
      or record_policy.with_check not like '%s.cliente_nome = sgq_inventario_cego_itens.cliente_nome%'
   then raise exception 'POLICY_MISSING_ITEM_CORRELATION: %',record_policy.policyname; end if;
 end loop;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select set_config('sgq_test.role','inspetor',false);

-- Modo FST/Omie: aceita contexto perfeitamente correspondente à sessão.
insert into public.sgq_inventario_cego_itens
(id,inventario_id,codigo_omie,endereco,processo_codigo,cliente_nome,
 cliente_confirmado,verificacao_cadastro,criado_por,quantidade_contada)
values
('10000000-0000-4000-8000-000000000001',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'SKU01','RUA 01','FST99999-A','CLIENTE ALFA',true,
 '{"modo":"processo_omie","processo":"FST99999-A","sku":"SKU01"}'::jsonb,
 '11111111-1111-4111-8111-111111111111',12.5);

-- Modo código Omie direto, sem FST, continua permitido.
insert into public.sgq_inventario_cego_itens
(id,inventario_id,codigo_omie,endereco,processo_codigo,cliente_nome,
 cliente_confirmado,verificacao_cadastro,criado_por)
values
('10000000-0000-4000-8000-000000000002',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'SKU02','ARM 00',null,null,false,
 '{"modo":"codigo_omie","sku":"SKU02"}'::jsonb,
 '11111111-1111-4111-8111-111111111111');

-- Modo processo SGQ cadastrado também continua permitido.
insert into public.sgq_inventario_cego_itens
(id,inventario_id,codigo_omie,endereco,processo_id,processo_codigo,cliente_nome,
 cliente_confirmado,verificacao_cadastro,criado_por)
values
('10000000-0000-4000-8000-000000000003',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'SKU03','RUA 01','99999999-9999-4999-8999-999999999999','FST99999-A','CLIENTE ALFA',true,
 '{"modo":"processo_sgq","sku":"SKU03"}'::jsonb,
 '11111111-1111-4111-8111-111111111111');

-- Rejeitar dados que diferem da sessão: mesmo quando a verificação interna
-- do próprio item é consistente, sua associação com a sessão é inválida.
do $$
begin
 begin
  insert into public.sgq_inventario_cego_itens
  (id,inventario_id,codigo_omie,endereco,processo_codigo,cliente_nome,cliente_confirmado,verificacao_cadastro,criado_por)
  values ('10000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'SKU04','RUA 01','FST99999-B','CLIENTE ALFA',true,
          '{"modo":"processo_omie","processo":"FST99999-B","sku":"SKU04"}',
          '11111111-1111-4111-8111-111111111111');
  raise exception 'FST_MISMATCH_ACCEPTED';
 exception when insufficient_privilege then raise notice 'PASS: divergência FST rejeitada'; end;

 begin
  insert into public.sgq_inventario_cego_itens
  (id,inventario_id,codigo_omie,endereco,processo_codigo,cliente_nome,cliente_confirmado,verificacao_cadastro,criado_por)
  values ('10000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'SKU05','RUA 02','FST99999-A','CLIENTE ALFA',true,
          '{"modo":"processo_omie","processo":"FST99999-A","sku":"SKU05"}',
          '11111111-1111-4111-8111-111111111111');
  raise exception 'LOCATION_MISMATCH_ACCEPTED';
 exception when insufficient_privilege then raise notice 'PASS: divergência de rua/armário rejeitada'; end;

 begin
  insert into public.sgq_inventario_cego_itens
  (id,inventario_id,codigo_omie,endereco,processo_codigo,cliente_nome,cliente_confirmado,verificacao_cadastro,criado_por)
  values ('10000000-0000-4000-8000-000000000006','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'SKU06','RUA 01','FST99999-A','CLIENTE BETA',true,
          '{"modo":"processo_omie","processo":"FST99999-A","sku":"SKU06"}',
          '11111111-1111-4111-8111-111111111111');
  raise exception 'CLIENT_MISMATCH_ACCEPTED';
 exception when insufficient_privilege then raise notice 'PASS: divergência cliente rejeitada'; end;

 begin
  update public.sgq_inventario_cego_itens
  set endereco='RUA 02' where id='10000000-0000-4000-8000-000000000001';
  raise exception 'INVALID_UPDATE_ACCEPTED';
 exception when insufficient_privilege then raise notice 'PASS: edição de endereço divergente rejeitada'; end;

 begin
  insert into public.sgq_inventario_cego_itens
  (id,inventario_id,codigo_omie,endereco,processo_codigo,cliente_nome,cliente_confirmado,verificacao_cadastro,criado_por)
  values ('10000000-0000-4000-8000-000000000007','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'SKU07','RUA 01','FST99999-A','CLIENTE ALFA',true,
          '{"modo":"processo_omie","processo":"FST99999-A","sku":"SKU07"}',
          '11111111-1111-4111-8111-111111111111');
  raise exception 'CLOSED_SESSION_ACCEPTED';
 exception when insufficient_privilege then raise notice 'PASS: sessão fechada rejeitada'; end;
end $$;

do $$
begin
 if (select count(*) from public.sgq_inventario_cego_itens) <> 3 then
   raise exception 'INVALID_INSERT_REMAINED';
 end if;
 if exists (select 1 from public.sgq_inventario_cego_itens where id='10000000-0000-4000-8000-000000000001' and endereco<>'RUA 01') then
   raise exception 'INVALID_UPDATE_REMAINED';
 end if;
 raise notice 'PASS: três modos preservados, cinco negativas sem gravação';
end $$;
