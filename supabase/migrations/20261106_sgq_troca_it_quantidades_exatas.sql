-- Troca de IT única por FST, transacional e auditável; sem apagar evidências históricas.
-- Não altera quantidades existentes: restringe apenas novas gravações/retificações.
ALTER TABLE public.processo_itens
  ADD CONSTRAINT sgq_processo_itens_quantidade_inteira
  CHECK (quantidade IS NULL OR (quantidade >= 0 AND quantidade = trunc(quantidade))) NOT VALID;
ALTER TABLE public.grupo_inspecao_itens
  ADD CONSTRAINT sgq_grupo_itens_quantidade_inteira
  CHECK (quantidade_componente IS NULL OR (quantidade_componente >= 0 AND quantidade_componente = trunc(quantidade_componente))) NOT VALID;

CREATE OR REPLACE FUNCTION public.sgq_trocar_it_fst(
  p_processo_id uuid,
  p_it_versao_id uuid,
  p_confirmado boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp
AS $$
DECLARE
  anterior uuid;
  codigo_fst text;
  qtd_esperada integer;
  qtd_atualizada integer;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=auth.uid() AND ativo=true AND perfil IN ('administrador','gestor','inspetor')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para trocar a IT do processo';
  END IF;

  SELECT it_versao_id,codigo INTO anterior,codigo_fst
  FROM public.processos
  WHERE id=p_processo_id AND excluido_em IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FST não encontrado'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.it_versoes WHERE id=p_it_versao_id AND status='publicada'
  ) THEN RAISE EXCEPTION 'Selecione uma versão de IT publicada'; END IF;

  IF anterior IS NOT DISTINCT FROM p_it_versao_id THEN
    RETURN jsonb_build_object('ok',true,'alterada',false,'itVersionId',p_it_versao_id);
  END IF;
  IF anterior IS NOT NULL AND NOT p_confirmado THEN
    RAISE EXCEPTION 'Confirme a troca da IT do FST e a revisão dos critérios da inspeção';
  END IF;

  SELECT count(*) INTO qtd_esperada FROM public.inspecoes i
    JOIN public.grupos_inspecao g ON g.id=i.grupo_inspecao_id
    WHERE g.processo_id=p_processo_id AND i.excluido_em IS NULL;

  UPDATE public.processos
    SET it_versao_id=p_it_versao_id,atualizado_em=now()
    WHERE id=p_processo_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Não foi possível alterar o FST'; END IF;

  UPDATE public.inspecoes i
    SET it_versao_id=p_it_versao_id,documento_gerado_em=NULL
    FROM public.grupos_inspecao g
    WHERE g.id=i.grupo_inspecao_id AND g.processo_id=p_processo_id AND i.excluido_em IS NULL;
  GET DIAGNOSTICS qtd_atualizada=ROW_COUNT;
  IF qtd_atualizada<>qtd_esperada THEN
    RAISE EXCEPTION 'Nem todas as inspeções foram atualizadas; a operação foi revertida';
  END IF;

  -- Manter a IT anterior como histórico, mas nunca como principal.
  UPDATE public.grupo_inspecao_its
    SET principal=false
    WHERE grupo_inspecao_id IN (
      SELECT id FROM public.grupos_inspecao WHERE processo_id=p_processo_id
    ) AND principal=true;
  INSERT INTO public.grupo_inspecao_its(grupo_inspecao_id,it_versao_id,principal)
    SELECT id,p_it_versao_id,true FROM public.grupos_inspecao
    WHERE processo_id=p_processo_id
    ON CONFLICT (grupo_inspecao_id,it_versao_id)
    DO UPDATE SET principal=true;

  INSERT INTO public.audit_log(usuario_id,entidade,entidade_id,acao,dados)
  VALUES (auth.uid(),'processos',p_processo_id::text,'troca_it',
    jsonb_build_object('codigo_fst',codigo_fst,'it_anterior',anterior,
      'it_nova',p_it_versao_id,'inspecoes_afetadas',qtd_atualizada,
      'criterios_antigos_preservados',true,'registrado_em',now()));

  RETURN jsonb_build_object('ok',true,'alterada',true,
    'itVersionId',p_it_versao_id,'inspecoesAfetadas',qtd_atualizada);
END;
$$;
REVOKE ALL ON FUNCTION public.sgq_trocar_it_fst(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sgq_trocar_it_fst(uuid,uuid,boolean) TO authenticated;
