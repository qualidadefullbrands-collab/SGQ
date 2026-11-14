/**
 * Fronteira de dados da conciliação física.
 *
 * A origem de quantidade deve representar referência física da localização SGQ.
 * Omie é fonte de identificação cadastral (SKU/descrição), nunca de saldo local.
 * Referências históricas originadas do Omie são tratadas como não verificadas.
 */
export type QuantityReferenceRecord = {
  quantidade_referencia?: number | null
  referencia_fonte?: string | null
}

export function invalidQuantityReferenceSource(source: string | null | undefined): boolean {
  return /\bomie\b|\bsaldo\s+(?:do\s+)?erp\b/i.test(String(source || ''))
}

export function localQuantityReference(
  record: QuantityReferenceRecord | null | undefined
): number | null {
  if (!record || invalidQuantityReferenceSource(record.referencia_fonte)) return null
  const quantity = record.quantidade_referencia
  if (quantity === null || quantity === undefined) return null
  const n = Number(quantity)
  return Number.isFinite(n) && n >= 0 ? n : null
}
