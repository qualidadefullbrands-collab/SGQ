-- Troca atômica da IT de uma inspeção: reinicia critérios e preserva fotos/estoque.
-- Auditoria guarda o estado anterior antes de remover resultados da IT antiga.
create or replace function public.sgq_reiniciar_inspecao_it(
    p_inspecao_id uuid, p_it_versao_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $func$
declare
    v_user uuid := auth.uid();
    v_profile text;
    v_before public.inspecoes%rowtype;
    v_foto_count integer;
    v_before_results jsonb;
    v_group_id uuid;
    v_processo_id uuid;
begin
    if v_user is null then
        raise exception 'Sessão necessária para atualizar a IT.' using errcode='42501';
    end if;
    select perfil into v_profile from public.profiles
    where id=v_user and ativo=true;
    if v_profile not in ('administrador','gestor','inspetor') or v_profile is null then
        raise exception 'Perfil sem permissão para alterar a IT.' using errcode='42501';
    end if;
    if not exists (select 1 from public.it_versoes where id=p_it_versao_id and status='publicada') then
        raise exception 'Selecione uma IT publicada.' using errcode='22023';
    end if;
    select * into v_before from public.inspecoes
    where id=p_inspecao_id and excluido_em is null for update;
    if not found then
        raise exception 'Inspeção não encontrada ou arquivada.' using errcode='P0002';
    end if;
    if v_before.status='cancelada' then
        raise exception 'Inspeção cancelada não pode trocar IT.' using errcode='22023';
    end if;
    if v_before.it_versao_id is not distinct from p_it_versao_id then
        return jsonb_build_object('ok',true,'reiniciada',false,'status',v_before.status);
    end if;
    v_group_id := v_before.grupo_inspecao_id;
    select processo_id into v_processo_id from public.grupos_inspecao
    where id=v_group_id for update;
    if v_processo_id is null then
        raise exception 'Entrada da inspeção não localizada.' using errcode='P0002';
    end if;

    select count(*) into v_foto_count from public.inspecao_fotos
      where inspecao_id=p_inspecao_id and excluido_em is null;

    select jsonb_build_object(
      'inspecao',to_jsonb(v_before),
      'checklist',coalesce((select jsonb_agg(to_jsonb(x)) from public.inspecao_checklist_resultados x where x.inspecao_id=p_inspecao_id),'[]'::jsonb),
      'medicoes',coalesce((select jsonb_agg(to_jsonb(x)) from public.inspecao_dimensionais x where x.inspecao_id=p_inspecao_id),'[]'::jsonb),
      'configuracoes',coalesce((select jsonb_agg(to_jsonb(x)) from public.inspecao_dimensional_configuracoes x where x.inspecao_id=p_inspecao_id),'[]'::jsonb),
      'testes',coalesce((select jsonb_agg(to_jsonb(x)) from public.inspecao_testes_resultados x where x.inspecao_id=p_inspecao_id),'[]'::jsonb),
      'nao_conformidades',coalesce((select jsonb_agg(to_jsonb(x)) from public.inspecao_nao_conformidades x where x.inspecao_id=p_inspecao_id),'[]'::jsonb),
      'registros',coalesce((select jsonb_agg(to_jsonb(x)) from public.inspecao_registros x where x.inspecao_id=p_inspecao_id),'[]'::jsonb)
    ) into v_before_results;

    insert into public.audit_log(usuario_id,entidade,entidade_id,acao,dados)
    values (v_user,'inspecoes',p_inspecao_id::text,'reinicio_por_troca_it',
       jsonb_build_object('it_anterior',v_before.it_versao_id,'it_nova',p_it_versao_id,
         'antes',v_before_results,'fotos_preservadas',v_foto_count,
         'registrado_em',now()));

    -- Fotos permanecem intactas. Fotos anteriormente vinculadas a uma NC perdem
    -- somente o vínculo obsoleto (FK ON DELETE SET NULL), jamais o arquivo.
    delete from public.inspecao_nao_conformidades where inspecao_id=p_inspecao_id;
    delete from public.inspecao_checklist_resultados where inspecao_id=p_inspecao_id;
    delete from public.inspecao_dimensionais where inspecao_id=p_inspecao_id;
    delete from public.inspecao_dimensional_configuracoes where inspecao_id=p_inspecao_id;
    delete from public.inspecao_testes_resultados where inspecao_id=p_inspecao_id;
    delete from public.inspecao_registros where inspecao_id=p_inspecao_id;

    update public.inspecoes
    set it_versao_id=p_it_versao_id,
        status=case when v_before.status='aberta' then 'aberta' else 'em_andamento' end,
        resultado=null,observacoes=null,justificativa_decisao=null,
        total_inspecionado=0,total_conforme=0,total_nao_conforme=0,
        dimensionais_finalizados=false,testes_finalizados=false,
        concluida_em=null,revisao_obrigatoria=false,revisado_em=null,
        documento_gerado_em=null
    where id=p_inspecao_id;

    update public.grupos_inspecao set status='em_inspecao'
    where id=v_group_id;
    update public.processos set status='em_inspecao',atualizado_em=now()
    where id=v_processo_id and excluido_em is null;
    update public.grupo_inspecao_its set principal=false
    where grupo_inspecao_id=v_group_id and principal=true;
    insert into public.grupo_inspecao_its(grupo_inspecao_id,it_versao_id,principal)
    values(v_group_id,p_it_versao_id,true)
    on conflict(grupo_inspecao_id,it_versao_id) do update set principal=true;

    return jsonb_build_object('ok',true,'reiniciada',true,
      'status',case when v_before.status='aberta' then 'aberta' else 'em_andamento' end,
      'fotosPreservadas',v_foto_count,'itAnterior',v_before.it_versao_id,
      'itNova',p_it_versao_id);
end;
$func$;
revoke all on function public.sgq_reiniciar_inspecao_it(uuid,uuid) from public,anon;
grant execute on function public.sgq_reiniciar_inspecao_it(uuid,uuid) to authenticated;
