-- Keep the historical FST-wide A/B/C report behavior for entries that already exist.
-- New inspection entries default to one report per entry; a kit is one entry with
-- component-level items and therefore also produces one report for that kit.
alter table public.grupos_inspecao
  add column if not exists relatorio_consolidado boolean not null default false;

update public.grupos_inspecao
set relatorio_consolidado = true
where subprocesso_codigo is not null
  and relatorio_consolidado is distinct from true;

comment on column public.grupos_inspecao.relatorio_consolidado is
  'Preserves the historical FST-wide consolidated report for existing A/B/C entries. New entries default to an individual report.';
