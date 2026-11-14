import { Boxes, ClipboardCheck, ClipboardList, ListChecks, Scale } from 'lucide-react'
import './StockWorkspaceNav.css'

export type StockWorkspaceMode = 'posicoes' | 'inventario' | 'cego' | 'status_cegos' | 'conciliacao'

type Props = {
  active: StockWorkspaceMode
  onChange: (mode: StockWorkspaceMode) => void
}

/**
 * Navegação orientada à tarefa: não altera saldos, sessões ou critérios de inventário.
 * As referências de quantidade da conciliação são exclusivamente locais ao SGQ.
 */
export default function StockWorkspaceNav({ active, onChange }: Props) {
  const entries = [
    {
      key: 'posicoes',
      title: 'Estoque',
      subtitle: 'Consultar posições, saldos e endereços',
      icon: Boxes,
    },
    {
      key: 'cego',
      title: 'Contagem FST',
      subtitle: 'Localização, processo, SKU e foto',
      icon: ClipboardList,
    },
    {
      key: 'status_cegos',
      title: 'Acompanhamento',
      subtitle: 'Contagens, fotos e pendências',
      icon: ListChecks,
    },
    {
      key: 'conciliacao',
      title: 'Conciliação SGQ',
      subtitle: 'Contagem física × referência local',
      icon: Scale,
    },
    {
      key: 'inventario',
      title: 'Inventário de estoque',
      subtitle: 'Inventários das posições de amostras',
      icon: ClipboardCheck,
    },
  ] as const

  return (
    <nav className="sgq-stock-workspace-nav" aria-label="Áreas de estoque e inventário">
      {entries.map(entry => {
        const Icon = entry.icon
        const current = active === entry.key
        return (
          <button
            key={entry.key}
            type="button"
            className={'sgq-stock-workspace-link' + (current ? ' is-current' : '')}
            aria-current={current ? 'page' : undefined}
            onClick={() => onChange(entry.key)}
          >
            <span className="sgq-stock-workspace-link-icon" aria-hidden="true">
              <Icon size={20}/>
            </span>
            <span className="sgq-stock-workspace-link-text">
              <strong>{entry.title}</strong>
              <small>{entry.subtitle}</small>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
