/** Index active inspections in one traversal, retaining each inspection identity. */
export function indexActiveInspections(inspections) {
  const byProcess = new Map()
  for (const inspection of inspections) {
    if (inspection.status === 'cancelada') continue
    const id = inspection.grupos_inspecao?.processo_id
    if (!id) continue
    const group = byProcess.get(id)
    if (group) group.push(inspection)
    else byProcess.set(id, [inspection])
  }
  return byProcess
}

/** Operational workspace owns its search; legacy embedded panel follows its parent. */
export function workspaceQuery(mode, localQuery, externalQuery) {
  return mode === 'panel' ? (externalQuery ?? '') : localQuery
}

/** Completed/cancelled inspections are not eligible for operational status changes. */
export function canTransitionInspection(status, allowed, busy) {
  return allowed && !busy && (status === 'aberta' || status === 'em_andamento')
}
