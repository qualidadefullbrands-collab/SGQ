-- Stable offline upload paths are unique per inspection. Allows safe batch replay.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inspecao_fotos_inspecao_storage_path
  ON public.inspecao_fotos(inspecao_id,storage_path);
