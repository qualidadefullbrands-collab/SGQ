// Pure, side-effect-free image verification shared by the Edge Function and tests.
// Omie downloads supplied gallery URLs, then returns signed Omie CDN URLs.
// Query strings rotate, so only the immutable URL path identifies an existing image.
export const imageIdentity=url=>String(url??'').trim().split('?')[0]
export const imagesOf=product=>Array.isArray(product?.imagens)
 ?product.imagens.map(entry=>({url_imagem:String(entry?.url_imagem??'').trim()}))
   .filter(entry=>/^https:\/\//i.test(entry.url_imagem))
 :[]

export function newlyImportedImage(before,after){
 if(after.length<=before.length)return null
 const previous=new Set(before.map(img=>imageIdentity(img.url_imagem)))
 if(!before.every(img=>after.some(next=>imageIdentity(next.url_imagem)===imageIdentity(img.url_imagem))))return null
 const added=after.filter(img=>!previous.has(imageIdentity(img.url_imagem)))
 return added.length===1?added[0].url_imagem:null
}

export function matchesOmieUpdateTime(product,isoDate){
 const date=String(product?.info?.dAlt??'').trim()
 const clock=String(product?.info?.hAlt??'').trim()
 const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date)
 if(!m||!/^\d{2}:\d{2}:\d{2}$/.test(clock))return false
 const updated=Date.parse(m[3]+'-'+m[2]+'-'+m[1]+'T'+clock+'-03:00')
 const attempted=Date.parse(isoDate)
 return Number.isFinite(updated)&&Number.isFinite(attempted)&&Math.abs(updated-attempted)<120000
}
