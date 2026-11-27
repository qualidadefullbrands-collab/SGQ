// Small ZIP reader/writer. No external dependency; original compressed members are preserved.
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true})
const WORD='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const DRAW='http://schemas.openxmlformats.org/drawingml/2006/main'
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const table=Uint32Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0})
export function crc32(bytes){let c=0xffffffff;for(const x of bytes)c=table[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0}
const view=a=>new DataView(a.buffer,a.byteOffset,a.byteLength)
function fail(s){throw new Error(s)}
export function readZip(input){
 const b=new Uint8Array(input),v=view(b)
 if(b.length<22||b.length>40_000_000)fail('Arquivo Word vazio ou acima de 40 MB.')
 let end=-1
 for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===b.length){end=i;break}
 if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true))fail('Arquivo ZIP inválido ou dividido.')
 const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),offset=v.getUint32(end+16,true)
 if(count>3000||offset+size!==end||count===65535)fail('Formato ZIP não suportado.')
 let p=offset,total=0;const entries=new Map()
 for(let i=0;i<count;i++){
  if(p+46>end||v.getUint32(p,true)!==0x02014b50)fail('Diretório ZIP inválido.')
  const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),crc=v.getUint32(p+16,true),compressed=v.getUint32(p+20,true),uncompressed=v.getUint32(p+24,true),n=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true),loc=v.getUint32(p+42,true)
  if((flags&1)||![0,8].includes(method)||p+46+n+extra+comment>end||loc+30>offset||v.getUint32(loc,true)!==0x04034b50)fail('Word protegido ou ZIP incompatível.')
  const name=dec.decode(b.subarray(p+46,p+46+n))
  if(!name||entries.has(name)||name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||/vbaProject\.bin$/i.test(name))fail('Pacote Word não suportado.')
  const start=loc+30+v.getUint16(loc+26,true)+v.getUint16(loc+28,true)
  total+=uncompressed
  if(start+compressed>offset||total>200_000_000)fail('Pacote Word excede o limite de segurança.')
  entries.set(name,{name,method,crc,compressed:b.subarray(start,start+compressed),uncompressed,time:v.getUint16(p+12,true),date:v.getUint16(p+14,true),external:v.getUint32(p+38,true)})
  p+=46+n+extra+comment
 }
 if(p!==end||!entries.has('[Content_Types].xml')||!entries.has('word/document.xml'))fail('Selecione um arquivo .docx válido.')
 return entries
}
export async function member(entries,name,limit=12_000_000){
 const e=entries.get(name);if(!e||e.uncompressed>limit)fail('Componente do Word indisponível: '+name)
 let bytes=e.compressed
 if(e.method===8){
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),parts=[];let size=0
  for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>limit||size>e.uncompressed){await reader.cancel();fail('Componente Word acima do limite.')}parts.push(r.value)}
  bytes=new Uint8Array(size);let p=0;for(const part of parts){bytes.set(part,p);p+=part.length}
 }
 if(bytes.length!==e.uncompressed||crc32(bytes)!==e.crc)fail('Componente Word corrompido: '+name)
 return bytes
}
export function replaceMember(entries,name,bytes){
 const old=entries.get(name);if(!old)fail('Componente ausente.')
 entries.set(name,{...old,method:0,compressed:bytes,uncompressed:bytes.length,crc:crc32(bytes)})
}
export function writeZip(entries){
 const chunks=[],dirs=[];let offset=0,centralSize=0
 for(const e of entries.values()){
  const n=enc.encode(e.name),h=new Uint8Array(30+n.length),c=new Uint8Array(46+n.length),a=view(h),d=view(c),size=e.compressed.length
  a.setUint32(0,0x04034b50,true);a.setUint16(4,20,true);a.setUint16(6,0x800,true);a.setUint16(8,e.method,true);a.setUint16(10,e.time,true);a.setUint16(12,e.date,true);a.setUint32(14,e.crc,true);a.setUint32(18,size,true);a.setUint32(22,e.uncompressed,true);a.setUint16(26,n.length,true);h.set(n,30)
  d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(10,e.method,true);d.setUint16(12,e.time,true);d.setUint16(14,e.date,true);d.setUint32(16,e.crc,true);d.setUint32(20,size,true);d.setUint32(24,e.uncompressed,true);d.setUint16(28,n.length,true);d.setUint32(38,e.external,true);d.setUint32(42,offset,true);c.set(n,46)
  chunks.push(h,e.compressed);dirs.push(c);offset+=h.length+size;centralSize+=c.length
 }
 const end=new Uint8Array(22),d=view(end);d.setUint32(0,0x06054b50,true);d.setUint16(8,entries.size,true);d.setUint16(10,entries.size,true);d.setUint32(12,centralSize,true);d.setUint32(16,offset,true)
 return new Blob([...chunks,...dirs,end],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})
}
export const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()
const kids=(e,n)=>Array.from(e.children).filter(c=>c.namespaceURI===WORD&&c.localName===n)
const nodes=(e,n)=>Array.from(e.getElementsByTagNameNS(WORD,n))
export const txt=e=>e?nodes(e,'t').map(x=>x.textContent).join(' ').replace(/\s+/g,' ').trim():''
function rows(t){return kids(t,'tr').map(r=>kids(r,'tc'))}
function cell(t,r,c){const x=rows(t)[r]?.[c];if(!x)fail('Modelo de tabela inesperado.');return x}
function val(t,r,c){return txt(cell(t,r,c))}
function setText(e,value){
 const t=nodes(e,'t')
 if(t.length){t[0].textContent=String(value);t[0].setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');t.slice(1).forEach(n=>n.textContent='')}
 else{const p=e.localName==='p'?e:kids(e,'p')[0];if(!p)fail('Célula sem parágrafo Word.')
  const r=e.ownerDocument.createElementNS(WORD,'w:r'),n=e.ownerDocument.createElementNS(WORD,'w:t');n.textContent=String(value);n.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');r.append(n);p.append(r)}
}
const set=(t,r,c,v)=>setText(cell(t,r,c),v)
const int=s=>{const m=String(s).match(/\d[\d.]*/);return m?Number(m[0].replace(/\./g,'')):NaN}
export const fmt=n=>Number(n).toLocaleString('pt-BR')
export function parseXml(bytes){
 const text=dec.decode(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(text))fail('XML não permitido.')
 const d=new DOMParser().parseFromString(text,'application/xml')
 if(d.getElementsByTagName('parsererror').length)fail('XML inválido no Word.')
 return d
}
function limits(s){
 const ns=String(s).match(/\d[\d.]*/g)?.map(x=>Number(x.replace(/\./g,'')))||[]
 return /acima|mais de/i.test(s)?[ns[0]+1,Infinity]:ns.length===1?[ns[0],ns[0]]:ns
}
function rangeFor(s,n){const r=limits(s);return r.length===2&&n>=r[0]&&n<=r[1]}
export function plan(record){
 const n=Number(record.qty),b=Number(record.boxes)
 if(!Number.isSafeInteger(n)||n<=0||!Number.isSafeInteger(b)||b<=0)return null
 const row=record.ranges.find(x=>rangeFor(x[0],n)),i=record.boxRanges.findIndex(x=>rangeFor(x,b))
 if(!row||i<0)return null
 return {sample:int(row[1]),acRe:row[2],boxes:int(record.boxValues[i])}
}
function getResult(row){const found=row.slice(3,6).map((c,i)=>txt(c)?['C','NC','NA'][i]:'').filter(Boolean);return found.length===1?found[0]:''}
function extractOriginal(note){
 const r=note.match(/(\d[\d.]*)\s*un\.\s*destinadas?\s*[àa]\s*retenção/i)
 const na=note.match(/NA\s*\(([^)]+)\)/i)
 const extra=note.replace(/Inspeção conforme nos itens aplicáveis\.\s*/i,'').replace(/Itens?\s+[\d\s,e]+\s*:\s*NA\s*\([^)]+\)\.?\s*/i,'').replace(/Recebidas\s+[\d.]+\s*un\.;?\s*[\d.]+\s*un\.\s*destinadas?\s*[àa]\s*retenção,\s*restando\s+[\d.]+\s*un\.\s*(?:\([^)]*\))?\.?\s*/i,'').trim()
 return {retention:r?int(r[1]):null,na:na?.[1]||'',extra}
}
export async function readDocument(file){
 const archive=readZip(await file.arrayBuffer()),xml=parseXml(await member(archive,'word/document.xml')),body=nodes(xml,'body')[0]
 if(!body)fail('Documento principal inválido.')
 const elems=Array.from(body.children),records=[]
 for(let i=0;i<elems.length;i++){
  const e=elems[i];if(e.localName!=='tbl'||norm(val(e,0,0))!=='identificacao')continue
  const ts=[];let j=i+1
  for(;j<elems.length;j++){const t=elems[j];if(t.localName==='tbl'){if(norm(val(t,0,0))==='identificacao')break;ts.push(t)}}
  const [sampling,ranges,boxes,check,result,...photoTables]=ts
  if(!sampling||!ranges||!boxes||!check||!result||!norm(val(sampling,0,0)).includes('plano de amostragem')||norm(val(check,0,0))!=='verificacoes'||norm(val(result,0,0))!=='resultado da inspecao')fail('Este modelo não possui as tabelas esperadas de inspeção. Utilize o Word de referência.')
  const checks=rows(check).slice(2).map(r=>({label:txt(r[1]),type:txt(r[2]),original:getResult(r)}))
  if(!checks.length||checks.some(c=>!c.label))fail('Checklist inválido no documento.')
  const note=val(result,4,1),original=extractOriginal(note),decision=val(result,1,1)
  let title=null;for(let z=i-1;z>=0&&elems[z].localName!=='tbl';z--)if(norm(txt(elems[z]))==='registro de inspecao'){title=elems[z];break}
  const photos=photoTables.filter(t=>norm(val(t,0,0)).startsWith('fotos da inspecao'))
  const photoCount=photos.reduce((sum,t)=>sum+t.getElementsByTagNameNS(DRAW,'blip').length,0)
  const ref=val(e,2,3)
  records.push({id:records.length,ref,sku:val(e,1,3),name:val(e,1,1),client:val(e,2,1),nf:val(e,3,1),lot:val(e,3,3),material:val(e,4,1),capacity:val(e,4,3),origin:val(e,5,1),transport:val(e,5,3),qty:int(val(e,6,1)),pack:val(e,6,3),boxes:int(val(e,7,1)),arrival:val(e,7,3),date:val(e,8,1),level:val(sampling,1,1),ranges:rows(ranges).slice(1).map(r=>r.map(txt)),boxRanges:rows(boxes)[0].slice(1).map(txt),boxValues:rows(boxes)[1].slice(1).map(txt),checks,results:checks.map(()=>''),inspector:val(result,2,1),rt:val(result,3,1),retention:null,na:'',extra:'',decision:'',photoCount,original:{...original,decision:/\(\s*X\s*\)\s*APROVADO/i.test(decision)?'aprovado':/\(\s*X\s*\)\s*REPROVADO/i.test(decision)?'reprovado':'',note},refs:{ident:e,sampling,check,result,title,photos}})
 }
 if(!records.length)fail('Nenhum registro de inspeção encontrado no Word.')
 if(records.length>20)fail('Limite de 20 registros neste teste.')
 if(new Set(records.map(r=>r.checks.map(c=>c.label+'|'+c.type).join('\n'))).size!==1)fail('Este teste aceita registros com a mesma IT e checklist.')
 if(records.some(r=>!plan(r)||!r.sku||!r.ref))fail('Algum registro tem identificação ou plano incompleto.')
 const rels=archive.has('word/_rels/document.xml.rels')?parseXml(await member(archive,'word/_rels/document.xml.rels')):null
 const images=new Map()
 if(rels)for(const x of rels.documentElement.children){const path=x.getAttribute('Target')||'',id=x.getAttribute('Id');if(id&&/^media\/[^/\\]+\.(?:jpg|jpeg|png|gif|webp)$/i.test(path)&&x.getAttribute('TargetMode')!=='External')images.set(id,'word/'+path)}
 return {archive,xml,records,images,fileName:file.name}
}
export function reproduce(r){r.results=r.checks.map(c=>c.original);r.retention=r.original.retention;r.na=r.original.na;r.extra=r.original.extra;r.decision=r.original.decision}
export function clearResults(r){r.results=r.checks.map(()=> '');r.retention=null;r.na='';r.extra='';r.decision=''}
export function pending(r){
 const p=[];if(!plan(r))p.push('Plano de amostragem')
 if(!r.lot.trim()||!r.nf.trim()||!r.date.trim()||!r.arrival.trim()||!r.pack.trim())p.push('Identificação')
 if(r.results.some(x=>!['C','NC','NA'].includes(x)))p.push('Verificações')
 if(r.results.includes('NA')&&!r.na.trim())p.push('Justificativa NA')
 if(r.results.includes('NC')&&!r.extra.trim())p.push('Registro da não conformidade')
 if(r.retention===null||!Number.isSafeInteger(r.retention)||r.retention<0||r.retention>r.qty)p.push('Retenção')
 if(!r.inspector.trim()||!r.rt.trim())p.push('Responsáveis')
 if(!['aprovado','reprovado'].includes(r.decision))p.push('Decisão')
 return p
}
export function observation(r){
 const na=r.results.flatMap((v,i)=>v==='NA'?[i+1]:[])
 const nc=r.results.flatMap((v,i)=>v==='NC'?[i+1]:[])
 return [nc.length?'Não conformidade: itens '+nc.join(', ')+'.':'Inspeção conforme nos itens aplicáveis.',na.length?'Itens '+na.join(' e ')+': NA ('+r.na.trim()+').':'',r.extra.trim(),'Recebidas '+fmt(r.qty)+' un.; '+fmt(r.retention)+' un. destinadas à retenção, restando '+fmt(r.qty-r.retention)+' un.'].filter(Boolean).join(' ')
}
export function generate(model){
 if(model.records.some(r=>pending(r).length))fail('Conclua as pendências antes de gerar o Word.')
 for(const r of model.records){
  const {ident,sampling,check,result,title}=r.refs,p=plan(r)
  if(title)setText(title,'REGISTRO DE INSPEÇÃO — TESTE')
  set(ident,1,1,r.name);set(ident,1,3,r.sku);set(ident,2,1,r.client);set(ident,2,3,r.ref);set(ident,3,1,r.nf);set(ident,3,3,r.lot)
  set(ident,4,1,r.material);set(ident,4,3,r.capacity);set(ident,5,1,r.origin);set(ident,5,3,r.transport);set(ident,6,1,fmt(r.qty)+' un.');set(ident,6,3,r.pack);set(ident,7,1,fmt(r.boxes));set(ident,7,3,r.arrival);set(ident,8,1,r.date)
  set(sampling,1,1,r.level);set(sampling,2,1,fmt(p.sample)+' unidades');set(sampling,2,3,p.boxes+' caixas')
  r.results.forEach((x,i)=>['C','NC','NA'].forEach((key,j)=>set(check,i+2,j+3,x===key?'X':'')))
  set(result,1,1,(r.decision==='aprovado'?'( X ) APROVADO          (   ) REPROVADO':'(   ) APROVADO          ( X ) REPROVADO'))
  set(result,2,1,r.inspector);set(result,2,3,r.date);set(result,3,1,r.rt);set(result,4,1,observation(r))
 }
 const copy=new Map(model.archive);replaceMember(copy,'word/document.xml',enc.encode(new XMLSerializer().serializeToString(model.xml)))
 return writeZip(copy)
}
export async function getPhotos(model,r){
 const list=[]
 for(const t of r.refs.photos)for(const row of rows(t))for(const c of row){
  const blips=Array.from(c.getElementsByTagNameNS(DRAW,'blip'))
  for(const b of blips){const path=model.images.get(b.getAttributeNS(REL,'embed'));if(!path)continue
   const bytes=await member(model.archive,path,16_000_000),type=/\.png$/i.test(path)?'image/png':/\.gif$/i.test(path)?'image/gif':/\.webp$/i.test(path)?'image/webp':'image/jpeg'
   list.push({caption:txt(c),blob:new Blob([bytes],{type})})
  }
 }
 return list
}
