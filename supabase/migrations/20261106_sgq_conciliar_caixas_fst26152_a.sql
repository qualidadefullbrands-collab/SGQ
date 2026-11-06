-- Reconcile verified historical sampling totals for FST26152-A.
-- Facts: 44 standard + 1 fractional warehouse boxes, 60 laboratory units.
-- The 60 lab units are NOT boxes. SGQ's rule for 45 received boxes is 8 to evaluate.
-- Resolve IDs by natural keys and refuse to overwrite changed data.

create schema if not exists sgq_audit;
revoke all on schema sgq_audit from public, anon, authenticated;

create table if not exists sgq_audit.correcao_caixas_plano (
    id bigint generated always as identity primary key,
    processo_item_id uuid not null,
    inspecao_id uuid not null,
    antes_item jsonb not null,
    antes_inspecao jsonb not null,
    caixas_recebidas_corrigidas numeric not null,
    caixas_a_avaliar_corrigidas numeric not null,
    motivo text not null,
    criado_em timestamptz not null default now(),
    unique(processo_item_id,inspecao_id)
);
alter table sgq_audit.correcao_caixas_plano enable row level security;
revoke all on sgq_audit.correcao_caixas_plano from public, anon, authenticated;

do $repair$
declare
    target record;
    matched integer;
    warehouse_boxes numeric;
    updated_rows integer;
begin
    select count(*) into matched
      from public.processos p
      join public.grupos_inspecao g on g.processo_id=p.id
      join public.inspecoes i on i.grupo_inspecao_id=g.id and i.excluido_em is null
      join public.grupo_inspecao_itens gi on gi.grupo_inspecao_id=g.id
      join public.processo_itens pi on pi.id=gi.processo_item_id
      join public.produtos pr on pr.id=pi.produto_id
     where p.codigo='FST26152' and p.excluido_em is null
       and g.subprocesso_codigo='A' and pr.sku='EMB21169PAL001';

    if matched<>1 then
        raise exception 'Correção abortada: esperado um único item do FST26152-A, encontrados %',matched;
    end if;

    select pi.id as item_id, i.id as inspecao_id, pi.distribuicao_caixas,
           to_jsonb(pi) as antes_item, to_jsonb(i) as antes_inspecao,
           pi.caixas_recebidas as item_recebidas, pi.caixas_inspecionadas as item_avaliar,
           i.caixas_recebidas as inspecao_recebidas, i.caixas_avaliar as inspecao_avaliar,
           i.tamanho_lote
      into target
      from public.processos p
      join public.grupos_inspecao g on g.processo_id=p.id
      join public.inspecoes i on i.grupo_inspecao_id=g.id and i.excluido_em is null
      join public.grupo_inspecao_itens gi on gi.grupo_inspecao_id=g.id
      join public.processo_itens pi on pi.id=gi.processo_item_id
      join public.produtos pr on pr.id=pi.produto_id
     where p.codigo='FST26152' and p.excluido_em is null
       and g.subprocesso_codigo='A' and pr.sku='EMB21169PAL001';

    if target.tamanho_lote<>6060
       or target.item_recebidas is not null or target.item_avaliar is not null
       or target.inspecao_recebidas is not null or target.inspecao_avaliar is not null then
       raise exception 'Correção abortada: caixas ou lote já alterados; não sobrescrever';
    end if;

    select coalesce(sum((part->>'Caixas')::numeric),0)
      into warehouse_boxes
      from jsonb_array_elements(target.distribuicao_caixas) part
     where lower(part->>'Tipo') in ('padrao','fracionada');
    if warehouse_boxes<>45 then
        raise exception 'Correção abortada: distribuição salva indica % caixas, não 45',warehouse_boxes;
    end if;

    insert into sgq_audit.correcao_caixas_plano(
        processo_item_id, inspecao_id, antes_item, antes_inspecao,
        caixas_recebidas_corrigidas,caixas_a_avaliar_corrigidas,motivo)
    values (target.item_id,target.inspecao_id,target.antes_item,target.antes_inspecao,
        45,8,'Reconciliação da distribuição registrada: 44 caixas padrão + 1 fracionada; 60 unidades em laboratório excluídas');

    update public.processo_itens
       set caixas_recebidas=45,caixas_inspecionadas=8
     where id=target.item_id
       and caixas_recebidas is null and caixas_inspecionadas is null;
    get diagnostics updated_rows=row_count;
    if updated_rows<>1 then raise exception 'Correção abortada: item não atualizado'; end if;

    update public.inspecoes
       set caixas_recebidas=45,caixas_avaliar=8
     where id=target.inspecao_id
       and caixas_recebidas is null and caixas_avaliar is null;
    get diagnostics updated_rows=row_count;
    if updated_rows<>1 then raise exception 'Correção abortada: plano não atualizado'; end if;
end
$repair$;
