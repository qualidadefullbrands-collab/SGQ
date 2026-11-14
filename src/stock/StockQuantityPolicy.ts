/**
 * Origem da referência quantitativa da conciliação física.
 *
 * A quantidade esperada deve ter evidência física para o mesmo SKU e endereço.
 * Omie é usado apenas para conferir cadastro (código e descrição), nunca saldo.
 * Os códigos desta lista são os mesmos permitidos pelo CHECK do PostgreSQL.
 */
export const LOCAL_QUANTITY_SOURCES = [
  { value: 'sgq_contagem_fisica_local', label: 'Contagem física documentada no endereço' },
  { value: 'sgq_inventario_anterior_local', label: 'Inventário físico anterior do mesmo endereço' },
  { value: 'sgq_posicao_local_documentada', label: 'Registro de posição física no SGQ' },
] as const

const accepted = new Set<string>(LOCAL_QUANTITY_SOURCES.map(item => item.value))

export type QuantityReferenceRecord = {
  quantidade_referencia?: number | null
  referencia_fonte?: string | null
}

export function isApprovedLocalSource(source: string | null | undefined): boolean {
  return accepted.has(String(source || '').trim())
}

// Entrada vazia ainda não representa uma referência e recebe validação pelo formulário.
// Origem histórica, textual ou ERP fora da lista é incompatível.
export function invalidQuantityReferenceSource(source: string | null | undefined): boolean {
  return Boolean(String(source || '').trim()) && !isApprovedLocalSource(source)
}

export function localQuantityReference(
  record: QuantityReferenceRecord | null | undefined,
): number | null {
  if (!record || !isApprovedLocalSource(record.referencia_fonte)) return null
  const quantity = record.quantidade_referencia
  if (quantity === null || quantity === undefined) return null
  const n = Number(quantity)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function quantitySourceLabel(source: string | null | undefined): string {
  return LOCAL_QUANTITY_SOURCES.find(item => item.value === source)?.label
    || (source ? 'Origem anterior — regularização necessária' : 'Origem não informada')
}
