-- SGQ 06/11/2026: logística por subprocesso e evidências fotográficas reversíveis.
-- Os dados originais do FST são mantidos como referência histórica.
-- Somente FSTs com UM grupo recebem backfill. FSTs A/B ficam pendentes de validação
-- individual, evitando propagar uma chegada indevidamente entre processos.

alter table public.grupos_inspecao add column if not exists chegada_cd date;
alter table public.grupos_inspecao add column if not exists origem text;
alter table public.grupos_inspecao add column if not exists transporte text;
alter table public.inspecao_fotos add column if not exists excluido_em timestamptz;
alter table public.inspecao_fotos add column if not exists excluido_por uuid;
alter table public.inspecao_fotos add column if not exists substituida_por uuid;

create schema if not exists sgq_audit;
revoke all on schema sgq_audit from public,anon,authenticated;
create table if not exists sgq_audit.logistica_subprocesso_20261106 (
 grupo_id uuid primary key,
 processo_id uuid not null,
 antes_grupo jsonb not null,
 referencia_processo jsonb not null,
 atualizado_em timestamptz not null default now()
);
alter table sgq_audit.logistica_subprocesso_20261106 enable row level security;
revoke all on sgq_audit.logistica_subprocesso_20261106 from public,anon,authenticated;

with únicos as (
 select g.id,g.processo_id,p.origem,p.transporte,p.chegada_cd
 from public.grupos_inspecao g
 join public.processos p on p.id=g.processo_id
 where p.excluido_em is null
 and (select count(*) from public.grupos_inspecao filhos where filhos.processo_id=p.id)=1
)
insert into sgq_audit.logistica_subprocesso_20261106(grupo_id,processo_id,antes_grupo,referencia_processo)
select g.id,g.processo_id,to_jsonb(g),to_jsonb(p)
from public.grupos_inspecao g
join public.processos p on p.id=g.processo_id
join únicos u on u.id=g.id
on conflict (grupo_id) do nothing;

with únicos as (
 select g.id,p.origem,p.transporte,p.chegada_cd
 from public.grupos_inspecao g join public.processos p on p.id=g.processo_id
 where p.excluido_em is null
 and (select count(*) from public.grupos_inspecao filhos where filhos.processo_id=p.id)=1
)
update public.grupos_inspecao g set
 origem=coalesce(g.origem,u.origem),
 transporte=coalesce(g.transporte,u.transporte),
 chegada_cd=coalesce(g.chegada_cd,u.chegada_cd)
from únicos u where g.id=u.id
  and (g.origem is null and u.origem is not null
    or g.transporte is null and u.transporte is not null
    or g.chegada_cd is null and u.chegada_cd is not null);

create index if not exists ix_sgq_fotos_ativas
  on public.inspecao_fotos(inspecao_id,criado_em)
  where excluido_em is null;
