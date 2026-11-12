import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";

const URL_BASE=Deno.env.get("SUPABASE_URL")!;
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(URL_BASE,KEY,{auth:{persistSession:false}});
const originAllowed=new Set(["https://app-sgq.onrender.com","http://localhost:5173","http://127.0.0.1:5173"]);
const permittedRoles=new Set(["administrador","gestor","inspetor","consulta"]);
function headers(request:Request){
  const origin=request.headers.get("origin")||"";
  return {"Content-Type":"application/json","Cache-Control":"no-store",
    "Access-Control-Allow-Origin":originAllowed.has(origin)?origin:"https://app-sgq.onrender.com",
    "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods":"POST, OPTIONS"};
}
function respond(request:Request,body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:headers(request)});}
function emailValid(value:string){return value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}
function uuid(value:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);}
async function audit(userId:string,entityId:string,action:string,details:Record<string,unknown>){
  const {error}=await admin.from("audit_log").insert({usuario_id:userId,entidade:"profiles",entidade_id:entityId,acao:action,dados:details});
  if(error)throw new Error("Não foi possível registrar auditoria da mudança de acesso.");
}
Deno.serve(async(request:Request)=>{
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:headers(request)});
  if(request.method!=="POST")return respond(request,{error:"method_not_allowed"},405);
  const origin=request.headers.get("origin");
  if(origin&&!originAllowed.has(origin))return respond(request,{error:"origin_not_allowed"},403);
  if(Number(request.headers.get("content-length")||0)>10000)return respond(request,{error:"payload_too_large"},413);
  try{
    const jwt=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
    if(!jwt)return respond(request,{error:"not_authenticated"},401);
    const {data:who,error:authError}=await admin.auth.getUser(jwt);
    if(authError||!who.user)return respond(request,{error:"not_authenticated"},401);
    const actor=who.user.id;
    const {data:profile,error:profileError}=await admin.from("profiles").select("perfil,ativo").eq("id",actor).single();
    if(profileError||profile?.ativo!==true||profile.perfil!=="administrador")
      return respond(request,{error:"not_authorized"},403);
    const body=await request.json().catch(()=>({}));
    const action=String(body?.action||"");
    if(action==="list"){
      const users:Array<Record<string,unknown>>=[];
      for(let page=1;page<=10;page++){
        const result=await admin.auth.admin.listUsers({page,perPage:100});
        if(result.error)throw result.error;
        users.push(...result.data.users.map(u=>({id:u.id,email:u.email||"",created_at:u.created_at,last_sign_in_at:u.last_sign_in_at})));
        if(result.data.users.length<100)break;
      }
      const {data:profiles,error}=await admin.from("profiles").select("id,nome,perfil,ativo");
      if(error)throw error;
      const indexed=new Map((profiles||[]).map(p=>[p.id,p]));
      return respond(request,{data:users.map(u=>({...u,profile:indexed.get(String(u.id))||null}))});
    }
    if(action==="create"){
      const email=String(body.email||"").trim().toLowerCase();
      const nome=String(body.nome||"").trim().slice(0,140);
      const password=String(body.password||"");
      const role=String(body.perfil||"consulta");
      if(!emailValid(email)||!nome||!permittedRoles.has(role)||password.length<12||password.length>128)
        return respond(request,{error:"Dados inválidos: e-mail, nome, perfil e senha de pelo menos 12 caracteres são obrigatórios."},400);
      const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
      if(created.error||!created.data.user)return respond(request,{error:created.error?.message||"Não foi possível cadastrar o usuário."},400);
      const id=created.data.user.id;
      const {error:profileErr}=await admin.from("profiles").upsert({id,nome,perfil:role,ativo:true},{onConflict:"id"});
      if(profileErr){
        await admin.auth.admin.deleteUser(id);
        return respond(request,{error:"Falha ao associar perfil. Cadastro revertido."},500);
      }
      await audit(actor,id,"criar_usuario",{email,nome,perfil:role,ativo:true});
      return respond(request,{data:{id,email,nome,perfil:role,ativo:true}});
    }
    if(action==="update"){
      const id=String(body.id||"");
      const role=String(body.perfil||"");
      const ativo=body.ativo;
      const nome=String(body.nome||"").trim().slice(0,140);
      if(!uuid(id)||!permittedRoles.has(role)||typeof ativo!=="boolean"||!nome)
        return respond(request,{error:"Parâmetros de usuário inválidos."},400);
      if(id===actor&&(role!=="administrador"||!ativo))
        return respond(request,{error:"Não é permitido revogar o seu próprio acesso administrativo."},409);
      const {data:before,error:readError}=await admin.from("profiles").select("perfil,ativo,nome").eq("id",id).single();
      if(readError||!before)return respond(request,{error:"Perfil não localizado."},404);
      if(before.perfil==="administrador"&&(role!=="administrador"||!ativo)){
        const {count,error:countErr}=await admin.from("profiles").select("id",{count:"exact",head:true}).eq("perfil","administrador").eq("ativo",true);
        if(countErr||!count||count<=1)return respond(request,{error:"O último administrador não pode ser desativado."},409);
      }
      const {error}=await admin.from("profiles").update({nome,perfil:role,ativo}).eq("id",id);
      if(error)throw error;
      await audit(actor,id,"alterar_acesso_usuario",{antes:before,depois:{nome,perfil:role,ativo}});
      return respond(request,{data:{id,nome,perfil:role,ativo}});
    }
    if(action==="reset_password"){
      const id=String(body.id||"");
      const password=String(body.password||"");
      if(!uuid(id)||password.length<12||password.length>128)
        return respond(request,{error:"Informe usuário e senha de 12 a 128 caracteres."},400);
      const {error}=await admin.auth.admin.updateUserById(id,{password});
      if(error)return respond(request,{error:error.message},400);
      await audit(actor,id,"redefinir_senha_usuario",{alterado_por_administrador:true});
      return respond(request,{data:{ok:true}});
    }
    return respond(request,{error:"Operação não reconhecida."},400);
  }catch(error){
    console.error("sgq-admin-users error",error instanceof Error?error.name:"unexpected");
    return respond(request,{error:"Falha na operação administrativa."},500);
  }
});
