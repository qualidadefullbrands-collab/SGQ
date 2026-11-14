\set ON_ERROR_STOP on

-- Run after BOTH committed SGQ migrations have been applied to the ephemeral DB.
create function public.qa_assert(p_ok boolean, p_context text) returns void
language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'QC_FAIL: %', p_context;
  end if;
end;
$$;

-- Validate actual Postgres metadata, not migration source string matching.
select public.qa_assert(
  exists(select 1 from pg_constraint
    where conname = 'sgq_recon_referencia_origem_fisica' and convalidated),
  'source CHECK must exist and be VALIDATED');

select public.qa_assert(
  exists(select 1 from pg_trigger
    where tgname = 'sgq_recon_origem_fisica_finalizar'
      and tgenabled = 'O' and not tgisinternal),
  'real finalization trigger must be active');

select public.qa_assert(
  (select prosecdef = false from pg_proc
   where oid = 'public.sgq_recon_validar_origens_ao_concluir()'::regprocedure),
  'physical-source trigger function must be SECURITY INVOKER');

select public.qa_assert(
  (select relrowsecurity from pg_class
   where oid = 'public.sgq_inventario_conciliacao_itens'::regclass),
  'reconciliation items must have RLS enabled');

-- Role is simulated ONLY in this disposable DB; PostgreSQL executes the real RPC.
select set_config('sgq_test.role', 'consulta', false);
do $$
begin
  begin
    perform public.sgq_conciliacao_operar('encerrar', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise exception 'QC_FAIL: consulta role unexpectedly closed inventory';
  exception when insufficient_privilege then
    raise notice 'PASS: consulta role cannot close inventory';
  end;
end $$;

select set_config('sgq_test.role', 'gestor', false);
do $$
begin
  begin
    perform public.sgq_conciliacao_operar('encerrar', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    raise exception 'QC_FAIL: empty inventory was closed';
  exception when invalid_parameter_value then
    raise notice 'PASS: inventory without physical counts cannot be closed';
  end;
end $$;

select public.qa_assert(
  (public.sgq_conciliacao_operar('encerrar',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'status') = 'em_analise',
  'manager can close a populated physical count');

select public.qa_assert(
  (select quantidade_original = 12.500
   from public.sgq_inventario_conciliacao_itens
   where item_id = 'aaaaaaaa-1111-4111-8111-111111111111'),
  'physical quantity is copied into reconciliation, without Omie');

-- A direct quantity reference from Omie MUST be rejected by the real CHECK,
-- including when sent through the real reconciliation RPC.
do $$
begin
  begin
    perform public.sgq_conciliacao_operar(
      'referencia', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'aaaaaaaa-1111-4111-8111-111111111111', 12.500,
      'omie_saldo', 'Registro de estoque do ERP - teste proibido');
    raise exception 'QC_FAIL: Omie quantity was accepted';
  exception when check_violation then
    raise notice 'PASS: real PostgreSQL CHECK rejects Omie quantity';
  end;
end $$;

select public.qa_assert(
  (select quantidade_referencia is null
   from public.sgq_inventario_conciliacao_itens
   where item_id = 'aaaaaaaa-1111-4111-8111-111111111111'),
  'rejected reference did not persist');

select public.qa_assert(
  (public.sgq_conciliacao_operar(
    'referencia','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-1111-4111-8111-111111111111',12.500,
    'sgq_contagem_fisica_local','Contagem QA documentada da RUA 01')
    ->>'status') = 'pendente',
  'local physical count accepted');

-- Even a valid physical quantity cannot finalize while the item is pending.
do $$
begin
  begin
    perform public.sgq_conciliacao_operar('finalizar','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise exception 'QC_FAIL: pending review was finalized';
  exception when invalid_parameter_value then
    raise notice 'PASS: pending review blocks finalization';
  end;
end $$;

select public.qa_assert(
  (public.sgq_conciliacao_operar(
    'revisar','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-1111-4111-8111-111111111111',null,null,'')
    ->>'status') = 'conciliado',
  'zero delta can be reconciled without divergence justification');

select public.qa_assert(
  (public.sgq_conciliacao_operar(
    'finalizar','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    ->>'status') = 'concluida',
  'manager finalizes when reviewed with valid local physical source');

select public.qa_assert(
  (select count(*) = 4
   from public.sgq_inventario_conciliacao_eventos
   where inventario_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'close/reference/review/finalize are audit logged exactly once');

do $$
begin
  begin
    perform public.sgq_conciliacao_operar('finalizar','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise exception 'QC_FAIL: already finalised inventory finalised again';
  exception when invalid_parameter_value then
    raise notice 'PASS: closed reconciliation is immutable through RPC';
  end;
end $$;

-- Second synthetic inventory: other source codes, nonzero delta/recount.
select public.qa_assert(
  (public.sgq_conciliacao_operar('encerrar',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->>'status')='em_analise',
  'independent B subprocess is closed separately');

select public.qa_assert(
  (public.sgq_conciliacao_operar(
   'referencia','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'bbbbbbbb-1111-4111-8111-111111111111',10,
   'sgq_inventario_anterior_local','Inventário físico QA anterior da RUA 01')
   ->>'status')='pendente',
  'prior local physical inventory is allowed');

select public.qa_assert(
  (public.sgq_conciliacao_operar(
   'referencia','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'bbbbbbbb-1111-4111-8111-111111111111',10,
   'sgq_posicao_local_documentada','Posição SGQ QA documentada da RUA 01')
   ->>'status')='pendente',
  'documented physical SGQ position is allowed');

-- Prove trigger still guards against *legacy* invalid origins, even when
-- someone bypasses/removes the newly introduced CHECK. Roll back the sandbox
-- tampering immediately; production schema is never touched.
begin;
alter table public.sgq_inventario_conciliacao_itens
  drop constraint sgq_recon_referencia_origem_fisica;
update public.sgq_inventario_conciliacao_itens
  set referencia_fonte='omie_saldo', status='conciliado'
  where item_id='bbbbbbbb-1111-4111-8111-111111111111';
do $$
begin
  begin
    update public.sgq_inventario_conciliacoes
      set status='concluida',
          concluido_em=now(),
          concluido_por='11111111-1111-4111-8111-111111111111'
      where inventario_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    raise exception 'QC_FAIL: finalization trigger allowed legacy Omie origin';
  exception when invalid_parameter_value then
    raise notice 'PASS: trigger independently blocks legacy Omie reference';
  end;
end $$;
rollback;

select public.qa_assert(
  (select convalidated from pg_constraint
   where conname='sgq_recon_referencia_origem_fisica'),
  'physical-source CHECK is restored after rolled-back legacy test');

select public.qa_assert(
  (public.sgq_conciliacao_operar(
    'solicitar_recontagem', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'bbbbbbbb-1111-4111-8111-111111111111', null, null,
    'Divergência suspeita: solicitar recontagem da RUA 01')
    ->>'status')='recontagem_solicitada',
  'manager can request a recount');

select set_config('sgq_test.role','inspetor',false);
do $$
begin
  begin
    perform public.sgq_conciliacao_operar(
      'revisar','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'bbbbbbbb-1111-4111-8111-111111111111', null,null,'Teste inadequado');
    raise exception 'QC_FAIL: inspetor approved reconciliation';
  exception when insufficient_privilege then
    raise notice 'PASS: inspetor cannot approve manager decision';
  end;
end $$;

select public.qa_assert(
  (public.sgq_conciliacao_operar(
    'recontar','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'bbbbbbbb-1111-4111-8111-111111111111',9.000,null,
    'Contagem QA verificada no endereço da RUA 01')
   ->>'status')='recontada',
  'inspector recount recorded separately from original physical count');

select set_config('sgq_test.role','gestor',false);
do $$
begin
  begin
    perform public.sgq_conciliacao_operar(
      'revisar','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'bbbbbbbb-1111-4111-8111-111111111111',null,null,'');
    raise exception 'QC_FAIL: difference approved without justification';
  exception when invalid_parameter_value then
    raise notice 'PASS: nonzero delta requires justification';
  end;
end $$;

select public.qa_assert(
  (public.sgq_conciliacao_operar(
    'revisar','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'bbbbbbbb-1111-4111-8111-111111111111',null,null,
    'Diferença documentada após recontagem física de teste'
    )->>'status')='divergencia_aprovada',
  'manager can approve justified divergence after physical recount');

select public.qa_assert(
  (public.sgq_conciliacao_operar(
    'finalizar','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    ->>'status')='concluida',
  'recounted divergence finalizes with accepted physical evidence');

-- Verify SQL privilege/RLS behavior as separate PostgreSQL roles, not only
-- textual references. The production role resolver is still mocked here.
reset role;
set role anon;
do $$
begin
  begin
    perform count(*) from public.sgq_inventario_conciliacoes;
    raise exception 'QC_FAIL: anon can select reconciliation header';
  exception when insufficient_privilege then
    raise notice 'PASS: anon cannot read reconciliation headers';
  end;
end $$;

do $$
begin
  begin
    perform public.sgq_conciliacao_operar(
      'finalizar','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise exception 'QC_FAIL: anon can invoke reconciliation RPC';
  exception when insufficient_privilege then
    raise notice 'PASS: anon cannot execute reconciliation RPC';
  end;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select set_config('sgq_test.role','consulta',false);
select public.qa_assert(
  (select count(*)=2 from public.sgq_inventario_conciliacoes),
  'consulta role can read reconciliation through RLS');
do $$
begin
  begin
    insert into public.sgq_inventario_conciliacao_itens
      (item_id,inventario_id,quantidade_original)
      values('aaaaaaaa-1111-4111-8111-111111111111',
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',3);
    raise exception 'QC_FAIL: read-only role inserted reconciliation item';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated browser role cannot directly write';
  end;
end $$;
do $$
begin
  begin
    perform public.sgq_conciliacao_operar(
      'finalizar','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    raise exception 'QC_FAIL: consulta role executed finalization';
  exception when insufficient_privilege then
    raise notice 'PASS: consulta role cannot invoke managerial RPC action';
  end;
end $$;
reset role;

select public.qa_assert(
  (select count(*)=0
   from public.sgq_inventario_conciliacao_itens
   where referencia_fonte='omie_saldo'),
  'no Omie quantity persisted in physical reconciliation');

select 'SGQ_DB_INTEGRITY_PASS: physical-only reference, RPC, transaction, trigger, audit and role checks' as result;
