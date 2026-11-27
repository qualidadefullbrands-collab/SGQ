export function indexActiveInspections<T extends {status: string; grupos_inspecao?: {processo_id: string} | null}>(inspections: readonly T[]): Map<string, T[]>
export function workspaceQuery(mode: 'page' | 'panel', localQuery: string, externalQuery?: string): string
export function canTransitionInspection(status: string, allowed: boolean, busy: boolean): boolean
