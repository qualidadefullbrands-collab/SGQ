-- Hierarquia de inspeção SGQ: FST principal -> subprocessos A, B... -> inspeção.
-- Campos opcionais preservam integralmente os registros legados G01/G02.
alter table public.processos
  add column if not exists it_versao_id uuid references public.it_versoes(id);

alter table public.grupos_inspecao
  add column if not exists subprocesso_codigo text,
  add column if not exists nota_fiscal text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='grupos_inspecao_subprocesso_codigo_check'
      and conrelid='public.grupos_inspecao'::regclass
  ) then
    alter table public.grupos_inspecao
      add constraint grupos_inspecao_subprocesso_codigo_check
      check (subprocesso_codigo is null or subprocesso_codigo ~ '^[A-Z]$');
  end if;
end $$;

create unique index if not exists ux_sgq_subprocesso_por_processo
  on public.grupos_inspecao(processo_id,subprocesso_codigo)
  where subprocesso_codigo is not null;

-- A versão única é inferida para processos antigos apenas quando não há conflito entre ITs.
with versoes as (
  select g.processo_id, min(i.it_versao_id::text)::uuid as versao_id
  from public.grupos_inspecao g
  join public.inspecoes i on i.grupo_inspecao_id=g.id
  where i.excluido_em is null and i.it_versao_id is not null
  group by g.processo_id
  having count(distinct i.it_versao_id)=1
)
update public.processos p
  set it_versao_id=v.versao_id
from versoes v
where p.id=v.processo_id and p.it_versao_id is null;
