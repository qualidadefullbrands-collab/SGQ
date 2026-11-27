import base64, io, os, pathlib, subprocess, tempfile, time, zipfile
from docx import Document
from docx.oxml.ns import qn
from docx.shared import Inches
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
PNG=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg1sAAAAASUVORK5CYII=")
def table(doc,values):
    t=doc.add_table(rows=len(values),cols=max(map(len,values)))
    for i,row in enumerate(values):
        if len(row)==1:
            t.cell(i,0).merge(t.cell(i,len(t.columns)-1)).text=row[0]
        else:
            for j,value in enumerate(row):t.cell(i,j).text=str(value)
            if len(row)==2 and len(t.columns)==4:
                t.cell(i,1).merge(t.cell(i,3))
    return t
def make_fixture(path):
    d=Document()
    d.sections[0].header.paragraphs[0].text="CADERNO QA — IT MODELO"
    d.sections[0].footer.paragraphs[0].text="RODAPÉ QA"
    d.add_paragraph("OBJETIVO — CADERNO ÚNICO")
    for ref,sku in [("FSTQA-A","QA01"),("FSTQA-A","QA02"),("FSTQA-B","QA03")]:
        d.add_page_break()
        d.add_paragraph("REGISTRO DE INSPEÇÃO")
        table(d,[["IDENTIFICAÇÃO"],["Produto / descrição","Produto de teste ("+sku+")","Código do cliente",sku],["Cliente","Cliente QA","Processo FST",ref],["Nota fiscal","QA-NF","Lote","QA-LOTE"],["Material","Papel","Capacidade","NA"],["Origem","Brasil","Transporte","Rodoviário"],["Quantidade recebida","1.000 un.","Quantidade por caixa","100 un."],["Nº de caixas recebidas","10","Chegada no CD","23/11/2026"],["Data da inspeção","26/11/2026"]])
        table(d,[["PLANO DE AMOSTRAGEM – ABNT NBR 5426"],["Nível de inspeção","Nível I — NQA 1,5%"],["Quantidade amostrada","32 unidades","Caixas avaliadas","4 caixas"]])
        table(d,[["Tamanho do lote","Amostra","Ac / Re"],["501 – 1.200 unidades","32","2 / 3"],["1.201 – 3.200 unidades","50","2 / 3"]])
        table(d,[["Caixas recebidas","7 – 12","13 – 20"],["Caixas a avaliar","4","5"]])
        table(d,[["VERIFICAÇÕES"],["Nº","Análise","Tipo de teste","C","NC","NA"],["1","Integridade","Visual","X","",""],["2","Funcional","Funcional","","","X"]])
        table(d,[["RESULTADO DA INSPEÇÃO"],["Resultado final","( X ) APROVADO ( ) REPROVADO"],["Inspecionado por","Inspetor QA","Data","26/11/2026"],["Responsável Técnico (nome/CRF)","RT QA"],["Observação / conclusão","Inspeção conforme nos itens aplicáveis. Itens 2: NA (Não aplicável). Recebidas 1.000 un.; 10 un. destinadas à retenção, restando 990 un."]])
        t=table(d,[["FOTOS DA INSPEÇÃO – SKU "+sku],["Evidência QA"]])
        # single-column table can contain a normal image run.
        t.cell(1,0).paragraphs[0].add_run().add_picture(io.BytesIO(PNG),width=Inches(.5))
    d.save(path)
def rows(t):return [[c.text for c in r.cells] for r in t.rows]
def main():
  with tempfile.TemporaryDirectory() as tmp:
    p=pathlib.Path(tmp);source=p/"qa.docx";make_fixture(source)
    server=subprocess.Popen(["python","-m","http.server","8765","--bind","127.0.0.1","--directory",str(ROOT/"preview-operacional")],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
      time.sleep(.8)
      with sync_playwright() as w:
        browser=w.chromium.launch()
        page=browser.new_page(accept_downloads=True)
        errors=[];page.on("pageerror",lambda e:errors.append(str(e)))
        page.on("dialog",lambda d:d.accept())
        page.goto("http://127.0.0.1:8765")
        page.locator("#source").set_input_files(source)
        page.get_by_role("heading",name="Conferir os produtos").wait_for(timeout=15000)
        assert page.get_by_text("32",exact=True).count()==3
        assert page.get_by_text("2 / 3",exact=True).count()==3
        page.get_by_role("button",name="Iniciar inspeção").click()
        page.get_by_role("button",name="Reproduzir original").click()
        assert page.get_by_role("button",name="QA01 item 1 C",exact=True).get_attribute("aria-pressed")=="true"
        page.get_by_role("button",name="QA02 item 1 NC",exact=True).click()
        page.locator('textarea[data-id="1"]').fill("Falha no teste QA")
        page.locator('input[data-field="retention"][data-id="1"]').fill("20")
        page.locator('select[data-field="decision"][data-id="1"]').select_option("reprovado")
        page.get_by_role("button",name="Conferir laudo").click()
        page.get_by_role("button",name="Gerar Word (.docx)").wait_for()
        assert page.get_by_role("button",name="Gerar Word (.docx)").is_enabled(), page.locator("main").inner_text()
        with page.expect_download() as event:page.get_by_role("button",name="Gerar Word (.docx)").click()
        out=p/"gerado.docx";event.value.save_as(out)
        browser.close()
        assert not errors,errors
      with zipfile.ZipFile(source) as a,zipfile.ZipFile(out) as b:
        assert b.testzip() is None
        assert set(a.namelist())==set(b.namelist())
        for name in a.namelist():
          if name!="word/document.xml":assert a.read(name)==b.read(name),name
      d=Document(out)
      assert sum(x.text=="OBJETIVO — CADERNO ÚNICO" for x in d.paragraphs)==1
      assert sum(x.text=="REGISTRO DE INSPEÇÃO — TESTE" for x in d.paragraphs)==3
      assert len(d.inline_shapes)==3
      identities=[t for t in d.tables if t.cell(0,0).text=="IDENTIFICAÇÃO"]
      assert [t.cell(2,3).text for t in identities]==["FSTQA-A","FSTQA-A","FSTQA-B"]
      checks=[t for t in d.tables if t.cell(0,0).text=="VERIFICAÇÕES"]
      assert checks[0].cell(2,3).text=="X" and checks[1].cell(2,4).text=="X"
      results=[t for t in d.tables if t.cell(0,0).text=="RESULTADO DA INSPEÇÃO"]
      assert "( X ) APROVADO" in results[0].cell(1,1).text
      assert "( X ) REPROVADO" in results[1].cell(1,1).text
      assert "980 un." in results[1].cell(4,1).text and "Falha no teste QA" in results[1].cell(4,1).text
      assert "( X ) APROVADO" in results[2].cell(1,1).text
      print("PASS — browser, DOCX valid, independent decisions, same A and separate B, one caderno, original photos preserved.")
    finally:server.terminate();server.wait()
if __name__=="__main__":main()
