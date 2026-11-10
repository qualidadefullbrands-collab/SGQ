import DOMPurify from 'dompurify'

const tags=['p','br','h1','h2','h3','strong','b','em','i','u','s','ul','ol','li',
 'blockquote','table','tbody','thead','tr','th','td','img','a','hr']
const attrs=['href','src','alt','title','colspan','rowspan','scope']

/** Only document-safe semantic content is carried into the SGQ editor. */
export function sanitizeNarrativeHtml(raw:string):string{
 const clean=DOMPurify.sanitize(raw,{
  ALLOWED_TAGS:tags,
  ALLOWED_ATTR:attrs,
  ALLOW_DATA_ATTR:false,
  ADD_DATA_URI_TAGS:['img'],
 })
 const dom=new DOMParser().parseFromString(clean,'text/html')
 for(const img of Array.from(dom.querySelectorAll('img'))){
  const src=img.getAttribute('src')||''
  if(!/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(src)&&
    !/^https:\/\//i.test(src))img.remove()
 }
 for(const link of Array.from(dom.querySelectorAll('a[href]'))){
  const href=link.getAttribute('href')||''
  if(!/^(https:\/\/|mailto:)/i.test(href))link.removeAttribute('href')
 }
 return dom.body.innerHTML
}

export function plainToRichHtml(source:string):string{
 const escape=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
 const lines=source.split(/\r?\n/)
 const blocks:string[]=[]
 let list:string[]=[]
 const flush=()=>{if(list.length){blocks.push('<ul>'+list.map(v=>'<li><p>'+escape(v)+'</p></li>').join('')+'</ul>');list=[]}}
 for(const raw of lines){
  const line=raw.trim()
  if(!line){flush();continue}
  if(/^[-•]\s+/.test(line)){list.push(line.replace(/^[-•]\s+/,''));continue}
  flush()
  if(/^\d+(?:\.\d+)*[.)]?\s+\p{Lu}[\p{L}\s/–-]{3,100}$/u.test(line))
   blocks.push('<h2>'+escape(line)+'</h2>')
  else blocks.push('<p>'+escape(line)+'</p>')
 }
 flush()
 return sanitizeNarrativeHtml(blocks.join(''))||'<p></p>'
}

export function narrativeTextFromHtml(html:string):string{
 const dom=new DOMParser().parseFromString(sanitizeNarrativeHtml(html),'text/html')
 return Array.from(dom.body.querySelectorAll('p,h1,h2,h3,li')).map(el=>el.textContent?.trim()||'')
  .filter(Boolean).join('\n')
}

/** Strip the registration annex only when it occurs after the narrative. */
export function cutRegistrationAnnex(html:string):string{
 const dom=new DOMParser().parseFromString(sanitizeNarrativeHtml(html),'text/html')
 const body=dom.body
 let accumulated=0
 const nodes=Array.from(body.children)
 for(let index=0;index<nodes.length;index++){
  const el=nodes[index]
  const text=(el.textContent||'').trim().replace(/\s+/g,' ')
  if(accumulated>150&&/^(?:ANEXO\s*[-–:]?\s*)?REGISTRO DE INSPEÇÃO\b/i.test(text)){
   for(const following of nodes.slice(index))following.remove()
   return sanitizeNarrativeHtml(body.innerHTML)
  }
  accumulated+=text.length
 }
 return sanitizeNarrativeHtml(html)
}

/** Converts the original DOCX to semantic HTML, not to one continuous string. */
export async function importNarrativeFromDocx(file:Blob):Promise<{html:string;warnings:string[]}>{
 if(file.size>12_000_000)throw new Error('O Word excede o limite de 12 MB para importação.')
 const mammoth=(await import('mammoth/mammoth.browser')).default
 const converted=await mammoth.convertToHtml({arrayBuffer:await file.arrayBuffer()},{
  styleMap:[
   "p[style-name='Heading 1'] => h1:fresh",
   "p[style-name='Heading 2'] => h2:fresh",
   "p[style-name='Título 1'] => h1:fresh",
   "p[style-name='Título 2'] => h2:fresh",
   "p[style-name='Title'] => h1:fresh"
  ],
 })
 const html=cutRegistrationAnnex(converted.value)
 if(!narrativeTextFromHtml(html))throw new Error('O Word não trouxe conteúdo textual legível.')
 return {html,warnings:converted.messages.filter(x=>x.type==='warning').slice(0,5).map(x=>x.message)}
}
