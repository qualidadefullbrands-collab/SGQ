from __future__ import annotations
from io import BytesIO
from typing import Any
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml.ns import qn
from PIL import Image
import re

def fmt_date(value: str | None) -> str:
    if not value: return ""
    p=str(value)[:10].split("-")
    return f"{p[2]}/{p[1]}/{p[0]}" if len(p)==3 else str(value)

def pct(n:int,d:int):
    return round((n/d)*100,1) if d else None

def fmt_pct(v):
    return "" if v is None else f"{v:.1f}%".replace(".",",")

def classify(v):
    if v is None: return ""
    if v < 60: return "Insatisfatório"
    if v < 75: return "Regular"
    if v < 80: return "Bom"
    return "Excelente"

def clear_paragraph(p):
    for child in list(p._p):
        if child.tag != qn("w:pPr"): p._p.remove(child)

def set_font(run,size=8,bold=False):
    run.font.name="Calibri"
    if run._element.rPr is None: run._element.get_or_add_rPr()
    run._element.rPr.rFonts.set(qn("w:eastAsia"),"Calibri")
    run.font.size=Pt(size)
    run.bold=bold

def set_cell(cell,text:Any,size=8,bold=False,center=False):
    text="" if text is None else str(text)
    p=cell.paragraphs[0] if cell.paragraphs else cell.add_paragraph()
    clear_paragraph(p)
    r=p.add_run(text); set_font(r,size,bold)
    if center: p.alignment=WD_ALIGN_PARAGRAPH.CENTER
    cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
    for p2 in list(cell.paragraphs[1:]):
        p2._element.getparent().remove(p2._element)

def add_row(table,values,size=7.5):
    row=table.add_row()
    for i,v in enumerate(values):
        if i < len(row.cells): set_cell(row.cells[i],v,size)
    return row

def photo_bytes(source):
    return source if isinstance(source,(bytes,bytearray)) else None

def add_photo(cell,data:bytes,caption:str,width=1.75):
    im=Image.open(BytesIO(data)); im.thumbnail((1100,800))
    out=BytesIO(); im.convert("RGB").save(out,format="JPEG",quality=84); out.seek(0)
    for p in list(cell.paragraphs):
        p._element.getparent().remove(p._element)
    p=cell.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(out,width=Inches(width))
    cap=cell.add_paragraph(); cap.alignment=WD_ALIGN_PARAGRAPH.LEFT
    r=cap.add_run(caption); set_font(r,7)

def fill_photos(table,photos,max_photos):
    for idx,item in enumerate(photos[:max_photos]):
        data=photo_bytes(item.get("bytes"))
        if not data: continue
        add_photo(table.cell(idx//3,idx%3),data,f"Foto {idx+1}: {str(item.get('caption') or '').strip()}")

def c_count(a): return sum(1 for x in a if x.get("resultado")=="C")
def nc_count(a): return sum(1 for x in a if x.get("resultado")=="NC")
def na_count(a): return sum(1 for x in a if x.get("resultado")=="NA")

def road(local):
    s=str(local or "").strip()
    m=re.search(r"\bRua\s*([0-9]{1,3})\b",s,re.I)
    return f"Rua {m.group(1).zfill(2)}" if m else s

def generate_rq016(doc,p):
    ex=p["execution"]; a=p.get("answers") or []; f=p.get("findings") or []
    t0,t1,t2,t3,t4,t5,t6=doc.tables
    set_cell(t0.cell(0,1),fmt_date(ex.get("data_avaliacao"))); set_cell(t0.cell(0,3),ex.get("responsavel_nome",""))
    c,nc,na=c_count(a),nc_count(a),na_count(a); note=pct(c,c+nc)
    for i,v in enumerate([c,nc,na,fmt_pct(note),classify(note)]): set_cell(t1.cell(1,i),v,bold=True,center=True)
    bykey={str(x.get("item_key")):x for x in a}
    for rowx in t2.rows[1:]:
        k=rowx.cells[0].text.strip()
        if k.isdigit() and k in bykey: set_cell(rowx.cells[2],bykey[k].get("resultado",""),bold=True,center=True)
    for i,x in enumerate(f,1): add_row(t3,[i,x.get("descricao_tecnica") or x.get("descricao_original",""),x.get("acao_corretiva",""),x.get("responsavel",""),fmt_date(x.get("prazo")),x.get("status","Pendente")])
    for i,x in enumerate(p.get("previous") or [],1): add_row(t4,[i,x.get("descricao",""),fmt_date(x.get("aberta_em")),x.get("situacao",""),x.get("status","")])
    fill_photos(t5,p.get("photos") or [],18)
    set_cell(t6.cell(1,0),ex.get("responsavel_nome","")); set_cell(t6.cell(1,1),ex.get("validado_por","")); set_cell(t6.cell(1,2),fmt_date(ex.get("data_validacao")))

def generate_rq016b(doc,p):
    ex=p["execution"]; a=p.get("answers") or []; f=p.get("findings") or []
    t0,t1,_,_,_,t5,t6,t7=doc.tables
    set_cell(t0.cell(0,1),fmt_date(ex.get("data_avaliacao"))); set_cell(t0.cell(0,3),ex.get("mes_referencia",""))
    set_cell(t0.cell(1,1),ex.get("responsavel_nome",""))
    locs=sorted({str(x.get("local_ref") or "").strip() for x in a if x.get("local_ref")}); set_cell(t0.cell(1,3),", ".join(locs),7.5)
    def area(k):
        k=str(k or "")
        return "Ruas" if k.startswith("R") else "Checkouts" if k.startswith("C") else "Docas" if k.startswith("D") else ""
    areas={x:[] for x in ["Ruas","Checkouts","Docas"]}
    for x in a:
        ar=area(x.get("item_key"))
        if ar: areas[ar].append(x)
    def score(items):
        c=sum(1 for x in items if x.get("resultado")=="C"); nc=sum(1 for x in items if x.get("resultado")=="NC")
        return pct(c,c+nc)
    total=score(a)
    vals=[fmt_pct(total),fmt_pct(score(areas["Ruas"])),fmt_pct(score(areas["Checkouts"])),fmt_pct(score(areas["Docas"])),classify(total)]
    for i,v in enumerate(vals): set_cell(t1.cell(1,i),v,bold=True,center=True)
    byloc={}
    for x in a: byloc.setdefault(x.get("local_ref",""),[]).append(x)
    for loc,items in sorted(byloc.items()):
        ncs=[str(x.get("item_key")) for x in items if x.get("resultado")=="NC"]
        obs="; ".join([str(x.get("observacao") or "") for x in items if x.get("resultado")=="NC" and x.get("observacao")])[:260]
        add_row(t5,[area(items[0].get("item_key")) if items else "",loc,fmt_pct(score(items)),", ".join(ncs),obs])
    for x in f: add_row(t6,[x.get("local_ref") or x.get("endereco",""),x.get("descricao_tecnica") or x.get("descricao_original",""),x.get("acao_corretiva",""),x.get("responsavel",""),fmt_date(x.get("prazo")),x.get("status","Pendente")])
    set_cell(t7.cell(1,0),ex.get("responsavel_nome","")); set_cell(t7.cell(1,1),ex.get("validado_por","")); set_cell(t7.cell(1,2),fmt_date(ex.get("data_validacao")))

def generate_rq015(doc,p):
    ex=p["execution"]; a=p.get("answers") or []; f=p.get("findings") or []
    t0,t1,_,_,t4,t5,t6,t7,t8,t9=doc.tables
    set_cell(t0.cell(0,1),fmt_date(ex.get("data_avaliacao"))); set_cell(t0.cell(0,3),ex.get("mes_referencia",""))
    set_cell(t0.cell(1,1),ex.get("responsavel_nome","")); set_cell(t0.cell(1,3),ex.get("documento_vinculado",""))
    roads=sorted({road(x.get("local_ref")) for x in a if x.get("local_ref")} | {road(x.get("local_ref")) for x in f if x.get("local_ref")})
    risks={"verde":0,"amarelo":0,"vermelho":0}
    for x in f:
        r=str(x.get("risco") or "").lower()
        if r in risks: risks[r]+=1
    for i,v in enumerate([len(roads),len(f),risks["verde"],risks["amarelo"],risks["vermelho"],risks["vermelho"]]): set_cell(t1.cell(1,i),v,bold=True,center=True)
    byroad={r:[] for r in roads}
    for x in a:
        r=road(x.get("local_ref"))
        if r: byroad.setdefault(r,[]).append(x)
    for r in roads:
        aa=byroad.get(r,[]); ncs=[x for x in aa if x.get("resultado")=="NC"]
        result="Não conforme" if ncs else ("Conforme" if aa else "")
        count=sum(1 for x in f if road(x.get("local_ref"))==r)
        obs="; ".join([str(x.get("observacao") or "") for x in ncs if x.get("observacao")])[:300]
        add_row(t4,[r,result,count,obs])
    for i,x in enumerate(f,1):
        add_row(t5,[i,x.get("endereco") or x.get("local_ref",""),", ".join(x.get("criterios") or []),x.get("descricao_tecnica") or x.get("descricao_original",""),str(x.get("risco") or "").capitalize(),x.get("acao_imediata",""),x.get("status","Pendente")])
        if x.get("acao_corretiva") or x.get("responsavel") or x.get("prazo"):
            meta=x.get("metadata") or {}
            add_row(t6,[i,x.get("acao_corretiva",""),x.get("responsavel",""),fmt_date(x.get("prazo")),meta.get("os_rq030",""),meta.get("conclusao","")])
    for x in p.get("previous") or []: add_row(t7,[x.get("endereco",""),x.get("descricao",""),fmt_date(x.get("aberta_em")),x.get("situacao",""),x.get("status","")])
    fill_photos(t8,p.get("photos") or [],24)
    set_cell(t9.cell(1,0),ex.get("responsavel_nome","")); set_cell(t9.cell(1,1),ex.get("validado_por","")); set_cell(t9.cell(1,2),fmt_date(ex.get("data_validacao")))

def generate_rq014(doc,p):
    ex=p["execution"]; f=p.get("findings") or []; objects=p.get("objects") or []
    t0,t1,_,t3,_,t5,t6,t7,t8,t9=doc.tables
    set_cell(t0.cell(0,1),fmt_date(ex.get("data_avaliacao"))); set_cell(t0.cell(0,3),ex.get("mes_referencia",""))
    set_cell(t0.cell(1,1),ex.get("responsavel_nome","")); set_cell(t0.cell(1,3),ex.get("documento_vinculado",""))
    lib=sum(1 for x in objects if str(x.get("status") or "").lower()=="liberado"); pend=sum(1 for x in objects if str(x.get("status") or "").lower()=="pendente"); bloq=sum(1 for x in objects if str(x.get("status") or "").lower()=="bloqueado")
    for i,v in enumerate([len(objects),lib,pend,bloq,fmt_pct(pct(lib,len(objects)))]): set_cell(t1.cell(1,i),v,bold=True,center=True)
    ext=[x for x in objects if x.get("objeto_tipo")=="extintor"]; hid=[x for x in objects if x.get("objeto_tipo")=="hidrante"]
    for i,x in enumerate(ext,1):
        d=x.get("dados") or {}; add_row(t3,[i,x.get("identificacao",""),x.get("local_ref",""),d.get("tipo_capacidade",""),d.get("recarga_ate",""),d.get("hidro_ate",""),", ".join(x.get("criterios_nc") or []),str(x.get("status") or "").capitalize(),d.get("os_rq030","")])
    for i,x in enumerate(hid,1):
        d=x.get("dados") or {}; add_row(t5,[i,x.get("identificacao",""),x.get("local_ref",""),d.get("mangueira",""),", ".join(x.get("criterios_nc") or []),str(x.get("status") or "").capitalize(),d.get("os_rq030","")])
    for x in f:
        meta=x.get("metadata") or {}; add_row(t6,[x.get("endereco") or x.get("local_ref",""),x.get("descricao_tecnica") or x.get("descricao_original",""),x.get("acao_corretiva",""),x.get("responsavel",""),fmt_date(x.get("prazo")),meta.get("os_rq030",""),x.get("status","Pendente")])
    for x in p.get("previous") or []: add_row(t7,[x.get("item",""),x.get("descricao",""),fmt_date(x.get("aberta_em")),x.get("situacao",""),x.get("status","")])
    fill_photos(t8,p.get("photos") or [],18)
    set_cell(t9.cell(1,0),ex.get("responsavel_nome","")); set_cell(t9.cell(1,1),ex.get("validado_por","")); set_cell(t9.cell(1,2),fmt_date(ex.get("data_validacao")))

def generate(template_bytes:bytes,payload:dict)->bytes:
    doc=Document(BytesIO(template_bytes)); rq=payload["execution"]["rq_code"]
    {"RQ014":generate_rq014,"RQ015":generate_rq015,"RQ016":generate_rq016,"RQ016B":generate_rq016b}[rq](doc,payload)
    out=BytesIO(); doc.save(out); return out.getvalue()

MONTHS=["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"]
def file_name(rq:str,date_raw:str)->str:
    from datetime import date
    d=date.fromisoformat(str(date_raw)[:10]); month=MONTHS[d.month-1]
    if rq=="RQ014": return f"RQ 014 - {month}.{d.year}.docx"
    if rq=="RQ015": return f"RQ 015 - {month}.docx"
    if rq=="RQ016": return f"RQ 016 - Avaliação 5S {d.day:02d}.{d.month:02d}.{d.year}.docx"
    return f"Avaliação Pré Avaliação 5S - {month.capitalize()}.{d.year}.docx"
