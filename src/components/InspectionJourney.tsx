import { ArrowLeft, ArrowRight } from 'lucide-react'
import './InspectionJourney.css'

export type InspectionStageKey =
  | 'dados'
  | 'amostragem'
  | 'verificacoes'
  | 'dimensionais'
  | 'testes'
  | 'fotos'
  | 'resultado'
  | 'retencao'

type JourneyStep = {
  id: InspectionStageKey
  title: string
  done: boolean
  optional?: boolean
}

type Props = {
  activeStage: InspectionStageKey
  onSelectStage: (stage: InspectionStageKey) => void
  processCode: string
  inspectionNumber?: string | null
  client?: string | null
  nf?: string | null
  instruction?: string | null
  instructionSelected: boolean
  inspectionStatus: string
  samplingDone: boolean
  checklistDone: boolean
  dimensionsDone: boolean
  testsDone: boolean
  photoCount: number
  retentionDone: boolean
}

/**
 * Apresentação da jornada de inspeção.
 * Não persiste dados, não decide Ac/Re e não altera as regras da API.
 * Mantém uma navegação de botões nativos para teclado e toque, sem depender
 * do padrão ARIA tablist/roving-tabindex para mudar de etapa.
 */
export default function InspectionJourney({
  activeStage, onSelectStage, processCode, inspectionNumber, client, nf,
  instruction, instructionSelected, inspectionStatus, samplingDone,
  checklistDone, dimensionsDone, testsDone, photoCount, retentionDone,
}: Props) {
  const steps: JourneyStep[] = [
    { id: 'dados', title: 'Dados', done: instructionSelected },
    { id: 'amostragem', title: 'Amostragem', done: samplingDone },
    { id: 'verificacoes', title: 'Verificações', done: checklistDone },
    { id: 'dimensionais', title: 'Dimensionais', done: dimensionsDone },
    { id: 'testes', title: 'Testes', done: testsDone },
    { id: 'fotos', title: 'Fotos', done: photoCount > 0, optional: true },
    { id: 'resultado', title: 'Resultado', done: inspectionStatus === 'concluida' },
    { id: 'retencao', title: 'Retenção', done: retentionDone, optional: true },
  ]
  const currentIndex = Math.max(0, steps.findIndex(step => step.id === activeStage))
  const previousStep = steps[currentIndex - 1]
  const nextStep = steps[currentIndex + 1]
  const technicalCompleted = [samplingDone, checklistDone, dimensionsDone, testsDone]
    .filter(Boolean).length
  const currentStep = steps[currentIndex]
  const nextLabel = inspectionStatus === 'aberta' && nextStep?.id === 'amostragem'
    ? 'Iniciar inspeção'
    : 'Próxima etapa'

  return (
    <div className="sgq-journey">
      <section className="sgq-journey-context" aria-label="Contexto da inspeção">
        <div className="sgq-journey-identity">
          <span className="sgq-journey-kicker">
            {inspectionNumber ? 'INSPEÇÃO ' + inspectionNumber : 'INSPEÇÃO EM ANDAMENTO'}
          </span>
          <strong>{processCode || 'Processo não identificado'}</strong>
          <span className="sgq-journey-client">{client || 'Cliente não informado'}</span>
        </div>
        <dl className="sgq-journey-meta">
          <div>
            <dt>NF de entrada</dt>
            <dd>{nf || 'Não informada'}</dd>
          </div>
          <div>
            <dt>Instrução técnica</dt>
            <dd>{instructionSelected ? (instruction || 'Versão não identificada') : 'IT não selecionada'}</dd>
          </div>
        </dl>
        <div className="sgq-journey-progress-group">
          <div className="sgq-journey-progress-title">
            <span>Etapas técnicas concluídas</span>
            <strong>{technicalCompleted} de 4</strong>
          </div>
          <div className="sgq-journey-progress-track" role="progressbar"
            aria-label="Etapas técnicas concluídas"
            aria-valuemin={0} aria-valuemax={4} aria-valuenow={technicalCompleted}>
            <span style={{ width: (technicalCompleted / 4 * 100) + '%' }} />
          </div>
          <small>Fotos e retenção são etapas complementares.</small>
        </div>
      </section>

      <nav id="inspection-stage-nav" className="inspection-stage-tabs sgq-journey-nav"
        aria-label="Etapas da inspeção">
        {steps.map((step, index) => (
          <button key={step.id} type="button"
            aria-current={activeStage === step.id ? 'step' : undefined}
            className={'inspection-stage-tab' +
              (activeStage === step.id ? ' active' : '') +
              (step.done ? ' done' : '')}
            onClick={() => onSelectStage(step.id)}>
            <span className="inspection-stage-dot" aria-hidden="true">
              {step.done ? '✓' : index + 1}
            </span>
            <span className="sgq-journey-step-title">{step.title}</span>
            {step.optional && <span className="sgq-journey-optional">Opcional</span>}
          </button>
        ))}
      </nav>

      <div className="sgq-journey-controls" aria-label="Navegação entre etapas">
        <button type="button" className="secondary sgq-journey-previous"
          disabled={!previousStep} onClick={() => previousStep && onSelectStage(previousStep.id)}>
          <ArrowLeft size={17} aria-hidden="true" /> Anterior
        </button>
        <p className="sgq-journey-position" aria-live="polite">
          Etapa {currentIndex + 1} de {steps.length}: <strong>{currentStep.title}</strong>
        </p>
        <button type="button" className="primary sgq-journey-next"
          disabled={!nextStep} onClick={() => nextStep && onSelectStage(nextStep.id)}>
          {nextStep ? nextLabel : 'Última etapa'}
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
