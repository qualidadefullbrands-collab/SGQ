-- SGQ #74 — Quantidade de referencia exclusivamente fisica/local.
-- Omie pode ser consultado para codigo/descricao, nunca para saldo de conciliacao.
-- Compatibilidade: nao reescreve historicos.
-- Consulta de preflight no projeto SGQ: 0 itens de conciliacao existentes.
-- A constraint e validada nesta mesma migracao; se houver um legado
-- incompativel criado apos o preflight, a migracao falha sem alterar dados.
--
-- Fuentes autorizadas (por SKU e endereco, com evidencia obrigatoria pela
-- constraint sgq_recon_reference_together ja existente):
--   sgq_contagem_fisica_local   : outra contagem fisica documentada no local
--   sgq_inventario_anterior_local : inventario fisico anterior do mesmo endereco
--   sgq_posicao_local_documentada : registro de posicao fisica mantido no SGQ

alter table public.sgq_inventario_conciliacao_itens
 add constraint sgq_recon_referencia_origem_fisica
 check (
   quantidade_referencia is null
   or referencia_fonte in (
     'sgq_contagem_fisica_local',
     'sgq_inventario_anterior_local',
     'sgq_posicao_local_documentada'
   )
 ) not valid;

comment on constraint sgq_recon_referencia_origem_fisica
 on public.sgq_inventario_conciliacao_itens is
 'Uma quantidade de referencia so pode vir de registro fisico SGQ na mesma localizacao; Omie nao fornece quantidades para conciliacao. Legados devem ser revalidados.';

-- Guard adicional para registros historicos que precedem o novo CHECK.
-- Uma tentativa de concluir a conciliacao via RPC (ou outra via autorizada)
-- falha enquanto houver itens sem origem fisica SGQ aprovada.
create or replace function public.sgq_recon_validar_origens_ao_concluir()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
 v_invalidos integer;
begin
 if new.status = 'concluida' and old.status is distinct from 'concluida' then
   select count(*) into v_invalidos
   from public.sgq_inventario_conciliacao_itens item
   where item.inventario_id = new.inventario_id
     and (
       item.quantidade_referencia is null
       or item.referencia_fonte is null
       or item.referencia_fonte not in (
         'sgq_contagem_fisica_local',
         'sgq_inventario_anterior_local',
         'sgq_posicao_local_documentada'
       )
       or item.status not in ('conciliado', 'divergencia_aprovada')
     );
   if v_invalidos > 0 then
     raise exception
       'Conciliação possui % item(ns) sem referência física SGQ válida. Regularize a origem no mesmo endereço antes de concluir.',
       v_invalidos using errcode = '22023';
   end if;
 end if;
 return new;
end;
$$;

revoke all on function public.sgq_recon_validar_origens_ao_concluir() from public, anon, authenticated;

create trigger sgq_recon_origem_fisica_finalizar
before update of status on public.sgq_inventario_conciliacoes
for each row
execute function public.sgq_recon_validar_origens_ao_concluir();

-- Verificacao ANTES de aplicar (consulta nao destrutiva):
-- select inventario_id, item_id, referencia_fonte, status
-- from public.sgq_inventario_conciliacao_itens
-- where quantidade_referencia is not null
--   and (
--     referencia_fonte is null
--     or referencia_fonte not in (
--       'sgq_contagem_fisica_local',
--       'sgq_inventario_anterior_local',
--       'sgq_posicao_local_documentada'
--     )
--   );
--
-- Validacao imediata: somente segue se todas as referencias existentes
-- tiverem origem fisica SGQ admissivel. Nenhum historico e modificado.
alter table public.sgq_inventario_conciliacao_itens
 validate constraint sgq_recon_referencia_origem_fisica;
--
-- Rollback controlado (se necessario, preservar auditoria):
-- drop trigger if exists sgq_recon_origem_fisica_finalizar on public.sgq_inventario_conciliacoes;
-- drop function if exists public.sgq_recon_validar_origens_ao_concluir();
-- alter table public.sgq_inventario_conciliacao_itens
--   drop constraint if exists sgq_recon_referencia_origem_fisica;
