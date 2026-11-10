import {useEffect} from 'react'
import {EditorContent,useEditor} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {TableKit} from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import {Bold,Italic,Heading1,Heading2,List,ListOrdered,Table2,Undo2,Redo2,
 Underline as UnderlineIcon,Plus,Minus} from 'lucide-react'
import {sanitizeNarrativeHtml} from './richNarrative'
import './RichNarrativeEditor.css'

type Props={value:string;onChange?:(html:string)=>void;readOnly?:boolean}
export default function RichNarrativeEditor({value,onChange,readOnly=false}:Props){
 const editor=useEditor({
  extensions:[StarterKit.configure({heading:{levels:[1,2,3]}}),
   TableKit.configure({table:{resizable:true}}),
   Image.configure({allowBase64:true,inline:false})],
  content:sanitizeNarrativeHtml(value||'<p></p>'),
  editable:!readOnly,
  immediatelyRender:false,
  editorProps:{attributes:{
   class:'sgq-rich-document',role:'textbox','aria-multiline':'true',
   'aria-label':readOnly?'Prévia do conteúdo textual':'Editar conteúdo textual da IT',
  }},
  onUpdate:({editor})=>onChange?.(sanitizeNarrativeHtml(editor.getHTML())),
 },[])
 useEffect(()=>{
  if(!editor)return
  const clean=sanitizeNarrativeHtml(value||'<p></p>')
  if(editor.getHTML()!==clean)editor.commands.setContent(clean,{emitUpdate:false})
 },[editor,value])
 useEffect(()=>{editor?.setEditable(!readOnly)},[editor,readOnly])
 if(!editor)return <div className="sgq-rich-loading">Preparando o editor…</div>
 const tool=(label:string,action:()=>void,active=false,disabled=false,Icon=Bold)=>(
  <button key={label} type="button" title={label} aria-label={label} aria-pressed={active}
   disabled={disabled} className={'sgq-rich-tool'+(active?' active':'')} onClick={action}>
   <Icon size={17} aria-hidden="true"/>
  </button>
 )
 return <div className={'sgq-rich-container'+(readOnly?' is-read-only':'')}>
  {!readOnly&&<div className="sgq-rich-toolbar" role="toolbar" aria-label="Formatação do texto">
   <div className="sgq-rich-tool-group" aria-label="Títulos">
    {tool('Título principal',()=>editor.chain().focus().toggleHeading({level:1}).run(),editor.isActive('heading',{level:1}),false,Heading1)}
    {tool('Subtítulo',()=>editor.chain().focus().toggleHeading({level:2}).run(),editor.isActive('heading',{level:2}),false,Heading2)}
   </div>
   <div className="sgq-rich-tool-group" aria-label="Estilos">
    {tool('Negrito',()=>editor.chain().focus().toggleBold().run(),editor.isActive('bold'),false,Bold)}
    {tool('Itálico',()=>editor.chain().focus().toggleItalic().run(),editor.isActive('italic'),false,Italic)}
    {tool('Sublinhado',()=>editor.chain().focus().toggleUnderline().run(),editor.isActive('underline'),false,UnderlineIcon)}
   </div>
   <div className="sgq-rich-tool-group" aria-label="Listas">
    {tool('Lista com marcadores',()=>editor.chain().focus().toggleBulletList().run(),editor.isActive('bulletList'),false,List)}
    {tool('Lista numerada',()=>editor.chain().focus().toggleOrderedList().run(),editor.isActive('orderedList'),false,ListOrdered)}
   </div>
   <div className="sgq-rich-tool-group" aria-label="Tabelas">
    {tool('Inserir tabela 3 por 3',()=>editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run(),false,false,Table2)}
    {tool('Inserir linha abaixo',()=>editor.chain().focus().addRowAfter().run(),false,!editor.isActive('table'),Plus)}
    {tool('Excluir linha',()=>editor.chain().focus().deleteRow().run(),false,!editor.isActive('table'),Minus)}
   </div>
   <div className="sgq-rich-tool-group" aria-label="Histórico">
    {tool('Desfazer',()=>editor.chain().focus().undo().run(),false,!editor.can().undo(),Undo2)}
    {tool('Refazer',()=>editor.chain().focus().redo().run(),false,!editor.can().redo(),Redo2)}
   </div>
  </div>}
  <EditorContent editor={editor}/>
  {!readOnly&&<div className="sgq-rich-footer">
   <span>Títulos, parágrafos, tabelas e listas são editados visualmente.</span>
   <span>{editor.storage.characterCount?.characters?.()??editor.getText().length} caracteres</span>
  </div>}
 </div>
}
