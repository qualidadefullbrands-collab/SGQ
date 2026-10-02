from __future__ import annotations
import os, base64, urllib.parse
from datetime import datetime, timezone
import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .docx_generator import generate, file_name

SUPABASE_URL=os.environ.get("SUPABASE_URL","").rstrip("/")
SUPABASE_KEY=os.environ.get("SUPABASE_PUBLISHABLE_KEY","")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY são obrigatórios")

app=FastAPI(title="SGQ Document Service",version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://app-sgq.onrender.com",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["GET","POST","OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition","X-SGQ-Storage-Path","X-SGQ-File-Name"],
)

def auth_headers(token:str):
    return {"apikey":SUPABASE_KEY,"Authorization":f"Bearer {token}"}

def rest_headers(token:str):
    return {**auth_headers(token),"Content-Type":"application/json","Accept":"application/json"}

async def verify_user(client:httpx.AsyncClient,token:str):
    r=await client.get(f"{SUPABASE_URL}/auth/v1/user",headers=auth_headers(token))
    if r.status_code!=200:
        raise HTTPException(status_code=401,detail="Sessão inválida ou expirada.")
    return r.json()

async def table_rows(client,token,table,params):
    r=await client.get(f"{SUPABASE_URL}/rest/v1/{table}",headers=rest_headers(token),params=params)
    if r.status_code>=300:
        raise HTTPException(status_code=502,detail=f"Falha ao consultar {table}: {r.text[:300]}")
    return r.json()

async def storage_download(client,token,bucket,path):
    encoded="/".join(urllib.parse.quote(x,safe="") for x in str(path).split("/"))
    r=await client.get(f"{SUPABASE_URL}/storage/v1/object/authenticated/{bucket}/{encoded}",headers=auth_headers(token))
    if r.status_code>=300:
        raise HTTPException(status_code=502,detail=f"Falha ao ler arquivo {path}: {r.text[:240]}")
    return r.content

async def storage_upload(client,token,bucket,path,data,content_type):
    encoded="/".join(urllib.parse.quote(x,safe="") for x in str(path).split("/"))
    headers={**auth_headers(token),"Content-Type":content_type,"x-upsert":"true"}
    r=await client.post(f"{SUPABASE_URL}/storage/v1/object/{bucket}/{encoded}",headers=headers,content=data)
    if r.status_code>=300:
        raise HTTPException(status_code=502,detail=f"Falha ao salvar relatório: {r.text[:300]}")
    return r.json()

async def patch_execution(client,token,execution_id,payload):
    h={**rest_headers(token),"Prefer":"return=representation"}
    r=await client.patch(
        f"{SUPABASE_URL}/rest/v1/auditoria_execucoes",
        headers=h,
        params={"id":f"eq.{execution_id}"},
        json=payload,
    )
    if r.status_code>=300:
        raise HTTPException(status_code=502,detail=f"Falha ao atualizar auditoria: {r.text[:240]}")
    return r.json()

@app.get("/health")
async def health():
    return {"status":"ok","service":"sgq-docs"}

@app.get("/generate/{execution_id}")
async def generate_document(execution_id:str,authorization:str|None=Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401,detail="Authorization Bearer obrigatório.")
    token=authorization.split(" ",1)[1].strip()
    async with httpx.AsyncClient(timeout=45.0) as client:
        user=await verify_user(client,token)
        executions=await table_rows(client,token,"auditoria_execucoes",{"id":f"eq.{execution_id}","select":"*","limit":"1"})
        if not executions: raise HTTPException(status_code=404,detail="Auditoria não encontrada.")
        ex=executions[0]
        rq=ex["rq_code"]

        templates=await table_rows(client,token,"auditoria_templates",{"rq_code":f"eq.{rq}","ativo":"eq.true","select":"*","limit":"1"})
        if not templates or not templates[0].get("storage_path"):
            raise HTTPException(status_code=409,detail=f"Modelo oficial {rq} ainda não foi enviado no cadastro de modelos.")
        template=templates[0]
        template_bytes=await storage_download(client,token,"auditoria-modelos",template["storage_path"])

        answers,findings,objects,messages=await __import__("asyncio").gather(
            table_rows(client,token,"auditoria_respostas",{"execucao_id":f"eq.{execution_id}","select":"*","order":"criado_em.asc"}),
            table_rows(client,token,"auditoria_achados",{"execucao_id":f"eq.{execution_id}","select":"*","order":"criado_em.asc"}),
            table_rows(client,token,"auditoria_objetos",{"execucao_id":f"eq.{execution_id}","select":"*","order":"criado_em.asc"}),
            table_rows(client,token,"auditoria_mensagens",{"execucao_id":f"eq.{execution_id}","select":"*","order":"criado_em.asc"}),
        )

        photos=[]
        seen=set()
        for m in messages:
            path=m.get("foto_path")
            if not path or path in seen: continue
            seen.add(path)
            try:
                data=await storage_download(client,token,"auditoria-evidencias",path)
                photos.append({"bytes":data,"caption":m.get("texto") or ""})
            except HTTPException:
                pass

        payload={
            "execution":ex,
            "answers":answers,
            "findings":findings,
            "objects":objects,
            "messages":messages,
            "photos":photos,
            "previous":[],
        }
        docx=generate(template_bytes,payload)
        filename=file_name(rq,ex["data_avaliacao"])
        uid=user.get("id") or "user"
        storage_path=f"{uid}/{execution_id}/{filename}"
        await storage_upload(
            client,token,"auditoria-relatorios",storage_path,docx,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        now=datetime.now(timezone.utc).isoformat()
        await patch_execution(client,token,execution_id,{
            "documento_storage_path":storage_path,
            "documento_nome":filename,
            "documento_gerado_em":now,
            "power_automate_status":"documento_pronto",
            "atualizado_em":now,
        })

        safe_name=urllib.parse.quote(filename)
        return Response(
            content=docx,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition":f"attachment; filename*=UTF-8''{safe_name}",
                "X-SGQ-Storage-Path":storage_path,
                "X-SGQ-File-Name":filename,
            },
        )

@app.get("/template-status")
async def template_status(authorization:str|None=Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401,detail="Authorization Bearer obrigatório.")
    token=authorization.split(" ",1)[1].strip()
    async with httpx.AsyncClient(timeout=20.0) as client:
        await verify_user(client,token)
        rows=await table_rows(client,token,"auditoria_templates",{"select":"rq_code,rq_version,arquivo_nome,storage_path,ativo","order":"rq_code.asc"})
        return {"templates":rows}
