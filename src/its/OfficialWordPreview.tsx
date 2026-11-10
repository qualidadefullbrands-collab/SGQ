import {useEffect,useRef,useState} from 'react'
import {AlertCircle,FileText,RefreshCw,ZoomIn,ZoomOut} from 'lucide-react'
import {renderAsync} from 'docx-preview'
import {authClient} from '../lib/supabase'

type Props={storagePath:string;fileName:string}

/**
 * Isolated preview of the source DOCX, not a recreated two-page document.
 * Word-generated CSS and tables stay inside a Shadow DOM so the SGQ
 * design system cannot change border, font, or table geometry.
 */
export default function OfficialWordPreview({storagePath,fileName}:Props){
 const hostRef=useRef<HTMLDivElement|null>(null)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [pageCount,setPageCount]=useState<number|null>(null)
 const [zoom,setZoom]=useState(85)
 const [retry,setRetry]=useState(0)

 useEffect(()=>{
  let cancelled=false
  const host=hostRef.current
  if(!host)return
  setLoading(true);setError('');setPageCount(null)
  const shadow=host.shadowRoot||host.attachShadow({mode:'open'})
  shadow.replaceChildren()
  const style=document.createElement('style')
  style.textContent=`
    :host{display:block;color:#162c45;background:#e9f0f7;min-height:220px}
    .docx-wrapper{background:#e9f0f7!important;padding:24px!important;
      display:flex!important;flex-direction:column!important;align-items:center!important;gap:18px!important}
    .docx-wrapper>section.docx{background:#fff!important;margin:0!important;
      box-shadow:0 7px 28px rgba(15,38,67,.17)!important;flex:none!important}
    @media(max-width:680px){.docx-wrapper{padding:12px!important;gap:12px!important}}
  `
  shadow.appendChild(style)
  const body=document.createElement('div')
  body.className='it-docx-original-body'
  shadow.appendChild(body)

  void(async()=>{
   try{
    if(!/^[^?#]+\.docx$/i.test(storagePath)||storagePath.split('/').some(part=>part==='..'||part==='.')||storagePath.startsWith('/'))
     throw new Error('Caminho do documento oficial inválido.')
    const {data,error:storageError}=await authClient.storage.from('it-documentos').download(storagePath)
    if(storageError||!data)throw new Error(storageError?.message||'O Word não está acessível para esta sessão.')
    if(data.size>12_000_000)throw new Error('O Word excede o limite de 12 MB para visualização.')
    if(cancelled)return
    await renderAsync(data,body,body,{
     className:'docx',
     inWrapper:true,
     breakPages:true,
     ignoreLastRenderedPageBreak:false,
     renderHeaders:true,
     renderFooters:true,
     renderFootnotes:false,
     renderEndnotes:false,
     renderComments:false,
     renderAltChunks:false,
     renderChanges:false,
     useBase64URL:true,
    })
    if(cancelled)return
    // Count only pages actually rendered. Browser pagination may differ from Word.
    const pages=body.querySelectorAll('section.docx').length
    setPageCount(pages||null)
    setLoading(false)
   }catch(e){
    if(cancelled)return
    setLoading(false)
    setError(e instanceof Error?e.message:'Falha ao renderizar o documento Word.')
   }
  })()
  return()=>{cancelled=true;shadow.replaceChildren()}
 },[storagePath,retry])

 return <section className="it-original-preview" aria-label="Prévia do Word oficial">
  <div className="it-original-toolbar">
   <div className="it-original-identity">
    <FileText size={19} aria-hidden="true"/>
    <div><strong>{fileName}</strong>
     <small>{loading?'Abrindo o documento oficial…':error?'Visualização indisponível':
      (pageCount?pageCount+' página(s) renderizada(s) · ':'')+'Documento original · somente leitura'}</small>
    </div>
   </div>
   <div className="it-original-zoom" aria-label="Zoom do documento">
    <button className="secondary small" type="button" disabled={zoom<=60} aria-label="Reduzir zoom" onClick={()=>setZoom(v=>Math.max(60,v-15))}><ZoomOut size={16}/></button>
    <span aria-live="polite">{zoom}%</span>
    <button className="secondary small" type="button" disabled={zoom>=130} aria-label="Ampliar zoom" onClick={()=>setZoom(v=>Math.min(130,v+15))}><ZoomIn size={16}/></button>
   </div>
  </div>
  <p className="it-original-notice">Esta visualização utiliza o arquivo DOCX da IT publicada, incluindo tabelas, imagens, cabeçalhos e rodapés. O navegador pode quebrar páginas de forma diferente do Microsoft Word; o arquivo original continua sendo a referência.</p>
  {loading&&<div className="it-original-loading" role="status"><RefreshCw size={19}/> Preparando as páginas do Word…</div>}
  {error&&<div className="it-original-error" role="alert">
   <AlertCircle size={20}/><div><strong>Não foi possível exibir o Word oficial</strong><p>{error}</p>
    <button type="button" className="secondary" onClick={()=>setRetry(v=>v+1)}><RefreshCw size={16}/> Tentar novamente</button></div>
  </div>}
  <div className="it-original-viewport" style={{zoom:zoom/100,visibility:loading?'hidden':'visible'}}>
   <div ref={hostRef} className="it-original-mount" />
  </div>
 </section>
}
