import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, Boxes, Camera, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Copy, Edit3, RefreshCw, FileDown, FileText, LogOut, PackageSearch, Play, Plus, QrCode, Search, ShieldCheck, Sparkles, Trash2, Upload, Warehouse, Wrench, LayoutDashboard, BarChart3, CloudOff, CloudUpload, X } from 'lucide-react'
import { apiGet, apiPost, apiPut, apiUrl, supabase, authClient } from './lib/supabase'
import {useEquipmentList,equipmentFit} from './equipamentos/equipmentData'
import {saveOfflineDraft,readOfflineDraft,clearOfflineDraft,enqueueOfflineOperation,offlineOperations,connectionFailure} from './lib/offline'
import {replayOfflineOperations,offlineInspectionVersion} from './lib/offlineSync'
import InventoryPanel from './stock/InventoryPanel'
import InspectionsKanban from './components/InspectionsKanban'
import SgqDashboard from './components/SgqDashboard'
import './SgqOperationsTheme.css'

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
  it_versao_id?: string | null
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
  concluida_em?: string | null
  parametros_amostragem?: {lote_sequencial?:string|null;ordem_produto?:number;total_produtos?:number;produto_codigo?:string}|null
  grupos_inspecao?: {
    id: string
    nome: string
    tipo: string
    processo_id: string
    subprocesso_codigo?: string | null
    nota_fiscal?: string | null
    origem?: string | null
    transporte?: string | null
    chegada_cd?: string | null
    processos?: ProcessRow | null
  } | null
  it_versoes?: {
    id: string
    versao: string
    instrucoes_trabalho?: { codigo: string; titulo: string } | null
  } | null
}
type StockSkuPosition = {id:string;codigo:string;sku:string;descricao:string;endereco:string|null;processo:string|null;saldo:number}
type StockSkuConflict = {descricao:string;skus:string[];registros:number;posicoes:StockSkuPosition[]}
type StockSkuValidation = {valid:boolean;descricao:string;message:string}
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
type OmieInboxOrder={
 id:string;omie_codigo_pedido:number;numero_pedido:string;cliente:string|null;
 fst_referencia:string|null;status:'novo'|'alterado'|'cancelado'|'pendente_dados'|'erro';
 itens:Array<{sku:string;descricao:string;quantidade:number}>;
 numero_itens:number;recebido_em:string;atualizado_em:string;
}
type OmieSkuImport={codigo:string;numeroPedido:string;itens:OmieOrderItem[]}
type OmieSkuReviewLine={sku:string;descricao:string;quantidadePedido:number;quantidadeInformada:string}
type OmieSkuReview={codigo:string;numeroPedido:string;itens:OmieSkuReviewLine[]}
function skuRowHasData(row:ReturnType<typeof emptySku>){
  return Boolean(row.sku.trim()||row.nome.trim()||row.lote.trim()||row.material.trim()||
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
// Operational stock boxes and pieces are whole units. Reject invalid input rather
// than silently converting a fractional or malformed value into zero.
function operationalQuantityError(rows:any[]):string|null{
  const keys=['quantidade','quantidadePorCaixa','unidadesPorConjunto',
    'caixasRecebidas','caixasInspecionadas','caixasPadrao','unidadesPadrao',
    'caixasFracionadas','unidadesFracionadas','caixasLaboratorio','unidadesLaboratorio']
  for(const row of rows){
    for(const key of keys){
      const value=String(row?.[key]??'').trim()
      if(value!=='' && (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value))))
        return 'Quantidade inválida em '+(row?.sku||'produto')+': caixas e unidades precisam ser números inteiros e não negativos.'
    }
  }
  return null
}
function validOmieSkuReview(review:OmieSkuReview){
  return review.itens.length>0 && review.itens.every(item=>{
    const value=item.quantidadeInformada.trim()
    return value!==''&&/^[0-9]+$/.test(value)&&Number.isSafeInteger(Number(value))
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
function inspectionBoxTotal(detail:any,kind:'received'|'evaluate'):number|null {
  const links=Array.isArray(detail?.items)?detail.items:[]
  let count=0
  for(const link of links){
    const item=link?.processo_itens
    if(!item)continue
    const distributed=Array.isArray(item.distribuicao_caixas)
      ?item.distribuicao_caixas.reduce((sum:number,g:any)=>{
        const type=String(g?.Tipo??g?.tipo??'').toLowerCase()
        return type==='padrao'||type==='fracionada'
          ?sum+Math.max(0,Number(g?.Caixas??g?.caixas??0)):sum
      },0):0
    const received=Number(item.caixas_recebidas)>0
      ?Number(item.caixas_recebidas):distributed
    const value=kind==='received'?received:
      Number(item.caixas_inspecionadas)>0
        ?Number(item.caixas_inspecionadas):received>0?boxesToInspect(received):0
    count+=value
  }
  if(count>0)return count
  const field=kind==='received'?'caixas_recebidas':'caixas_avaliar'
  const persisted=Number(detail?.[field])
  return persisted>0?persisted:null
}
function inspectionDisplay(row:{grupos_inspecao?:{subprocesso_codigo?:string|null;processos?:{codigo?:string|null;cliente?:string|null}|null}|null}) {
  const p=row.grupos_inspecao?.processos
  const sub=row.grupos_inspecao?.subprocesso_codigo
  return formatFst(p?.codigo)+(sub?'-'+sub:'')+' - '+(p?.cliente?.trim()||'Cliente não informado')
}
function parentFstCode(raw:string){return fstCode(raw).replace(/-[A-Z]$/i,'')}
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
  const changed={...row,[key]:value}
  if(key!=='caixasPadrao'&&key!=='caixasFracionadas')return changed
  const before=boxDistributionTotals(row).boxes
  const after=boxDistributionTotals(changed).boxes
  const explicit=String(row.caixasRecebidas??'').trim()
  // Preserve manually overridden received boxes; keep automatic counts in sync.
  if(explicit!==''&&Number(explicit)!==before)return changed
  const inspected=String(row.caixasInspecionadas??'').trim()
  return {...changed,
    caixasRecebidas:after>0?String(after):'',
    caixasInspecionadas:inspected===''||Number(inspected)===boxesToInspect(before)
      ?after>0?String(boxesToInspect(after)):''
      :row.caixasInspecionadas
  }
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
    if(Number.isSafeInteger(received) && Number.isSafeInteger(retained)
      && Number.isSafeInteger(standardBoxes) && Number.isSafeInteger(perBox) && perBox>0)
      return {...next,unidadesPadrao:String(perBox),quantidadePorCaixa:String(perBox)}
  }
  return next
}

function editMetadataFingerprint(value:any) {
  if(!value)return ''
  const fields=['codigo','cliente','notaFiscal','origem','transporte','chegadaCd','dataInspecao',
    'inspectionLevel','itVersionId','observacaoInterna']
  const itemFields=['processoItemId','sku','nome','lote','material','capacidade',
    'quantidadePv','numeroPedidoPv','fstPv']
  return JSON.stringify({
    inspection:fields.map(k=>String(value[k]??'')),
    items:(value.itens??[]).map((item:any)=>itemFields.map(k=>String(item[k]??'')))
  })
}
function patchOperationalSkuRow(row:any,key:string,value:string){
  if(key==='unidadesPadrao')return updateBoxDistributionField(row,key,value)
  if(key==='unidadesLaboratorio')return setLaboratoryUnits(row,value)
  if(key==='caixasRecebidas')return {
    ...row,caixasRecebidas:value,
    caixasInspecionadas:value?String(boxesToInspect(Number(value))):''
  }
  return {...row,[key]:value}
}

function suggestMissingInspectedBoxes(row:any){
  // Recover box counts from a persisted warehouse distribution (standard +
  // fractional boxes). Lab withdrawals are units and are excluded.
  const storedReceived=String(row.caixasRecebidas??'').trim()
  const distributionBoxes=boxDistributionTotals(row).boxes
  const received=storedReceived!==''?Number(storedReceived):distributionBoxes
  const boxesReceived=storedReceived!==''?row.caixasRecebidas:(received>0?String(received):'')
  const storedEvaluate=String(row.caixasInspecionadas??'').trim()
  const boxesEvaluate=storedEvaluate!==''?row.caixasInspecionadas:
    Number.isInteger(received)&&received>0?String(boxesToInspect(received)):''
  return {...row,caixasRecebidas:boxesReceived,caixasInspecionadas:boxesEvaluate}
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
  const [tab, setTab] = useState<'painel' | 'insights' | 'inspecoes' | 'nova' | 'execucao' | 'its' | 'estoque' | 'auditorias' | 'equipamentos' | 'fotos-mobile' | 'quadro'>(()=>window.matchMedia('(max-width: 768px)').matches || new URLSearchParams(window.location.search).get('modo')==='fotos'?'fotos-mobile':'painel')
  const [itDemoOpen,setItDemoOpen]=useState(false)
  const [dashboardSearch,setDashboardSearch]=useState('')
  const [popupMessage,setPopupMessage]=useState('')
  const [aiConclusionBusy,setAiConclusionBusy]=useState(false)
  const [aiConclusionError,setAiConclusionError]=useState('')
  const [wordDownloading,setWordDownloading]=useState(false)
  const [wordCheckBusy,setWordCheckBusy]=useState(false)
  const [kanbanMovingId,setKanbanMovingId]=useState<string|null>(null)
  const kanbanMoveLock=useRef<string|null>(null)
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
  const [editSaving,setEditSaving]=useState(false)
  const [editFeedback,setEditFeedback]=useState('')
  const editLastSavedFingerprint=useRef<string|null>(null)
  const editMetadataBaseline=useRef<string|null>(null)
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
  const [processItemLinks,setProcessItemLinks]=useState<Array<{grupo_inspecao_id:string;processo_itens?:{codigo_cliente?:string|null;produtos?:{sku?:string|null;nome?:string|null}|null}|null}>>([])
  const [omieInbox,setOmieInbox]=useState<OmieInboxOrder[]>([])
  const [omieInboxSeen,setOmieInboxSeen]=useState<Set<string>>(new Set())
  const [omieInboxError,setOmieInboxError]=useState('')
  const [omieInboxLoading,setOmieInboxLoading]=useState(false)
  const levelOfferPrompted=useRef(new Set<string>())
  const omieUnread=omieInbox.filter(order=>order.status!=='cancelado'&&!omieInboxSeen.has(order.id)).length

  async function loadOmieInbox(){
    if(!userId||!navigator.onLine)return
    const [orders,seen]=await Promise.all([
      authClient.from('sgq_omie_pedidos')
        .select('id,omie_codigo_pedido,numero_pedido,cliente,fst_referencia,status,itens,numero_itens,recebido_em,atualizado_em')
        .order('recebido_em',{ascending:false}).limit(40),
      authClient.from('sgq_omie_pedidos_lidos')
        .select('pedido_id').eq('usuario_id',userId).limit(200)
    ])
    if(orders.error){setOmieInboxError('Não foi possível carregar os PVs do Omie.');return}
    setOmieInbox((orders.data||[]) as OmieInboxOrder[])
    setOmieInboxSeen(new Set((seen.data||[]).map(x=>String(x.pedido_id))))
    setOmieInboxError('')
  }
  useEffect(()=>{
    if(!userId)return
    void loadOmieInbox()
    const interval=window.setInterval(()=>void loadOmieInbox(),60000)
    return()=>window.clearInterval(interval)
  },[userId])

  async function reviewOmieInboxOrder(order:OmieInboxOrder){
    if(!canWrite)return
    if(order.status==='cancelado')return setPopupMessage('PV cancelado no Omie. Não é permitido iniciar inspeção a partir dele.')
    if(!order.itens?.length)return setPopupMessage('Este PV ainda não possui itens disponíveis. Confira os dados no Omie.')
    resetNewInspection()
    const fst=order.fst_referencia||''
    const process=processes.find(p=>fst&&parentFstCode(p.codigo)===parentFstCode(fst))
    setInspection(current=>({...current,
      codigo:fst?fstCode(fst):'',
      processoId:process?.id||'',
      subprocessoCodigo:fst.match(/-([A-Z])$/)?.[1]||(process?nextSubprocessFor(process):'A'),
      cliente:order.cliente||process?.cliente||''
    }))
    setSkuRows(order.itens.map(item=>({
      ...emptySku(),sku:item.sku,nome:item.descricao,
      quantidadePv:String(item.quantidade),numeroPedidoPv:order.numero_pedido,
      fstPv:fst,omieSourcePedido:order.numero_pedido,omieSourceFst:fst,
      omieStatus:'found',omieMessage:'Referência importada do PV '+order.numero_pedido,
      quantidade:'',caixasRecebidas:'',caixasInspecionadas:''
    })))
    setTab('nova')
    setMessage('PV '+order.numero_pedido+' pré-preenchido. Confirme o FST, selecione a IT e registre o recebimento físico antes de salvar.')
    if(userId){
      const result=await authClient.from('sgq_omie_pedidos_lidos').upsert({
        pedido_id:order.id,usuario_id:userId,lido_em:new Date().toISOString()
      },{onConflict:'pedido_id,usuario_id'})
      if(!result.error)setOmieInboxSeen(old=>new Set([...old,order.id]))
    }
  }

  function maybeOfferLevelII(nc:number,re:number|null|undefined,level:string|undefined){
    if(!selectedInspectionId||detail?.status!=='em_andamento'||level!=='I'||re==null||nc<re)return
    const marker=selectedInspectionId+':I:'+re
    if(levelOfferPrompted.current.has(marker))return
    levelOfferPrompted.current.add(marker)
    if(!window.confirm('Limite de rejeição atingido ('+nc+' NC; Re '+re+'). Deseja ampliar a inspeção para o Nível II? As NC registradas serão preservadas e o plano será recalculado.'))return
    void (async()=>{
      const result=await apiPost<any>('/api/inspecoes/'+selectedInspectionId+'/ampliar-nivel',{})
      if(result.error)return setError(result.error.message)
      const plan=result.data||{}
      setDetail((d:any)=>d?{...d,...plan}:d)
      setMessage('Amostragem ampliada para Nível II: '+plan.tamanho_amostra+' unidades ('+plan.amostras_adicionais+' adicionais). As NC foram preservadas.')
      void refreshLists()
    })()
  }

  function dimensionChecklistKey(name:string):string{
    const normalized=String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/extern[oa]|intern[oa]|dimens(ao|oes)/g,'').trim()
    if(normalized.includes('altura'))return 'altura'
    if(normalized.includes('largura'))return 'largura'
    if(normalized.includes('diametro')||normalized.includes('circularidade'))return 'diametro'
    if(normalized.includes('espessura'))return 'espessura'
    if(normalized.includes('peso'))return 'peso'
    return ''
  }
  function dimensionalNcForChecklist(item:any){
    const key=dimensionChecklistKey(item?.requisito)
    if(!key)return {count:0,skus:[] as string[]}
    const dimensionIds=new Set((detail?.params||[])
      .filter((p:any)=>dimensionChecklistKey(p.nome)===key).map((p:any)=>p.id))
    const skuMap=new Map((detail?.items||[]).map((x:any)=>[
      x.processo_itens?.id,x.processo_itens?.produtos?.sku||'SKU não informado'
    ]))
    const matching=new Map<string,any>()
    for(const row of detail?.dimResults||[]){
      if(row.conforme!==false||!dimensionIds.has(row.parametro_id))continue
      const cfg=getDimConfig(row.processo_item_id,row.parametro_id)
      if(cfg?.nao_aplicavel)continue
      matching.set(row.processo_item_id+':'+row.sequencia_amostra,row)
    }
    const skus=[...new Set([...matching.values()].map(x=>String(skuMap.get(x.processo_item_id)||'')))]
    return {count:matching.size,skus}
  }
  const [isOnline,setIsOnline]=useState(navigator.onLine)
  const [offlinePending,setOfflinePending]=useState(0)
  const [offlineConflicts,setOfflineConflicts]=useState(0)
  const [offlineDraftReady,setOfflineDraftReady]=useState(false)
  const [offlineDraftStatus,setOfflineDraftStatus]=useState('')
  const [offlineError,setOfflineError]=useState('')
  const editingBaseline=useRef<string|null>(null)
  const [editingProcess, setEditingProcess] = useState<ProcessRow | null>(null)
  const [processEditSaving,setProcessEditSaving]=useState(false)
  const [focusedProcessId,setFocusedProcessId] = useState<string|null>(null)
  const [deletingProcessId,setDeletingProcessId]=useState<string|null>(null)
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState<'dados'|'amostragem'|'verificacoes'|'dimensionais'|'testes'|'fotos'|'resultado'|'retencao'>('dados')
  const [detail, setDetail] = useState<any>(null)
  type WordReadiness={ready:boolean;pending:string[];error?:string}
  const [wordStatus,setWordStatus]=useState<WordReadiness|null>(null)
  function parseWordStatus(response:any):WordReadiness {
    if(response?.error){
      const message=String(response.error.message||'Falha ao consultar as pendências do laudo.')
      const details=String(response.error.details||'').trim()
      return {ready:false,pending:[],error:details && details!=='Internal Server Error'
        ?message+' — '+details:message}
    }
    const pending=Array.isArray(response?.data?.pending)
      ?response.data.pending.map((value:any)=>String(value)):[]
    const ready=response?.data?.ready===true
    return {ready,pending,error:!ready && !pending.length
      ?'A validação não informou o motivo do bloqueio. Verifique novamente.':undefined}
  }
  async function refreshWordStatus(){
    const processId=detail?.grupos_inspecao?.processo_id as string|undefined
    if(!processId){
      setWordStatus({ready:false,pending:['FST principal não identificado nesta inspeção.']})
      return
    }
    setWordCheckBusy(true)
    try{
      // Laudo padrão do FST: A e B compartilham um único documento.
      const response=await apiGet<any>('/api/processos/'+encodeURIComponent(processId)+'/laudo-status')
      setWordStatus(parseWordStatus(response))
    }catch(e:any){
      setWordStatus({ready:false,pending:[],error:'Falha de comunicação ao verificar o Word: '+String(e?.message||'sem resposta')})
    }finally{
      setWordCheckBusy(false)
    }
  }
  function reflectCompletedEdit(){
    if(detail?.status!=='concluida')return
    setDetail((current:any)=>current?{...current,documento_gerado_em:null}:current)
    setWordStatus(null)
    setMessage('Retificação registrada no histórico. O próximo Word incluirá os dados atualizados.')
  }
  const [allowDimensionalRectification,setAllowDimensionalRectification]=useState(false)
  const [finalObservation, setFinalObservation] = useState('')
  const [internalObservation, setInternalObservation] = useState('')
  const [retentionRows, setRetentionRows] = useState<Record<string,{
    retain:boolean; qty:string; address:string; photoFile:File|null; photoPreview:string
  }>>({})
  const [retentionReason, setRetentionReason] = useState('')
  const [stockMove, setStockMove] = useState({ tipo: 'retirada', quantidade: '', endereco: '', motivo: '' })
  const [stockMode,setStockMode]=useState<'posicoes'|'inventario'>('posicoes')
  const [stockSkuConflicts,setStockSkuConflicts]=useState<StockSkuConflict[]>([])
  const [stockSkuSelection,setStockSkuSelection]=useState<Record<string,string>>({})
  const [stockSkuFixing,setStockSkuFixing]=useState<string|null>(null)
  const [stockSkuChecks,setStockSkuChecks]=useState<Record<string,StockSkuValidation>>({})
  const [stockSkuChecking,setStockSkuChecking]=useState<string|null>(null)
  const [pendingPhotos, setPendingPhotos] = useState<Array<{id:string;file:File;url:string;legenda:string;productId:string;isProductId:boolean}>>([])
  const [photoCaptionDrafts,setPhotoCaptionDrafts]=useState<Record<string,string>>({})
  const [lastSavedPhotoCaptionId,setLastSavedPhotoCaptionId]=useState<string|null>(null)
  const [savingPhotoCaptionId,setSavingPhotoCaptionId]=useState<string|null>(null)
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
    subprocessoCodigo: 'A',
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
  const [inheritedReference,setInheritedReference]=useState<{
    letter:string;invoice:string;origin:string;transport:string;arrival:string;
    historical:boolean;quantity:string;boxes:string
  }|null>(null)
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
    sku: '',
    descricao: '',
    lote: '',
    quantidade: '',
    endereco: '',
    unidade: 'conjunto',
  })

  const canWrite = profile && profile.perfil !== 'consulta'
  const canCorrectStockSku = !!profile && ['administrador','gestor','inspetor'].includes(profile.perfil)
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

  const [isComponentSet,setIsComponentSet] = useState(false)
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
      setProcessItemLinks([])
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
            setProcessItemLinks(offline.itemLinks||[])
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
      void saveOfflineDraft(userId||'','app:bootstrap',{profile:data.profile,processes:data.processes,inspections:data.inspections,itemLinks:data.itemLinks})
        .catch(()=>undefined)
      setProcesses((data.processes ?? []) as ProcessRow[])
      setInspections((data.inspections ?? []) as InspectionRow[])
      setProcessItemLinks(data.itemLinks??[])
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
    setInheritedReference(null)
    autoNfeRef.current=null
    setEditingInspectionId(null);setEditingProcessId(null);setActiveProductIndex(0);setExpandedSkuIndex(0)
    manualItSelection.current=false;lastItSuggested.current='';setItSuggestionNote('');setProcessLookupMessage('')
    fstLookupRequest.current++;setOmieSkuImport(null);setOmieSkuReview(null);setOmieSkuReviewError('');setOmieOrderPickerOpen(false);setOmieOrders(null);setOmieSelectedOrder('')
    setInspection({
      processoId: '', subprocessoCodigo: 'A', codigo: '', cliente: '', notaFiscal: '', origem: 'China', transporte: '', chegadaCd: '',
      dataInspecao: '', itVersionId: '', inspectionLevel: 'I', observacaoInterna: '',
    })
    setSkuRows([emptySku()]);setIsComponentSet(false)
  }

  function fillTestInspectionData() {
    const today=new Date().toISOString().slice(0,10)
    const suffix=String(Date.now()).slice(-6)
    setInspection((current)=>({
      ...current,
      processoId:'',
      subprocessoCodigo:'A',
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

  function nextSubprocessFor(p:ProcessRow){
    const used=new Set(inspections.filter(i=>i.grupos_inspecao?.processo_id===p.id)
      .map(i=>i.grupos_inspecao?.subprocesso_codigo).filter(Boolean))
    return Array.from({length:26},(_,i)=>String.fromCharCode(65+i)).find(letter=>!used.has(letter))||'A'
  }

  async function registerParentProcess(){
    if(!canWrite||inspectionBusy)return
    const codigo=parentFstCode(inspection.codigo)
    if(!codigo||!inspection.itVersionId){
      setPopupMessage('Informe o FST principal e selecione uma IT para cadastrá-lo.')
      return
    }
    if(processes.some(p=>parentFstCode(p.codigo)===codigo)){
      setPopupMessage('Este FST já existe. Selecione o processo na lista.')
      return
    }
    setInspectionBusy(true)
    try{
      const created=await apiPost<any>('/api/processos/cadastrar',{
        codigo,cliente:inspection.cliente,origem:inspection.origem,
        transporte:inspection.transporte,chegadaCd:inspection.chegadaCd||null,
        itVersionId:inspection.itVersionId,
      })
      if(created.error||!created.data?.id){
        setPopupMessage(created.error?.message||'Falha ao cadastrar FST.')
        return
      }
      const p=created.data as ProcessRow
      setProcesses(old=>[p,...old])
      setInspection(old=>({...old,processoId:p.id,codigo,subprocessoCodigo:'A',
        cliente:p.cliente??old.cliente,itVersionId:p.it_versao_id??old.itVersionId}))
      setMessage('FST principal cadastrado. Adicione agora a inspeção do subprocesso A.')
      void refreshLists()
    }finally{setInspectionBusy(false)}
  }

  function reuseProcess(p: ProcessRow) {
    autoNfeRef.current=null
    fstLookupRequest.current++
    setOmieSkuImport(null);setOmieSkuReview(null);setOmieSkuReviewError('');setOmieOrderPickerOpen(false);setOmieOrders(null);setOmieSelectedOrder('')
    setEditingInspectionId(null);setEditingProcessId(null)
    const previous=inspections.filter(i=>i.grupos_inspecao?.processo_id===p.id)
      .sort((a,b)=>String(a.grupos_inspecao?.subprocesso_codigo??'Z')
        .localeCompare(String(b.grupos_inspecao?.subprocesso_codigo??'Z')))
    const first=previous[0]
    const source=first?.grupos_inspecao
    const hasChildReference=Boolean(source&&(source.origem||source.transporte||source.chegada_cd))
    const historical=!!first&&!hasChildReference
    const reference=first?{
      letter:source?.subprocesso_codigo??'A',invoice:source?.nota_fiscal??'',
      origin:hasChildReference?source?.origem??'':p.origem??'',
      transport:hasChildReference?source?.transporte??'':p.transporte??'',
      arrival:hasChildReference?source?.chegada_cd??'':p.chegada_cd??'',
      historical,quantity:String(first.tamanho_lote??''),boxes:''
    }:null
    setInheritedReference(reference)
    setInspection(x=>({
      ...x,processoId:p.id,subprocessoCodigo:nextSubprocessFor(p),
      itVersionId:p.it_versao_id??x.itVersionId,
      codigo:fstCode(p.codigo),cliente:p.cliente??'',
      // Never persist child A/B operational values into a new child implicitly.
      // The first inspection's values are shown separately as a read-only reference.
      notaFiscal:'',
      origem:'',
      transporte:'',
      chegadaCd:'',
      dataInspecao:''
    }))
    if(first){
      void apiGet<any>('/api/inspecoes/'+encodeURIComponent(first.id)+'/detalhe').then(res=>{
        if(res.error||!res.data)return
        const items=res.data.items??[]
        const quantity=items.reduce((sum:number,link:any)=>sum+Number(link.processo_itens?.quantidade||0),0)
        const boxes=items.reduce((sum:number,link:any)=>sum+Number(link.processo_itens?.caixas_recebidas||0),0)
        setInheritedReference(current=>current?.letter===(source?.subprocesso_codigo??'A')
          ?{...current,quantity:String(quantity||first.tamanho_lote||''),boxes:String(boxes||'')}:current)
      }).catch(()=>undefined)
    }
    setExpandedSkuIndex(0)
    setSkuRows([emptySku()]);setIsComponentSet(false)
    setTab('nova')
    setMessage('Nova inspeção independente. Confira os valores sugeridos antes de salvar.')
  }

  async function editInspectionFull(id:string){
    setError('')
    const res=await apiGet<any>('/api/inspecoes/'+id+'/detalhe')
    let source=res.data
    if(res.error||!source?.inspecao){
      source=await readOfflineDraft<any>(userId||'','full:detail:'+id).catch(()=>null)
      if(!source?.inspecao){setPopupMessage(res.error?.message||'Inspeção indisponível offline.');return}
    }else void saveOfflineDraft(userId||'','full:detail:'+id,source).catch(()=>undefined)
    editingBaseline.current=offlineInspectionVersion(source)
    setInheritedReference(null)
    const data={...source.inspecao,items:source.items??[]}
    const process=data.grupos_inspecao?.processos??{}
    const items=(data.items??[]).map((link:any)=>{
      const x=link.processo_itens
      return suggestMissingInspectedBoxes(applyBoxGroupsToSku({...emptySku(),processoItemId:x.id,sku:x.produtos?.sku??'',
        nome:x.produtos?.nome??'',quantidadePv:x.quantidade_pv==null?'':String(x.quantidade_pv),
        numeroPedidoPv:x.pv_numero??'',fstPv:x.pv_fst??'',lote:x.lote??'',material:x.material??'',capacidade:x.capacidade??'',
        quantidade:String(x.quantidade??''),quantidadePorCaixa:String(x.quantidade_por_caixa??''),
        caixasRecebidas:String(x.caixas_recebidas??''),caixasInspecionadas:String(x.caixas_inspecionadas??''),
        unidadesPorConjunto:String(link.unidades_por_conjunto??1)},x.distribuicao_caixas))
    })
    const form={
      codigo:fstCode(process.codigo),cliente:process.cliente??'',notaFiscal:data.grupos_inspecao?.nota_fiscal??process.nota_fiscal??'',
      origem:data.grupos_inspecao?.origem??'',transporte:data.grupos_inspecao?.transporte??'',
      chegadaCd:data.grupos_inspecao?.chegada_cd??'',
      dataInspecao:String(data.data_inspecao??'').slice(0,10),itVersionId:data.it_versao_id??'',
      inspectionLevel:data.nivel_inspecao??'I',observacaoInterna:data.observacao_interna??'',
      itens:items.length?items:[emptySku()]
    }
    setExpandedEditSkuIndex(items.length>1?null:0)
    editMetadataBaseline.current=editMetadataFingerprint(form)
    setSelectedInspectionId(data.id)
    setEditingInspectionId(null);setEditingProcessId(null)
    setEditFeedback('')
    editLastSavedFingerprint.current=null
    setEditingInspectionData(form)
    setMessage('')
  }
  function editProcessFull(p:ProcessRow){
    // Dados comuns pertencem ao processo, não à inspeção pendente nem à NF de A/B.
    setError('')
    setEditingProcess({...p,nota_fiscal:null})
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
    setProcessItemLinks(res.data.itemLinks??[])
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
    const existing=processes.find(p=>parentFstCode(p.codigo)===parentFstCode(code))
    if(existing){
      setInspection(old=>parentFstCode(old.codigo)===parentFstCode(code)?{
        ...old,processoId:existing.id,itVersionId:existing.it_versao_id??old.itVersionId,
        subprocessoCodigo:code.match(/-([A-Z])$/)?.[1]??(old.processoId===existing.id?old.subprocessoCodigo:nextSubprocessFor(existing)),cliente:old.cliente||existing.cliente||'',
        notaFiscal:old.notaFiscal,origem:old.origem,
        transporte:old.transporte,chegadaCd:old.chegadaCd
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
    if(!editingProcess || processEditSaving)return
    const previous=processes.find(p=>p.id===editingProcess.id)
    const itChanged=!!editingProcess.it_versao_id &&
      editingProcess.it_versao_id!==previous?.it_versao_id
    if(itChanged){
      const it=itVersions.find(v=>v.id===editingProcess.it_versao_id)
      if(!it || it.status!=='publicada'){
        setError('Selecione uma versão de IT publicada.');return
      }
      if(!window.confirm('Trocar a IT do FST '+editingProcess.codigo+
        '? Todas as entradas serão reiniciadas para a nova IT. Fotos e histórico permanecem; verificações, medições e testes antigos não serão reutilizados.'))return
    }
    setProcessEditSaving(true);setError('')
    try{
      if(itChanged){
        if(!navigator.onLine){setError('A troca de IT requer conexão para atualizar todas as inspeções com segurança.');return}
        const changed=await apiPut<any>('/api/processos/'+encodeURIComponent(editingProcess.id)+'/it',{
          itVersionId:editingProcess.it_versao_id,confirmado:true
        })
        if(changed.error || !changed.data?.ok){
          setError(changed.error?.message||'O servidor não confirmou a troca de IT.');return
        }
      }
      if(editingProcess.cliente!==previous?.cliente){
        const saved=await apiPut<any>('/api/processos/'+encodeURIComponent(editingProcess.id),{
          cliente:editingProcess.cliente,notaFiscal:null,
        })
        if(saved.error){setError(saved.error.message);void refreshLists();return}
      }
      const revised={...editingProcess,nota_fiscal:null}
      const it=itVersions.find(v=>v.id===revised.it_versao_id)
      setProcesses(current=>current.map(p=>p.id===revised.id?{...p,...revised}:p))
      setInspections(current=>current.map(item=>item.grupos_inspecao?.processo_id===revised.id?{
        ...item,
        it_versoes:itChanged&&it?{id:it.id,versao:it.versao,instrucoes_trabalho:it.instrucoes_trabalho}:item.it_versoes,
        grupos_inspecao:{...item.grupos_inspecao,
          processos:{...item.grupos_inspecao?.processos,...revised}}
      }:item))
      setDetail((current:any)=>current?.grupos_inspecao?.processo_id===revised.id?{
        ...current,
        it_versao_id:itChanged?revised.it_versao_id:current.it_versao_id,
        it_versoes:itChanged&&it?{id:it.id,versao:it.versao,instrucoes_trabalho:it.instrucoes_trabalho}:current.it_versoes,
        documento_gerado_em:itChanged?null:current.documento_gerado_em,
        grupos_inspecao:{...current.grupos_inspecao,
          processos:{...current.grupos_inspecao.processos,...revised}}
      }:current)
      setEditingInspectionData((current:any)=>current&&detail?.grupos_inspecao?.processo_id===revised.id
        ?{...current,itVersionId:revised.it_versao_id}:current)
      setInspection(current=>current.processoId===revised.id?
        {...current,itVersionId:revised.it_versao_id??''}:current)
      setWordStatus(null)
      setEditingProcess(null)
      setMessage(itChanged?'IT alterada. As entradas foram reiniciadas e as fotos preservadas.':'Processo atualizado.')
      void refreshLists()
    }finally{setProcessEditSaving(false)}
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

  async function removeSavedInspectionPhoto(photo:any){
    if(!canWrite||!selectedInspectionId||photoUploadBusy)return
    if(!window.confirm('Remover esta foto do subprocesso? Ela sairá da galeria e do laudo, mas será preservada no histórico de auditoria.'))return
    const id=selectedInspectionId
    setPhotoUploadBusy(true);setError('')
    try{
      const removed=await apiPost<any>(
        '/api/inspecoes/'+encodeURIComponent(id)+'/fotos/'+encodeURIComponent(photo.id)+'/remover',{})
      if(removed.error){setError(removed.error.message);return}
      photosLinksExpiration.current.delete(id)
      await refreshInspectionPhotoEvidence()
      setInspections(current=>[...current])
      setMessage('Foto removida deste subprocesso. Histórico preservado.')
    }catch(e:any){setError(String(e?.message||'Falha ao remover foto.'))}
    finally{setPhotoUploadBusy(false)}
  }

  async function replaceSavedInspectionPhoto(photo:any,file:File|null){
    if(!file||!canWrite||!selectedInspectionId||photoUploadBusy)return
    if(!file.type.startsWith('image/'))return setError('Selecione um arquivo de imagem.')
    if(file.size>20*1024*1024)return setError('A imagem deve ter até 20 MB.')
    if(detail?.status==='concluida'&&
       !window.confirm('Substituir uma foto de inspeção concluída? A imagem antiga será arquivada para auditoria.'))return
    const id=selectedInspectionId
    setPhotoUploadBusy(true);setError('')
    const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
    const path=id+'/gerais/'+crypto.randomUUID()+'-'+safe
    try{
      const uploaded=await supabase.storage.from('inspecao-fotos').upload(path,file,{contentType:file.type})
      if(uploaded.error){setError('Não foi possível enviar a nova imagem: '+uploaded.error.message);return}
      const swapped=await apiPost<any>(
        '/api/inspecoes/'+encodeURIComponent(id)+'/fotos/'+encodeURIComponent(photo.id)+'/substituir',
        {storagePath:path,legenda:photoCaptionDrafts[photo.id]??photo.legenda??''})
      if(swapped.error){
        // New upload is not yet evidence in the database; clean up if permitted.
        void (supabase.storage.from('inspecao-fotos') as any).remove?.([path])
        setError(swapped.error.message)
        return
      }
      photosLinksExpiration.current.delete(id)
      await refreshInspectionPhotoEvidence()
      setInspections(current=>[...current])
      setMessage('Foto substituída neste subprocesso. Original mantida no histórico.')
    }catch(e:any){setError(String(e?.message||'Falha ao trocar foto.'))}
    finally{setPhotoUploadBusy(false)}
  }

  async function savePhotoCaption(photoId:string,currentCaption:string) {
    if(!selectedInspectionId||!canWrite||savingPhotoCaptionId)return
    const caption=String(photoCaptionDrafts[photoId]??currentCaption??'').trim()
    if(caption.length>300){setError('A legenda deve ter no máximo 300 caracteres.');return}
    setSavingPhotoCaptionId(photoId)
    setLastSavedPhotoCaptionId(null)
    setError('')
    try{
      const saved=await apiPut<any>(
        '/api/inspecoes/'+encodeURIComponent(selectedInspectionId)+'/fotos/'+encodeURIComponent(photoId)+'/legenda',
        {legenda:caption}
      )
      if(saved.error){setError(saved.error.message);return}
      setDetail((current:any)=>current?{...current,photos:(current.photos??[]).map((p:any)=>
        p.id===photoId?{...p,legenda:caption}:p)}:current)
      setPhotoCaptionDrafts(previous=>{
        const copy={...previous}
        delete copy[photoId]
        return copy
      })
      setLastSavedPhotoCaptionId(photoId)
      setMessage('Legenda salva.')
    }catch(e:any){
      setError('Não foi possível salvar a legenda: '+String(e?.message||'erro de conexão'))
    }finally{setSavingPhotoCaptionId(null)}
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
    setWordStatus(null)
    if(selectedInspectionId!==id){setActiveStage('dados');setAllowDimensionalRectification(false)}
    setSelectedInspectionId(id)
    const loaded=await apiGet<any>('/api/inspecoes/'+id+'/detalhe')
    let data=loaded.data
    if (loaded.error || !data?.inspecao) {
      data=await readOfflineDraft<any>(userId||'','full:detail:'+id).catch(()=>null)
      if(!data?.inspecao)return setError(loaded.error?.message ?? 'Inspeção não disponível offline.')
    }else void saveOfflineDraft(userId||'','full:detail:'+id,data).catch(()=>undefined)
    editingBaseline.current=offlineInspectionVersion(data)
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
      retention[item.id]={retain:!!existing,qty:'',address:'',photoFile:null,photoPreview:''}
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
    if(detail.status==='concluida'&&!navigator.onLine){
      setError('Conecte-se para editar a inspeção concluída com registro de auditoria.')
      return
    }
    setWordStatus(null)
    const process=detail.grupos_inspecao?.processos ?? {}
    const rows=(detail.items ?? []).map((link:any)=>{
      const item=link.processo_itens
      const base={...emptySku(),processoItemId:item.id,sku:item.produtos?.sku ?? '',nome:item.produtos?.nome ?? '',
        quantidadePv:item.quantidade_pv==null?'':String(item.quantidade_pv),
        numeroPedidoPv:item.pv_numero??'',fstPv:item.pv_fst??'',lote:item.lote ?? '',material:item.material ?? '',capacidade:item.capacidade ?? '',quantidade:String(item.quantidade ?? ''),quantidadePorCaixa:String(item.quantidade_por_caixa ?? ''),caixasRecebidas:String(item.caixas_recebidas ?? ''),caixasInspecionadas:String(item.caixas_inspecionadas ?? ''),unidadesPorConjunto:String(link.unidades_por_conjunto ?? 1)}
      return suggestMissingInspectedBoxes(applyBoxGroupsToSku(base,item.distribuicao_caixas))
    })
    const form={
      codigo:fstCode(process.codigo),cliente:process.cliente ?? '',notaFiscal:detail.grupos_inspecao?.nota_fiscal ?? '',
      origem:detail.grupos_inspecao?.origem ?? '',transporte:detail.grupos_inspecao?.transporte ?? '',
      chegadaCd:detail.grupos_inspecao?.chegada_cd ?? '',dataInspecao:String(detail.data_inspecao ?? '').slice(0,10),inspectionLevel:detail.nivel_inspecao ?? 'I',
      observacaoInterna:detail.observacao_interna ?? '',itVersionId:detail.it_versao_id ?? '',itens:rows,
    }
    setExpandedEditSkuIndex(rows.length>1?null:0)
    editMetadataBaseline.current=editMetadataFingerprint(form)
    setEditFeedback('')
    editLastSavedFingerprint.current=null
    setEditingInspectionData(form)
  }

  async function saveEditingInspectionData() {
    if(!editingInspectionData||!selectedInspectionId||editSaving)return
    const quantityError=operationalQuantityError(editingInspectionData.itens??[])
    if(quantityError){setError(quantityError);return}
    const id=selectedInspectionId
    if(editingInspectionData.chegadaCd && editingInspectionData.dataInspecao &&
       editingInspectionData.dataInspecao<editingInspectionData.chegadaCd)
      return setError('A data da inspeção não pode ser anterior à chegada ao CD.')
    setEditSaving(true);setError('')
    try{
      const itens=(editingInspectionData.itens??[]).map((row:any)=>({
        processoItemId:row.processoItemId,sku:String(row.sku??'').trim(),nome:String(row.nome??'').trim(),
        quantidadePv:row.quantidadePv===''||row.quantidadePv==null?null:Number(row.quantidadePv),
        numeroPedidoPv:String(row.numeroPedidoPv??'').trim()||null,fstPv:String(row.fstPv??'').trim()||null,
        lote:String(row.lote??'').trim()||null,material:String(row.material??'').trim()||null,
        capacidade:String(row.capacidade??'').trim()||null,quantidade:Number(row.quantidade)||0,
        quantidadePorCaixa:Number(row.unidadesPadrao||row.quantidadePorCaixa)||null,
        caixasRecebidas:Number(row.caixasRecebidas)||0,caixasInspecionadas:Number(row.caixasInspecionadas)||0,
        unidadesPorConjunto:Number(row.unidadesPorConjunto)||1,distribuicaoCaixas:boxGroupsFromRow(row)
      }))
      if(itens.some((x:any)=>![x.quantidade,x.caixasRecebidas,x.caixasInspecionadas,
        x.unidadesPorConjunto].every((n:number)=>Number.isFinite(n)&&n>=0)) ||
        itens.some((x:any)=>x.unidadesPorConjunto<=0)){
        setError('Confira os valores numéricos antes de salvar.');return
      }
      const changingIt=!!editingInspectionData.itVersionId &&
        editingInspectionData.itVersionId!==detail?.it_versao_id
      if(changingIt){
        if(!navigator.onLine){
          setError('Trocar a IT exige conexão para reiniciar a inspeção com segurança.')
          return
        }
        if(!window.confirm('Trocar a IT desta entrada? A inspeção será reiniciada, com verificações, medições e testes zerados. Todas as fotos serão reutilizadas e o histórico anterior será preservado.'))return
      }
      const editPayload={
        codigo:String(editingInspectionData.codigo??'').trim(),cliente:String(editingInspectionData.cliente??'').trim()||null,
        notaFiscal:String(editingInspectionData.notaFiscal??'').trim()||null,
        origem:String(editingInspectionData.origem??'').trim()||null,
        transporte:String(editingInspectionData.transporte??'').trim()||null,
        chegadaCd:editingInspectionData.chegadaCd||null,
        dataInspecao:editingInspectionData.dataInspecao||null,
        inspectionLevel:editingInspectionData.inspectionLevel||'I',
        observacaoInterna:String(editingInspectionData.observacaoInterna??'').trim()||null,
        itVersionId:editingInspectionData.itVersionId||null,itens,
      }
      // Only quantities/warehouse distribution changed? Save without touching product,
      // Omie, catalogue, or the rest of the process's general data.
      const fastPath=editMetadataBaseline.current===editMetadataFingerprint(editingInspectionData)
        && itens.length>0&&itens.every((item:any)=>!!item.processoItemId)
      if(!navigator.onLine){
        if(changingIt){setError('A troca de IT exige conexão.');return}
        await queueInspectionUpdate(id,editPayload)
        setMessage('Alterações guardadas no dispositivo. Serão sincronizadas ao voltar a conexão.')
        editLastSavedFingerprint.current=JSON.stringify(editingInspectionData)
        setEditFeedback('Salvo no dispositivo · aguardando sincronização')
        return
      }
      const saved=await apiPut<any>(
        '/api/inspecoes/'+encodeURIComponent(id)+(fastPath?'/quantidades':'/dados'),
        fastPath?{itens}:editPayload
      )
      if(saved.error){
        if(!changingIt&&(connectionFailure(saved.error.message)||!navigator.onLine)){
          await queueInspectionUpdate(id,editPayload)
          setMessage('Alterações guardadas no dispositivo. Sincronização pendente.')
          editLastSavedFingerprint.current=JSON.stringify(editingInspectionData)
          setEditFeedback('Salvo no dispositivo · aguardando sincronização')
        }else setError(saved.error.message)
        return
      }
      if(saved.data?.reiniciada){
        setEditingInspectionData(null)
        setAllowDimensionalRectification(false)
        setWordStatus(null)
        await openInspection(id)
        setActiveStage('verificacoes')
        setMessage('IT alterada. Inspeção reiniciada; fotos mantidas ('+
          Number(saved.data.fotosPreservadas??0)+'). Verificações, dimensionais e testes da IT anterior foram arquivados no histórico.')
        void refreshLists()
        return
      }
      const p=saved.data?.plano
      editMetadataBaseline.current=editMetadataFingerprint(editingInspectionData)
      // Refresh the visible inspection without loading another page or waiting for
      // a second detail/bootstrap roundtrip. Keep the edit grid in place.
      setDetail((current:any)=>{
        if(!current||current.id!==id)return current
        const updated=(current.items??[]).map((link:any)=>{
          const item=itens.find((x:any)=>x.processoItemId===link.processo_itens?.id)
          if(!item)return link
          return {...link,
            unidades_por_conjunto:item.unidadesPorConjunto,
            quantidade_componente:item.quantidade,
            processo_itens:{...link.processo_itens,quantidade:item.quantidade,
              quantidade_por_caixa:item.quantidadePorCaixa,
              caixas_recebidas:item.caixasRecebidas||null,
              caixas_inspecionadas:item.caixasInspecionadas||null,
              distribuicao_caixas:item.distribuicaoCaixas,
              lote:item.lote,material:item.material,capacidade:item.capacidade,
              produtos:{...link.processo_itens.produtos,sku:item.sku,nome:item.nome}}
          }
        })
        return {...current,items:updated,
          tamanho_lote:p?.lote??current.tamanho_lote,
          tamanho_amostra:p?.amostra??current.tamanho_amostra,
          caixas_recebidas:p?.caixasRecebidas??itens.reduce((sum:any,x:any)=>sum+x.caixasRecebidas,0),
          caixas_avaliar:p?.caixasAvaliar??itens.reduce((sum:any,x:any)=>sum+x.caixasInspecionadas,0),
          codigo_amostragem:p?.codigo??current.codigo_amostragem,
          limite_aceitacao:p?.ac??current.limite_aceitacao,
          limite_rejeicao:p?.re??current.limite_rejeicao,
          documento_gerado_em:null,
          data_inspecao:editPayload.dataInspecao,
          observacao_interna:editPayload.observacaoInterna,
          grupos_inspecao:{...current.grupos_inspecao,
            nota_fiscal:fastPath?current.grupos_inspecao?.nota_fiscal:editPayload.notaFiscal,
            origem:fastPath?current.grupos_inspecao?.origem:editPayload.origem,
            transporte:fastPath?current.grupos_inspecao?.transporte:editPayload.transporte,
            chegada_cd:fastPath?current.grupos_inspecao?.chegada_cd:editPayload.chegadaCd,
            processos:{...current.grupos_inspecao?.processos,
              cliente:fastPath?current.grupos_inspecao?.processos?.cliente:editPayload.cliente}
          }
        }
      })
      setInspections(current=>current.map(item=>item.id===id?{
        ...item,tamanho_lote:p?.lote??item.tamanho_lote,
        tamanho_amostra:p?.amostra??item.tamanho_amostra,
        codigo_amostragem:p?.codigo??item.codigo_amostragem,
        grupos_inspecao:item.grupos_inspecao?{...item.grupos_inspecao,
          nota_fiscal:fastPath?item.grupos_inspecao.nota_fiscal:editPayload.notaFiscal,
          origem:fastPath?item.grupos_inspecao.origem:editPayload.origem,
          transporte:fastPath?item.grupos_inspecao.transporte:editPayload.transporte,
          chegada_cd:fastPath?item.grupos_inspecao.chegada_cd:editPayload.chegadaCd,
          processos:item.grupos_inspecao.processos?{...item.grupos_inspecao.processos,
            cliente:fastPath?item.grupos_inspecao.processos.cliente:editPayload.cliente
          }:item.grupos_inspecao.processos
        }:item.grupos_inspecao
      }:item))
      setWordStatus(null)
      if(!fastPath){
        const pid=detail?.grupos_inspecao?.processo_id
        if(pid)setProcesses(current=>current.map(proc=>proc.id===pid?
          {...proc,cliente:editPayload.cliente}:proc))
      }
      setMessage(fastPath?'Quantidades e caixas salvas.':'Dados da inspeção salvos.')
      editLastSavedFingerprint.current=JSON.stringify(editingInspectionData)
      setEditFeedback('Alterações salvas')
      // Update the offline conflict baseline asynchronously; no forced navigation.
      void apiGet<any>('/api/inspecoes/'+encodeURIComponent(id)+'/detalhe').then(r=>{
        if(!r.error&&r.data?.inspecao){
          editingBaseline.current=offlineInspectionVersion(r.data)
          void saveOfflineDraft(userId||'','full:detail:'+id,r.data).catch(()=>undefined)
          // Reconcile the summary, SKUs and invoice with actual persisted values.
          setDetail((current:any)=>current?.id===id?{
            ...current,...r.data.inspecao,items:r.data.items??current.items,
            grupos_inspecao:r.data.inspecao.grupos_inspecao??current.grupos_inspecao
          }:current)
        }
      }).catch(()=>undefined)
      void refreshLists()
    }catch(e:any){setError(String(e?.message||'Não foi possível salvar.'))}
    finally{setEditSaving(false)}
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
        sku:row.sku.trim(),nome:row.nome.trim(),
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
      codigo:parentFstCode(inspection.codigo),processoId:inspection.processoId||null,
      subprocessoCodigo:inspection.subprocessoCodigo,ehConjunto:isComponentSet,
      requestId:createRequestId.current,
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
    const quantityError=operationalQuantityError(skuRows)
    if(quantityError){setPopupMessage(quantityError);return}
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

    if (iniciar && !inspection.itVersionId) {setPopupMessage('Selecione a IT no FST principal para iniciar a inspeção.');return}
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

    if(inspection.chegadaCd && inspection.dataInspecao && inspection.dataInspecao<inspection.chegadaCd){
      setInspectionBusy(false)
      return setError('A data da inspeção não pode ser anterior à chegada ao CD.')
    }
    const created=await apiPost<any>('/api/inspecoes/criar',{
      codigo:parentFstCode(inspection.codigo),
      processoId:inspection.processoId||null,
      subprocessoCodigo:inspection.subprocessoCodigo,ehConjunto:isComponentSet,
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
    const fst=parentFstCode(inspection.codigo)
    const existing=processes.find(p=>parentFstCode(p.codigo)===fst)
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
        id:created.data.grupo_inspecao_id||'',subprocesso_codigo:inspection.subprocessoCodigo,
        nota_fiscal:inspection.notaFiscal||null,nome:skuRows.find(row=>row.nome.trim())?.nome||'Inspeção',
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
  async function moveInspectionOnBoard(id:string,target:'aberta'|'em_andamento'){
    if(!canWrite||kanbanMoveLock.current)return
    const current=inspections.find(i=>i.id===id)
    if(!current || !['aberta','em_andamento'].includes(current.status) || current.status===target)return
    kanbanMoveLock.current=id
    setKanbanMovingId(id)
    setError('')
    try{
      const endpoint=target==='em_andamento'?'iniciar':'voltar-nao-iniciada'
      const moved=await apiPost<any>('/api/inspecoes/'+encodeURIComponent(id)+'/'+endpoint,{})
      if(moved.error){
        setPopupMessage(moved.error.message||'Não foi possível mover a inspeção.')
        return
      }
      setInspections(rows=>rows.map(i=>i.id===id?{...i,status:target}:i))
      setDetail((prev:any)=>prev?.id===id?{...prev,status:target}:prev)
      setMessage(target==='em_andamento'?'Inspeção iniciada.':'Inspeção movida para Não iniciadas.')
      void refreshLists()
    }catch{
      setPopupMessage('Não foi possível alterar o status. Verifique a conexão.')
    }finally{
      kanbanMoveLock.current=null
      setKanbanMovingId(null)
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
    if(detail?.status==='aberta'&&stage!=='dados'&&stage!=='fotos'){void startSavedInspection(stage);return}
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


  async function queueInspectionField(kind:'inspection-checklist'|'inspection-note',path:string,body:any,expected:string){
    if(!userId)throw new Error('Sessão local indisponível.')
    const id=userId+':'+kind+':'+path
    const old=(await offlineOperations(userId)).find(x=>x.id===id)
    await enqueueOfflineOperation({id,userId,kind,path,body,
      expected:old?.expected??expected,createdAt:old?.createdAt??Date.now()})
    await refreshOfflineCounts(userId)
  }

  async function saveChecklist(checkId: string, result: string, quantityNc?:number) {
    if (!selectedInspectionId || !detail || !canWrite)return
    if(detail.status==='concluida' && !allowDimensionalRectification)return
    if(detail.status==='concluida' && !navigator.onLine)return setError('Retificação após conclusão exige conexão.')
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
    const checklistPath='/api/inspecoes/'+selectedInspectionId+'/checklist/'+checkId
    const checklistBody={resultado:result,quantidadeNc:ncQty}
    const checklistExpected=JSON.stringify(previous?{resultado:previous.resultado,quantidade_nc:Number(previous.quantidade_nc||0)}:null)
    if(!navigator.onLine){
      try{await queueInspectionField('inspection-checklist',checklistPath,checklistBody,checklistExpected)}
      catch(e:any){setError('Falha ao salvar offline: '+String(e?.message||''))}
      return
    }
    const saved=await apiPut<any>(checklistPath,checklistBody)
    if (saved.error) {
      if(connectionFailure(saved.error.message)){
        try{await queueInspectionField('inspection-checklist',checklistPath,checklistBody,checklistExpected)}
        catch(e:any){setError('Falha ao salvar offline: '+String(e?.message||''))}
        return
      }
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
    if(saved.data?.re_atingido)maybeOfferLevelII(Number(saved.data.total_nao_conforme||0),
      Number(saved.data.limite_rejeicao),String(saved.data.nivel_inspecao||'I'))
    reflectCompletedEdit()
  }

  async function saveUniqueNcSummary() {
    if(!selectedInspectionId || !detail || !canWrite)return
    if(detail.status==='concluida' && !allowDimensionalRectification)return
    if(detail.status==='concluida' && !navigator.onLine)return setError('Retificação após conclusão exige conexão.')
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
    reflectCompletedEdit()
    maybeOfferLevelII(Number(saved.data?.total_nao_conforme??qty),Number(detail.limite_rejeicao??0),String(detail.nivel_inspecao||'I'))
    setMessage('Quantidade de unidades NC únicas atualizada para o cálculo Ac/Re.')
  }

  async function saveInternalObservation() {
    if (!selectedInspectionId || !canWrite) return
    if(detail?.status==='concluida' && !allowDimensionalRectification)return
    if(detail?.status==='concluida' && !navigator.onLine)return setError('Retificação após conclusão exige conexão.')
    const path='/api/inspecoes/'+selectedInspectionId+'/observacao-interna'
    const body={texto:internalObservation.trim()||null}
    const expected=JSON.stringify(String(detail?.observacao_interna||''))
    if(!navigator.onLine){
      try{
        await queueInspectionField('inspection-note',path,body,expected)
        setDetail((d:any)=>d?{...d,observacao_interna:body.texto}:d)
        setMessage('Observação salva neste dispositivo.')
      }catch(e:any){setError(String(e?.message||''))}
      return
    }
    const saved=await apiPut<any>(path,body)
    if(saved.error){
      if(connectionFailure(saved.error.message)){
        try{
          await queueInspectionField('inspection-note',path,body,expected)
          setDetail((d:any)=>d?{...d,observacao_interna:body.texto}:d)
          setMessage('Observação salva neste dispositivo.')
        }catch(e:any){setError(String(e?.message||''))}
      }else setError(saved.error.message)
      return
    }
    setDetail((d:any)=>d?{...d,observacao_interna:body.texto}:d)
    reflectCompletedEdit()
    setMessage('Observação salva.')
  }

  function getDimConfig(itemId:string, paramId:string) {
    return detail?.dimConfigs?.find((x:any)=>x.processo_item_id===itemId && x.parametro_id===paramId) ?? null
  }


  function usesMeasureReference(param:any) {
    return !String(param?.nome ?? '').trim().toLowerCase().includes('peso')
  }


  async function saveDimConfig(itemId:string, param:any, patch:any) {
    if (!selectedInspectionId || !canWrite) return
    if (detail?.status==='concluida' && !allowDimensionalRectification) return
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
      const updates=(saved as any).medicoesAtualizadas ?? []
      return { ...d, dimConfigs:[...others,saved.data],
        dimResults:(d.dimResults??[]).map((measurement:any)=>{
          const updated=updates.find((x:any)=>x.id===measurement.id)
          return updated ? {...measurement,conforme:updated.conforme} : measurement
        }) }
    })
    // A conferência do Word acontece somente quando o usuário solicita sua geração.
    setWordStatus(null)
    reflectCompletedEdit()
  }

  async function saveDimension(itemId: string, param: any, seq: number, value: string) {
    if (!selectedInspectionId || !value.trim() || !canWrite) return
    if(detail?.status==='concluida' && !allowDimensionalRectification)return
    if(detail?.status==='concluida' && !navigator.onLine)return setError('Retificação após conclusão exige conexão para auditoria.')
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
    reflectCompletedEdit()
  }

  function dimensionSummary(itemId:string,paramId:string) {
    const rows=(detail?.dimResults ?? []).filter((x:any)=>x.processo_item_id===itemId && x.parametro_id===paramId)
    const bySample=new Map<number,number>()
    rows.forEach((x:any)=>{
      const index=Number(x.sequencia_amostra)
      const value=Number(x.valor)
      if(Number.isInteger(index)&&index>=1&&index<=10&&x.valor!=null&&Number.isFinite(value))bySample.set(index,value)
    })
    const values=[...bySample.values()]
    const average=values.length?values.reduce((sum,val)=>sum+val,0)/values.length:null
    const cfg=getDimConfig(itemId,paramId)
    const minimum=cfg?.minimo_aceitavel == null?null:Number(cfg.minimo_aceitavel)
    const maximum=cfg?.maximo_aceitavel == null?null:Number(cfg.maximo_aceitavel)
    const hasTolerance=minimum!=null||maximum!=null
    const nc=hasTolerance?values.filter(v=>(minimum!=null&&v<minimum)||(maximum!=null&&v>maximum)).length:0
    const c=hasTolerance?values.length-nc:0
    const decision=cfg?.nao_aplicavel?'Não aplicável'
      :values.length<10?'Pendente'
      :!hasTolerance?'Aprovado pela média'
      :nc>0?'Reprovado':'Aprovado'
    return {total:values.length,nc,c,average,decision,hasTolerance}
  }


  async function markDimensionalsDone() {
    if (!selectedInspectionId) return
    const saved=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/dimensionais/finalizar`,{})
    if (saved.error) return setError(saved.error.message)
    setMessage('Análises dimensionais concluídas.')
    await openInspection(selectedInspectionId)
  }

  async function completeTests() {
    if (!selectedInspectionId||!detail||!canWrite)return
    if(detail.status==='concluida' && !allowDimensionalRectification)return
    const done=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/testes/finalizar`,{})
    if(done.error){setPopupMessage(done.error.message);return}
    setDetail((d:any)=>d?{...d,testes_finalizados:true}:d)
    setMessage('Testes concluídos.')
  }

  async function suggestAIConclusion(){
    if(!detail||aiConclusionBusy)return
    setAiConclusionBusy(true)
    setAiConclusionError('')
    setError('')
    try{
      const context={
        numeroFst:detail.grupos_inspecao?.processos?.codigo,
        cliente:detail.grupos_inspecao?.processos?.cliente,
        produto:detail.grupos_inspecao?.nome,
        tamanhoAmostra:detail.tamanho_amostra,
        totalInspecionado:detail.total_inspecionado,
        naoConformes:detail.total_nao_conforme,
        resultado:detail.resultado,
        amostragemConcluida:samplingDone,
        checklistConcluido:checklistDone,
        dimensionaisConcluidos:dimsDone,
        testesConcluidos:testsDone,
        checklist:(detail.checklistResults??[]).map((r:any)=>({resultado:r.resultado,observacao:r.observacao})),
        dimensionais:(detail.dimResults??[]).map((r:any)=>({conforme:r.conforme,valor:r.valor_medido})),
        testes:(detail.testResults??[]).map((r:any)=>({resultado:r.resultado})),
        textoAtual:finalObservation,
      }
      const {data,error:aiError}=await authClient.functions.invoke('sgq-conclusao',{body:context})
      let response:any=data
      if(aiError){
        const upstream=(aiError as any).context
        if(typeof upstream?.json==='function'){
          const payload=await upstream.json().catch(()=>null)
          if(payload)response=payload
        }
      }
      if(aiError||response?.error||typeof response?.text!=='string'||!response.text.trim()){
        const type=String(response?.error||'')
        const known:Record<string,string>={
          ai_not_configured:'A integração de IA não está configurada. Verifique a chave Gemini.',
          ai_provider_auth:'A chave da IA foi recusada pelo provedor. Confira a configuração.',
          ai_provider_quota:'A cota da IA foi atingida. Tente novamente após a liberação do limite.',
          ai_model_unavailable:'O modelo de IA configurado está indisponível. Verifique a configuração.',
          ai_provider_unavailable:'O serviço de IA está temporariamente indisponível. Tente novamente.',
          ai_empty_response:'A IA não retornou uma conclusão utilizável. Tente novamente.',
          ai_invalid_request:'A solicitação à IA foi recusada. Confira a configuração do modelo.',
        }
        setAiConclusionError(known[type]||'Não foi possível gerar a sugestão. Tente novamente ou confira a integração de IA.')
        return
      }
      setFinalObservation(response.text.trim())
      setAiConclusionError('')
      setMessage('Sugestão gerada. Revise e edite antes de finalizar.')
    }catch(e:any){
      setAiConclusionError('Falha de comunicação com a IA. Tente novamente.')
    }finally{setAiConclusionBusy(false)}
  }

  async function saveTest(testId: string, result: string) {
    if (!selectedInspectionId || !detail || !canWrite)return
    if(detail.status==='concluida' && !allowDimensionalRectification)return
    if(detail.status==='concluida' && !navigator.onLine)return setError('Retificação após conclusão exige conexão.')
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
    reflectCompletedEdit()
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
    if (!detail || !selectedInspectionId || !canWrite)return
    const retifying=detail.status==='concluida'
    if(retifying && !allowDimensionalRectification)return
    if(retifying && !navigator.onLine)return setError('Retificações após conclusão exigem conexão.')
    if(retifying && !window.confirm('Confirmar o resultado revisado? Esta ação ficará registrada na auditoria.'))return
    const finished=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/concluir`,{
      resultado:result,
      observacoes:finalObservation.trim() || null,
    })
    if (finished.error) return setError(finished.error.message)

    const pendencias:string[]=finished.data?.pendencias ?? []
    setMessage(pendencias.length
      ? 'Resultado revisado com pendências registradas.'
      : retifying?'Resultado retificado e revalidado.':'Inspeção finalizada. A retenção de amostras é opcional.')
    setAllowDimensionalRectification(false)
    void refreshLists()
    await openInspection(selectedInspectionId)
  }

  async function saveRetention() {
    if (!detail || !selectedInspectionId) return
    const selected = (detail.items ?? []).filter((link:any) => retentionRows[link.processo_itens.id]?.retain)

    if (!selected.length) {
      const saved=await apiPost<any>(`/api/inspecoes/${selectedInspectionId}/retencao`,{motivoSemRetencao:retentionReason.trim(),itens:[]})
      if (saved.error) return setError(saved.error.message)
      setMessage('Decisão de não reter registrada. Nenhuma amostra foi movimentada.')
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

  useEffect(()=>{if(tab==='estoque'&&stockMode==='posicoes')void refreshStockSkuConflicts()},[tab,stockMode])
  async function refreshStockSkuConflicts(){
    const reply=await apiGet<{conflitos:StockSkuConflict[]}>('/api/estoque/conflitos-sku')
    if(!reply.error)setStockSkuConflicts(reply.data?.conflitos||[])
  }
  async function checkStockSku(code:string){
    if(stockSkuChecking)return
    setStockSkuChecking(code)
    const result=await apiPost<{found:boolean;sku:string;descricao:string;conflito:string|null}>(
      '/api/estoque/validar-sku',{codigo:code})
    const valid=!result.error&&result.data?.found===true
    setStockSkuChecks(old=>({...old,[code]:{
      valid,descricao:valid?String(result.data?.descricao||''):'',
      message:valid?'Identificação confirmada no Omie.':result.error?.message||'Código não localizado no Omie.'
    }}))
    setStockSkuChecking(null)
  }

  async function correctStockSample(position:StockSkuPosition) {
    if(!canCorrectStockSku||stockSkuFixing)return
    const sku=(stockSkuSelection[position.id]||position.sku).trim()
    if(!sku){setError('Selecione o SKU correto para esta posição.');return}
    const onlyDescription=sku.toUpperCase()===position.sku.toUpperCase()
    const action=onlyDescription?'sincronizar a descrição oficial':'alterar o código para '+sku
    if(!window.confirm('Posição '+position.codigo+': '+action+'? A alteração será feita apenas nesta posição. Saldo, movimentos anteriores e laudos serão preservados.'))return
    setStockSkuFixing(position.id);setError('')
    try{
      const response=await apiPost<{ok:boolean;alterado:boolean;sku:string;descricao:string;auditoriaPendente?:boolean}>('/api/estoque/corrigir-sku',{
        amostraId:position.id,skuAnterior:position.sku,skuCorreto:sku,
        motivo:'Identificação corrigida após conferência com Omie'
      })
      if(response.error||!response.data?.ok){setError(response.error?.message||'Não foi possível corrigir o SKU.');return}
      setMessage(response.data.auditoriaPendente?'Identificação corrigida; regularize a auditoria com o gestor.':
        response.data.alterado?'Identificação corrigida conforme Omie.':'A identificação já está correta no Omie.')
      setStockSkuSelection(old=>{const updated={...old};delete updated[position.id];return updated})
      await Promise.all([loadStock(),refreshStockSkuConflicts()])
    }finally{setStockSkuFixing(null)}
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
      sku:sampleForm.sku.trim(),
      descricao:sampleForm.descricao.trim() || null,
      lote:sampleForm.lote.trim() || null,
      quantidade:Number(sampleForm.quantidade),
      endereco:sampleForm.endereco.trim(),
      unidade:sampleForm.unidade,
    })
    if (created.error || !created.data?.id) return setError(created.error?.message ?? 'Falha ao criar amostra.')

    setMessage(`${created.data.codigo} criada e endereçada.`)
    setSampleForm({ groupId: '', sku: '', descricao: '', lote: '', quantidade: '', endereco: '', unidade: 'conjunto' })
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

  function askCollectionName():string|null {
    const skus=new Set((detail?.items??[]).map((link:any)=>
      String(link?.processo_itens?.produtos?.sku||link?.processo_itens?.codigo_cliente||'').trim())
      .filter(Boolean))
    if(skus.size<=1)return ''
    const answer=window.prompt('Nome do conjunto para o laudo Word:')
    if(answer===null)return null
    const name=answer.trim()
    if(!name){setPopupMessage('Informe o nome do conjunto para gerar o laudo.');return null}
    if(name.length>100){setPopupMessage('O nome do conjunto deve ter até 100 caracteres.');return null}
    return name
  }

  async function downloadInspectionWord() {
    if(!detail||!selectedInspectionId||wordDownloading)return
    setError('')
    setWordStatus(null)
    if(!detail.it_versao_id){
      return setError('Esta inspeção não possui IT vinculada. Vincule uma IT para gerar o Word oficial.')
    }
    const parentId=detail.grupos_inspecao?.processo_id as string|undefined
    const consolidated=Boolean(parentId&&detail.grupos_inspecao?.subprocesso_codigo)
    // Entradas A/B/C legadas são componentes do MESMO FST e geram um laudo único.
    const collectionName=consolidated?'':askCollectionName()
    if(collectionName===null)return
    setWordDownloading(true)
    try{
      const session=await supabase.auth.getSession()
      const token=session.data.session?.access_token
      if(!token){setError('Sua sessão expirou. Entre novamente no SGQ.');return}
      const suffix=collectionName?'?nomeConjunto='+encodeURIComponent(collectionName):''
      const url=consolidated
        ?`${apiUrl}/api/processos/${encodeURIComponent(parentId!)}/laudo`
        :`${apiUrl}/api/inspecoes/${selectedInspectionId}/laudo${suffix}`
      const response=await fetch(url,{
        method:'POST',headers:{Authorization:`Bearer ${token}`},
      })
      if(!response.ok){
        let reason='Não foi possível gerar o Word pelo modelo oficial da IT.'
        try{
          const body=await response.json()
          reason=typeof body?.detail==='string'?body.detail:
            body?.error?.message||body?.message||reason
        }catch{}
        setError(reason)
        // Apenas uma falha real ao gerar documento consulta pendências técnicas.
        if(response.status===409)void refreshWordStatus()
        return
      }
      const blob=await response.blob()
      if(!blob.size){setError('O documento Word retornou vazio.');return}
      const disposition=response.headers.get('content-disposition')||''
      const encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i)
      const simple=disposition.match(/filename="?([^";]+)"?/i)
      const candidate=encoded?.[1]||simple?.[1]||`${detail.numero}.docx`
      let filename=candidate
      try{filename=decodeURIComponent(candidate)}catch{}
      const href=URL.createObjectURL(blob)
      const link=document.createElement('a')
      link.href=href;link.download=filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(()=>URL.revokeObjectURL(href),15000)
      setMessage('Word gerado para download.')
    }catch{
      setError('O serviço de geração do Word não respondeu. Tente novamente.')
    }finally{
      setWordDownloading(false)
    }
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
    <main className="app-shell sgq-operational-shell" data-sgq-screen={tab}>
      <aside className="sgq-side-nav">
        <div className="sgq-side-brand"><span className="sgq-brand-symbol"><Boxes size={31}/></span><div><b>SGQ</b><small>Qualidade · Operações</small></div></div>
        <div className="sgq-side-caption">OPERAÇÃO</div>
        <button className={tab==='painel'?'selected':''} onClick={()=>setTab('painel')}><LayoutDashboard size={19}/> Painel</button>
        <button className={tab==='inspecoes'||tab==='execucao'?'selected':''} onClick={()=>{setFocusedProcessId(null);setTab('inspecoes')}}><ClipboardCheck size={19}/> Processos</button>
        <button className={tab==='quadro'?'selected':''} onClick={()=>setTab('quadro')}><CheckCircle2 size={19}/> Inspeções</button>
        <button className={tab==='estoque'?'selected':''} onClick={()=>setTab('estoque')}><Boxes size={19}/> Estoque</button>
        <button onClick={()=>setTab('fotos-mobile')}><Camera size={19}/> Modo Fotos</button>
        <button className={tab==='auditorias'?'selected':''} onClick={()=>{setTab('auditorias');setError('')}}><Warehouse size={19}/> Inspeções Armazém</button>
        <div className="sgq-side-caption">QUALIDADE</div>
        <button className={tab==='its'?'selected':''} onClick={()=>setTab('its')}><FileText size={19}/> Instruções técnicas</button>
        <button className={tab==='equipamentos'?'selected':''} onClick={()=>{setTab('equipamentos');void refreshEquipments()}}><Wrench size={19}/> Equipamentos</button>
        <div className="sgq-side-footer"><small>{profile.nome || 'Usuário'}</small><button type="button" onClick={()=>void supabase.auth.signOut()}><LogOut size={14}/> Sair</button></div>
      </aside>
      <header className="topbar" aria-label="Cabeçalho do SGQ">
        <div className="sgq-topbar-context">
          <button type="button" className="sgq-topbar-home" onClick={()=>setTab('painel')} aria-label="Ir ao Painel"><LayoutDashboard size={19}/></button>
          <span>SGQ</span>
          <ChevronRight size={15} className="sgq-topbar-chevron" aria-hidden="true"/>
          <strong>{({
            painel:'Painel',insights:'Insights',inspecoes:'Processos',quadro:'Inspeções',nova:'Nova inspeção',
            execucao:'Execução da inspeção',estoque:'Estoque',
            auditorias:'Inspeções Armazém',its:'Instruções técnicas',equipamentos:'Equipamentos',
          } as Record<typeof tab,string>)[tab]}</strong>
        </div>
        <label className="sgq-topbar-search" htmlFor="sgq-global-search">
          <Search size={20} aria-hidden="true"/>
          <input id="sgq-global-search" type="search" value={dashboardSearch}
            placeholder="Buscar inspeções, processos, clientes..."
            onChange={e=>{setDashboardSearch(e.target.value);if(tab!=='painel')setTab('painel')}}
            aria-label="Buscar inspeções, processos, clientes e NFs"/>
        </label>
        <div className="userbox sgq-topbar-user-actions">
          <button type="button" className="sgq-topbar-bell" onClick={()=>{setFocusedProcessId(null);setTab('inspecoes')}}
            aria-label={omieUnread?'Ver '+omieUnread+' novos pedidos Omie':'Abrir pedidos de venda Omie'} title="Pedidos de venda recebidos do Omie">
            <Bell size={22}/>{omieUnread>0&&<span className="sgq-topbar-notification-count">{omieUnread}</span>}
          </button>
          <span className="sgq-topbar-divider" aria-hidden="true"/>
          <span className="sgq-user-avatar" aria-hidden="true">{(profile.nome||'SGQ').trim().split(/\s+/).slice(0,2).map(word=>word[0]?.toUpperCase()).join('')}</span>
          <span className="sgq-user-identity"><strong>{profile.nome || 'Usuário'}</strong><small>{profile.perfil}</small></span>
          <button type="button" className="sgq-offline-indicator" data-pending={offlinePending>0||offlineConflicts>0} title={offlineError||'Sincronização do dispositivo'}
            onClick={()=>{if(isOnline&&userId)void syncOfflineNow(userId);else setPopupMessage(offlineConflicts?'Existem registros com conflito. Seus dados permanecem salvos neste dispositivo.':'Os registros pendentes estão salvos neste dispositivo.')}}>
            {isOnline?<CloudUpload size={15}/>:<CloudOff size={15}/>}
            <span>{offlineConflicts?'Revisar '+offlineConflicts:offlinePending?offlinePending+' pendente(s)':!isOnline?'Salvo offline':'Sincronizado'}</span>
          </button>
          <button type="button" className="sgq-topbar-signout" aria-label="Sair do SGQ" title="Sair" onClick={()=>void supabase.auth.signOut()}><LogOut size={18}/></button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {wordDownloading&&<div className="sgq-dialog-backdrop sgq-word-loading" role="dialog"
        aria-modal="true" aria-label="Gerando Word" aria-live="polite">
        <div className="sgq-dialog sgq-word-loading-content">
          <div className="sgq-word-spinner" aria-hidden="true"/>
          <h2>Gerando laudo…</h2>
          <p>Preparando arquivo para download</p>
        </div>
      </div>}
      {popupMessage && <div className="sgq-dialog-backdrop" role="presentation" onClick={()=>setPopupMessage('')}>
        <div className="sgq-dialog" role="alertdialog" aria-modal="true" aria-label="Atenção" onClick={e=>e.stopPropagation()}>
          <div className="sgq-dialog-symbol"><ShieldCheck size={24}/></div><h2>Verifique as informações</h2>
          <p>{popupMessage}</p><button className="primary" type="button" autoFocus onClick={()=>setPopupMessage('')}>Entendi</button>
        </div>
      </div>}
      {message && <div className="alert success">{message}</div>}
      {offlineError && <div className="alert error" role="alert">{offlineError}</div>}

      {tab==='insights' && <Suspense fallback={<div className="center-screen">Carregando Insights…</div>}>
        <InsightsPage onBack={()=>setTab('painel')} onOpenInspection={id=>void openInspection(id)}/>
      </Suspense>}

      {tab==='auditorias' && (
        <section className="workspace audit-workspace" aria-label="Inspeções Armazém">
          <Suspense fallback={<div className="audit-center">Carregando inspeções do armazém…</div>}>
            <AuditoriasPage userId={userId||''} profileName={profile.nome} canDelete={!!canDelete} canManageTemplates={!!canManageIts}/>
          </Suspense>
        </section>
      )}

      {tab==='painel' && (
        <SgqDashboard
          inspections={inspections}
          processCount={processes.length}
          stockCount={samples.length}
          processes={processes}
          stockPositions={samples.map(item=>({id:item.id,sku:item.sku||null,descricao:item.descricao||null,saldo:Number(item.saldo),endereco:item.endereco||null}))}
          searchQuery={dashboardSearch}
          onSearchChange={setDashboardSearch}
          onNewInspection={()=>{resetNewInspection();setTab('nova')}}
          onInsights={()=>setTab('insights')}
          onProcesses={()=>{setFocusedProcessId(null);setTab('inspecoes')}}
          onStock={()=>setTab('estoque')}
          onAllInspections={()=>setTab('quadro')}
        >
          <InspectionsKanban
            mode="panel"
            externalQuery={dashboardSearch}
            inspections={inspections}
            processes={processes}
            itemLinks={processItemLinks}
            canDelete={!!canDelete}
            canMove={!!canWrite}
            movingInspectionId={kanbanMovingId}
            onMove={(id,target)=>void moveInspectionOnBoard(id,target)}
            deletingProcessId={deletingProcessId}
            formatFst={formatFst}
            onViewAll={()=>setTab('quadro')}
            onOpen={id=>void openInspection(id)}
            onCreate={()=>{resetNewInspection();setTab('nova')}}
            onReuseProcess={id=>{const p=processes.find(x=>x.id===id);if(p)reuseProcess(p)}}
            onEditProcess={id=>{const p=processes.find(x=>x.id===id);if(p)editProcessFull(p)}}
            onDeleteProcess={id=>{const p=processes.find(x=>x.id===id);if(p)void deleteProcess(p)}}
            onDeleteInspection={id=>{const i=inspections.find(x=>x.id===id);if(i)void deleteInspection(i)}}
          />
        </SgqDashboard>
      )}

      {tab==='inspecoes' && <>
        <section className="workspace sgq-screen-processos" aria-label="Pedidos de venda recebidos do Omie">
          <div className="panel section-card" style={{marginBottom:16}}>
            <div className="section-title">
              <div><h2>Pedidos de venda · Omie</h2>
                <span className="section-note">Pré-cadastros recebidos automaticamente. Confirme chegada e quantidades físicas antes de iniciar.</span>
              </div>
              <div className="row-actions">
                {omieUnread>0 && <span className="pill">{omieUnread} novo(s)</span>}
                <button type="button" className="secondary small" disabled={omieInboxLoading}
                  onClick={()=>{setOmieInboxLoading(true);void loadOmieInbox().finally(()=>setOmieInboxLoading(false))}}>
                  <RefreshCw size={15}/>{omieInboxLoading?'Consultando…':'Atualizar PVs'}
                </button>
              </div>
            </div>
            {omieInboxError && <p className="field-status bad">{omieInboxError}</p>}
            {!omieInbox.length && <p className="section-note">Nenhum PV sincronizado. Busque pelo FST para consultar diretamente o Omie.</p>}
            {omieInbox.length>0 && <div className="checklist compact-checklist">
              {omieInbox.slice(0,20).map(order=><div className="check-row" key={order.id}>
                <div className="check-copy">
                  <b>PV {order.numero_pedido} · {order.cliente||'Cliente aguardando consulta'}</b>
                  <span>{order.fst_referencia||'FST não identificado — vinculação necessária'} · {order.numero_itens} SKU(s)</span>
                  <small>{order.status==='cancelado'?'Cancelado no Omie':order.status==='alterado'?'Pedido atualizado':'Pedido recebido'} · {new Date(order.recebido_em).toLocaleString('pt-BR')}</small>
                </div>
                <div className="row-actions">
                  {!omieInboxSeen.has(order.id) && <span className="pill">Novo</span>}
                  <button type="button" className="secondary small" disabled={!canWrite || order.status==='cancelado'}
                    onClick={()=>void reviewOmieInboxOrder(order)}>Revisar e preparar</button>
                </div>
              </div>)}
            </div>}
          </div>
        </section>
        <InspectionsKanban
        focusProcessId={focusedProcessId}
        inspections={inspections}
        processes={processes}
        itemLinks={processItemLinks}
        canDelete={!!canDelete}
        deletingProcessId={deletingProcessId}
        canMove={!!canWrite}
        movingInspectionId={kanbanMovingId}
        onMove={(id,target)=>void moveInspectionOnBoard(id,target)}
        formatFst={formatFst}
        onOpen={id=>void openInspection(id)}
        onCreate={()=>{resetNewInspection();setTab('nova')}}
        onReuseProcess={id=>{const process=processes.find(p=>p.id===id);if(process)reuseProcess(process)}}
        onEditProcess={id=>{const process=processes.find(p=>p.id===id);if(process)editProcessFull(process)}}
        onDeleteProcess={id=>{const process=processes.find(p=>p.id===id);if(process)void deleteProcess(process)}}
        onDeleteInspection={id=>{const item=inspections.find(i=>i.id===id);if(item)void deleteInspection(item)}}
      /> </>}

      {tab==='quadro' && <InspectionsKanban key="quadro" initialView="kanban"
        inspections={inspections}
        processes={processes}
        itemLinks={processItemLinks}
        canDelete={!!canDelete}
        deletingProcessId={deletingProcessId}
        canMove={!!canWrite}
        movingInspectionId={kanbanMovingId}
        onMove={(id,target)=>void moveInspectionOnBoard(id,target)}
        formatFst={formatFst}
        onOpen={id=>void openInspection(id)}
        onCreate={()=>{resetNewInspection();setTab('nova')}}
        onReuseProcess={id=>{const process=processes.find(p=>p.id===id);if(process)reuseProcess(process)}}
        onEditProcess={id=>{const process=processes.find(p=>p.id===id);if(process)editProcessFull(process)}}
        onDeleteProcess={id=>{const process=processes.find(p=>p.id===id);if(process)void deleteProcess(process)}}
        onDeleteInspection={id=>{const item=inspections.find(i=>i.id===id);if(item)void deleteInspection(item)}}
      />}

      {tab==='nova' && (
        <section className="workspace sgq-workspace-form sgq-screen-nova">
          <div className="page-title">
            <div><span className="eyebrow">OPERAÇÃO · INSPEÇÕES</span><h1>{editingInspectionId?'Editar inspeção':editingProcessId?'Editar processo':'Nova inspeção'}</h1>
              <p className="page-subtitle">Identifique o FST, confirme o recebimento e selecione a instrução técnica para iniciar a inspeção.</p>
            </div>
            <div className="row-actions">
              
              {processes[0] && <button className="secondary" type="button" onClick={()=>reuseProcess(processes[0])}><Copy size={16}/> Reutilizar últimos dados gerais</button>}
              {inspection.processoId && <button className="secondary" type="button" onClick={resetNewInspection}>Novo processo</button>}
              {!inspection.processoId && !editingInspectionId && !editingProcessId && <button className="secondary" type="button"
                disabled={inspectionBusy||!parentFstCode(inspection.codigo)||!inspection.itVersionId}
                onClick={()=>void registerParentProcess()}>Cadastrar FST</button>}
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
                {!editingInspectionId && !editingProcessId && processes.length>0 && <label className="span-2">Usar processo existente
                  <select value={inspection.processoId} onChange={e=>{
                    const p=processes.find(p=>p.id===e.target.value)
                    if(p)reuseProcess(p);else resetNewInspection()
                  }}>
                    <option value="">Novo Processo</option>
                    {processes.map(p=><option key={p.id} value={p.id}>{formatFst(p.codigo)} · {p.cliente||'Cliente não informado'}</option>)}
                  </select>
                </label>}
                <div className="sgq-fst-field">
                  <label htmlFor="sgq-fst-input">Processo</label>
                  <div className="sgq-fst-controls">
                    <div className="fst-input"><span>FST</span><input id="sgq-fst-input" value={inspection.codigo} onChange={(e)=>{const inputValue=e.target.value;fstLookupRequest.current++;fstNfeRequest.current++;fstLookupInFlight.current=null;setProcessLookupBusy(false);setProcessLookupMessage('');setOmieSkuImport(null);setOmieSkuReview(null);setOmieSkuReviewError('');setOmieOrderPickerOpen(false);setOmieOrders(null);setOmieSelectedOrder('');setSkuRows(rows=>{const retained=rows.filter(row=>!row.omieSourceFst||row.omieSourceFst===fstCode(inputValue));return retained.length?retained:[emptySku()]});setInspection(current=>{const prev=autoNfeRef.current;const clear=prev&&fstCode(inputValue)!==prev.fst&&current.notaFiscal===prev.numero;if(clear)autoNfeRef.current=null;return {...current,codigo:inputValue,processoId:parentFstCode(inputValue)===parentFstCode(current.codigo)?current.processoId:'',
                  itVersionId:parentFstCode(inputValue)===parentFstCode(current.codigo)?current.itVersionId:'',
                  notaFiscal:clear?'':current.notaFiscal}})}} onBlur={e=>void lookupFstClient(e.target.value)} placeholder="Número FST"/></div>
                    <button type="button" className="secondary sgq-fst-retry" disabled={processLookupBusy||!fstCode(inspection.codigo)}
                      onMouseDown={e=>e.preventDefault()} onClick={()=>void lookupFstClient(inspection.codigo)} title="Buscar cliente e SKUs no Omie">
                      <Search size={16}/> Consultar
                    </button>
                  </div>
                  {processLookupBusy && <small className="field-hint" role="status">Consultando cliente e SKUs no Omie…</small>}
                  {!processLookupBusy && processLookupMessage && <small className="field-hint" role="status">{processLookupMessage}</small>}


                </div>
                <label>Entrada
                  <select value={inspection.subprocessoCodigo} disabled={!!editingProcessId||!!editingInspectionId}
                    onChange={e=>setInspection({...inspection,subprocessoCodigo:e.target.value,notaFiscal:''})}>
                    {Array.from({length:26},(_,i)=>String.fromCharCode(65+i)).map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                {inheritedReference&&<div className="sgq-subprocess-inheritance span-2" role="note">
                  <strong>{inheritedReference.historical?'Referência histórica do FST':'Herdado de referência · Subprocesso '+inheritedReference.letter}</strong>
                  <span>{inheritedReference.historical?
                    'Valores antigos do FST; não são dados confirmados deste subprocesso.':
                    'Valores informativos da primeira inspeção. Nada é copiado ou salvo automaticamente.'}</span>
                  <small>NF {inheritedReference.invoice||'—'} · Chegada {inheritedReference.arrival||'—'} ·
                    Origem {inheritedReference.origin||'—'} · Transporte {inheritedReference.transport||'—'} ·
                    Quantidade {inheritedReference.quantity||'—'} · Caixas {inheritedReference.boxes||'—'}</small>
                  <small>NF, datas, quantidade e caixas pertencem exclusivamente a este subprocesso. Alterar aqui não modifica os demais.</small>
                  {!inheritedReference.historical&&
                    (inheritedReference.origin||inheritedReference.transport||inheritedReference.arrival)&&
                    <button className="secondary small" type="button"
                      onClick={()=>setInspection(current=>({...current,
                        origem:current.origem||inheritedReference.origin,
                        transporte:current.transporte||inheritedReference.transport,
                        chegadaCd:current.chegadaCd||inheritedReference.arrival
                      }))}>
                      Usar referência de origem, transporte e chegada
                    </button>}
                </div>}
                <label>Cliente<input value={inspection.cliente} onChange={(e)=>setInspection({...inspection,cliente:e.target.value})}/></label>
                <label>NF do subprocesso {inspection.subprocessoCodigo}<input value={inspection.notaFiscal} onChange={(e)=>{autoNfeRef.current=null;setInspection({...inspection,notaFiscal:e.target.value})}}/></label>
                <label>Chegada no CD<input type="date" value={inspection.chegadaCd} onChange={(e)=>setInspection({...inspection,chegadaCd:e.target.value})}/></label>
                <label>Origem<input value={inspection.origem} onChange={(e)=>setInspection({...inspection,origem:e.target.value})} placeholder="China"/></label>
                <div className="field-label"><span>Transporte</span><div className="transport-checks">
                  <label className="check-option"><input type="checkbox" checked={inspection.transporte.includes('Aéreo')} onChange={()=>setInspection({...inspection,transporte:toggleTransport(inspection.transporte,'Aéreo')})}/><span>Aéreo</span></label>
                  <label className="check-option"><input type="checkbox" checked={inspection.transporte.includes('Marítimo')} onChange={()=>setInspection({...inspection,transporte:toggleTransport(inspection.transporte,'Marítimo')})}/><span>Marítimo</span></label>
                </div></div>
                <label>Data da inspeção<input type="date" min={inspection.chegadaCd||undefined} value={inspection.dataInspecao} onChange={(e)=>setInspection({...inspection,dataInspecao:e.target.value})}/></label>

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
              <label>IT desta entrada
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

            {new Set(skuRows.filter(skuRowHasData).map(row=>row.sku.trim().toUpperCase()).filter(Boolean)).size>1&&<section className="panel section-card" aria-label="Agrupamento de SKUs">
              <label className="check-option"><input type="checkbox" checked={isComponentSet} onChange={e=>setIsComponentSet(e.target.checked)}/>
                <span>Os SKUs desta entrada formam um conjunto de componentes</span></label>
              <small className="field-hint">Produtos independentes devem ser cadastrados em uma Nova Entrada do mesmo FST, com inspeção e laudo próprios.</small>
            </section>}
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
        <section className="workspace execution sgq-screen-execucao">
          <div className="page-title">
            <div>
              <span className="eyebrow">INSPEÇÃO · {formatFst(detail.grupos_inspecao?.processos?.codigo)}</span>
              <h1>{detail.grupos_inspecao?.processos?.cliente || detail.grupos_inspecao?.nome || 'Inspeção'}</h1>
              <p className="page-subtitle">Registre cada etapa, confira as evidências e emita o laudo ao concluir.</p>
            </div>
            <div className="row-actions">
              <span className="pill">{statusLabel(detail.status)}</span>
              {canWrite && <button className="secondary" type="button" onClick={startEditingInspectionData}><Edit3 size={16}/> Editar dados</button>}
              {canWrite && detail.status==='concluida' && <button className={allowDimensionalRectification?'secondary':'primary'} type="button" onClick={()=>{
                if(allowDimensionalRectification){setAllowDimensionalRectification(false);return}
                if(!navigator.onLine){setError('Conecte-se para editar com auditoria.');return}
                setWordStatus(null)
                setAllowDimensionalRectification(true)
              }}><Edit3 size={16}/>{allowDimensionalRectification?'Encerrar edição':'Editar inspeção concluída'}</button>}

              {detail.status==='concluida' && <button className="secondary" type="button" disabled={wordDownloading} title="Gerar Word atualizado apenas sob demanda, sem salvá-lo no banco" onClick={()=>void downloadInspectionWord()}><FileDown size={16}/>{wordDownloading?'Gerando laudo…':'Gerar Laudo'}</button>}
              {canDelete && <button className="danger icon-only" title="Excluir inspeção" onClick={()=>deleteInspection({id:detail.id,numero:detail.numero})}><Trash2 size={16}/></button>}
            </div>
          </div>

          {detail.status==='concluida' && wordStatus && !wordStatus.ready && <div id="sgq-word-pendencias" className="alert" role="status">
            <strong>{wordStatus?.error?'Falha ao consultar o laudo':wordStatus
              ?'O laudo ainda possui '+wordStatus.pending.length+' pendência(s)':'Não foi possível gerar o Word.'}</strong>
            {wordStatus?.error && <p>{wordStatus.error} A validação falhou; isso não significa que os dados da inspeção estejam incompletos.</p>}
            {!!wordStatus?.pending.length && <ul>
              {wordStatus.pending.map((reason,index)=><li key={index}>{reason}</li>)}
            </ul>}
            <button className="secondary small" type="button" disabled={wordCheckBusy} onClick={()=>void refreshWordStatus()}>
              <RefreshCw size={14}/>{wordCheckBusy?'Verificando…':'Verificar novamente'}
            </button>
          </div>}
          {detail.status==='concluida' && allowDimensionalRectification && <div className="alert">Modo de retificação: as alterações são auditadas e entram no próximo laudo gerado.</div>}
          <nav id="inspection-stage-nav" className="inspection-stage-tabs" role="tablist" aria-label="Etapas da inspeção">
            {([
              ['dados','Dados',true],['amostragem','Amostragem',samplingDone],
              ['verificacoes','Verificações',checklistDone],['dimensionais','Dimensionais',dimsDone],
              ['testes','Testes',testsDone],['fotos','Fotos',Boolean(detail.photos?.length)],
              ['resultado','Resultado',detail.status==='concluida'],
              ['retencao','Retenção (opcional)',detail.retencao_decisao!=null],
            ] as Array<[typeof activeStage,string,boolean]>).map(([key,label,done])=>(
              <button key={key} type="button" role="tab" aria-selected={activeStage===key}
                className={'inspection-stage-tab'+(activeStage===key?' active':'')+(done?' done':'')}
                onClick={()=>selectInspectionStage(key)}>
                <span className="inspection-stage-dot">{done?'✓':'·'}</span>{label}
              </button>
            ))}
          </nav>
          {detail.status==='aberta' && activeStage!=='dados' && activeStage!=='fotos' && (
            <div className="inspection-not-started-hint">Esta inspeção ainda não foi iniciada. Revise os dados, selecione uma IT e clique em <strong>Iniciar inspeção</strong> antes de registrar verificações.</div>
          )}

          <section id="sec-dados" className={'panel section-card internal-note-panel inspection-stage'+(activeStage==='dados'?'':' inspection-stage-hidden')}>
            <div className="section-title"><div><h2>Dados iniciais da inspeção</h2></div>
              {canWrite && <button className="secondary small" type="button" onClick={startEditingInspectionData}><Edit3 size={16}/> Editar dados e IT</button>}
            </div>
            <div className="inspection-data-summary">
              <div><small>Processo / subprocesso</small><strong>{formatFst(detail.grupos_inspecao?.processos?.codigo)}{detail.grupos_inspecao?.subprocesso_codigo?'-'+detail.grupos_inspecao.subprocesso_codigo:''}</strong></div>
              <div><small>Cliente</small><strong>{detail.grupos_inspecao?.processos?.cliente || '—'}</strong></div>
              <div><small>Nota fiscal</small><strong>{detail.grupos_inspecao?.nota_fiscal || '—'}</strong></div>
              <div><small>Origem / transporte</small><strong>{detail.grupos_inspecao?.origem || '—'} · {detail.grupos_inspecao?.transporte || '—'}</strong></div>
              <div><small>Chegada no CD</small><strong>{formatDateBR(detail.grupos_inspecao?.chegada_cd)}</strong></div>
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
                  disabled={!canWrite || (detail.status==='concluida' && !allowDimensionalRectification)}
                />
              </div>
              <div><small>Ac</small><strong>{detail.limite_aceitacao ?? '—'}</strong></div>
              <div><small>Re</small><strong>{detail.limite_rejeicao ?? '—'}</strong></div>
              <div><small>Caixas recebidas</small><strong>{inspectionBoxTotal(detail,'received')?.toLocaleString('pt-BR') ?? '—'}</strong></div>
              <div><small>Caixas a avaliar</small><strong>{inspectionBoxTotal(detail,'evaluate')?.toLocaleString('pt-BR') ?? '—'}</strong></div>
            </div>
            {!!detail.limite_rejeicao && detail.total_nao_conforme>=detail.limite_rejeicao && <div className="alert error">
              Limite de rejeição atingido.
              {detail.nivel_inspecao==='I' && detail.status==='em_andamento' && <button type="button" className="secondary small"
                onClick={()=>{levelOfferPrompted.current.delete(selectedInspectionId+':I:'+detail.limite_rejeicao);
                  maybeOfferLevelII(Number(detail.total_nao_conforme),Number(detail.limite_rejeicao),'I')}}>Ampliar para Nível II</button>}
            </div>}
          </section>

          <section id="sec-verificacoes" className={'panel section-card inspection-stage'+(activeStage==='verificacoes' && detail.status!=='aberta'?'':' inspection-stage-hidden')}>
            <div className="section-title"><div><h2>Verificações</h2></div></div>
            <div className="checklist compact-checklist">
              {(detail.checklist ?? []).map((item:any)=>{
                const r=detail.checklistResults?.find((x:any)=>x.checklist_id===item.id)
                const automatic=item.classificacao_sugerida
                const dimensionalScope=isDedicatedDimensionalCheck(item)
                const scopeQty=dimensionalScope?10:Number(detail.tamanho_amostra ?? 0)
                const linkedDimensionalNc=dimensionalNcForChecklist(item)
                const hasDimensionalNc=linkedDimensionalNc.count>0
                return (
                  <div className="check-row" key={item.id}>
                    <div className="check-copy">
                      <b>{item.ordem}. {item.requisito}</b>
                      <span>{item.instrucao}</span>
                      {automatic && <small>NC: {automatic==='critico'?'Crítico':automatic==='grave'?'Grave':'Tolerável'} · definido pela IT</small>}
                      {hasDimensionalNc && <small className="field-status bad" role="status">
                        NC dimensional: {linkedDimensionalNc.count} medição(ões) fora da tolerância · {linkedDimensionalNc.skus.join(', ')}.
                        Confirme as NC únicas na amostragem para não duplicar unidades.
                      </small>}
                    </div>
                    <div className="check-actions-stack">
                      <div className="tri-buttons quick">
                        <button type="button" className={r?.resultado==='conforme'&&!hasDimensionalNc?'selected ok':''} disabled={!canWrite || hasDimensionalNc || (detail.status==='concluida' && !allowDimensionalRectification)} onClick={()=>saveChecklist(item.id,'conforme')}>C</button>
                        <button type="button" className={r?.resultado==='nao_conforme'||hasDimensionalNc?'selected bad':''} disabled={!canWrite || (detail.status==='concluida' && !allowDimensionalRectification)} onClick={()=>saveChecklist(item.id,'nao_conforme',Math.max(Number(r?.quantidade_nc ?? 0),linkedDimensionalNc.count,1))}>NC</button>
                        <button type="button" className={r?.resultado==='nao_aplicavel'&&!hasDimensionalNc?'selected':''} disabled={!canWrite || hasDimensionalNc || (detail.status==='concluida' && !allowDimensionalRectification)} onClick={()=>saveChecklist(item.id,'nao_aplicavel')}>NA</button>
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
                            onBlur={(e)=>void saveChecklist(item.id,'nao_conforme',Number(e.target.value))} disabled={!canWrite || (detail.status==='concluida' && !allowDimensionalRectification)}
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
              <div><h2>Análises dimensionais</h2><span className="section-note">10 medições por parâmetro. Sem desvio aprovado, o sistema calcula a média e aprova por critério interno.</span></div>
              {detail.dimensionais_finalizados && <span className="pill">Concluído</span>}
              {detail.status==='concluida' && canWrite && !allowDimensionalRectification &&
                <small className="section-note">Use “Editar inspeção concluída” para corrigir critérios e medições.</small>}
            </div>
            {detail.status==='concluida' && allowDimensionalRectification &&
              <p className="section-note">Critérios e valores medidos podem ser corrigidos com auditoria. Sem tolerância aprovada, a avaliação usa a média das 10 medições.</p>}
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
                            <input type="checkbox" checked={!!cfg.nao_aplicavel} disabled={!canWrite || (detail.status==='concluida' && !allowDimensionalRectification)} onChange={(e)=>saveDimConfig(item.id,p,{nao_aplicavel:e.target.checked})}/>
                            <span>Não aplicável</span>
                          </label>
                        </div>

                        {!cfg.nao_aplicavel && <>
                          <div className="dim-config-grid">
                            {usesMeasureReference(p) && <label>Referência da medida
                              <select value={cfg.tipo_referencia ?? p.tipo_referencia ?? ''} onChange={(e)=>saveDimConfig(item.id,p,{tipo_referencia:e.target.value})} disabled={!canWrite || (detail.status==='concluida' && !allowDimensionalRectification)}>
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
                                <input defaultValue={cfg.referencia_outro ?? ''} placeholder="Ex.: gabarito, norma ou instrumento de referência" onBlur={(e)=>saveDimConfig(item.id,p,{referencia_outro:e.target.value})} disabled={!canWrite || (detail.status==='concluida' && !allowDimensionalRectification)}/>
                              </label>
                            )}
                            <label>Valor especificado
                              <input type="number" step="any" defaultValue={cfg.valor_nominal ?? ''} onBlur={(e)=>saveDimConfig(item.id,p,{valor_nominal:e.target.value})} disabled={!canWrite || (detail.status==='concluida' && !allowDimensionalRectification)}/>
                            </label>
                            <label>Unidade
                              <select value={cfg.unidade ?? p.unidade ?? ''} onChange={(e)=>saveDimConfig(item.id,p,{unidade:e.target.value})} disabled={!canWrite || (detail.status==='concluida' && !allowDimensionalRectification)}>
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
                              }} disabled={!canWrite || (detail.status==='concluida' && !allowDimensionalRectification)}>
                                <option value="">Selecionar equipamento disponível</option>
                                {cfg.codigo_equipamento && !equipments.some(x=>x.codigo===cfg.codigo_equipamento) && <option value={cfg.codigo_equipamento}>{cfg.equipamento || cfg.codigo_equipamento} (cadastro anterior)</option>}
                                {equipments.filter(e=>equipmentFit(e,p.nome,cfg.unidade||p.unidade)).map(e=><option value={e.codigo} key={e.id}>{e.codigo} · {e.nome}</option>)}
                              </select>
                              {!equipments.some(e=>equipmentFit(e,p.nome,cfg.unidade||p.unidade)) && <small className="field-hint">Não há equipamento calibrado e adequado cadastrado para esta medição.</small>}
                            </label>
                            <label>Código do equipamento<input value={cfg.codigo_equipamento??''} readOnly placeholder="Preenchido ao selecionar"/></label>
                            <label>Desvio ±
                              <input type="number" min="0" step="any" defaultValue={cfg.desvio_mais ?? cfg.desvio_menos ?? ''} onBlur={(e)=>saveDimConfig(item.id,p,{desvio:e.target.value,desvio_menos:e.target.value,desvio_mais:e.target.value})} disabled={!canWrite || (detail.status==='concluida' && !allowDimensionalRectification)}/>
                            </label>
                            <label className="span-2">Especificação / desvio
                              <input value={cfg.especificacao_desvio ?? ((cfg.valor_nominal!=null && (cfg.desvio_mais!=null || cfg.desvio_menos!=null)) ? (String(cfg.valor_nominal)+' '+String(cfg.unidade ?? p.unidade ?? '')+' ± '+String(cfg.desvio_mais ?? cfg.desvio_menos)+' '+String(cfg.unidade ?? p.unidade ?? '')).trim() : '')} readOnly placeholder="Preenchido automaticamente"/>
                            </label>
                          </div>

                          <div className="tolerance-strip">
                            <span>Critério <b>{cfg.nao_aplicavel?'NA':!summary.hasTolerance?'Sem tolerância aprovada':(min ?? '—')+' a '+(max ?? '—')+' '+(cfg.unidade ?? p.unidade ?? '')}</b></span>
                            <span>Medições <b>{summary.total}/10</b></span>
                            <span>Média <b>{summary.average==null?'—':Number(summary.average.toFixed(3)).toLocaleString('pt-BR',{maximumFractionDigits:3})} {cfg.unidade ?? p.unidade ?? ''}</b></span>
                            <span>Conformes <b>{summary.hasTolerance?summary.c:'—'}</b></span>
                            <span>NC <b>{summary.hasTolerance?summary.nc:'—'}</b></span>
                            <span>Decisão <b className={'dim-decision '+summary.decision.toLowerCase()}>{summary.decision}</b></span>
                          </div>

                          <div className="measurement-grid">
                            {Array.from({length:10},(_,k)=>{
                              const seq=k+1
                              const existing=detail.dimResults?.find((x:any)=>x.processo_item_id===item.id && x.parametro_id===p.id && x.sequencia_amostra===seq)
                              return (
                                <label className={existing?.conforme===true?'measure-ok':existing?.conforme===false?'measure-bad':''} key={seq}>
                                  <span>{seq}</span>
                                  <input type="number" step="any" defaultValue={existing?.valor ?? ''} onBlur={(e)=>saveDimension(item.id,p,seq,e.target.value)} disabled={!canWrite || (detail.status==='concluida' && !allowDimensionalRectification)}/>
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
                      <button type="button" className={r?.resultado==='conforme'?'selected ok':''} disabled={!canWrite || (detail.status==='concluida' && !allowDimensionalRectification)} onClick={()=>saveTest(test.id,'conforme')}>C</button>
                      <button type="button" className={r?.resultado==='nao_conforme'?'selected bad':''} disabled={!canWrite || (detail.status==='concluida' && !allowDimensionalRectification)} onClick={()=>saveTest(test.id,'nao_conforme')}>NC</button>
                      <button type="button" className={r?.resultado==='nao_aplicavel'?'selected':''} disabled={!canWrite || (detail.status==='concluida' && !allowDimensionalRectification)} onClick={()=>saveTest(test.id,'nao_aplicavel')}>NA</button>
                    </div>
                    {r?.resultado && <span className="pill">Salvo</span>}
                  </div>
                </article>
              )
            })}
            {!detail.tests?.length && <div className="muted">Sem teste especial estruturado para esta IT.</div>}
            {!!detail.tests?.length && !detail.testes_finalizados && (detail.status!=='concluida'||allowDimensionalRectification) && <div className="actions"><button className="secondary" type="button" onClick={()=>void completeTests()}><CheckCircle2 size={16}/> Concluir testes</button></div>}
          </section>

          <section id="sec-fotos" className={'panel section-card inspection-stage'+(activeStage==='fotos'?'':' inspection-stage-hidden')}>
            <div className="section-title">
              <div><h2>Fotos da inspeção</h2><span className="section-note">Fotografias e identificação visual do produto.</span></div>
              <div className="row-actions"><span className="pill">{detail.photos?.length ?? 0} enviada(s)</span>
                <button className="secondary small" type="button" onClick={()=>void refreshInspectionPhotoEvidence()}><RefreshCw size={15}/> Atualizar fotos</button>
              </div>
            </div>

            {canWrite && detail.status!=='cancelada' && (
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
                  <div className="sgq-saved-photo-caption">
                    {canWrite&&detail.status!=='cancelada'?(
                      <>
                        <label htmlFor={'sgq-caption-'+p.id}>Editar legenda</label>
                        <input id={'sgq-caption-'+p.id} type="text" maxLength={300}
                          aria-label={'Editar legenda da foto '+p.id}
                          value={photoCaptionDrafts[p.id]??p.legenda??''}
                          onChange={e=>{
                            setLastSavedPhotoCaptionId(null)
                            setPhotoCaptionDrafts(previous=>({...previous,[p.id]:e.target.value}))
                          }}
                          placeholder="Informe a legenda desta foto"/>
                        <button type="button" className="primary small sgq-caption-save"
                          disabled={!!savingPhotoCaptionId}
                          onClick={()=>void savePhotoCaption(p.id,p.legenda||'')}>
                          {savingPhotoCaptionId===p.id?'Salvando…':'Salvar legenda'}
                        </button>
                        {lastSavedPhotoCaptionId===p.id&&<small role="status" className="sgq-caption-saved">Legenda salva</small>}
                      </>
                    ):(
                      <span>{p.legenda||'Sem legenda'}</span>
                    )}
                  </div>
                  {canWrite&&detail.status!=='cancelada'&&<div className="sgq-saved-photo-actions">
                    <button type="button" className="secondary small" disabled={photoUploadBusy}
                      onClick={()=>document.getElementById('sgq-photo-replace-'+p.id)?.click()}>
                      <RefreshCw size={14}/> Trocar foto
                    </button>
                    <input id={'sgq-photo-replace-'+p.id} type="file" accept="image/*"
                      style={{display:'none'}} disabled={photoUploadBusy}
                      onChange={e=>{const file=e.target.files?.[0]??null;e.target.value='';void replaceSavedInspectionPhoto(p,file)}}/>
                    <button type="button" className="secondary small" disabled={photoUploadBusy}
                      onClick={()=>void removeSavedInspectionPhoto(p)}><Trash2 size={14}/> Remover</button>
                  </div>}
                  {p.nc_id && <span className="nc-photo-tag">Foto de NC</span>}
                </article>
              ))}
            </div>
          </section>

          {detail.status!=='aberta' && (detail.status!=='concluida'||allowDimensionalRectification) && (
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
              {aiConclusionError&&<p className="sgq-ai-conclusion-error" role="alert">{aiConclusionError}</p>}
              <textarea value={finalObservation} onChange={(e)=>setFinalObservation(e.target.value)} rows={5} placeholder="Registre a conclusão da inspeção."/>
              <div className="result-actions">
                <button className="success-button" disabled={!canWrite} onClick={()=>finishInspection('aprovado')}>{detail.status==='concluida'?'Confirmar aprovação revisada':'Aprovar inspeção'}</button>
                <button className="danger" disabled={!canWrite} onClick={()=>finishInspection('reprovado')}>{detail.status==='concluida'?'Confirmar reprovação revisada':'Reprovar inspeção'}</button>
              </div>
            </section>
          )}

          {detail.status!=='concluida' && activeStage==='retencao' && detail.status!=='aberta' && (
            <section className="panel section-card inspection-stage">
              <h2>Retenção de amostras</h2>
              <p>A retenção é opcional e pode ser registrada depois da conclusão, sem bloquear o laudo.</p>
              <button className="secondary" type="button" onClick={()=>selectInspectionStage('resultado')}>Ir para resultado</button>
            </section>
          )}
          {detail.status==='concluida' && !allowDimensionalRectification && activeStage==='resultado' && (
            <section className="panel section-card inspection-stage">
              <div className="section-title"><h2>Resultado final</h2><span className={'result-badge '+detail.resultado}>{statusLabel(detail.resultado)}</span></div>
              <p>{detail.observacoes || 'Nenhuma observação final registrada.'}</p>
              <button className="secondary" type="button" onClick={()=>selectInspectionStage('retencao')}>Ver retenção opcional</button>
            </section>
          )}
          {detail.status==='concluida' && (
            <section className={'panel section-card retention-panel inspection-stage'+(activeStage==='retencao'?'':' inspection-stage-hidden')}>
              <div className="section-title">
                <h2>Retenção de amostras (opcional)</h2>
                <span className={'result-badge '+detail.resultado}>{statusLabel(detail.resultado)}</span>
              </div>
              <p className="section-note">Esta etapa não é obrigatória. Você pode pular sem justificar e registrar amostras depois, se necessário.</p>
              {(detail.retained ?? []).length>0 && <div className="alert success">Já existem {(detail.retained ?? []).length} amostra(s) deste registro no estoque.</div>}
              {retentionSuggestion.quantidade!=null && <div className="retention-suggestion"><Sparkles size={15}/><span>Sugestão de retenção: <b>{retentionSuggestion.quantidade} un.</b> com base na observação interna.</span></div>}
              {(detail.items ?? []).map((link:any)=>{
                const item=link.processo_itens
                const existing=detail.retained?.find((x:any)=>x.produto_id===item.produto_id)
                const draft=retentionRows[item.id] || {retain:false,qty:'',address:'',photoFile:null,photoPreview:''}
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
              {!Object.values(retentionRows).some((x)=>x.retain) && <label>Motivo para não reter (opcional)<textarea rows={3} value={retentionReason} onChange={(e)=>setRetentionReason(e.target.value)}/></label>}
              <div className="actions">
                <button className={Object.values(retentionRows).some(x=>x.retain)?'primary':'secondary'} type="button" onClick={saveRetention}><Warehouse size={16}/>{Object.values(retentionRows).some(x=>x.retain)?'Enviar amostras ao estoque':'Registrar sem retenção (opcional)'}</button>
                <button className="secondary" type="button" onClick={()=>setTab('inspecoes')}>Pular retenção e voltar aos processos</button>
                <button className="secondary" type="button" disabled={wordDownloading} onClick={()=>void downloadInspectionWord()}><FileDown size={16}/> Gerar Laudo</button>
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
        <section className="workspace sgq-screen-its">
          <div className="page-title"><div><span className="eyebrow">QUALIDADE · CONTROLE DOCUMENTAL</span><h1>{itDemoOpen?'Nova IT':'Biblioteca de ITs'}</h1>
            {!itDemoOpen&&<p className="page-subtitle">Gerencie versões, vigência e critérios das instruções técnicas.</p>}</div>
            <button type="button" className={itDemoOpen?'secondary':'primary'} onClick={()=>setItDemoOpen(x=>!x)}>{itDemoOpen?'Voltar à biblioteca':'Nova IT'}</button>
          </div>
          {itDemoOpen ? (
            <Suspense fallback={<div className="panel section-card">Carregando editor de IT…</div>}>
              <ItEditorDemo officialVersions={itVersions.filter(it=>it.status==='publicada').map(it=>({
                  id:it.id,codigo:it.instrucoes_trabalho?.codigo||'IT',
                  titulo:it.instrucoes_trabalho?.titulo||'',versao:it.versao
                }))}/>
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
        <div className="modal-backdrop">
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
        <section className="workspace stock-page sgq-screen-estoque">
          <div className="page-title stock-page-title">
            <div>
              <span className="eyebrow">CONTROLE DE ESTOQUE</span>
              <h1>Estoque de amostras</h1>
              <p className="page-subtitle">Consulta rápida por produto, processo, cliente, nota fiscal e endereço físico.</p>
            </div>
          </div>

          <div className="sgq-stock-mode">
            <button type="button" className={stockMode==='posicoes'?'primary':'secondary'} onClick={()=>setStockMode('posicoes')}>Posições</button>
            <button type="button" className={stockMode==='inventario'?'primary':'secondary'} onClick={()=>{setStockMode('inventario');setSelectedSample(null)}}>Inventário</button>
          </div>
          {stockMode==='inventario'&&<InventoryPanel samples={samples} canWrite={!!canWrite}
            canApprove={!!profile&&['administrador','gestor'].includes(profile.perfil)}
            onRefreshStock={loadStock}/>}
          {stockMode==='posicoes'&&<>
          {stockSkuConflicts.length>0&&<section className="sgq-stock-sku-conflicts" aria-label="Conferência de identificação de produtos">
            <div className="sgq-sku-conflict-heading">
              <div><b>Identificação de produtos</b><small>Confira o produto físico e selecione o SKU correspondente no Omie.</small></div>
              <span>{stockSkuConflicts.length} identificação(ões) para conferir</span>
            </div>
            {stockSkuConflicts.map(conflict=><article className="sgq-stock-sku-issue" key={conflict.descricao}>
              <header><strong>{conflict.descricao}</strong><small>{conflict.registros} posição(ões) · {conflict.skus.length} SKUs</small></header>
              <div className="sgq-stock-sku-verify" aria-label="Verificar descrições oficiais no Omie">
                {conflict.skus.map(code=><div className="sgq-stock-sku-verify-item" key={code}>
                  <div className="sgq-stock-sku-verify-name"><strong>{code}</strong>
                    {stockSkuChecks[code]&&<span className={stockSkuChecks[code].valid?'is-verified':'is-unverified'}>{stockSkuChecks[code].valid?'Confirmado':'Não validado'}</span>}
                  </div>
                  {stockSkuChecks[code]&&<small role="status">{stockSkuChecks[code].valid?stockSkuChecks[code].descricao:stockSkuChecks[code].message}</small>}
                  <button type="button" className="secondary small" disabled={!!stockSkuChecking} onClick={()=>void checkStockSku(code)}>
                    {stockSkuChecking===code?'Consultando…':'Conferir no Omie'}
                  </button>
                </div>)}
              </div>
              <div className="sgq-stock-sku-positions">
                {(conflict.posicoes||[]).map(position=><div className="sgq-stock-sku-position" key={position.id}>
                  <div className="sgq-stock-sku-position-meta">
                    <b>{position.codigo}</b><span>Atual: {position.sku}</span>
                    <small>{position.processo||'FST não informado'} · {position.endereco||'Sem endereço'} · {Number(position.saldo).toLocaleString('pt-BR')} un.</small>
                  </div>
                  <label>SKU correto
                    <select aria-label={'SKU correto da posição '+position.codigo}
                      value={stockSkuSelection[position.id]??position.sku}
                      onChange={e=>setStockSkuSelection(old=>({...old,[position.id]:e.target.value}))}
                      disabled={!canWrite||!!stockSkuFixing}>
                      {Array.from(new Set([...conflict.skus,position.sku])).map(code=><option key={code} value={code}>{code}{stockSkuChecks[code]?.valid?' · '+stockSkuChecks[code].descricao:''}</option>)}
                    </select>
                  </label>
                  {canCorrectStockSku&&<button type="button" className="primary small" disabled={!!stockSkuFixing}
                    onClick={()=>void correctStockSample(position)}>
                    {stockSkuFixing===position.id?'Corrigindo…':'Aplicar correção'}
                  </button>}
                </div>)}
              </div>
            </article>)}
          </section>}
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
            <div className="modal-backdrop stock-drawer-backdrop">
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
          </>}
        </section>
      )}

      {editingInspectionData && (
        <div className="modal-backdrop">
          <article className="sample-detail inspection-edit-modal" onClick={(e)=>e.stopPropagation()}>
            <button className="close" type="button" onClick={()=>setEditingInspectionData(null)}>×</button>
            <span className="eyebrow">DADOS DA INSPEÇÃO</span>
            <h2>Editar inspeção</h2>
            <p className="muted">Altere os campos necessários e salve.</p>
            <div className="form-grid">
              <label>FST principal<input value={editingInspectionData.codigo ?? ''} readOnly title="Para alterar o código do FST, edite o processo principal."/></label>
              <label>Cliente<input value={editingInspectionData.cliente ?? ''} onChange={(e)=>setEditingInspectionData({...editingInspectionData,cliente:e.target.value})}/></label>
              <label>NF deste subprocesso<input value={editingInspectionData.notaFiscal ?? ''} onChange={(e)=>setEditingInspectionData({...editingInspectionData,notaFiscal:e.target.value})}/></label>
              <label>Chegada no CD<input type="date" value={editingInspectionData.chegadaCd ?? ''} onChange={(e)=>setEditingInspectionData({...editingInspectionData,chegadaCd:e.target.value})}/></label>
              <label>Origem<input value={editingInspectionData.origem ?? ''} onChange={(e)=>setEditingInspectionData({...editingInspectionData,origem:e.target.value})}/></label>
              <div className="field-label"><span>Transporte</span><div className="transport-checks">
                <label className="check-option"><input type="checkbox" checked={editingInspectionData.transporte==='Aéreo'} onChange={()=>setEditingInspectionData({...editingInspectionData,transporte:toggleTransport(editingInspectionData.transporte || '','Aéreo')})}/><span>Aéreo</span></label>
                <label className="check-option"><input type="checkbox" checked={editingInspectionData.transporte==='Marítimo'} onChange={()=>setEditingInspectionData({...editingInspectionData,transporte:toggleTransport(editingInspectionData.transporte || '','Marítimo')})}/><span>Marítimo</span></label>
              </div></div>
              <label>Data da inspeção<input type="date" value={editingInspectionData.dataInspecao ?? ''} onChange={(e)=>setEditingInspectionData({...editingInspectionData,dataInspecao:e.target.value})}/></label>
              <label>Nível de inspeção<select value={editingInspectionData.inspectionLevel ?? 'I'} onChange={(e)=>setEditingInspectionData({...editingInspectionData,inspectionLevel:e.target.value})}><option value="I">Nível I</option><option value="II">Nível II</option><option value="III">Nível III</option><option value="S1">S1</option><option value="S2">S2</option><option value="S3">S3</option><option value="S4">S4</option></select></label>
              <label>IT desta inspeção
                <select value={editingInspectionData.itVersionId ?? ''} onChange={e=>setEditingInspectionData({...editingInspectionData,itVersionId:e.target.value})}>
                  <option value="">Selecionar IT</option>
                  {itVersions.filter(it=>it.status==='publicada'||it.id===editingInspectionData.itVersionId).map(it=>
                    <option key={it.id} value={it.id}>{it.instrucoes_trabalho?.codigo || 'IT'} · v{it.versao}</option>)}
                </select>
                <small>Ao escolher outra IT e salvar, esta inspeção é reiniciada. As fotos e o histórico permanecem.</small>
              </label>
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
                  {row.numeroPedidoPv && <label>Quantidade original PV {row.numeroPedidoPv}<input type="number" readOnly value={row.quantidadePv||''}/></label>}
                  <label>Lote<input value={row.lote} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?{...x,lote:e.target.value}:x)})}/></label>
                  <label>Material<input value={row.material||''} onChange={e=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?{...x,material:e.target.value}:x)})}/></label>
                  <label>Capacidade<input value={row.capacidade||''} onChange={e=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?{...x,capacidade:e.target.value}:x)})}/></label>
                  <label>Quantidade recebida<input type="number" step="1" value={row.quantidade} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?{...x,quantidade:e.target.value}:x)})}/></label>
                  <label>Caixas recebidas<input type="number" step="1" value={row.caixasRecebidas} onChange={(e)=>{
                    const received=e.target.value
                    const suggested=received ? String(boxesToInspect(Number(received))) : ''
                    setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?{...x,caixasRecebidas:received,caixasInspecionadas:suggested}:x)})
                  }}/></label>
                  <label>Caixas inspecionadas<input type="number" step="1" value={row.caixasInspecionadas} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?{...x,caixasInspecionadas:e.target.value}:x)})}/></label>
                </div>
                <div className="field-label"><span>Distribuição para armazenagem · {row.sku || 'Componente '+(i+1)}</span></div>
                <div className="distribution-grid compact">
                  <div className="distribution-line"><strong>Padrão</strong><label>Caixas<input type="number" min="0" step="1" value={row.caixasPadrao} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?updateBoxDistributionField(x,'caixasPadrao',e.target.value):x)})}/></label><label>Un/caixa<input type="number" min="0" step="1" value={row.unidadesPadrao||row.quantidadePorCaixa} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?patchOperationalSkuRow(x,'unidadesPadrao',e.target.value):x)})}/></label></div>
                  <div className="distribution-line"><strong>Fracionada</strong><label>Caixas<input type="number" min="0" step="1" value={row.caixasFracionadas} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?updateBoxDistributionField(x,'caixasFracionadas',e.target.value):x)})}/></label><label>Un/caixa<input type="number" min="0" step="1" value={row.unidadesFracionadas} onChange={(e)=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?updateBoxDistributionField(x,'unidadesFracionadas',e.target.value):x)})}/></label></div>
                </div>
                <div className="lab-withdrawal">
                  <label>Retirada para laboratório (unidades)
                    <input type="number" min="0" step="1" value={row.unidadesLaboratorio} onChange={e=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?setLaboratoryUnits(x,e.target.value):x)})}/>
                  </label>
                  <small>Não acrescenta caixas à armazenagem.</small>
                </div>
                {(editingInspectionData.itens??[]).length>1 && <label>Unidades por conjunto<input type="number" min="1" step="1" value={row.unidadesPorConjunto} onChange={e=>setEditingInspectionData({...editingInspectionData,itens:editingInspectionData.itens.map((x:any,j:number)=>j===i?{...x,unidadesPorConjunto:e.target.value}:x)})}/></label>}
                {!!d.groups.length && <small className={'field-status '+((Math.abs(d.totalUnits-Number(row.quantidade))>0.0001)?'bad':'ok')}>
                  Armazenagem {d.units.toLocaleString('pt-BR')} un ({d.boxes} caixa(s))
                  {' + '}laboratório {d.labUnits.toLocaleString('pt-BR')} un
                  {' = '}{d.totalUnits.toLocaleString('pt-BR')} un recebidas
                </small>}
                </div>
              </article>})}
            </div>
            <button className="secondary" type="button" onClick={()=>{setExpandedEditSkuIndex((editingInspectionData.itens??[]).length);setEditingInspectionData({...editingInspectionData,itens:[...(editingInspectionData.itens ?? []),{...emptySku(),processoItemId:null}]})}}><Plus size={16}/> Adicionar produto à inspeção</button>
            <button className="primary wide" type="button" disabled={editSaving} onClick={()=>void saveEditingInspectionData()}>{editSaving?'Salvando…':'Salvar alterações'}</button>
            {editFeedback&&<span className="sgq-inline-save-status" role="status">
              {editLastSavedFingerprint.current===JSON.stringify(editingInspectionData)?editFeedback:'Alterações pendentes de salvamento'}
            </span>}
          </article>
        </div>
      )}
      {editingProcess && (
        <div className="modal-backdrop">
          <form className="sample-detail" onSubmit={saveProcessEdit} onClick={(e)=>e.stopPropagation()}>
            <button className="close" type="button" onClick={()=>setEditingProcess(null)}>×</button>
            <span className="eyebrow">EDITAR PROCESSO</span>
            <h2>{formatFst(editingProcess.codigo)}</h2>
            <div className="form-grid one">
              <label>Cliente<input value={editingProcess.cliente ?? ''} onChange={(e)=>setEditingProcess({...editingProcess,cliente:e.target.value})}/></label>
              <label>IT utilizada no FST
                <select value={editingProcess.it_versao_id??''} onChange={e=>setEditingProcess({...editingProcess,it_versao_id:e.target.value})}>
                  <option value="">Selecione uma IT</option>
                  {itVersions.filter(it=>it.status==='publicada' || it.id===editingProcess.it_versao_id).map(it=>
                    <option key={it.id} value={it.id}>{it.instrucoes_trabalho?.codigo||'IT'} · {it.instrucoes_trabalho?.titulo} · v{it.versao}</option>)}
                </select>
              </label>
              <small className="field-hint">Ao trocar a IT, todos os subprocessos serão atualizados. As evidências anteriores permanecem registradas.</small>
              {error && <p role="alert" className="error">{error}</p>}
            </div>
            <button className="primary wide" type="submit" disabled={processEditSaving}>{processEditSaving?'Salvando…':'Salvar alterações'}</button>
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
        <div className="modal-backdrop">
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


