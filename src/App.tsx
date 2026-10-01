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
  sku?: string | null
  processo_referencia?: string | null
  data_chegada_referencia?: string | null
  nota_fiscal_referencia?: string | null
  cliente_referencia?: string | null
  observacao?: string | null
  origem_importacao?: string | null
  linha_origem?: number | null
}

const emptySku = () => ({
  sku: '',
  nome: '',
  lote: '',
  material: '',
  capacidade: '',
  quantidade: '',
  quantidadePorCaixa: '',
  caixasRecebidas: '',
  caixasInspecionadas: '',
  unidadesPorConjunto: '1',
  omieStatus: '' as '' | 'loading' | 'found' | 'not_found' | 'not_configured' | 'error',
})

function fstDigits(value: string) {
  return value.replace(/\D/g, '').slice(0,5)
}
function formatFst(value: string | null | undefined) {
  const d = String(value ?? '').replace(/\D/g, '')
  return d ? 'FST' + d : '—'
}
function toggleTransport(current: string, mode: 'Aéreo' | 'Marítimo') {
  const set = new Set(current.split(',').map((x)=>x.trim()).filter(Boolean))
  set.has(mode) ? set.delete(mode) : set.add(mode)
  return [...set].join(', ')
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
  const [ncDraft, setNcDraft] = useState<{
    open:boolean; severity:string; description:string; itemId:string; checklistId:string;
    photoFile:File|null; photoPreview:string; photoLegenda:string;
  }>({ open:false, severity:'grave', description:'', itemId:'', checklistId:'', photoFile:null, photoPreview:'', photoLegenda:'' })
  const [finalObservation, setFinalObservation] = useState('')
  const [retentionRows, setRetentionRows] = useState<Record<string,{retain:boolean;qty:string;address:string}>>({})
  const [retentionReason, setRetentionReason] = useState('')
  const [stockMove, setStockMove] = useState({ tipo: 'retirada', quantidade: '', endereco: '', motivo: '' })
  const [pendingPhotos, setPendingPhotos] = useState<Array<{id:string;file:File;url:string;legenda:string}>>([])
  const [pendingModal, setPendingModal] = useState<string[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [itVersions, setItVersions] = useState<ItVersion[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [samples, setSamples] = useState<Sample[]>([])
  const [stockSearch, setStockSearch] = useState('')
  const [stockAddress, setStockAddress] = useState('Todos')
  const [selectedSample, setSelectedSample] = useState<Sample | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')

  const [inspection, setInspection] = useState({
    processoId: '',
    codigo: '',
    cliente: '',
    notaFiscal: '',
    origem: 'China',
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
    () => skuRows.reduce((sum, r) => sum + (Number(r.caixasRecebidas) || 0), 0),
    [skuRows],
  )
  const totalBoxesToInspect = useMemo(
    () => skuRows.reduce((sum, r) => sum + (Number(r.caixasInspecionadas) || 0), 0),
    [skuRows],
  )

  const previewPlan = useMemo(
    () => samplingPlan(statisticalLot, inspection.inspectionLevel),
    [statisticalLot, inspection.inspectionLevel],
  )

  const stockAddresses = useMemo(
    () => ['Todos', ...Array.from(new Set(samples.map((s)=>s.endereco).filter(Boolean) as string[])).sort()],
    [samples],
  )
  const filteredSamples = useMemo(() => {
    const q=stockSearch.trim().toLowerCase()
    return samples
      .filter((s)=>{
        if (stockAddress!=='Todos' && s.endereco!==stockAddress) return false
        if (!q) return true
        return [
          s.codigo,s.sku,s.descricao,s.processo_referencia,s.cliente_referencia,
          s.nota_fiscal_referencia,s.endereco,s.observacao,
        ].some((v)=>String(v ?? '').toLowerCase().includes(q))
      })
      .sort((a,b)=>{
        const addrA=a.endereco==='INSPEÇÃO' ? '000' : (a.endereco ?? 'ZZZ')
        const addrB=b.endereco==='INSPEÇÃO' ? '000' : (b.endereco ?? 'ZZZ')
        return addrA.localeCompare(addrB,'pt-BR') || String(a.sku ?? '').localeCompare(String(b.sku ?? ''),'pt-BR')
      })
  },[samples,stockSearch,stockAddress])

  const stockStats = useMemo(() => ({
    registros: samples.length,
    unidades: samples.reduce((sum,s)=>sum+Number(s.saldo || 0),0),
    skus: new Set(samples.map((s)=>s.sku).filter(Boolean)).size,
    emInspecao: samples.filter((s)=>s.endereco==='INSPEÇÃO').reduce((sum,s)=>sum+Number(s.saldo || 0),0),
  }),[samples])

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
      supabase.from('inspecoes').select('id,numero,status,resultado,tamanho_lote,tamanho_amostra,total_inspecionado,total_nao_conforme,nivel_inspecao,codigo_amostragem,criado_em,grupos_inspecao(id,nome,tipo,processo_id,processos(id,codigo,cliente,nota_fiscal,origem,transporte,chegada_cd,data_processo,status,criado_em)),it_versoes(id,versao,instrucoes_trabalho(codigo,titulo))').is('excluido_em', null).order('criado_em', { ascending: false }),
      supabase.from('it_versoes').select('id,versao,status,vigencia,nivel_inspecao_padrao,leitura_ia_status,arquivo_nome,instrucoes_trabalho(codigo,titulo)').order('criado_em', { ascending: false }),
      supabase.from('grupos_inspecao').select('id,nome,codigo,tipo,tamanho_lote_estatistico,processo_id,processos(codigo,cliente)').order('criado_em', { ascending: false }),
      supabase.from('vw_saldo_amostras').select('id,codigo,descricao,endereco,lote,saldo,unidade_controle,qr_token,grupo_inspecao_id,inspecao_id,produto_id,sku,processo_referencia,data_chegada_referencia,nota_fiscal_referencia,cliente_referencia,observacao,origem_importacao,linha_origem').order('codigo', { ascending: false }),
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
      processoId: '', codigo: '', cliente: '', notaFiscal: '', origem: 'China', transporte: '', chegadaCd: '',
      dataInspecao: new Date().toISOString().slice(0,10), itVersionId: '', inspectionLevel: 'I',
    })
    setSkuRows([emptySku()])
  }

  function reuseProcess(p: ProcessRow) {
    setInspection((x) => ({
      ...x,
      processoId: p.id,
      codigo: fstDigits(p.codigo),
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
    setSkuRows((rows)=>rows.map((r,i)=>i===index?{...r,omieStatus:'loading'}:r))

    const { data, error } = await supabase.functions.invoke('omie-produto', { body: { codigo: code } })
    if (error) {
      const msg = String((error as any)?.context?.body ?? error.message ?? '')
      const status = msg.includes('omie_not_configured') ? 'not_configured' : 'error'
      setSkuRows((rows)=>rows.map((r,i)=>i===index?{...r,omieStatus:status}:r))
      return
    }

    if (data?.error === 'omie_not_configured') {
      setSkuRows((rows)=>rows.map((r,i)=>i===index?{...r,nome:'',omieStatus:'not_configured'}:r))
      return
    }
    if (data?.error === 'not_found') {
      setSkuRows((rows)=>rows.map((r,i)=>i===index?{...r,nome:'',omieStatus:'not_found'}:r))
      return
    }
    if (data?.error || !data?.found || !data?.descricao) {
      setSkuRows((rows)=>rows.map((r,i)=>i===index?{...r,nome:'',omieStatus:'error'}:r))
      return
    }

    setSkuRows((rows)=>rows.map((r,i)=>i===index?{
      ...r,
      nome:String(data.descricao),
      omieStatus:'found',
    }:r))

    const local = await supabase.from('produtos').select('id').eq('sku', code).maybeSingle()
    let productId = local.data?.id
    if (!productId) {
      const created = await supabase.from('produtos').insert({ sku: code, nome: String(data.descricao) }).select('id').single()
      productId = created.data?.id
    } else {
      await supabase.from('produtos').update({ nome: String(data.descricao) }).eq('id', productId)
    }

    if (!productId) return
    const items = await supabase.from('processo_itens').select('id').eq('produto_id', productId)
    const ids = (items.data ?? []).map((x:any)=>x.id)
    if (!ids.length) return
    const links = await supabase.from('grupo_inspecao_itens').select('grupo_inspecao_id').in('processo_item_id', ids)
    const gids = [...new Set((links.data ?? []).map((x:any)=>x.grupo_inspecao_id))] as string[]
    if (!gids.length) return
    const oldIns = await supabase.from('inspecoes').select('id').in('grupo_inspecao_id', gids).is('excluido_em', null)
    const inspIds = (oldIns.data ?? []).map((x:any)=>x.id)
    if (!inspIds.length) return
    const nc = await supabase.from('inspecao_nao_conformidades').select('id').in('inspecao_id', inspIds).limit(1)
    if ((nc.data ?? []).length) {
      setInspection((x)=>({...x,inspectionLevel:'II'}))
      setMessage('Produto localizado no OMIE. Há histórico de NC; Nível II foi sugerido.')
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

  async function deleteInspection(i: InspectionRow | { id:string; numero?:string }) {
    if (!canDelete || !userId) return
    const label = (i as any).numero ? ` ${(i as any).numero}` : ''
    if (!window.confirm(`Excluir a inspeção${label}? Ela sairá da operação, mas o registro de auditoria será preservado.`)) return
    const { error } = await supabase.from('inspecoes').update({
      excluido_em: new Date().toISOString(),
      excluido_por: userId,
      status: 'cancelada',
    }).eq('id', i.id)
    if (error) return setError(error.message)
    await supabase.from('audit_log').insert({
      usuario_id: userId,
      entidade: 'inspecoes',
      entidade_id: i.id,
      acao: 'exclusao_logica',
      dados: { numero: (i as any).numero ?? null },
    })
    if (selectedInspectionId === i.id) {
      setSelectedInspectionId(null)
      setDetail(null)
      setTab('inspecoes')
    }
    setMessage('Inspeção excluída da operação.')
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
    const [items, checklist, checkResults, params, dimResults, dimConfigs, tests, testResults, photos, registers, ncs, retained] = await Promise.all([
      supabase.from('grupo_inspecao_itens').select('id,papel,quantidade_componente,unidades_por_conjunto,processo_itens(id,produto_id,lote,quantidade,material,capacidade,quantidade_por_caixa,caixas_recebidas,caixas_inspecionadas,produtos(id,sku,nome))').eq('grupo_inspecao_id', groupId),
      supabase.from('it_checklist').select('*').eq('it_versao_id', itId).eq('ativo', true).order('ordem'),
      supabase.from('inspecao_checklist_resultados').select('*').eq('inspecao_id', id),
      supabase.from('it_parametros_dimensionais').select('*').eq('it_versao_id', itId).eq('ativo', true).order('ordem'),
      supabase.from('inspecao_dimensionais').select('*').eq('inspecao_id', id),
      supabase.from('inspecao_dimensional_configuracoes').select('*').eq('inspecao_id', id),
      supabase.from('it_testes_especiais').select('*').eq('it_versao_id', itId).eq('ativo', true).order('ordem'),
      supabase.from('inspecao_testes_resultados').select('*').eq('inspecao_id', id),
      supabase.from('inspecao_fotos').select('*').eq('inspecao_id', id).order('criado_em'),
      supabase.from('inspecao_registros').select('*').eq('inspecao_id', id).order('sequencia'),
      supabase.from('inspecao_nao_conformidades').select('*').eq('inspecao_id', id).order('criado_em'),
      supabase.from('amostras').select('*').eq('inspecao_id', id),
    ])
    let photosWithUrls:any[] = photos.data ?? []
    if (photosWithUrls.length) {
      const signed = await supabase.storage.from('inspecao-fotos').createSignedUrls(
        photosWithUrls.map((p:any)=>p.storage_path), 3600
      )
      photosWithUrls = photosWithUrls.map((p:any,i:number)=>({
        ...p,
        signed_url: signed.data?.[i]?.signedUrl ?? null,
      }))
    }

    const next = {
      ...ins.data,
      items: items.data ?? [],
      checklist: checklist.data ?? [],
      checklistResults: checkResults.data ?? [],
      params: params.data ?? [],
      dimResults: dimResults.data ?? [],
      dimConfigs: dimConfigs.data ?? [],
      tests: tests.data ?? [],
      testResults: testResults.data ?? [],
      photos: photosWithUrls,
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

    if (!/^\d{5}$/.test(inspection.codigo.trim())) {
      return setError('O Processo FST deve ter exatamente 5 números.')
    }
    if (!inspection.cliente.trim() || !inspection.dataInspecao) {
      return setError('Preencha Cliente e Data da inspeção.')
    }
    if (!inspection.itVersionId) return setError('Selecione a IT aplicável.')
    if (skuRows.some((r) => !r.sku.trim() || r.omieStatus !== 'found' || !r.nome.trim() || Number(r.quantidade) <= 0 || Number(r.caixasRecebidas) <= 0 || Number(r.caixasInspecionadas) <= 0)) {
      return setError('Em cada produto, confirme o Código no OMIE e informe Quantidade recebida, Caixas recebidas e Caixas inspecionadas.')
    }
    if (statisticalLot <= 0) return setError('Não foi possível calcular o lote estatístico.')

    let processId = inspection.processoId
    const processCode = fstDigits(inspection.codigo)
    const existingByCode = processes.find((p) => fstDigits(p.codigo) === processCode)
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
        codigo: processCode,
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
      const item = await supabase.from('processo_itens').insert({
        processo_id: processId,
        produto_id: productId,
        codigo_cliente: null,
        lote: row.lote.trim() || null,
        material: row.material.trim() || null,
        capacidade: row.capacidade.trim() || null,
        quantidade: Number(row.quantidade),
        quantidade_por_caixa: Number(row.quantidadePorCaixa) || null,
        caixas_recebidas: Number(row.caixasRecebidas),
        caixas_inspecionadas: Number(row.caixasInspecionadas),
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

  function resetNcDraft() {
    if (ncDraft.photoPreview) URL.revokeObjectURL(ncDraft.photoPreview)
    setNcDraft({ open:false, severity:'grave', description:'', itemId:'', checklistId:'', photoFile:null, photoPreview:'', photoLegenda:'' })
  }

  function openNcModal(checklistId = '') {
    resetNcDraft()
    setNcDraft({ open:true, severity:'grave', description:'', itemId:'', checklistId, photoFile:null, photoPreview:'', photoLegenda:'' })
  }

  async function recordUnit(conforme: boolean) {
    if (!detail || !selectedInspectionId) return
    if (!conforme) {
      openNcModal('')
      return
    }
    await persistUnit(true)
  }

  async function persistUnit(conforme: boolean, nc?: {
    severity:string; description:string; itemId:string; checklistId:string;
    photoFile:File|null; photoPreview:string; photoLegenda:string;
  }) {
    if (!detail || !selectedInspectionId || !userId) return
    if (!conforme) {
      if (!nc?.checklistId) return setError('Selecione o item da IT relacionado à não conformidade.')
      if (!nc?.photoFile) return setError('Toda não conformidade deve ter uma foto específica.')
      if (!nc?.photoLegenda.trim()) return setError('Informe a legenda da foto da não conformidade.')
      if (!nc?.description.trim()) return setError('Descreva a não conformidade.')
    }

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
        checklist_id: nc.checklistId,
        descricao: nc.description.trim(),
        severidade: nc.severity,
        tipo: 'amostragem',
      }).select('id').single()
      if (created.error || !created.data) return setError(created.error?.message ?? 'Falha ao registrar NC.')

      const safe = nc.photoFile!.name.replace(/[^a-zA-Z0-9._-]/g,'_')
      const path = `${selectedInspectionId}/nc/${created.data.id}-${Date.now()}-${safe}`
      const up = await supabase.storage.from('inspecao-fotos').upload(path,nc.photoFile!,{contentType:nc.photoFile!.type||undefined})
      if (up.error) return setError(up.error.message)

      const photo = await supabase.from('inspecao_fotos').insert({
        inspecao_id:selectedInspectionId,
        storage_path:path,
        legenda:nc.photoLegenda.trim(),
        nc_id:created.data.id,
      })
      if (photo.error) return setError(photo.error.message)

      await supabase.from('inspecao_nao_conformidades').update({
        foto_storage_path:path,
        foto_legenda:nc.photoLegenda.trim(),
      }).eq('id',created.data.id)

      await supabase.from('inspecao_checklist_resultados').upsert({
        inspecao_id:selectedInspectionId,
        checklist_id:nc.checklistId,
        resultado:'nao_conforme',
        severidade_confirmada:nc.severity,
        registrado_por:userId,
        registrado_em:new Date().toISOString(),
      },{onConflict:'inspecao_id,checklist_id'})
    }

    const total = seq
    const ncCount = (detail.registers ?? []).filter((x:any)=>x.conforme===false).length + (conforme?0:1)
    const okCount = total - ncCount
    await supabase.from('inspecoes').update({
      total_inspecionado:total,
      total_conforme:okCount,
      total_nao_conforme:ncCount,
    }).eq('id',selectedInspectionId)

    resetNcDraft()
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

  function getDimConfig(itemId:string, paramId:string) {
    return detail?.dimConfigs?.find((x:any)=>x.processo_item_id===itemId && x.parametro_id===paramId) ?? null
  }

  async function saveDimConfig(itemId:string, param:any, patch:any) {
    if (!selectedInspectionId) return
    const current = getDimConfig(itemId,param.id) ?? {}
    const next:any = { ...current, ...patch }
    const nominal = next.valor_nominal === '' || next.valor_nominal == null ? null : Number(next.valor_nominal)
    const minus = next.desvio_menos === '' || next.desvio_menos == null ? null : Number(next.desvio_menos)
    const plus = next.desvio_mais === '' || next.desvio_mais == null ? null : Number(next.desvio_mais)
    if (nominal != null && minus != null) next.minimo_aceitavel = nominal - minus
    if (nominal != null && plus != null) next.maximo_aceitavel = nominal + plus

    const payload = {
      inspecao_id:selectedInspectionId,
      processo_item_id:itemId,
      parametro_id:param.id,
      nao_aplicavel:!!next.nao_aplicavel,
      equipamento:next.equipamento || null,
      codigo_equipamento:next.codigo_equipamento || null,
      unidade:next.unidade || param.unidade || null,
      valor_nominal:nominal,
      desvio_menos:minus,
      desvio_mais:plus,
      minimo_aceitavel:next.minimo_aceitavel ?? null,
      maximo_aceitavel:next.maximo_aceitavel ?? null,
      especificacao_desvio:next.especificacao_desvio || null,
      atualizado_em:new Date().toISOString(),
    }
    const q=await supabase.from('inspecao_dimensional_configuracoes').upsert(payload,{onConflict:'inspecao_id,processo_item_id,parametro_id'}).select('*').single()
    if (q.error || !q.data) return setError(q.error?.message ?? 'Falha ao salvar configuração dimensional.')
    setDetail((d:any)=>{
      const others=(d.dimConfigs ?? []).filter((x:any)=>!(x.processo_item_id===itemId && x.parametro_id===param.id))
      return { ...d, dimConfigs:[...others,q.data] }
    })
  }

  async function saveDimension(itemId: string, param: any, seq: number, value: string) {
    if (!selectedInspectionId || !value.trim()) return
    const cfg=getDimConfig(itemId,param.id)
    if (cfg?.nao_aplicavel) return
    const numeric=Number(value.replace(',','.'))
    const min=cfg?.minimo_aceitavel == null ? null : Number(cfg.minimo_aceitavel)
    const max=cfg?.maximo_aceitavel == null ? null : Number(cfg.maximo_aceitavel)
    const conforme = min == null && max == null ? null :
      (min == null || numeric >= min) && (max == null || numeric <= max)

    const q = await supabase.from('inspecao_dimensionais').upsert({
      inspecao_id: selectedInspectionId,
      processo_item_id: itemId,
      parametro_id: param.id,
      sequencia_amostra: seq,
      valor: numeric,
      unidade: cfg?.unidade || param.unidade || null,
      conforme,
    }, { onConflict: 'inspecao_id,processo_item_id,parametro_id,sequencia_amostra' }).select('*').single()
    if (q.error || !q.data) return setError(q.error?.message ?? 'Falha ao salvar medição.')
    setDetail((d:any)=>{
      const others=(d.dimResults ?? []).filter((x:any)=>!(x.processo_item_id===itemId && x.parametro_id===param.id && x.sequencia_amostra===seq))
      return { ...d, dimResults:[...others,q.data] }
    })
  }

  function dimensionSummary(itemId:string,paramId:string) {
    const rows=(detail?.dimResults ?? []).filter((x:any)=>x.processo_item_id===itemId && x.parametro_id===paramId)
    const nc=rows.filter((x:any)=>x.conforme===false).length
    const c=rows.filter((x:any)=>x.conforme===true).length
    let decision='Pendente'
    if (rows.length===10) {
      if (detail?.limite_rejeicao != null && nc >= Number(detail.limite_rejeicao)) decision='Reprovado'
      else if (detail?.limite_aceitacao != null && nc <= Number(detail.limite_aceitacao)) decision='Aprovado'
      else decision='Revisar'
    }
    return { total:rows.length, nc, c, decision }
  }

  async function markDimensionalsDone() {
    if (!selectedInspectionId || !detail) return
    const pendencias:string[]=[]
    for (const link of detail.items ?? []) {
      const item=link.processo_itens
      for (const p of detail.params ?? []) {
        const cfg=getDimConfig(item.id,p.id)
        if (cfg?.nao_aplicavel) continue
        const prefix=`${item.produtos?.sku} · ${p.nome}`
        if (!cfg) {
          pendencias.push(`${prefix}: informe especificação, unidade, equipamento e desvio.`)
          continue
        }
        if (!cfg.unidade) pendencias.push(`${prefix}: unidade de medida não informada.`)
        if (!cfg.equipamento) pendencias.push(`${prefix}: equipamento/instrumento não informado.`)
        if (!cfg.codigo_equipamento) pendencias.push(`${prefix}: código do equipamento não informado.`)
        if (cfg.valor_nominal == null) pendencias.push(`${prefix}: valor especificado não informado.`)
        if (cfg.minimo_aceitavel == null || cfg.maximo_aceitavel == null) pendencias.push(`${prefix}: desvio aceitável não definido.`)
        const count=(detail.dimResults ?? []).filter((x:any)=>x.processo_item_id===item.id && x.parametro_id===p.id).length
        if (count<10) pendencias.push(`${prefix}: ${count}/10 medições preenchidas.`)
      }
    }
    if (pendencias.length) {
      setPendingModal(pendencias)
      return
    }
    const q=await supabase.from('inspecoes').update({dimensionais_finalizados:true}).eq('id',selectedInspectionId)
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

  function addPendingPhotos(files: FileList | null) {
    if (!files) return
    const next = Array.from(files).map((file)=>({
      id: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
      legenda: '',
    }))
    setPendingPhotos((old)=>[...old,...next])
  }

  function removePendingPhoto(id:string) {
    setPendingPhotos((old)=>{
      const hit=old.find((x)=>x.id===id)
      if (hit) URL.revokeObjectURL(hit.url)
      return old.filter((x)=>x.id!==id)
    })
  }

  async function uploadInspectionPhotos() {
    if (!selectedInspectionId || !pendingPhotos.length) return
    if (pendingPhotos.some((p)=>!p.legenda.trim())) {
      return setError('Todas as fotos precisam de legenda antes de enviar.')
    }
    for (const p of pendingPhotos) {
      const safe = p.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${selectedInspectionId}/gerais/${Date.now()}-${safe}`
      const up = await supabase.storage.from('inspecao-fotos').upload(path,p.file,{contentType:p.file.type||undefined})
      if (up.error) return setError(up.error.message)
      const row = await supabase.from('inspecao_fotos').insert({
        inspecao_id:selectedInspectionId,
        storage_path:path,
        legenda:p.legenda.trim(),
      })
      if (row.error) return setError(row.error.message)
    }
    pendingPhotos.forEach((p)=>URL.revokeObjectURL(p.url))
    setPendingPhotos([])
    await openInspection(selectedInspectionId)
  }

  async function generateConclusionWithAI() {
    if (!detail) return
    setAiLoading(true)
    setError('')
    const payload={
      resultado_atual:detail.resultado,
      processo:formatFst(detail.grupos_inspecao?.processos?.codigo),
      cliente:detail.grupos_inspecao?.processos?.cliente,
      inspecao:detail.numero,
      amostragem:{
        lote:detail.tamanho_lote,
        prevista:detail.tamanho_amostra,
        inspecionada:detail.total_inspecionado,
        nao_conformes:detail.total_nao_conforme,
        ac:detail.limite_aceitacao,
        re:detail.limite_rejeicao,
      },
      verificacoes:(detail.checklist ?? []).map((item:any)=>{
        const r=detail.checklistResults?.find((x:any)=>x.checklist_id===item.id)
        return {item:item.requisito,resultado:r?.resultado??'pendente',classe:r?.severidade_confirmada??null}
      }),
      nao_conformidades:(detail.ncs ?? []).map((n:any)=>({descricao:n.descricao,severidade:n.severidade})),
      dimensionais:(detail.items ?? []).flatMap((link:any)=>
        (detail.params ?? []).map((p:any)=>({
          produto:link.processo_itens?.produtos?.nome,
          parametro:p.nome,
          resumo:dimensionSummary(link.processo_itens.id,p.id),
        }))
      ),
      testes:(detail.tests ?? []).map((t:any)=>{
        const r=detail.testResults?.find((x:any)=>x.teste_id===t.id)
        return {teste:t.nome,resultado:r?.resultado??'pendente'}
      }),
    }
    const {data,error}=await supabase.functions.invoke('sgq-conclusao',{body:payload})
    setAiLoading(false)
    if (error) {
      const msg=String((error as any)?.context?.body ?? error.message ?? '')
      if (msg.includes('ai_not_configured')) return setError('A geração por IA está pronta, mas a chave GEMINI_API_KEY ainda não foi configurada neste SGQ.')
      return setError('Não foi possível gerar a conclusão com IA.')
    }
    if (data?.error === 'ai_not_configured') {
      return setError('A geração por IA está pronta, mas a integração Gemini ainda não foi configurada em Configurações.')
    }
    if (data?.error) return setError('Não foi possível gerar a conclusão com IA.')
    if (data?.text) setFinalObservation(String(data.text))
  }

  async function finishInspection(result: 'aprovado' | 'reprovado') {
    if (!detail || !selectedInspectionId) return

    const pendencias:string[] = []
    const faltamAmostras = Math.max(0, Number(detail.tamanho_amostra ?? 0) - Number(detail.total_inspecionado ?? 0))
    const reAtingido = !!detail.limite_rejeicao && Number(detail.total_nao_conforme) >= Number(detail.limite_rejeicao)

    if (faltamAmostras > 0 && !reAtingido) {
      pendencias.push(`Amostragem: ${detail.total_inspecionado ?? 0} de ${detail.tamanho_amostra ?? 0} unidades registradas. Faltam ${faltamAmostras}.`)
    }

    const pendingChecks=(detail.checklist ?? []).filter((item:any)=>
      !detail.checklistResults?.some((r:any)=>r.checklist_id===item.id)
    )
    if (pendingChecks.length) {
      pendencias.push('Verificações pendentes: ' + pendingChecks.map((x:any)=>`${x.ordem}. ${x.requisito}`).join('; '))
    }

    const dimPending:string[]=[]
    for (const link of detail.items ?? []) {
      const item=link.processo_itens
      for (const p of detail.params ?? []) {
        const cfg=getDimConfig(item.id,p.id)
        if (cfg?.nao_aplicavel) continue
        const count=(detail.dimResults ?? []).filter((x:any)=>x.processo_item_id===item.id && x.parametro_id===p.id).length
        if (count<10) dimPending.push(`${item.produtos?.sku} · ${p.nome}: ${count}/10 medições`)
      }
    }
    if (dimPending.length && !detail.dimensionais_finalizados) {
      pendencias.push('Dimensionais pendentes: ' + dimPending.join('; '))
    } else if ((detail.params?.length ?? 0)>0 && !detail.dimensionais_finalizados) {
      pendencias.push('Dimensionais: as medições estão preenchidas, mas a seção ainda não foi marcada como concluída.')
    }

    const pendingTests=(detail.tests ?? []).filter((t:any)=>
      !detail.testResults?.some((r:any)=>r.teste_id===t.id)
    )
    if (pendingTests.length) {
      pendencias.push('Testes pendentes: ' + pendingTests.map((x:any)=>x.nome).join('; '))
    } else if ((detail.tests?.length ?? 0)>0 && !detail.testes_finalizados) {
      pendencias.push('Testes especiais: todos possuem resultado, mas a seção ainda não foi marcada como concluída.')
    }

    if (pendencias.length) {
      setPendingModal(pendencias)
      return
    }

    const thresholdExceeded = !!detail.limite_rejeicao && Number(detail.total_nao_conforme) >= Number(detail.limite_rejeicao)
    if (thresholdExceeded && result === 'aprovado' && !finalObservation.trim()) {
      setPendingModal(['O limite de rejeição foi atingido. Para aprovar a inspeção, registre a justificativa em Observação / conclusão.'])
      return
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
      <table><tr><th>Processo FST</th><td>${formatFst(process?.codigo)}</td><th>Cliente</th><td>${process?.cliente ?? ''}</td></tr>
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
                  <strong>{i.numero} · {formatFst(i.grupos_inspecao?.processos?.codigo)}</strong>
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
                      <span className="eyebrow">{formatFst(p.codigo)}</span>
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
                          {canDelete && <button className="danger icon-only" title="Excluir inspeção" onClick={()=>deleteInspection(i)}><Trash2 size={15}/></button>}
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
                <label>Processo FST
  <div className="fst-input"><span>FST</span><input inputMode="numeric" pattern="[0-9]*" maxLength={5} value={inspection.codigo} onChange={(e)=>setInspection({...inspection,codigo:fstDigits(e.target.value)})} placeholder="12345"/></div>
</label>
                <label>Cliente<input value={inspection.cliente} onChange={(e)=>setInspection({...inspection,cliente:e.target.value})}/></label>
                <label>Nota fiscal<input value={inspection.notaFiscal} onChange={(e)=>setInspection({...inspection,notaFiscal:e.target.value})}/></label>
                <label>Chegada no CD<input type="date" value={inspection.chegadaCd} onChange={(e)=>setInspection({...inspection,chegadaCd:e.target.value})}/></label>
                <label>Origem<input value={inspection.origem} onChange={(e)=>setInspection({...inspection,origem:e.target.value})} placeholder="China"/></label>
                <div className="field-label"><span>Transporte</span><div className="transport-checks">
                  <label className="check-option"><input type="checkbox" checked={inspection.transporte.includes('Aéreo')} onChange={()=>setInspection({...inspection,transporte:toggleTransport(inspection.transporte,'Aéreo')})}/><span>Aéreo</span></label>
                  <label className="check-option"><input type="checkbox" checked={inspection.transporte.includes('Marítimo')} onChange={()=>setInspection({...inspection,transporte:toggleTransport(inspection.transporte,'Marítimo')})}/><span>Marítimo</span></label>
                </div></div>
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
                  const boxes=Number(row.caixasRecebidas) || 0
                  const inspect=Number(row.caixasInspecionadas) || 0
                  return (
                    <article className="sku-card" key={i}>
                      <div className="sku-card-head">
                        <strong>{skuRows.length>1?'Componente '+(i+1):'Produto'}</strong>
                        {skuRows.length>1 && <button type="button" className="icon-button" onClick={()=>setSkuRows(skuRows.filter((_,j)=>j!==i))}><X size={16}/></button>}
                      </div>
                      <div className="form-grid">
                        <label>Código
                          <div className="input-action">
                            <input value={row.sku} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,sku:e.target.value,omieStatus:''}:r))} onBlur={()=>lookupProduct(i)} placeholder="Código Omie"/>
                            <button type="button" className="secondary icon-only" title="Consultar no OMIE" onClick={()=>lookupProduct(i)}><Search size={16}/></button>
                          </div>
                        </label>
                        <label>Descrição
                          <input value={row.nome} readOnly placeholder="Preenchida pelo OMIE"/>
                          {row.omieStatus==='loading' && <small className="field-status">Consultando OMIE…</small>}
                          {row.omieStatus==='found' && <small className="field-status ok">Produto confirmado no OMIE</small>}
                          {row.omieStatus==='not_found' && <small className="field-status bad">Código não encontrado no OMIE</small>}
                          {row.omieStatus==='not_configured' && <small className="field-status warn">Integração OMIE ainda não configurada neste SGQ</small>}
                          {row.omieStatus==='error' && <small className="field-status bad">Falha ao consultar o OMIE</small>}
                        </label>
                        <label>Lote<input value={row.lote} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,lote:e.target.value}:r))}/></label>
                        <label>Material<input value={row.material} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,material:e.target.value}:r))}/></label>
                        <label>Capacidade<input value={row.capacidade} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,capacidade:e.target.value}:r))}/></label>
                        <label>Quantidade recebida<input type="number" min="0.01" step="0.01" value={row.quantidade} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,quantidade:e.target.value}:r))}/></label>
                        <label>Quantidade por caixa<input type="number" min="0.01" step="0.01" value={row.quantidadePorCaixa} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,quantidadePorCaixa:e.target.value}:r))}/></label>
                        <label>Caixas recebidas<input type="number" min="0.01" step="0.01" value={row.caixasRecebidas} onChange={(e)=>{
                          const received=e.target.value
                          const calc=received ? String(boxesToInspect(Number(received))) : ''
                          setSkuRows(skuRows.map((r,j)=>j===i?{...r,caixasRecebidas:received,caixasInspecionadas:calc}:r))
                        }}/></label>
                        <label>Caixas inspecionadas<input type="number" min="0.01" step="0.01" value={row.caixasInspecionadas} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,caixasInspecionadas:e.target.value}:r))}/><small className="field-hint">Calculado automaticamente; pode ser alterado.</small></label>
                        {isComponentSet && <label>Unidades por conjunto<input type="number" min="0.01" step="0.01" value={row.unidadesPorConjunto} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,unidadesPorConjunto:e.target.value}:r))}/></label>}
                      </div>
                      <div className="computed">
                        <span>Caixas recebidas <b>{boxes || '—'}</b></span>
                        <span>Caixas inspecionadas <b>{inspect || '—'}</b></span>
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
              <span className="eyebrow">{formatFst(detail.grupos_inspecao?.processos?.codigo)} · {detail.numero}</span>
              <h1>{detail.grupos_inspecao?.nome}</h1>
            </div>
            <div className="row-actions">
              <span className="pill">{statusLabel(detail.status)}</span>
              {detail.status==='concluida' && <button className="secondary" onClick={downloadInspectionWord}><FileDown size={16}/> Word preenchido</button>}
              {canDelete && <button className="danger icon-only" title="Excluir inspeção" onClick={()=>deleteInspection({id:detail.id,numero:detail.numero})}><Trash2 size={16}/></button>}
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
                      <button className={r?.resultado==='nao_conforme'?'selected bad':''} onClick={()=>openNcModal(item.id)}>NC</button>
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
            <div className="section-title">
              <div><h2>Análises dimensionais</h2><span className="section-note">Especificação, instrumento, desvio aceitável e 10 medições por parâmetro.</span></div>
              {detail.dimensionais_finalizados && <span className="pill">Concluído</span>}
            </div>

            {(detail.items ?? []).map((link:any)=>{
              const item=link.processo_itens
              return (
                <div className="dimension-item" key={item.id}>
                  <h3>{item.produtos?.sku} · {item.produtos?.nome}</h3>
                  {(detail.params ?? []).map((p:any)=>{
                    const cfg=getDimConfig(item.id,p.id) ?? {}
                    const summary=dimensionSummary(item.id,p.id)
                    const min=cfg.minimo_aceitavel
                    const max=cfg.maximo_aceitavel
                    return (
                      <div className={'dimension-param '+(cfg.nao_aplicavel?'is-na':'')} key={p.id}>
                        <div className="param-title">
                          <div><strong>{p.nome}</strong>{cfg.nao_aplicavel && <span className="pill">NA</span>}</div>
                          <label className="check-option compact">
                            <input type="checkbox" checked={!!cfg.nao_aplicavel} disabled={detail.status==='concluida'} onChange={(e)=>saveDimConfig(item.id,p,{nao_aplicavel:e.target.checked})}/>
                            <span>Não aplicável</span>
                          </label>
                        </div>

                        {!cfg.nao_aplicavel && <>
                          <div className="dim-config-grid">
                            <label>Valor especificado
                              <input type="number" step="any" defaultValue={cfg.valor_nominal ?? ''} onBlur={(e)=>saveDimConfig(item.id,p,{valor_nominal:e.target.value})} disabled={detail.status==='concluida'}/>
                            </label>
                            <label>Unidade
                              <select value={cfg.unidade ?? p.unidade ?? ''} onChange={(e)=>saveDimConfig(item.id,p,{unidade:e.target.value})} disabled={detail.status==='concluida'}>
                                <option value="">Selecionar</option>
                                <option value="mg">mg</option><option value="g">g</option><option value="kg">kg</option>
                                <option value="mL">mL</option><option value="L">L</option>
                                <option value="µm">µm</option><option value="mm">mm</option><option value="cm">cm</option>
                                <option value="N">N</option><option value="°C">°C</option><option value="%">%</option>
                                <option value="un">un</option>
                              </select>
                            </label>
                            <label>Equipamento / instrumento
                              <input defaultValue={cfg.equipamento ?? ''} onBlur={(e)=>saveDimConfig(item.id,p,{equipamento:e.target.value})} disabled={detail.status==='concluida'}/>
                            </label>
                            <label>Cód. equipamento
                              <input defaultValue={cfg.codigo_equipamento ?? ''} onBlur={(e)=>saveDimConfig(item.id,p,{codigo_equipamento:e.target.value})} disabled={detail.status==='concluida'}/>
                            </label>
                            <label>Desvio - 
                              <input type="number" min="0" step="any" defaultValue={cfg.desvio_menos ?? ''} onBlur={(e)=>saveDimConfig(item.id,p,{desvio_menos:e.target.value})} disabled={detail.status==='concluida'}/>
                            </label>
                            <label>Desvio +
                              <input type="number" min="0" step="any" defaultValue={cfg.desvio_mais ?? ''} onBlur={(e)=>saveDimConfig(item.id,p,{desvio_mais:e.target.value})} disabled={detail.status==='concluida'}/>
                            </label>
                            <label className="span-2">Especificação / desvio
                              <input defaultValue={cfg.especificacao_desvio ?? ''} placeholder="Ex.: 60 g ± 2 g" onBlur={(e)=>saveDimConfig(item.id,p,{especificacao_desvio:e.target.value})} disabled={detail.status==='concluida'}/>
                            </label>
                          </div>

                          <div className="tolerance-strip">
                            <span>Faixa aceitável <b>{min ?? '—'} a {max ?? '—'} {cfg.unidade ?? p.unidade ?? ''}</b></span>
                            <span>Medições <b>{summary.total}/10</b></span>
                            <span>Conformes <b>{summary.c}</b></span>
                            <span>NC <b>{summary.nc}</b></span>
                            <span>Decisão <b className={'dim-decision '+summary.decision.toLowerCase()}>{summary.decision}</b></span>
                          </div>

                          <div className="measurement-grid">
                            {Array.from({length:10},(_,k)=>{
                              const seq=k+1
                              const existing=detail.dimResults?.find((x:any)=>x.processo_item_id===item.id && x.parametro_id===p.id && x.sequencia_amostra===seq)
                              return (
                                <label className={existing?.conforme===true?'measure-ok':existing?.conforme===false?'measure-bad':''} key={seq}>
                                  <span>{seq}</span>
                                  <input type="number" step="any" defaultValue={existing?.valor ?? ''} onBlur={(e)=>saveDimension(item.id,p,seq,e.target.value)} disabled={detail.status==='concluida'}/>
                                  {existing?.conforme===true && <small>C</small>}
                                  {existing?.conforme===false && <small>NC</small>}
                                </label>
                              )
                            })}
                          </div>
                        </>}
                      </div>
                    )
                  })}
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
            <div className="section-title">
              <div><h2>Fotos da inspeção</h2><span className="section-note">Cada foto deve ter uma legenda antes do envio.</span></div>
              <span className="pill">{detail.photos?.length ?? 0} enviada(s)</span>
            </div>

            {detail.status!=='concluida' && (
              <>
                <label className="upload-box"><Camera size={22}/><span>Selecionar fotos</span><input type="file" accept="image/*" multiple onChange={(e)=>addPendingPhotos(e.target.files)}/></label>
                {!!pendingPhotos.length && <div className="pending-photo-grid">
                  {pendingPhotos.map((p)=>(
                    <article className="photo-card" key={p.id}>
                      <img src={p.url} alt="Prévia"/>
                      <label>Legenda<input value={p.legenda} onChange={(e)=>setPendingPhotos((old)=>old.map((x)=>x.id===p.id?{...x,legenda:e.target.value}:x))} placeholder="Ex.: Tampa com risco na lateral"/></label>
                      <button className="secondary small" type="button" onClick={()=>removePendingPhoto(p.id)}>Remover</button>
                    </article>
                  ))}
                </div>}
                {!!pendingPhotos.length && <div className="actions"><button className="primary" type="button" onClick={uploadInspectionPhotos}>Enviar fotos</button></div>}
              </>
            )}

            <div className="photo-gallery">
              {(detail.photos ?? []).map((p:any)=>(
                <article className="photo-card saved" key={p.id}>
                  {p.signed_url ? <img src={p.signed_url} alt={p.legenda || 'Foto da inspeção'}/> : <div className="photo-placeholder"><Camera size={22}/></div>}
                  <strong>{p.legenda || 'Sem legenda'}</strong>
                  {p.nc_id && <span className="nc-photo-tag">Foto de NC</span>}
                </article>
              ))}
            </div>
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
              <div className="section-title conclusion-title">
                <label>Observação / conclusão</label>
                <button className="secondary small" type="button" onClick={generateConclusionWithAI} disabled={aiLoading}>
                  {aiLoading ? 'Gerando…' : 'Gerar com IA'}
                </button>
              </div>
              <textarea value={finalObservation} onChange={(e)=>setFinalObservation(e.target.value)} rows={5} placeholder="A conclusão gerada pela IA permanece totalmente editável."/>
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
        <section className="workspace stock-page">
          <div className="page-title stock-page-title">
            <div>
              <span className="eyebrow">CONTROLE DE ESTOQUE</span>
              <h1>Estoque de amostras</h1>
              <p className="page-subtitle">Consulta rápida por produto, processo, cliente, nota fiscal e endereço físico.</p>
            </div>
          </div>

          <section className="stock-summary">
            <article><span>Saldo total</span><strong>{stockStats.unidades.toLocaleString('pt-BR')}</strong><small>unidades</small></article>
            <article><span>Registros</span><strong>{stockStats.registros}</strong><small>posições de estoque</small></article>
            <article><span>SKUs</span><strong>{stockStats.skus}</strong><small>códigos distintos</small></article>
            <article className={stockStats.emInspecao>0?'attention':''}><span>Em inspeção</span><strong>{stockStats.emInspecao.toLocaleString('pt-BR')}</strong><small>unidades fora do armário</small></article>
          </section>

          <section className="stock-controls">
            <div className="stock-search-box">
              <Search size={18}/>
              <input value={stockSearch} onChange={(e)=>setStockSearch(e.target.value)} placeholder="Buscar SKU, produto, FST, cliente ou NF"/>
              {stockSearch && <button type="button" onClick={()=>setStockSearch('')} aria-label="Limpar busca">×</button>}
            </div>
            <select aria-label="Filtrar endereço" value={stockAddress} onChange={(e)=>setStockAddress(e.target.value)}>
              {stockAddresses.map((x)=><option value={x} key={x}>{x==='Todos'?'Todos os endereços':x}</option>)}
            </select>
            <div className="stock-result-count">{filteredSamples.length} resultado(s)</div>
          </section>

          <section className="stock-table-shell">
            <div className="stock-table-head stock-table-row">
              <span>Produto</span>
              <span>Processo</span>
              <span>Cliente</span>
              <span>NF</span>
              <span>Endereço</span>
              <span className="align-right">Saldo</span>
              <span></span>
            </div>

            <div className="stock-table-body">
              {filteredSamples.map((s)=>(
                <button className="stock-table-row stock-data-row" key={s.id} onClick={()=>setSelectedSample(s)}>
                  <span className="stock-product-cell">
                    <b>{s.sku || 'Sem código'}</b>
                    <em>{s.descricao || 'Descrição não informada'}</em>
                    {s.observacao && <small>{s.observacao}</small>}
                  </span>
                  <span><b className="stock-mobile-label">Processo</b>{s.processo_referencia || '—'}</span>
                  <span><b className="stock-mobile-label">Cliente</b>{s.cliente_referencia || '—'}</span>
                  <span><b className="stock-mobile-label">NF</b>{s.nota_fiscal_referencia || '—'}</span>
                  <span><b className="stock-mobile-label">Endereço</b><i className={'location-badge '+(s.endereco==='INSPEÇÃO'?'inspection':'')}>{s.endereco || '—'}</i></span>
                  <span className="stock-balance"><b className="stock-mobile-label">Saldo</b><strong>{Number(s.saldo).toLocaleString('pt-BR')}</strong><small>{s.unidade_controle}</small></span>
                  <span className="stock-open">›</span>
                </button>
              ))}
            </div>

            {!filteredSamples.length && (
              <div className="stock-empty">
                <PackageSearch size={28}/>
                <strong>Nenhum item encontrado</strong>
                <span>Ajuste a busca ou o filtro de endereço.</span>
              </div>
            )}
          </section>

          {selectedSample && (
            <div className="modal-backdrop stock-drawer-backdrop" onClick={()=>setSelectedSample(null)}>
              <article className="sample-detail stock-drawer" onClick={(e)=>e.stopPropagation()}>
                <div className="stock-drawer-head">
                  <div>
                    <span className="eyebrow">{selectedSample.sku || 'ESTOQUE'}</span>
                    <h2>{selectedSample.descricao || 'Amostra'}</h2>
                    <p>{selectedSample.processo_referencia || 'Sem processo vinculado'}</p>
                  </div>
                  <button className="close" onClick={()=>setSelectedSample(null)}>×</button>
                </div>

                <div className="stock-primary-info">
                  <div>
                    <small>Saldo atual</small>
                    <strong>{Number(selectedSample.saldo).toLocaleString('pt-BR')}</strong>
                    <span>{selectedSample.unidade_controle}</span>
                  </div>
                  <div className={selectedSample.endereco==='INSPEÇÃO'?'inspection':''}>
                    <small>Endereço</small>
                    <strong>{selectedSample.endereco || '—'}</strong>
                  </div>
                </div>

                <div className="stock-detail-section">
                  <h3>Rastreabilidade</h3>
                  <div className="detail-grid stock-detail-grid">
                    <div><small>Processo</small><strong>{selectedSample.processo_referencia || '—'}</strong></div>
                    <div><small>Cliente</small><strong>{selectedSample.cliente_referencia || '—'}</strong></div>
                    <div><small>Nota fiscal</small><strong>{selectedSample.nota_fiscal_referencia || '—'}</strong></div>
                    <div><small>Chegada</small><strong>{selectedSample.data_chegada_referencia || '—'}</strong></div>
                    <div><small>Lote</small><strong>{selectedSample.lote || '—'}</strong></div>
                    <div><small>Registro</small><strong>{selectedSample.codigo}</strong></div>
                  </div>
                  {selectedSample.observacao && <div className="stock-detail-note"><b>Observação</b><span>{selectedSample.observacao}</span></div>}
                </div>

                <div className="stock-detail-section stock-label-section">
                  <div>
                    <h3>Etiqueta</h3>
                    <p>QR para abrir este registro no SGQ.</p>
                  </div>
                  {qrDataUrl && <img className="qr" src={qrDataUrl} alt="QR"/>}
                  <button className="secondary wide" onClick={()=>downloadZpl(selectedSample)}><QrCode size={16}/> Gerar etiqueta Zebra 100×50</button>
                </div>

                <div className="stock-detail-section stock-move">
                  <h3>Movimentar estoque</h3>
                  <div className="form-grid one">
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
                  </div>
                  <button className="primary wide" onClick={moveStock}>Registrar movimentação</button>
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
            <h2>{formatFst(editingProcess.codigo)}</h2>
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
            <button className="close" type="button" onClick={resetNcDraft}>×</button>
            <span className="eyebrow">NÃO CONFORMIDADE</span>
            <h2>Registrar NC</h2>

            <label>Item da IT relacionado
              <select required value={ncDraft.checklistId} onChange={(e)=>setNcDraft({...ncDraft,checklistId:e.target.value})}>
                <option value="">Selecione o item verificado</option>
                {(detail?.checklist ?? []).map((x:any)=><option key={x.id} value={x.id}>{x.ordem}. {x.requisito}</option>)}
              </select>
            </label>

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

            <label>Descrição<textarea required rows={4} value={ncDraft.description} onChange={(e)=>setNcDraft({...ncDraft,description:e.target.value})}/></label>

            <label>Foto específica da NC
              <input required type="file" accept="image/*" onChange={(e)=>{
                const file=e.target.files?.[0] ?? null
                if (ncDraft.photoPreview) URL.revokeObjectURL(ncDraft.photoPreview)
                setNcDraft({...ncDraft,photoFile:file,photoPreview:file?URL.createObjectURL(file):''})
              }}/>
            </label>
            {ncDraft.photoPreview && <img className="nc-preview" src={ncDraft.photoPreview} alt="Prévia da NC"/>}
            <label>Legenda da foto<input required value={ncDraft.photoLegenda} onChange={(e)=>setNcDraft({...ncDraft,photoLegenda:e.target.value})} placeholder="Ex.: Trinca próxima ao gargalo"/></label>

            <button className="danger wide" type="submit">Registrar NC e foto</button>
          </form>
        </div>
      )}

      {!!pendingModal.length && (
        <div className="modal-backdrop" onClick={()=>setPendingModal([])}>
          <article className="sample-detail pending-detail" onClick={(e)=>e.stopPropagation()}>
            <button className="close" type="button" onClick={()=>setPendingModal([])}>×</button>
            <span className="eyebrow">PENDÊNCIAS</span>
            <h2>Não é possível finalizar ainda</h2>
            <p>Corrija os itens abaixo:</p>
            <ul className="pending-list">{pendingModal.map((p,i)=><li key={i}>{p}</li>)}</ul>
            <button className="primary wide" type="button" onClick={()=>setPendingModal([])}>Voltar para a inspeção</button>
          </article>
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
