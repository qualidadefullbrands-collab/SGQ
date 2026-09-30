import { useEffect, useMemo, useState } from 'react'
import { Boxes, ClipboardCheck, FileText, LogOut, PackageSearch, Plus, QrCode, ShieldCheck } from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from './lib/supabase'

type Profile = { nome: string | null; perfil: 'administrador' | 'inspetor' | 'gestor' | 'consulta' }
type ItVersion = {
  id: string
  versao: string
  nivel_inspecao_padrao: string | null
  instrucoes_trabalho: { codigo: string; titulo: string } | null
}
type Group = {
  id: string
  nome: string
  codigo: string
  tipo: string
  tamanho_lote_estatistico: number
  processo_id: string
  processos?: { codigo: string; cliente: string | null } | null
}
type Sample = {
  id: string
  codigo: string
  descricao: string | null
  endereco: string | null
  lote: string | null
  saldo: number
  unidade_controle: string
  qr_token: string
  grupo_inspecao_id: string | null
}

const emptySku = () => ({ sku: '', nome: '', lote: '', quantidade: '', unidadesPorConjunto: '1', papel: '' })

export default function App() {
  const [sessionReady, setSessionReady] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [tab, setTab] = useState<'painel' | 'processos' | 'amostras'>('painel')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [login, setLogin] = useState({ email: '', password: '' })
  const [counts, setCounts] = useState({ processos: 0, inspecoes: 0, amostras: 0, laudos: 0 })
  const [itVersions, setItVersions] = useState<ItVersion[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [samples, setSamples] = useState<Sample[]>([])
  const [selectedSample, setSelectedSample] = useState<Sample | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')

  const [processForm, setProcessForm] = useState({
    codigo: '',
    cliente: '',
    groupCode: 'G01',
    groupName: '',
    groupType: 'individual',
    statisticalLot: '',
    itVersionId: '',
    inspectionLevel: '',
  })
  const [skuRows, setSkuRows] = useState([emptySku()])

  const [sampleForm, setSampleForm] = useState({
    groupId: '',
    descricao: '',
    lote: '',
    quantidade: '',
    endereco: '',
    unidade: 'conjunto',
  })

  const canWrite = profile && profile.perfil !== 'consulta'

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null)
      setSessionReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) {
      setProfile(null)
      return
    }
    loadApp()
  }, [userId])

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('amostra')
    if (!token || !samples.length) return
    const found = samples.find((s) => s.qr_token === token)
    if (found) {
      setSelectedSample(found)
      setTab('amostras')
    }
  }, [samples])

  useEffect(() => {
    if (!selectedSample) {
      setQrDataUrl('')
      return
    }
    const url = sampleUrl(selectedSample)
    QRCode.toDataURL(url, { margin: 1, width: 220 }).then(setQrDataUrl)
  }, [selectedSample])

  async function loadApp() {
    setError('')
    const [{ data: p }, { count: processos }, { count: inspecoes }, { count: amostras }, { count: laudos }, its, gs, ss] =
      await Promise.all([
        supabase.from('profiles').select('nome,perfil').eq('id', userId).single(),
        supabase.from('processos').select('*', { count: 'exact', head: true }),
        supabase.from('inspecoes').select('*', { count: 'exact', head: true }),
        supabase.from('amostras').select('*', { count: 'exact', head: true }),
        supabase.from('laudos').select('*', { count: 'exact', head: true }),
        supabase.from('it_versoes').select('id,versao,nivel_inspecao_padrao,instrucoes_trabalho(codigo,titulo)').eq('status', 'publicada'),
        supabase.from('grupos_inspecao').select('id,nome,codigo,tipo,tamanho_lote_estatistico,processo_id,processos(codigo,cliente)').order('criado_em', { ascending: false }),
        supabase.from('vw_saldo_amostras').select('id,codigo,descricao,endereco,lote,saldo,unidade_controle,qr_token,grupo_inspecao_id').order('codigo', { ascending: false }),
      ])

    if (!p) {
      setError('Seu usuário existe no Auth, mas ainda não possui perfil liberado no SGQ.')
      return
    }

    setProfile(p as Profile)
    setCounts({ processos: processos ?? 0, inspecoes: inspecoes ?? 0, amostras: amostras ?? 0, laudos: laudos ?? 0 })
    setItVersions((its.data ?? []) as unknown as ItVersion[])
    setGroups((gs.data ?? []) as unknown as Group[])
    setSamples((ss.data ?? []).map((s: any) => ({ ...s, saldo: Number(s.saldo ?? 0) })))
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const { error } = await supabase.auth.signInWithPassword(login)
    if (error) setError(error.message)
  }

  async function createProcess(e: React.FormEvent) {
    e.preventDefault()
    if (!canWrite || !userId) return
    setError('')
    setMessage('')

    if (!processForm.codigo || !processForm.groupName || !processForm.statisticalLot) {
      setError('Preencha processo, grupo de inspeção e tamanho do lote estatístico.')
      return
    }
    if (skuRows.some((r) => !r.sku || !r.nome || !r.quantidade)) {
      setError('Preencha SKU, nome e quantidade de todos os itens.')
      return
    }

    const { data: proc, error: procErr } = await supabase.from('processos').insert({
      codigo: processForm.codigo.trim(),
      cliente: processForm.cliente.trim() || null,
      status: 'aberto',
      data_processo: new Date().toISOString().slice(0, 10),
      criado_por: userId,
    }).select('id').single()
    if (procErr || !proc) return setError(procErr?.message ?? 'Falha ao criar processo.')

    const { data: group, error: groupErr } = await supabase.from('grupos_inspecao').insert({
      processo_id: proc.id,
      codigo: processForm.groupCode.trim() || 'G01',
      nome: processForm.groupName.trim(),
      tipo: processForm.groupType,
      tamanho_lote_estatistico: Number(processForm.statisticalLot),
    }).select('id').single()
    if (groupErr || !group) return setError(groupErr?.message ?? 'Falha ao criar grupo de inspeção.')

    for (const row of skuRows) {
      let productId: string | null = null
      const existing = await supabase.from('produtos').select('id').eq('sku', row.sku.trim()).maybeSingle()
      if (existing.data?.id) productId = existing.data.id
      else {
        const created = await supabase.from('produtos').insert({ sku: row.sku.trim(), nome: row.nome.trim() }).select('id').single()
        if (created.error || !created.data) return setError(created.error?.message ?? 'Falha ao cadastrar SKU.')
        productId = created.data.id
      }

      const item = await supabase.from('processo_itens').insert({
        processo_id: proc.id,
        produto_id: productId,
        lote: row.lote.trim() || null,
        quantidade: Number(row.quantidade),
      }).select('id').single()
      if (item.error || !item.data) return setError(item.error?.message ?? 'Falha ao cadastrar item do processo.')

      const link = await supabase.from('grupo_inspecao_itens').insert({
        grupo_inspecao_id: group.id,
        processo_item_id: item.data.id,
        quantidade_componente: Number(row.quantidade),
        unidades_por_conjunto: Number(row.unidadesPorConjunto || 1),
        papel: row.papel.trim() || null,
      })
      if (link.error) return setError(link.error.message)
    }

    if (processForm.itVersionId) {
      const linkIt = await supabase.from('grupo_inspecao_its').insert({
        grupo_inspecao_id: group.id,
        it_versao_id: processForm.itVersionId,
        principal: true,
      })
      if (linkIt.error) return setError(linkIt.error.message)
    }

    setMessage('Processo e grupo de inspeção criados com sucesso.')
    setProcessForm({ codigo: '', cliente: '', groupCode: 'G01', groupName: '', groupType: 'individual', statisticalLot: '', itVersionId: '', inspectionLevel: '' })
    setSkuRows([emptySku()])
    await loadApp()
  }

  async function createSample(e: React.FormEvent) {
    e.preventDefault()
    if (!canWrite || !userId) return
    setError('')
    setMessage('')
    const group = groups.find((g) => g.id === sampleForm.groupId)
    if (!group || !sampleForm.quantidade || !sampleForm.endereco) {
      setError('Selecione o grupo e informe quantidade e endereço.')
      return
    }

    const code = `AMO-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`
    const created = await supabase.from('amostras').insert({
      codigo: code,
      processo_id: group.processo_id,
      grupo_inspecao_id: group.id,
      produto_id: null,
      descricao: sampleForm.descricao.trim() || group.nome,
      lote: sampleForm.lote.trim() || null,
      quantidade_inicial: Number(sampleForm.quantidade),
      unidade_controle: sampleForm.unidade,
      endereco: sampleForm.endereco.trim(),
      status: 'ativa',
    }).select('id').single()
    if (created.error || !created.data) return setError(created.error?.message ?? 'Falha ao criar amostra.')

    const movement = await supabase.from('amostra_movimentacoes').insert({
      amostra_id: created.data.id,
      tipo: 'entrada',
      quantidade: Number(sampleForm.quantidade),
      endereco_destino: sampleForm.endereco.trim(),
      motivo: 'Retenção após inspeção',
      usuario_id: userId,
    })
    if (movement.error) return setError(movement.error.message)

    setMessage(`${code} criada e endereçada.`)
    setSampleForm({ groupId: '', descricao: '', lote: '', quantidade: '', endereco: '', unidade: 'conjunto' })
    await loadApp()
  }

  function sampleUrl(sample: Sample) {
    return `${window.location.origin}/?amostra=${sample.qr_token}`
  }

  function downloadZpl(sample: Sample) {
    const group = groups.find((g) => g.id === sample.grupo_inspecao_id)
    const url = sampleUrl(sample)
    const zpl = `^XA
^PW800
^LL400
^CI28
^FO35,28^A0N,34,34^FDAMOSTRA RETIDA - SGQ^FS
^FO35,78^A0N,30,30^FD${sample.codigo}^FS
^FO35,123^A0N,24,24^FD${(sample.descricao || group?.nome || '').slice(0,48)}^FS
^FO35,160^A0N,22,22^FDLote: ${sample.lote || '-'}^FS
^FO35,196^A0N,22,22^FDQtd: ${sample.saldo} ${sample.unidade_controle}^FS
^FO35,240^A0N,30,30^FDENDERECO: ${sample.endereco || '-'}^FS
^FO575,88^BQN,2,6^FDLA,${url}^FS
^FO35,340^A0N,18,18^FDQR abre a ficha rastreavel da amostra^FS
^XZ`
    const blob = new Blob([zpl], { type: 'text/plain;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `${sample.codigo}.zpl`
    a.click()
    URL.revokeObjectURL(href)
  }

  if (!sessionReady) return <div className="center-screen">Carregando SGQ…</div>

  if (!userId) {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={signIn}>
          <div className="brand-mark"><ShieldCheck size={28} /><span>SGQ</span></div>
          <h1>Qualidade Full Brands</h1>
          <p>Acesso restrito ao time de Qualidade.</p>
          <label>E-mail<input type="email" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} required /></label>
          <label>Senha<input type="password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} required /></label>
          {error && <div className="alert error">{error}</div>}
          <button className="primary" type="submit">Entrar</button>
        </form>
      </main>
    )
  }

  if (!profile) return <div className="center-screen">{error || 'Carregando perfil…'}</div>

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><PackageSearch size={24}/><span>APP SGQ</span></div>
        <nav>
          <button className={tab === 'painel' ? 'active' : ''} onClick={() => setTab('painel')}>Painel</button>
          <button className={tab === 'processos' ? 'active' : ''} onClick={() => setTab('processos')}>Processos</button>
          <button className={tab === 'amostras' ? 'active' : ''} onClick={() => setTab('amostras')}>Amostras</button>
        </nav>
        <div className="userbox"><span>{profile.nome || 'Usuário'} · {profile.perfil}</span><button title="Sair" onClick={() => supabase.auth.signOut()}><LogOut size={18}/></button></div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      {tab === 'painel' && (
        <>
          <section className="hero">
            <div><span className="eyebrow">CONTROLE DA QUALIDADE</span><h1>Inspeção, amostragem e retenção em um único fluxo.</h1><p>Estrutura preparada para grupos de inspeção, ITs versionadas, NBR 5426 e rastreabilidade por QR.</p></div>
            <PackageSearch size={54} strokeWidth={1.4}/>
          </section>
          <section className="metrics">
            <Metric icon={ClipboardCheck} label="Processos" value={counts.processos}/>
            <Metric icon={ShieldCheck} label="Inspeções" value={counts.inspecoes}/>
            <Metric icon={Boxes} label="Amostras" value={counts.amostras}/>
            <Metric icon={FileText} label="Laudos" value={counts.laudos}/>
          </section>
          <section className="info-grid">
            <article className="panel"><h2>Regra de conjunto</h2><p>Frasco + tampa, por exemplo, formam um grupo. O lote estatístico é a quantidade de conjuntos, enquanto os dimensionais permanecem separados por SKU.</p></article>
            <article className="panel"><h2>IT + NBR</h2><p>A IT define o que e como inspecionar. A NBR 5426 fornece a lógica estatística. A NBR 5425 entra como apoio consultivo quando relevante.</p></article>
          </section>
        </>
      )}

      {tab === 'processos' && (
        <section className="workspace">
          <div className="section-head"><div><span className="eyebrow">PROCESSOS</span><h1>Novo grupo de inspeção</h1></div></div>
          <form className="panel form-grid" onSubmit={createProcess}>
            <label>Processo FST<input value={processForm.codigo} onChange={(e)=>setProcessForm({...processForm,codigo:e.target.value})} placeholder="FST..." disabled={!canWrite}/></label>
            <label>Cliente<input value={processForm.cliente} onChange={(e)=>setProcessForm({...processForm,cliente:e.target.value})} disabled={!canWrite}/></label>
            <label>Código do grupo<input value={processForm.groupCode} onChange={(e)=>setProcessForm({...processForm,groupCode:e.target.value})} disabled={!canWrite}/></label>
            <label>Nome do grupo<input value={processForm.groupName} onChange={(e)=>setProcessForm({...processForm,groupName:e.target.value})} placeholder="Ex.: Frasco + Tampa" disabled={!canWrite}/></label>
            <label>Tipo<select value={processForm.groupType} onChange={(e)=>setProcessForm({...processForm,groupType:e.target.value})} disabled={!canWrite}><option value="individual">SKU independente</option><option value="kit_componentes">Kit / componentes</option></select></label>
            <label>Lote estatístico<input type="number" min="1" value={processForm.statisticalLot} onChange={(e)=>setProcessForm({...processForm,statisticalLot:e.target.value})} placeholder="Ex.: 10000" disabled={!canWrite}/></label>
            <label className="span-2">IT principal<select value={processForm.itVersionId} onChange={(e)=>setProcessForm({...processForm,itVersionId:e.target.value})} disabled={!canWrite}><option value="">Selecionar depois</option>{itVersions.map((it)=><option key={it.id} value={it.id}>{it.instrucoes_trabalho?.codigo} · {it.instrucoes_trabalho?.titulo} · {it.versao}{it.nivel_inspecao_padrao ? ` · Nível ${it.nivel_inspecao_padrao}` : ''}</option>)}</select></label>

            <div className="span-2 sku-block">
              <div className="sku-head"><h3>SKUs do grupo</h3><button type="button" className="secondary" onClick={()=>setSkuRows([...skuRows,emptySku()])} disabled={!canWrite}><Plus size={16}/> SKU</button></div>
              {skuRows.map((row,i)=>(
                <div className="sku-row" key={i}>
                  <input placeholder="SKU" value={row.sku} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,sku:e.target.value}:r))}/>
                  <input placeholder="Descrição" value={row.nome} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,nome:e.target.value}:r))}/>
                  <input placeholder="Lote" value={row.lote} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,lote:e.target.value}:r))}/>
                  <input type="number" min="0" placeholder="Qtd componente" value={row.quantidade} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,quantidade:e.target.value}:r))}/>
                  <input type="number" min="0.01" step="0.01" placeholder="Unid./conjunto" value={row.unidadesPorConjunto} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,unidadesPorConjunto:e.target.value}:r))}/>
                  <input placeholder="Papel: frasco, tampa…" value={row.papel} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,papel:e.target.value}:r))}/>
                </div>
              ))}
            </div>
            <button className="primary span-2" type="submit" disabled={!canWrite}>{canWrite ? 'Criar processo e grupo' : 'Perfil somente consulta'}</button>
          </form>

          <div className="list">
            {groups.map(g=><article className="row-card" key={g.id}><div><strong>{g.processos?.codigo} · {g.nome}</strong><span>{g.tipo === 'kit_componentes' ? 'Kit/componentes' : 'Independente'} · lote estatístico {g.tamanho_lote_estatistico.toLocaleString('pt-BR')}</span></div><span className="pill">{g.codigo}</span></article>)}
          </div>
        </section>
      )}

      {tab === 'amostras' && (
        <section className="workspace">
          <div className="section-head"><div><span className="eyebrow">RETENÇÃO</span><h1>Amostras rastreáveis</h1></div></div>
          <form className="panel form-grid" onSubmit={createSample}>
            <label className="span-2">Grupo de inspeção<select value={sampleForm.groupId} onChange={(e)=>setSampleForm({...sampleForm,groupId:e.target.value})} disabled={!canWrite}><option value="">Selecione</option>{groups.map(g=><option key={g.id} value={g.id}>{g.processos?.codigo} · {g.nome}</option>)}</select></label>
            <label>Descrição<input value={sampleForm.descricao} onChange={(e)=>setSampleForm({...sampleForm,descricao:e.target.value})} disabled={!canWrite}/></label>
            <label>Lote<input value={sampleForm.lote} onChange={(e)=>setSampleForm({...sampleForm,lote:e.target.value})} disabled={!canWrite}/></label>
            <label>Quantidade<input type="number" min="0.01" step="0.01" value={sampleForm.quantidade} onChange={(e)=>setSampleForm({...sampleForm,quantidade:e.target.value})} disabled={!canWrite}/></label>
            <label>Unidade<select value={sampleForm.unidade} onChange={(e)=>setSampleForm({...sampleForm,unidade:e.target.value})} disabled={!canWrite}><option value="conjunto">conjunto</option><option value="unidade">unidade</option><option value="kit">kit</option></select></label>
            <label className="span-2">Endereço<input value={sampleForm.endereco} onChange={(e)=>setSampleForm({...sampleForm,endereco:e.target.value})} placeholder="Endereço único da amostra" disabled={!canWrite}/></label>
            <button className="primary span-2" type="submit" disabled={!canWrite}>Reter amostra</button>
          </form>

          <div className="sample-grid">
            {samples.map(s=><article className="sample-card" key={s.id} onClick={()=>setSelectedSample(s)}>
              <div><span className="eyebrow">{s.codigo}</span><h3>{s.descricao || 'Amostra'}</h3></div>
              <div className="sample-meta"><span>Saldo <b>{s.saldo} {s.unidade_controle}</b></span><span>Endereço <b>{s.endereco || '-'}</b></span></div>
              <button className="secondary" onClick={(e)=>{e.stopPropagation();downloadZpl(s)}}><QrCode size={16}/> ZPL 100×50</button>
            </article>)}
          </div>

          {selectedSample && <div className="modal-backdrop" onClick={()=>setSelectedSample(null)}><article className="sample-detail" onClick={(e)=>e.stopPropagation()}>
            <button className="close" onClick={()=>setSelectedSample(null)}>×</button>
            <span className="eyebrow">FICHA DA AMOSTRA</span>
            <h2>{selectedSample.codigo}</h2>
            <p>{selectedSample.descricao}</p>
            <div className="detail-grid"><div><small>Endereço</small><strong>{selectedSample.endereco || '-'}</strong></div><div><small>Saldo atual</small><strong>{selectedSample.saldo} {selectedSample.unidade_controle}</strong></div><div><small>Lote</small><strong>{selectedSample.lote || '-'}</strong></div></div>
            {qrDataUrl && <img className="qr" src={qrDataUrl} alt="QR da amostra"/>}
            <code>{sampleUrl(selectedSample)}</code>
            <button className="primary" onClick={()=>downloadZpl(selectedSample)}>Gerar etiqueta Zebra 100×50</button>
          </article></div>}
        </section>
      )}
    </main>
  )
}

function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return <article className="metric"><Icon size={22}/><div><strong>{value}</strong><span>{label}</span></div></article>
}
