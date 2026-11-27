export function indexActiveInspections<T extends {status: string; grupos_inspecao?: {processo_id: string} | null}>(inspections: readonly T[]): Map<string, T[]>
export function workspaceQuery(mode: 'page' | 'panel', localQuery: string, externalQuery?: string): string
export function canTransitionInspection(status: string, allowed: boolean, busy: boolean): boolean

export type WorkFilter='pendentes'|'em_andamento'|'aberta'|'concluida'|'todas'
export function workQueueCounts<T extends {status:string}>(items:readonly T[]):Record<WorkFilter,number>
export function workQueue<T extends {status:string;criado_em:string}>(items:readonly T[],filter:WorkFilter):T[]
