-- Operational boxes are indivisible. Legacy 3.99/14.99 was corrected separately
-- only after reconciling the source distribution (3 standard + 1 fractional).
ALTER TABLE public.processo_itens
  ADD CONSTRAINT processo_itens_caixas_inteiras CHECK (
    (caixas_recebidas IS NULL OR (caixas_recebidas>=0 AND caixas_recebidas=trunc(caixas_recebidas)))
    AND (caixas_inspecionadas IS NULL OR (caixas_inspecionadas>=0 AND caixas_inspecionadas=trunc(caixas_inspecionadas)))
  );
ALTER TABLE public.inspecoes
  ADD CONSTRAINT inspecoes_caixas_inteiras CHECK (
    (caixas_recebidas IS NULL OR (caixas_recebidas>=0 AND caixas_recebidas=trunc(caixas_recebidas)))
    AND (caixas_avaliar IS NULL OR (caixas_avaliar>=0 AND caixas_avaliar=trunc(caixas_avaliar)))
  );

CREATE TABLE public.inventarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto','fechado','ajustado','cancelado')),
  endereco text,
  observacao text,
  criado_por uuid NOT NULL REFERENCES auth.users(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  ajustado_em timestamptz
);
CREATE TABLE public.inventario_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id uuid NOT NULL REFERENCES public.inventarios(id) ON DELETE CASCADE,
  amostra_id uuid NOT NULL REFERENCES public.amostras(id) ON DELETE RESTRICT,
  sku text,
  descricao text,
  endereco text,
  unidade_controle text NOT NULL,
  saldo_sistema numeric NOT NULL CHECK (saldo_sistema>=0),
  quantidade_contada numeric CHECK (quantidade_contada IS NULL OR quantidade_contada>=0),
  contado_por uuid REFERENCES auth.users(id),
  contado_em timestamptz,
  UNIQUE(inventario_id,amostra_id)
);
CREATE INDEX idx_inventario_itens_inventario ON public.inventario_itens(inventario_id);
CREATE INDEX idx_inventarios_status_criado ON public.inventarios(status,criado_em DESC);
ALTER TABLE public.inventarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_itens ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.inventarios TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.inventario_itens TO authenticated;

CREATE POLICY inventarios_select ON public.inventarios
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.ativo=true
      AND p.perfil IN ('administrador','gestor','inspetor','consulta'))
  );
CREATE POLICY inventarios_insert ON public.inventarios
  FOR INSERT TO authenticated WITH CHECK (
    criado_por=auth.uid() AND status='aberto'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.ativo=true
      AND p.perfil IN ('administrador','gestor','inspetor'))
  );
CREATE POLICY inventarios_update ON public.inventarios
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.ativo=true
      AND p.perfil IN ('administrador','gestor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.ativo=true
      AND p.perfil IN ('administrador','gestor')));
CREATE POLICY inventario_itens_select ON public.inventario_itens
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.inventarios i WHERE i.id=inventario_id)
  );
CREATE POLICY inventario_itens_insert ON public.inventario_itens
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.inventarios i WHERE i.id=inventario_id AND i.status='aberto'
      AND i.criado_por=auth.uid())
  );
CREATE POLICY inventario_itens_update ON public.inventario_itens
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.inventarios i WHERE i.id=inventario_id AND i.status='aberto')
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.ativo=true
      AND p.perfil IN ('administrador','gestor','inspetor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.inventarios i WHERE i.id=inventario_id AND i.status='aberto')
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.ativo=true
      AND p.perfil IN ('administrador','gestor','inspetor')));

-- An admin/manager explicitly approves stock adjustments after counting and closing.
-- The whole reconciliation is one transaction and cannot be replayed.
CREATE OR REPLACE FUNCTION public.sgq_aplicar_inventario(p_inventario_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp
AS $$
DECLARE
  sess public.inventarios%ROWTYPE;
  row_item public.inventario_itens%ROWTYPE;
  current_balance numeric;
  change_qty numeric;
  adjustments integer:=0;
BEGIN
  IF NOT EXISTS (
     SELECT 1 FROM public.profiles WHERE id=auth.uid() AND ativo=true
       AND perfil IN ('administrador','gestor')
  ) THEN RAISE EXCEPTION 'Sem permissão para aplicar ajustes de inventário';
  END IF;

  SELECT * INTO sess FROM public.inventarios
    WHERE id=p_inventario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventário não encontrado'; END IF;
  IF sess.status='ajustado' THEN
    RETURN jsonb_build_object('ok',true,'ja_aplicado',true,'ajustes',0);
  END IF;
  IF sess.status<>'fechado' THEN RAISE EXCEPTION 'Feche o inventário antes de aplicar ajustes'; END IF;
  IF EXISTS(SELECT 1 FROM public.inventario_itens
    WHERE inventario_id=p_inventario_id AND quantidade_contada IS NULL)
  THEN RAISE EXCEPTION 'Inventário com contagens pendentes'; END IF;

  FOR row_item IN SELECT * FROM public.inventario_itens
      WHERE inventario_id=p_inventario_id ORDER BY amostra_id
  LOOP
    PERFORM 1 FROM public.amostras WHERE id=row_item.amostra_id FOR UPDATE;
    SELECT saldo INTO current_balance FROM public.vw_saldo_amostras WHERE id=row_item.amostra_id;
    IF current_balance IS NULL OR current_balance<>row_item.saldo_sistema THEN
      RAISE EXCEPTION 'Saldo de estoque alterado durante o inventário; faça nova contagem';
    END IF;
    change_qty:=row_item.quantidade_contada-current_balance;
    IF change_qty<>0 THEN
      INSERT INTO public.amostra_movimentacoes(
        amostra_id,tipo,quantidade,motivo,usuario_id,endereco_origem,endereco_destino)
      VALUES (
        row_item.amostra_id,
        CASE WHEN change_qty>0 THEN 'entrada' ELSE 'retirada' END,
        abs(change_qty),
        'Ajuste autorizado inventário '||sess.codigo,
        auth.uid(),
        row_item.endereco,
        row_item.endereco
      );
      adjustments:=adjustments+1;
    END IF;
  END LOOP;
  UPDATE public.inventarios SET status='ajustado',ajustado_em=now()
    WHERE id=p_inventario_id;
  RETURN jsonb_build_object('ok',true,'ja_aplicado',false,'ajustes',adjustments);
END
$$;
REVOKE ALL ON FUNCTION public.sgq_aplicar_inventario(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sgq_aplicar_inventario(uuid) TO authenticated;
