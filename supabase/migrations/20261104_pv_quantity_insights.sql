-- Histórico auditável de referência do PV, independente do recebido na inspeção.
-- NULL significa referência não disponível/validada (nunca interpretar como zero).
alter table public.processo_itens
  add column if not exists quantidade_pv numeric,
  add column if not exists pv_numero text,
  add column if not exists pv_fst text;

comment on column public.processo_itens.quantidade_pv is 'Quantidade original por SKU no PV Omie na consulta; distinta da quantidade recebida';
comment on column public.processo_itens.pv_numero is 'Número do pedido de venda vinculado à evidência da quantidade_pv';
comment on column public.processo_itens.pv_fst is 'FST exato usado como vínculo do PV; sufixos A/B preservados';

do $$
begin
  if not exists (select 1 from pg_constraint where conname='processo_itens_quantidade_pv_nonnegative') then
    alter table public.processo_itens add constraint processo_itens_quantidade_pv_nonnegative
      check (quantidade_pv is null or quantidade_pv >= 0);
  end if;
end $$;
