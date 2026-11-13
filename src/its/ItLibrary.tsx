import { useMemo, useState } from 'react'
import { CheckCircle2, ClipboardList, FileSearch, RefreshCw, Search } from 'lucide-react'
import './ItLibrary.css'

export type ItLibraryEntry = {
  id: string
  status: string
  versao: string
  vigencia: string | null
  leitura_ia_status: string
  arquivo_nome: string | null
  instrucoes_trabalho: { codigo: string; titulo: string } | null
}

type StatusFilter = 'todas' | 'vigente' | 'revisao' | 'rascunho' | 'obsoleto'
type Props = {
  versions: ItLibraryEntry[]
  canManage: boolean
  busyId: string | null
  onStructure: (versionId: string) => void
  onReview: (version: ItLibraryEntry) => void
}

// Rótulos operacionais do SGQ. O estado original permanece preservado no banco.
// Nunca confundir a etapa de leitura por IA com o ciclo de vida documental.
export function itLifecycle(status: string): { key: StatusFilter | 'desconhecido'; label: string } {
  const key = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (['publicada', 'publicado', 'vigente'].includes(key)) return { key: 'vigente', label: 'Vigente' }
  if (['revisao', 'em_revisao', 'em_revisão'].includes(key)) return { key: 'revisao', label: 'Em revisão' }
  if (['rascunho', 'draft'].includes(key)) return { key: 'rascunho', label: 'Rascunho' }
  if (['obsoleta', 'obsoleto', 'arquivada', 'arquivado'].includes(key)) return { key: 'obsoleto', label: 'Obsoleto' }
  return { key: 'desconhecido', label: 'Status não identificado' }
}

function iaReading(status: string) {
  const key = String(status || '').trim().toLowerCase()
  const labels: Record<string, string> = {
    nao_iniciada: 'Leitura não iniciada',
    aguardando: 'Leitura pendente',
    processando: 'Leitura em andamento',
    erro: 'Falha na leitura',
    revisao: 'Estrutura disponível para revisão',
    publicada: 'Estrutura disponível',
  }
  return labels[key] || 'Leitura: ' + (status ? status.replaceAll('_', ' ') : 'não informada')
}

function dateBR(value: string | null) {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return m ? m[3] + '/' + m[2] + '/' + m[1] : value
}

export default function ItLibrary({ versions, canManage, busyId, onStructure, onReview }: Props) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('todas')
  const counts = useMemo(() => {
    const all = { todas: versions.length, vigente: 0, revisao: 0, rascunho: 0, obsoleto: 0 }
    for (const version of versions) {
      const value = itLifecycle(version.status).key
      if (value !== 'desconhecido') all[value]++
    }
    return all
  }, [versions])

  const filtered = useMemo(() => {
    const term = query.toLocaleLowerCase('pt-BR').trim()
    const rows = versions.filter(version => {
      const lifecycle = itLifecycle(version.status)
      if (status !== 'todas' && lifecycle.key !== status) return false
      const haystack = [
        version.instrucoes_trabalho?.codigo, version.instrucoes_trabalho?.titulo,
        version.versao, version.arquivo_nome,
      ].join(' ').toLocaleLowerCase('pt-BR')
      return !term || haystack.includes(term)
    })
    return rows.sort((a, b) => {
      const byCode = (a.instrucoes_trabalho?.codigo || '').localeCompare(
        b.instrucoes_trabalho?.codigo || '', 'pt-BR', { numeric: true }
      )
      return byCode || b.versao.localeCompare(a.versao, 'pt-BR', { numeric: true })
    })
  }, [versions, query, status])

  const filters: { value: StatusFilter; label: string }[] = [
    { value: 'todas', label: 'Todas' },
    { value: 'vigente', label: 'Vigentes' },
    { value: 'revisao', label: 'Em revisão' },
    { value: 'rascunho', label: 'Rascunhos' },
    { value: 'obsoleto', label: 'Obsoletas' },
  ]

  return (
    <section className="sgq-it-library" aria-label="Biblioteca de instruções técnicas">
      <header className="sgq-it-library-toolbar">
        <div>
          <h2>Instruções técnicas</h2>
          <p>Encontre a versão correta e acompanhe a estruturação do documento.</p>
        </div>
        <label className="sgq-it-library-search">
          <span>Buscar instrução técnica</span>
          <span className="sgq-it-search-control">
            <Search size={17} aria-hidden="true" />
            <input type="search" value={query} onChange={event => setQuery(event.target.value)}
              placeholder="Código, título, versão ou arquivo" />
          </span>
        </label>
      </header>

      <div className="sgq-it-library-filters" role="group" aria-label="Filtrar status da versão">
        {filters.map(filter => (
          <button key={filter.value} type="button"
            className={'sgq-it-filter' + (status === filter.value ? ' is-active' : '')}
            aria-pressed={status === filter.value}
            onClick={() => setStatus(filter.value)}>
            {filter.label} <span>{counts[filter.value]}</span>
          </button>
        ))}
      </div>
      <p className="sgq-it-library-count" role="status">
        {filtered.length} {filtered.length === 1 ? 'versão encontrada' : 'versões encontradas'}
      </p>

      {filtered.length === 0 ? (
        <div className="sgq-it-library-empty">
          <FileSearch size={27} aria-hidden="true" />
          <strong>Nenhuma versão corresponde aos filtros.</strong>
          <p>Altere o termo de busca ou o status da versão.</p>
          <button type="button" className="secondary" onClick={() => { setQuery(''); setStatus('todas') }}>
            Limpar filtros
          </button>
        </div>
      ) : (
        <div className="sgq-it-library-list">
          {filtered.map(version => {
            const lifecycle = itLifecycle(version.status)
            const loading = busyId === version.id
            const canStructure = canManage && ['nao_iniciada', 'aguardando', 'erro'].includes(version.leitura_ia_status)
            const canReview = ['revisao', 'publicada'].includes(version.leitura_ia_status)
            return (
              <article className="sgq-it-library-card" key={version.id}>
                <div className="sgq-it-library-main">
                  <div className="sgq-it-library-identification">
                    <span className="sgq-it-library-code">{version.instrucoes_trabalho?.codigo || 'Código não informado'}</span>
                    <span className={'sgq-it-lifecycle sgq-it-lifecycle-' + lifecycle.key}>
                      {lifecycle.key === 'vigente' ? <CheckCircle2 size={14} aria-hidden="true"/> : <ClipboardList size={14} aria-hidden="true"/>}
                      {lifecycle.label}
                    </span>
                  </div>
                  <h3>{version.instrucoes_trabalho?.titulo || 'IT sem título'}</h3>
                  <div className="sgq-it-library-meta">
                    <span>Versão <strong>{version.versao || 'Não informada'}</strong></span>
                    {version.vigencia && <span>Vigência informada: <strong>{dateBR(version.vigencia)}</strong></span>}
                    {version.arquivo_nome && <span className="sgq-it-library-filename" title={version.arquivo_nome}>{version.arquivo_nome}</span>}
                  </div>
                  <p className="sgq-it-library-ia"><span aria-hidden="true">●</span> {iaReading(version.leitura_ia_status)}</p>
                </div>
                <div className="sgq-it-library-actions">
                  {canStructure && (
                    <button type="button" className="secondary" disabled={loading} onClick={() => onStructure(version.id)}>
                      <RefreshCw size={16} aria-hidden="true" />{loading ? 'Lendo documento…' : 'Estruturar com IA'}
                    </button>
                  )}
                  {canReview && (
                    <button type="button" className="secondary" disabled={loading} onClick={() => onReview(version)}>
                      <FileSearch size={16} aria-hidden="true" /> Revisar estrutura
                    </button>
                  )}
                  {!canStructure && !canReview && <small>Sem ações disponíveis para a estrutura atual</small>}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
