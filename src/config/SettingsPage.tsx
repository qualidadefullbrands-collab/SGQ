import {useEffect,useMemo,useState} from 'react'
import {CheckCircle2,KeyRound,LockKeyhole,Plus,RefreshCw,Save,Settings2,ShieldCheck,Users} from 'lucide-react'
import {authClient} from '../lib/supabase'
import './SettingsPage.css'

type Profile={nome:string;perfil:string;ativo:boolean}
type User={id:string;email:string;created_at?:string;last_sign_in_at?:string|null;profile:Profile|null}
type Role='administrador'|'gestor'|'inspetor'|'consulta'
const roles:Record<Role,string>={administrador:'Administrador',gestor:'Gestor',inspetor:'Inspetor',consulta:'Consulta'}
const flags=[
 {id:'read',label:'Consultar processos, inspeções e estoque',allowed:['administrador','gestor','inspetor','consulta']},
 {id:'inspection',label:'Cadastrar e editar inspeções',allowed:['administrador','gestor','inspetor']},
 {id:'stock',label:'Registrar e corrigir estoque',allowed:['administrador','gestor','inspetor']},
 {id:'quality',label:'Gerenciar instruções técnicas',allowed:['administrador','gestor']},
 {id:'delete',label:'Excluir registros e aprovar inventários',allowed:['administrador','gestor']},
 {id:'access',label:'Gerenciar contas e senhas de terceiros',allowed:['administrador']}
]
const permitted=Object.keys(roles) as Role[]
async function callAdmin(body:Record<string,unknown>){
 const {data,error}=await authClient.functions.invoke('sgq-admin-users',{body})
 if(error||data?.error){
  let message=String(data?.error||error?.message||'Serviço indisponível.')
  const response=(error as any)?.context
  if(typeof response?.json==='function'){
   const payload=await response.json().catch(()=>null)
   if(payload?.error)message=String(payload.error)
  }
  throw new Error(message)
 }
 return data
}
export default function SettingsPage({userId,profile}:{userId:string;profile:{nome:string;perfil:string}}){
 const admin=profile.perfil==='administrador'
 const [users,setUsers]=useState<User[]>([])
 const [loading,setLoading]=useState(false)
 const [saving,setSaving]=useState(false)
 const [message,setMessage]=useState('')
 const [error,setError]=useState('')
 const [newUser,setNewUser]=useState({email:'',nome:'',password:'',perfil:'inspetor' as Role})
 const [selected,setSelected]=useState<string>('')
 const [edit,setEdit]=useState({nome:'',perfil:'consulta' as Role,ativo:true})
 const [resetPassword,setResetPassword]=useState('')
 const [myPassword,setMyPassword]=useState('')
 const [myConfirm,setMyConfirm]=useState('')
 const current=users.find(u=>u.id===selected)
 const previewRole=useMemo<Role>(()=>selected?edit.perfil:newUser.perfil,[selected,edit.perfil,newUser.perfil])
 async function refresh(){
  if(!admin)return
  setLoading(true);setError('')
  try{const result=await callAdmin({action:'list'});setUsers(result.data||[])}
  catch(e:any){setError(String(e?.message||'Não foi possível consultar os acessos.'))}
  finally{setLoading(false)}
 }
 useEffect(()=>{if(admin)void refresh()},[admin])
 function choose(user:User){
  setSelected(user.id);setResetPassword('');setError('');setMessage('')
  const role=user.profile?.perfil
  setEdit({nome:user.profile?.nome||'',perfil:(role&&role in roles?role:'consulta') as Role,ativo:user.profile?.ativo===true})
 }
 async function create(e:React.FormEvent){
  e.preventDefault();if(!admin||saving)return
  setSaving(true);setMessage('');setError('')
  try{
   const res=await callAdmin({action:'create',...newUser})
   setMessage('Conta criada para '+res.data.email+'. Informe a senha inicial ao usuário por canal seguro.')
   setNewUser({email:'',nome:'',password:'',perfil:'inspetor'})
   await refresh()
  }catch(e:any){setError(String(e?.message||'Não foi possível criar o usuário.'))}
  finally{setSaving(false)}
 }
 async function update(e:React.FormEvent){
  e.preventDefault();if(!admin||!selected||saving)return
  setSaving(true);setMessage('');setError('')
  try{
   await callAdmin({action:'update',id:selected,...edit})
   setMessage('Acesso atualizado. As permissões no banco seguem o perfil selecionado.')
   await refresh()
  }catch(e:any){setError(String(e?.message||'Não foi possível atualizar o usuário.'))}
  finally{setSaving(false)}
 }
 async function reset(e:React.FormEvent){
  e.preventDefault();if(!admin||!selected||saving)return
  if(resetPassword.length<12){setError('A senha deve ter no mínimo 12 caracteres.');return}
  if(!window.confirm('Redefinir a senha da conta selecionada?'))return
  setSaving(true);setError('');setMessage('')
  try{
   await callAdmin({action:'reset_password',id:selected,password:resetPassword})
   setResetPassword('');setMessage('Senha redefinida. Oriente o usuário a alterar a senha após entrar.')
  }catch(e:any){setError(String(e?.message||'Não foi possível redefinir a senha.'))}
  finally{setSaving(false)}
 }
 async function changeMyPassword(e:React.FormEvent){
  e.preventDefault()
  if(myPassword.length<12||myPassword!==myConfirm){setError('Informe duas senhas iguais, com pelo menos 12 caracteres.');return}
  setSaving(true);setError('');setMessage('')
  try{
   const {error}=await authClient.auth.updateUser({password:myPassword})
   if(error)throw error
   setMyPassword('');setMyConfirm('');setMessage('Sua senha foi atualizada.')
  }catch(e:any){setError(String(e?.message||'Não foi possível alterar sua senha.'))}
  finally{setSaving(false)}
 }
 return <section className="workspace sgq-settings-page">
  <header className="sgq-settings-header"><div><span className="eyebrow">GOVERNANÇA · SGQ</span><h1>Configurações e acessos</h1>
   <p>Contas autenticadas, perfis efetivos, permissões e troca de senha.</p></div><Settings2 size={32}/></header>
  {message&&<div className="alert success" role="status"><CheckCircle2 size={16}/>{message}</div>}
  {error&&<div className="alert error" role="alert">{error}</div>}
  <div className="sgq-settings-main">
   <section className="panel section-card sgq-settings-password">
    <div className="section-title"><h2><KeyRound size={19}/> Minha senha</h2></div>
    <p>Usuário: <strong>{profile.nome}</strong>. A senha é atualizada pelo serviço de autenticação, sem ser armazenada no SGQ.</p>
    <form onSubmit={changeMyPassword} className="sgq-settings-form">
     <label>Nova senha<input type="password" autoComplete="new-password" required minLength={12} value={myPassword} onChange={e=>setMyPassword(e.target.value)} placeholder="Mínimo de 12 caracteres"/></label>
     <label>Confirmar nova senha<input type="password" autoComplete="new-password" required value={myConfirm} onChange={e=>setMyConfirm(e.target.value)}/></label>
     <button className="primary" type="submit" disabled={saving||!myPassword}><LockKeyhole size={16}/> Alterar minha senha</button>
    </form>
   </section>
   {!admin&&<section className="panel section-card"><h2>Meu perfil</h2><p>Permissão atual: <strong>{roles[profile.perfil as Role]||profile.perfil}</strong>. A gestão de outras contas é restrita ao administrador.</p></section>}
   {admin&&<>
    <section className="panel section-card sgq-settings-users">
     <div className="section-title"><div><h2><Users size={19}/> Contas cadastradas</h2><small>Usuários autenticados no SGQ</small></div><button type="button" className="secondary small" disabled={loading||saving} onClick={()=>void refresh()}><RefreshCw size={15}/> Atualizar</button></div>
     {loading&&<p>Consultando usuários…</p>}
     <div className="sgq-settings-user-list">
      {users.map(u=><button type="button" key={u.id} className={selected===u.id?'selected':''} onClick={()=>choose(u)}>
       <strong>{u.profile?.nome||u.email}</strong>
       <small>{u.email}</small>
       <span>{roles[u.profile?.perfil as Role]||'Sem perfil'} · {u.profile?.ativo?'Ativo':'Inativo'}</span>
      </button>)}
     </div>
    </section>
    <section className="panel section-card">
     <div className="section-title"><h2><Plus size={19}/> Cadastrar usuário</h2></div>
     <form className="sgq-settings-form" onSubmit={create}>
      <label>Nome<input required maxLength={140} value={newUser.nome} onChange={e=>setNewUser({...newUser,nome:e.target.value})}/></label>
      <label>E-mail de acesso<input required type="email" autoComplete="off" value={newUser.email} onChange={e=>setNewUser({...newUser,email:e.target.value})}/></label>
      <label>Senha inicial<input required type="password" autoComplete="new-password" minLength={12} value={newUser.password} onChange={e=>setNewUser({...newUser,password:e.target.value})}/></label>
      <label>Perfil<select value={newUser.perfil} onChange={e=>setNewUser({...newUser,perfil:e.target.value as Role})}>{permitted.map(role=><option key={role} value={role}>{roles[role]}</option>)}</select></label>
      <button className="primary" disabled={saving}><Plus size={16}/> Criar conta</button>
     </form>
    </section>
    {selected&&current&&<section className="panel section-card sgq-settings-edit">
      <div className="section-title"><h2><ShieldCheck size={19}/> Editar acesso</h2><button type="button" className="secondary small" onClick={()=>setSelected('')}>Fechar</button></div>
      <p>{current.email}</p>
      <form className="sgq-settings-form" onSubmit={update}>
       <label>Nome<input required value={edit.nome} onChange={e=>setEdit({...edit,nome:e.target.value})}/></label>
       <label>Perfil<select value={edit.perfil} onChange={e=>setEdit({...edit,perfil:e.target.value as Role})}>{permitted.map(role=><option key={role} value={role}>{roles[role]}</option>)}</select></label>
       <label className="sgq-settings-active"><input type="checkbox" checked={edit.ativo} onChange={e=>setEdit({...edit,ativo:e.target.checked})}/> Acesso ativo</label>
       <button className="primary" disabled={saving}><Save size={16}/> Salvar acesso</button>
      </form>
      <form className="sgq-settings-reset" onSubmit={reset}>
       <label>Redefinir senha deste usuário<input type="password" autoComplete="new-password" value={resetPassword} minLength={12} placeholder="Nova senha temporária" onChange={e=>setResetPassword(e.target.value)}/></label>
       <button type="submit" className="secondary" disabled={saving||resetPassword.length<12}><KeyRound size={16}/> Redefinir senha</button>
      </form>
     </section>}
    <section className="panel section-card sgq-settings-permissions">
     <div className="section-title"><h2><ShieldCheck size={19}/> Permissões por perfil</h2></div>
     <p>As flags abaixo refletem as regras efetivamente autorizadas pelo backend. Selecione um perfil no cadastro ou na edição; não há concessões visuais independentes das regras do banco.</p>
     <strong>Prévia: {roles[previewRole]}</strong>
     <div className="sgq-settings-flags">{flags.map(f=><label key={f.id}>
      <input type="checkbox" disabled readOnly checked={f.allowed.includes(previewRole)}/><span>{f.label}</span>
     </label>)}</div>
    </section>
   </>}
  </div>
 </section>
}
