-- Archives a process and its linked operational inspection/group rows atomically.
-- Preserves all history, measurements, photos and associated evidence.
-- SECURITY INVOKER deliberately retains RLS; do not change to SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.sgq_archive_process(p_id uuid)
RETURNS TABLE (process_archived boolean, inspections_archived integer, groups_archived integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_existing uuid;
    v_process_changed boolean := false;
    v_inspections integer := 0;
    v_groups integer := 0;
BEGIN
    IF v_user IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = v_user AND perfil IN ('administrador', 'gestor')
    ) THEN
        RAISE EXCEPTION 'Usuário sem permissão para excluir processos.'
            USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_existing
    FROM public.processos WHERE id = p_id FOR UPDATE;
    IF v_existing IS NULL THEN
        RAISE EXCEPTION 'Processo não encontrado.' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.processos
    SET excluido_em = now(), excluido_por = v_user,
        status = 'cancelado', atualizado_em = now()
    WHERE id = p_id AND excluido_em IS NULL;
    v_process_changed := FOUND;

    UPDATE public.inspecoes AS i
    SET excluido_em = now(), excluido_por = v_user, status = 'cancelada'
    WHERE i.excluido_em IS NULL AND EXISTS (
        SELECT 1 FROM public.grupos_inspecao AS g
        WHERE g.id = i.grupo_inspecao_id AND g.processo_id = p_id
    );
    GET DIAGNOSTICS v_inspections = ROW_COUNT;

    UPDATE public.grupos_inspecao
    SET status = 'cancelado'
    WHERE processo_id = p_id AND status IS DISTINCT FROM 'cancelado';
    GET DIAGNOSTICS v_groups = ROW_COUNT;

    IF v_process_changed OR v_inspections > 0 OR v_groups > 0 THEN
        INSERT INTO public.audit_log (usuario_id, entidade, entidade_id, acao, dados)
        VALUES (v_user, 'processos', p_id::text, 'exclusao_logica',
            jsonb_build_object(
                'inspecoes_arquivadas', v_inspections,
                'grupos_arquivados', v_groups
            ));
    END IF;

    RETURN QUERY SELECT v_process_changed, v_inspections, v_groups;
END;
$$;

REVOKE ALL ON FUNCTION public.sgq_archive_process(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sgq_archive_process(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.sgq_archive_process(uuid) TO authenticated;


-- Repair the operational orphan left by legacy process-only soft deletes.
-- This is non-destructive: inspection data and evidence remain stored.
WITH archived_orphans AS (
    UPDATE public.inspecoes AS i
    SET excluido_em = p.excluido_em,
        excluido_por = p.excluido_por,
        status = 'cancelada'
    FROM public.grupos_inspecao AS g
    JOIN public.processos AS p ON p.id = g.processo_id
    WHERE i.grupo_inspecao_id = g.id
      AND p.excluido_em IS NOT NULL
      AND i.excluido_em IS NULL
    RETURNING i.id AS inspection_id, p.id AS process_id
)
INSERT INTO public.audit_log (usuario_id, entidade, entidade_id, acao, dados)
SELECT NULL, 'inspecoes', inspection_id::text, 'regularizacao_exclusao_logica',
       jsonb_build_object('processo_id', process_id::text)
FROM archived_orphans;

UPDATE public.grupos_inspecao AS g
SET status = 'cancelado'
FROM public.processos AS p
WHERE g.processo_id = p.id
  AND p.excluido_em IS NOT NULL
  AND g.status IS DISTINCT FROM 'cancelado';
