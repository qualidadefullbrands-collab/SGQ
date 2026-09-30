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
      return setError('Em cada SKU informe SKU, descrição, quantidade recebida e quantidade por caixa.')
    }
    if (statisticalLot <= 0) return setError('Não foi possível calcular o lote estatístico.')

    const { data: proc, error: procErr } = await supabase.from('processos').insert({
      codigo: inspection.codigo.trim(),
      cliente: inspection.cliente.trim(),
      nota_fiscal: inspection.notaFiscal.trim() || null,
      origem: inspection.origem.trim() || null,
      transporte: inspection.transporte.trim() || null,
      chegada_cd: inspection.chegadaCd || null,
      status: 'aberto',
      data_processo: inspection.dataInspecao,
      criado_por: userId,
    }).select('id').single()
    if (procErr || !proc) return setError(procErr?.message ?? 'Falha ao criar processo.')

    const groupName = skuRows.map((r) => r.nome.trim()).join(' + ')
    const { data: group, error: groupErr } = await supabase.from('grupos_inspecao').insert({
      processo_id: proc.id,
      codigo: 'G01',
      nome: groupName,
      tipo: isComponentSet ? 'kit_componentes' : 'individual',
      tamanho_lote_estatistico: statisticalLot,
      status: 'em_inspecao',
    }).select('id').single()
    if (groupErr || !group) return setError(groupErr?.message ?? 'Falha ao iniciar inspeção.')

    let firstItemId: string | null = null

    for (const row of skuRows) {
      let productId: string
      const existing = await supabase.from('produtos').select('id').eq('sku', row.sku.trim()).maybeSingle()
      if (existing.data?.id) productId = existing.data.id
      else {
        const created = await supabase.from('produtos').insert({ sku: row.sku.trim(), nome: row.nome.trim() }).select('id').single()
        if (created.error || !created.data) return setError(created.error?.message ?? 'Falha ao cadastrar SKU.')
        productId = created.data.id
      }

      const receivedBoxes = boxesReceived(row.quantidade, row.quantidadePorCaixa)
      const item = await supabase.from('processo_itens').insert({
        processo_id: proc.id,
        produto_id: productId,
        codigo_cliente: row.codigoCliente.trim() || null,
        lote: row.lote.trim() || null,
        material: row.material.trim() || null,
        capacidade: row.capacidade.trim() || null,
        quantidade: Number(row.quantidade),
        quantidade_por_caixa: Number(row.quantidadePorCaixa),
        caixas_recebidas: receivedBoxes,
      }).select('id').single()
      if (item.error || !item.data) return setError(item.error?.message ?? 'Falha ao cadastrar item.')
      if (!firstItemId) firstItemId = item.data.id

      const link = await supabase.from('grupo_inspecao_itens').insert({
        grupo_inspecao_id: group.id,
        processo_item_id: item.data.id,
        quantidade_componente: Number(row.quantidade),
        unidades_por_conjunto: Number(row.unidadesPorConjunto || 1),
      })
      if (link.error) return setError(link.error.message)
    }

    const linkIt = await supabase.from('grupo_inspecao_its').insert({
      grupo_inspecao_id: group.id,
      it_versao_id: inspection.itVersionId,
      principal: true,
    })
    if (linkIt.error) return setError(linkIt.error.message)

    const inspectionNumber = `INS-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`
    const createdInspection = await supabase.from('inspecoes').insert({
      numero: inspectionNumber,
      processo_item_id: firstItemId,
      grupo_inspecao_id: group.id,
      it_versao_id: inspection.itVersionId,
      status: 'em_andamento',
      tamanho_lote: statisticalLot,
      nivel_inspecao: inspection.inspectionLevel,
      nivel_inspecao_origem: 'it',
      regime_inspecao: 'normal',
      tipo_plano: 'simples',
      caixas_recebidas: totalBoxesReceived,
      caixas_avaliar: totalBoxesToInspect,
      data_inspecao: inspection.dataInspecao,
      responsavel_id: userId,
      iniciada_em: new Date().toISOString(),
    }).select('id').single()

    if (createdInspection.error) return setError(createdInspection.error.message)

    setMessage(`Inspeção ${inspectionNumber} iniciada.`)
    setInspection({
      codigo: '', cliente: '', notaFiscal: '', origem: '', transporte: '', chegadaCd: '',
      dataInspecao: new Date().toISOString().slice(0,10), itVersionId: '', inspectionLevel: 'I',
    })
    setSkuRows([emptySku()])
    await loadApp()
    setTab('painel')
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><PackageSearch size={24}/><span>SGQ</span></div>
        <nav>
          <button className={tab==='painel'?'active':''} onClick={()=>setTab('painel')}>Painel</button>
          <button className={tab==='nova'?'active':''} onClick={()=>setTab('nova')}>Nova inspeção</button>
          <button className={tab==='its'?'active':''} onClick={()=>setTab('its')}>ITs</button>
          <button className={tab==='amostras'?'active':''} onClick={()=>setTab('amostras')}>Amostras</button>
        </nav>
        <div className="userbox"><span>{profile.nome || 'Usuário'} · {profile.perfil}</span><button title="Sair" onClick={()=>supabase.auth.signOut()}><LogOut size={18}/></button></div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      {tab === 'painel' && (
        <section className="workspace">
          <div className="page-title">
            <div><span className="eyebrow">SGQ</span><h1>Painel</h1></div>
            <button className="primary" onClick={()=>setTab('nova')}><Plus size={18}/> Nova inspeção</button>
          </div>
          <section className="metrics">
            <Metric icon={ClipboardCheck} label="Processos" value={counts.processos}/>
            <Metric icon={ShieldCheck} label="Inspeções" value={counts.inspecoes}/>
            <Metric icon={Boxes} label="Amostras" value={counts.amostras}/>
            <Metric icon={FileText} label="Laudos" value={counts.laudos}/>
          </section>
          <div className="list">
            {groups.slice(0,8).map((g)=><article className="row-card" key={g.id}>
              <div><strong>{g.processos?.codigo} · {g.nome}</strong><span>{g.processos?.cliente || 'Sem cliente'} · lote {g.tamanho_lote_estatistico.toLocaleString('pt-BR')}</span></div>
              <span className="pill">{g.tipo === 'kit_componentes' ? 'Componentes' : '1 SKU'}</span>
            </article>)}
            {!groups.length && <div className="empty">Nenhuma inspeção iniciada.</div>}
          </div>
        </section>
      )}

      {tab === 'nova' && (
        <section className="workspace">
          <div className="page-title"><div><span className="eyebrow">INSPEÇÃO</span><h1>Nova inspeção</h1></div></div>
          <form onSubmit={createInspection} className="inspection-form">
            <section className="panel section-card">
              <h2>Identificação</h2>
              <div className="form-grid">
                <label>Processo FST<input value={inspection.codigo} onChange={(e)=>setInspection({...inspection,codigo:e.target.value})} placeholder="FST..." disabled={!canWrite}/></label>
                <label>Cliente<input value={inspection.cliente} onChange={(e)=>setInspection({...inspection,cliente:e.target.value})} disabled={!canWrite}/></label>
                <label>Nota fiscal<input value={inspection.notaFiscal} onChange={(e)=>setInspection({...inspection,notaFiscal:e.target.value})} disabled={!canWrite}/></label>
                <label>Chegada no CD<input type="date" value={inspection.chegadaCd} onChange={(e)=>setInspection({...inspection,chegadaCd:e.target.value})} disabled={!canWrite}/></label>
                <label>Origem<input value={inspection.origem} onChange={(e)=>setInspection({...inspection,origem:e.target.value})} disabled={!canWrite}/></label>
                <label>Transporte<input value={inspection.transporte} onChange={(e)=>setInspection({...inspection,transporte:e.target.value})} disabled={!canWrite}/></label>
                <label>Data da inspeção<input type="date" value={inspection.dataInspecao} onChange={(e)=>setInspection({...inspection,dataInspecao:e.target.value})} disabled={!canWrite}/></label>
                <label>IT aplicável<select value={inspection.itVersionId} onChange={(e)=>setInspection({...inspection,itVersionId:e.target.value})} disabled={!canWrite}>
                  <option value="">Selecione</option>
                  {itVersions.filter((it)=>it.status==='publicada').map((it)=><option key={it.id} value={it.id}>{it.instrucoes_trabalho?.codigo} · {it.instrucoes_trabalho?.titulo} · {it.versao}</option>)}
                </select></label>
                <label>Nível de inspeção<select value={inspection.inspectionLevel} onChange={(e)=>setInspection({...inspection,inspectionLevel:e.target.value})} disabled={!canWrite}>
                  <option value="I">Nível I</option><option value="II">Nível II</option><option value="S2">Especial S2</option>
                </select></label>
              </div>
            </section>

            <section className="panel section-card">
              <div className="sku-head"><h2>Produto / SKU</h2><button type="button" className="secondary" onClick={()=>setSkuRows([...skuRows,emptySku()])} disabled={!canWrite}><Plus size={16}/> Adicionar SKU</button></div>
              <div className="sku-editor">
                {skuRows.map((row,i)=>{
                  const boxes = boxesReceived(row.quantidade,row.quantidadePorCaixa)
                  const inspect = boxesToInspect(boxes)
                  return <article className="sku-card" key={i}>
                    <div className="sku-card-head"><strong>SKU {i+1}</strong>{skuRows.length>1 && <button type="button" className="icon-button" onClick={()=>setSkuRows(skuRows.filter((_,j)=>j!==i))}><X size={16}/></button>}</div>
                    <div className="form-grid">
                      <label>SKU<input value={row.sku} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,sku:e.target.value}:r))}/></label>
                      <label>Produto / descrição<input value={row.nome} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,nome:e.target.value}:r))}/></label>
                      <label>Código do cliente<input value={row.codigoCliente} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,codigoCliente:e.target.value}:r))}/></label>
                      <label>Lote<input value={row.lote} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,lote:e.target.value}:r))}/></label>
                      <label>Material<input value={row.material} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,material:e.target.value}:r))}/></label>
                      <label>Capacidade<input value={row.capacidade} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,capacidade:e.target.value}:r))}/></label>
                      <label>Quantidade recebida<input type="number" min="1" value={row.quantidade} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,quantidade:e.target.value}:r))}/></label>
                      <label>Quantidade por caixa<input type="number" min="1" value={row.quantidadePorCaixa} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,quantidadePorCaixa:e.target.value}:r))}/></label>
                      {isComponentSet && <label>Unidades por conjunto<input type="number" min="0.01" step="0.01" value={row.unidadesPorConjunto} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,unidadesPorConjunto:e.target.value}:r))}/></label>}
                    </div>
                    <div className="computed"><span>Caixas recebidas <b>{boxes || '—'}</b></span><span>Caixas a inspecionar <b>{inspect || '—'}</b></span></div>
                  </article>
                })}
              </div>
            </section>

            <section className="calc-strip">
              <div><small>Tipo</small><strong>{isComponentSet ? 'Componentes / conjunto' : 'SKU individual'}</strong></div>
              <div><small>Lote estatístico</small><strong>{statisticalLot ? statisticalLot.toLocaleString('pt-BR') : '—'}</strong></div>
              <div><small>Caixas recebidas</small><strong>{totalBoxesReceived || '—'}</strong></div>
              <div><small>Caixas a inspecionar</small><strong>{totalBoxesToInspect || '—'}</strong></div>
            </section>

            <div className="actions"><button className="primary" type="submit" disabled={!canWrite}>Iniciar inspeção</button></div>
          </form>
        </section>
      )}

      {tab === 'its' && (
        <section className="workspace">
          <div className="page-title"><div><span className="eyebrow">DOCUMENTOS</span><h1>Biblioteca de ITs</h1></div></div>
          {canManageIts && <form className="panel section-card" onSubmit={uploadIt}>
            <h2>Nova IT</h2>
            <div className="form-grid">
              <label>Código<input value={itForm.codigo} onChange={(e)=>setItForm({...itForm,codigo:e.target.value})} placeholder="IT 015"/></label>
              <label>Título<input value={itForm.titulo} onChange={(e)=>setItForm({...itForm,titulo:e.target.value})}/></label>
              <label>Versão<input value={itForm.versao} onChange={(e)=>setItForm({...itForm,versao:e.target.value})} placeholder="01/2026"/></label>
              <label>Vigência<input type="date" value={itForm.vigencia} onChange={(e)=>setItForm({...itForm,vigencia:e.target.value})}/></label>
              <label className="span-2">Arquivo Word ou PDF<input type="file" accept=".doc,.docx,.pdf" onChange={(e)=>setItFile(e.target.files?.[0] ?? null)} /></label>
            </div>
            <div className="actions"><button className="primary" type="submit" disabled={!itFile}><Upload size={17}/> Enviar para leitura</button></div>
          </form>}
          <div className="list">
            {itVersions.map((it)=><article className="row-card" key={it.id}>
              <div><strong>{it.instrucoes_trabalho?.codigo} · {it.instrucoes_trabalho?.titulo}</strong><span>Versão {it.versao}{it.arquivo_nome ? ` · ${it.arquivo_nome}` : ''}</span></div>
              <span className="pill">{it.leitura_ia_status.replaceAll('_',' ')}</span>
            </article>)}
          </div>
        </section>
      )}

      {tab === 'amostras' && (
        <section className="workspace">
          <div className="page-title"><div><span className="eyebrow">RETENÇÃO</span><h1>Amostras</h1></div></div>
          <form className="panel form-grid" onSubmit={createSample}>
            <label className="span-2">Inspeção<select value={sampleForm.groupId} onChange={(e)=>setSampleForm({...sampleForm,groupId:e.target.value})} disabled={!canWrite}><option value="">Selecione</option>{groups.map(g=><option key={g.id} value={g.id}>{g.processos?.codigo} · {g.nome}</option>)}</select></label>
            <label>Descrição<input value={sampleForm.descricao} onChange={(e)=>setSampleForm({...sampleForm,descricao:e.target.value})} disabled={!canWrite}/></label>
            <label>Lote<input value={sampleForm.lote} onChange={(e)=>setSampleForm({...sampleForm,lote:e.target.value})} disabled={!canWrite}/></label>
            <label>Quantidade<input type="number" min="0.01" step="0.01" value={sampleForm.quantidade} onChange={(e)=>setSampleForm({...sampleForm,quantidade:e.target.value})} disabled={!canWrite}/></label>
            <label>Unidade<select value={sampleForm.unidade} onChange={(e)=>setSampleForm({...sampleForm,unidade:e.target.value})} disabled={!canWrite}><option value="conjunto">conjunto</option><option value="unidade">unidade</option><option value="kit">kit</option></select></label>
            <label className="span-2">Endereço<input value={sampleForm.endereco} onChange={(e)=>setSampleForm({...sampleForm,endereco:e.target.value})} disabled={!canWrite}/></label>
            <button className="primary span-2" type="submit" disabled={!canWrite}>Reter amostra</button>
          </form>

          <div className="sample-grid">
            {samples.map(s=><article className="sample-card" key={s.id} onClick={()=>setSelectedSample(s)}>
              <div><span className="eyebrow">{s.codigo}</span><h3>{s.descricao || 'Amostra'}</h3></div>
              <div className="sample-meta"><span>Saldo <b>{s.saldo} {s.unidade_controle}</b></span><span>Endereço <b>{s.endereco || '-'}</b></span></div>
              <button className="secondary" onClick={(e)=>{e.stopPropagation();downloadZpl(s)}}><QrCode size={16}/> Etiqueta</button>
            </article>)}
          </div>

          {selectedSample && <div className="modal-backdrop" onClick={()=>setSelectedSample(null)}><article className="sample-detail" onClick={(e)=>e.stopPropagation()}>
            <button className="close" onClick={()=>setSelectedSample(null)}>×</button>
            <span className="eyebrow">AMOSTRA</span><h2>{selectedSample.codigo}</h2>
            <div className="detail-grid"><div><small>Endereço</small><strong>{selectedSample.endereco || '-'}</strong></div><div><small>Saldo</small><strong>{selectedSample.saldo} {selectedSample.unidade_controle}</strong></div><div><small>Lote</small><strong>{selectedSample.lote || '-'}</strong></div></div>
            {qrDataUrl && <img className="qr" src={qrDataUrl} alt="QR da amostra"/>}
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
