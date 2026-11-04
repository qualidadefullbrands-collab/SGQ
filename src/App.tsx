import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Boxes, Camera, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Copy, Edit3, RefreshCw, FileDown, FileText, LogOut, PackageSearch, Play, Plus, QrCode, Search, ShieldCheck, Sparkles, Trash2, Upload, Warehouse, Wrench, LayoutDashboard, BarChart3, CloudOff, CloudUpload, X } from 'lucide-react'
import { apiGet, apiPost, apiPut, apiUrl, supabase, authClient } from './lib/supabase'
import {useEquipmentList,equipmentFit} from './equipamentos/equipmentData'
import {saveOfflineDraft,readOfflineDraft,clearOfflineDraft,enqueueOfflineOperation,offlineOperations,connectionFailure} from './lib/offline'
import {replayOfflineOperations,offlineInspectionVersion} from './lib/offlineSync'

const AuditoriasPage=lazy(()=>import('./auditorias/AuditoriasPage'))
const EquipmentPage=lazy(()=>import('./equipamentos/EquipmentPage'))
// Canonical production target: password emails must never redirect to localhost.
const RECOVERY_REDIRECT_URL = 'https://app-sgq.onrender.com/?auth=recovery'
const ItEditorDemo=lazy(()=>import('./its/ItEditorDemo'))
const MobileFotos=lazy(()=>import('./mobile/MobileFotos'))
const InsightsPage=lazy(()=>import('./insights/InsightsPage'))

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
  parametros_amostragem?: {lote_sequencial?:string|null;ordem_produto?:number;total_produtos?:number;produto_codigo?:string}|null
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
  codigoCliente: '',
  quantidadePv: '',
  numeroPedidoPv: '',
  fstPv: '',
  lote: '',
  material: '',
  capacidade: '',
  quantidade: '',
  quantidadePorCaixa: '',
  caixasRecebidas: '',
  caixasInspecionadas: '',
  distribuicaoCaixas: '',
  caixasPadrao: '',
  unidadesPadrao: '',
  caixasFracionadas: '',
  unidadesFracionadas: '',
  caixasLaboratorio: '',
  unidadesLaboratorio: '',
  unidadesPorConjunto: '1',
  fotoFile: null as File | null,
  fotoPreview: '',
  fotoPrincipalPath: '',
  omieStatus: '' as '' | 'loading' | 'found' | 'not_found' | 'not_configured' | 'error',
  omieMessage: '',
  omieSourceFst: '',
  omieSourcePedido: '',
  suggestions: [] as Array<{sku:string;nome:string;origem?:string}>,
  suggesting: false,
})

// Canonical FST key: 26169-A and 26169-B are different Omie projects.
type OmieOrderItem={sku:string;descricao:string;quantidade:number}
type OmieOrder={codigoPedido:number;numeroPedido:string;quantidadeItens:number}
type OmieSkuImport={codigo:string;numeroPedido:string;itens:OmieOrderItem[]}
type OmieSkuReviewLine={sku:string;descricao:string;quantidadePedido:number;quantidadeInformada:string}
type OmieSkuReview={codigo:string;numeroPedido:string;itens:OmieSkuReviewLine[]}
function skuRowHasData(row:ReturnType<typeof emptySku>){
  return Boolean(row.sku.trim()||row.nome.trim()||row.codigoCliente.trim()||row.lote.trim()||row.material.trim()||
    row.capacidade.trim()||row.quantidade.trim()||row.quantidadePorCaixa.trim()||
    row.caixasRecebidas.trim()||row.caixasInspecionadas.trim()||row.caixasPadrao.trim()||
    row.caixasFracionadas.trim()||row.caixasLaboratorio.trim()||row.unidadesLaboratorio.trim()||
    row.unidadesPadrao.trim()||row.unidadesFracionadas.trim()||row.fotoFile)
}
// Review first; only apply the Omie quantities to the inspection after the popup closes.
function prepareOmieSkuReview(suggestion:OmieSkuImport,rows:ReturnType<typeof emptySku>[]):OmieSkuReview {
  const existing=new Map<string,ReturnType<typeof emptySku>[]>()
  for(const row of rows){
    const key=row.sku.trim().toUpperCase()
    if(!key)continue
    const same=existing.get(key)||[]
    same.push(row)
    existing.set(key,same)
  }
  return {codigo:suggestion.codigo,numeroPedido:suggestion.numeroPedido,
    itens:suggestion.itens.map(item=>{
      const same=existing.get(item.sku.trim().toUpperCase())||[]
      return {
        sku:item.sku,descricao:item.descricao,quantidadePedido:item.quantidade,
        // For an existing single SKU, default to what the operator already typed.
        quantidadeInformada:same.length===1&&same[0].quantidade.trim()!==''?
          same[0].quantidade:String(item.quantidade)
      }
    })
  }
}
function validOmieSkuReview(review:OmieSkuReview){
  return review.itens.length>0 && review.itens.every(item=>{
    const value=item.quantidadeInformada.trim()
    return value!==''&&Number.isFinite(Number(value))&&Number(value)>=0
  })
}
function applyOmieReviewedRows(rows:ReturnType<typeof emptySku>[],review:OmieSkuReview){
  const result=rows.filter(skuRowHasData).map(row=>({...row}))
  const matches=new Map<string,number[]>()
  for(let i=0;i<result.length;i++){
    const sku=result[i].sku.trim().toUpperCase()
    if(!sku)continue
    const indexes=matches.get(sku)||[]
    indexes.push(i);matches.set(sku,indexes)
  }
  for(const item of review.itens){
    const code=item.sku.trim().toUpperCase()
    const indices=matches.get(code)||[]
    // Never overwrite multiple lot rows with one order total (which would duplicate units).
    if(indices.length>1){
      // Lot quantities must not change, but the original PV snapshot belongs
      // to the SKU as a whole and is retained on one of its lot records.
      const first=result[indices[0]]
      result[indices[0]]={...first,quantidadePv:String(item.quantidadePedido),
        numeroPedidoPv:review.numeroPedido,fstPv:review.codigo}
      continue
    }
    const amount=item.quantidadeInformada.trim()
    if(indices.length===1){
      const i=indices[0],old=result[i]
      result[i]={...old,quantidade:amount,nome:old.nome.trim()||item.descricao,
        quantidadePv:String(item.quantidadePedido),numeroPedidoPv:review.numeroPedido,fstPv:review.codigo,
        omieSourceFst:review.codigo,omieSourcePedido:review.numeroPedido}
    }else{
      const i=result.length
      result.push({...emptySku(),sku:code,nome:item.descricao,quantidade:amount,
        quantidadePv:String(item.quantidadePedido),numeroPedidoPv:review.numeroPedido,fstPv:review.codigo,
        omieSourceFst:review.codigo,omieSourcePedido:review.numeroPedido,
        omieStatus:'found',omieMessage:'PV '+review.numeroPedido+' · confirme o recebimento físico.'})
      matches.set(code,[i])
    }
  }
  return result.length?result:[emptySku()]
}
function fstCode(value: string | null | undefined) {
  const raw=String(value ?? '').trim().toUpperCase().replace(/[–—]/g,'-')
  if (!raw || /^TMP-/.test(raw)) return ''
  return raw.replace(/^FST[\s-]*/,'').replace(/\s+/g,'')
}
function formatFst(value: string | null | undefined) {
  const raw=String(value ?? '').trim()
  if (!raw) return '—'
  if (/^TMP-/i.test(raw)) return 'Sem FST'
  const code=fstCode(raw)
  return code ? 'FST'+code : raw
}
function inspectionDisplay(row:{grupos_inspecao?:{processos?:{codigo?:string|null;cliente?:string|null}|null}|null}) {
  const p=row.grupos_inspecao?.processos
  return formatFst(p?.codigo)+' - '+(p?.cliente?.trim()||'Cliente não informado')
}
function formatDateBR(value: string | null | undefined) {
  if (!value) return '—'
  const raw=String(value).slice(0,10)
  const [y,m,d]=raw.split('-')
  return y && m && d ? `${d}/${m}/${y}` : raw
}
function toggleTransport(current: string, mode: 'Aéreo' | 'Marítimo') {
  return current===mode ? '' : mode
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

// Storage groups are physical boxes remaining in operation; lab takes units, not another box.
function laboratoryUnits(row:any) {
  const units=Number(row.unidadesLaboratorio)||0
  const legacyLabBoxes=Number(row.caixasLaboratorio)||0
  return Math.max(0,legacyLabBoxes>0?legacyLabBoxes*units:units)
}

function boxGroupsFromRow(row:any) {
  const groups:Array<{tipo:string;caixas:number;unidades:number}>=[]
  const add=(tipo:string,caixasRaw:any,unidadesRaw:any)=>{
    const caixas=Number(caixasRaw)||0
    const unidades=Number(unidadesRaw)||0
    if(caixas>0 && unidades>0) groups.push({tipo,caixas,unidades})
  }
  add('padrao',row.caixasPadrao,row.unidadesPadrao || row.quantidadePorCaixa)
  add('fracionada',row.caixasFracionadas,row.unidadesFracionadas)
  const lab=laboratoryUnits(row)
  if(lab>0) groups.push({tipo:'laboratorio',caixas:0,unidades:lab})
  if (!groups.length && row.distribuicaoCaixas) {
    const legacy=parseBoxDistribution(row.distribuicaoCaixas)
    if(legacy.valid) return legacy.groups.map((g:any,i:number)=>({...g,tipo:i===0?'padrao':'fracionada'}))
  }
  return groups
}

function boxDistributionTotals(row:any) {
  const groups=boxGroupsFromRow(row)
  const storage=groups.filter(g=>g.tipo!=='laboratorio')
  const units=storage.reduce((sum,g)=>sum+g.caixas*g.unidades,0)
  const boxes=storage.reduce((sum,g)=>sum+g.caixas,0)
  const labUnits=groups.filter(g=>g.tipo==='laboratorio')
    .reduce((sum,g)=>sum+(g.caixas>0?g.caixas*g.unidades:g.unidades),0)
  return {
    groups,boxes,units,labUnits,totalUnits:units+labUnits,
    expression:storage.map(g=>`${g.caixas}×${g.unidades}`).join(' + '),
  }
}

function updateBoxDistributionField(row:any,key:string,value:string) {
  // 'Quantidade por caixa' is the operational standard-box quantity.
  if(key==='unidadesPadrao')return {...row,unidadesPadrao:value,quantidadePorCaixa:value}
  return {...row,[key]:value}
}

function setLaboratoryUnits(row:any,value:string) {
  const next={...row,caixasLaboratorio:'',unidadesLaboratorio:value}
  const received=Number(row.quantidade)
  const retained=Number(value)
  const standardBoxes=Number(row.caixasPadrao)
  const fractions=Number(row.caixasFracionadas)
  // Only derive the remaining standard box contents when there is exactly one
  // storage group; for mixed/fractured boxes the operator must specify each.
  if(received>0 && retained>=0 && retained<=received &&
     standardBoxes>0 && fractions===0 && Number.isFinite(received) && Number.isFinite(retained)) {
    const perBox=(received-retained)/standardBoxes
    const rounded=Math.round(perBox*100)/100
    if(rounded>0 && Math.abs(perBox-rounded)<0.000001)
      return {...next,unidadesPadrao:String(rounded),quantidadePorCaixa:String(rounded)}
  }
  return next
}

function applyBoxGroupsToSku(base:any, groups:any[]|null|undefined) {
  const next={...base}
  for (const g of groups ?? []) {
    const tipo=String(g?.tipo ?? g?.Tipo ?? '').toLowerCase()
    const caixas=Number(g?.caixas ?? g?.Caixas ?? 0)
    const unidades=Number(g?.unidades ?? g?.Unidades ?? 0)
    if (tipo==='padrao') {
      next.caixasPadrao=String(caixas)
      next.unidadesPadrao=String(unidades)
      next.quantidadePorCaixa=String(unidades)
    } else if (tipo==='fracionada') {
      next.caixasFracionadas=String(caixas)
      next.unidadesFracionadas=String(unidades)
    } else if (tipo==='laboratorio' || tipo==='retida' || tipo==='retencao') {
      // Historical records used `Caixas × Unidades`; preserve their quantity
      // when opening them in the new unit-only laboratory field.
      const total=caixas>0?caixas*unidades:unidades
      next.unidadesLaboratorio=String((Number(next.unidadesLaboratorio)||0)+total)
      next.caixasLaboratorio=''
    } else if (!next.caixasPadrao) {
      next.caixasPadrao=String(caixas)
      next.unidadesPadrao=String(unidades)
      next.quantidadePorCaixa=String(unidades)
    } else if (!next.caixasFracionadas) {
      next.caixasFracionadas=String(caixas)
      next.unidadesFracionadas=String(unidades)
    } else {
      next.unidadesLaboratorio=String((Number(next.unidadesLaboratorio)||0)+(caixas>0?caixas*unidades:unidades))
      next.caixasLaboratorio=''
    }
  }
  return next
}

function retentionQuantityFromText(value:string|null|undefined) {
  const text=String(value ?? '').replace(/\s+/g,' ').trim()
  if (!text) return null
  const patterns=[
    /(?:reter|retida|retido|reten[cç][aã]o|laborat[oó]rio)[^0-9]{0,30}(\d+(?:[.,]\d+)?)/i,
    /(\d+(?:[.,]\d+)?)\s*(?:un\.?|unidades?)?[^.]{0,45}(?:reter|retida|retido|reten[cç][aã]o|laborat[oó]rio)/i,
  ]
  for (const pattern of patterns) {
    const match=text.match(pattern)
    if (!match) continue
    const qty=Number(String(match[1]).replace(',','.'))
    if (Number.isFinite(qty) && qty>0) return qty
  }
  return null
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
  { min:2,max:8,I:'A',II:'A',III:'B',S1:'A',S2:'A',S3:'A',S4:'A' },
  { min:9,max:15,I:'A',II:'B',III:'C',S1:'A',S2:'A',S3:'A',S4:'A' },
  { min:16,max:25,I:'B',II:'C',III:'D',S1:'A',S2:'A',S3:'B',S4:'B' },
  { min:26,max:50,I:'C',II:'D',III:'E',S1:'A',S2:'B',S3:'B',S4:'C' },
  { min:51,max:90,I:'C',II:'E',III:'F',S1:'B',S2:'B',S3:'C',S4:'C' },
  { min:91,max:150,I:'D',II:'F',III:'G',S1:'B',S2:'B',S3:'C',S4:'D' },
  { min:151,max:280,I:'E',II:'G',III:'H',S1:'B',S2:'C',S3:'D',S4:'E' },
  { min:281,max:500,I:'F',II:'H',III:'J',S1:'B',S2:'C',S3:'D',S4:'E' },
  { min:501,max:1200,I:'G',II:'J',III:'K',S1:'C',S2:'C',S3:'E',S4:'F' },
  { min:1201,max:3200,I:'H',II:'K',III:'L',S1:'C',S2:'D',S3:'E',S4:'G' },
  { min:3201,max:10000,I:'J',II:'L',III:'M',S1:'C',S2:'D',S3:'F',S4:'H' },
  { min:10001,max:35000,I:'K',II:'M',III:'N',S1:'C',S2:'D',S3:'F',S4:'J' },
  { min:35001,max:150000,I:'L',II:'N',III:'P',S1:'D',S2:'E',S3:'G',S4:'K' },
  { min:150001,max:500000,I:'M',II:'P',III:'Q',S1:'D',S2:'E',S3:'G',S4:'L' },
  { min:500001,max:Number.MAX_SAFE_INTEGER,I:'N',II:'Q',III:'R',S1:'D',S2:'E',S3:'H',S4:'M' },
]
const SAMPLE_SIZE: Record<string,number> = { A:2,B:3,C:5,D:8,E:13,F:20,G:32,H:50,J:80,K:125,L:200,M:315,N:500,P:800,Q:1250,R:2000 }
const AC_RE_15: Record<string,{ac:number;re:number}> = {
  A:{ac:0,re:1},B:{ac:0,re:1},C:{ac:0,re:1},D:{ac:0,re:1},E:{ac:0,re:1},
  F:{ac:1,re:2},G:{ac:1,re:2},H:{ac:2,re:3},J:{ac:3,re:4},K:{ac:5,re:6},
  L:{ac:7,re:8},M:{ac:10,re:11},N:{ac:14,re:15},P:{ac:21,re:22},
  Q:{ac:21,re:22},R:{ac:21,re:22}
}
function samplingPlan(lot:number, level:string) {
  if (!lot) return { code:'', sample:0, ac:null as number|null, re:null as number|null }
  const row=LOT_CODES.find((x)=>lot>=x.min&&lot<=x.max)
  const code=row ? String((row as any)[level] ?? row.I) : ''
  const planned=SAMPLE_SIZE[code] ?? 0
  const sample=Math.min(planned,lot)
  const rule=AC_RE_15[code]
  return { code, sample, ac:rule?.ac ?? null, re:rule?.re ?? null }
}
function statusLabel(value:string|null|undefined) {
  const map:Record<string,string> = {
    em_andamento:'Em andamento',aberta:'Não iniciada',concluida:'Concluída',cancelada:'Cancelada',
    aprovado:'Aprovado',reprovado:'Reprovado',pendente:'Pendente',
    conforme:'Conforme',nao_conforme:'Não conforme',nao_aplicavel:'Não aplicável'
  }
  return value ? (map[value] ?? value.replaceAll('_',' ')) : '—'
}

export default function App() {
  const [sessionReady, setSessionReady] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [tab, setTab] = useState<'painel' | 'insights' | 'inspecoes' | 'nova' | 'execucao' | 'its' | 'estoque' | 'auditorias' | 'equipamentos' | 'fotos-mobile'>(()=>window.matchMedia('(max-width: 768px)').matches || new URLSearchParams(window.location.search).get('modo')==='fotos'?'fotos-mobile':'painel')
  const [itDemoOpen,setItDemoOpen]=useState(false)
  const [dashboardView,setDashboardView]=useState<'processos'|'inspecoes'|'estoque'|'concluidas'>('inspecoes')
  const [popupMessage,setPopupMessage]=useState('')
  const [aiConclusionBusy,setAiConclusionBusy]=useState(false)
  const [sharepointBusy,setSharepointBusy]=useState(false)
  const [processLookupBusy,setProcessLookupBusy]=useState(false)
  const [processLookupMessage,setProcessLookupMessage]=useState('')
  const [editingInspectionId,setEditingInspectionId]=useState<string|null>(null)
  const [editingProcessId,setEditingProcessId]=useState<string|null>(null)
  const [inspectionBusy,setInspectionBusy]=useState(false)
  const submitLock=useRef(false)
  const createRequestId=useRef(crypto.randomUUID())
  const [activeProductIndex,setActiveProductIndex]=useState(0)
  const [expandedSkuIndex,setExpandedSkuIndex]=useState<number|null>(0)
  const [expandedEditSkuIndex,setExpandedEditSkuIndex]=useState<number|null>(0)
  const [itSuggestBusy,setItSuggestBusy]=useState(false)
  const [itSuggestionNote,setItSuggestionNote]=useState('')
  const lastItSuggested=useRef('')
  const manualItSelection=useRef(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(()=>{if(!message)return;const timer=window.setTimeout(()=>setMessage(''),3500);return()=>window.clearTimeout(timer)},[message])
  const [login, setLogin] = useState({ email: '', password: '' })
  const [forgotPassword, setForgotPassword] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState(new URLSearchParams(window.location.search).get('auth') === 'recovery')
  const [recoveryVerified, setRecoveryVerified] = useState(false)
  const recoveryUrlError = new URLSearchParams(window.location.search).get('error_code')
  const [recoveryPassword, setRecoveryPassword] = useState('')
  const [recoveryConfirmation, setRecoveryConfirmation] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [counts, setCounts] = useState({ processos: 0, inspecoes: 0, amostras: 0, laudos: 0 })
  const [processes, setProcesses] = useState<ProcessRow[]>([])
  const [inspections, setInspections] = useState<InspectionRow[]>([])
  const [isOnline,setIsOnline]=useState(navigator.onLine)
  const [offlinePending,setOfflinePending]=useState(0)
  const [offlineConflicts,setOfflineConflicts]=useState(0)
  const [offlineDraftReady,setOfflineDraftReady]=useState(false)
  const [offlineDraftStatus,setOfflineDraftStatus]=useState('')
  const [offlineError,setOfflineError]=useState('')
  const editingBaseline=useRef<string|null>(null)
  const [editingProcess, setEditingProcess] = useState<ProcessRow | null>(null)
  const [deletingProcessId,setDeletingProcessId]=useState<string|null>(null)
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState<'dados'|'amostragem'|'verificacoes'|'dimensionais'|'testes'|'fotos'|'resultado'|'retencao'>('dados')
  const [detail, setDetail] = useState<any>(null)
  const [finalObservation, setFinalObservation] = useState('')
  const [internalObservation, setInternalObservation] = useState('')
  const [retentionRows, setRetentionRows] = useState<Record<string,{
    retain:boolean; qty:string; address:string; photoFile:File|null; photoPreview:string
  }>>({})
  const [retentionReason, setRetentionReason] = useState('')
  const [stockMove, setStockMove] = useState({ tipo: 'retirada', quantidade: '', endereco: '', motivo: '' })
  const [pendingPhotos, setPendingPhotos] = useState<Array<{id:string;file:File;url:string;legenda:string;productId:string;isProductId:boolean}>>([])
  const [pendingModal, setPendingModal] = useState<string[]>([])
  const [sampleNcDraft, setSampleNcDraft] = useState('0')
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
    dataInspecao: '',
    itVersionId: '',
    inspectionLevel: 'I',
    observacaoInterna: '',
  })
  const [skuRows, setSkuRows] = useState([emptySku()])
  const skuRowsRef=useRef(skuRows)
  useEffect(()=>{skuRowsRef.current=skuRows},[skuRows])
  const [omieSkuImport,setOmieSkuImport]=useState<OmieSkuImport|null>(null)
  const [omieSkuReview,setOmieSkuReview]=useState<OmieSkuReview|null>(null)
  const [omieSkuReviewError,setOmieSkuReviewError]=useState('')
  const [omieOrderPickerOpen,setOmieOrderPickerOpen]=useState(false)
  const [omieOrders,setOmieOrders]=useState<{codigo:string;pedidos:OmieOrder[]}|null>(null)
  const [omieSelectedOrder,setOmieSelectedOrder]=useState('')
  // Omie rejects repeated reads of the same record for 60 seconds.
  const fstLookupInFlight=useRef<string|null>(null)
  const fstResponseCache=useRef(new Map<string,{at:number;data:any}>())
  const fstNfeRequest=useRef(0)
  const fstNfeAttempt=useRef(new Map<string,number>())
  const productSearchTimers = useRef<Record<number,number>>({})
  const loadAppRequest = useRef<Promise<void> | null>(null)
  const catalogsRequest=useRef<Promise<void>|null>(null)
  const stockRequest=useRef<Promise<void>|null>(null)
  const photosLinksExpiration=useRef(new Map<string,number>())
  const photoLinksRequest=useRef(new Map<string,Promise<void>>())
  const [catalogsLoading,setCatalogsLoading]=useState(false)
  const [stockLoading,setStockLoading]=useState(false)
  const [photoUploadBusy,setPhotoUploadBusy]=useState(false)
  const loadSequence=useRef(0)
  const listRefreshSequence=useRef(0)
  const processDeletionLock=useRef<string|null>(null)
  const {equipments,setEquipments,busy:equipmentBusy,refresh:refreshEquipments}=useEquipmentList()
  const [editingInspectionData, setEditingInspectionData] = useState<any>(null)
  const [retentionSuggestion, setRetentionSuggestion] = useState<{quantidade:number|null;fonte:string|null}>({quantidade:null,fonte:null})

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

  // Avoid filtering the whole inspection array once for every process card.
  const inspectionsByProcess=useMemo(()=>{
    const grouped=new Map<string,InspectionRow[]>()
    for(const item of inspections){
      const processId=item.grupos_inspecao?.processo_id
      if(!processId)continue
      const items=grouped.get(processId)??[]
      items.push(item)
      grouped.set(processId,items)
    }
    return grouped
  },[inspections])

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
    let active = true
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(authErrorText(sessionError.message))
      setUserId(data.session?.user.id ?? null)
    }).catch(() => {
      if (active) setError(authErrorText('Failed to fetch'))
    }).finally(() => {
      if (active) setSessionReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true)
        setRecoveryVerified(!!session?.user)
      }
      setUserId(session?.user.id ?? null)
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])


  async function refreshOfflineCounts(uid:string){
    try{
      const operations=await offlineOperations(uid)
      setOfflinePending(operations.filter(x=>x.state!=='conflict').length)
      setOfflineConflicts(operations.filter(x=>x.state==='conflict').length)
    }catch(e:any){setOfflineError('Armazenamento local: '+String(e?.message||'indisponível'))}
  }
  async function syncOfflineNow(uid:string){
    if(!navigator.onLine||!uid)return
    try{
      const result=await replayOfflineOperations(uid)
      setOfflinePending(result.pending)
      setOfflineConflicts(result.conflicts)
      if(result.synced){
        setMessage(result.synced+' registro(s) sincronizado(s).')
        void refreshLists()
      }
    }catch(e:any){setOfflineError('Sincronização: '+String(e?.message||'indisponível'))}
  }
  useEffect(()=>{
    if(!userId){setOfflinePending(0);setOfflineConflicts(0);return}
    let active=true
    const check=()=>{
      if(!active)return
      setIsOnline(navigator.onLine)
      if(navigator.onLine)void syncOfflineNow(userId)
      else void refreshOfflineCounts(userId)
    }
    const onVisible=()=>{if(document.visibilityState==='visible')check()}
    window.addEventListener('online',check)
    window.addEventListener('offline',check)
    document.addEventListener('visibilitychange',onVisible)
    void refreshOfflineCounts(userId)
    if(navigator.onLine)void syncOfflineNow(userId)
    return ()=>{active=false;window.removeEventListener('online',check);window.removeEventListener('offline',check);document.removeEventListener('visibilitychange',onVisible)}
  },[userId])
  useEffect(()=>{
    if(!userId||tab!=='nova'||editingInspectionId||editingProcessId){setOfflineDraftReady(false);return}
    let active=true
    setOfflineDraftReady(false)
    void readOfflineDraft<any>(userId,'full:new').then(saved=>{
      if(!active)return
      if(saved?.inspection){
        setInspection(saved.inspection)
        if(Array.isArray(saved.skuRows))setSkuRows(saved.skuRows.map((row:any)=>({...emptySku(),...row,
          fotoPreview:row.fotoFile?URL.createObjectURL(row.fotoFile):''})))
        if(saved.requestId)createRequestId.current=saved.requestId
      }
    }).catch(e=>{if(active)setOfflineError('Falha ao restaurar rascunho: '+String(e?.message||''))})
      .finally(()=>{if(active)setOfflineDraftReady(true)})
    return()=>{active=false}
  },[userId,tab,editingInspectionId,editingProcessId])
  useEffect(()=>{
    if(!userId||tab!=='nova'||!offlineDraftReady||editingInspectionId||editingProcessId)return
    const timer=window.setTimeout(()=>{
      const hasContent=!!inspection.codigo.trim()||!!inspection.cliente.trim()||
        !!inspection.observacaoInterna.trim()||skuRows.some(skuRowHasData)
      const operation=hasContent?saveOfflineDraft(userId,'full:new',{
        inspection,skuRows,requestId:createRequestId.current
      }):clearOfflineDraft(userId,'full:new')
      void operation.then(()=>setOfflineDraftStatus(hasContent?'Salvo neste dispositivo':''))
        .catch(e=>setOfflineError('Não foi possível salvar localmente: '+String(e?.message||'')))
    },450)
    return()=>window.clearTimeout(timer)
  },[userId,tab,inspection,skuRows,offlineDraftReady,editingInspectionId,editingProcessId])

  useEffect(() => {
    if (!userId) {
      // Clear any prior session's cached records, including responses still in flight.
      loadSequence.current++
      setProfile(null)
      setProcesses([])
      setInspections([])
      setSamples([])
      setItVersions([])
      setGroups([])
      setEquipments([])
      setSelectedInspectionId(null)
      setDetail(null)
      setSelectedSample(null)
      setCounts({processos:0,inspecoes:0,amostras:0,laudos:0})
      photosLinksExpiration.current.clear()
      return
    }
    void loadApp().then(()=>{
      // Mobile photo mode needs only the minimal operational bootstrap; defer heavy catalogs/stock.
      if(tab==='fotos-mobile')return
      void loadCatalogs()
      void loadStock()
      void refreshEquipments()
    }).catch(()=>setError('Não foi possível iniciar os dados do SGQ. Atualize a página.'))
  }, [userId])

  useEffect(()=>{
    const u=new URL(window.location.href)
    if(u.searchParams.has('utm_source')) u.searchParams.delete('utm_source')
    if(/^#sec-/.test(u.hash)) u.hash=''
    if(u.href!==window.location.href) window.history.replaceState(null,'',u.pathname+u.search+u.hash)
  },[])

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

    import('qrcode').then(({default:QRCode})=>QRCode.toDataURL(sampleUrl(selectedSample), { margin: 1, width: 220 })).then((url)=>{
      if (active) setQrDataUrl(url)
    })

    void (async()=>{
      const loaded=await apiGet<any>(`/api/amostras/${selectedSample.id}/detalhe`)
      if (!active) return
      if (loaded.error || !loaded.data) {
        setSelectedSamplePhotoUrl('')
        setSelectedSampleProductPhotoUrl('')
        setSelectedSampleReport(null)
        return
      }
      setSelectedSamplePhotoUrl(String(loaded.data.fotoCadastroUrl ?? ''))
      setSelectedSampleProductPhotoUrl(String(loaded.data.produtoFotoPrincipalUrl ?? ''))
      setSelectedSampleReport(loaded.data.laudo?.numero
        ? {numero:String(loaded.data.laudo.numero),url:loaded.data.laudo.url ?? null}
        : null)
    })()

    return ()=>{active=false}
  }, [selectedSample])


  async function loadCatalogs(){
    if(catalogsRequest.current)return catalogsRequest.current
    const req=(async()=>{
      setCatalogsLoading(true)
      try{
        const res=await apiGet<any>('/api/app/catalogos')
        if(res.data){
          void saveOfflineDraft(userId||'','app:catalogos',res.data).catch(()=>undefined)
          setItVersions((res.data.itVersions??[]) as ItVersion[])
          setGroups((res.data.groups??[]) as Group[])
        }else{
          const cached=await readOfflineDraft<any>(userId||'','app:catalogos').catch(()=>null)
          if(cached){setItVersions(cached.itVersions||[]);setGroups(cached.groups||[])}
          else setError(res.error?.message||'Não foi possível carregar as instruções técnicas. Use Atualizar ou entre novamente.')
        }
      }catch{
        setError('Falha de conexão ao carregar as instruções técnicas.')
      }finally{setCatalogsLoading(false)}
    })()
    catalogsRequest.current=req
    try{await req}finally{if(catalogsRequest.current===req)catalogsRequest.current=null}
  }

  async function loadStock(){
    if(stockRequest.current)return stockRequest.current
    const req=(async()=>{
      setStockLoading(true)
      try{
        const res=await apiGet<any>('/api/app/estoque')
        if(res.data){
          void saveOfflineDraft(userId||'','app:estoque',res.data).catch(()=>undefined)
          const rows=(res.data.samples??[]).map((x:any)=>({...x,saldo:Number(x.saldo??0)}))
          setSamples(rows)
          setCounts(old=>({...old,amostras:rows.length}))
        }else{
          const cached=await readOfflineDraft<any>(userId||'','app:estoque').catch(()=>null)
          if(cached)setSamples((cached.samples||[]).map((x:any)=>({...x,saldo:Number(x.saldo??0)})))
          else setError(res.error?.message||'Não foi possível atualizar o estoque. Tente novamente.')
        }
      }catch{
        setError('Falha de conexão ao atualizar o estoque.')
      }finally{setStockLoading(false)}
    })()
    stockRequest.current=req
    try{await req}finally{if(stockRequest.current===req)stockRequest.current=null}
  }

  async function loadPhotoLinks(id:string,force=false){
    if(!force&&(photosLinksExpiration.current.get(id)||0)>Date.now())return
    const running=photoLinksRequest.current.get(id)
    if(running)return running
    const req=(async()=>{
      const res=await apiGet<{photoUrls:Record<string,string|null>}>(`/api/inspecoes/${encodeURIComponent(id)}/fotos/links`)
      if(res.error||!res.data)return
      const links=res.data.photoUrls??{}
      setDetail((d:any)=>d?.id===id?{...d,photos:(d.photos??[]).map((p:any)=>({
        ...p,signed_url:links[p.storage_path]??null
      }))}:d)
      photosLinksExpiration.current.set(id,Date.now()+45*60*1000)
    })()
    photoLinksRequest.current.set(id,req)
    try{await req}finally{if(photoLinksRequest.current.get(id)===req)photoLinksRequest.current.delete(id)}
  }

  async function loadApp() {
    if (loadAppRequest.current) return loadAppRequest.current
    const sequence=++loadSequence.current
    const request=(async()=>{
      setError('')
      const loaded=await apiGet<any>('/api/app/bootstrap')
      if (loaded.error || !loaded.data) {
        if(!navigator.onLine||connectionFailure(String(loaded.error?.message||''))){
          const offline=await readOfflineDraft<any>(userId||'','app:bootstrap').catch(()=>null)
          if(offline && sequence===loadSequence.current){
            setProfile(offline.profile)
            setProcesses(offline.processes||[])
            setInspections(offline.inspections||[])
            return
          }
        }
        setError(loaded.error?.message || 'Falha ao carregar o SGQ.')
        return
      }
      if(sequence!==loadSequence.current) return
      const data=loaded.data
      if (!data.profile) {
        setError('Seu usuário ainda não possui perfil liberado no SGQ.')
        return
      }
      setProfile(data.profile as Profile)
      void saveOfflineDraft(userId||'','app:bootstrap',{profile:data.profile,processes:data.processes,inspections:data.inspections})
        .catch(()=>undefined)
      setProcesses((data.processes ?? []) as ProcessRow[])
      setInspections((data.inspections ?? []) as InspectionRow[])
      setCounts(old=>({
        ...old,processos:(data.processes??[]).length,inspecoes:(data.inspections??[]).length
      }))
    })()
    loadAppRequest.current=request
    try {
      await request
    } finally {
      if (loadAppRequest.current===request) loadAppRequest.current=null
    }
  }


  function authErrorText(value: string) {
    const normalized = String(value ?? '').toLowerCase()
    if (/failed to fetch|fetch failed|network|networkerror|load failed|timeout/.test(normalized)) {
      return 'O serviço de autenticação do SGQ está indisponível. Tente novamente quando a conexão com o servidor for restabelecida.'
    }
    if (/invalid login credentials|invalid credentials/.test(normalized)) return 'E-mail ou senha incorretos.'
    if (/email not confirmed/.test(normalized)) return 'Confirme seu e-mail antes de entrar.'
    if (/rate limit|too many requests|over_email_send_rate_limit/.test(normalized)) return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos.'
    return value || 'Não foi possível concluir a autenticação.'
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    if (authBusy) return
    setError('')
    setMessage('')
    setAuthBusy(true)
    try {
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: login.email.trim().toLowerCase(),
        password: login.password,
      })
      if (signError) setError(authErrorText(signError.message))
    } catch {
      setError(authErrorText('Failed to fetch'))
    } finally {
      setAuthBusy(false)
    }
  }

  function clearRecoveryUrl() {
    const url = new URL(window.location.href)
    url.searchParams.delete('auth')
    url.searchParams.delete('error')
    url.searchParams.delete('error_code')
    url.searchParams.delete('error_description')
    url.hash = ''
    window.history.replaceState({}, '', url.pathname + url.search)
  }

  async function requestPasswordReset(e: React.FormEvent) {
    e.preventDefault()
    if (authBusy) return
    setAuthBusy(true)
    setError('')
    setMessage('')
    const email = login.email.trim().toLowerCase()
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: RECOVERY_REDIRECT_URL,
      })
      if (resetError) {
        setError(authErrorText(resetError.message))
      } else {
        setMessage('Se este e-mail estiver cadastrado no SGQ, você receberá um link para criar uma nova senha. Confira também a pasta de spam.')
      }
    } catch {
      setError(authErrorText('Failed to fetch'))
    } finally {
      setAuthBusy(false)
    }
  }

  async function finishPasswordRecovery(e: React.FormEvent) {
    e.preventDefault()
    if (authBusy) return
    setError('')
    setMessage('')
    if (!userId || !recoveryVerified) return setError('Link inválido ou expirado. Solicite outro e-mail de recuperação.')
    if (recoveryPassword.length < 8) return setError('A nova senha precisa ter pelo menos 8 caracteres.')
    if (recoveryPassword !== recoveryConfirmation) return setError('As senhas informadas não são iguais.')
    setAuthBusy(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: recoveryPassword })
      if (updateError) return setError(authErrorText(updateError.message))
      await supabase.auth.signOut()
      clearRecoveryUrl()
      setRecoveryMode(false)
      setRecoveryVerified(false)
      setForgotPassword(false)
      setRecoveryPassword('')
      setRecoveryConfirmation('')
      setLogin(current => ({ ...current, password: '' }))
      setMessage('Senha alterada com sucesso. Entre com sua nova senha.')
    } catch {
      setError(authErrorText('Failed to fetch'))
    } finally {
      setAuthBusy(false)
    }
  }

  function resetNewInspection() {
    createRequestId.current=crypto.randomUUID()
    autoNfeRef.current=null
    setEditingInspectionId(null);setEditingProcessId(null);setActiveProductIndex(0);setExpandedSkuIndex(0)
    manualItSelection.current=false;lastItSuggested.current='';setItSuggestionNote('');setProcessLookupMessage('')
    fstLookupRequest.current++;setOmieSkuImport(null);setOmieSkuReview(null);setOmieSkuReviewError('');setOmieOrderPickerOpen(false);setOmieOrders(null);setOmieSelectedOrder('')
    setInspection({
      processoId: '', codigo: '', cliente: '', notaFiscal: '', origem: 'China', transporte: '', chegadaCd: '',
      dataInspecao: '', itVersionId: '', inspectionLevel: 'I', observacaoInterna: '',
    })
    setSkuRows([emptySku()])
  }

  function fillTestInspectionData() {
    const today=new Date().toISOString().slice(0,10)
    const suffix=String(Date.now()).slice(-6)
    setInspection((current)=>({
      ...current,
      processoId:'',
      codigo:suffix,
      cliente:'CLIENTE TESTE SGQ',
      notaFiscal:`TESTE-${suffix}`,
      origem:'China',
      transporte:'Marítimo',
      chegadaCd:today,
      dataInspecao:'',
      observacaoInterna:'DADOS FICTÍCIOS PARA TESTE. Ex.: 60 un retiradas no laboratório para retenção.',
    }))
    setSkuRows([{
      ...emptySku(),
      sku:`TESTE-${suffix}`,
      nome:'EMBALAGEM TESTE SGQ',
      lote:`LT-${suffix}`,
      material:'PP',
      capacidade:'100 ml',
      quantidade:'6060',
      quantidadePorCaixa:'136',
      caixasRecebidas:'46',
      caixasInspecionadas:'8',
      caixasPadrao:'44',
      unidadesPadrao:'136',
      caixasFracionadas:'1',
      unidadesFracionadas:'16',
      caixasLaboratorio:'1',
      unidadesLaboratorio:'60',
      unidadesPorConjunto:'1',
      omieStatus:'',
      omieMessage:'',
    }])
    setMessage(current=>{
      return inspection.itVersionId
        ? 'Dados fictícios preenchidos. Revise e crie a inspeção.'
        : 'Dados fictícios preenchidos. Selecione apenas a IT antes de criar.'
    })
  }

  function reuseProcess(p: ProcessRow) {
    autoNfeRef.current=null
    fstLookupRequest.current++
    setOmieSkuImport(null);setOmieSkuReview(null);setOmieSkuReviewError('');setOmieOrderPickerOpen(false);setOmieOrders(null);setOmieSelectedOrder('')
    setEditingInspectionId(null);setEditingProcessId(null);
    setInspection((x) => ({
      ...x,
      processoId: p.id,
      codigo: fstCode(p.codigo),
      cliente: p.cliente ?? '',
      notaFiscal: p.nota_fiscal ?? '',
      origem: p.origem ?? '',
      transporte: p.transporte ?? '',
      chegadaCd: p.chegada_cd ?? '',
      dataInspecao: '',
    }))
    setExpandedSkuIndex(0)
    setSkuRows([emptySku()])
    setTab('nova')
    setMessage('Dados gerais reutilizados. Informe o novo código/produto desta inspeção.')
  }

  async function editInspectionFull(id:string){
    setError('')
    const res=await apiGet<any>(`/api/inspecoes/${id}/detalhe`)
    if(res.error||!res.data?.inspecao){setPopupMessage(res.error?.message||'Falha ao abrir inspeção.');return}
    editingBaseline.current=offlineInspectionVersion(res.data)
    void saveOfflineDraft(userId||'','full:detail:'+id,res.data).catch(()=>undefined)
    const data={...res.data.inspecao,items:res.data.items??[]}
    const process=data.grupos_inspecao?.processos??{}
    const items=(data.items??[]).map((link:any)=>{
      const x=link.processo_itens
      return applyBoxGroupsToSku({...emptySku(),processoItemId:x.id,sku:x.produtos?.sku??'',
        nome:x.produtos?.nome??'',codigoCliente:x.codigo_cliente??'',quantidadePv:x.quantidade_pv==null?'':String(x.quantidade_pv),
        numeroPedidoPv:x.pv_numero??'',fstPv:x.pv_fst??'',lote:x.lote??'',material:x.material??'',capacidade:x.capacidade??'',
        quantidade:String(x.quantidade??''),quantidadePorCaixa:String(x.quantidade_por_caixa??''),
        caixasRecebidas:String(x.caixas_recebidas??''),caixasInspecionadas:String(x.caixas_inspecionadas??''),
        unidadesPorConjunto:String(link.unidades_por_conjunto??1)},x.distribuicao_caixas)
    })
    setEditingInspectionId(data.id);setEditingProcessId(null)
    setInspection({processoId:data.grupos_inspecao?.processo_id??'',codigo:fstCode(process.codigo),
      cliente:process.cliente??'',notaFiscal:process.nota_fiscal??'',origem:process.origem??'',
      transporte:process.transporte??'',chegadaCd:process.chegada_cd??'',
      dataInspecao:String(data.data_inspecao??'').slice(0,10),
      itVersionId:data.it_versao_id??'',inspectionLevel:data.nivel_inspecao??'I',
      observacaoInterna:data.observacao_interna??''})
    setSkuRows(items.length?items:[emptySku()]);setExpandedSkuIndex(items.length>1?null:0);setActiveProductIndex(0);setTab('nova');setMessage('')
  }
  function editProcessFull(p:ProcessRow){
    const candidate=inspections.find(x=>x.grupos_inspecao?.processo_id===p.id&&x.status!=='concluida')
    if(candidate){void editInspectionFull(candidate.id);return}
    setEditingInspectionId(null);setEditingProcessId(p.id)
    setInspection({processoId:p.id,codigo:fstCode(p.codigo),cliente:p.cliente??'',
      notaFiscal:p.nota_fiscal??'',origem:p.origem??'',transporte:p.transporte??'',
      chegadaCd:p.chegada_cd??'',dataInspecao:'',
      itVersionId:'',inspectionLevel:'I',observacaoInterna:''})
    setExpandedSkuIndex(0);setSkuRows([emptySku()]);setTab('nova');setMessage('')
  }

  const fstLookupRequest=useRef(0)
  const autoNfeRef=useRef<{fst:string;numero:string}|null>(null)
  const productLookupTimers=useRef<Record<number,number>>({})
  function queueProductSuggestions(index:number, value:string) {
    const prior=productLookupTimers.current[index]
    if(prior)window.clearTimeout(prior)
    if(/[0-9]/.test(value)&&value.trim().length>=4){
      productLookupTimers.current[index]=window.setTimeout(()=>void lookupProduct(index,value.trim()),850)
    }
    const old=productSearchTimers.current[index]
    if (old) window.clearTimeout(old)
    const term=value.trim()
    if (term.length<2) {
      setSkuRows((rows)=>rows.map((r,i)=>i===index?{...r,suggestions:[],suggesting:false}:r))
      return
    }
    setSkuRows((rows)=>rows.map((r,i)=>i===index?{...r,suggesting:true}:r))
    productSearchTimers.current[index]=window.setTimeout(async()=>{
      const fast=await apiGet<any[]>(`/api/produtos/sugerir?termo=${encodeURIComponent(term)}&origem=local`)
      const parse=(items:any[])=>(items??[]).map((x:any)=>({sku:String(x.sku??''),nome:String(x.nome??''),origem:String(x.origem??'')}))
      const items=parse(fast.data??[])
      setSkuRows(rows=>rows.map((r,i)=>i===index&&r.sku.trim()===term?{...r,suggestions:items,suggesting:items.length<5}:r))
      if(items.length>=5)return
      const complete=await apiGet<any[]>(`/api/produtos/sugerir?termo=${encodeURIComponent(term)}`)
      setSkuRows(rows=>rows.map((r,i)=>i===index&&r.sku.trim()===term?{...r,suggestions:parse(complete.data??items),suggesting:false}:r))
    },280)
  }

  function chooseProductSuggestion(index:number, suggestion:{sku:string;nome:string}) {
    setSkuRows((rows)=>rows.map((r,i)=>i===index?{
      ...r,sku:suggestion.sku,nome:suggestion.nome,suggestions:[],omieStatus:'loading',omieMessage:'Confirmando no OMIE…'
    }:r))
    window.setTimeout(()=>void lookupProduct(index,suggestion.sku),0)
  }
  async function lookupProduct(index: number, codeOverride?:string) {
    const code = String(codeOverride ?? skuRows[index]?.sku ?? '').trim()
    if (!code) return
    setSkuRows((rows)=>rows.map((r,i)=>i===index?{...r,omieStatus:'loading',omieMessage:'Consultando cadastro do OMIE…'}:r))

    const result=await apiPost<any>('/api/produtos/consultar',{codigo:code})
    if (result.error) {
      setSkuRows((rows)=>rows.map((r,i)=>i===index&&r.sku.trim()===code?{...r,omieStatus:'error',omieMessage:result.error.message || 'Falha ao consultar o OMIE.'}:r))
      return
    }
    const data=result.data
    if (data?.error === 'omie_not_configured') {
      setSkuRows((rows)=>rows.map((r,i)=>i===index&&r.sku.trim()===code?{...r,omieStatus:'not_configured',omieMessage:String(data?.message ?? 'Integração OMIE não configurada.')}:r))
      return
    }
    if (data?.error === 'not_found') {
      const suggestions=(data?.sugestoes ?? []).map((x:any)=>({sku:String(x.codigo ?? ''),nome:String(x.descricao ?? ''),origem:'omie'}))
      setSkuRows((rows)=>rows.map((r,i)=>i===index&&r.sku.trim()===code?{...r,omieStatus:'not_found',omieMessage:String(data?.message ?? 'Código não encontrado no OMIE.'),suggestions}:r))
      return
    }
    if (data?.error) {
      let prefix='Falha ao consultar o OMIE'
      if (data.error==='auth_error') prefix='Credenciais do OMIE recusadas'
      if (data.error==='rate_limit') prefix='Limite de consultas do OMIE atingido'
      setSkuRows((rows)=>rows.map((r,i)=>i===index&&r.sku.trim()===code?{...r,omieStatus:'error',omieMessage:prefix+': '+String(data?.message ?? prefix)}:r))
      return
    }
    if (!data?.found || !data?.descricao) {
      setSkuRows((rows)=>rows.map((r,i)=>i===index&&r.sku.trim()===code?{...r,omieStatus:'not_found',omieMessage:'Código não localizado no cadastro de produtos do OMIE.'}:r))
      return
    }

    setSkuRows((rows)=>rows.map((r,i)=>i===index&&r.sku.trim()===code?{
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

  async function refreshLists() {
    const version=loadSequence.current
    const refreshId=++listRefreshSequence.current
    const res=await apiGet<any>('/api/app/listas')
    // A newer refresh or a process deletion must win over any slower response.
    if(res.error||!res.data||version!==loadSequence.current||
       refreshId!==listRefreshSequence.current)return
    setProcesses((res.data.processes??[]) as ProcessRow[])
    setInspections((res.data.inspections??[]) as InspectionRow[])
  }

  function openOmieSkuReview(suggestion:OmieSkuImport){
    if(fstCode(inspection.codigo)!==suggestion.codigo)return
    setOmieOrderPickerOpen(false)
    setOmieSkuReviewError('')
    setOmieSkuReview(prepareOmieSkuReview(suggestion,skuRowsRef.current))
  }

  function updateOmieReviewQuantity(sku:string,value:string){
    setOmieSkuReview(current=>current?{...current,itens:current.itens.map(item=>
      item.sku===sku?{...item,quantidadeInformada:value}:item)}:null)
    setOmieSkuReviewError('')
  }

  function closeOmieSkuReview(){
    if(!omieSkuReview)return
    const review=omieSkuReview
    if(fstCode(inspection.codigo)!==review.codigo){
      setOmieSkuReview(null)
      return
    }
    if(!validOmieSkuReview(review)){
      setOmieSkuReviewError('Confira as quantidades: preencha valores numéricos maiores ou iguais a zero.')
      return
    }
    setSkuRows(rows=>applyOmieReviewedRows(rows,review))
    setExpandedSkuIndex(null)
    setOmieSkuReview(null)
    setOmieSkuReviewError('')
    setProcessLookupMessage('')
  }

  async function lookupFstNfe(code:string,lookupId:number){
    // Supplier NF-e lookup is deliberately asynchronous and separate from SKU import.
    try{
      const {data,error}=await authClient.functions.invoke('sgq-omie-fst',
        {body:{codigo:code,modo:'nfe'}})
      if(error||lookupId!==fstNfeRequest.current)return
      const numero=String(data?.numeroNota||'').trim()
      if(data?.status!=='matched'||!numero)return
      setInspection(current=>{
        if(fstCode(current.codigo)!==code || current.notaFiscal.trim())return current
        autoNfeRef.current={fst:code,numero}
        return {...current,notaFiscal:numero}
      })
    }catch{
      // Lookup failure must never overwrite a manually entered NF number.
    }
  }

  async function lookupFstClient(value:string,codigoPedido?:number){
    const code=fstCode(value)
    if(!code){setProcessLookupMessage('');return}
    const lookupKey=code+':'+(codigoPedido??0)
    // Blur, button clicks and modal focus may happen in quick succession.
    // Never restart a request or discard a quantity review already on screen.
    if(fstLookupInFlight.current===lookupKey)return
    if(!codigoPedido && (omieSkuReview?.codigo===code ||
      (omieOrderPickerOpen && omieOrders?.codigo===code)))return
    fstLookupInFlight.current=lookupKey
    const requestId=++fstLookupRequest.current
    setProcessLookupMessage('')
    if(!codigoPedido){
      setOmieSkuImport(null)
      setOmieSkuReview(null)
      setOmieOrderPickerOpen(false)
    }
    setOmieSkuReviewError('')
    setProcessLookupBusy(true)
    const existing=processes.find(p=>fstCode(p.codigo)===code)
    if(existing){
      setInspection(old=>fstCode(old.codigo)===code?{
        ...old,processoId:existing.id,cliente:old.cliente||existing.cliente||'',
        notaFiscal:old.notaFiscal||existing.nota_fiscal||'',origem:old.origem||existing.origem||'',
        transporte:old.transporte||existing.transporte||'',chegadaCd:old.chegadaCd||existing.chegada_cd||''
      }:old)
    }
    try{
      const saved=fstResponseCache.current.get(lookupKey)
      const response=saved && Date.now()-saved.at<65000
        ? {data:saved.data,error:null}
        : await authClient.functions.invoke('sgq-omie-fst',
          {body:{codigo:code,...(codigoPedido?{codigoPedido}:{})}})
      const {data,error}=response
      if(requestId!==fstLookupRequest.current)return
      if(error||data?.error){
        // A failed follow-up must not close the order picker or an existing review.
        setProcessLookupMessage('Falha na consulta ao Omie. Tente novamente.')
        return
      }
      if(data?.found)fstResponseCache.current.set(lookupKey,{at:Date.now(),data})
      if(fstResponseCache.current.size>30){
        const oldest=fstResponseCache.current.keys().next().value
        if(oldest)fstResponseCache.current.delete(oldest)
      }
      if(!data?.found){
        setProcessLookupMessage(existing?'':'Processo não localizado no Omie.')
        return
      }
      if(!codigoPedido && Number.isFinite(Number(data.projectId))&&Number(data.projectId)>0){
        const lastAttempt=fstNfeAttempt.current.get(code)??0
        if(Date.now()-lastAttempt>120000){
          fstNfeAttempt.current.set(code,Date.now())
          void lookupFstNfe(code,++fstNfeRequest.current)
        }
      }
      if(data.cliente)setInspection(old=>fstCode(old.codigo)===code?{...old,cliente:old.cliente||String(data.cliente)}:old)
      const orders:OmieOrder[]=Array.isArray(data.pedidos)?data.pedidos.filter((o:any)=>
        Number.isInteger(Number(o.codigoPedido))&&Number(o.codigoPedido)>0).map((o:any)=>({
        codigoPedido:Number(o.codigoPedido),numeroPedido:String(o.numeroPedido||''),
        quantidadeItens:Number(o.quantidadeItens)||0
      })):[]
      setOmieOrders(orders.length>1?{codigo:code,pedidos:orders}:null)
      if(orders.length>1&&!codigoPedido){
        setOmieOrderPickerOpen(true)
        setProcessLookupMessage('Projeto localizado. Selecione o pedido no popup para conferir os produtos.')
        return
      }
      const itens:OmieOrderItem[]=Array.isArray(data.itens)?data.itens:[]
      const numeroPedido=String(data.numeroPedido||'')
      if(itens.length){
        const suggestion={codigo:code,numeroPedido,itens}
        setOmieSkuImport(suggestion)
        // Opening the popup does not mutate inspection products. Its close action
        // applies all reviewed quantities in a single state update.
        openOmieSkuReview(suggestion)
        setProcessLookupMessage('')
      }else{
        setOmieSkuImport(null)
        setProcessLookupMessage(data.itensDisponiveis===false?
          'Projeto localizado, mas não foi possível carregar os itens do pedido. Tente novamente.':
          'Projeto localizado no Omie, sem itens disponíveis para importação.')
      }
    }catch{
      if(requestId===fstLookupRequest.current)setProcessLookupMessage('Consulta ao Omie indisponível. Tente novamente.')
    }finally{
      if(fstLookupInFlight.current===lookupKey)fstLookupInFlight.current=null
      if(requestId===fstLookupRequest.current)setProcessLookupBusy(false)
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
    void refreshLists()
  }

  async function deleteProcess(p: ProcessRow) {
    if (!canDelete || processDeletionLock.current) return
    if (!window.confirm(`Excluir o processo ${p.codigo} da visão operacional? As inspeções vinculadas sairão da operação, mas todo o histórico será preservado para auditoria.`)) return
    processDeletionLock.current=p.id
    setDeletingProcessId(p.id)
    setError('')
    // Invalidate requests already in flight before the mutation begins.
    listRefreshSequence.current++
    try {
      const deleted=await apiPost<any>(`/api/processos/${encodeURIComponent(p.id)}/excluir`,{})
      if (deleted.error || !deleted.data?.ok) {
        setError(deleted.error?.message||'Não foi possível excluir o processo.')
        // The server may have committed the archival before a later step failed.
        void refreshLists()
        return
      }
      loadSequence.current++
      listRefreshSequence.current++
      // Server-side archival succeeded: update the operational UI in one local pass.
      setProcesses(current=>current.filter(row=>row.id!==p.id))
      setInspections(current=>current.filter(row=>row.grupos_inspecao?.processo_id!==p.id))
      setGroups(current=>current.filter(row=>row.processo_id!==p.id))
      setEditingProcess(current=>current?.id===p.id?null:current)
      const affectedInspectionIds=new Set(inspections
        .filter(row=>row.grupos_inspecao?.processo_id===p.id).map(row=>row.id))
      if(selectedInspectionId && affectedInspectionIds.has(selectedInspectionId)) {
        setSelectedInspectionId(null)
        setDetail(null)
        setActiveStage('dados')
        setTab('inspecoes')
      }
      setMessage(deleted.data.auditRecorded===false
        ? 'Processo excluído. O registro de auditoria precisa de verificação pelo administrador.'
        : 'Processo excluído. Inspeções vinculadas removidas da visão operacional.')
      // No full reload: the list and its counters already reflect the confirmed change.
    } finally {
      processDeletionLock.current=null
      setDeletingProcessId(null)
    }
  }

  async function deleteInspection(i: InspectionRow | { id:string; numero?:string }) {
    if (!canDelete) return
    const original=inspections.find(row=>row.id===i.id)
    const label=original ? ' '+inspectionDisplay(original) : ''
    if (!window.confirm(`Excluir a inspeção${label}? Ela sairá da operação, mas o registro de auditoria será preservado.`)) return
    const deleted=await apiPost<any>(`/api/inspecoes/${i.id}/excluir`,{numero:(i as any).numero ?? null})
    if (deleted.error) return setError(deleted.error.message)
    loadSequence.current++
    setInspections(current=>current.filter(row=>row.id!==i.id))
    if (selectedInspectionId===i.id) {
      setSelectedInspectionId(null)
      setDetail(null)
      setTab('painel')
    }
    setMessage('Inspeção excluída.')
    void refreshLists()
  }

  async function refreshInspectionPhotoEvidence() {
    if(!selectedInspectionId) return
    const id=selectedInspectionId
    const [details,urls]=await Promise.all([
      apiGet<any>('/api/mobile/fotos/inspecoes/'+encodeURIComponent(id)),
      apiGet<{photoUrls:Record<string,string|null>}>('/api/inspecoes/'+encodeURIComponent(id)+'/fotos/links'),
    ])
    if(details.error||!details.data){
      setError(details.error?.message||'Não foi possível atualizar as fotos.')
      return
    }
    setDetail((current:any)=>current?.id===id?{
      ...current,photos:(details.data.photos??[]).map((p:any)=>({
        ...p,signed_url:urls.data?.photoUrls?.[p.storage_path]??null
      }))
    }:current)
    setMessage('Fotos atualizadas.')
  }

  async function openInspection(id: string) {
    setError('')
    if(selectedInspectionId!==id) setActiveStage('dados')
    setSelectedInspectionId(id)
    const loaded=await apiGet<any>(`/api/inspecoes/${id}/detalhe`)
    if (loaded.error || !loaded.data?.inspecao) {
      return setError(loaded.error?.message ?? 'Inspeção não encontrada.')
    }

    const data=loaded.data
    editingBaseline.current=offlineInspectionVersion(data)
    void saveOfflineDraft(userId||'','full:detail:'+id,data).catch(()=>undefined)
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

    photosLinksExpiration.current.delete(id)
    setDetail(next)
    setSampleNcDraft(String(next.total_nao_conforme ?? 0))
    setFinalObservation(next.observacoes ?? '')
    setInternalObservation(next.observacao_interna ?? '')
    const retention:Record<string,{retain:boolean;qty:string;address:string;photoFile:File|null;photoPreview:string}>={}
    for (const link of next.items as any[]) {
      const item=link.processo_itens
      const existing=(next.retained as any[]).find((x:any)=>x.produto_id===item?.produto_id)
      retention[item.id]={retain:!existing,qty:'',address:'',photoFile:null,photoPreview:''}
    }
    const suggestedQty=retentionQuantityFromText(next.observacao_interna)
    if (suggestedQty!=null) {
      setRetentionSuggestion({quantidade:suggestedQty,fonte:'observacao_interna'})
      for (const key of Object.keys(retention)) retention[key].qty=String(suggestedQty)
    } else setRetentionSuggestion({quantidade:null,fonte:null})
    setRetentionRows(retention)
    setTab('execucao')
  }

  function startEditingInspectionData() {
    if (!detail) return
    const process=detail.grupos_inspecao?.processos ?? {}
    const rows=(detail.items ?? []).map((link:any)=>{
      const item=link.processo_itens
      const base={...emptySku(),processoItemId:item.id,sku:item.produtos?.sku ?? '',nome:item.produtos?.nome ?? '',
        codigoCliente:item.codigo_cliente??'',quantidadePv:item.quantidade_pv==null?'':String(item.quantidade_pv),
        numeroPedidoPv:item.pv_numero??'',fstPv:item.pv_fst??'',lote:item.lote ?? '',material:item.material ?? '',capacidade:item.capacidade ?? '',quantidade:String(item.quantidade ?? ''),quantidadePorCaixa:String(item.quantidade_por_caixa ?? ''),caixasRecebidas:String(item.caixas_recebidas ?? ''),caixasInspecionadas:String(item.caixas_inspecionadas ?? ''),unidadesPorConjunto:String(link.unidades_por_conjunto ?? 1)}
      return applyBoxGroupsToSku(base,item.distribuicao_caixas)
    })
    setExpandedEditSkuIndex(rows.length>1?null:0)
    setEditingInspectionData({
      codigo:fstCode(process.codigo),cliente:process.cliente ?? '',notaFiscal:process.nota_fiscal ?? '',origem:process.origem ?? '',transporte:process.transporte ?? '',
      chegadaCd:process.chegada_cd ?? '',dataInspecao:String(detail.data_inspecao ?? '').slice(0,10),inspectionLevel:detail.nivel_inspecao ?? 'I',
      observacaoInterna:detail.observacao_interna ?? '',itVersionId:detail.it_versao_id ?? '',itens:rows,
    })
  }

  async function saveEditingInspectionData() {
    if (!editingInspectionData || !selectedInspectionId) return
    const itens=(editingInspectionData.itens ?? []).map((row:any)=>({
      processoItemId:row.processoItemId,sku:String(row.sku ?? '').trim(),nome:String(row.nome ?? '').trim(),
      codigoCliente:String(row.codigoCliente??'').trim()||null,
      quantidadePv:row.quantidadePv===''||row.quantidadePv==null?null:Number(row.quantidadePv),
      numeroPedidoPv:String(row.numeroPedidoPv??'').trim()||null,fstPv:String(row.fstPv??'').trim()||null,
      lote:String(row.lote ?? '').trim() || null,
      material:String(row.material ?? '').trim() || null,capacidade:String(row.capacidade ?? '').trim() || null,quantidade:Number(row.quantidade)||0,
      quantidadePorCaixa:Number(row.quantidadePorCaixa)||null,caixasRecebidas:Number(row.caixasRecebidas)||0,caixasInspecionadas:Number(row.caixasInspecionadas)||0,
      unidadesPorConjunto:Number(row.unidadesPorConjunto)||1,distribuicaoCaixas:boxGroupsFromRow(row),
    }))
    const editPayload={
      codigo:String(editingInspectionData.codigo ?? '').trim(),cliente:String(editingInspectionData.cliente ?? '').trim() || null,
      notaFiscal:String(editingInspectionData.notaFiscal ?? '').trim() || null,origem:String(editingInspectionData.origem ?? '').trim() || null,
      transporte:String(editingInspectionData.transporte ?? '').trim() || null,chegadaCd:editingInspectionData.chegadaCd || null,
      dataInspecao:editingInspectionData.dataInspecao || null,inspectionLevel:editingInspectionData.inspectionLevel || 'I',
      observacaoInterna:String(editingInspectionData.observacaoInterna ?? '').trim() || null,itVersionId:editingInspectionData.itVersionId || null,itens,
    }
    if(!navigator.onLine){
      try{await queueInspectionUpdate(selectedInspectionId,editPayload);setEditingInspectionData(null)}
      catch(e:any){setError(String(e?.message||''))}
      return
    }
    const saved=await apiPut<any>('/api/inspecoes/'+selectedInspectionId+'/dados',editPayload)
    if(saved.error){
      if(connectionFailure(saved.error.message)){
        try{await queueInspectionUpdate(selectedInspectionId,editPayload);setEditingInspectionData(null)}
        catch(e:any){setError(String(e?.message||''))}
      }else setError(saved.error.message)
      return
    }
    setEditingInspectionData(null)
    const p=saved.data?.plano
    setMessage(`Dados atualizados. Plano recalculado: ${p?.codigo ?? '—'} · ${p?.amostra ?? 0} un. · Ac/Re ${p?.ac ?? '—'}/${p?.re ?? '—'}.`)
    void refreshLists()
    await openInspection(selectedInspectionId)
  }
  async function suggestApplicableIt(force=false){
    const products=skuRows.filter(row=>row.nome.trim()||row.sku.trim()).map(row=>({codigo:row.sku,descricao:row.nome}))
    const its=itVersions.filter(it=>it.status==='publicada').map(it=>({
      id:it.id,codigo:it.instrucoes_trabalho?.codigo,titulo:it.instrucoes_trabalho?.titulo
    }))
    const fingerprint=JSON.stringify(products.map(p=>[p.codigo,p.descricao]))+its.map(x=>x.id).join()
    if(!products.length||!its.length||(!force&&(inspection.itVersionId||manualItSelection.current||fingerprint===lastItSuggested.current)))return
    lastItSuggested.current=fingerprint
    setItSuggestBusy(true)
    try{
      const {data,error}=await authClient.functions.invoke('sgq-it-sugerir',{body:{products,its}})
      if(error||!data){setItSuggestionNote('Não foi possível sugerir uma IT. Selecione manualmente.');return}
      const chosen=its.find(x=>x.id===data.id)
      if(chosen&&!manualItSelection.current){
        setInspection(old=>old.itVersionId?old:{...old,itVersionId:chosen.id})
        setItSuggestionNote('IT sugerida por IA com base nos produtos. Confirme antes de iniciar.')
      }else setItSuggestionNote(data.motivo||'Nenhuma IT compatível com confiança suficiente. Selecione manualmente.')
    }catch{setItSuggestionNote('Sugestão indisponível. Selecione a IT manualmente.')}
    finally{setItSuggestBusy(false)}
  }
  const aiItFingerprint=skuRows.map(row=>row.sku+'|'+row.nome).join('¦')
  useEffect(()=>{
    if(!userId||!itVersions.length||!skuRows.some(row=>row.nome.trim()))return
    if(inspection.itVersionId||manualItSelection.current)return
    const timer=window.setTimeout(()=>void suggestApplicableIt(),950)
    return()=>window.clearTimeout(timer)
  },[aiItFingerprint,itVersions,userId,inspection.itVersionId])

  async function queueInspectionCreate(iniciar:boolean){
    if(!userId)throw new Error('Usuário não identificado.')
    const rows=skuRows.filter(row=>skuRowHasData(row))
    const itens=rows.map(row=>{
      const dist=boxDistributionTotals(row)
      return {
        sku:row.sku.trim(),nome:row.nome.trim(),codigoCliente:row.codigoCliente.trim()||null,
        quantidadePv:row.quantidadePv.trim()===''?null:Number(row.quantidadePv),
        numeroPedidoPv:row.numeroPedidoPv||null,fstPv:row.fstPv||null,
        lote:row.lote.trim()||null,material:row.material.trim()||null,capacidade:row.capacidade.trim()||null,
        quantidade:Number(row.quantidade)||0,quantidadePorCaixa:Number(row.quantidadePorCaixa)||null,
        caixasRecebidas:Number(row.caixasRecebidas)||0,caixasInspecionadas:Number(row.caixasInspecionadas)||0,
        unidadesPorConjunto:Number(row.unidadesPorConjunto)||1,
        distribuicaoCaixas:dist.groups.length?dist.groups:null,
        fotoPrincipalPath:row.fotoPrincipalPath||null,
      }
    })
    const photos=rows.map((row,index)=>row.fotoFile?{index,file:row.fotoFile}:null).filter(Boolean)
    const payload={
      codigo:inspection.codigo.trim(),requestId:createRequestId.current,
      cliente:inspection.cliente.trim()||null,notaFiscal:inspection.notaFiscal.trim()||null,
      origem:inspection.origem.trim()||null,transporte:inspection.transporte.trim()||null,
      chegadaCd:inspection.chegadaCd||null,dataInspecao:inspection.dataInspecao||null,
      itVersionId:inspection.itVersionId||null,iniciar,inspectionLevel:inspection.inspectionLevel,
      observacaoInterna:inspection.observacaoInterna.trim()||null,itens,
    }
    await enqueueOfflineOperation({
      id:userId+':inspection-create:'+createRequestId.current,userId,
      kind:'inspection-create',path:'/api/inspecoes/criar',body:{payload,photos},createdAt:Date.now()
    })
    await clearOfflineDraft(userId,'full:new')
    await refreshOfflineCounts(userId)
    setOfflineDraftStatus('')
    setMessage('Inspeção salva no dispositivo. Sincronização automática quando houver internet.')
    resetNewInspection()
    setTab('painel')
  }
  async function queueInspectionUpdate(id:string,payload:any){
    if(!userId||!editingBaseline.current)throw new Error('Não há versão original verificada para sincronizar esta inspeção.')
    await enqueueOfflineOperation({id:userId+':inspection-update:'+id,userId,
      kind:'inspection-update',path:'/api/inspecoes/'+encodeURIComponent(id)+'/dados',body:payload,
      expected:editingBaseline.current,createdAt:Date.now()})
    await refreshOfflineCounts(userId)
    setMessage('Alterações salvas neste dispositivo; sincronização pendente.')
  }
  async function createInspection(e: React.FormEvent, iniciar:boolean) {
    e.preventDefault()
    if(!canWrite||!userId||inspectionBusy||submitLock.current)return
    submitLock.current=true
    try {
    if(editingInspectionId||editingProcessId){
      setInspectionBusy(true)
      try{
        if(editingProcessId&&!editingInspectionId){
          const saved=await apiPut<any>(`/api/processos/${editingProcessId}`,{
            cliente:inspection.cliente,notaFiscal:inspection.notaFiscal,origem:inspection.origem,
            transporte:inspection.transporte,chegadaCd:inspection.chegadaCd||null
          })
          if(saved.error){setPopupMessage(saved.error.message);return}
          resetNewInspection();setTab('inspecoes');setMessage('Processo salvo.');void refreshLists();return
        }
        const id=editingInspectionId!
        const itens=skuRows.map(row=>({
          processoItemId:(row as any).processoItemId??null,sku:row.sku.trim(),nome:row.nome.trim(),
          codigoCliente:row.codigoCliente.trim()||null,
          quantidadePv:row.quantidadePv.trim()===''?null:Number(row.quantidadePv),
          numeroPedidoPv:row.numeroPedidoPv||null,fstPv:row.fstPv||null,
          lote:row.lote.trim()||null,material:row.material.trim()||null,capacidade:row.capacidade.trim()||null,
          quantidade:Number(row.quantidade)||0,quantidadePorCaixa:Number(row.quantidadePorCaixa)||null,
          caixasRecebidas:Number(row.caixasRecebidas)||0,caixasInspecionadas:Number(row.caixasInspecionadas)||0,
          unidadesPorConjunto:Number(row.unidadesPorConjunto)||1,distribuicaoCaixas:boxGroupsFromRow(row)
        }))
        const editPayload={
          codigo:inspection.codigo,cliente:inspection.cliente,notaFiscal:inspection.notaFiscal,
          origem:inspection.origem,transporte:inspection.transporte,chegadaCd:inspection.chegadaCd||null,
          dataInspecao:inspection.dataInspecao||null,inspectionLevel:inspection.inspectionLevel,
          itVersionId:inspection.itVersionId||null,observacaoInterna:inspection.observacaoInterna,itens
        }
        if(!navigator.onLine){
          try{await queueInspectionUpdate(id,editPayload);resetNewInspection();setTab('painel')}
          catch(e:any){setPopupMessage(String(e?.message||''))}
          return
        }
        const saved=await apiPut<any>('/api/inspecoes/'+id+'/dados',editPayload)
        if(saved.error){
          if(connectionFailure(saved.error.message)){
            try{await queueInspectionUpdate(id,editPayload);resetNewInspection();setTab('painel')}
            catch(e:any){setPopupMessage(String(e?.message||''))}
          }else setPopupMessage(saved.error.message)
          return
        }
        resetNewInspection();setTab('painel');setMessage('Inspeção salva.');void refreshLists();return
      }finally{setInspectionBusy(false)}
    }
    setError('')
    setMessage('')

    if (iniciar && !inspection.itVersionId) {setPopupMessage('Selecione a IT para iniciar a inspeção.');return}
    setInspectionBusy(true)
    if(!navigator.onLine){
      try{await queueInspectionCreate(iniciar)}
      catch(e:any){setError('Não foi possível salvar offline: '+String(e?.message||''))}
      return
    }

    const itens:any[]=[]
    for (const row of skuRows) {
      const hasAnyData=Boolean(
        row.sku.trim() || row.nome.trim() || row.lote.trim() || row.material.trim() ||
        row.capacidade.trim() || row.quantidade || row.quantidadePorCaixa ||
        row.caixasRecebidas || row.caixasInspecionadas || row.distribuicaoCaixas.trim() ||
        row.caixasPadrao || row.unidadesPadrao || row.caixasFracionadas || row.unidadesFracionadas ||
        row.caixasLaboratorio || row.unidadesLaboratorio || row.fotoFile || row.fotoPrincipalPath
      )
      if (!hasAnyData) continue

      const dist=boxDistributionTotals(row)
      let fotoPrincipalPath=row.fotoPrincipalPath || ''
      if (row.fotoFile) {
        const safe=row.fotoFile.name.replace(/[^a-zA-Z0-9._-]/g,'_')
        const folder=row.sku.trim() || 'temporario'
        const photoPath=`${folder}/${Date.now()}-${safe}`
        const upload=await supabase.storage.from('produto-fotos').upload(photoPath,row.fotoFile,{contentType:row.fotoFile.type||undefined})
        if (upload.error){
          setInspectionBusy(false)
          if(connectionFailure(upload.error.message)||!navigator.onLine){
            try{await queueInspectionCreate(iniciar)}catch(e:any){setError(String(e?.message||''))}
            return
          }
          return setError('Falha ao salvar foto principal do produto: '+upload.error.message)
        }
        fotoPrincipalPath=photoPath
      }

      itens.push({
        sku:row.sku.trim(),
        nome:row.nome.trim(),
        codigoCliente:row.codigoCliente.trim()||null,
        quantidadePv:row.quantidadePv.trim()===''?null:Number(row.quantidadePv),
        numeroPedidoPv:row.numeroPedidoPv||null,fstPv:row.fstPv||null,
        lote:row.lote.trim() || null,
        material:row.material.trim() || null,
        capacidade:row.capacidade.trim() || null,
        quantidade:Number(row.quantidade) || 0,
        quantidadePorCaixa:Number(row.quantidadePorCaixa) || null,
        caixasRecebidas:Number(row.caixasRecebidas) || 0,
        caixasInspecionadas:Number(row.caixasInspecionadas) || 0,
        unidadesPorConjunto:Number(row.unidadesPorConjunto || 1) || 1,
        distribuicaoCaixas:dist.groups.length ? dist.groups : null,
        fotoPrincipalPath:fotoPrincipalPath || null,
      })
    }

    const created=await apiPost<any>('/api/inspecoes/criar',{
      codigo:inspection.codigo.trim(),
      requestId:createRequestId.current,
      cliente:inspection.cliente.trim() || null,
      notaFiscal:inspection.notaFiscal.trim() || null,
      origem:inspection.origem.trim() || null,
      transporte:inspection.transporte.trim() || null,
      chegadaCd:inspection.chegadaCd || null,
      dataInspecao:inspection.dataInspecao || null,
      itVersionId:inspection.itVersionId || null,
      iniciar,
      inspectionLevel:inspection.inspectionLevel,
      observacaoInterna:inspection.observacaoInterna.trim() || null,
      itens,
    })

    if (created.error || !created.data?.id) {
      setInspectionBusy(false)
      if(created.error && (connectionFailure(created.error.message)||!navigator.onLine)){
        try{await queueInspectionCreate(iniciar)}catch(e:any){setError(String(e?.message||''))}
        return
      }
      return setError(created.error?.message || 'Falha ao criar inspeção.')
    }

    // Show the newly saved record without another round trip to the dashboard.
    const fst=inspection.codigo.trim()
    const existing=processes.find(p=>fstCode(p.codigo)===fstCode(fst))
    const processSummary:ProcessRow=existing??{
      id:'',codigo:fst?('FST'+fstCode(fst)):'',cliente:inspection.cliente.trim()||null,
      nota_fiscal:inspection.notaFiscal.trim()||null,origem:inspection.origem.trim()||null,
      transporte:inspection.transporte.trim()||null,chegada_cd:inspection.chegadaCd||null,
      data_processo:inspection.dataInspecao||new Date().toISOString().slice(0,10),
      status:'aberto',criado_em:new Date().toISOString()
    }
    const plan=created.data.plano
    const provisional:InspectionRow={
      id:created.data.id,numero:created.data.numero||'',status:iniciar?'em_andamento':'aberta',
      resultado:'pendente',tamanho_lote:plan?.lote??null,tamanho_amostra:plan?.amostra??null,
      total_inspecionado:0,total_nao_conforme:0,nivel_inspecao:inspection.inspectionLevel,
      codigo_amostragem:plan?.codigo??null,criado_em:new Date().toISOString(),
      grupos_inspecao:{
        id:created.data.grupo_inspecao_id||'',nome:skuRows.find(row=>row.nome.trim())?.nome||'Inspeção',
        tipo:skuRows.filter(row=>row.sku.trim()||row.nome.trim()).length>1?'kit_componentes':'individual',
        processo_id:existing?.id||'',processos:processSummary
      }
    }
    setInspections(old=>[provisional,...old.filter(x=>x.id!==provisional.id)])
    setMessage(iniciar?'Inspeção iniciada.':'Inspeção salva.')
    if(userId)await clearOfflineDraft(userId,'full:new')
    resetNewInspection()
    loadSequence.current++
    if(iniciar){await openInspection(created.data.id);setActiveStage('amostragem')}
    else setTab('painel')
    setInspectionBusy(false)
    void refreshLists()
    }finally{
      submitLock.current=false
      setInspectionBusy(false)
    }
  }
  async function startSavedInspection(targetStage:typeof activeStage='amostragem') {
    if(!selectedInspectionId || detail?.status!=='aberta') return
    if(!detail.it_versao_id){setPopupMessage('Selecione uma IT nos dados da inspeção antes de continuar.');setActiveStage('dados');return}
    setError('')
    const started=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/iniciar`,{})
    if(started.error){setPopupMessage(started.error.message);return}
    setDetail((d:any)=>d?{...d,status:'em_andamento'}:d)
    setActiveStage(targetStage)
    setMessage('Inspeção iniciada.')
    void refreshLists()
  }

  function selectInspectionStage(stage:typeof activeStage) {
    if(detail?.status==='aberta'&&stage!=='dados'){void startSavedInspection(stage);return}
    setActiveStage(stage)
    if(stage==='fotos'&&selectedInspectionId)void loadPhotoLinks(selectedInspectionId)
    const nav=document.getElementById('inspection-stage-nav')
    if(nav) window.scrollTo({top:Math.max(0,window.scrollY+nav.getBoundingClientRect().top-90),behavior:'smooth'})
  }

  function isDedicatedDimensionalCheck(item:any) {
    return String(item?.grupo ?? '').trim().toLowerCase()==='dimensional'
  }

  function checklistScopeQuantity(item:any) {
    return isDedicatedDimensionalCheck(item) ? 10 : Number(detail?.tamanho_amostra ?? 0)
  }

  function setChecklistNcDraft(checkId:string,value:number) {
    setDetail((d:any)=>{
      if(!d) return d
      const previous=(d.checklistResults ?? []).find((x:any)=>x.checklist_id===checkId)
      const others=(d.checklistResults ?? []).filter((x:any)=>x.checklist_id!==checkId)
      return {...d,checklistResults:[...others,{...(previous ?? {}),checklist_id:checkId,quantidade_nc:value}]}
    })
  }

  async function saveChecklist(checkId: string, result: string, quantityNc?:number) {
    if (!selectedInspectionId || !detail) return
    const item=detail.checklist?.find((x:any)=>x.id===checkId)
    const previous=(detail.checklistResults ?? []).find((x:any)=>x.checklist_id===checkId)
    const automatic=item?.classificacao_sugerida ?? null
    const scopeQty=checklistScopeQuantity(item)
    const ncQty=result==='nao_conforme'
      ? Math.min(Math.max(Number(quantityNc ?? previous?.quantidade_nc ?? 1) || 1,1),Math.max(scopeQty,1))
      : 0
    const optimistic={
      ...(previous ?? {}),
      checklist_id:checkId,
      inspecao_id:selectedInspectionId,
      resultado:result,
      quantidade_avaliada:result==='nao_aplicavel'?0:scopeQty,
      quantidade_nc:ncQty,
      severidade_confirmada:result==='nao_conforme'?automatic:null
    }
    setDetail((d:any)=>{
      const others=(d.checklistResults ?? []).filter((x:any)=>x.checklist_id!==checkId)
      return {...d,checklistResults:[...others,optimistic]}
    })
    const saved=await apiPut<any>(`/api/inspecoes/${selectedInspectionId}/checklist/${checkId}`,{
      resultado:result,
      quantidadeNc:ncQty,
    })
    if (saved.error) {
      setDetail((d:any)=>{
        const others=(d.checklistResults ?? []).filter((x:any)=>x.checklist_id!==checkId)
        return {...d,checklistResults:previous?[...others,previous]:others}
      })
      setError(saved.error.message)
      return
    }
    setDetail((d:any)=>{
      const others=(d.checklistResults ?? []).filter((x:any)=>x.checklist_id!==checkId)
      return {
        ...d,
        total_inspecionado:saved.data?.total_inspecionado ?? d.total_inspecionado,
        total_nao_conforme:saved.data?.total_nao_conforme ?? d.total_nao_conforme,
        total_conforme:Math.max(Number(saved.data?.total_inspecionado ?? d.total_inspecionado ?? 0)-Number(saved.data?.total_nao_conforme ?? d.total_nao_conforme ?? 0),0),
        checklistResults:[...others,{
          ...optimistic,
          quantidade_avaliada:saved.data?.quantidade_avaliada ?? optimistic.quantidade_avaliada,
          quantidade_nc:saved.data?.quantidade_nc ?? optimistic.quantidade_nc,
          severidade_confirmada:saved.data?.severidade ?? optimistic.severidade_confirmada,
        }]
      }
    })
    if(saved.data?.total_nao_conforme!=null) setSampleNcDraft(String(saved.data.total_nao_conforme))
    if(saved.data?.reconciliacao_nc_necessaria) {
      setMessage('Há NC em mais de uma verificação. Confirme abaixo a quantidade de unidades NC únicas usada no Ac/Re para evitar dupla contagem.')
    }
  }

  async function saveUniqueNcSummary() {
    if(!selectedInspectionId || !detail) return
    const qty=Math.max(0,Math.floor(Number(sampleNcDraft)||0))
    const max=Number(detail.tamanho_amostra ?? 0)
    if(max>0 && qty>max) return setError(`NC únicas não pode ultrapassar a amostra de ${max} unidades.`)
    const saved=await apiPut<any>(`/api/inspecoes/${selectedInspectionId}/amostragem/resumo`,{totalNaoConforme:qty})
    if(saved.error) return setError(saved.error.message)
    setDetail((d:any)=>d?{
      ...d,
      total_nao_conforme:saved.data?.total_nao_conforme ?? qty,
      total_conforme:saved.data?.total_conforme ?? Math.max(Number(d.total_inspecionado ?? 0)-qty,0),
    }:d)
    setSampleNcDraft(String(saved.data?.total_nao_conforme ?? qty))
    setMessage('Quantidade de unidades NC únicas atualizada para o cálculo Ac/Re.')
  }

  async function saveInternalObservation() {
    if (!selectedInspectionId || !canWrite) return
    const saved=await apiPut<any>(`/api/inspecoes/${selectedInspectionId}/observacao-interna`,{
      texto:internalObservation.trim() || null,
    })
    if (saved.error) return setError(saved.error.message)
    setDetail((d:any)=>d?{...d,observacao_interna:internalObservation.trim() || null}:d)
    setMessage('Observação salva.')
  }

  function getDimConfig(itemId:string, paramId:string) {
    return detail?.dimConfigs?.find((x:any)=>x.processo_item_id===itemId && x.parametro_id===paramId) ?? null
  }


  function usesMeasureReference(param:any) {
    return !String(param?.nome ?? '').trim().toLowerCase().includes('peso')
  }


  async function saveDimConfig(itemId:string, param:any, patch:any) {
    if (!selectedInspectionId) return
    const current = getDimConfig(itemId,param.id) ?? {}
    const next:any = { ...current, ...patch }
    const nominal = next.valor_nominal === '' || next.valor_nominal == null ? null : Number(next.valor_nominal)
    const deviationRaw=next.desvio ?? next.desvio_mais ?? next.desvio_menos
    const deviation = deviationRaw === '' || deviationRaw == null ? null : Math.abs(Number(deviationRaw))

    const saved=await apiPut<any>(`/api/inspecoes/${selectedInspectionId}/dimensionais/${itemId}/${param.id}/config`,{
      naoAplicavel:!!next.nao_aplicavel,
      equipamento:next.equipamento || null,
      codigoEquipamento:next.codigo_equipamento || null,
      unidade:next.unidade || param.unidade || null,
      valorNominal:nominal,
      desvio:deviation,
      desvioMenos:deviation,
      desvioMais:deviation,
      especificacaoDesvio:null,
      tipoReferencia:usesMeasureReference(param) ? (next.tipo_referencia || param.tipo_referencia || null) : null,
      referenciaOutro:(next.tipo_referencia || param.tipo_referencia)==='outro' ? (String(next.referencia_outro ?? '').trim() || null) : null,
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
      decision=nc>0?'Reprovado':'Aprovado'
    }
    return { total:rows.length, nc, c, decision }
  }


  async function markDimensionalsDone() {
    if (!selectedInspectionId) return
    const saved=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/dimensionais/finalizar`,{})
    if (saved.error) return setError(saved.error.message)
    setMessage('Análises dimensionais concluídas.')
    await openInspection(selectedInspectionId)
  }

  async function completeTests() {
    if (!selectedInspectionId||!detail)return
    const done=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/testes/finalizar`,{})
    if(done.error){setPopupMessage(done.error.message);return}
    setDetail((d:any)=>d?{...d,testes_finalizados:true}:d)
    setMessage('Testes concluídos.')
  }

  async function suggestAIConclusion(){
    if(!detail||aiConclusionBusy)return
    setAiConclusionBusy(true)
    setError('')
    try{
      const context={
        numeroFst:detail.grupos_inspecao?.processos?.codigo,
        cliente:detail.grupos_inspecao?.processos?.cliente,
        produto:detail.grupos_inspecao?.nome,
        tamanhoAmostra:detail.tamanho_amostra,
        totalInspecionado:detail.total_inspecionado,
        naoConformes:detail.total_nao_conforme,
        checklist:(detail.checklistResults??[]).map((r:any)=>({resultado:r.resultado,observacao:r.observacao})),
        dimensionais:(detail.dimResults??[]).map((r:any)=>({conforme:r.conforme,valor:r.valor_medido})),
        testes:(detail.testResults??[]).map((r:any)=>({resultado:r.resultado})),
        textoAtual:finalObservation,
      }
      const {data,error:aiError}=await authClient.functions.invoke('sgq-conclusao',{body:context})
      if(aiError||data?.error||!data?.text){setPopupMessage('Não foi possível gerar a conclusão agora. Digite o texto manualmente.');return}
      setFinalObservation(String(data.text))
      setMessage('Sugestão gerada. Revise e edite antes de finalizar.')
    }catch{setPopupMessage('Falha ao consultar a IA. Escreva a conclusão manualmente.')}
    finally{setAiConclusionBusy(false)}
  }

  async function sendWordToPowerAutomate(){
    if(!selectedInspectionId||sharepointBusy)return
    setSharepointBusy(true)
    const r=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/enviar-automate`,{})
    setSharepointBusy(false)
    if(r.error){setPopupMessage(r.error.message);return}
    setMessage('Documento encaminhado ao Power Automate.')
  }

  async function saveTest(testId: string, result: string) {
    if (!selectedInspectionId || !detail) return
    const previous=(detail.testResults ?? []).find((x:any)=>x.teste_id===testId)
    const optimistic={...(previous ?? {}),teste_id:testId,inspecao_id:selectedInspectionId,resultado:result}
    setDetail((d:any)=>{
      const others=(d.testResults ?? []).filter((x:any)=>x.teste_id!==testId)
      return {...d,testResults:[...others,optimistic]}
    })
    const saved=await apiPut<any>(`/api/inspecoes/${selectedInspectionId}/testes/${testId}`,{resultado:result})
    if (saved.error) {
      setDetail((d:any)=>{
        const others=(d.testResults ?? []).filter((x:any)=>x.teste_id!==testId)
        return {...d,testResults:previous?[...others,previous]:others}
      })
      return setError(saved.error.message)
    }
    if (saved.data?.finalizados===false) setDetail((d:any)=>d?{...d,testes_finalizados:false}:d)
  }


  function addPendingPhotos(files: FileList | null) {
    if (!files) return
    const next = Array.from(files).map((file)=>({
      id: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
      legenda: '',
      productId: '',
      isProductId: false,
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

  async function uploadInspectionPhotos(){
    if(!selectedInspectionId||!pendingPhotos.length||photoUploadBusy)return
    if(pendingPhotos.some(p=>!p.legenda.trim())){
      setPopupMessage('Informe a legenda de cada foto antes de enviar.')
      return
    }
    const inspectionId=selectedInspectionId
    setPhotoUploadBusy(true)
    setError('')
    try{
      const validIds=new Set<string>((detail?.items??[]).map((x:any)=>String(x.processo_itens?.produto_id??'')).filter(Boolean))
      const primaryId=String((detail?.items??[])[0]?.processo_itens?.produto_id??'')
      type PhotoResult={id:string;record?:any;product:boolean;error?:string}
      const outcomes:PhotoResult[]=new Array(pendingPhotos.length)
      let pointer=0
      const worker=async()=>{
        while(pointer<pendingPhotos.length){
          const index=pointer++
          const p=pendingPhotos[index]
          try{
            const safe=p.file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
            const unique=crypto.randomUUID()
            const path=`${inspectionId}/gerais/${unique}-${safe}`
            const uploaded=await supabase.storage.from('inspecao-fotos').upload(path,p.file,{contentType:p.file.type||undefined})
            if(uploaded.error){outcomes[index]={id:p.id,product:false,error:uploaded.error.message};continue}
            const productId=p.isProductId?String(p.productId||primaryId):''
            let productPhotoPath:string|null=null
            if(productId&&validIds.has(productId)){
              productPhotoPath=`${productId}/${unique}-${safe}`
              const second=await supabase.storage.from('produto-fotos').upload(productPhotoPath,p.file,{contentType:p.file.type||undefined})
              if(second.error){outcomes[index]={id:p.id,product:false,error:second.error.message};continue}
            }
            outcomes[index]={id:p.id,product:!!productPhotoPath,record:{
              storagePath:path,legenda:p.legenda.trim(),productId:productId||null,productPhotoPath
            }}
          }catch(e:any){outcomes[index]={id:p.id,product:false,error:e?.message||'Falha ao enviar foto'}}
        }
      }
      await Promise.all(Array.from({length:Math.min(3,pendingPhotos.length)},()=>worker()))
      const successes=outcomes.filter(x=>x?.record)
      const failures=outcomes.filter(x=>!x?.record)
      if(successes.length){
        const saved=await apiPost<any>(`/api/inspecoes/${inspectionId}/fotos/registrar`,{fotos:successes.map(x=>x.record)})
        if(saved.error){setPopupMessage(saved.error.message);return}
        const sentIds=new Set(successes.map(x=>x.id))
        pendingPhotos.filter(p=>sentIds.has(p.id)).forEach(p=>URL.revokeObjectURL(p.url))
        setPendingPhotos(current=>current.filter(p=>!sentIds.has(p.id)))
        photosLinksExpiration.current.delete(inspectionId)
        await openInspection(inspectionId)
        await loadPhotoLinks(inspectionId,true)
        setMessage(successes.some(x=>x.product)?'Fotos e identificação do produto salvas.':'Fotos salvas.')
      }
      if(failures.length)setPopupMessage(`${failures.length} foto(s) não foram enviadas. As fotos pendentes permanecem na seleção para nova tentativa.`)
    }finally{setPhotoUploadBusy(false)}
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
      ? 'Inspeção finalizada com pendências registradas.'
      : 'Inspeção finalizada. Agora defina a retenção das amostras.')
    void refreshLists()
    await openInspection(selectedInspectionId)
  }

  async function saveRetention() {
    if (!detail || !selectedInspectionId) return
    const selected = (detail.items ?? []).filter((link:any) => retentionRows[link.processo_itens.id]?.retain)

    if (!selected.length) {
      if (!retentionReason.trim()) return setError('Informe o motivo para não reter amostra.')
      const saved=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/retencao`,{motivoSemRetencao:retentionReason.trim(),itens:[]})
      if (saved.error) return setError(saved.error.message)
      setMessage('Inspeção encerrada sem retenção, com justificativa registrada.')
      await openInspection(selectedInspectionId)
      return
    }

    const newSelected=(selected as any[]).filter((link:any)=>!(detail.retained ?? []).some((x:any)=>x.produto_id===link.processo_itens.produto_id))
    if (!newSelected.length) return setMessage('As amostras selecionadas já estão registradas no estoque.')

    const itens:any[]=[]
    for (const link of newSelected) {
      const item=link.processo_itens
      const draft=retentionRows[item.id]
      if (!draft?.qty || !draft.address.trim()) return setError(`Informe quantidade e endereço para ${item.produtos?.nome ?? 'o produto'}.`)
      itens.push({processoItemId:item.id,quantidade:Number(draft.qty),endereco:draft.address.trim(),fotoCadastroPath:null})
    }

    const saved=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/retencao`,{motivoSemRetencao:null,itens})
    if (saved.error) return setError(saved.error.message)
    setMessage(`${saved.data?.retidos ?? itens.length} amostra(s) enviada(s) ao estoque usando a foto principal já definida na inspeção.`)
    await Promise.all([loadStock(),openInspection(selectedInspectionId)])
  }

  async function structureItVersion(itVersionId:string, openReview=true) {
    setItBusyId(itVersionId)
    setError('')
    const result=await apiPost<any>(`/api/its/${itVersionId}/estruturar`,{})
    setItBusyId(null)
    const data=result.data
    if (result.error || data?.error) {
      const msg=String(data?.message ?? result.error?.message ?? 'Falha na estruturação automática.')
      setError('Não foi possível estruturar a IT: '+msg)
      await loadCatalogs()
      return false
    }
    setMessage(`IT estruturada: ${data?.checklist ?? 0} verificações, ${data?.dimensionais ?? 0} dimensionais e ${data?.testes ?? 0} testes. Revise antes de publicar.`)
    await loadCatalogs()
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
    const loaded=await apiGet<any>(`/api/its/${it.id}/revisao`)
    setItBusyId(null)
    if (loaded.error || !loaded.data) {
      setError(loaded.error?.message || 'Não foi possível carregar a revisão da IT.')
      return
    }
    const extraction=loaded.data.extracao_ia
    setItReview({
      it,
      checklist:loaded.data.checklist ?? [],
      dimensionais:loaded.data.dimensionais ?? [],
      testes:loaded.data.testes ?? [],
      avisos:Array.isArray(extraction?.avisos_revisao) ? extraction.avisos_revisao : [],
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
    await loadCatalogs()
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
    await loadCatalogs()
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
    await loadStock()
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
    await loadStock()
  }

  async function downloadInspectionWord() {
    if (!detail || !selectedInspectionId) return
    setError('')
    if (!detail.it_versao_id) {
      setMessage('')
      return setError('Esta inspeção não possui IT vinculada. Para gerar o Word oficial, vincule uma IT com modelo Word.')
    }
    setMessage('Gerando Word…')
    const session=await supabase.auth.getSession()
    const token=session.data.session?.access_token
    if (!token) return setError('Sua sessão expirou. Entre novamente no SGQ.')

    let response:Response
    try {
      response=await fetch(`${apiUrl}/api/inspecoes/${selectedInspectionId}/laudo`,{
        method:'POST',
        headers:{Authorization:`Bearer ${token}`},
      })
    } catch {
      setMessage('')
      return setError('O serviço de geração do Word não respondeu. Tente novamente em alguns segundos.')
    }
    if (!response.ok) {
      let msg='Não foi possível gerar o Word pelo modelo oficial da IT.'
      try {
        const body=await response.json()
        msg=body?.detail || body?.error?.message || body?.message || msg
      } catch {}
      setMessage('')
      return setError(msg)
    }

    const blob=await response.blob()
    const disposition=response.headers.get('content-disposition') || ''
    const utf=disposition.match(/filename\*=UTF-8''([^;]+)/i)
    const basic=disposition.match(/filename="?([^";]+)"?/i)
    const filename=decodeURIComponent(utf?.[1] || basic?.[1] || `${detail.numero}.docx`)
    const href=URL.createObjectURL(blob)
    const a=document.createElement('a')
    a.href=href
    a.download=filename
    a.click()
    setTimeout(()=>URL.revokeObjectURL(href),1500)
    setMessage('Word preenchido no modelo oficial da IT e armazenado no SGQ.')
  }

  if (!sessionReady) return <div className="center-screen">Carregando SGQ…</div>


  if (!userId || recoveryMode) {
    return (
      <main className="login-shell">
        {recoveryMode ? (
          <form className="login-card" onSubmit={finishPasswordRecovery}>
            <div className="brand-mark"><ShieldCheck size={28}/><span>SGQ</span></div>
            <h1>Definir nova senha</h1>
            {userId && recoveryVerified ? (
              <>
                <p>Crie uma nova senha para acessar o Sistema SGQ.</p>
                <label>Nova senha<input type="password" minLength={8} autoComplete="new-password" value={recoveryPassword} onChange={e=>setRecoveryPassword(e.target.value)} required/></label>
                <label>Confirmar nova senha<input type="password" minLength={8} autoComplete="new-password" value={recoveryConfirmation} onChange={e=>setRecoveryConfirmation(e.target.value)} required/></label>
              </>
            ) : <p>{recoveryUrlError === 'otp_expired' ? 'Este link de recuperação já foi usado ou expirou. Solicite um novo e-mail.' : 'O link de recuperação ainda não foi validado ou expirou. Solicite um novo e-mail.'}</p>}
            {error && <div className="alert error" role="alert">{error}</div>}
            {message && <div className="alert success" role="status">{message}</div>}
            {userId && recoveryVerified && <button className="primary" type="submit" disabled={authBusy}>{authBusy ? 'Salvando…' : 'Salvar nova senha'}</button>}
            {(!userId || !recoveryVerified) && <button className="secondary" type="button" onClick={()=>{clearRecoveryUrl();setRecoveryMode(false);setRecoveryVerified(false);setForgotPassword(true);setError('');setMessage('')}}>Solicitar novo link</button>}
          </form>
        ) : (
          <form className="login-card" onSubmit={forgotPassword ? requestPasswordReset : signIn}>
            <div className="brand-mark"><ShieldCheck size={28}/><span>SGQ</span></div>
            <h1>{forgotPassword ? 'Recuperar senha' : 'SGQ · Qualidade'}</h1>
            <label>E-mail<input type="email" autoComplete="email" value={login.email} onChange={(e)=>setLogin({...login,email:e.target.value})} required/></label>
            {!forgotPassword && <label>Senha<input type="password" autoComplete="current-password" value={login.password} onChange={(e)=>setLogin({...login,password:e.target.value})} required/></label>}
            {forgotPassword && <p>Informe o e-mail cadastrado para receber um link de redefinição de senha.</p>}
            {error && <div className="alert error" role="alert">{error}</div>}
            {message && <div className="alert success" role="status">{message}</div>}
            <button className="primary" type="submit" disabled={authBusy}>{authBusy ? 'Aguarde…' : forgotPassword ? 'Enviar link de recuperação' : 'Entrar'}</button>
            <button className="link-button" type="button" onClick={()=>{setForgotPassword(!forgotPassword);setError('');setMessage('');setLogin(current=>({...current,password:''}))}}>
              {forgotPassword ? 'Voltar para login' : 'Esqueci minha senha'}
            </button>
          </form>
        )}
      </main>
    )
  }

  if (!profile) return <div className="center-screen">{error || 'Carregando perfil…'}</div>

  if(tab==='fotos-mobile')return <Suspense fallback={<div className="center-screen">Carregando Modo Fotos…</div>}>
    <MobileFotos processes={processes} inspections={inspections} canWrite={!!canWrite} userId={userId||''}
      onRefresh={refreshLists}
      onExit={()=>{setTab('painel');void loadCatalogs();void loadStock();void refreshEquipments()}}/>
  </Suspense>

  const checklistDone = detail ? (detail.checklist?.length ?? 0) === 0 || (detail.checklistResults?.length ?? 0) >= detail.checklist.length : false
  const dimsDone = detail ? (detail.params?.length ?? 0) === 0 || detail.dimensionais_finalizados : false
  const testsDone = detail ? (detail.tests?.length ?? 0) === 0 || !!detail.testes_finalizados : false
  const samplingDone = detail ? (detail.total_inspecionado ?? 0) >= (detail.tamanho_amostra ?? 0) || (!!detail.limite_rejeicao && detail.total_nao_conforme >= detail.limite_rejeicao) : false

  return (
    <main className="app-shell sgq-operational-shell">
      <aside className="sgq-side-nav">
        <div className="sgq-side-brand"><ShieldCheck size={23}/><div><b>SGQ</b><small>Qualidade · Operações</small></div></div>
        <div className="sgq-side-caption">OPERAÇÃO</div>
        <button className={tab==='painel'?'selected':''} onClick={()=>setTab('painel')}><LayoutDashboard size={18}/> Painel</button>
        <button className={tab==='insights'?'selected':''} onClick={()=>setTab('insights')}><BarChart3 size={18}/> Insights</button>
        <button className={tab==='inspecoes'||tab==='execucao'?'selected':''} onClick={()=>setTab('inspecoes')}><ClipboardCheck size={18}/> Inspeções</button>
        <button className="" onClick={()=>setTab('fotos-mobile')}><Camera size={18}/> Modo Fotos</button>
        <button className={tab==='nova'?'selected':''} onClick={()=>{resetNewInspection();setTab('nova')}}><Plus size={18}/> Nova inspeção</button>
        <button className={tab==='estoque'?'selected':''} onClick={()=>setTab('estoque')}><Warehouse size={18}/> Estoque</button>
        <button className={tab==='auditorias'?'selected':''} onClick={()=>{setTab('auditorias');setError('')}}><ClipboardCheck size={18}/> Inspeções Armazém</button>
        <div className="sgq-side-caption">QUALIDADE</div>
        <button className={tab==='its'?'selected':''} onClick={()=>setTab('its')}><FileText size={18}/> Instruções técnicas</button>
        <button className={tab==='equipamentos'?'selected':''} onClick={()=>{setTab('equipamentos');void refreshEquipments()}}><Wrench size={18}/> Equipamentos</button>
        <div className="sgq-side-footer"><small>{profile.nome || 'Usuário'}</small><button type="button" onClick={()=>void supabase.auth.signOut()}><LogOut size={14}/> Sair</button></div>
      </aside>
      <header className="topbar" aria-label="Cabeçalho do SGQ">
        <div className="sgq-topbar-context">
          <PackageSearch size={22} aria-hidden="true"/>
          <span>SGQ</span>
          <span className="sgq-topbar-separator" aria-hidden="true">/</span>
          <strong>{({
            painel:'Painel',insights:'Insights',inspecoes:'Inspeções',nova:'Nova inspeção',
            execucao:'Execução da inspeção',estoque:'Estoque',
            auditorias:'Inspeções Armazém',its:'Instruções técnicas',equipamentos:'Equipamentos',
          } as Record<typeof tab,string>)[tab]}</strong>
        </div>
        <div className="userbox">
          <span>{profile.nome || 'Usuário'} · {profile.perfil}</span>
          <button type="button" className="sgq-offline-indicator" data-pending={offlinePending>0||offlineConflicts>0} title={offlineError||'Sincronização do dispositivo'}
            onClick={()=>{if(isOnline&&userId)void syncOfflineNow(userId);else setPopupMessage(offlineConflicts?'Existem registros com conflito. Seus dados permanecem salvos neste dispositivo.':'Os registros pendentes estão salvos neste dispositivo.')}}>
            {isOnline?<CloudUpload size={15}/>:<CloudOff size={15}/>}
            {offlineConflicts?'Revisar '+offlineConflicts:offlinePending?offlinePending+' pendente(s)':!isOnline?'Salvo offline':'Sincronizado'}
          </button>
          <button type="button" aria-label="Sair do SGQ" title="Sair" onClick={()=>void supabase.auth.signOut()}><LogOut size={18}/></button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {popupMessage && <div className="sgq-dialog-backdrop" role="presentation" onClick={()=>setPopupMessage('')}>
        <div className="sgq-dialog" role="alertdialog" aria-modal="true" aria-label="Atenção" onClick={e=>e.stopPropagation()}>
          <div className="sgq-dialog-symbol"><ShieldCheck size={24}/></div><h2>Verifique as informações</h2>
          <p>{popupMessage}</p><button className="primary" type="button" autoFocus onClick={()=>setPopupMessage('')}>Entendi</button>
        </div>
      </div>}
      {message && <div className="alert success">{message}</div>}
      {offlineError && <div className="alert error" role="alert">{offlineError}</div>}

      {tab==='insights' && <Suspense fallback={<div className="center-screen">Carregando Insights…</div>}>
        <InsightsPage onOpenInspection={id=>void openInspection(id)}/>
      </Suspense>}

      {tab==='auditorias' && (
        <section className="workspace audit-workspace" aria-label="Inspeções Armazém">
          <Suspense fallback={<div className="audit-center">Carregando inspeções do armazém…</div>}>
            <AuditoriasPage profileName={profile.nome} canDelete={!!canDelete} canManageTemplates={!!canManageIts}/>
          </Suspense>
        </section>
      )}

      {tab==='painel' && (
        <section className="workspace">
          <div className="page-title">
            <div><span className="eyebrow">SGQ</span><h1>Painel</h1></div>
            <button className="primary" onClick={()=>{resetNewInspection();setTab('nova')}}><Plus size={18}/> Nova inspeção</button>
          </div>
          <section className="metrics">
            <button type="button" className={'metric-button '+(dashboardView==='processos'?'selected':'')} onClick={()=>setDashboardView('processos')}><Metric icon={ClipboardCheck} label="Processos" value={processes.length}/></button>
            <button type="button" className={'metric-button '+(dashboardView==='inspecoes'?'selected':'')} onClick={()=>setDashboardView('inspecoes')}><Metric icon={ShieldCheck} label="Inspeções" value={inspections.length}/></button>
            <button type="button" className={'metric-button '+(dashboardView==='estoque'?'selected':'')} onClick={()=>setDashboardView('estoque')}><Metric icon={Boxes} label="Estoque" value={samples.length}/></button>
            <button type="button" className={'metric-button '+(dashboardView==='concluidas'?'selected':'')} onClick={()=>setDashboardView('concluidas')}><Metric icon={FileText} label="Concluídas" value={inspections.filter((i)=>i.status==='concluida').length}/></button>
          </section>
          {dashboardView==='processos' && <section className="panel queue"><div className="section-title"><h2>Processos</h2><button className="secondary" type="button" onClick={()=>setTab('inspecoes')}>Ver todos</button></div>
            {processes.slice(0,25).map(p=><div className="queue-row" key={p.id}><div><strong>{formatFst(p.codigo)} - {p.cliente||'Cliente não informado'}</strong><span>{p.nota_fiscal?'NF '+p.nota_fiscal:'NF não informada'}</span></div><button className="secondary small" onClick={()=>setTab('inspecoes')}>Inspeções</button></div>)}
            {!processes.length&&<p>Nenhum processo ativo no momento. Os registros arquivados permanecem preservados no SGQ.</p>}
          </section>}
          {dashboardView==='estoque' && <section className="panel queue"><div className="section-title"><h2>Estoque</h2><button className="secondary" onClick={()=>setTab('estoque')}>Abrir estoque</button></div>
            {samples.slice(0,25).map(item=><div className="queue-row" key={item.id}><div><strong>{formatFst(item.processo_referencia)} - {item.cliente_referencia||'Cliente não informado'}</strong><span>{item.sku||item.descricao} · {item.saldo} {item.unidade_controle}</span></div><button className="secondary small" onClick={()=>{setTab('estoque');setSelectedSample(item)}}>Ver item</button></div>)}
            {!samples.length&&<p>Nenhuma amostra em estoque.</p>}
          </section>}
          {dashboardView==='concluidas' && <section className="panel queue"><div className="section-title"><h2>Inspeções concluídas</h2><button className="secondary" onClick={()=>setTab('inspecoes')}>Ver todas</button></div>
            {inspections.filter(i=>i.status==='concluida').slice(0,25).map(i=><div className="queue-row" key={i.id}><div><strong>{inspectionDisplay(i)}</strong><span>{statusLabel(i.resultado)} · {formatDateBR(i.criado_em)}</span></div><button className="secondary small" onClick={()=>openInspection(i.id)}>Abrir relatório</button></div>)}
            {!inspections.some(i=>i.status==='concluida')&&<p>Nenhuma inspeção concluída.</p>}
          </section>}
          {dashboardView==='inspecoes' && <>
          <section className="panel queue">
            <div className="section-title"><h2>Inspeções não iniciadas</h2><button className="secondary" onClick={()=>setTab('inspecoes')}>Ver todas</button></div>
            {inspections.filter(i=>i.status==='aberta').slice(0,8).map(i=>(
              <div className="queue-row" key={i.id}>
                <div><strong>{inspectionDisplay(i)}</strong><span>{i.grupos_inspecao?.nome || 'Inspeção em preenchimento'} · Não iniciada</span></div>
                <button className="secondary small" onClick={()=>openInspection(i.id)}><Edit3 size={15}/> Abrir inspeção</button>
              </div>
            ))}
            {!inspections.some(i=>i.status==='aberta') && <div className="empty">Nenhuma inspeção não iniciada.</div>}
          </section>
          <section className="panel queue">
            <div className="section-title">
              <h2>Inspeções em andamento</h2>
              <button className="secondary" onClick={()=>setTab('inspecoes')}>Ver todas</button>
            </div>
            {inspections.filter((i)=>i.status==='em_andamento').slice(0,8).map((i)=>(
              <div className="queue-row" key={i.id}>
                <div>
                  <strong>{inspectionDisplay(i)}</strong>
                  <span>{i.grupos_inspecao?.nome} · Recebimento {formatDateBR(i.grupos_inspecao?.processos?.chegada_cd || i.grupos_inspecao?.processos?.data_processo)} · {i.total_inspecionado}/{i.tamanho_amostra ?? 0} unidades</span>
                </div>
                <button className="primary small" onClick={()=>openInspection(i.id)}><Play size={15}/> Continuar</button>
              </div>
            ))}
            {!inspections.some((i)=>i.status==='em_andamento') && <div className="empty">Nenhuma inspeção em andamento.</div>}
          </section>
          </>}
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
              const related=inspectionsByProcess.get(p.id)??[]
              return (
                <article className="process-card" key={p.id}>
                  <div className="process-head">
                    <div>
                      <span className="eyebrow">{formatFst(p.codigo)}</span>
                      <h2>{p.cliente || 'Sem cliente'}</h2>
                      <p>NF {p.nota_fiscal || '—'} · chegada {formatDateBR(p.chegada_cd)} · {p.origem || 'origem não informada'}</p>
                    </div>
                    <div className="row-actions">
                      <button className="secondary" onClick={()=>reuseProcess(p)}><Copy size={15}/> Nova inspeção neste processo</button>
                      <button className="secondary icon-only" title="Editar processo" onClick={()=>editProcessFull(p)}><Edit3 size={16}/></button>
                      {canDelete && <button className="danger icon-only" type="button" title={deletingProcessId===p.id?'Excluindo processo…':'Excluir processo'} aria-label={deletingProcessId===p.id?'Excluindo processo':'Excluir processo'} disabled={deletingProcessId!==null} onClick={()=>deleteProcess(p)}><Trash2 size={16}/></button>}
                    </div>
                  </div>
                  <div className="inspection-sublist">
                    {related.map((i)=>(
                      <div className="inspection-row sgq-inspection-card" key={i.id}>
                        <div>
                          <strong>{inspectionDisplay(i)}</strong>
                          <span>{statusLabel(i.status)} · {i.grupos_inspecao?.nome} · {i.total_inspecionado}/{i.tamanho_amostra ?? 0}</span>
                        </div>
                        <div className="row-actions">
                          {i.resultado && i.resultado!=='pendente' && <span className={'result-badge '+i.resultado}>{statusLabel(i.resultado)}</span>}
                          <button className="primary small" onClick={()=>openInspection(i.id)}>{i.status==='concluida'?'Abrir':i.status==='aberta'?'Editar / iniciar':'Continuar'}</button>
                          {canDelete && <button className="danger icon-only" title="Excluir inspeção" onClick={()=>deleteInspection(i)}><Trash2 size={15}/></button>}
                        </div>
                      </div>
                    ))}
                    {!related.length && <span className="muted">Nenhuma inspeção neste processo.</span>}
                  </div>
                </article>
              )
            })}
            {!processes.length && <div className="empty">Nenhum processo ativo no momento. Se necessário, inicie uma nova inspeção.</div>}
          </div>
        </section>
      )}

      {tab==='nova' && (
        <section className="workspace">
          <div className="page-title">
            <div><span className="eyebrow">INSPEÇÃO</span><h1>{editingInspectionId?'Editar inspeção':editingProcessId?'Editar processo':'Nova inspeção'}</h1></div>
            <div className="row-actions">
              
              {processes[0] && <button className="secondary" type="button" onClick={()=>reuseProcess(processes[0])}><Copy size={16}/> Reutilizar últimos dados gerais</button>}
              {inspection.processoId && <button className="secondary" type="button" onClick={resetNewInspection}>Novo processo</button>}
            </div>
          </div>

          {offlineDraftStatus && <span className="sgq-offline-indicator"><CloudUpload size={14}/>{offlineDraftStatus}</span>}
          <form onSubmit={(e)=>void createInspection(e,(e.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='iniciar')} className="inspection-form">
            <section className="panel section-card">
              <div className="section-title">
                <h2>Dados gerais</h2>
                {inspection.processoId && <span className="pill">Processo existente</span>}
              </div>
              <div className="form-grid">
                <div className="sgq-fst-field">
                  <label htmlFor="sgq-fst-input">Processo</label>
                  <div className="sgq-fst-controls">
                    <div className="fst-input"><span>FST</span><input id="sgq-fst-input" value={inspection.codigo} onChange={(e)=>{const inputValue=e.target.value;fstLookupRequest.current++;fstNfeRequest.current++;fstLookupInFlight.current=null;setProcessLookupBusy(false);setProcessLookupMessage('');setOmieSkuImport(null);setOmieSkuReview(null);setOmieSkuReviewError('');setOmieOrderPickerOpen(false);setOmieOrders(null);setOmieSelectedOrder('');setSkuRows(rows=>{const retained=rows.filter(row=>!row.omieSourceFst||row.omieSourceFst===fstCode(inputValue));return retained.length?retained:[emptySku()]});setInspection(current=>{const prev=autoNfeRef.current;const clear=prev&&fstCode(inputValue)!==prev.fst&&current.notaFiscal===prev.numero;if(clear)autoNfeRef.current=null;return {...current,codigo:inputValue,notaFiscal:clear?'':current.notaFiscal}})}} onBlur={e=>void lookupFstClient(e.target.value)} placeholder="Número FST"/></div>
                    <button type="button" className="secondary sgq-fst-retry" disabled={processLookupBusy||!fstCode(inspection.codigo)}
                      onMouseDown={e=>e.preventDefault()} onClick={()=>void lookupFstClient(inspection.codigo)} title="Buscar cliente e SKUs no Omie">
                      <Search size={16}/> Consultar
                    </button>
                  </div>
                  {processLookupBusy && <small className="field-hint" role="status">Consultando cliente e SKUs no Omie…</small>}
                  {!processLookupBusy && processLookupMessage && <small className="field-hint" role="status">{processLookupMessage}</small>}


                </div>
                <label>Cliente<input value={inspection.cliente} onChange={(e)=>setInspection({...inspection,cliente:e.target.value})}/></label>
                <label>Nota fiscal<input value={inspection.notaFiscal} onChange={(e)=>{autoNfeRef.current=null;setInspection({...inspection,notaFiscal:e.target.value})}}/></label>
                <label>Chegada no CD<input type="date" value={inspection.chegadaCd} onChange={(e)=>setInspection({...inspection,chegadaCd:e.target.value})}/></label>
                <label>Origem<input value={inspection.origem} onChange={(e)=>setInspection({...inspection,origem:e.target.value})} placeholder="China"/></label>
                <div className="field-label"><span>Transporte</span><div className="transport-checks">
                  <label className="check-option"><input type="checkbox" checked={inspection.transporte.includes('Aéreo')} onChange={()=>setInspection({...inspection,transporte:toggleTransport(inspection.transporte,'Aéreo')})}/><span>Aéreo</span></label>
                  <label className="check-option"><input type="checkbox" checked={inspection.transporte.includes('Marítimo')} onChange={()=>setInspection({...inspection,transporte:toggleTransport(inspection.transporte,'Marítimo')})}/><span>Marítimo</span></label>
                </div></div>
                <label>Data da inspeção<input type="date" value={inspection.dataInspecao} onChange={(e)=>setInspection({...inspection,dataInspecao:e.target.value})}/></label>

                <label>Nível de inspeção
                  <select value={inspection.inspectionLevel} onChange={(e)=>setInspection({...inspection,inspectionLevel:e.target.value})}>
                    <option value="I">Nível I</option>
                    <option value="II">Nível II</option>
                    <option value="III">Nível III</option>
                    <option value="S1">Especial S1</option>
                    <option value="S2">Especial S2</option>
                    <option value="S3">Especial S3</option>
                    <option value="S4">Especial S4</option>
                  </select>
                </label>
                <label className="span-2">Observação interna
                  <textarea rows={3} value={inspection.observacaoInterna} onChange={(e)=>setInspection({...inspection,observacaoInterna:e.target.value})}/>
                  
                </label>
              </div>
            </section>

            <section className="panel section-card">
              <div className="section-title">
                <h2>Produtos / componentes</h2>
                <div className="row-actions">
                  {omieSkuImport?.codigo===fstCode(inspection.codigo) &&
                    <button type="button" className="secondary" onClick={()=>openOmieSkuReview(omieSkuImport)}><Boxes size={16}/> Revisar SKUs · PV {omieSkuImport.numeroPedido}</button>}
                  <button type="button" className="secondary" onClick={()=>{setExpandedSkuIndex(skuRows.length);setSkuRows([...skuRows,emptySku()])}}><Plus size={16}/> Adicionar código</button>
                </div>
              </div>
              <div className="sku-editor">
                {skuRows.map((row,i)=>{
                  const boxes=Number(row.caixasRecebidas) || 0
                  const inspect=Number(row.caixasInspecionadas) || 0
                  return (
                    <article className="sku-card" key={i}>
                      <div className="sku-card-head">
                        <button type="button" className="sgq-sku-toggle"
                          aria-expanded={expandedSkuIndex===i} aria-controls={'sgq-sku-body-'+i}
                          onClick={()=>setExpandedSkuIndex(current=>current===i?null:i)}>
                          <ChevronDown className={'sgq-sku-chevron '+(expandedSkuIndex===i?'open':'')} size={19}/>
                          <span className="sgq-sku-summary">
                            <strong>{skuRows.length>1?'Componente '+(i+1):'Produto'} · {row.sku||'Novo código'}</strong>
                            <small>{row.nome||'Preencha os dados deste componente'}{row.quantidade?' · '+Number(row.quantidade).toLocaleString('pt-BR')+' un':''}</small>
                          </span>
                        </button>
                        {skuRows.length>1 && <button type="button" className="icon-button" aria-label={'Remover componente '+(i+1)}
                          onClick={()=>{setSkuRows(skuRows.filter((_,j)=>j!==i));setExpandedSkuIndex(current=>current===null?null:current===i?null:current>i?current-1:current)}}><X size={16}/></button>}
                      </div>
                      <div id={'sgq-sku-body-'+i} className="sgq-sku-collapsible" hidden={expandedSkuIndex!==i}>
                      <div className="form-grid">
                        <label className="product-search-field">Código / produto
                          <div className="input-action">
                            <input value={row.sku} onChange={(e)=>{ const value=e.target.value; setSkuRows(skuRows.map((r,j)=>j===i?{...r,sku:value,omieStatus:'',omieMessage:'',suggestions:[]}:r)); queueProductSuggestions(i,value) }} onBlur={()=>window.setTimeout(()=>lookupProduct(i),180)} placeholder="Digite código ou parte do nome"/>
                            <button type="button" className="secondary icon-only" title="Consultar no OMIE" onClick={()=>lookupProduct(i)}><Search size={16}/></button>
                          </div>
                          {row.suggesting && <small className="field-status">Buscando sugestões…</small>}
                          {!!row.suggestions?.length && <div className="product-suggestions">
                            {row.suggestions.map((s:any,k:number)=><button type="button" key={s.sku+'-'+k} onMouseDown={(e)=>e.preventDefault()} onClick={()=>chooseProductSuggestion(i,s)}><b>{s.sku}</b><span>{s.nome}</span></button>)}
                          </div>}
                        </label>
                        <label>Descrição
                          <input value={row.nome} onChange={e=>setSkuRows(old=>old.map((r,j)=>j===i?{...r,nome:e.target.value}:r))} placeholder="Descrição do produto (Omie ou manual)"/>
                          {row.omieStatus==='loading' && <small className="field-status">{row.omieMessage || 'Consultando OMIE…'}</small>}
                          {row.omieStatus==='found' && <small className="field-status ok">{row.omieMessage || 'Produto confirmado no OMIE'}</small>}
                          {row.omieStatus==='not_found' && <small className="field-status bad">{row.omieMessage || 'Código não encontrado no OMIE'}</small>}
                          {row.omieStatus==='not_configured' && <small className="field-status warn">{row.omieMessage || 'Integração OMIE não configurada'}</small>}
                          {row.omieStatus==='error' && <small className="field-status bad">{row.omieMessage || 'Falha ao consultar o OMIE'}</small>}
                        </label>
                        <label>Código do cliente<input value={row.codigoCliente} onChange={e=>setSkuRows(rows=>rows.map((r,j)=>j===i?{...r,codigoCliente:e.target.value}:r))} placeholder="Código informado pelo cliente"/></label>
                        <label>Lote<input value={row.lote} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,lote:e.target.value}:r))}/></label>
                        <label>Material<input value={row.material} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,material:e.target.value}:r))}/></label>
                        <label>Capacidade<input value={row.capacidade} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,capacidade:e.target.value}:r))}/></label>
                        {row.numeroPedidoPv && <label>Quantidade original PV {row.numeroPedidoPv}<input type="number" value={row.quantidadePv} readOnly aria-label="Quantidade original do PV Omie"/></label>}
                        <label>Quantidade total recebida<input type="number" step="0.01" value={row.quantidade} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,quantidade:e.target.value}:r))}/>
                          {row.omieSourcePedido && <small className="field-hint">Referência: quantidade do PV {row.omieSourcePedido}. Confirme o recebimento físico.</small>}
                        </label>
                        <label>Caixas recebidas<input type="number" step="0.01" value={row.caixasRecebidas} onChange={(e)=>{
                          const received=e.target.value
                          const calc=received ? String(boxesToInspect(Number(received))) : ''
                          setSkuRows(skuRows.map((r,j)=>j===i?{...r,caixasRecebidas:received,caixasInspecionadas:calc}:r))
                        }}/></label>
                        <label>Caixas inspecionadas<input type="number" step="0.01" value={row.caixasInspecionadas} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,caixasInspecionadas:e.target.value}:r))}/><small className="field-hint">Sugerido pela tabela da IT; pode ser alterado.</small></label>
                        <div className="span-2 box-distribution-editor">
                          <div className="field-label"><span>Distribuição para armazenagem · {row.sku || (isComponentSet?'Componente '+(i+1):'Produto')}</span></div>
                          <div className="distribution-grid">
                            <div className="distribution-line"><strong>Padrão</strong><label>Caixas<input type="number" min="0" step="1" value={row.caixasPadrao} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?updateBoxDistributionField(r,'caixasPadrao',e.target.value):r))}/></label><label>Un/caixa<input type="number" min="0" step="0.01" value={row.unidadesPadrao || row.quantidadePorCaixa} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?updateBoxDistributionField(r,'unidadesPadrao',e.target.value):r))}/></label></div>
                            <div className="distribution-line"><strong>Fracionada</strong><label>Caixas<input type="number" min="0" step="1" value={row.caixasFracionadas} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?updateBoxDistributionField(r,'caixasFracionadas',e.target.value):r))}/></label><label>Un/caixa<input type="number" min="0" step="0.01" value={row.unidadesFracionadas} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?updateBoxDistributionField(r,'unidadesFracionadas',e.target.value):r))}/></label></div>
                          </div>
                          <div className="lab-withdrawal">
                            <label>Retirada para laboratório (unidades)
                              <input type="number" min="0" step="1" value={row.unidadesLaboratorio} onChange={e=>setSkuRows(skuRows.map((r,j)=>j===i?setLaboratoryUnits(r,e.target.value):r))}/>
                            </label>
                            <small>Retirada em unidades, sem acrescentar caixas à armazenagem.</small>
                          </div>
                          {(()=>{
                            const d=boxDistributionTotals(row)
                            if(!d.groups.length) return null
                            const mismatch=Math.abs(d.totalUnits-Number(row.quantidade))>0.0001
                            return <small className={'field-status '+(mismatch?'bad':'ok')}>
                              Armazenagem: {d.units.toLocaleString('pt-BR')} un ({d.boxes} caixa(s))
                              {' + '}laboratório: {d.labUnits.toLocaleString('pt-BR')} un
                              {' = '}{d.totalUnits.toLocaleString('pt-BR')} un recebidas
                              {mismatch?' — confira as quantidades deste componente.':' — conferência fechada.'}
                            </small>
                          })()}
                        </div>
                        {isComponentSet && <label>Unidades por conjunto<input type="number" step="0.01" value={row.unidadesPorConjunto} onChange={(e)=>setSkuRows(skuRows.map((r,j)=>j===i?{...r,unidadesPorConjunto:e.target.value}:r))}/></label>}
                      </div>
                      <div className="computed">
                        <span>Caixas recebidas <b>{boxes || '—'}</b></span>
                        <span>Caixas inspecionadas <b>{inspect || '—'}</b></span>
                      </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>

            <section className="panel section-card inspection-it-choice">
              <div className="section-title"><h2>IT aplicável</h2><button className="secondary small" type="button" disabled={itSuggestBusy} onClick={()=>void suggestApplicableIt(true)}><Sparkles size={16}/>{itSuggestBusy?'Analisando…':'Sugerir com IA'}</button></div>
              <label>IT para os produtos cadastrados
                <select value={inspection.itVersionId} onChange={e=>{
                  manualItSelection.current=true
                  const selected=itVersions.find(it=>it.id===e.target.value)
                  setInspection(old=>({...old,itVersionId:e.target.value,inspectionLevel:selected?.nivel_inspecao_padrao||old.inspectionLevel}))
                  setItSuggestionNote('')
                }}>
                  <option value="">Selecione uma IT</option>
                  {itVersions.filter(it=>it.status==='publicada').map(it=><option key={it.id} value={it.id}>{it.instrucoes_trabalho?.codigo} · {it.instrucoes_trabalho?.titulo} · {it.versao}</option>)}
                </select>
              </label>
              {itSuggestionNote && <p className="field-hint" role="status">{itSuggestionNote}</p>}
            </section>

            <section className="calc-strip">
              <div><small>Tipo</small><strong>{isComponentSet?'Conjunto / componentes':'Produto independente'}</strong></div>
              <div><small>Lote estatístico</small><strong>{statisticalLot?statisticalLot.toLocaleString('pt-BR'):'—'}</strong></div>
              <div><small>Plano</small><strong>{previewPlan.code?(previewPlan.code+' · '+previewPlan.sample+' un.'):'—'}</strong></div>
              <div><small>Distribuição de caixas</small><strong>Por componente / SKU</strong></div>
            </section>

            <div className="actions inspection-create-actions">
              <button className="secondary" type="submit" value="salvar" disabled={inspectionBusy}><FileText size={17}/>{inspectionBusy?'Salvando…':'Salvar'}</button>
              {!editingInspectionId && !editingProcessId && <button className="primary" type="submit" value="iniciar" disabled={inspectionBusy}><Play size={17}/> Iniciar inspeção</button>}
            </div>
          </form>
        </section>
      )}

      {tab==='execucao' && detail && (
        <section className="workspace execution">
          <div className="page-title">
            <div>
              <span className="eyebrow">{formatFst(detail.grupos_inspecao?.processos?.codigo)}</span>
              <h1>{detail.grupos_inspecao?.processos?.cliente || detail.grupos_inspecao?.nome || 'Inspeção'}</h1>
            </div>
            <div className="row-actions">
              <span className="pill">{statusLabel(detail.status)}</span>
              {detail.status!=='concluida' && canWrite && <button className="secondary" type="button" onClick={()=>void editInspectionFull(detail.id)}><Edit3 size={16}/> Editar dados</button>}

              {detail.status==='concluida' && <button className="secondary" onClick={downloadInspectionWord}><FileDown size={16}/> Word preenchido</button>}
              {detail.status==='concluida' && <button className="secondary" type="button" disabled={sharepointBusy} onClick={()=>void sendWordToPowerAutomate()}><FileText size={16}/>{sharepointBusy?'Enviando…':'Enviar ao SharePoint'}</button>}
              {canDelete && <button className="danger icon-only" title="Excluir inspeção" onClick={()=>deleteInspection({id:detail.id,numero:detail.numero})}><Trash2 size={16}/></button>}
            </div>
          </div>

          <nav id="inspection-stage-nav" className="inspection-stage-tabs" role="tablist" aria-label="Etapas da inspeção">
            {([
              ['dados','Dados',true],['amostragem','Amostragem',samplingDone],
              ['verificacoes','Verificações',checklistDone],['dimensionais','Dimensionais',dimsDone],
              ['testes','Testes',testsDone],['fotos','Fotos',Boolean(detail.photos?.length)],
              ['resultado','Resultado',detail.status==='concluida'],
              ['retencao','Retenção',detail.retencao_decisao!=null],
            ] as Array<[typeof activeStage,string,boolean]>).map(([key,label,done])=>(
              <button key={key} type="button" role="tab" aria-selected={activeStage===key}
                className={'inspection-stage-tab'+(activeStage===key?' active':'')+(done?' done':'')}
                onClick={()=>selectInspectionStage(key)}>
                <span className="inspection-stage-dot">{done?'✓':'·'}</span>{label}
              </button>
            ))}
          </nav>
          {detail.status==='aberta' && activeStage!=='dados' && (
            <div className="inspection-not-started-hint">Esta inspeção ainda não foi iniciada. Revise os dados, selecione uma IT e clique em <strong>Iniciar inspeção</strong> antes de registrar verificações.</div>
          )}

          <section id="sec-dados" className={'panel section-card internal-note-panel inspection-stage'+(activeStage==='dados'?'':' inspection-stage-hidden')}>
            <div className="section-title"><div><h2>Dados iniciais da inspeção</h2></div>
              {canWrite && detail.status!=='concluida' && <button className="secondary small" type="button" onClick={()=>void editInspectionFull(detail.id)}><Edit3 size={16}/> Editar dados e IT</button>}
            </div>
            <div className="inspection-data-summary">
              <div><small>Processo</small><strong>{formatFst(detail.grupos_inspecao?.processos?.codigo)}</strong></div>
              <div><small>Cliente</small><strong>{detail.grupos_inspecao?.processos?.cliente || '—'}</strong></div>
              <div><small>Nota fiscal</small><strong>{detail.grupos_inspecao?.processos?.nota_fiscal || '—'}</strong></div>
              <div><small>Origem / transporte</small><strong>{detail.grupos_inspecao?.processos?.origem || '—'} · {detail.grupos_inspecao?.processos?.transporte || '—'}</strong></div>
              <div><small>IT / versão</small><strong>{detail.it_versoes?.instrucoes_trabalho?.codigo || 'Não selecionada'} · {detail.it_versoes?.versao || '—'}</strong></div>
              <div><small>Nível da inspeção</small><strong>{detail.nivel_inspecao || '—'}</strong></div>
              <div><small>Data da inspeção</small><strong>{formatDateBR(detail.data_inspecao)}</strong></div>
              <div><small>Itens cadastrados</small><strong>{detail.items?.length || 0}</strong></div>
            </div>
            <div className="inspection-initial-items">
              {(detail.items ?? []).map((link:any)=>(
                <div key={link.processo_itens.id}><strong>{link.processo_itens.produtos?.sku || 'Sem SKU'}</strong>
                  <span>{link.processo_itens.produtos?.nome || 'Produto em preenchimento'} · {link.processo_itens.quantidade ?? 0} un.</span></div>
              ))}
            </div>

            <div className="section-title"><h3>Observação interna</h3></div>
            <div className="section-title"><h2>Observação interna</h2></div>
            <textarea
              value={internalObservation}
              onChange={(e)=>setInternalObservation(e.target.value)}
              rows={3}
              placeholder="Ex.: 60 un retiradas no laboratório para retenção."
              disabled={!canWrite}
            />
            
            {canWrite && <div className="actions"><button className="secondary" type="button" onClick={()=>void saveInternalObservation()}>Salvar</button></div>}
          </section>

          <section id="sec-amostragem" className={'panel section-card inspection-stage'+(activeStage==='amostragem' && detail.status!=='aberta'?'':' inspection-stage-hidden')}>
            <div className="section-title">
              <h2>Plano de amostragem</h2>
              <span className="pill">Nível {detail.nivel_inspecao} · código {detail.codigo_amostragem || '—'}</span>
            </div>
            <div className="plan-grid">
              <div><small>Lote estatístico</small><strong>{detail.tamanho_lote?.toLocaleString('pt-BR') || '—'}</strong></div>
              <div><small>Amostra prevista</small><strong>{detail.tamanho_amostra || '—'}</strong></div>
              <div><small>Amostra coberta</small><strong>{detail.total_inspecionado || 0}</strong></div>
              <div className="nc-summary-control">
                <small>NC únicas p/ Ac-Re</small>
                <input
                  type="number"
                  min={0}
                  max={detail.tamanho_amostra || undefined}
                  value={sampleNcDraft}
                  onChange={(e)=>setSampleNcDraft(e.target.value)}
                  onBlur={()=>void saveUniqueNcSummary()}
                />
              </div>
              <div><small>Ac</small><strong>{detail.limite_aceitacao ?? '—'}</strong></div>
              <div><small>Re</small><strong>{detail.limite_rejeicao ?? '—'}</strong></div>
              <div><small>Caixas recebidas</small><strong>{detail.caixas_recebidas ?? '—'}</strong></div>
              <div><small>Caixas a avaliar</small><strong>{detail.caixas_avaliar ?? '—'}</strong></div>
            </div>
            {!!detail.limite_rejeicao && detail.total_nao_conforme>=detail.limite_rejeicao && <div className="alert error">Limite de rejeição atingido. Você pode encerrar ou continuar a inspeção; a decisão ficará registrada.</div>}
          </section>

          <section id="sec-verificacoes" className={'panel section-card inspection-stage'+(activeStage==='verificacoes' && detail.status!=='aberta'?'':' inspection-stage-hidden')}>
            <div className="section-title"><div><h2>Verificações</h2></div></div>
            <div className="checklist compact-checklist">
              {(detail.checklist ?? []).map((item:any)=>{
                const r=detail.checklistResults?.find((x:any)=>x.checklist_id===item.id)
                const automatic=item.classificacao_sugerida
                const dimensionalScope=isDedicatedDimensionalCheck(item)
                const scopeQty=dimensionalScope?10:Number(detail.tamanho_amostra ?? 0)
                return (
                  <div className="check-row" key={item.id}>
                    <div className="check-copy">
                      <b>{item.ordem}. {item.requisito}</b>
                      <span>{item.instrucao}</span>
                      {automatic && <small>NC: {automatic==='critico'?'Crítico':automatic==='grave'?'Grave':'Tolerável'} · definido pela IT</small>}
                    </div>
                    <div className="check-actions-stack">
                      <div className="tri-buttons quick">
                        <button type="button" className={r?.resultado==='conforme'?'selected ok':''} onClick={()=>saveChecklist(item.id,'conforme')}>C</button>
                        <button type="button" className={r?.resultado==='nao_conforme'?'selected bad':''} onClick={()=>saveChecklist(item.id,'nao_conforme',Number(r?.quantidade_nc ?? 1))}>NC</button>
                        <button type="button" className={r?.resultado==='nao_aplicavel'?'selected':''} onClick={()=>saveChecklist(item.id,'nao_aplicavel')}>NA</button>
                      </div>
                      {r?.resultado==='nao_conforme' && (
                        <label className="nc-quantity">
                          <span>Qtd. NC</span>
                          <input
                            type="number"
                            min={1}
                            max={scopeQty || undefined}
                            value={r?.quantidade_nc ?? 1}
                            onChange={(e)=>setChecklistNcDraft(item.id,Math.max(1,Number(e.target.value)||1))}
                            onBlur={(e)=>void saveChecklist(item.id,'nao_conforme',Number(e.target.value))}
                          />
                          <em>/ {scopeQty || '—'}</em>
                        </label>
                      )}
                    </div>
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

          <section id="sec-dimensionais" className={'panel section-card inspection-stage'+(activeStage==='dimensionais' && detail.status!=='aberta'?'':' inspection-stage-hidden')}>
            <div className="section-title">
              <div><h2>Análises dimensionais</h2><span className="section-note">Especificação, instrumento, desvio aceitável e 10 medições por parâmetro.</span></div>
              {detail.dimensionais_finalizados && <span className="pill">Concluído</span>}
            </div>
            {(detail.items ?? []).length>1 && <div className="dimension-set-navigation">
              <div className="dimension-set-caption"><strong>Produtos do conjunto</strong><span>{detail.items.length} SKUs · uma única inspeção</span></div>
              <div className="dimension-set-tabs">
                {(detail.items??[]).map((entry:any,index:number)=>{
                  const product=entry.processo_itens
                  return <button key={product.id} type="button"
                    onClick={()=>document.getElementById('dim-item-'+product.id)?.scrollIntoView({behavior:'smooth',block:'center'})}>
                    <span>{index+1}</span>{product.produtos?.sku||'SKU não informado'}
                  </button>
                })}
              </div>
            </div>}
            {(detail.items ?? []).map((link:any,index:number)=>{
              const item=link.processo_itens
              return (
                <div className="dimension-item" id={'dim-item-'+item.id} key={item.id} role="group"
                  aria-label={'Dimensionais do produto '+(item.produtos?.sku||index+1)}>
                  <div className="dimension-product-header">
                    <span className="dimension-product-number">{String(index+1).padStart(2,'0')}</span>
                    <div className="dimension-product-identity">
                      <span className="dimension-product-overline">Produto {index+1} de {detail.items.length} · SKU {item.produtos?.sku||'não informado'}</span>
                      <h3>{item.produtos?.nome||'Produto sem descrição'}</h3>
                      <span className="dimension-product-meta">Quantidade: {item.quantidade??'—'} · Lote: {item.lote||'—'} · {(detail.params??[]).length} parâmetros dimensionais</span>
                    </div>
                  </div>
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
                            {usesMeasureReference(p) && <label>Referência da medida
                              <select value={cfg.tipo_referencia ?? p.tipo_referencia ?? ''} onChange={(e)=>saveDimConfig(item.id,p,{tipo_referencia:e.target.value})} disabled={detail.status==='concluida'}>
                                <option value="">Selecionar</option>
                                {/(intern|interior)/i.test(p.nome||'') && <option value="interno">Face / dimensão interna</option>}
                                {/(extern|exterior)/i.test(p.nome||'') && <option value="externo">Face / dimensão externa</option>}
                                <option value="desenho">Desenho técnico</option>
                                <option value="logo">Logo / arte</option>
                                <option value="amostra_padrao">Amostra padrão</option>
                                <option value="especificacao_cliente">Especificação do cliente</option>
                                <option value="outro">Outro</option>
                              </select>
                            </label>}
                            {usesMeasureReference(p) && (cfg.tipo_referencia ?? p.tipo_referencia)==='outro' && (
                              <label className="span-2">Especifique a referência da medida
                                <input defaultValue={cfg.referencia_outro ?? ''} placeholder="Ex.: gabarito, norma ou instrumento de referência" onBlur={(e)=>saveDimConfig(item.id,p,{referencia_outro:e.target.value})} disabled={detail.status==='concluida'}/>
                              </label>
                            )}
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
                              <select value={cfg.codigo_equipamento ?? ''} onChange={e=>{
                                const selected=equipments.find(x=>x.codigo===e.target.value)
                                void saveDimConfig(item.id,p,{equipamento:selected?.nome??null,codigo_equipamento:selected?.codigo??null})
                              }} disabled={detail.status==='concluida'}>
                                <option value="">Selecionar equipamento disponível</option>
                                {cfg.codigo_equipamento && !equipments.some(x=>x.codigo===cfg.codigo_equipamento) && <option value={cfg.codigo_equipamento}>{cfg.equipamento || cfg.codigo_equipamento} (cadastro anterior)</option>}
                                {equipments.filter(e=>equipmentFit(e,p.nome,cfg.unidade||p.unidade)).map(e=><option value={e.codigo} key={e.id}>{e.codigo} · {e.nome}</option>)}
                              </select>
                              {!equipments.some(e=>equipmentFit(e,p.nome,cfg.unidade||p.unidade)) && <small className="field-hint">Não há equipamento calibrado e adequado cadastrado para esta medição.</small>}
                            </label>
                            <label>Código do equipamento<input value={cfg.codigo_equipamento??''} readOnly placeholder="Preenchido ao selecionar"/></label>
                            <label>Desvio ±
                              <input type="number" min="0" step="any" defaultValue={cfg.desvio_mais ?? cfg.desvio_menos ?? ''} onBlur={(e)=>saveDimConfig(item.id,p,{desvio:e.target.value,desvio_menos:e.target.value,desvio_mais:e.target.value})} disabled={detail.status==='concluida'}/>
                            </label>
                            <label className="span-2">Especificação / desvio
                              <input value={cfg.especificacao_desvio ?? ((cfg.valor_nominal!=null && (cfg.desvio_mais!=null || cfg.desvio_menos!=null)) ? (String(cfg.valor_nominal)+' '+String(cfg.unidade ?? p.unidade ?? '')+' ± '+String(cfg.desvio_mais ?? cfg.desvio_menos)+' '+String(cfg.unidade ?? p.unidade ?? '')).trim() : '')} readOnly placeholder="Preenchido automaticamente"/>
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

          <section id="sec-testes" className={'panel section-card inspection-stage'+(activeStage==='testes' && detail.status!=='aberta'?'':' inspection-stage-hidden')}>
            <div className="section-title"><div><h2>Testes especiais</h2><span className="section-note">Selecione C, NC ou NA. O resultado é salvo automaticamente.</span></div>{detail.testes_finalizados && <span className="pill">Concluído</span>}</div>
            {(detail.tests ?? []).map((test:any)=>{
              const r=detail.testResults?.find((x:any)=>x.teste_id===test.id)
              return (
                <article className="test-card" key={test.id}>
                  <div><strong>{test.nome}</strong><p>{test.procedimento}</p><small>Critério: {test.criterio_aprovacao}</small></div>
                  <div className="test-actions">
                    <div className="tri-buttons quick">
                      <button type="button" className={r?.resultado==='conforme'?'selected ok':''} onClick={()=>saveTest(test.id,'conforme')}>C</button>
                      <button type="button" className={r?.resultado==='nao_conforme'?'selected bad':''} onClick={()=>saveTest(test.id,'nao_conforme')}>NC</button>
                      <button type="button" className={r?.resultado==='nao_aplicavel'?'selected':''} onClick={()=>saveTest(test.id,'nao_aplicavel')}>NA</button>
                    </div>
                    {r?.resultado && <span className="pill">Salvo</span>}
                  </div>
                </article>
              )
            })}
            {!detail.tests?.length && <div className="muted">Sem teste especial estruturado para esta IT.</div>}
            {!!detail.tests?.length && !detail.testes_finalizados && detail.status!=='concluida' && <div className="actions"><button className="secondary" type="button" onClick={()=>void completeTests()}><CheckCircle2 size={16}/> Concluir testes</button></div>}
          </section>

          <section id="sec-fotos" className={'panel section-card inspection-stage'+(activeStage==='fotos' && detail.status!=='aberta'?'':' inspection-stage-hidden')}>
            <div className="section-title">
              <div><h2>Fotos da inspeção</h2><span className="section-note">Fotografias e identificação visual do produto.</span></div>
              <div className="row-actions"><span className="pill">{detail.photos?.length ?? 0} enviada(s)</span>
                <button className="secondary small" type="button" onClick={()=>void refreshInspectionPhotoEvidence()}><RefreshCw size={15}/> Atualizar fotos</button>
              </div>
            </div>

            {detail.status!=='concluida' && (
              <>
                <label className="upload-box"><Camera size={22}/><span>Selecionar fotos finais</span><input type="file" accept="image/*" multiple onChange={(e)=>addPendingPhotos(e.target.files)}/></label>
                {!!pendingPhotos.length && <div className="pending-photo-grid">
                  {pendingPhotos.map((p)=>(
                    <article className="photo-card" key={p.id}>
                      <img src={p.url} alt="Prévia"/>
                      <label>Legenda<input value={p.legenda} onChange={(e)=>setPendingPhotos((old)=>old.map((x)=>x.id===p.id?{...x,legenda:e.target.value}:x))} placeholder="Ex.: Tampa com risco na lateral"/></label>
                      <label className="check-option compact photo-id-flag">
                        <input type="checkbox" checked={p.isProductId} onChange={(e)=>setPendingPhotos((old)=>old.map((x)=>x.id===p.id?{...x,isProductId:e.target.checked}:x))}/>
                        <span>Foto principal do produto</span>
                      </label>
                      {p.isProductId && (detail.items ?? []).length>1 && <select className="compact-product-select" value={p.productId} onChange={(e)=>setPendingPhotos((old)=>old.map((x)=>x.id===p.id?{...x,productId:e.target.value}:x))}>
                        <option value="">Selecione o componente</option>
                        {(detail.items ?? []).map((link:any)=><option key={link.processo_itens.produto_id} value={link.processo_itens.produto_id}>{link.processo_itens.produtos?.sku} · {link.processo_itens.produtos?.nome}</option>)}
                      </select>}
                      <button className="secondary small" type="button" onClick={()=>removePendingPhoto(p.id)}>Remover</button>
                    </article>
                  ))}
                </div>}
                {!!pendingPhotos.length && <div className="actions"><button className="primary" type="button" disabled={photoUploadBusy} onClick={()=>void uploadInspectionPhotos()}>{photoUploadBusy?'Enviando fotos…':'Enviar fotos'}</button></div>}
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

          {detail.status!=='concluida' && detail.status!=='aberta' && (
            <section id="sec-resultado" className={'panel section-card result-panel inspection-stage'+(activeStage==='resultado' && detail.status!=='aberta'?'':' inspection-stage-hidden')}>
              <h2>Resultado final</h2>
              <div className="readiness">
                <span className={samplingDone?'done':''}>Amostragem</span>
                <span className={checklistDone?'done':''}>Verificações</span>
                <span className={dimsDone?'done':''}>Dimensionais</span>
                <span className={testsDone?'done':''}>Testes</span>
              </div>
              <div className="section-title conclusion-title">
                <label>Observação / conclusão</label>
                <button type="button" className="secondary small" onClick={()=>void suggestAIConclusion()} disabled={aiConclusionBusy}><Sparkles size={16}/>{aiConclusionBusy?'Gerando…':'Gerar sugestão com IA'}</button>
              </div>
              <textarea value={finalObservation} onChange={(e)=>setFinalObservation(e.target.value)} rows={5} placeholder="Registre a conclusão da inspeção."/>
              <div className="result-actions">
                <button className="success-button" onClick={()=>finishInspection('aprovado')}>Aprovar inspeção</button>
                <button className="danger" onClick={()=>finishInspection('reprovado')}>Reprovar inspeção</button>
              </div>
            </section>
          )}

          {detail.status!=='concluida' && activeStage==='retencao' && detail.status!=='aberta' && (
            <section className="panel section-card inspection-stage">
              <h2>Retenção de amostras</h2>
              <p>A decisão de retenção ficará disponível após a conclusão da inspeção.</p>
              <button className="secondary" type="button" onClick={()=>selectInspectionStage('resultado')}>Ir para resultado</button>
            </section>
          )}
          {detail.status==='concluida' && activeStage==='resultado' && (
            <section className="panel section-card inspection-stage">
              <div className="section-title"><h2>Resultado final</h2><span className={'result-badge '+detail.resultado}>{statusLabel(detail.resultado)}</span></div>
              <p>{detail.observacoes || 'Nenhuma observação final registrada.'}</p>
              <button className="secondary" type="button" onClick={()=>selectInspectionStage('retencao')}>Ver retenção</button>
            </section>
          )}
          {detail.status==='concluida' && (
            <section className={'panel section-card retention-panel inspection-stage'+(activeStage==='retencao'?'':' inspection-stage-hidden')}>
              <div className="section-title">
                <h2>Retenção após finalização</h2>
                <span className={'result-badge '+detail.resultado}>{statusLabel(detail.resultado)}</span>
              </div>
              {(detail.retained ?? []).length>0 && <div className="alert success">Já existem {(detail.retained ?? []).length} amostra(s) deste registro no estoque.</div>}
              {retentionSuggestion.quantidade!=null && <div className="retention-suggestion"><Sparkles size={15}/><span>Sugestão de retenção: <b>{retentionSuggestion.quantidade} un.</b> com base na observação interna.</span></div>}
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
                      <label>Quantidade<input type="number" step="0.01" value={draft.qty} onChange={(e)=>setRetentionRows({...retentionRows,[item.id]:{...draft,qty:e.target.value}})}/></label>
                      <label>Endereço<input value={draft.address} onChange={(e)=>setRetentionRows({...retentionRows,[item.id]:{...draft,address:e.target.value}})} placeholder="Ex.: ARM 03 ou INSPEÇÃO"/></label>
                      <small className="field-hint">A foto principal marcada na inspeção será reutilizada no estoque.</small>
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


      {tab==='equipamentos' && <Suspense fallback={<div className="center-screen">Carregando equipamentos…</div>}>
        <EquipmentPage canManage={!!canManageIts} equipments={equipments}
          setEquipments={setEquipments} busy={equipmentBusy} refresh={refreshEquipments}/>
      </Suspense>}

      {tab==='its' && (
        <section className="workspace">
          <div className="page-title"><div><span className="eyebrow">DOCUMENTOS</span><h1>{itDemoOpen?'Editor de IT · Teste':'Biblioteca de ITs'}</h1></div>
            <button type="button" className={itDemoOpen?'secondary':'primary'} onClick={()=>setItDemoOpen(x=>!x)}>{itDemoOpen?'Voltar à biblioteca':'Testar editor de IT'}</button>
          </div>
          {itDemoOpen ? (
            <Suspense fallback={<div className="panel section-card">Carregando editor de IT…</div>}>
              <ItEditorDemo/>
            </Suspense>
          ) : (<>
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
          </>)}
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
                  <div className="stock-inspection-status">
                    <b>Inspeção de origem</b>
                    {selectedSample.inspecao_id ? (()=>{const related=inspections.find(i=>i.id===selectedSample.inspecao_id);return related
                      ? <div><span className={'result-badge '+(related.resultado||'')}>{related.status==='concluida' ? statusLabel(related.resultado) : statusLabel(related.status)}</span>
                        <strong>{inspectionDisplay(related)}</strong>
                        <button className="secondary small" type="button" onClick={()=>{setSelectedSample(null);void openInspection(related.id)}}><ClipboardCheck size={15}/> Ver inspeção e relatório</button>
                      </div>
                      : <p>Existe um vínculo com inspeção, mas o registro não está disponível nesta listagem.</p>})()
                    : <p>Registro histórico sem inspeção vinculada. A vinculação será feita quando os registros de origem estiverem disponíveis.</p>}
                  </div>
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
                    <label>Quantidade<input type="number" step="0.01" value={stockMove.quantidade} onChange={(e)=>setStockMove({...stockMove,quantidade:e.target.value})}/></label>
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

      {editingInspectionData && (
        <div className="modal-backdrop" onClick={()=>setEditingInspectionData(null)}>
          <article className="sample-detail inspection-edit-modal" onClick={(e)=>e.stopPropagation()}>
            <button className="close" type="button" onClick={()=>setEditingInspectionData(null)}>×</button>
            <span className="eyebrow">DADOS DA INSPEÇÃO</span>
            <h2>Editar inspeção</h2>
            <p className="muted">Altere os campos necessários e salve.</p>
            <div className="form-grid">
              <label>Processo<input value={editingInspectionData.codigo ?? ''} onChange={(e)=>setEditingInspectionData({...editingInspectionData,codigo:e.target.value})}/></label>
              <label>Cliente<input value={editingInspectionData.cliente ?? ''} onChange={(e)=>setEditingInspectionData({...editingInspectionData,cliente:e.target.value})}/></label>
              <label>Nota fiscal<input value={editingInspectionData.notaFiscal ?? ''} onChange={(e)=>setEditingInspectionData({...editingInspectionData,notaFiscal:e.target.value})}/></label>
              <label>Chegada no CD<input type="date" value={editingInspectionData.chegadaCd ?? ''} onChange={(e)=>setEditingInspectionData({...editingInspectionData,chegadaCd:e.target.value})}/></label>
              <label>Origem<input value={editingInspectionData.origem ?? ''} onChange={(e)=>setEditingInspectionData({...editingInspectionData,origem:e.target.value})}/></label>
              <div className="field-label"><span>Transporte</span><div className="transport-checks">
                <label className="check-option"><input type="checkbox" checked={editingInspectionData.transporte==='Aéreo'} onChange={()=>setEditingInspectionData({...editingInspectionData,transporte:toggleTransport(editingInspectionData.transporte || '','Aéreo')})}/><span>Aéreo</span></label>
                <label className="check-option"><input type="checkbox" checked={editingInspectionData.transporte==='Marítimo'} onChange={()=>setEditingInspectionData({...editingInspectionData,transporte:toggleTransport(editingInspectionData.transporte || '','Marítimo')})}/><span>Marítimo</span></label>
              </div></div>
              <label>Data da inspeção<input type="date" value={editingInspectionData.dataInspecao ?? ''} onChange={(e)=>setEditingInspectionData({...editingInspectionData,dataInspecao:e.target.value})}/></label>
              <label>Nível de inspeção<select value={editingInspectionData.inspectionLevel ?? 'I'} onChange={(e)=>setEditingInspectionData({...editingInspectionData,inspectionLevel:e.target.value})}><option value="I">Nível I</option><option value="II">Nível II</option><option value="III">Nível III</option><option value="S1">S1</option><option value="S2">S2</option><option value="S3">S3</option><option value="S4">S4</option></select></label>
              <label>IT aplicável<select value={editingInspectionData.itVersionId ?? ''} onChange={e=>setEditingInspectionData({...editingInspectionData,itVersionId:e.target.value})}><option value="">Selecionar IT</option>{itVersions.map(it=><option key={it.id} value={it.id}>{it.instrucoes_trabalho?.codigo || 'IT'} · v{it.versao}</option>)}</select></label>
                  <label className="span-2">Observação interna<textarea rows={3} value={editingInspectionData.observacaoInterna ?? ''} onChange={(e)=>setEditingInspectionData({...editingInspectionData,observacaoInterna:e.target.value})}/></label>
            </div>
            <div className="edit-items-list">
              {(editingInspectionData.itens ?? []).map((row:any,i:number)=>{ const d=boxDistributionTotals(row); return <article className="sku-card compact" key={row.processoItemId || i}>
                <div className="sku-card-head">
                  <button type="button" className="sgq-sku-toggle"
                    aria-expanded={expandedEditSkuIndex===i} aria-controls={'sgq-edit-sku-body-'+i}
                    onClick={()=>setExpandedEditSkuIndex(current=>current===i?null:i)}>
                    <ChevronDown className={'sgq-sku-chevron '+(expandedEditSkuIndex===i?'open':'')} size={19}/>
                    <span className="sgq-sku-summary">
                      <strong>{row.sku||'Novo código'}</strong>
                      <small>{row.nome||'Em preenchimento'}{row.quantidade?' · '+Number(row.quantidade).toLocaleString('pt-BR')+' un':''}</small>
                    </span>
                  </button>
                </div>
                <div id={'sgq-edit-sku-body-'+i} className="sgq-sku-collapsible" hidden={expandedEditSkuIndex!==i}>
                <div className="form-grid">
                  <label>Código<input value={row.sku} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?{...x,sku:e.target.value}:x)})}/></label>
                  <label>Descrição<input value={row.nome} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?{...x,nome:e.target.value}:x)})}/></label>
                  <label>Código do cliente<input value={row.codigoCliente||''} onChange={e=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?{...x,codigoCliente:e.target.value}:x)})}/></label>
                  {row.numeroPedidoPv && <label>Quantidade original PV {row.numeroPedidoPv}<input type="number" readOnly value={row.quantidadePv||''}/></label>}
                  <label>Lote<input value={row.lote} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?{...x,lote:e.target.value}:x)})}/></label>
                  <label>Quantidade recebida<input type="number" step="0.01" value={row.quantidade} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?{...x,quantidade:e.target.value}:x)})}/></label>
                  <label>Caixas recebidas<input type="number" step="1" value={row.caixasRecebidas} onChange={(e)=>{
                    const received=e.target.value
                    const suggested=received ? String(boxesToInspect(Number(received))) : ''
                    setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?{...x,caixasRecebidas:received,caixasInspecionadas:suggested}:x)})
                  }}/></label>
                  <label>Caixas inspecionadas<input type="number" step="1" value={row.caixasInspecionadas} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?{...x,caixasInspecionadas:e.target.value}:x)})}/></label>
                </div>
                <div className="field-label"><span>Distribuição para armazenagem · {row.sku || 'Componente '+(i+1)}</span></div>
                <div className="distribution-grid compact">
                  <div className="distribution-line"><strong>Padrão</strong><label>Caixas<input type="number" min="0" step="1" value={row.caixasPadrao} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?updateBoxDistributionField(x,'caixasPadrao',e.target.value):x)})}/></label><label>Un/caixa<input type="number" min="0" step="0.01" value={row.unidadesPadrao||row.quantidadePorCaixa} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?updateBoxDistributionField(x,'unidadesPadrao',e.target.value):x)})}/></label></div>
                  <div className="distribution-line"><strong>Fracionada</strong><label>Caixas<input type="number" min="0" step="1" value={row.caixasFracionadas} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?updateBoxDistributionField(x,'caixasFracionadas',e.target.value):x)})}/></label><label>Un/caixa<input type="number" min="0" step="0.01" value={row.unidadesFracionadas} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?updateBoxDistributionField(x,'unidadesFracionadas',e.target.value):x)})}/></label></div>
                </div>
                <div className="lab-withdrawal">
                  <label>Retirada para laboratório (unidades)
                    <input type="number" min="0" step="1" value={row.unidadesLaboratorio} onChange={e=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?setLaboratoryUnits(x,e.target.value):x)})}/>
                  </label>
                  <small>Não acrescenta caixas à armazenagem.</small>
                </div>
                {!!d.groups.length && <small className={'field-status '+((Math.abs(d.totalUnits-Number(row.quantidade))>0.0001)?'bad':'ok')}>
                  Armazenagem {d.units.toLocaleString('pt-BR')} un ({d.boxes} caixa(s))
                  {' + '}laboratório {d.labUnits.toLocaleString('pt-BR')} un
                  {' = '}{d.totalUnits.toLocaleString('pt-BR')} un recebidas
                </small>}
                </div>
              </article>})}
            </div>
            <button className="secondary" type="button" onClick={()=>{setExpandedEditSkuIndex((editingInspectionData.itens??[]).length);setEditingInspectionData({...editingInspectionData,itens:[...(editingInspectionData.itens ?? []),{...emptySku(),processoItemId:null}]})}}><Plus size={16}/> Adicionar produto à inspeção</button>
            <button className="primary wide" type="button" onClick={saveEditingInspectionData}>Salvar</button>
          </article>
        </div>
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



      {omieOrderPickerOpen && omieOrders?.codigo===fstCode(inspection.codigo) && (
        <div className="modal-backdrop sgq-omie-modal-layer">
          <article className="sample-detail omie-review-modal omie-order-picker" role="dialog" aria-modal="true" aria-labelledby="sgq-omie-order-title">
            <button className="close" type="button" aria-label="Fechar seleção de pedido" onClick={()=>setOmieOrderPickerOpen(false)}>×</button>
            <span className="eyebrow">{formatFst(omieOrders.codigo)}</span>
            <h2 id="sgq-omie-order-title">Selecionar pedido</h2>
            <p>Este processo tem mais de um pedido vinculado. Selecione o PV para conferir seus componentes.</p>
            <label className="omie-order-selector">Pedido de venda
              <select aria-label="Selecionar pedido Omie" value={omieSelectedOrder} onChange={e=>setOmieSelectedOrder(e.target.value)}>
                <option value="">Selecione um pedido do projeto</option>
                {omieOrders.pedidos.map(p=><option key={p.codigoPedido} value={p.codigoPedido}>
                  PV {p.numeroPedido} · {p.quantidadeItens} item(ns)
                </option>)}
              </select>
            </label>
            {processLookupMessage && !processLookupBusy && <p className="omie-review-validation" role="alert">{processLookupMessage}</p>}
            <div className="omie-review-actions">
              <button type="button" className="secondary" onClick={()=>setOmieOrderPickerOpen(false)}>Fechar</button>
              <button type="button" className="primary" disabled={!omieSelectedOrder||processLookupBusy}
                onClick={()=>void lookupFstClient(inspection.codigo,Number(omieSelectedOrder))}>
                Consultar SKUs
              </button>
            </div>
          </article>
        </div>
      )}
      {omieSkuReview && omieSkuReview.codigo===fstCode(inspection.codigo) && (
        <div className="modal-backdrop sgq-omie-modal-layer">
          <article className="sample-detail omie-review-modal" role="dialog" aria-modal="true"
            aria-labelledby="sgq-omie-review-title" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();closeOmieSkuReview()}}}>
            <button className="close" type="button" aria-label="Atualizar e fechar tabela de SKUs" onClick={closeOmieSkuReview}>×</button>
            <span className="eyebrow">{formatFst(omieSkuReview.codigo)} · PV {omieSkuReview.numeroPedido}</span>
            <h2 id="sgq-omie-review-title">Conferir códigos e quantidades</h2>
            <p>Corrija a quantidade recebida de cada componente, se necessário.</p>
            <div className="omie-review-table-scroll">
              <table className="omie-review-table">
                <thead>
                  <tr>
                    <th scope="col">Código / SKU</th>
                    <th scope="col">Descrição</th>
                    <th scope="col" className="omie-review-number">Qtd. pedido</th>
                    <th scope="col" className="omie-review-number">Qtd. recebida</th>
                  </tr>
                </thead>
                <tbody>
                  {omieSkuReview.itens.map(item=><tr key={item.sku}>
                    <td><strong>{item.sku}</strong></td>
                    <td>{item.descricao}</td>
                    <td className="omie-review-number">{item.quantidadePedido.toLocaleString('pt-BR',{maximumFractionDigits:3})}</td>
                    <td className="omie-review-edit">
                      <input type="number" min="0" step="any"
                        aria-label={'Quantidade recebida '+item.sku}
                        aria-invalid={item.quantidadeInformada.trim()===''||!Number.isFinite(Number(item.quantidadeInformada))||Number(item.quantidadeInformada)<0}
                        value={item.quantidadeInformada}
                        onChange={e=>updateOmieReviewQuantity(item.sku,e.target.value)}/>
                      {skuRows.filter(row=>row.sku.trim().toUpperCase()===item.sku.trim().toUpperCase()).length>1 &&
                        <small>Vários lotes: manteremos as quantidades existentes.</small>}
                    </td>
                  </tr>)}
                </tbody>
                <tfoot><tr>
                  <th colSpan={2} scope="row">Total</th>
                  <td className="omie-review-number">{omieSkuReview.itens.reduce((sum,item)=>sum+item.quantidadePedido,0).toLocaleString('pt-BR',{maximumFractionDigits:3})}</td>
                  <td className="omie-review-number">{omieSkuReview.itens.reduce((sum,item)=>sum+(Number(item.quantidadeInformada)||0),0).toLocaleString('pt-BR',{maximumFractionDigits:3})}</td>
                </tr></tfoot>
              </table>
            </div>
            {omieSkuReviewError && <p className="omie-review-validation" role="alert">{omieSkuReviewError}</p>}
            <div className="omie-review-actions">
              <span className="omie-review-note">Ao fechar, os componentes e cálculos da inspeção serão atualizados.</span>
              <button type="button" className="secondary" onClick={()=>{setOmieSkuReview(null);setOmieSkuReviewError('');setProcessLookupMessage('Revisão descartada. Os componentes permanecem inalterados.')}}>Descartar</button>
              <button type="button" className="primary" onClick={closeOmieSkuReview}>Atualizar e fechar</button>
            </div>
          </article>
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

