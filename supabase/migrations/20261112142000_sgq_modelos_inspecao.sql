-- Modelos de inspeção configuráveis. Independentes das ITs oficiais.
-- Aplicar em homologação antes de liberar o novo menu em produção.
create table if not exists public.sgq_modelos_inspecao (
 id uuid primary key default gen_random_uuid(),
 codigo text not null unique check(length(btrim(codigo)) between 3 and 40 and codigo ~ '^[A-Z0-9_-]+$'),
 nome text not null check(length(btrim(nome)) between 3 and 160),
 escopo text not null default 'ambos' check(escopo in ('armazem','qualidade','ambos')),
 status text not null default 'rascunho' check(status in ('rascunho','vigente','obsoleto')),
 checklist jsonb not null default '[]'::jsonb
  check(jsonb_typeof(checklist)='array' and jsonb_array_length(checklist) between 1 and 100),
 criado_por uuid not null references auth.users(id) on delete restrict,
 criado_em timestamptz not null default now(),
 atualizado_em timestamptz not null default now()
);
create index if not exists sgq_modelos_inspecao_status_idx
 on public.sgq_modelos_inspecao(status,escopo,atualizado_em desc);

alter table public.sgq_modelos_inspecao enable row level security;
drop policy if exists sgq_modelos_inspecao_select on public.sgq_modelos_inspecao;
create policy sgq_modelos_inspecao_select on public.sgq_modelos_inspecao
 for select to authenticated
 using (private.current_sgq_role() in ('administrador','gestor','inspetor','consulta'));

drop policy if exists sgq_modelos_inspecao_insert on public.sgq_modelos_inspecao;
create policy sgq_modelos_inspecao_insert on public.sgq_modelos_inspecao
 for insert to authenticated
 with check (private.current_sgq_role() in ('administrador','gestor')
  and criado_por=(select auth.uid()));

drop policy if exists sgq_modelos_inspecao_update on public.sgq_modelos_inspecao;
create policy sgq_modelos_inspecao_update on public.sgq_modelos_inspecao
 for update to authenticated
 using (private.current_sgq_role() in ('administrador','gestor'))
 with check (private.current_sgq_role() in ('administrador','gestor'));

revoke all on public.sgq_modelos_inspecao from anon,authenticated;
grant select,insert on public.sgq_modelos_inspecao to authenticated;
grant update(codigo,nome,escopo,status,checklist,atualizado_em)
 on public.sgq_modelos_inspecao to authenticated;

comment on table public.sgq_modelos_inspecao is
 'Cadastro independente de modelos de checklist para Armazém e Qualidade. Não substitui as instruções técnicas vigentes.';
