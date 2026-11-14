import { AlertCircle, CheckCircle2, FileDown, FileText, RefreshCw } from 'lucide-react'
import './ReportReadinessPanel.css'

export type ReportReadiness = {
  ready: boolean
  pending: string[]
  error?: string
}

type Props = {
  status: ReportReadiness | null
  checking: boolean
  generating: boolean
  consolidated: boolean
  onCheck: () => void
  onGenerate: () => void
}

/**
 * Status documental verificável: nunca presume que o Word está pronto.
 * A API continua responsável por validar, gerar e devolver o documento.
 */
export default function ReportReadinessPanel({
  status, checking, generating, consolidated, onCheck, onGenerate,
}: Props) {
  const state = status?.error ? 'erro'
    : status?.ready ? 'pronto'
      : status?.pending.length ? 'pendencias'
        : 'nao_verificado'
  return (
    <section className="sgq-report-panel" aria-labelledby="sgq-report-title">
      <div className="sgq-report-header">
        <span className="sgq-report-icon" aria-hidden="true"><FileText size={22} /></span>
        <div>
          <h2 id="sgq-report-title">Laudo de inspeção</h2>
          <p>{consolidated
            ? 'Documento consolidado por FST, incluindo as entradas vinculadas.'
            : 'Arquivo Word gerado sob demanda a partir da inspeção e da IT vinculada.'}</p>
        </div>
      </div>
      <div className={'sgq-report-state sgq-report-state-' + state} role="status" aria-live="polite">
        {state === 'pronto' ? <CheckCircle2 size={19} aria-hidden="true" /> :
          state === 'erro' || state === 'pendencias' ? <AlertCircle size={19} aria-hidden="true" /> :
            <FileText size={19} aria-hidden="true" />}
        <div>
          <strong>{state === 'pronto' ? 'Verificação documental concluída'
            : state === 'pendencias' ? 'Pendências identificadas'
              : state === 'erro' ? 'Não foi possível verificar o documento'
                : 'Verificação documental não realizada'}</strong>
          <p>{state === 'pronto' ? 'O serviço não identificou pendências nesta consulta. A geração também é validada pelo servidor.'
            : state === 'pendencias' ? 'Confira os itens abaixo. A análise não altera os dados da inspeção.'
              : state === 'erro' ? 'A falha na consulta não significa que a inspeção esteja incompleta.'
                : 'Você pode conferir pendências antes de gerar o Word. A verificação não é obrigatória.'}</p>
        </div>
      </div>
      {status?.error && <p className="sgq-report-error" role="alert">{status.error}</p>}
      {Boolean(status?.pending.length) && (
        <div id="sgq-word-pendencias" className="sgq-report-pendencies" aria-label="Pendências documentais">
          <strong>{status!.pending.length} {status!.pending.length === 1 ? 'item para verificar' : 'itens para verificar'}</strong>
          <ul>{status!.pending.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </div>
      )}
      <div className="sgq-report-actions">
        <button type="button" className="primary" disabled={generating} onClick={onGenerate}>
          <FileDown size={18} aria-hidden="true" />
          {generating ? 'Gerando laudo…' : 'Gerar laudo Word'}
        </button>
        <button type="button" className="secondary" disabled={checking || generating} onClick={onCheck}>
          <RefreshCw size={17} aria-hidden="true" />
          {checking ? 'Verificando…' : status ? 'Verificar novamente' : 'Verificar pendências'}
        </button>
      </div>
    </section>
  )
}
