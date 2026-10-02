import { useEffect, useMemo, useState } from 'react'
import { Boxes, Camera, CheckCircle2, ChevronRight, ClipboardCheck, Copy, Edit3, FileDown, FileText, LogOut, MessageCircle, PackageSearch, Play, Plus, QrCode, Search, ShieldCheck, Sparkles, Trash2, Upload, Warehouse, X } from 'lucide-react'
import QRCode from 'qrcode'
import { apiGet, apiPost, apiPut, supabase } from './lib/supabase'
import AuditoriasPage from './auditorias/AuditoriasPage'
import InspectionChat from './full-inspection/InspectionChat'

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
  laudo_id?: string | null
  laudo_numero?: string | null
  laudo_storage_path?: string | null
  foto_cadastro_path?: string | null
  produto_foto_principal_path?: string | null
  data_inspecao_referencia?: string | null
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
  distribuicaoCaixas: '',
  unidadesPorConjunto: '1',
  fotoFile: null as File | null,
  fotoPreview: '',
  fotoPrincipalPath: '',
  omieStatus: '' as '' | 'loading' | 'found' | 'not_found' | 'not_configured' | 'error',
  omieMessage: '',
})

function fstDigits(value: string) {
  return value.replace(/\D/g, '').slice(0,5)
}
function formatFst(value: string | null | undefined) {
  const d = String(value ?? '').replace(/\D/g, '')
  return d ? 'FST' + d : '—'
}
function formatDateBR(value: string | null | undefined) {
  if (!value) return '—'
  const raw=String(value).slice(0,10)
  const [y,m,d]=raw.split('-')
  return y && m && d ? `${d}/${m}/${y}` : raw
}
function toggleTransport(current: string, mode: 'Aéreo' | 'Marítimo') {
  const set = new Set(current.split(',').map((x)=>x.trim()).filter(Boolean))
  set.has(mode) ? set.delete(mode) : set.add(mode)
  return [...set].join(', ')
}


function boxesToInspect(totalBoxes: number) {
  if (totalBoxes <= 0) return 0
  if (totalBoxes === 1) return 1
  if (totalBoxes === 2) return 2
  if (totalBoxes <= 6) return 3
  if (totalBoxes <= 12) return 4
  if (totalBoxes <= 20) return 5
  if (totalBoxes <= 30) return 6
  if (totalBoxes <= 42) return 7
  if (totalBoxes <= 56) return 8
  return Math.min(totalBoxes, Math.ceil(Math.sqrt(totalBoxes + 1)))
}

function parseBoxDistribution(raw:string) {
  const text=raw.trim().replace(/×/g,'x')
  if (!text) return { valid:true, groups:[] as Array<{caixas:number;unidades:number}>, boxes:0, units:0, error:'' }
  const parts=text.split(/[+;,]/).map((x)=>x.trim()).filter(Boolean)
  const groups:Array<{caixas:number;unidades:number}>=[]
  for (const part of parts) {
    const match=part.match(/^(\d+)\s*x\s*(\d+(?:[.,]\d+)?)$/i)
    if (!match) return { valid:false, groups:[], boxes:0, units:0, error:`Trecho inválido: "${part}". Use, por exemplo, 44x136 + 1x49 + 1x60.` }
    const caixas=Number(match[1])
    const unidades=Number(match[2].replace(',','.'))
    if (caixas<=0 || unidades<=0) return { valid:false, groups:[], boxes:0, units:0, error:'Quantidade de caixas e unidades deve ser maior que zero.' }
    groups.push({caixas,unidades})
  }
  return {
    valid:true,
    groups,
    boxes:groups.reduce((s,g)=>s+g.caixas,0),
    units:groups.reduce((s,g)=>s+(g.caixas*g.unidades),0),
    error:'',
  }
}

function zplText(value:string|null|undefined,max=54) {
  return String(value ?? '').replace(/[\^~\r\n]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
}

async function imageUrlToGfa(url:string,maxWidth=190,maxHeight=145) {
  if (!url) return ''
  try {
    const img=new Image()
    img.crossOrigin='anonymous'
    await new Promise<void>((resolve,reject)=>{
      img.onload=()=>resolve()
      img.onerror=()=>reject(new Error('Falha ao carregar imagem'))
      img.src=url
    })
    const scale=Math.min(maxWidth/img.naturalWidth,maxHeight/img.naturalHeight,1)
    const width=Math.max(1,Math.floor(img.naturalWidth*scale))
    const height=Math.max(1,Math.floor(img.naturalHeight*scale))
    const canvas=document.createElement('canvas')
    canvas.width=width
    canvas.height=height
    const ctx=canvas.getContext('2d')
    if (!ctx) return ''
    ctx.fillStyle='#fff'
    ctx.fillRect(0,0,width,height)
    ctx.drawImage(img,0,0,width,height)
    const px=ctx.getImageData(0,0,width,height).data
    const bytesPerRow=Math.ceil(width/8)
    let hex=''
    for (let y=0;y<height;y++) {
      for (let b=0;b<bytesPerRow;b++) {
        let value=0
        for (let bit=0;bit<8;bit++) {
          const x=b*8+bit
          if (x>=width) continue
          const idx=(y*width+x)*4
          const gray=(px[idx]*0.299)+(px[idx+1]*0.587)+(px[idx+2]*0.114)
          if (gray<165 && px[idx+3]>40) value|=(1<<(7-bit))
        }
        hex+=value.toString(16).padStart(2,'0').toUpperCase()
      }
    }
    const total=bytesPerRow*height
    return `^GFA,${total},${total},${bytesPerRow},${hex}`
  } catch {
    return ''
  }
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
  const [environment, setEnvironment] = useState<'full' | 'contlog' | null>(null)
  const [tab, setTab] = useState<'painel' | 'inspecoes' | 'nova' | 'execucao' | 'its' | 'estoque' | 'auditorias'>('painel')
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
  const [internalObservation, setInternalObservation] = useState('')
  const [retentionRows, setRetentionRows] = useState<Record<string,{
    retain:boolean; qty:string; address:string; photoFile:File|null; photoPreview:string
  }>>({})
  const [retentionReason, setRetentionReason] = useState('')
  const [stockMove, setStockMove] = useState({ tipo: 'retirada', quantidade: '', endereco: '', motivo: '' })
  const [pendingPhotos, setPendingPhotos] = useState<Array<{id:string;file:File;url:string;legenda:string;productId:string}>>([])
  const [pendingModal, setPendingModal] = useState<string[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [inspectionChatOpen, setInspectionChatOpen] = useState(false)
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantText, setAssistantText] = useState('')
  const [assistantQuestion, setAssistantQuestion] = useState('')
  const [itVersions, setItVersions] = useState<ItVersion[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [samples, setSamples] = useState<Sample[]>([])
  const [stockSearch, setStockSearch] = useState('')
  const [stockAddress, setStockAddress] = useState('Todos')
  const [selectedSample, setSelectedSample] = useState<Sample | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [selectedSamplePhotoUrl, setSelectedSamplePhotoUrl] = useState('')
  const [selectedSampleProductPhotoUrl, setSelectedSampleProductPhotoUrl] = useState('')
  const [selectedSampleReport, setSelectedSampleReport] = useState<{numero:string;url:string|null}|null>(null)

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
  const [itBusyId, setItBusyId] = useState<string | null>(null)
  const [itReview, setItReview] = useState<{
    it: ItVersion
    checklist: any[]
    dimensionais: any[]
    testes: any[]
    avisos: string[]
  } | null>(null)

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
        const addrA=a.endereco ?? 'ZZZ'
        const addrB=b.endereco ?? 'ZZZ'
        return addrA.localeCompare(addrB,'pt-BR') || String(a.sku ?? '').localeCompare(String(b.sku ?? ''),'pt-BR')
      })
  },[samples,stockSearch,stockAddress])

  const stockStats = useMemo(() => ({
    registros: samples.length,
    unidades: samples.reduce((sum,s)=>sum+Number(s.saldo || 0),0),
    skus: new Set(samples.map((s)=>s.sku).filter(Boolean)).size,
    enderecos: new Set(samples.map((s)=>s.endereco).filter(Boolean)).size,
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
      setEnvironment(null)
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
    let active=true
    if (!selectedSample) {
      setQrDataUrl('')
      setSelectedSamplePhotoUrl('')
      setSelectedSampleProductPhotoUrl('')
      setSelectedSampleReport(null)
      return
    }

    QRCode.toDataURL(sampleUrl(selectedSample), { margin: 1, width: 220 }).then((url)=>{
      if (active) setQrDataUrl(url)
    })

    void (async()=>{
      if (selectedSample.foto_cadastro_path) {
        const signed=await supabase.storage.from('amostra-cadastro').createSignedUrl(selectedSample.foto_cadastro_path,3600)
        if (active) setSelectedSamplePhotoUrl(signed.data?.signedUrl ?? '')
      } else if (active) setSelectedSamplePhotoUrl('')

      if (selectedSample.produto_foto_principal_path) {
        const signed=await supabase.storage.from('produto-fotos').createSignedUrl(selectedSample.produto_foto_principal_path,3600)
        if (active) setSelectedSampleProductPhotoUrl(signed.data?.signedUrl ?? '')
      } else if (active) setSelectedSampleProductPhotoUrl('')

      if (selectedSample.laudo_id) {
        const report=await supabase.from('laudos').select('numero,storage_path').eq('id',selectedSample.laudo_id).maybeSingle()
        if (!active) return
        if (report.data) {
          let url:string|null=null
          if (report.data.storage_path) {
            const signed=await supabase.storage.from('laudos').createSignedUrl(report.data.storage_path,3600)
            url=signed.data?.signedUrl ?? null
          }
          if (active) setSelectedSampleReport({numero:report.data.numero,url})
        } else setSelectedSampleReport(null)
      } else if (active) setSelectedSampleReport(null)
    })()

    return ()=>{active=false}
  }, [selectedSample])


  async function loadApp() {
    setError('')
    const loaded=await apiGet<any>('/api/app/bootstrap')
    if (loaded.error || !loaded.data) {
      setError(loaded.error?.message || 'Falha ao carregar o SGQ.')
      return
    }
    const data=loaded.data
    if (!data.profile) {
      setError('Seu usuário ainda não possui perfil liberado no SGQ.')
      return
    }
    setProfile(data.profile as Profile)
    setProcesses((data.processes ?? []) as ProcessRow[])
    setInspections((data.inspections ?? []) as InspectionRow[])
    setItVersions((data.itVersions ?? []) as ItVersion[])
    setGroups((data.groups ?? []) as Group[])
    setSamples((data.samples ?? []).map((s:any)=>({...s,saldo:Number(s.saldo ?? 0)})))
    setCounts(data.counts ?? {
      processos:(data.processes ?? []).length,
      inspecoes:(data.inspections ?? []).length,
      amostras:(data.samples ?? []).length,
      laudos:0,
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
    setSkuRows((rows)=>rows.map((r,i)=>i===index?{...r,omieStatus:'loading',omieMessage:'Consultando cadastro do OMIE…'}:r))

    const result=await apiPost<any>('/api/produtos/consultar',{codigo:code})
    if (result.error) {
      setSkuRows((rows)=>rows.map((r,i)=>i===index?{...r,nome:'',omieStatus:'error',omieMessage:result.error.message || 'Falha ao consultar o OMIE.'}:r))
      return
    }
    const data=result.data
    if (data?.error === 'omie_not_configured') {
      setSkuRows((rows)=>rows.map((r,i)=>i===index?{...r,nome:'',omieStatus:'not_configured',omieMessage:String(data?.message ?? 'Integração OMIE não configurada.')}:r))
      return
    }
    if (data?.error === 'not_found') {
      setSkuRows((rows)=>rows.map((r,i)=>i===index?{...r,nome:'',omieStatus:'not_found',omieMessage:String(data?.message ?? 'Código não encontrado no OMIE.')}:r))
      return
    }
    if (data?.error) {
      let prefix='Falha ao consultar o OMIE'
      if (data.error==='auth_error') prefix='Credenciais do OMIE recusadas'
      if (data.error==='rate_limit') prefix='Limite de consultas do OMIE atingido'
      setSkuRows((rows)=>rows.map((r,i)=>i===index?{...r,nome:'',omieStatus:'error',omieMessage:prefix+': '+String(data?.message ?? prefix)}:r))
      return
    }
    if (!data?.found || !data?.descricao) {
      setSkuRows((rows)=>rows.map((r,i)=>i===index?{...r,nome:'',omieStatus:'not_found',omieMessage:'Código não localizado no cadastro de produtos do OMIE.'}:r))
      return
    }

    setSkuRows((rows)=>rows.map((r,i)=>i===index?{
      ...r,
      nome:String(data.descricao),
      fotoPrincipalPath:String(data.fotoPrincipalPath ?? ''),
      fotoPreview:String(data.fotoPreview ?? ''),
      omieStatus:'found',
      omieMessage:String(data.message ?? 'Produto confirmado no OMIE.'),
    }:r))

    if (data.hasNcHistory) {
      setInspection((x)=>({...x,inspectionLevel:'II'}))
      setMessage('Produto localizado no OMIE. Há histórico de NC; Nível II foi sugerido.')
    }
  }

  async function saveProcessEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingProcess) return
    const saved=await apiPut<any>(`/api/processos/${editingProcess.id}`,{
      cliente:editingProcess.cliente,
      notaFiscal:editingProcess.nota_fiscal,
      origem:editingProcess.origem,
      transporte:editingProcess.transporte,
      chegadaCd:editingProcess.chegada_cd,
    })
    if (saved.error) return setError(saved.error.message)
    setEditingProcess(null)
    setMessage('Processo atualizado.')
    await loadApp()
  }

  async function deleteProcess(p: ProcessRow) {
    if (!canDelete) return
    if (!window.confirm(`Excluir o processo ${p.codigo} da visão operacional? O histórico será preservado para auditoria.`)) return
    const deleted=await apiPost<any>(`/api/processos/${p.id}/excluir`,{})
    if (deleted.error) return setError(deleted.error.message)
    setMessage('Processo removido da visão operacional.')
    await loadApp()
  }

  async function deleteInspection(i: InspectionRow | { id:string; numero?:string }) {
    if (!canDelete) return
    const label = (i as any).numero ? ` ${(i as any).numero}` : ''
    if (!window.confirm(`Excluir a inspeção${label}? Ela sairá da operação, mas o registro de auditoria será preservado.`)) return
    const deleted=await apiPost<any>(`/api/inspecoes/${i.id}/excluir`,{numero:(i as any).numero ?? null})
    if (deleted.error) return setError(deleted.error.message)
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
    const loaded=await apiGet<any>(`/api/inspecoes/${id}/detalhe`)
    if (loaded.error || !loaded.data?.inspecao) {
      return setError(loaded.error?.message ?? 'Inspeção não encontrada.')
    }

    const data=loaded.data
    const photoUrls=data.photoUrls ?? {}
    const photosWithUrls=(data.photos ?? []).map((p:any)=>({
      ...p,
      signed_url:photoUrls[p.storage_path] ?? null,
    }))
    const next={
      ...data.inspecao,
      items:data.items ?? [],
      checklist:data.checklist ?? [],
      checklistResults:data.checklistResults ?? [],
      params:data.params ?? [],
      dimResults:data.dimResults ?? [],
      dimConfigs:data.dimConfigs ?? [],
      tests:data.tests ?? [],
      testResults:data.testResults ?? [],
      photos:photosWithUrls,
      registers:data.registers ?? [],
      ncs:data.ncs ?? [],
      retained:data.retained ?? [],
    }

    setDetail(next)
    setFinalObservation(next.observacoes ?? '')
    setInternalObservation(next.observacao_interna ?? '')
    const retention:Record<string,{retain:boolean;qty:string;address:string;photoFile:File|null;photoPreview:string}>={}
    for (const link of next.items as any[]) {
      const item=link.processo_itens
      const existing=(next.retained as any[]).find((x:any)=>x.produto_id===item?.produto_id)
      retention[item.id]={retain:!existing,qty:'',address:'',photoFile:null,photoPreview:''}
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

    const itens:any[]=[]
    for (const row of skuRows) {
      const dist=parseBoxDistribution(row.distribuicaoCaixas)
      if (!dist.valid) return setError(`${row.sku}: ${dist.error}`)

      let fotoPrincipalPath=row.fotoPrincipalPath || ''
      if (row.fotoFile) {
        const safe=row.fotoFile.name.replace(/[^a-zA-Z0-9._-]/g,'_')
        const photoPath=`${row.sku.trim()}/${Date.now()}-${safe}`
        const upload=await supabase.storage.from('produto-fotos').upload(photoPath,row.fotoFile,{contentType:row.fotoFile.type||undefined})
        if (upload.error) return setError('Falha ao salvar foto principal do produto: '+upload.error.message)
        fotoPrincipalPath=photoPath
      }

      itens.push({
        sku:row.sku.trim(),
        nome:row.nome.trim(),
        lote:row.lote.trim() || null,
        material:row.material.trim() || null,
        capacidade:row.capacidade.trim() || null,
        quantidade:Number(row.quantidade),
        quantidadePorCaixa:Number(row.quantidadePorCaixa) || null,
        caixasRecebidas:Number(row.caixasRecebidas),
        caixasInspecionadas:Number(row.caixasInspecionadas),
        unidadesPorConjunto:Number(row.unidadesPorConjunto || 1),
        distribuicaoCaixas:dist.groups.length ? dist.groups : null,
        fotoPrincipalPath:fotoPrincipalPath || null,
      })
    }

    const created=await apiPost<any>('/api/inspecoes/criar',{
      codigo:inspection.codigo.trim(),
      cliente:inspection.cliente.trim(),
      notaFiscal:inspection.notaFiscal.trim() || null,
      origem:inspection.origem.trim() || null,
      transporte:inspection.transporte.trim() || null,
      chegadaCd:inspection.chegadaCd || null,
      dataInspecao:inspection.dataInspecao,
      itVersionId:inspection.itVersionId,
      inspectionLevel:inspection.inspectionLevel,
      itens,
    })

    if (created.error || !created.data?.id) {
      return setError(created.error?.message || 'Falha ao criar inspeção.')
    }

    setMessage(`Inspeção ${created.data.numero} iniciada pelo backend .NET.`)
    resetNewInspection()
    await loadApp()
    await openInspection(created.data.id)
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
    if (!detail || !selectedInspectionId) return
    if (!conforme) {
      if (!nc?.checklistId) return setError('Selecione o item da IT relacionado à não conformidade.')
      if (!nc?.description.trim()) return setError('Descreva a não conformidade.')
    }

    const result=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/unidades`,{
      conforme,
      severidade:nc?.severity || null,
      descricao:nc?.description?.trim() || null,
      itemId:nc?.itemId || null,
      checklistId:nc?.checklistId || null,
    })
    if (result.error) return setError(result.error.message || 'Falha ao registrar unidade.')

    resetNcDraft()
    await openInspection(selectedInspectionId)
    if (result.data?.re_atingido) {
      setMessage('Limite de rejeição atingido. Você pode encerrar agora ou continuar até completar a amostra.')
    }
  }

  async function saveChecklist(checkId: string, result: string, severity?: string) {
    if (!selectedInspectionId) return
    const existing = detail?.checklistResults?.find((x:any) => x.checklist_id === checkId)
    const saved=await apiPut<any>(`/api/inspecoes/${selectedInspectionId}/checklist/${checkId}`,{
      resultado:result,
      severidade:result==='nao_conforme' ? (severity || existing?.severidade_confirmada || 'grave') : null,
    })
    if (saved.error) return setError(saved.error.message)
    await openInspection(selectedInspectionId)
  }

  async function saveChecklistSeverity(checkId: string, severity: string) {
    if (!selectedInspectionId) return
    const saved=await apiPut<any>(`/api/inspecoes/${selectedInspectionId}/checklist/${checkId}`,{
      resultado:null,
      severidade:severity,
    })
    if (saved.error) return setError(saved.error.message)
    await openInspection(selectedInspectionId)
  }

  async function saveInternalObservation() {
    if (!selectedInspectionId || !canWrite) return
    const saved=await apiPut<any>(`/api/inspecoes/${selectedInspectionId}/observacao-interna`,{
      texto:internalObservation.trim() || null,
    })
    if (saved.error) return setError(saved.error.message)
    setDetail((d:any)=>d?{...d,observacao_interna:internalObservation.trim() || null}:d)
    setMessage('Observação interna salva. Ela fica somente no SGQ e não é incluída no laudo.')
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

    const saved=await apiPut<any>(`/api/inspecoes/${selectedInspectionId}/dimensionais/${itemId}/${param.id}/config`,{
      naoAplicavel:!!next.nao_aplicavel,
      equipamento:next.equipamento || null,
      codigoEquipamento:next.codigo_equipamento || null,
      unidade:next.unidade || param.unidade || null,
      valorNominal:nominal,
      desvioMenos:minus,
      desvioMais:plus,
      especificacaoDesvio:next.especificacao_desvio || null,
      tipoReferencia:next.tipo_referencia || param.tipo_referencia || null,
    })
    if (saved.error || !saved.data) return setError(saved.error?.message ?? 'Falha ao salvar configuração dimensional.')
    setDetail((d:any)=>{
      const others=(d.dimConfigs ?? []).filter((x:any)=>!(x.processo_item_id===itemId && x.parametro_id===param.id))
      return { ...d, dimConfigs:[...others,saved.data] }
    })
  }

  async function saveDimension(itemId: string, param: any, seq: number, value: string) {
    if (!selectedInspectionId || !value.trim()) return
    const cfg=getDimConfig(itemId,param.id)
    if (cfg?.nao_aplicavel) return
    const numeric=Number(value.replace(',','.'))
    if (!Number.isFinite(numeric)) return setError('Informe um valor dimensional válido.')

    const saved=await apiPut<any>(`/api/inspecoes/${selectedInspectionId}/dimensionais/${itemId}/${param.id}/${seq}`,{
      valor:numeric,
      unidade:cfg?.unidade || param.unidade || null,
    })
    if (saved.error || !saved.data) return setError(saved.error?.message ?? 'Falha ao salvar medição.')
    setDetail((d:any)=>{
      const others=(d.dimResults ?? []).filter((x:any)=>!(x.processo_item_id===itemId && x.parametro_id===param.id && x.sequencia_amostra===seq))
      return { ...d, dimResults:[...others,saved.data] }
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
    if (!selectedInspectionId) return
    const saved=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/dimensionais/finalizar`,{})
    if (saved.error) return setError(saved.error.message)
    setMessage('Dimensionais marcados como concluídos. Nesta fase de testes, campos pendentes não bloqueiam o avanço.')
    await openInspection(selectedInspectionId)
  }

  async function saveTest(testId: string, result: string) {
    if (!selectedInspectionId) return
    const saved=await apiPut<any>(`/api/inspecoes/${selectedInspectionId}/testes/${testId}`,{resultado:result})
    if (saved.error) return setError(saved.error.message)
    await openInspection(selectedInspectionId)
  }

  async function markTestsDone() {
    if (!selectedInspectionId) return
    const saved=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/testes/finalizar`,{})
    if (saved.error) return setError(saved.error.message)
    await openInspection(selectedInspectionId)
  }

  function addPendingPhotos(files: FileList | null) {
    if (!files) return
    const next = Array.from(files).map((file)=>({
      id: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
      legenda: '',
      productId: '',
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
    const validProductIds=new Set((detail?.items ?? []).map((x:any)=>x.processo_itens?.produto_id).filter(Boolean))
    const registros:any[]=[]
    let hasProductPhoto=false

    for (const p of pendingPhotos) {
      const safe = p.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const stamp=Date.now()
      const path = `${selectedInspectionId}/gerais/${stamp}-${safe}`
      const up = await supabase.storage.from('inspecao-fotos').upload(path,p.file,{contentType:p.file.type||undefined})
      if (up.error) return setError(up.error.message)

      let productPhotoPath:string|null=null
      if (p.productId && validProductIds.has(p.productId)) {
        productPhotoPath=`${p.productId}/${stamp}-${safe}`
        const productUpload=await supabase.storage.from('produto-fotos').upload(productPhotoPath,p.file,{contentType:p.file.type||undefined})
        if (productUpload.error) return setError('A foto da inspeção foi salva, mas não foi possível defini-la como identificação do produto: '+productUpload.error.message)
        hasProductPhoto=true
      }

      registros.push({
        storagePath:path,
        legenda:p.legenda.trim(),
        productId:p.productId || null,
        productPhotoPath,
      })
    }

    const saved=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/fotos/registrar`,{fotos:registros})
    if (saved.error) return setError(saved.error.message)

    pendingPhotos.forEach((p)=>URL.revokeObjectURL(p.url))
    setPendingPhotos([])
    setMessage(hasProductPhoto
      ? 'Fotos enviadas. A imagem selecionada também foi definida como identificação principal do produto.'
      : 'Fotos da inspeção enviadas.')
    await openInspection(selectedInspectionId)
  }

  function buildInspectionAssistantContext() {
    if (!detail) return null
    return {
      identificacao:{
        inspecao:detail.numero,
        processo:formatFst(detail.grupos_inspecao?.processos?.codigo),
        cliente:detail.grupos_inspecao?.processos?.cliente,
        grupo:detail.grupos_inspecao?.nome,
        it:{
          codigo:detail.it_versoes?.instrucoes_trabalho?.codigo,
          titulo:detail.it_versoes?.instrucoes_trabalho?.titulo,
          versao:detail.it_versoes?.versao,
        },
      },
      plano:{
        lote_estatistico:detail.tamanho_lote,
        nivel:detail.nivel_inspecao,
        codigo_amostragem:detail.codigo_amostragem,
        amostra_prevista:detail.tamanho_amostra,
        inspecionado:detail.total_inspecionado,
        nao_conformes:detail.total_nao_conforme,
        ac:detail.limite_aceitacao,
        re:detail.limite_rejeicao,
        caixas_recebidas:detail.caixas_recebidas,
        caixas_avaliar:detail.caixas_avaliar,
      },
      produtos:(detail.items ?? []).map((link:any)=>({
        codigo:link.processo_itens?.produtos?.sku,
        descricao:link.processo_itens?.produtos?.nome,
        lote:link.processo_itens?.lote,
        quantidade:link.processo_itens?.quantidade,
        caixas_recebidas:link.processo_itens?.caixas_recebidas,
        caixas_inspecionadas:link.processo_itens?.caixas_inspecionadas,
      })),
      verificacoes:(detail.checklist ?? []).map((item:any)=>{
        const r=detail.checklistResults?.find((x:any)=>x.checklist_id===item.id)
        return {
          ordem:item.ordem,
          requisito:item.requisito,
          instrucao:item.instrucao,
          resultado:r?.resultado ?? 'pendente',
          severidade:r?.severidade_confirmada ?? null,
        }
      }),
      nao_conformidades:(detail.ncs ?? []).map((n:any)=>({
        descricao:n.descricao,
        severidade:n.severidade,
        checklist_id:n.checklist_id,
        produto_id:n.processo_item_id,
        foto_registrada:!!n.foto_storage_path,
      })),
      dimensionais:(detail.items ?? []).flatMap((link:any)=>
        (detail.params ?? []).map((p:any)=>{
          const cfg=getDimConfig(link.processo_itens.id,p.id)
          return {
            produto:link.processo_itens?.produtos?.sku,
            parametro:p.nome,
            nao_aplicavel:!!cfg?.nao_aplicavel,
            unidade:cfg?.unidade ?? p.unidade ?? null,
            valor_nominal:cfg?.valor_nominal ?? null,
            minimo:cfg?.minimo_aceitavel ?? null,
            maximo:cfg?.maximo_aceitavel ?? null,
            equipamento:cfg?.equipamento ?? null,
            codigo_equipamento:cfg?.codigo_equipamento ?? null,
            tipo_referencia:cfg?.tipo_referencia ?? p.tipo_referencia ?? null,
            resumo:dimensionSummary(link.processo_itens.id,p.id),
          }
        })
      ),
      testes:(detail.tests ?? []).map((t:any)=>{
        const r=detail.testResults?.find((x:any)=>x.teste_id===t.id)
        return {
          teste:t.nome,
          procedimento:t.procedimento,
          criterio:t.criterio_aprovacao,
          resultado:r?.resultado ?? 'pendente',
        }
      }),
      fotos:{
        gerais:(detail.photos ?? []).filter((p:any)=>!p.nc_id).length,
        nc:(detail.photos ?? []).filter((p:any)=>!!p.nc_id).length,
      },
      conclusao_atual:finalObservation,
    }
  }

  function localAssistantText(question='') {
    const context:any=buildInspectionAssistantContext() ?? {}
    const plan:any=context.plano ?? {}
    const pendingChecks=(context.verificacoes ?? []).filter((x:any)=>x.resultado==='pendente')
    const pendingDims=(context.dimensionais ?? []).filter((x:any)=>!x.nao_aplicavel && Number(x.resumo?.total ?? 0)<10)
    const pendingTests=(context.testes ?? []).filter((x:any)=>x.resultado==='pendente')
    const remaining=Math.max(Number(plan.amostra_prevista ?? 0)-Number(plan.inspecionado ?? 0),0)
    const steps:string[]=[]
    if (remaining>0) steps.push(`Amostragem: faltam ${remaining} unidade(s) para completar ${plan.amostra_prevista ?? 0}.`)
    if (pendingChecks.length) steps.push(`Verificações: ${pendingChecks.length} item(ns) da IT ainda estão pendentes.`)
    if (pendingDims.length) steps.push(`Dimensionais: ${pendingDims.length} parâmetro(s) ainda não têm as 10 medições exigidas.`)
    if (pendingTests.length) steps.push(`Testes: ${pendingTests.length} teste(s) ainda estão pendentes.`)
    if (Number(plan.re ?? 0)>0 && Number(plan.nao_conformes ?? 0)>=Number(plan.re)) steps.push('Atenção: o limite de rejeição registrado no plano já foi atingido.')
    if (!steps.length) steps.push('Os registros principais estão preenchidos. Revise evidências, conclusão e retenção antes do encerramento.')
    return (question ? `Pergunta: ${question}

` : '') + steps.join('\n')
  }

  async function runInspectionAssistant(mode:'analisar'|'pergunta') {
    if (!detail) return
    if (mode==='pergunta' && !assistantQuestion.trim()) return
    setAssistantLoading(true)
    setError('')
    const {data,error}=await supabase.functions.invoke('sgq-assistente',{
      body:{
        mode,
        question:mode==='pergunta'?assistantQuestion.trim():'',
        context:buildInspectionAssistantContext(),
      }
    })
    setAssistantLoading(false)
    if (error || data?.error || !(data?.answer ?? data?.text)) {
      setAssistantText(localAssistantText(mode==='pergunta'?assistantQuestion.trim():''))
      if (mode==='pergunta') setAssistantQuestion('')
      return
    }
    setAssistantText(String(data?.answer ?? data?.text ?? ''))
    if (mode==='pergunta') setAssistantQuestion('')
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
    const finished=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/concluir`,{
      resultado:result,
      observacoes:finalObservation.trim() || null,
    })
    if (finished.error) return setError(finished.error.message)

    const pendencias:string[]=finished.data?.pendencias ?? []
    setMessage(pendencias.length
      ? 'Inspeção finalizada em modo de teste, mesmo com campos pendentes.'
      : 'Inspeção finalizada. Agora defina a retenção das amostras.')
    await loadApp()
    await openInspection(selectedInspectionId)
  }

  async function saveRetention() {
    if (!detail || !selectedInspectionId) return
    const selected = (detail.items ?? []).filter((link:any) => retentionRows[link.processo_itens.id]?.retain)

    if (!selected.length) {
      if (!retentionReason.trim()) return setError('Informe o motivo para não reter amostra.')
      const saved=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/retencao`,{
        motivoSemRetencao:retentionReason.trim(),
        itens:[],
      })
      if (saved.error) return setError(saved.error.message)
      setMessage('Inspeção encerrada sem retenção, com justificativa registrada.')
      await openInspection(selectedInspectionId)
      return
    }

    const newSelected=(selected as any[]).filter((link:any)=>
      !(detail.retained ?? []).some((x:any)=>x.produto_id===link.processo_itens.produto_id)
    )
    if (!newSelected.length) {
      setMessage('As amostras selecionadas já estão registradas no estoque.')
      return
    }

    const itens:any[]=[]
    for (const link of newSelected) {
      const item=link.processo_itens
      const draft=retentionRows[item.id]
      if (!draft?.qty || !draft.address.trim()) {
        return setError(`Informe quantidade e endereço para ${item.produtos?.nome ?? 'o produto'}.`)
      }
      if (!draft.photoFile) {
        return setError(`Escolha uma foto de cadastro para ${item.produtos?.nome ?? 'o produto'}.`)
      }

      const safe=draft.photoFile.name.replace(/[^a-zA-Z0-9._-]/g,'_')
      const photoPath=`${selectedInspectionId}/${item.produto_id}/${Date.now()}-${safe}`
      const upload=await supabase.storage.from('amostra-cadastro').upload(photoPath,draft.photoFile,{
        contentType:draft.photoFile.type||undefined,
      })
      if (upload.error) return setError(upload.error.message)

      itens.push({
        processoItemId:item.id,
        quantidade:Number(draft.qty),
        endereco:draft.address.trim(),
        fotoCadastroPath:photoPath,
      })
    }

    const saved=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/retencao`,{
      motivoSemRetencao:null,
      itens,
    })
    if (saved.error) return setError(saved.error.message)

    newSelected.forEach((link:any)=>{
      const draft=retentionRows[link.processo_itens.id]
      if (draft?.photoPreview) URL.revokeObjectURL(draft.photoPreview)
    })
    setMessage('Amostras enviadas ao estoque com foto de cadastro e laudo vinculado.')
    await loadApp()
    await openInspection(selectedInspectionId)
  }

  async function structureItVersion(itVersionId:string, openReview=true) {
    setItBusyId(itVersionId)
    setError('')
    const {data,error}=await supabase.functions.invoke('estruturar-it',{body:{it_versao_id:itVersionId}})
    setItBusyId(null)
    if (error || data?.error) {
      const msg=String(data?.message ?? error?.message ?? 'Falha na estruturação automática.')
      setError('Não foi possível estruturar a IT: '+msg)
      await loadApp()
      return false
    }
    setMessage(`IT estruturada: ${data?.checklist ?? 0} verificações, ${data?.dimensionais ?? 0} dimensionais e ${data?.testes ?? 0} testes. Revise antes de publicar.`)
    await loadApp()
    if (openReview) {
      const current=itVersions.find((x)=>x.id===itVersionId)
      if (current) await reviewItVersion({...current,status:'em_revisao',leitura_ia_status:'revisao'})
    }
    return true
  }

  async function structureCurrentInspectionIt() {
    if (!detail?.it_versao_id || !selectedInspectionId) return
    const inspectionId=selectedInspectionId
    const ok=await structureItVersion(detail.it_versao_id,false)
    if (!ok) return
    await openInspection(inspectionId)
    setMessage('IT estruturada e carregada nesta inspeção.')
  }

  async function reviewItVersion(it:ItVersion) {
    setItBusyId(it.id)
    const [checks,dims,tests,version]=await Promise.all([
      supabase.from('it_checklist').select('*').eq('it_versao_id',it.id).eq('ativo',true).order('ordem'),
      supabase.from('it_parametros_dimensionais').select('*').eq('it_versao_id',it.id).eq('ativo',true).order('ordem'),
      supabase.from('it_testes_especiais').select('*').eq('it_versao_id',it.id).eq('ativo',true).order('ordem'),
      supabase.from('it_versoes').select('extracao_ia').eq('id',it.id).single(),
    ])
    setItBusyId(null)
    setItReview({
      it,
      checklist:checks.data ?? [],
      dimensionais:dims.data ?? [],
      testes:tests.data ?? [],
      avisos:Array.isArray((version.data as any)?.extracao_ia?.avisos_revisao)
        ? (version.data as any).extracao_ia.avisos_revisao
        : [],
    })
  }

  async function publishItVersion(it:ItVersion) {
    if (!window.confirm(`Publicar ${it.instrucoes_trabalho?.codigo ?? 'IT'} versão ${it.versao}? Esta estrutura passará a ser usada nas novas inspeções.`)) return
    setItBusyId(it.id)
    const saved=await apiPost<any>(`/api/its/${it.id}/publicar`,{})
    setItBusyId(null)
    if (saved.error) return setError(saved.error.message)
    setItReview(null)
    setMessage('Versão da IT publicada e disponível para novas inspeções.')
    await loadApp()
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

    const registered=await apiPost<any>('/api/its/cadastrar',{
      codigo:itForm.codigo.trim(),
      titulo:itForm.titulo.trim(),
      versao:itForm.versao.trim(),
      vigencia:itForm.vigencia || null,
      arquivoNome:itFile.name,
      arquivoStoragePath:path,
      arquivoMime:itFile.type || null,
    })
    if (registered.error || !registered.data?.id) {
      return setError(registered.error?.message ?? 'Falha ao cadastrar IT.')
    }

    const structure=registered.data?.estrutura
    const structureError=registered.data?.estrutura_erro
    setItForm({ codigo: '', titulo: '', versao: '', vigencia: '' })
    setItFile(null)
    if (structureError) {
      setMessage('IT enviada, mas a estruturação automática precisa ser reprocessada.')
    } else {
      setMessage(`IT enviada e estruturada: ${structure?.checklist ?? 0} verificações, ${structure?.dimensionais ?? 0} dimensionais e ${structure?.testes ?? 0} testes.`)
    }
    await loadApp()
  }

  async function createSample(e: React.FormEvent) {
    e.preventDefault()
    if (!canWrite) return
    setError('')
    setMessage('')
    if (!sampleForm.groupId || !sampleForm.quantidade || !sampleForm.endereco) {
      return setError('Selecione a inspeção e informe quantidade e endereço.')
    }

    const created=await apiPost<any>('/api/amostras/criar',{
      groupId:sampleForm.groupId,
      descricao:sampleForm.descricao.trim() || null,
      lote:sampleForm.lote.trim() || null,
      quantidade:Number(sampleForm.quantidade),
      endereco:sampleForm.endereco.trim(),
      unidade:sampleForm.unidade,
    })
    if (created.error || !created.data?.id) return setError(created.error?.message ?? 'Falha ao criar amostra.')

    setMessage(`${created.data.codigo} criada e endereçada.`)
    setSampleForm({ groupId: '', descricao: '', lote: '', quantidade: '', endereco: '', unidade: 'conjunto' })
    await loadApp()
  }

  function sampleUrl(sample: Sample) {
    return `${window.location.origin}/?amostra=${sample.qr_token}`
  }

  async function downloadZpl(sample: Sample) {
    const url = sampleUrl(sample)
    const photoUrl=selectedSampleProductPhotoUrl || selectedSamplePhotoUrl
    const graphic=await imageUrlToGfa(photoUrl)
    const process=zplText(formatFst(sample.processo_referencia),26)
    const sku=zplText(sample.sku || 'SEM CÓDIGO',28)
    const product=zplText(sample.descricao || 'Produto sem descrição',48)
    const client=zplText(sample.cliente_referencia || '—',42)
    const date=zplText(formatDateBR(sample.data_inspecao_referencia || sample.data_chegada_referencia),18)
    const lot=zplText(sample.lote || '—',25)
    const zpl = `^XA
^PW800
^LL400
^CI28
^FO30,24^A0N,38,38^FD${process}^FS
^FO30,70^A0N,31,31^FDCÓD: ${sku}^FS
^FO30,111^A0N,25,25^FD${product}^FS
^FO30,158^A0N,23,23^FDCLIENTE: ${client}^FS
^FO30,197^A0N,23,23^FDDATA: ${date}^FS
^FO30,235^A0N,23,23^FDLOTE: ${lot}^FS
${graphic ? '^FO575,24'+graphic+'^FS' : ''}
^FO610,220^BQN,2,4^FDLA,${url}^FS
^FO30,325^A0N,18,18^FDQR: rastreabilidade da amostra no SGQ^FS
^XZ`
    const blob = new Blob([zpl], { type: 'text/plain;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `${sample.sku || 'produto'}-${String(sample.processo_referencia || 'processo').replace(/[^a-zA-Z0-9_-]/g,'_')}.zpl`
    a.click()
    URL.revokeObjectURL(href)
  }

  async function moveStock() {
    if (!selectedSample || !stockMove.quantidade) return
    const qty = Number(stockMove.quantidade)
    if (qty <= 0) return setError('Informe uma quantidade válida.')

    const moved=await apiPost<any>(`/api/estoque/${selectedSample.id}/movimentar`,{
      tipo:stockMove.tipo,
      quantidade:qty,
      endereco:stockMove.endereco.trim() || null,
      motivo:stockMove.motivo.trim() || null,
    })
    if (moved.error) return setError(moved.error.message)

    setStockMove({ tipo:'retirada', quantidade:'', endereco:'', motivo:'' })
    setSelectedSample(null)
    setMessage('Movimentação registrada.')
    await loadApp()
  }

  async function downloadInspectionWord() {
    if (!detail || !selectedInspectionId) return
    const generated=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/laudo`,{})
    if (generated.error) return setError(generated.error.message || 'Não foi possível gerar o laudo.')
    if (!generated.data?.url) return setError('O laudo foi gerado, mas a URL para download não ficou disponível.')

    const a=document.createElement('a')
    a.href=generated.data.url
    a.download=generated.data.filename || `${detail.numero}.doc`
    a.target='_blank'
    a.rel='noopener'
    a.click()
    setMessage('Laudo gerado e armazenado pelo backend.')
    await loadApp()
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

  if (!environment) {
    return (
      <main className="environment-shell">
        <section className="environment-picker">
          <div className="environment-heading">
            <div className="brand-mark"><ShieldCheck size={26}/><span>SGQ</span></div>
            <span className="eyebrow">SELECIONE O AMBIENTE</span>
            <h1>Onde você vai trabalhar?</h1>
            <p>O mesmo acesso da Qualidade atende os dois ambientes. Você pode trocar a qualquer momento.</p>
          </div>

          <div className="environment-grid">
            <button className="environment-card full" onClick={()=>{setTab('painel');setEnvironment('full')}}>
              <div className="environment-card-icon"><PackageSearch size={30}/></div>
              <div>
                <span className="environment-kicker">FULL</span>
                <h2>Full</h2>
                <p>Inspeções de recebimento, ITs, laudos e estoque de amostras.</p>
              </div>
              <ChevronRight size={24}/>
            </button>

            <button className="environment-card contlog" onClick={()=>setEnvironment('contlog')}>
              <div className="environment-card-icon"><ClipboardCheck size={30}/></div>
              <div>
                <span className="environment-kicker">CONTLOG</span>
                <h2>Contlog</h2>
                <p>Auditorias de campo e preenchimento dos RQs oficiais.</p>
              </div>
              <ChevronRight size={24}/>
            </button>
          </div>

          <div className="environment-user">
            <span>{profile.nome || 'Usuário'} · {profile.perfil}</span>
            <button type="button" onClick={()=>supabase.auth.signOut()}><LogOut size={16}/> Sair</button>
          </div>
        </section>
      </main>
    )
  }

  if (environment==='contlog') {
    return (
      <main className="app-shell environment-app contlog-environment">
        <header className="topbar environment-topbar">
          <div className="brand-mark"><ClipboardCheck size={24}/><span>SGQ · CONTLOG</span></div>
          <div className="environment-badge">Auditorias</div>
          <div className="userbox">
            <span>{profile.nome || 'Usuário'} · {profile.perfil}</span>
            <button type="button" onClick={()=>setEnvironment(null)}>Trocar ambiente</button>
            <button title="Sair" onClick={()=>supabase.auth.signOut()}><LogOut size={18}/></button>
          </div>
        </header>
        <AuditoriasPage profileName={profile.nome}/>
      </main>
    )
  }

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
          <button type="button" onClick={()=>setEnvironment(null)}>Trocar ambiente</button>
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
                  <strong>{formatFst(i.grupos_inspecao?.processos?.codigo)} · Recebimento {formatDateBR(i.grupos_inspecao?.processos?.chegada_cd || i.grupos_inspecao?.processos?.data_processo)}</strong>
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
                            <input value={row.sku} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,sku:e.target.value,omieStatus:'',omieMessage:''}:r))} onBlur={()=>lookupProduct(i)} placeholder="Código Omie"/>
                            <button type="button" className="secondary icon-only" title="Consultar no OMIE" onClick={()=>lookupProduct(i)}><Search size={16}/></button>
                          </div>
                        </label>
                        <label>Descrição
                          <input value={row.nome} readOnly placeholder="Preenchida pelo OMIE"/>
                          {row.omieStatus==='loading' && <small className="field-status">{row.omieMessage || 'Consultando OMIE…'}</small>}
                          {row.omieStatus==='found' && <small className="field-status ok">{row.omieMessage || 'Produto confirmado no OMIE'}</small>}
                          {row.omieStatus==='not_found' && <small className="field-status bad">{row.omieMessage || 'Código não encontrado no OMIE'}</small>}
                          {row.omieStatus==='not_configured' && <small className="field-status warn">{row.omieMessage || 'Integração OMIE não configurada'}</small>}
                          {row.omieStatus==='error' && <small className="field-status bad">{row.omieMessage || 'Falha ao consultar o OMIE'}</small>}
                        </label>
                        <label>Lote<input value={row.lote} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,lote:e.target.value}:r))}/></label>
                        <label>Material<input value={row.material} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,material:e.target.value}:r))}/></label>
                        <label>Capacidade<input value={row.capacidade} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,capacidade:e.target.value}:r))}/></label>
                        <label>Quantidade recebida<input type="number" min="0.01" step="0.01" value={row.quantidade} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,quantidade:e.target.value}:r))}/></label>
                        <label>Quantidade padrão por caixa (opcional)<input type="number" min="0.01" step="0.01" value={row.quantidadePorCaixa} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,quantidadePorCaixa:e.target.value}:r))}/></label>
                        <label>Caixas recebidas<input type="number" min="0.01" step="0.01" value={row.caixasRecebidas} onChange={(e)=>{
                          const received=e.target.value
                          const calc=received ? String(boxesToInspect(Number(received))) : ''
                          setSkuRows(skuRows.map((r,j)=>j===i?{...r,caixasRecebidas:received,caixasInspecionadas:calc}:r))
                        }}/></label>
                        <label>Caixas inspecionadas<input type="number" min="0.01" step="0.01" value={row.caixasInspecionadas} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,caixasInspecionadas:e.target.value}:r))}/><small className="field-hint">Sugerido pela tabela da IT; pode ser alterado.</small></label>
                        <label className="span-2">Distribuição real das caixas (quando houver caixas fracionadas)
                          <input value={row.distribuicaoCaixas} placeholder="Ex.: 44x136 + 1x49 + 1x60" onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,distribuicaoCaixas:e.target.value}:r))}/>
                          {row.distribuicaoCaixas && (()=>{const d=parseBoxDistribution(row.distribuicaoCaixas); const mismatch=d.valid && (d.boxes!==Number(row.caixasRecebidas) || Math.abs(d.units-Number(row.quantidade))>0.0001); return <small className={'field-status '+(!d.valid||mismatch?'bad':'ok')}>{!d.valid?d.error:`${d.boxes} caixa(s) · ${d.units.toLocaleString('pt-BR')} unidades${mismatch?' — confira com os totais informados.':' — conferência fechada.'}`}</small>})()}
                        </label>
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
              <button className="secondary" type="button" onClick={()=>setInspectionChatOpen(true)}>
                <MessageCircle size={16}/> Modo chat
              </button>
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

          <section className="inspection-assistant-strip">
            <div className="assistant-strip-copy">
              <Sparkles size={17}/>
              <div>
                <strong>IA assistida</strong>
                <span>Acompanha o que já foi registrado e orienta o próximo passo sem alterar decisões ou cálculos.</span>
              </div>
            </div>
            <button className="secondary small" type="button" onClick={()=>{
              setAssistantOpen(true)
              if (!assistantText) void runInspectionAssistant('analisar')
            }}>
              <MessageCircle size={15}/> Abrir assistente
            </button>
          </section>

          <section className="panel section-card internal-note-panel">
            <div className="section-title">
              <div>
                <h2>Observação interna</h2>
                <span className="section-note">Uso interno da Qualidade. Esta informação não é incluída no laudo nem no Word da inspeção.</span>
              </div>
              <span className="pill">Somente SGQ</span>
            </div>
            <textarea
              value={internalObservation}
              onChange={(e)=>setInternalObservation(e.target.value)}
              rows={3}
              placeholder="Ex.: alinhamento interno, pendência de retorno do fornecedor, orientação para próxima inspeção..."
              disabled={!canWrite}
            />
            {canWrite && <div className="actions"><button className="secondary" type="button" onClick={()=>void saveInternalObservation()}>Salvar observação interna</button></div>}
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
              {!detail.checklist?.length && (
                <div className="empty">
                  <strong>Checklist ainda não carregado para esta inspeção.</strong>
                  <span>A IT pode ser estruturada agora sem recriar a inspeção nem perder os dados já registrados.</span>
                  {detail.it_versao_id && detail.status!=='concluida' && (
                    <button
                      type="button"
                      className="secondary small"
                      disabled={itBusyId===detail.it_versao_id}
                      onClick={()=>void structureCurrentInspectionIt()}
                    >
                      {itBusyId===detail.it_versao_id?'Estruturando IT…':'Estruturar IT agora'}
                    </button>
                  )}
                </div>
              )}
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
                            <label>Referência da medida
                              <select value={cfg.tipo_referencia ?? p.tipo_referencia ?? ''} onChange={(e)=>saveDimConfig(item.id,p,{tipo_referencia:e.target.value})} disabled={detail.status==='concluida'}>
                                <option value="">Selecionar</option>
                                <option value="interno">Interno</option>
                                <option value="externo">Externo</option>
                                <option value="desenho">Desenho técnico</option>
                                <option value="logo">Logo / arte</option>
                                <option value="amostra_padrao">Amostra padrão</option>
                                <option value="especificacao_cliente">Especificação do cliente</option>
                                <option value="outro">Outro</option>
                              </select>
                            </label>
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
              <div><h2>Fotos da inspeção</h2><span className="section-note">Opcional nesta fase de testes. As fotos continuam concentradas nesta etapa da inspeção.</span></div>
              <span className="pill">{detail.photos?.length ?? 0} enviada(s)</span>
            </div>

            {detail.status!=='concluida' && (
              <>
                <label className="upload-box"><Camera size={22}/><span>Selecionar fotos finais</span><input type="file" accept="image/*" multiple onChange={(e)=>addPendingPhotos(e.target.files)}/></label>
                {!!pendingPhotos.length && <div className="pending-photo-grid">
                  {pendingPhotos.map((p)=>(
                    <article className="photo-card" key={p.id}>
                      <img src={p.url} alt="Prévia"/>
                      <label>Legenda<input value={p.legenda} onChange={(e)=>setPendingPhotos((old)=>old.map((x)=>x.id===p.id?{...x,legenda:e.target.value}:x))} placeholder="Ex.: Tampa com risco na lateral"/></label>
                      <label>Usar também como identificação do produto
                        <select value={p.productId} onChange={(e)=>setPendingPhotos((old)=>old.map((x)=>x.id===p.id?{...x,productId:e.target.value}:x))}>
                          <option value="">Não usar como foto principal</option>
                          {(detail.items ?? []).map((link:any)=>(
                            <option key={link.processo_itens.produto_id} value={link.processo_itens.produto_id}>
                              {link.processo_itens.produtos?.sku} · {link.processo_itens.produtos?.nome}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!!p.productId && <span className="product-id-photo-tag">ID do produto</span>}
                      <button className="secondary small" type="button" onClick={()=>removePendingPhoto(p.id)}>Remover</button>
                    </article>
                  ))}
                </div>}
                {!!pendingPhotos.length && <div className="actions"><button className="primary" type="button" onClick={uploadInspectionPhotos}>Enviar fotos finais</button></div>}
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
                const draft=retentionRows[item.id] || {retain:true,qty:'',address:'',photoFile:null,photoPreview:''}
                return (
                  <div className="retention-row" key={item.id}>
                    <label className="switch-line">
                      <input type="checkbox" checked={existing?true:draft.retain} disabled={!!existing} onChange={(e)=>setRetentionRows({...retentionRows,[item.id]:{...draft,retain:e.target.checked}})}/>
                      <span>{item.produtos?.sku} · {item.produtos?.nome}</span>
                    </label>
                    {!existing && draft.retain && <>
                      <label>Quantidade<input type="number" min="0.01" step="0.01" value={draft.qty} onChange={(e)=>setRetentionRows({...retentionRows,[item.id]:{...draft,qty:e.target.value}})}/></label>
                      <label>Endereço<input value={draft.address} onChange={(e)=>setRetentionRows({...retentionRows,[item.id]:{...draft,address:e.target.value}})} placeholder="Ex.: ARM 03 ou INSPEÇÃO"/></label>
                      <label className="retention-photo-field">Foto de cadastro
                        <input type="file" accept="image/*" onChange={(e)=>{
                          const file=e.target.files?.[0] ?? null
                          if (draft.photoPreview) URL.revokeObjectURL(draft.photoPreview)
                          setRetentionRows({
                            ...retentionRows,
                            [item.id]:{
                              ...draft,
                              photoFile:file,
                              photoPreview:file?URL.createObjectURL(file):'',
                            },
                          })
                        }}/>
                      </label>
                      {draft.photoPreview && <img className="retention-photo-preview" src={draft.photoPreview} alt="Foto de cadastro da amostra"/>}
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

      {inspectionChatOpen && tab==='execucao' && detail && userId && (
        <InspectionChat
          inspectionId={detail.id}
          detail={detail}
          userId={userId}
          onClose={()=>{
            setInspectionChatOpen(false)
            if (selectedInspectionId) void openInspection(selectedInspectionId)
          }}
          onChanged={async()=>{
            if (selectedInspectionId) await openInspection(selectedInspectionId)
          }}
        />
      )}

      {assistantOpen && tab==='execucao' && detail && (
        <div className="modal-backdrop assistant-backdrop" onClick={()=>setAssistantOpen(false)}>
          <aside className="inspection-assistant-panel" onClick={(e)=>e.stopPropagation()}>
            <div className="assistant-panel-head">
              <div>
                <span className="eyebrow">IA ASSISTIDA</span>
                <h2>Assistente da inspeção</h2>
                <p>{detail.numero} · {detail.it_versoes?.instrucoes_trabalho?.codigo || 'IT'}</p>
              </div>
              <button className="close" type="button" onClick={()=>setAssistantOpen(false)}>×</button>
            </div>

            <div className="assistant-actions">
              <button className="primary" type="button" disabled={assistantLoading} onClick={()=>runInspectionAssistant('analisar')}>
                <Sparkles size={16}/>{assistantLoading?'Analisando…':'Analisar andamento'}
              </button>
            </div>

            <div className="assistant-answer">
              {assistantLoading && <div className="assistant-loading">Lendo o estado atual da inspeção…</div>}
              {!assistantLoading && assistantText && <div className="assistant-text">{assistantText}</div>}
              {!assistantLoading && !assistantText && <div className="assistant-empty">Abra a análise para receber orientação sobre pendências e próximo passo.</div>}
            </div>

            <div className="assistant-question">
              <label>Pergunte sobre esta inspeção
                <textarea rows={3} value={assistantQuestion} onChange={(e)=>setAssistantQuestion(e.target.value)} placeholder="Ex.: o que ainda falta antes de finalizar?"/>
              </label>
              <button className="secondary wide" type="button" disabled={assistantLoading || !assistantQuestion.trim()} onClick={()=>runInspectionAssistant('pergunta')}>
                <MessageCircle size={15}/> Perguntar
              </button>
            </div>

            <div className="assistant-disclaimer">
              A IA orienta com base nos dados registrados e na IT vinculada. Amostragem, Ac/Re e decisão final continuam controlados pelo SGQ e pelo inspetor.
            </div>
          </aside>
        </div>
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
                <label className="span-2">Word ou PDF<input type="file" accept=".docx,.pdf" onChange={(e)=>setItFile(e.target.files?.[0] ?? null)}/></label>
              </div>
              <div className="actions"><button className="primary" type="submit" disabled={!itFile}><Upload size={17}/> Enviar para leitura</button></div>
            </form>
          )}
          <div className="list">
            {itVersions.map((it)=>(
              <article className="row-card it-row" key={it.id}>
                <div>
                  <strong>{it.instrucoes_trabalho?.codigo} · {it.instrucoes_trabalho?.titulo}</strong>
                  <span>Versão {it.versao}{it.arquivo_nome?' · '+it.arquivo_nome:''}</span>
                </div>
                <div className="row-actions">
                  <span className="pill">{it.leitura_ia_status.replaceAll('_',' ')}</span>
                  {canManageIts && ['nao_iniciada','aguardando','erro'].includes(it.leitura_ia_status) && (
                    <button className="secondary small" disabled={itBusyId===it.id} onClick={()=>structureItVersion(it.id)}>
                      {itBusyId===it.id?'Lendo…':'Estruturar com IA'}
                    </button>
                  )}
                  {['revisao','publicada'].includes(it.leitura_ia_status) && (
                    <button className="secondary small" disabled={itBusyId===it.id} onClick={()=>reviewItVersion(it)}>
                      Revisar estrutura
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {itReview && (
        <div className="modal-backdrop" onClick={()=>setItReview(null)}>
          <article className="sample-detail it-review-modal" onClick={(e)=>e.stopPropagation()}>
            <button className="close" type="button" onClick={()=>setItReview(null)}>×</button>
            <span className="eyebrow">REVISÃO DA ESTRUTURA</span>
            <h2>{itReview.it.instrucoes_trabalho?.codigo} · {itReview.it.instrucoes_trabalho?.titulo}</h2>
            <p>Versão {itReview.it.versao}</p>

            {!!itReview.avisos.length && <div className="alert error">
              <b>Revisar:</b> {itReview.avisos.join(' · ')}
            </div>}

            <div className="it-review-section">
              <h3>Verificações C / NC / NA <span>{itReview.checklist.length}</span></h3>
              {itReview.checklist.map((x:any)=><div className="it-review-row" key={x.id}><b>{x.ordem}</b><div><strong>{x.requisito}</strong><span>{x.instrucao || '—'}</span></div></div>)}
              {!itReview.checklist.length && <div className="empty">Nenhuma verificação extraída.</div>}
            </div>

            <div className="it-review-section">
              <h3>Dimensionais <span>{itReview.dimensionais.length}</span></h3>
              {itReview.dimensionais.map((x:any)=><div className="it-review-row" key={x.id}><b>{x.ordem}</b><div><strong>{x.nome}{x.unidade?' · '+x.unidade:''}</strong><span>{x.observacao || 'Sem observação específica.'}</span></div></div>)}
              {!itReview.dimensionais.length && <div className="muted">A IT não trouxe parâmetros dimensionais estruturáveis.</div>}
            </div>

            <div className="it-review-section">
              <h3>Testes especiais <span>{itReview.testes.length}</span></h3>
              {itReview.testes.map((x:any)=><div className="it-review-row" key={x.id}><b>{x.ordem}</b><div><strong>{x.nome}</strong><span>{x.procedimento || '—'}</span></div></div>)}
              {!itReview.testes.length && <div className="muted">Nenhum teste especial extraído.</div>}
            </div>

            <div className="result-actions">
              <button className="secondary" type="button" disabled={itBusyId===itReview.it.id} onClick={()=>structureItVersion(itReview.it.id)}>
                Reprocessar leitura
              </button>
              {itReview.it.status!=='publicada' && <button className="primary" type="button" disabled={itBusyId===itReview.it.id} onClick={()=>publishItVersion(itReview.it)}>
                Publicar versão
              </button>}
            </div>
          </article>
        </div>
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
            <article><span>Endereços</span><strong>{stockStats.enderecos}</strong><small>locais físicos cadastrados</small></article>
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
                  <span><b className="stock-mobile-label">Endereço</b><i className="location-badge">{s.endereco || '—'}</i></span>
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
                  <div>
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

                {(selectedSamplePhotoUrl || selectedSampleReport || selectedSample.inspecao_id) && (
                  <div className="stock-detail-section stock-origin-section">
                    <h3>Origem da retenção</h3>
                    {selectedSampleProductPhotoUrl && <img className="stock-registration-photo" src={selectedSampleProductPhotoUrl} alt="Foto principal do produto"/>}
                    {!selectedSampleProductPhotoUrl && selectedSamplePhotoUrl && <img className="stock-registration-photo" src={selectedSamplePhotoUrl} alt="Foto de cadastro da amostra"/>}
                    <div className="stock-origin-actions">
                      {selectedSampleReport?.url && <a className="secondary stock-link-button" href={selectedSampleReport.url} target="_blank" rel="noreferrer"><FileText size={15}/> Abrir laudo</a>}
                      {selectedSampleReport && !selectedSampleReport.url && <button className="secondary" type="button" onClick={()=>selectedSample.inspecao_id && openInspection(selectedSample.inspecao_id)}><FileText size={15}/> {selectedSampleReport.numero}</button>}
                      {!selectedSampleReport && selectedSample.inspecao_id && <button className="secondary" type="button" onClick={()=>openInspection(selectedSample.inspecao_id!)}><ClipboardCheck size={15}/> Abrir inspeção</button>}
                    </div>
                  </div>
                )}

                {(selectedSamplePhotoUrl || selectedSample.inspecao_id || selectedSampleReport) && (
                  <div className="stock-detail-section stock-origin-section">
                    <div>
                      <h3>Origem da retenção</h3>
                      <p className="stock-origin-copy">
                        {selectedSample.inspecao_id
                          ? 'Amostra gerada a partir de uma inspeção do SGQ.'
                          : 'Registro histórico importado, sem inspeção vinculada.'}
                      </p>
                    </div>
                    {selectedSamplePhotoUrl && (
                      <img className="stock-registration-photo" src={selectedSamplePhotoUrl} alt="Foto de cadastro da amostra"/>
                    )}
                    <div className="stock-origin-actions">
                      {selectedSample.inspecao_id && (
                        <button className="secondary" type="button" onClick={()=>{
                          const id=selectedSample.inspecao_id!
                          setSelectedSample(null)
                          void openInspection(id)
                        }}>
                          <ClipboardCheck size={15}/> Abrir inspeção
                        </button>
                      )}
                      {selectedSampleReport?.url && (
                        <a className="secondary stock-link-button" href={selectedSampleReport.url} target="_blank" rel="noreferrer">
                          <FileText size={15}/> Abrir laudo {selectedSampleReport.numero}
                        </a>
                      )}
                      {selectedSampleReport && !selectedSampleReport.url && (
                        <span className="stock-report-pending">Laudo {selectedSampleReport.numero} vinculado, arquivo ainda não gerado.</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="stock-detail-section stock-label-section">
                  <div>
                    <h3>Etiqueta</h3>
                    <p>QR para abrir este registro no SGQ.</p>
                  </div>
                  {qrDataUrl && <img className="qr" src={qrDataUrl} alt="QR"/>}
                  <button className="secondary wide" onClick={()=>void downloadZpl(selectedSample)}><QrCode size={16}/> Gerar etiqueta Zebra 100×50</button>
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

            <div className="nc-photo-deferred">
              <Camera size={18}/>
              <span>A foto não é cadastrada aqui. As evidências serão adicionadas juntas na etapa final da inspeção.</span>
            </div>

            <button className="danger wide" type="submit">Registrar NC</button>
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
