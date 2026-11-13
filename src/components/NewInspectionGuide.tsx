import { Check, ClipboardList, FileCheck2, Package } from 'lucide-react'
import './NewInspectionGuide.css'

type Props = {
  processCode: string
  skuCount: number
  hasInstruction: boolean
}

/** Navegação contextual do cadastro, sem alterar validação ou persistência. */
export default function NewInspectionGuide({ processCode, skuCount, hasInstruction }: Props) {
  const sections = [
    {
      href: '#sgq-new-inspection-general',
      number: '01',
      label: 'Dados gerais',
      detail: processCode ? processCode : 'Identificar processo',
      Icon: ClipboardList,
      ready: Boolean(processCode),
    },
    {
      href: '#sgq-new-inspection-products',
      number: '02',
      label: 'Produtos e lotes',
      detail: skuCount ? skuCount + (skuCount === 1 ? ' item informado' : ' itens informados') : 'Adicionar produtos',
      Icon: Package,
      ready: skuCount > 0,
    },
    {
      href: '#sgq-new-inspection-instruction',
      number: '03',
      label: 'IT aplicável',
      detail: hasInstruction ? 'IT selecionada' : 'Selecionar instrução',
      Icon: FileCheck2,
      ready: hasInstruction,
    },
  ]

  return (
    <nav className="sgq-new-inspection-guide" aria-label="Navegar pelas seções da inspeção">
      {sections.map(section => (
        <a className="sgq-new-inspection-guide-item" href={section.href} key={section.href}>
          <span className="sgq-new-inspection-guide-icon" aria-hidden="true">
            <section.Icon size={19} />
          </span>
          <span className="sgq-new-inspection-guide-copy">
            <span className="sgq-new-inspection-guide-label">
              <small>{section.number}</small> {section.label}
            </span>
            <span className="sgq-new-inspection-guide-detail">{section.detail}</span>
          </span>
          {section.ready && <Check size={17} className="sgq-new-inspection-guide-check" aria-label="Informações presentes" />}
        </a>
      ))}
    </nav>
  )
}
