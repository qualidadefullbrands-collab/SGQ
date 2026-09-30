import { Boxes, ClipboardCheck, FileText, PackageSearch, QrCode } from 'lucide-react'

const modules = [
  { title: 'Inspeções', description: 'Criar e executar inspeções de forma guiada.', icon: ClipboardCheck },
  { title: 'Estoque de Amostras', description: 'Localizar, movimentar e rastrear amostras.', icon: Boxes },
  { title: 'Laudos', description: 'Gerar e consultar laudos de inspeção.', icon: FileText },
  { title: 'Etiquetas', description: 'Gerar QR Code e arquivos ZPL para Zebra.', icon: QrCode },
]

export default function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <span className="eyebrow">APP SGQ</span>
          <h1>Inspeção e Controle de Amostras</h1>
          <p>Base inicial do novo sistema de qualidade.</p>
        </div>
        <PackageSearch size={48} strokeWidth={1.5} />
      </section>

      <section className="grid">
        {modules.map(({ title, description, icon: Icon }) => (
          <article className="card" key={title}>
            <Icon size={28} />
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
