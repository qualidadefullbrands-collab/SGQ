from __future__ import annotations
import os, base64, urllib.parse
from datetime import datetime, timezone
import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .docx_generator import generate, file_name, generate_inspection, inspection_file_name

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


@app.get("/generate-inspection/{inspection_id}")
async def generate_inspection_document(inspection_id:str,authorization:str|None=Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401,detail="Authorization Bearer obrigatório.")
    token=authorization.split(" ",1)[1].strip()
    async with httpx.AsyncClient(timeout=60.0) as client:
        user=await verify_user(client,token)
        rows=await table_rows(client,token,"inspecoes",{"id":f"eq.{inspection_id}","select":"*","limit":"1"})
        if not rows: raise HTTPException(status_code=404,detail="Inspeção não encontrada.")
        inspection=rows[0]
        group_id=inspection.get("grupo_inspecao_id")
        version_id=inspection.get("it_versao_id")
        groups=await table_rows(client,token,"grupos_inspecao",{"id":f"eq.{group_id}","select":"*","limit":"1"})
        if not groups: raise HTTPException(status_code=409,detail="Grupo da inspeção não encontrado.")
        group=groups[0]
        processes=await table_rows(client,token,"processos",{"id":f"eq.{group.get('processo_id')}","select":"*","limit":"1"})
        process=processes[0] if processes else {}

        versions=await table_rows(client,token,"it_versoes",{"id":f"eq.{version_id}","select":"*","limit":"1"})
        if not versions or not versions[0].get("arquivo_storage_path"):
            raise HTTPException(status_code=409,detail="A IT vinculada não possui modelo Word disponível.")
        version=versions[0]
        template_bytes=await storage_download(client,token,"it-documentos",version["arquivo_storage_path"])

        links=await table_rows(client,token,"grupo_inspecao_itens",{"grupo_inspecao_id":f"eq.{group_id}","select":"processo_item_id,unidades_por_conjunto"})
        items=[]
        product_photos=[]
        for link in links:
            item_rows=await table_rows(client,token,"processo_itens",{"id":f"eq.{link.get('processo_item_id')}","select":"*","limit":"1"})
            if not item_rows: continue
            item=item_rows[0]
            prod_rows=await table_rows(client,token,"produtos",{"id":f"eq.{item.get('produto_id')}","select":"*","limit":"1"})
            product=prod_rows[0] if prod_rows else {}
            item["produto"]=product
            item["unidades_por_conjunto"]=link.get("unidades_por_conjunto")
            items.append(item)
            photo_path=product.get("foto_principal_path")
            if photo_path:
                try:
                    data=await storage_download(client,token,"produto-fotos",photo_path)
                    product_photos.append({"bytes":data,"caption":f"Foto principal - {product.get('sku') or ''} {product.get('nome') or ''}".strip()})
                except HTTPException:
                    pass

        checklist,check_results,dim_params,dim_configs,dim_results,tests,test_results,photo_rows=await __import__("asyncio").gather(
            table_rows(client,token,"it_checklist",{"it_versao_id":f"eq.{version_id}","ativo":"eq.true","select":"*","order":"ordem.asc"}),
            table_rows(client,token,"inspecao_checklist_resultados",{"inspecao_id":f"eq.{inspection_id}","select":"*"}),
            table_rows(client,token,"it_parametros_dimensionais",{"it_versao_id":f"eq.{version_id}","ativo":"eq.true","select":"*","order":"ordem.asc"}),
            table_rows(client,token,"inspecao_dimensional_configuracoes",{"inspecao_id":f"eq.{inspection_id}","select":"*"}),
            table_rows(client,token,"inspecao_dimensionais",{"inspecao_id":f"eq.{inspection_id}","select":"*","order":"sequencia_amostra.asc"}),
            table_rows(client,token,"it_testes_especiais",{"it_versao_id":f"eq.{version_id}","ativo":"eq.true","select":"*","order":"ordem.asc"}),
            table_rows(client,token,"inspecao_testes_resultados",{"inspecao_id":f"eq.{inspection_id}","select":"*"}),
            table_rows(client,token,"inspecao_fotos",{"inspecao_id":f"eq.{inspection_id}","select":"*","order":"criado_em.asc"}),
        )

        inspector_name=""
        if inspection.get("responsavel_id"):
            pr=await table_rows(client,token,"profiles",{"id":f"eq.{inspection.get('responsavel_id')}","select":"nome","limit":"1"})
            if pr: inspector_name=pr[0].get("nome") or ""

        photos=[]
        seen=set()
        for p in photo_rows:
            path=p.get("storage_path")
            if not path or path in seen: continue
            seen.add(path)
            try:
                data=await storage_download(client,token,"inspecao-fotos",path)
                photos.append({"bytes":data,"caption":p.get("legenda") or ""})
            except HTTPException:
                pass
        if not photos:
            photos.extend(product_photos)

        payload={
            "inspection":inspection,
            "process":process,
            "group":group,
            "items":items,
            "checklist":checklist,
            "check_results":check_results,
            "dim_params":dim_params,
            "dim_configs":dim_configs,
            "dim_results":dim_results,
            "tests":tests,
            "test_results":test_results,
            "photos":photos,
            "inspector_name":inspector_name,
        }
        docx=generate_inspection(template_bytes,payload)
        filename=inspection_file_name(process.get("codigo"),inspection.get("numero"))
        storage_path=f"{inspection_id}/{filename}"
        await storage_upload(
            client,token,"laudos",storage_path,docx,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )

        now=datetime.now(timezone.utc).isoformat()
        existing=await table_rows(client,token,"laudos",{"inspecao_id":f"eq.{inspection_id}","select":"id","limit":"1"})
        report_payload={
            "inspecao_id":inspection_id,
            "numero":inspection.get("numero"),
            "storage_path":storage_path,
            "gerado_em":now,
        }
        if existing:
            r=await client.patch(
                f"{SUPABASE_URL}/rest/v1/laudos",
                headers={**rest_headers(token),"Prefer":"return=minimal"},
                params={"id":f"eq.{existing[0]['id']}"},
                json=report_payload,
            )
        else:
            r=await client.post(
                f"{SUPABASE_URL}/rest/v1/laudos",
                headers={**rest_headers(token),"Prefer":"return=minimal"},
                json=report_payload,
            )
        if r.status_code>=300:
            raise HTTPException(status_code=502,detail=f"Falha ao registrar laudo: {r.text[:240]}")

        await client.patch(
            f"{SUPABASE_URL}/rest/v1/inspecoes",
            headers={**rest_headers(token),"Prefer":"return=minimal"},
            params={"id":f"eq.{inspection_id}"},
            json={"documento_gerado_em":now},
        )

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
