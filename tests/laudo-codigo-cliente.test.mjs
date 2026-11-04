import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {inflateRawSync} from 'node:zlib'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=dirname(dirname(fileURLToPath(import.meta.url)))
const templates=join(root,'server','templates')
const generator=readFileSync(join(root,'server','docx_generator.py'),'utf8')

function part(bytes,name){
 let eocd=-1
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65558);i--){
  if(bytes.readUInt32LE(i)===0x06054b50){eocd=i;break}
 }
 assert.ok(eocd>=0,'DOCX ZIP central directory exists')
 const count=bytes.readUInt16LE(eocd+10)
 let cursor=bytes.readUInt32LE(eocd+16)
 for(let i=0;i<count;i++){
  assert.equal(bytes.readUInt32LE(cursor),0x02014b50)
  const method=bytes.readUInt16LE(cursor+10)
  const compressedLength=bytes.readUInt32LE(cursor+20)
  const nameLength=bytes.readUInt16LE(cursor+28)
  const extraLength=bytes.readUInt16LE(cursor+30)
  const commentLength=bytes.readUInt16LE(cursor+32)
  const localOffset=bytes.readUInt32LE(cursor+42)
  const filename=bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8')
  cursor+=46+nameLength+extraLength+commentLength
  if(filename!==name)continue
  assert.equal(bytes.readUInt32LE(localOffset),0x04034b50)
  const fileNameLength=bytes.readUInt16LE(localOffset+26)
  const extraLocalLength=bytes.readUInt16LE(localOffset+28)
  const at=localOffset+30+fileNameLength+extraLocalLength
  const compressed=bytes.subarray(at,at+compressedLength)
  return (method===8?inflateRawSync(compressed):compressed).toString('utf8')
 }
 throw new Error('DOCX does not contain '+name)
}
test('all official Word inspection templates contain a client code field',()=>{
 const files=readdirSync(templates).filter(name=>/^IT\d+\.docx$/i.test(name))
 assert.ok(files.length>=8,'Official IT templates should be available')
 for(const file of files){
  const xml=part(readFileSync(join(templates,file)),'word/document.xml')
  const labels=xml.replace(/<\/w:p>/g,' ').replace(/<[^>]+>/g,'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ')
  assert.match(labels,/codigo\s+do\s+cliente/,file+' is missing Código do cliente')
 }
})
test('Word generator never confuses Omie SKU and actual client product code',()=>{
 assert.match(generator,/"código do cliente": first_item\.get\("codigo_cliente"\) or ""/)
 assert.doesNotMatch(generator,/"código do cliente": product\.get\("sku"\)/)
})
