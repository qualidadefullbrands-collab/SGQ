import { useEffect, useMemo, useState } from 'react'
import { Boxes, Camera, CheckCircle2, ClipboardCheck, Copy, Edit3, FileDown, FileText, LogOut, PackageSearch, Play, Plus, QrCode, Search, ShieldCheck, Trash2, Upload, Warehouse, X } from 'lucide-react'
import QRCode from 'qrcode'
import { supabase } from './lib/supabase'

type Profile = { nome: string | null; perfil: 'administrador' | 'inspetor' | 'gestor' | 'consulta' }
type ItVersion = {
  id: string
  versao: string
  status: string
  vigencia: string | null
  nivel_inspecao_padrao: string | null
  leitura_ia_status: string
  arquivo_nome: string | null
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
type ProcessRow = {
  id: string
  codigo: string
  cliente: string | null
  nota_fiscal: string | null
  origem: string | null
  transporte: string | null
  chegada_cd: string | null
  data_processo: string
  status: string
  criado_em: string
}
type InspectionRow = {
  id: string
  numero: string
  status: string
  resultado: string | null
  tamanho_lote: number | null
  tamanho_amostra: number | null
  total_inspecionado: number
  total_nao_conforme: number
  nivel_inspecao: string | null
  codigo_amostragem: string | null
  criado_em: string
  grupos_inspecao?: {
    id: string
    nome: string
    tipo: string
    processo_id: string
    processos?: ProcessRow | null
  } | null
  it_versoes?: {
    id: string
    versao: string
    instrucoes_trabalho?: { codigo: string; titulo: string } | null
  } | null
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
  inspecao_id?: string | null
  produto_id?: string | null
}

const emptySku = () => ({
  sku: '',
  nome: '',
  codigoCliente: '',
  lote: '',
  material: '',
  capacidade: '',
  quantidade: '',
  quantidadePorCaixa: '',
  unidadesPorConjunto: '1',
})

function boxesReceived(quantity: string, perBox: string) {
  const q = Number(quantity)
  const p = Number(perBox)
  return q > 0 && p > 0 ? Math.ceil(q / p) : 0
}

function boxesToInspect(totalBoxes: number) {
  if (totalBoxes <= 0) return 0
  return Math.min(totalBoxes, Math.ceil(Math.sqrt(totalBoxes + 1)))
}

const LOT_CODES = [
  { min:2,max:8,I:'A',II:'A',S2:'A' }, { min:9,max:15,I:'A',II:'B',S2:'A' },
  { min:16,max:25,I:'B',II:'C',S2:'A' }, { min:26,max:50,I:'C',II:'D',S2:'B' },
  { min:51,max:90,I:'C',II:'E',S2:'B' }, { min:91,max:150,I:'D',II:'F',S2:'B' },
  { min:151,max:280,I:'E',II:'G',S2:'C' }, { min:281,max:500,I:'F',II:'H',S2:'C' },
  { min:501,max:1200,I:'G',II:'J',S2:'C' }, { min:1201,max:3200,I:'H',II:'K',S2:'D' },
  { min:3201,max:10000,I:'J',II:'L',S2:'D' }, { min:10001,max:35000,I:'K',II:'M',S2:'D' },
  { min:35001,max:150000,I:'L',II:'N',S2:'E' }, { min:150001,max:500000,I:'M',II:'P',S2:'E' },
  { min:500001,max:Number.MAX_SAFE_INTEGER,I:'N',II:'Q',S2:'E' },
]
const SAMPLE_SIZE: Record<string,number> = { A:2,B:3,C:5,D:8,E:13,F:20,G:32,H:50,J:80,K:125,L:200,M:315,N:500,P:800,Q:1250,R:2000 }
const AC_RE_15: Record<string,{ac:number;re:number}> = {
  F:{ac:1,re:2},G:{ac:1,re:2},H:{ac:2,re:3},J:{ac:3,re:4},K:{ac:5,re:6},
  L:{ac:7,re:8},M:{ac:10,re:11},N:{ac:14,re:15},P:{ac:21,re:22}
}
function samplingPlan(lot:number, level:string) {
  if (!lot) return { code:'', sample:0, ac:null as number|null, re:null as number|null }
  if (lot < 281) return { code:'100%', sample:lot, ac:0, re:1 }
  const row=LOT_CODES.find((x)=>lot>=x.min&&lot<=x.max)
  const code=row ? String((row as any)[level] ?? row.I) : ''
  const sample=SAMPLE_SIZE[code] ?? 0
  if (level==='S2') return { code, sample, ac:null, re:null }
  const rule=AC_RE_15[code]
  return { code, sample, ac:rule?.ac ?? null, re:rule?.re ?? null }
}
function statusLabel(value:string|null|undefined) {
  const map:Record<string,string> = {
    em_andamento:'Em andamento',aberta:'Aberta',concluida:'Concluída',cancelada:'Cancelada',
    aprovado:'Aprovado',reprovado:'Reprovado',pendente:'Pendente',
    conforme:'Conforme',nao_conforme:'Não conforme',nao_aplicavel:'Não aplicável'
  }
  return value ? (map[value] ?? value.replaceAll('_',' ')) : '—'
}

export default function App() {
  const [sessionReady, setSessionReady] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [tab, setTab] = useState<'painel' | 'inspecoes' | 'nova' | 'execucao' | 'its' | 'estoque'>('painel')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [login, setLogin] = useState({ email: '', password: '' })
  const [firstAccess, setFirstAccess] = useState(false)
  const [counts, setCounts] = useState({ processos: 0, inspecoes: 0, amostras: 0, laudos: 0 })
  const [processes, setProcesses] = useState<ProcessRow[]>([])
  const [inspections, setInspections] = useState<InspectionRow[]>([])
  const [editingProcess, setEditingProcess] = useState<ProcessRow | null>(null)
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [ncDraft, setNcDraft] = useState({ open: false, severity: 'grave', description: '', itemId: '' })
  const [finalObservation, setFinalObservation] = useState('')
  const [retentionRows, setRetentionRows] = useState<Record<string,{retain:boolean;qty:string;address:string}>>({})
  const [retentionReason, setRetentionReason] = useState('')
  const [stockMove, setStockMove] = useState({ tipo: 'retirada', quantidade: '', endereco: '', motivo: '' })
  const [itVersions, setItVersions] = useState<ItVersion[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [samples, setSamples] = useState<Sample[]>([])
  const [selectedSample, setSelectedSample] = useState<Sample | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')

  const [inspection, setInspection] = useState({
    processoId: '',
    codigo: '',
    cliente: '',
    notaFiscal: '',
    origem: '',
    transporte: '',
    chegadaCd: '',
    dataInspecao: new Date().toISOString().slice(0, 10),
    itVersionId: '',
    inspectionLevel: 'I',
  })
  const [skuRows, setSkuRows] = useState([emptySku()])

  const [itForm, setItForm] = useState({
    codigo: '',
    titulo: '',
    versao: '',
    vigencia: '',
  })
  const [itFile, setItFile] = useState<File | null>(null)

  const [sampleForm, setSampleForm] = useState({
    groupId: '',
    descricao: '',
    lote: '',
    quantidade: '',
    endereco: '',
    unidade: 'conjunto',
  })

  const canWrite = profile && profile.perfil !== 'consulta'
  const canManageIts = profile && ['administrador', 'gestor'].includes(profile.perfil)
  const canDelete = profile && ['administrador', 'gestor'].includes(profile.perfil)

  const statisticalLot = useMemo(() => {
    const valid = skuRows
      .map((r) => {
        const q = Number(r.quantidade)
        const perSet = Math.max(Number(r.unidadesPorConjunto) || 1, 0.000001)
        return q > 0 ? Math.floor(q / perSet) : 0
      })
      .filter((n) => n > 0)
    return valid.length ? Math.min(...valid) : 0
  }, [skuRows])

  const isComponentSet = skuRows.length > 1
  const totalBoxesReceived = useMemo(
    () => skuRows.reduce((sum, r) => sum + boxesReceived(r.quantidade, r.quantidadePorCaixa), 0),
    [skuRows],
  )
  const totalBoxesToInspect = useMemo(
    () => skuRows.reduce((sum, r) => sum + boxesToInspect(boxesReceived(r.quantidade, r.quantidadePorCaixa)), 0),
    [skuRows],
  )

  const previewPlan = useMemo(
    () => samplingPlan(statisticalLot, inspection.inspectionLevel),
    [statisticalLot, inspection.inspectionLevel],
  )

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
      setTab('estoque')
    }
  }, [samples])

  useEffect(() => {
    if (!selectedSample) {
      setQrDataUrl('')
      return
    }
    QRCode.toDataURL(sampleUrl(selectedSample), { margin: 1, width: 220 }).then(setQrDataUrl)
  }, [selectedSample])

  async function loadApp() {
    setError('')
    const [p, proc, ins, its, gs, ss, laudos] = await Promise.all([
      supabase.from('profiles').select('nome,perfil').eq('id', userId).single(),
      supabase.from('processos').select('id,codigo,cliente,nota_fiscal,origem,transporte,chegada_cd,data_processo,status,criado_em').is('excluido_em', null).order('criado_em', { ascending: false }),
      supabase.from('inspecoes').select('id,numero,status,resultado,tamanho_lote,tamanho_amostra,total_inspecionado,total_nao_conforme,nivel_inspecao,codigo_amostragem,criado_em,grupos_inspecao(id,nome,tipo,processo_id,processos(id,codigo,cliente,nota_fiscal,origem,transporte,chegada_cd,data_processo,status,criado_em)),it_versoes(id,versao,instrucoes_trabalho(codigo,titulo))').order('criado_em', { ascending: false }),
      supabase.from('it_versoes').select('id,versao,status,vigencia,nivel_inspecao_padrao,leitura_ia_status,arquivo_nome,instrucoes_trabalho(codigo,titulo)').order('criado_em', { ascending: false }),
      supabase.from('grupos_inspecao').select('id,nome,codigo,tipo,tamanho_lote_estatistico,processo_id,processos(codigo,cliente)').order('criado_em', { ascending: false }),
      supabase.from('vw_saldo_amostras').select('id,codigo,descricao,endereco,lote,saldo,unidade_controle,qr_token,grupo_inspecao_id,inspecao_id,produto_id').order('codigo', { ascending: false }),
      supabase.from('laudos').select('*', { count: 'exact', head: true }),
    ])
    if (!p.data) {
      setError('Seu usuário ainda não possui perfil liberado no SGQ.')
      return
    }
    setProfile(p.data as Profile)
    setProcesses((proc.data ?? []) as ProcessRow[])
    setInspections((ins.data ?? []) as unknown as InspectionRow[])
    setItVersions((its.data ?? []) as unknown as ItVersion[])
    setGroups((gs.data ?? []) as unknown as Group[])
    setSamples((ss.data ?? []).map((s: any) => ({ ...s, saldo: Number(s.saldo ?? 0) })))
    setCounts({
      processos: (proc.data ?? []).length,
      inspecoes: (ins.data ?? []).length,
      amostras: (ss.data ?? []).length,
      laudos: laudos.count ?? 0,
    })
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    const { error } = await supabase.auth.signInWithPassword(login)
    if (error) setError(error.message)
  }

  async function createFirstAccess(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    const normalizedEmail = login.email.trim().toLowerCase()
    if (normalizedEmail !== 'vanessa.casarin@fullbrands.com.br') {
      setError('Este primeiro acesso está liberado apenas para o administrador autorizado.')
      return
    }
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password: login.password,
      options: { data: { nome: 'Vanessa Casarin' }, emailRedirectTo: window.location.origin },
    })
    if (error) return setError(error.message)
    if (data.session) setMessage('Acesso administrativo criado.')
    else {
      setMessage('Acesso criado. Confirme o e-mail e depois entre no SGQ.')
      setFirstAccess(false)
    }
  }

  function resetNewInspection() {
    setInspection({
      processoId: '', codigo: '', cliente: '', notaFiscal: '', origem: '', transporte: '', chegadaCd: '',
      dataInspecao: new Date().toISOString().slice(0,10), itVersionId: '', inspectionLevel: 'I',
    })
    setSkuRows([emptySku()])
  }

  function reuseProcess(p: ProcessRow) {
    setInspection((x) => ({
      ...x,
      processoId: p.id,
      codigo: p.codigo,
      cliente: p.cliente ?? '',
      notaFiscal: p.nota_fiscal ?? '',
      origem: p.origem ?? '',
      transporte: p.transporte ?? '',
      chegadaCd: p.chegada_cd ?? '',
      dataInspecao: new Date().toISOString().slice(0,10),
    }))
    setSkuRows([emptySku()])
    setTab('nova')
    setMessage('Dados gerais reutilizados. Informe o novo código/produto desta inspeção.')
  }

  async function lookupProduct(index: number) {
    const code = skuRows[index].sku.trim()
    if (!code) return
    const found = await supabase.from('produtos').select('id,sku,nome').eq('sku', code).maybeSingle()
    if (!found.data) {
      setMessage('Código ainda não existe no cadastro local. A descrição pode ser informada manualmente.')
      return
    }
    setSkuRows((rows) => rows.map((r,i) => i===index ? { ...r, nome: found.data!.nome } : r))
    const items = await supabase.from('processo_itens').select('id').eq('produto_id', found.data.id)
    const ids = (items.data ?? []).map((x:any) => x.id)
    if (!ids.length) return
    const links = await supabase.from('grupo_inspecao_itens').select('grupo_inspecao_id').in('processo_item_id', ids)
    const gids = [...new Set((links.data ?? []).map((x:any) => x.grupo_inspecao_id))] as string[]
    if (!gids.length) return
    const oldIns = await supabase.from('inspecoes').select('id').in('grupo_inspecao_id', gids)
    const inspIds = (oldIns.data ?? []).map((x:any) => x.id)
    if (!inspIds.length) return
    const nc = await supabase.from('inspecao_nao_conformidades').select('id').in('inspecao_id', inspIds).limit(1)
    if ((nc.data ?? []).length) {
      setInspection((x) => ({ ...x, inspectionLevel: 'II' }))
      setMessage('Histórico de não conformidade encontrado para este código: Nível II sugerido.')
    }
  }

  async function saveProcessEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingProcess) return
    const { error } = await supabase.from('processos').update({
      cliente: editingProcess.cliente,
      nota_fiscal: editingProcess.nota_fiscal,
      origem: editingProcess.origem,
      transporte: editingProcess.transporte,
      chegada_cd: editingProcess.chegada_cd,
      atualizado_em: new Date().toISOString(),
    }).eq('id', editingProcess.id)
    if (error) return setError(error.message)
    setEditingProcess(null)
    setMessage('Processo atualizado.')
    await loadApp()
  }

  async function deleteProcess(p: ProcessRow) {
    if (!canDelete || !userId) return
    if (!window.confirm(`Excluir o processo ${p.codigo} da visão operacional? O histórico será preservado para auditoria.`)) return
    const { error } = await supabase.from('processos').update({
      excluido_em: new Date().toISOString(),
      excluido_por: userId,
      status: 'cancelado',
    }).eq('id', p.id)
    if (error) return setError(error.message)
    setMessage('Processo removido da visão operacional.')
    await loadApp()
  }

  async function openInspection(id: string) {
    setError('')
    setSelectedInspectionId(id)
    const ins = await supabase.from('inspecoes')
      .select('*,grupos_inspecao(*,processos(*)),it_versoes(*,instrucoes_trabalho(*))')
      .eq('id', id).single()
    if (ins.error || !ins.data) return setError(ins.error?.message ?? 'Inspeção não encontrada.')
    const groupId = ins.data.grupo_inspecao_id
    const itId = ins.data.it_versao_id
    const [items, checklist, checkResults, params, dimResults, tests, testResults, photos, registers, ncs, retained] = await Promise.all([
      supabase.from('grupo_inspecao_itens').select('id,papel,quantidade_componente,unidades_por_conjunto,processo_itens(id,produto_id,lote,quantidade,codigo_cliente,material,capacidade,quantidade_por_caixa,caixas_recebidas,produtos(id,sku,nome))').eq('grupo_inspecao_id', groupId),
      supabase.from('it_checklist').select('*').eq('it_versao_id', itId).eq('ativo', true).order('ordem'),
      supabase.from('inspecao_checklist_resultados').select('*').eq('inspecao_id', id),
      supabase.from('it_parametros_dimensionais').select('*').eq('it_versao_id', itId).eq('ativo', true).order('ordem'),
      supabase.from('inspecao_dimensionais').select('*').eq('inspecao_id', id),
      supabase.from('it_testes_especiais').select('*').eq('it_versao_id', itId).eq('ativo', true).order('ordem'),
      supabase.from('inspecao_testes_resultados').select('*').eq('inspecao_id', id),
      supabase.from('inspecao_fotos').select('*').eq('inspecao_id', id).order('criado_em'),
      supabase.from('inspecao_registros').select('*').eq('inspecao_id', id).order('sequencia'),
      supabase.from('inspecao_nao_conformidades').select('*').eq('inspecao_id', id).order('criado_em'),
      supabase.from('amostras').select('*').eq('inspecao_id', id),
    ])
    const next = {
      ...ins.data,
      items: items.data ?? [],
      checklist: checklist.data ?? [],
      checklistResults: checkResults.data ?? [],
      params: params.data ?? [],
      dimResults: dimResults.data ?? [],
      tests: tests.data ?? [],
      testResults: testResults.data ?? [],
      photos: photos.data ?? [],
      registers: registers.data ?? [],
      ncs: ncs.data ?? [],
      retained: retained.data ?? [],
    }
    setDetail(next)
    setFinalObservation(ins.data.observacoes ?? '')
    const retention: Record<string,{retain:boolean;qty:string;address:string}> = {}
    for (const link of next.items as any[]) {
      const item = link.processo_itens
      const existing = (next.retained as any[]).find((x) => x.produto_id === item?.produto_id)
      retention[item.id] = { retain: !existing, qty: '', address: '' }
    }
    setRetentionRows(retention)
    setTab('execucao')
  }

  async function createInspection(e: React.FormEvent) {
    e.preventDefault()
    if (!canWrite || !userId) return
    setError('')
    setMessage('')

    if (!inspection.codigo.trim() || !inspection.cliente.trim() || !inspection.dataInspecao) {
      return setError('Preencha Processo FST, Cliente e Data da inspeção.')
    }
    if (!inspection.itVersionId) return setError('Selecione a IT aplicável.')
    if (skuRows.some((r) => !r.sku.trim() || !r.nome.trim() || Number(r.quantidade) <= 0 || Number(r.quantidadePorCaixa) <= 0)) {
      return setError('Em cada produto informe Código, Descrição, Quantidade recebida e Quantidade por caixa.')
    }
    if (statisticalLot <= 0) return setError('Não foi possível calcular o lote estatístico.')

    let processId = inspection.processoId
    const existingByCode = processes.find((p) => p.codigo.toLowerCase() === inspection.codigo.trim().toLowerCase())
    if (!processId && existingByCode) processId = existingByCode.id

    if (processId) {
      const { error } = await supabase.from('processos').update({
        cliente: inspection.cliente.trim(),
        nota_fiscal: inspection.notaFiscal.trim() || null,
        origem: inspection.origem.trim() || null,
        transporte: inspection.transporte.trim() || null,
        chegada_cd: inspection.chegadaCd || null,
        status: 'em_inspecao',
        atualizado_em: new Date().toISOString(),
      }).eq('id', processId)
      if (error) return setError(error.message)
    } else {
      const created = await supabase.from('processos').insert({
        codigo: inspection.codigo.trim(),
        cliente: inspection.cliente.trim(),
        nota_fiscal: inspection.notaFiscal.trim() || null,
        origem: inspection.origem.trim() || null,
        transporte: inspection.transporte.trim() || null,
        chegada_cd: inspection.chegadaCd || null,
        status: 'em_inspecao',
        data_processo: inspection.dataInspecao,
        criado_por: userId,
      }).select('id').single()
      if (created.error || !created.data) return setError(created.error?.message ?? 'Falha ao criar processo.')
      processId = created.data.id
    }

    const groupCount = await supabase.from('grupos_inspecao').select('*', { count: 'exact', head: true }).eq('processo_id', processId)
    const groupCode = `G${String((groupCount.count ?? 0) + 1).padStart(2, '0')}`
    const groupName = skuRows.map((r) => r.nome.trim()).join(' + ')
    const group = await supabase.from('grupos_inspecao').insert({
      processo_id: processId,
      codigo: groupCode,
      nome: groupName,
      tipo: isComponentSet ? 'kit_componentes' : 'individual',
      tamanho_lote_estatistico: statisticalLot,
      status: 'em_inspecao',
    }).select('id').single()
    if (group.error || !group.data) return setError(group.error?.message ?? 'Falha ao iniciar inspeção.')

    let firstItemId: string | null = null
    for (const row of skuRows) {
      let productId: string
      const existing = await supabase.from('produtos').select('id,nome').eq('sku', row.sku.trim()).maybeSingle()
      if (existing.data?.id) {
        productId = existing.data.id
        if (existing.data.nome !== row.nome.trim()) {
          await supabase.from('produtos').update({ nome: row.nome.trim() }).eq('id', productId)
        }
      } else {
        const created = await supabase.from('produtos').insert({ sku: row.sku.trim(), nome: row.nome.trim() }).select('id').single()
        if (created.error || !created.data) return setError(created.error?.message ?? 'Falha ao cadastrar código.')
        productId = created.data.id
      }

      const receivedBoxes = boxesReceived(row.quantidade, row.quantidadePorCaixa)
      const item = await supabase.from('processo_itens').insert({
        processo_id: processId,
        produto_id: productId,
        codigo_cliente: row.codigoCliente.trim() || null,
        lote: row.lote.trim() || null,
        material: row.material.trim() || null,
        capacidade: row.capacidade.trim() || null,
        quantidade: Number(row.quantidade),
        quantidade_por_caixa: Number(row.quantidadePorCaixa),
        caixas_recebidas: receivedBoxes,
      }).select('id').single()
      if (item.error || !item.data) return setError(item.error?.message ?? 'Falha ao cadastrar produto.')
      if (!firstItemId) firstItemId = item.data.id

      const linkItem = await supabase.from('grupo_inspecao_itens').insert({
        grupo_inspecao_id: group.data.id,
        processo_item_id: item.data.id,
        quantidade_componente: Number(row.quantidade),
        unidades_por_conjunto: Number(row.unidadesPorConjunto || 1),
      })
      if (linkItem.error) return setError(linkItem.error.message)
    }

    const linkIt = await supabase.from('grupo_inspecao_its').insert({
      grupo_inspecao_id: group.data.id,
      it_versao_id: inspection.itVersionId,
      principal: true,
    })
    if (linkIt.error) return setError(linkIt.error.message)

    const plan = samplingPlan(statisticalLot, inspection.inspectionLevel)
    const inspectionNumber = `INS-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`
    const createdInspection = await supabase.from('inspecoes').insert({
      numero: inspectionNumber,
      processo_item_id: firstItemId,
      grupo_inspecao_id: group.data.id,
      it_versao_id: inspection.itVersionId,
      status: 'em_andamento',
      resultado: 'pendente',
      tamanho_lote: statisticalLot,
      tamanho_amostra: plan.sample,
      limite_aceitacao: plan.ac,
      limite_rejeicao: plan.re,
      nivel_inspecao: inspection.inspectionLevel,
      nivel_inspecao_origem: 'it',
      regime_inspecao: 'normal',
      tipo_plano: 'simples',
      codigo_amostragem: plan.code,
      nqa_critico: 0.40,
      nqa_grave: 1.50,
      nqa_toleravel: 4.00,
      caixas_recebidas: totalBoxesReceived,
      caixas_avaliar: totalBoxesToInspect,
      data_inspecao: inspection.dataInspecao,
      responsavel_id: userId,
      iniciada_em: new Date().toISOString(),
      parametros_amostragem: { formula_caixas: 'ceil(sqrt(n+1))' },
    }).select('id').single()
    if (createdInspection.error || !createdInspection.data) {
      return setError(createdInspection.error?.message ?? 'Falha ao criar inspeção.')
    }

    setMessage(`Inspeção ${inspectionNumber} iniciada.`)
    resetNewInspection()
    await loadApp()
    await openInspection(createdInspection.data.id)
  }

  async function recordUnit(conforme: boolean) {
    if (!detail || !selectedInspectionId) return
    if (!conforme) {
      setNcDraft({ open: true, severity: 'grave', description: '', itemId: '' })
      return
    }
    await persistUnit(true)
  }

  async function persistUnit(conforme: boolean, nc?: { severity: string; description: string; itemId: string }) {
    if (!detail || !selectedInspectionId || !userId) return
    const seq = (detail.registers?.length ?? 0) + 1
    const reg = await supabase.from('inspecao_registros').insert({
      inspecao_id: selectedInspectionId,
      sequencia: seq,
      conforme,
    }).select('id').single()
    if (reg.error || !reg.data) return setError(reg.error?.message ?? 'Falha ao registrar unidade.')

    if (!conforme && nc) {
      const created = await supabase.from('inspecao_nao_conformidades').insert({
        inspecao_id: selectedInspectionId,
        inspecao_registro_id: reg.data.id,
        processo_item_id: nc.itemId || null,
        descricao: nc.description.trim() || 'Não conformidade identificada',
        severidade: nc.severity,
        tipo: 'amostragem',
      })
      if (created.error) return setError(created.error.message)
    }

    const total = seq
    const ncCount = (detail.registers ?? []).filter((x:any) => x.conforme === false).length + (conforme ? 0 : 1)
    const okCount = total - ncCount
    await supabase.from('inspecoes').update({
      total_inspecionado: total,
      total_conforme: okCount,
      total_nao_conforme: ncCount,
    }).eq('id', selectedInspectionId)

    setNcDraft({ open: false, severity: 'grave', description: '', itemId: '' })
    await openInspection(selectedInspectionId)
    if (detail.limite_rejeicao && ncCount >= detail.limite_rejeicao) {
      setMessage('Limite de rejeição atingido. Você pode encerrar agora ou continuar até completar a amostra.')
    }
  }

  async function saveChecklist(checkId: string, result: string, severity?: string) {
    if (!selectedInspectionId || !userId) return
    const existing = detail?.checklistResults?.find((x:any) => x.checklist_id === checkId)
    const payload = {
      inspecao_id: selectedInspectionId,
      checklist_id: checkId,
      resultado: result,
      severidade_confirmada: result === 'nao_conforme' ? (severity || existing?.severidade_confirmada || 'grave') : null,
      registrado_por: userId,
      registrado_em: new Date().toISOString(),
    }
    const q = await supabase.from('inspecao_checklist_resultados').upsert(payload, { onConflict: 'inspecao_id,checklist_id' })
    if (q.error) return setError(q.error.message)
    await openInspection(selectedInspectionId)
  }

  async function saveChecklistSeverity(checkId: string, severity: string) {
    if (!selectedInspectionId) return
    const q = await supabase.from('inspecao_checklist_resultados')
      .update({ severidade_confirmada: severity })
      .eq('inspecao_id', selectedInspectionId)
      .eq('checklist_id', checkId)
    if (q.error) return setError(q.error.message)
    await openInspection(selectedInspectionId)
  }

  async function saveDimension(itemId: string, param: any, seq: number, value: string) {
    if (!selectedInspectionId || !value.trim()) return
    const q = await supabase.from('inspecao_dimensionais').upsert({
      inspecao_id: selectedInspectionId,
      processo_item_id: itemId,
      parametro_id: param.id,
      sequencia_amostra: seq,
      valor: Number(value.replace(',', '.')),
      unidade: param.unidade || null,
    }, { onConflict: 'inspecao_id,processo_item_id,parametro_id,sequencia_amostra' })
    if (q.error) setError(q.error.message)
  }

  async function markDimensionalsDone() {
    if (!selectedInspectionId) return
    const q = await supabase.from('inspecoes').update({ dimensionais_finalizados: true }).eq('id', selectedInspectionId)
    if (q.error) return setError(q.error.message)
    await openInspection(selectedInspectionId)
  }

  async function saveTest(testId: string, result: string) {
    if (!selectedInspectionId || !userId) return
    const q = await supabase.from('inspecao_testes_resultados').upsert({
      inspecao_id: selectedInspectionId,
      teste_id: testId,
      resultado: result,
      registrado_por: userId,
      registrado_em: new Date().toISOString(),
    }, { onConflict: 'inspecao_id,teste_id' })
    if (q.error) return setError(q.error.message)
    await openInspection(selectedInspectionId)
  }

  async function markTestsDone() {
    if (!selectedInspectionId) return
    const q = await supabase.from('inspecoes').update({ testes_finalizados: true }).eq('id', selectedInspectionId)
    if (q.error) return setError(q.error.message)
    await openInspection(selectedInspectionId)
  }

  async function uploadInspectionPhotos(files: FileList | null) {
    if (!files || !selectedInspectionId) return
    for (const file of Array.from(files)) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${selectedInspectionId}/${Date.now()}-${safe}`
      const up = await supabase.storage.from('inspecao-fotos').upload(path, file, { contentType: file.type || undefined })
      if (up.error) return setError(up.error.message)
      const row = await supabase.from('inspecao_fotos').insert({
        inspecao_id: selectedInspectionId,
        storage_path: path,
        legenda: file.name,
      })
      if (row.error) return setError(row.error.message)
    }
    await openInspection(selectedInspectionId)
  }

  async function finishInspection(result: 'aprovado' | 'reprovado') {
    if (!detail || !selectedInspectionId) return

    const checklistDone = (detail.checklist?.length ?? 0) === 0 ||
      (detail.checklistResults?.length ?? 0) >= detail.checklist.length
    const samplingDone = (detail.total_inspecionado ?? 0) >= (detail.tamanho_amostra ?? 0) ||
      (!!detail.limite_rejeicao && detail.total_nao_conforme >= detail.limite_rejeicao)
    const dimsDone = (detail.params?.length ?? 0) === 0 || detail.dimensionais_finalizados
    const testsDone = (detail.tests?.length ?? 0) === 0 || detail.testes_finalizados

    if (!checklistDone) return setError('Finalize todas as verificações C / NC / NA.')
    if (!samplingDone) return setError('A amostragem ainda não foi concluída.')
    if (!dimsDone) return setError('Finalize as análises dimensionais.')
    if (!testsDone) return setError('Finalize os testes especiais.')

    const thresholdExceeded = !!detail.limite_rejeicao && detail.total_nao_conforme >= detail.limite_rejeicao
    if (thresholdExceeded && result === 'aprovado' && !finalObservation.trim()) {
      return setError('O limite de rejeição foi atingido. Para aprovar, registre a justificativa.')
    }

    const q = await supabase.from('inspecoes').update({
      status: 'concluida',
      resultado: result,
      observacoes: finalObservation.trim() || null,
      justificativa_decisao: thresholdExceeded ? (finalObservation.trim() || null) : null,
      concluida_em: new Date().toISOString(),
    }).eq('id', selectedInspectionId)
    if (q.error) return setError(q.error.message)

    await supabase.from('grupos_inspecao').update({ status: 'concluido' }).eq('id', detail.grupo_inspecao_id)
    setMessage('Inspeção finalizada. Agora defina a retenção das amostras.')
    await loadApp()
    await openInspection(selectedInspectionId)
  }

  async function saveRetention() {
    if (!detail || !selectedInspectionId || !userId) return
    const selected = (detail.items ?? []).filter((link:any) => retentionRows[link.processo_itens.id]?.retain)

    if (!selected.length) {
      if (!retentionReason.trim()) return setError('Informe o motivo para não reter amostra.')
      await supabase.from('inspecoes').update({
        retencao_decisao: false,
        retencao_motivo: retentionReason.trim(),
      }).eq('id', selectedInspectionId)
      setMessage('Inspeção encerrada sem retenção, com justificativa registrada.')
      await openInspection(selectedInspectionId)
      return
    }

    for (const link of selected as any[]) {
      const item = link.processo_itens
      const draft = retentionRows[item.id]
      if (!draft?.qty || !draft.address.trim()) {
        return setError(`Informe quantidade e endereço para ${item.produtos?.nome ?? 'o produto'}.`)
      }
      const exists = (detail.retained ?? []).find((x:any) => x.produto_id === item.produto_id)
      if (exists) continue

      const code = `AMO-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`
      const created = await supabase.from('amostras').insert({
        codigo: code,
        inspecao_id: selectedInspectionId,
        produto_id: item.produto_id,
        processo_id: detail.grupos_inspecao.processo_id,
        grupo_inspecao_id: detail.grupo_inspecao_id,
        lote: item.lote,
        quantidade_inicial: Number(draft.qty),
        status: 'ativa',
        endereco: draft.address.trim(),
        unidade_controle: 'unidade',
        descricao: item.produtos?.nome ?? null,
      }).select('id').single()
      if (created.error || !created.data) return setError(created.error?.message ?? 'Falha ao reter amostra.')

      const mov = await supabase.from('amostra_movimentacoes').insert({
        amostra_id: created.data.id,
        tipo: 'entrada',
        quantidade: Number(draft.qty),
        endereco_destino: draft.address.trim(),
        motivo: 'Retenção após finalização da inspeção',
        usuario_id: userId,
      })
      if (mov.error) return setError(mov.error.message)
    }

    await supabase.from('inspecoes').update({ retencao_decisao: true, retencao_motivo: null }).eq('id', selectedInspectionId)
    setMessage('Amostras enviadas ao estoque.')
    await loadApp()
    await openInspection(selectedInspectionId)
  }

  async function uploadIt(e: React.FormEvent) {
    e.preventDefault()
    if (!canManageIts || !itFile) return
    setError('')
    setMessage('')

    if (!itForm.codigo.trim() || !itForm.titulo.trim() || !itForm.versao.trim()) {
      return setError('Informe código, título e versão da IT.')
    }

    const safeName = itFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${itForm.codigo.replace(/\s+/g, '_')}/${Date.now()}-${safeName}`
    const upload = await supabase.storage.from('it-documentos').upload(path, itFile, { contentType: itFile.type || undefined })
    if (upload.error) return setError(upload.error.message)

    const it = await supabase.from('instrucoes_trabalho').upsert({
      codigo: itForm.codigo.trim(),
      titulo: itForm.titulo.trim(),
      ativo: true,
    }, { onConflict: 'codigo' }).select('id').single()
    if (it.error || !it.data) return setError(it.error?.message ?? 'Falha ao cadastrar IT.')

    const version = await supabase.from('it_versoes').insert({
      instrucao_trabalho_id: it.data.id,
      versao: itForm.versao.trim(),
      vigencia: itForm.vigencia || null,
      status: 'rascunho',
      arquivo_nome: itFile.name,
      arquivo_storage_path: path,
      arquivo_mime: itFile.type || null,
      leitura_ia_status: 'aguardando',
    })
    if (version.error) return setError(version.error.message)

    setItForm({ codigo: '', titulo: '', versao: '', vigencia: '' })
    setItFile(null)
    setMessage('IT enviada. Aguardando leitura e revisão.')
    await loadApp()
  }

  async function createSample(e: React.FormEvent) {
    e.preventDefault()
    if (!canWrite || !userId) return
    setError('')
    setMessage('')
    const group = groups.find((g) => g.id === sampleForm.groupId)
    if (!group || !sampleForm.quantidade || !sampleForm.endereco) {
      return setError('Selecione a inspeção e informe quantidade e endereço.')
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
^FO35,340^A0N,18,18^FDQR abre a ficha da amostra^FS
^XZ`
    const blob = new Blob([zpl], { type: 'text/plain;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `${sample.codigo}.zpl`
    a.click()
    URL.revokeObjectURL(href)
  }

  async function moveStock() {
    if (!selectedSample || !userId || !stockMove.quantidade) return
    const qty = Number(stockMove.quantidade)
    if (qty <= 0) return setError('Informe uma quantidade válida.')
    if (['retirada','descarte'].includes(stockMove.tipo) && qty > selectedSample.saldo) {
      return setError('Quantidade maior que o saldo disponível.')
    }
    const origin = selectedSample.endereco
    const dest = stockMove.endereco.trim() || selectedSample.endereco
    const q = await supabase.from('amostra_movimentacoes').insert({
      amostra_id: selectedSample.id,
      tipo: stockMove.tipo,
      quantidade: qty,
      endereco_origem: origin,
      endereco_destino: ['transferencia','devolucao'].includes(stockMove.tipo) ? dest : null,
      motivo: stockMove.motivo.trim() || null,
      usuario_id: userId,
    })
    if (q.error) return setError(q.error.message)
    if (stockMove.tipo === 'transferencia' && dest) {
      await supabase.from('amostras').update({ endereco: dest }).eq('id', selectedSample.id)
    }
    setStockMove({ tipo:'retirada', quantidade:'', endereco:'', motivo:'' })
    setSelectedSample(null)
    setMessage('Movimentação registrada.')
    await loadApp()
  }

  function downloadInspectionWord() {
    if (!detail) return
    const process = detail.grupos_inspecao?.processos
    const products = (detail.items ?? []).map((x:any) =>
      `<tr><td>${x.processo_itens?.produtos?.sku ?? ''}</td><td>${x.processo_itens?.produtos?.nome ?? ''}</td><td>${x.processo_itens?.lote ?? ''}</td><td>${x.processo_itens?.quantidade ?? ''}</td></tr>`
    ).join('')
    const checks = (detail.checklist ?? []).map((x:any) => {
      const r = detail.checklistResults?.find((z:any) => z.checklist_id === x.id)
      return `<tr><td>${x.ordem}</td><td>${x.requisito}</td><td>${statusLabel(r?.resultado)}</td><td>${r?.severidade_confirmada ?? ''}</td></tr>`
    }).join('')
    const html = `<html><head><meta charset="utf-8"><style>
      body{font-family:Arial,sans-serif;font-size:10.5pt}h1{font-size:17pt}h2{font-size:12pt;margin-top:18px}
      table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #777;padding:5px}th{background:#eee;text-align:left}
    </style></head><body>
      <h1>REGISTRO DE INSPEÇÃO</h1>
      <p><b>${detail.it_versoes?.instrucoes_trabalho?.codigo ?? ''}</b> · ${detail.it_versoes?.instrucoes_trabalho?.titulo ?? ''} · versão ${detail.it_versoes?.versao ?? ''}</p>
      <h2>Identificação</h2>
      <table><tr><th>Processo FST</th><td>${process?.codigo ?? ''}</td><th>Cliente</th><td>${process?.cliente ?? ''}</td></tr>
      <tr><th>Nota fiscal</th><td>${process?.nota_fiscal ?? ''}</td><th>Data</th><td>${detail.data_inspecao ?? ''}</td></tr>
      <tr><th>Origem</th><td>${process?.origem ?? ''}</td><th>Transporte</th><td>${process?.transporte ?? ''}</td></tr></table>
      <h2>Produtos / componentes</h2><table><tr><th>Código</th><th>Descrição</th><th>Lote</th><th>Quantidade</th></tr>${products}</table>
      <h2>Plano de amostragem</h2><table>
      <tr><th>Lote estatístico</th><td>${detail.tamanho_lote ?? ''}</td><th>Nível</th><td>${detail.nivel_inspecao ?? ''}</td></tr>
      <tr><th>Código</th><td>${detail.codigo_amostragem ?? ''}</td><th>Amostra prevista</th><td>${detail.tamanho_amostra ?? ''}</td></tr>
      <tr><th>Amostra efetiva</th><td>${detail.total_inspecionado ?? 0}</td><th>Não conformes</th><td>${detail.total_nao_conforme ?? 0}</td></tr></table>
      <h2>Verificações</h2><table><tr><th>Nº</th><th>Análise</th><th>Resultado</th><th>Classe</th></tr>${checks}</table>
      <h2>Resultado final</h2><p><b>${statusLabel(detail.resultado).toUpperCase()}</b></p>
      <p>${detail.observacoes ?? ''}</p>
    </body></html>`
    const blob = new Blob([html], { type:'application/msword;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `${detail.numero}.doc`
    a.click()
    URL.revokeObjectURL(href)
    if (selectedInspectionId) {
      void supabase.from('inspecoes').update({ documento_gerado_em:new Date().toISOString() }).eq('id',selectedInspectionId)
    }
  }

  if (!sessionReady) return <div className="center-screen">Carregando SGQ…</div>

  if (!userId) {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={firstAccess ? createFirstAccess : signIn}>
          <div className="brand-mark"><ShieldCheck size={28}/><span>SGQ</span></div>
          <h1>{firstAccess ? 'Criar primeiro acesso' : 'Qualidade Full Brands'}</h1>
          <label>E-mail<input type="email" value={login.email} onChange={(e)=>setLogin({...login,email:e.target.value})} required/></label>
          <label>Senha<input type="password" minLength={8} value={login.password} onChange={(e)=>setLogin({...login,password:e.target.value})} required/></label>
          {error && <div className="alert error">{error}</div>}
          {message && <div className="alert success">{message}</div>}
          <button className="primary" type="submit">{firstAccess ? 'Criar acesso' : 'Entrar'}</button>
          <button className="link-button" type="button" onClick={()=>{setFirstAccess(!firstAccess);setError('');setMessage('');setLogin({email:firstAccess?'':'vanessa.casarin@fullbrands.com.br',password:''})}}>
            {firstAccess ? 'Voltar para login' : 'Primeiro acesso da Vanessa'}
          </button>
        </form>
      </main>
    )
  }

  if (!profile) return <div className="center-screen">{error || 'Carregando perfil…'}</div>

  const checklistDone = detail ? (detail.checklist?.length ?? 0) === 0 || (detail.checklistResults?.length ?? 0) >= detail.checklist.length : false
  const dimsDone = detail ? (detail.params?.length ?? 0) === 0 || detail.dimensionais_finalizados : false
  const testsDone = detail ? (detail.tests?.length ?? 0) === 0 || detail.testes_finalizados : false
  const samplingDone = detail ? (detail.total_inspecionado ?? 0) >= (detail.tamanho_amostra ?? 0) || (!!detail.limite_rejeicao && detail.total_nao_conforme >= detail.limite_rejeicao) : false

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><PackageSearch size={24}/><span>SGQ</span></div>
        <nav>
          <button className={tab==='painel'?'active':''} onClick={()=>setTab('painel')}>Painel</button>
          <button className={tab==='inspecoes'?'active':''} onClick={()=>setTab('inspecoes')}>Inspeções</button>
          <button className={tab==='nova'?'active':''} onClick={()=>setTab('nova')}>Nova inspeção</button>
          <button className={tab==='its'?'active':''} onClick={()=>setTab('its')}>ITs</button>
          <button className={tab==='estoque'?'active':''} onClick={()=>setTab('estoque')}>Estoque</button>
        </nav>
        <div className="userbox">
          <span>{profile.nome || 'Usuário'} · {profile.perfil}</span>
          <button title="Sair" onClick={()=>supabase.auth.signOut()}><LogOut size={18}/></button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      {tab==='painel' && (
        <section className="workspace">
          <div className="page-title">
            <div><span className="eyebrow">SGQ</span><h1>Painel</h1></div>
            <button className="primary" onClick={()=>{resetNewInspection();setTab('nova')}}><Plus size={18}/> Nova inspeção</button>
          </div>
          <section className="metrics">
            <Metric icon={ClipboardCheck} label="Processos" value={processes.length}/>
            <Metric icon={ShieldCheck} label="Inspeções" value={inspections.length}/>
            <Metric icon={Boxes} label="Estoque" value={samples.length}/>
            <Metric icon={FileText} label="Concluídas" value={inspections.filter((i)=>i.status==='concluida').length}/>
          </section>

          <section className="panel queue">
            <div className="section-title">
              <h2>Inspeções em andamento</h2>
              <button className="secondary" onClick={()=>setTab('inspecoes')}>Ver todas</button>
            </div>
            {inspections.filter((i)=>i.status==='em_andamento').slice(0,8).map((i)=>(
              <div className="queue-row" key={i.id}>
                <div>
                  <strong>{i.numero} · {i.grupos_inspecao?.processos?.codigo}</strong>
                  <span>{i.grupos_inspecao?.nome} · {i.total_inspecionado}/{i.tamanho_amostra ?? 0} unidades</span>
                </div>
                <button className="primary small" onClick={()=>openInspection(i.id)}><Play size={15}/> Continuar</button>
              </div>
            ))}
            {!inspections.some((i)=>i.status==='em_andamento') && <div className="empty">Nenhuma inspeção em andamento.</div>}
          </section>
        </section>
      )}

      {tab==='inspecoes' && (
        <section className="workspace">
          <div className="page-title">
            <div><span className="eyebrow">PROCESSOS</span><h1>Inspeções</h1></div>
            <button className="primary" onClick={()=>{resetNewInspection();setTab('nova')}}><Plus size={17}/> Nova inspeção</button>
          </div>

          <div className="process-list">
            {processes.map((p)=>{
              const related=inspections.filter((i)=>i.grupos_inspecao?.processo_id===p.id)
              return (
                <article className="process-card" key={p.id}>
                  <div className="process-head">
                    <div>
                      <span className="eyebrow">{p.codigo}</span>
                      <h2>{p.cliente || 'Sem cliente'}</h2>
                      <p>NF {p.nota_fiscal || '—'} · chegada {p.chegada_cd || '—'} · {p.origem || 'origem não informada'}</p>
                    </div>
                    <div className="row-actions">
                      <button className="secondary" onClick={()=>reuseProcess(p)}><Copy size={15}/> Nova inspeção neste processo</button>
                      <button className="secondary icon-only" title="Editar processo" onClick={()=>setEditingProcess({...p})}><Edit3 size={16}/></button>
                      {canDelete && <button className="danger icon-only" title="Excluir processo" onClick={()=>deleteProcess(p)}><Trash2 size={16}/></button>}
                    </div>
                  </div>
                  <div className="inspection-sublist">
                    {related.map((i)=>(
                      <div className="inspection-row" key={i.id}>
                        <div>
                          <strong>{i.numero}</strong>
                          <span>{i.grupos_inspecao?.nome} · {statusLabel(i.status)} · {i.total_inspecionado}/{i.tamanho_amostra ?? 0}</span>
                        </div>
                        <div className="row-actions">
                          {i.resultado && i.resultado!=='pendente' && <span className={'result-badge '+i.resultado}>{statusLabel(i.resultado)}</span>}
                          <button className="primary small" onClick={()=>openInspection(i.id)}>{i.status==='concluida'?'Abrir':'Continuar'}</button>
                        </div>
                      </div>
                    ))}
                    {!related.length && <span className="muted">Nenhuma inspeção neste processo.</span>}
                  </div>
                </article>
              )
            })}
            {!processes.length && <div className="empty">Nenhum processo cadastrado.</div>}
          </div>
        </section>
      )}

      {tab==='nova' && (
        <section className="workspace">
          <div className="page-title">
            <div><span className="eyebrow">INSPEÇÃO</span><h1>Nova inspeção</h1></div>
            <div className="row-actions">
              {processes[0] && <button className="secondary" onClick={()=>reuseProcess(processes[0])}><Copy size={16}/> Reutilizar últimos dados gerais</button>}
              {inspection.processoId && <button className="secondary" onClick={resetNewInspection}>Novo processo</button>}
            </div>
          </div>

          <form onSubmit={createInspection} className="inspection-form">
            <section className="panel section-card">
              <div className="section-title">
                <h2>Dados gerais</h2>
                {inspection.processoId && <span className="pill">Processo existente</span>}
              </div>
              <div className="form-grid">
                <label>Processo FST<input value={inspection.codigo} onChange={(e)=>setInspection({...inspection,codigo:e.target.value})} placeholder="FST..."/></label>
                <label>Cliente<input value={inspection.cliente} onChange={(e)=>setInspection({...inspection,cliente:e.target.value})}/></label>
                <label>Nota fiscal<input value={inspection.notaFiscal} onChange={(e)=>setInspection({...inspection,notaFiscal:e.target.value})}/></label>
                <label>Chegada no CD<input type="date" value={inspection.chegadaCd} onChange={(e)=>setInspection({...inspection,chegadaCd:e.target.value})}/></label>
                <label>Origem<input value={inspection.origem} onChange={(e)=>setInspection({...inspection,origem:e.target.value})}/></label>
                <label>Transporte<input value={inspection.transporte} onChange={(e)=>setInspection({...inspection,transporte:e.target.value})}/></label>
                <label>Data da inspeção<input type="date" value={inspection.dataInspecao} onChange={(e)=>setInspection({...inspection,dataInspecao:e.target.value})}/></label>
                <label>IT aplicável
                  <select value={inspection.itVersionId} onChange={(e)=>setInspection({...inspection,itVersionId:e.target.value})}>
                    <option value="">Selecione</option>
                    {itVersions.filter((it)=>it.status==='publicada').map((it)=>(
                      <option key={it.id} value={it.id}>{it.instrucoes_trabalho?.codigo} · {it.instrucoes_trabalho?.titulo} · {it.versao}</option>
                    ))}
                  </select>
                </label>
                <label>Nível de inspeção
                  <select value={inspection.inspectionLevel} onChange={(e)=>setInspection({...inspection,inspectionLevel:e.target.value})}>
                    <option value="I">Nível I</option>
                    <option value="II">Nível II</option>
                    <option value="S2">Especial S2</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="panel section-card">
              <div className="section-title">
                <h2>Produtos / componentes</h2>
                <button type="button" className="secondary" onClick={()=>setSkuRows([...skuRows,emptySku()])}><Plus size={16}/> Adicionar código</button>
              </div>
              <div className="sku-editor">
                {skuRows.map((row,i)=>{
                  const boxes=boxesReceived(row.quantidade,row.quantidadePorCaixa)
                  const inspect=boxesToInspect(boxes)
                  return (
                    <article className="sku-card" key={i}>
                      <div className="sku-card-head">
                        <strong>{skuRows.length>1?'Componente '+(i+1):'Produto'}</strong>
                        {skuRows.length>1 && <button type="button" className="icon-button" onClick={()=>setSkuRows(skuRows.filter((_,j)=>j!==i))}><X size={16}/></button>}
                      </div>
                      <div className="form-grid">
                        <label>Código
                          <div className="input-action">
                            <input value={row.sku} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,sku:e.target.value}:r))}/>
                            <button type="button" className="secondary icon-only" title="Consultar descrição" onClick={()=>lookupProduct(i)}><Search size={16}/></button>
                          </div>
                        </label>
                        <label>Descrição<input value={row.nome} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,nome:e.target.value}:r))}/></label>
                        <label>Código do cliente<input value={row.codigoCliente} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,codigoCliente:e.target.value}:r))}/></label>
                        <label>Lote<input value={row.lote} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,lote:e.target.value}:r))}/></label>
                        <label>Material<input value={row.material} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,material:e.target.value}:r))}/></label>
                        <label>Capacidade<input value={row.capacidade} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,capacidade:e.target.value}:r))}/></label>
                        <label>Quantidade recebida<input type="number" min="1" value={row.quantidade} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,quantidade:e.target.value}:r))}/></label>
                        <label>Quantidade por caixa<input type="number" min="1" value={row.quantidadePorCaixa} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,quantidadePorCaixa:e.target.value}:r))}/></label>
                        {isComponentSet && <label>Unidades por conjunto<input type="number" min="0.01" step="0.01" value={row.unidadesPorConjunto} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,unidadesPorConjunto:e.target.value}:r))}/></label>}
                      </div>
                      <div className="computed">
                        <span>Caixas recebidas <b>{boxes || '—'}</b></span>
                        <span>Caixas a inspecionar <b>{inspect || '—'}</b></span>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>

            <section className="calc-strip">
              <div><small>Tipo</small><strong>{isComponentSet?'Conjunto / componentes':'Produto independente'}</strong></div>
              <div><small>Lote estatístico</small><strong>{statisticalLot?statisticalLot.toLocaleString('pt-BR'):'—'}</strong></div>
              <div><small>Plano</small><strong>{previewPlan.code?(previewPlan.code+' · '+previewPlan.sample+' un.'):'—'}</strong></div>
              <div><small>Caixas</small><strong>{totalBoxesToInspect?(totalBoxesToInspect+' a inspecionar'):'—'}</strong></div>
            </section>

            <div className="actions"><button className="primary" type="submit">Iniciar e abrir inspeção</button></div>
          </form>
        </section>
      )}

      {tab==='execucao' && detail && (
        <section className="workspace execution">
          <div className="page-title">
            <div>
              <span className="eyebrow">{detail.grupos_inspecao?.processos?.codigo} · {detail.numero}</span>
              <h1>{detail.grupos_inspecao?.nome}</h1>
            </div>
            <div className="row-actions">
              <span className="pill">{statusLabel(detail.status)}</span>
              {detail.status==='concluida' && <button className="secondary" onClick={downloadInspectionWord}><FileDown size={16}/> Word preenchido</button>}
            </div>
          </div>

          <section className="progress-strip">
            <ProgressItem done={samplingDone} label="Amostragem"/>
            <ProgressItem done={checklistDone} label="Verificações"/>
            <ProgressItem done={dimsDone} label="Dimensionais"/>
            <ProgressItem done={testsDone} label="Testes"/>
            <ProgressItem done={detail.status==='concluida'} label="Resultado"/>
            <ProgressItem done={detail.retencao_decisao!==null} label="Retenção"/>
          </section>

          <section className="panel section-card">
            <div className="section-title">
              <h2>Plano de amostragem</h2>
              <span className="pill">Nível {detail.nivel_inspecao} · código {detail.codigo_amostragem || '—'}</span>
            </div>
            <div className="plan-grid">
              <div><small>Lote estatístico</small><strong>{detail.tamanho_lote?.toLocaleString('pt-BR') || '—'}</strong></div>
              <div><small>Amostra prevista</small><strong>{detail.tamanho_amostra || '—'}</strong></div>
              <div><small>Inspecionado</small><strong>{detail.total_inspecionado || 0}</strong></div>
              <div><small>NC</small><strong>{detail.total_nao_conforme || 0}</strong></div>
              <div><small>Ac</small><strong>{detail.limite_aceitacao ?? '—'}</strong></div>
              <div><small>Re</small><strong>{detail.limite_rejeicao ?? '—'}</strong></div>
              <div><small>Caixas recebidas</small><strong>{detail.caixas_recebidas ?? '—'}</strong></div>
              <div><small>Caixas a avaliar</small><strong>{detail.caixas_avaliar ?? '—'}</strong></div>
            </div>
            {detail.status!=='concluida' && (
              <div className="sampling-actions">
                <button className="success-button" disabled={(detail.total_inspecionado ?? 0)>=(detail.tamanho_amostra ?? 0)} onClick={()=>recordUnit(true)}><CheckCircle2 size={18}/> Unidade conforme</button>
                <button className="danger" disabled={(detail.total_inspecionado ?? 0)>=(detail.tamanho_amostra ?? 0)} onClick={()=>recordUnit(false)}>Unidade NC</button>
              </div>
            )}
            {!!detail.limite_rejeicao && detail.total_nao_conforme>=detail.limite_rejeicao && <div className="alert error">Limite de rejeição atingido. Você pode encerrar ou continuar a inspeção; a decisão ficará registrada.</div>}
          </section>

          <section className="panel section-card">
            <h2>Verificações C / NC / NA</h2>
            <div className="checklist">
              {(detail.checklist ?? []).map((item:any)=>{
                const r=detail.checklistResults?.find((x:any)=>x.checklist_id===item.id)
                return (
                  <div className="check-row" key={item.id}>
                    <div className="check-copy"><b>{item.ordem}. {item.requisito}</b><span>{item.instrucao}</span></div>
                    <div className="tri-buttons">
                      <button className={r?.resultado==='conforme'?'selected ok':''} onClick={()=>saveChecklist(item.id,'conforme')}>C</button>
                      <button className={r?.resultado==='nao_conforme'?'selected bad':''} onClick={()=>saveChecklist(item.id,'nao_conforme')}>NC</button>
                      <button className={r?.resultado==='nao_aplicavel'?'selected':''} onClick={()=>saveChecklist(item.id,'nao_aplicavel')}>NA</button>
                    </div>
                    {r?.resultado==='nao_conforme' && (
                      <select className="severity" value={r.severidade_confirmada || 'grave'} onChange={(e)=>saveChecklistSeverity(item.id,e.target.value)}>
                        <option value="critico">Crítico</option>
                        <option value="grave">Grave</option>
                        <option value="toleravel">Tolerável</option>
                      </select>
                    )}
                  </div>
                )
              })}
              {!detail.checklist?.length && <div className="empty">Esta versão da IT ainda não teve o checklist estruturado.</div>}
            </div>
          </section>

          <section className="panel section-card">
            <div className="section-title"><h2>Análises dimensionais</h2>{detail.dimensionais_finalizados && <span className="pill">Concluído</span>}</div>
            {(detail.items ?? []).map((link:any)=>{
              const item=link.processo_itens
              return (
                <div className="dimension-item" key={item.id}>
                  <h3>{item.produtos?.sku} · {item.produtos?.nome}</h3>
                  {(detail.params ?? []).map((p:any)=>(
                    <div className="dimension-param" key={p.id}>
                      <div className="param-title"><strong>{p.nome}</strong><span>{p.unidade || ''}</span></div>
                      <div className="measurement-grid">
                        {Array.from({length:10},(_,k)=>{
                          const seq=k+1
                          const existing=detail.dimResults?.find((x:any)=>x.processo_item_id===item.id && x.parametro_id===p.id && x.sequencia_amostra===seq)
                          return (
                            <label key={seq}>
                              <span>{seq}</span>
                              <input type="number" step="any" defaultValue={existing?.valor ?? ''} onBlur={(e)=>saveDimension(item.id,p,seq,e.target.value)} disabled={detail.status==='concluida'}/>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                  {!detail.params?.length && <div className="muted">Esta IT não possui parâmetros dimensionais estruturados.</div>}
                </div>
              )
            })}
            {detail.status!=='concluida' && !detail.dimensionais_finalizados && <div className="actions"><button className="secondary" onClick={markDimensionalsDone}>Concluir dimensionais</button></div>}
          </section>

          <section className="panel section-card">
            <div className="section-title"><h2>Testes especiais</h2>{detail.testes_finalizados && <span className="pill">Concluído</span>}</div>
            {(detail.tests ?? []).map((test:any)=>{
              const r=detail.testResults?.find((x:any)=>x.teste_id===test.id)
              return (
                <article className="test-card" key={test.id}>
                  <div><strong>{test.nome}</strong><p>{test.procedimento}</p><small>Critério: {test.criterio_aprovacao}</small></div>
                  <div className="tri-buttons">
                    <button className={r?.resultado==='conforme'?'selected ok':''} onClick={()=>saveTest(test.id,'conforme')}>C</button>
                    <button className={r?.resultado==='nao_conforme'?'selected bad':''} onClick={()=>saveTest(test.id,'nao_conforme')}>NC</button>
                    <button className={r?.resultado==='nao_aplicavel'?'selected':''} onClick={()=>saveTest(test.id,'nao_aplicavel')}>NA</button>
                  </div>
                </article>
              )
            })}
            {!detail.tests?.length && <div className="muted">Sem teste especial estruturado para esta IT.</div>}
            {detail.status!=='concluida' && !detail.testes_finalizados && <div className="actions"><button className="secondary" onClick={markTestsDone}>Concluir testes</button></div>}
          </section>

          <section className="panel section-card">
            <div className="section-title"><h2>Fotos da inspeção</h2><span className="pill">{detail.photos?.length ?? 0} arquivo(s)</span></div>
            {detail.status!=='concluida' && (
              <label className="upload-box"><Camera size={22}/><span>Adicionar fotos</span><input type="file" accept="image/*" multiple onChange={(e)=>uploadInspectionPhotos(e.target.files)}/></label>
            )}
            <div className="photo-list">{(detail.photos ?? []).map((p:any)=><span key={p.id}>{p.legenda || p.storage_path}</span>)}</div>
          </section>

          {detail.status!=='concluida' && (
            <section className="panel section-card result-panel">
              <h2>Resultado final</h2>
              <div className="readiness">
                <span className={samplingDone?'done':''}>Amostragem</span>
                <span className={checklistDone?'done':''}>Verificações</span>
                <span className={dimsDone?'done':''}>Dimensionais</span>
                <span className={testsDone?'done':''}>Testes</span>
              </div>
              <label>Observação / conclusão<textarea value={finalObservation} onChange={(e)=>setFinalObservation(e.target.value)} rows={4}/></label>
              <div className="result-actions">
                <button className="success-button" onClick={()=>finishInspection('aprovado')}>Aprovar inspeção</button>
                <button className="danger" onClick={()=>finishInspection('reprovado')}>Reprovar inspeção</button>
              </div>
            </section>
          )}

          {detail.status==='concluida' && (
            <section className="panel section-card retention-panel">
              <div className="section-title">
                <h2>Retenção após finalização</h2>
                <span className={'result-badge '+detail.resultado}>{statusLabel(detail.resultado)}</span>
              </div>
              {(detail.retained ?? []).length>0 && <div className="alert success">Já existem {(detail.retained ?? []).length} amostra(s) deste registro no estoque.</div>}
              {(detail.items ?? []).map((link:any)=>{
                const item=link.processo_itens
                const existing=detail.retained?.find((x:any)=>x.produto_id===item.produto_id)
                const draft=retentionRows[item.id] || {retain:true,qty:'',address:''}
                return (
                  <div className="retention-row" key={item.id}>
                    <label className="switch-line">
                      <input type="checkbox" checked={existing?true:draft.retain} disabled={!!existing} onChange={(e)=>setRetentionRows({...retentionRows,[item.id]:{...draft,retain:e.target.checked}})}/>
                      <span>{item.produtos?.sku} · {item.produtos?.nome}</span>
                    </label>
                    {!existing && draft.retain && <>
                      <label>Quantidade<input type="number" min="0.01" step="0.01" value={draft.qty} onChange={(e)=>setRetentionRows({...retentionRows,[item.id]:{...draft,qty:e.target.value}})}/></label>
                      <label>Endereço<input value={draft.address} onChange={(e)=>setRetentionRows({...retentionRows,[item.id]:{...draft,address:e.target.value}})}/></label>
                    </>}
                    {existing && <span className="pill">No estoque</span>}
                  </div>
                )
              })}
              {!Object.values(retentionRows).some((x)=>x.retain) && <label>Motivo para não reter<textarea rows={3} value={retentionReason} onChange={(e)=>setRetentionReason(e.target.value)}/></label>}
              <div className="actions">
                <button className="primary" onClick={saveRetention}><Warehouse size={16}/> Enviar retenção ao estoque</button>
                <button className="secondary" onClick={downloadInspectionWord}><FileDown size={16}/> Gerar Word</button>
              </div>
            </section>
          )}
        </section>
      )}

      {tab==='its' && (
        <section className="workspace">
          <div className="page-title"><div><span className="eyebrow">DOCUMENTOS</span><h1>Biblioteca de ITs</h1></div></div>
          {canManageIts && (
            <form className="panel section-card" onSubmit={uploadIt}>
              <h2>Nova IT</h2>
              <div className="form-grid">
                <label>Código<input value={itForm.codigo} onChange={(e)=>setItForm({...itForm,codigo:e.target.value})} placeholder="IT 015"/></label>
                <label>Título<input value={itForm.titulo} onChange={(e)=>setItForm({...itForm,titulo:e.target.value})}/></label>
                <label>Versão<input value={itForm.versao} onChange={(e)=>setItForm({...itForm,versao:e.target.value})} placeholder="01/2026"/></label>
                <label>Vigência<input type="date" value={itForm.vigencia} onChange={(e)=>setItForm({...itForm,vigencia:e.target.value})}/></label>
                <label className="span-2">Word ou PDF<input type="file" accept=".doc,.docx,.pdf" onChange={(e)=>setItFile(e.target.files?.[0] ?? null)}/></label>
              </div>
              <div className="actions"><button className="primary" type="submit" disabled={!itFile}><Upload size={17}/> Enviar para leitura</button></div>
            </form>
          )}
          <div className="list">
            {itVersions.map((it)=>(
              <article className="row-card" key={it.id}>
                <div><strong>{it.instrucoes_trabalho?.codigo} · {it.instrucoes_trabalho?.titulo}</strong><span>Versão {it.versao}{it.arquivo_nome?' · '+it.arquivo_nome:''}</span></div>
                <span className="pill">{it.leitura_ia_status.replaceAll('_',' ')}</span>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab==='estoque' && (
        <section className="workspace">
          <div className="page-title"><div><span className="eyebrow">AMOSTRAS DE RETENÇÃO</span><h1>Estoque</h1></div></div>
          <div className="sample-grid">
            {samples.map((s)=>(
              <article className="sample-card" key={s.id} onClick={()=>setSelectedSample(s)}>
                <div><span className="eyebrow">{s.codigo}</span><h3>{s.descricao || 'Amostra'}</h3></div>
                <div className="sample-meta"><span>Saldo <b>{s.saldo} {s.unidade_controle}</b></span><span>Endereço <b>{s.endereco || '—'}</b></span></div>
                <button className="secondary" onClick={(e)=>{e.stopPropagation();downloadZpl(s)}}><QrCode size={16}/> Etiqueta</button>
              </article>
            ))}
          </div>
          {!samples.length && <div className="empty">Nenhuma amostra no estoque.</div>}

          {selectedSample && (
            <div className="modal-backdrop" onClick={()=>setSelectedSample(null)}>
              <article className="sample-detail" onClick={(e)=>e.stopPropagation()}>
                <button className="close" onClick={()=>setSelectedSample(null)}>×</button>
                <span className="eyebrow">ESTOQUE</span>
                <h2>{selectedSample.codigo}</h2>
                <p>{selectedSample.descricao}</p>
                <div className="detail-grid">
                  <div><small>Endereço</small><strong>{selectedSample.endereco || '—'}</strong></div>
                  <div><small>Saldo</small><strong>{selectedSample.saldo} {selectedSample.unidade_controle}</strong></div>
                  <div><small>Lote</small><strong>{selectedSample.lote || '—'}</strong></div>
                </div>
                {qrDataUrl && <img className="qr" src={qrDataUrl} alt="QR"/>}
                <button className="secondary wide" onClick={()=>downloadZpl(selectedSample)}>Gerar etiqueta Zebra 100×50</button>
                <div className="stock-move">
                  <h3>Movimentar estoque</h3>
                  <label>Movimento
                    <select value={stockMove.tipo} onChange={(e)=>setStockMove({...stockMove,tipo:e.target.value})}>
                      <option value="retirada">Retirada</option>
                      <option value="devolucao">Devolução</option>
                      <option value="transferencia">Transferência</option>
                      <option value="descarte">Descarte</option>
                    </select>
                  </label>
                  <label>Quantidade<input type="number" min="0.01" step="0.01" value={stockMove.quantidade} onChange={(e)=>setStockMove({...stockMove,quantidade:e.target.value})}/></label>
                  {['transferencia','devolucao'].includes(stockMove.tipo) && <label>Endereço destino<input value={stockMove.endereco} onChange={(e)=>setStockMove({...stockMove,endereco:e.target.value})}/></label>}
                  <label>Motivo<input value={stockMove.motivo} onChange={(e)=>setStockMove({...stockMove,motivo:e.target.value})}/></label>
                  <button className="primary" onClick={moveStock}>Registrar movimentação</button>
                </div>
              </article>
            </div>
          )}
        </section>
      )}

      {editingProcess && (
        <div className="modal-backdrop" onClick={()=>setEditingProcess(null)}>
          <form className="sample-detail" onSubmit={saveProcessEdit} onClick={(e)=>e.stopPropagation()}>
            <button className="close" type="button" onClick={()=>setEditingProcess(null)}>×</button>
            <span className="eyebrow">EDITAR PROCESSO</span>
            <h2>{editingProcess.codigo}</h2>
            <div className="form-grid one">
              <label>Cliente<input value={editingProcess.cliente ?? ''} onChange={(e)=>setEditingProcess({...editingProcess,cliente:e.target.value})}/></label>
              <label>Nota fiscal<input value={editingProcess.nota_fiscal ?? ''} onChange={(e)=>setEditingProcess({...editingProcess,nota_fiscal:e.target.value})}/></label>
              <label>Origem<input value={editingProcess.origem ?? ''} onChange={(e)=>setEditingProcess({...editingProcess,origem:e.target.value})}/></label>
              <label>Transporte<input value={editingProcess.transporte ?? ''} onChange={(e)=>setEditingProcess({...editingProcess,transporte:e.target.value})}/></label>
              <label>Chegada no CD<input type="date" value={editingProcess.chegada_cd ?? ''} onChange={(e)=>setEditingProcess({...editingProcess,chegada_cd:e.target.value})}/></label>
            </div>
            <button className="primary wide" type="submit">Salvar alterações</button>
          </form>
        </div>
      )}

      {ncDraft.open && (
        <div className="modal-backdrop">
          <form className="sample-detail" onSubmit={(e)=>{e.preventDefault();persistUnit(false,ncDraft)}}>
            <button className="close" type="button" onClick={()=>setNcDraft({...ncDraft,open:false})}>×</button>
            <span className="eyebrow">NÃO CONFORMIDADE</span>
            <h2>Registrar unidade NC</h2>
            <label>Componente / produto
              <select value={ncDraft.itemId} onChange={(e)=>setNcDraft({...ncDraft,itemId:e.target.value})}>
                <option value="">Conjunto / geral</option>
                {(detail?.items ?? []).map((x:any)=><option key={x.processo_itens.id} value={x.processo_itens.id}>{x.processo_itens.produtos?.sku} · {x.processo_itens.produtos?.nome}</option>)}
              </select>
            </label>
            <label>Classificação
              <select value={ncDraft.severity} onChange={(e)=>setNcDraft({...ncDraft,severity:e.target.value})}>
                <option value="critico">Crítico</option>
                <option value="grave">Grave</option>
                <option value="toleravel">Tolerável</option>
              </select>
            </label>
            <label>Descrição<textarea rows={4} value={ncDraft.description} onChange={(e)=>setNcDraft({...ncDraft,description:e.target.value})}/></label>
            <button className="danger wide" type="submit">Registrar NC</button>
          </form>
        </div>
      )}
    </main>
  )
}

function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return <article className="metric"><Icon size={22}/><div><strong>{value}</strong><span>{label}</span></div></article>
}
function ProgressItem({ done, label }: { done: boolean; label: string }) {
  return <div className={'progress-item '+(done?'done':'')}><span>{done?'✓':'•'}</span><b>{label}</b></div>
}
