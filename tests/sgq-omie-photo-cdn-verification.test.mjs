import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
 imageIdentity,imagesOf,newlyImportedImage,matchesOmieUpdateTime,
} from '../supabase/functions/sgq-inventario-foto-direta/photoVerification.mjs'

const edge=readFileSync(new URL('../supabase/functions/sgq-inventario-foto-direta/index.ts',import.meta.url),'utf8')
const ui=readFileSync(new URL('../src/stock/BlindInventoryUnified.tsx',import.meta.url),'utf8')
const img=url_imagem=>({url_imagem})
const omie='https://cdn.omie.com.br/repository/product/imported.png'
const original='https://gyqufucgevpczqebmdqy.supabase.co/storage/v1/object/public/sgq-catalogo-omie/produtos/inventario/photo.png'

test('Omie CDN URL identity ignores rotated image signatures',()=>{
 assert.equal(imageIdentity(omie+'?Expires=1&Signature=one'),imageIdentity(omie+'?Expires=999&Signature=two'))
 assert.notEqual(imageIdentity(omie),imageIdentity(original))
})

test('detects new CDN image when product gallery was empty',()=>{
 assert.equal(newlyImportedImage([],[img(omie+'?Expires=999')]),omie+'?Expires=999')
 assert.equal(newlyImportedImage([],[]),null)
})

test('recognizes exactly one added photo while preserving signed existing gallery',()=>{
 const old=img('https://cdn.omie.com.br/existing.png?Signature=old')
 const current=[img('https://cdn.omie.com.br/existing.png?Signature=renewed'),img(omie)]
 assert.equal(newlyImportedImage([old],current),omie)
 assert.equal(newlyImportedImage([old],[img(omie)]),null,'must not mark success after replacing old photo')
 assert.equal(newlyImportedImage([old],[old]),null,'must not report success without new photo')
 assert.equal(newlyImportedImage([old],[old,img(omie),img(omie+'?duplicate')]),null,'ambiguous gallery is not confirmation')
})

test('reconciliation matches the exact timestamp of the earlier Omie import',()=>{
 const updated={info:{dAlt:'13/11/2026',hAlt:'16:07:15'}}
 assert.equal(matchesOmieUpdateTime(updated,'2026-11-13T19:07:16.861Z'),true)
 assert.equal(matchesOmieUpdateTime(updated,'2026-11-13T18:27:38.684Z'),false)
 assert.equal(matchesOmieUpdateTime({},'2026-11-13T19:07:16.861Z'),false)
})

test('gallery safely filters public image URLs, no missing-list assumptions',()=>{
 assert.deepEqual(imagesOf({imagens:[{url_imagem:omie},{url_imagem:'http://insecure'},{url_imagem:''}]}),[img(omie)])
 assert.deepEqual(imagesOf({imagens:null}),[])
})

test('Edge Function validates CDN import and reuses old audit evidence before reapplying',()=>{
 assert.match(edge,/import \{imageIdentity,imagesOf,newlyImportedImage,matchesOmieUpdateTime\} from '\.\/photoVerification\.mjs'/)
 assert.match(edge,/newlyImportedImage\(originals,verifiedImages\)/)
 assert.match(edge,/matchesOmieUpdateTime\(product,log\.criado_em\)/)
 assert.match(edge,/return await storeResult\(photo,user\.id,converted,beforeImages,publicUrl\)/)
 assert.match(edge,/for\(const delay of \[0,900,1800\]\)/)
 assert.match(edge,/\.eq\('status','enviando'\)\.select\('id'\)\.maybeSingle\(\)/)
 assert.doesNotMatch(edge,/clean\(img\?\.url_imagem\)===publicUrl/)
 assert.match(edge,/if\(others\.length>=6\)/)
 assert.match(edge,/throw new Error\('O limite de seis fotos/)
})

test('UI reveals the real Omie HTTP error instead of generic non-2xx',()=>{
 assert.match(ui,/const context=\(reply\.error as/)
 assert.match(ui,/const payload=await context\.json\(\)/)
 assert.match(ui,/if\(typeof payload\?\.error==='string'/)
 assert.match(ui,/Reenviar foto/)
})
