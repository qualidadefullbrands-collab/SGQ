from __future__ import annotations
import io
import re
import unittest
from pathlib import Path
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches
from docx.oxml.ns import qn
from PIL import Image
from server.docx_generator import (
    add_photo, emphasize_sampling_tables, fst_code, generate_inspection,
    inspection_file_name, whole_number, dimensional_evaluations,
    format_dimensional_mean, append_filled_inspection_form,
)

ROOT=Path(__file__).resolve().parents[1]

def sample_payload():
    return {
        "inspection":{
            "numero":"INS-2026-XXX","status":"concluida","resultado":"aprovado",
            "nivel_inspecao":"II","tamanho_lote":1025,"tamanho_amostra":32.0,
            "codigo_amostragem":"J","total_inspecionado":32.0,
            "total_nao_conforme":0.0,"caixas_recebidas":1.0,
            "caixas_avaliar":1.0,"data_inspecao":"2026-11-04",
            "observacoes":"Lote aprovado sem não conformidades."
        },
        "process":{
            "codigo":"26169-A","cliente":"LOS BEAUTY LTDA","origem":"",
            "nota_fiscal":"","transporte":"","chegada_cd":"2026-11-02"
        },
        "items":[{
            "id":"item-1","produto":{"sku":"SKU1234","nome":"PÓ COMPACTO"},
            "lote":"LOTE-X","material":"","capacidade":"8,5 g",
            "quantidade":1025.0,"quantidade_por_caixa":1000.0,"caixas_recebidas":1.0
        }],
        "checklist":[],"check_results":[],"dim_params":[],"dim_configs":[],
        "dim_results":[],"tests":[],"test_results":[],"photos":[],
        "inspector_name":"Responsável por inspeção"
    }

class InspectionWordTests(unittest.TestCase):
    def test_fst_prefix_and_requested_filename(self):
        self.assertEqual(fst_code("26169-A"),"FST26169-A")
        self.assertEqual(fst_code("FST26169-A"),"FST26169-A")
        self.assertEqual(
            inspection_file_name("26169-A","SKU1234","PÓ COMPACTO"),
            "FST26169-A . SKU1234 PÓ COMPACTO.docx"
        )
        self.assertNotIn("/",
            inspection_file_name("FST26169-A","SKU/1234","PRODUTO: TESTE"))
        self.assertEqual(
            inspection_file_name("26169-A","SKU1234","PÓ COMPACTO","Cushion 5 peças"),
            "FST26169-A . Conjunto Cushion 5 peças.docx"
        )
    def test_operational_integer_fields_do_not_show_decimals(self):
        for value,expected in [
            (32.0,"32"),("32,0","32"),("32.000","32"),
            (1000.0,"1000"),(0.0,"0"),(None,"–"),("", "–")
        ]:
            with self.subTest(value=value):
                self.assertEqual(whole_number(value),expected)

    def test_exact_lot_and_box_sampling_rows_are_highlighted(self):
        doc=Document()
        first=doc.add_table(rows=1,cols=3)
        first.rows[0].cells[0].text="Tamanho do lote"
        first.rows[0].cells[1].text="Código de inspeção"
        first.rows[0].cells[2].text="Plano"
        for lot,code in [("51 a 90","F"),("91 a 150","G"),("151 a 280","H")]:
            cells=first.add_row().cells
            cells[0].text=lot
            cells[1].text=code
            cells[2].text="Normal"
        boxes=doc.add_table(rows=1,cols=2)
        boxes.rows[0].cells[0].text="Caixas recebidas"
        boxes.rows[0].cells[1].text="Caixas a avaliar"
        for left,right in [("1 a 5","1"),("6 a 10","2"),("11 a 20","3")]:
            c=boxes.add_row().cells;c[0].text=left;c[1].text=right
        emphasize_sampling_tables(doc,{
            "tamanho_lote":100,"codigo_amostragem":"G",
            "caixas_recebidas":7,"caixas_avaliar":2
        })
        def marked(cell):
            pr=cell._tc.get_or_add_tcPr()
            return pr.find("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}shd") is not None
        self.assertFalse(marked(first.cell(1,0)))
        self.assertTrue(marked(first.cell(2,0)))
        self.assertTrue(marked(first.cell(2,1)))
        self.assertFalse(marked(first.cell(3,0)))
        self.assertFalse(marked(boxes.cell(1,0)))
        self.assertTrue(marked(boxes.cell(2,0)))
        self.assertTrue(marked(boxes.cell(2,1)))
        self.assertFalse(marked(boxes.cell(3,0)))

    def test_horizontal_box_sampling_marks_only_the_selected_column(self):
        doc=Document()
        boxes=doc.add_table(rows=2,cols=9)
        headers=["Caixas recebidas","1","2","3 – 6","7 – 12","13 – 20",
                 "21 – 30","31 – 42","43 – 56"]
        values=["Caixas a avaliar","1","2","3","4","5","6","7","8"]
        for idx,value in enumerate(headers):boxes.cell(0,idx).text=value
        for idx,value in enumerate(values):boxes.cell(1,idx).text=value
        payload=sample_payload()
        payload["inspection"].update({"caixas_recebidas":15,"caixas_avaliar":5})
        temp=io.BytesIO();doc.save(temp)
        word=generate_inspection(temp.getvalue(),payload)
        result=Document(io.BytesIO(word))
        table=result.tables[0]
        self.assertEqual(table.cell(0,1).text,"1")  # Reference range, not inspection's 15
        self.assertEqual(table.cell(0,5).text,"13 – 20")
        for row in (0,1):
            for col in range(9):
                marked=table.cell(row,col)._tc.get_or_add_tcPr().find(
                    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}shd") is not None
                self.assertEqual(marked,col==5,(row,col))

    def test_summary_boxes_evaluated_background_is_neutral(self):
        doc=Document()
        summary=doc.add_table(rows=2,cols=4)
        for idx,value in enumerate(["Quantidade amostrada","32","Caixas avaliadas","10"]):
            summary.cell(1,idx).text=value
        emphasize_sampling_tables(doc,{"caixas_recebidas":15,"caixas_avaliar":5})
        self.assertIsNone(summary.cell(1,3)._tc.get_or_add_tcPr().find(
            "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}shd"))

    def test_all_photos_are_exported_three_per_row(self):
        doc=Document()
        photos_table=doc.add_table(rows=2,cols=3)
        photos_table.cell(0,0).text="FOTOS"
        images=[]
        for idx in range(13):
            photo=Image.new("RGB",(1400,800),(80+idx,110,150))
            buff=io.BytesIO();photo.save(buff,format="PNG")
            images.append({"bytes":buff.getvalue(),"caption":""})
        payload=sample_payload()
        payload["photos"]=images
        temp=io.BytesIO();doc.save(temp)
        output=generate_inspection(temp.getvalue(),payload)
        result=Document(io.BytesIO(output))
        self.assertEqual(len(result.inline_shapes),13)
        self.assertGreaterEqual(len(result.tables[0].rows),5)
        self.assertGreater(result.inline_shapes[0].width,Inches(2))
        self.assertEqual([len(row.cells) for row in result.tables[0].rows[:5]],[3]*5)

    def test_same_size_images_and_centered_captions(self):
        doc=Document()
        table=doc.add_table(rows=1,cols=2)
        shapes=[]
        for idx,dimensions in enumerate([(1500,500),(500,1500)]):
            im=Image.new("RGB",dimensions,(100,140,180))
            buf=io.BytesIO();im.save(buf,format="PNG")
            add_photo(table.cell(0,idx),buf.getvalue(),f"Legenda {idx+1}",fixed_frame=True)
            shapes.append(table.cell(0,idx).paragraphs[0].runs[0]._r)
            self.assertEqual(table.cell(0,idx).paragraphs[1].alignment,WD_ALIGN_PARAGRAPH.CENTER)
        out=io.BytesIO();doc.save(out)
        restored=Document(io.BytesIO(out.getvalue()))
        pics=restored.inline_shapes
        self.assertEqual(len(pics),2)
        self.assertEqual(pics[0].width,pics[1].width)
        self.assertEqual(pics[0].height,pics[1].height)

    def test_multi_sku_client_codes_are_one_per_line(self):
        payload=sample_payload()
        payload["items"].extend([
            {"id":"item-2","produto":{"sku":"SKU5678","nome":"PEÇA B"},"quantidade":28},
            {"id":"item-3","produto":{"sku":"SKU1234","nome":"MESMA REFERÊNCIA"},"quantidade":10}
        ])
        for name in ("IT001.docx","IT008.docx"):
            with self.subTest(name=name):
                word=generate_inspection((ROOT/"templates"/name).read_bytes(),payload)
                document=Document(io.BytesIO(word))
                values=[c.text for t in document.tables for r in t.rows for c in r.cells]
                self.assertIn("SKU1234\nSKU5678",values)
                self.assertNotIn("SKU1234\nSKU5678\nSKU1234",values)
                self.assertIn("SKU1234 — 1035\nSKU5678 — 28",values)
                self.assertIn("SKU1234 — PÓ COMPACTO\nSKU5678 — PEÇA B",values)
                self.assertIn("SKU1234 — 1000\nSKU5678 — –",values)

    def test_all_official_it_templates_remain_generatable(self):
        paths=list((ROOT/"templates").glob("IT*.docx"))
        self.assertGreaterEqual(len(paths),8)
        for path in paths:
            with self.subTest(template=path.name):
                rendered=generate_inspection(path.read_bytes(),sample_payload())
                self.assertGreater(len(rendered),1500)
                doc=Document(io.BytesIO(rendered))
                values=[cell.text for table in doc.tables for row in table.rows for cell in row.cells]
                self.assertIn("FST26169-A",values,path.name)
                self.assertIn("SKU1234",values,path.name)
                matching=[
                    cell for table in doc.tables for row in table.rows for cell in row.cells
                    if cell.text in ("FST26169-A","SKU1234")
                ]
                self.assertTrue(all(
                    any(run.bold and run.font.color.rgb is not None for p in c.paragraphs for run in p.runs)
                    for c in matching
                ))
                self.assertNotIn("32.0"," ".join(values))
                self.assertNotIn("1000.0"," ".join(values))
                # Official documents can be reopened as a normal Word package.
                reloaded=io.BytesIO()
                doc.save(reloaded)
                self.assertGreater(len(reloaded.getvalue()),1500)

    def test_no_tolerance_approves_by_mean_and_keeps_na_excluded(self):
        items=[{"id":"item-A","produto":{"sku":"SKU-A"}}]
        params=[{"id":"peso","nome":"Peso","unidade":"g"},
                {"id":"diametro","nome":"Diâmetro externo","unidade":"mm"}]
        configs=[{"processo_item_id":"item-A","parametro_id":"diametro","nao_aplicavel":True},
                 {"processo_item_id":"item-A","parametro_id":"peso",
                  "minimo_aceitavel":None,"maximo_aceitavel":None}]
        readings=[{"processo_item_id":"item-A","parametro_id":"peso",
                   "sequencia_amostra":i,"valor":95.1 if i in (1,2,3) else 95,
                   "conforme":None} for i in range(1,11)]
        result=dimensional_evaluations(items,params,configs,readings)
        self.assertEqual(result[0]["status"],"aprovado_media")
        self.assertEqual(result[0]["quantidade"],10)
        self.assertEqual(format_dimensional_mean(result[0]["media"]),"95,03")
        self.assertEqual(result[1]["status"],"nao_aplicavel")
        fewer=dimensional_evaluations(items,params,configs,readings[:-1])
        self.assertEqual(fewer[0]["status"],"pendente")
        limited=[{"processo_item_id":"item-A","parametro_id":"peso",
                  "minimo_aceitavel":90,"maximo_aceitavel":95}]
        outside=dimensional_evaluations(items,params,limited,readings)
        self.assertEqual(outside[0]["status"],"reprovado")
        within=dimensional_evaluations(items,params,limited,[dict(r,valor=94) for r in readings])
        self.assertEqual(within[0]["status"],"aprovado")

    def test_dimensionals_are_separate_for_each_measured_sku(self):
        payload=sample_payload()
        payload["group"]={"subprocesso_codigo":"A"}
        payload["process"]["codigo"]="26125"
        payload["items"].append({
            "id":"item-2","produto":{"sku":"SKU5678","nome":"COMPONENTE B"},
            "quantidade":250,"quantidade_por_caixa":25,"caixas_recebidas":10
        })
        payload["dim_params"]=[
            {"id":"peso","nome":"Peso","unidade":"g"},
            {"id":"altura","nome":"Tamanho externo (altura)","unidade":"mm"},
            {"id":"espessura","nome":"Espessura da parede","unidade":"mm"},
        ]
        payload["dim_configs"]=[
            {"processo_item_id":"item-1","parametro_id":"espessura","nao_aplicavel":True},
            {"processo_item_id":"item-2","parametro_id":"espessura","nao_aplicavel":True},
        ]
        payload["dim_results"]=[
            {"processo_item_id":"item-1","parametro_id":"peso",
             "sequencia_amostra":i,"valor":81,"unidade":"g","conforme":None}
            for i in range(1,11)
        ] + [
            {"processo_item_id":"item-2","parametro_id":"altura",
             "sequencia_amostra":i,"valor":70,"unidade":"mm","conforme":None}
            for i in range(1,11)
        ]
        template=(ROOT/"templates"/"IT001.docx").read_bytes()
        doc=Document(io.BytesIO(generate_inspection(template,payload)))
        dimension_tables=[table for table in doc.tables if any(
            "Componente / SKU" in cell.text for row in table.rows for cell in row.cells)]
        if len(dimension_tables)!=2:
            print("DIMDBG",[(idx,len(t.rows),len(t.columns),
                [str(c.text)[:45] for row in t.rows[:3] for c in row.cells[:3]])
                for idx,t in enumerate(doc.tables) if any(
                    "dimens" in str(c.text).lower() or "componente" in str(c.text).lower()
                    for row in t.rows[:3] for c in row.cells)])
        self.assertEqual(len(dimension_tables),2)
        first=" ".join(cell.text for row in dimension_tables[0].rows for cell in row.cells)
        second=" ".join(cell.text for row in dimension_tables[1].rows for cell in row.cells)
        self.assertIn("SKU1234",first)
        self.assertIn("81 g",first)
        self.assertNotIn("SKU5678",first)
        self.assertNotIn("Tamanho externo (altura)",first)
        self.assertIn("SKU5678",second)
        self.assertIn("70 mm",second)
        self.assertNotIn("SKU1234",second)
        self.assertNotIn("Peso",second)
        self.assertNotIn("Espessura da parede",first+second)
        all_text=" ".join(cell.text for table in doc.tables for row in table.rows for cell in row.cells)
        self.assertNotIn("RESUMO DIMENSIONAL",all_text)
        self.assertIn("FST26125-A",all_text)

    def test_completed_subprocess_uses_full_official_inspection_form(self):
        template=(ROOT/"templates"/"IT001.docx").read_bytes()
        a=sample_payload()
        a["process"]["codigo"]="26125"
        a["group"]={"subprocesso_codigo":"A"}
        b=sample_payload()
        b["process"]["codigo"]="26125"
        b["group"]={"subprocesso_codigo":"B"}
        b["inspection"]["numero"]="INS-26125-B"
        b["items"][0]["produto"]["sku"]="SKU-B"
        b["items"][0]["produto"]["nome"]="COMPONENTE B"
        doc=Document(io.BytesIO(generate_inspection(template,a)))
        append_filled_inspection_form(doc,generate_inspection(template,b))
        values=" ".join(cell.text for table in doc.tables for row in table.rows for cell in row.cells)
        self.assertIn("FST26125-A",values)
        self.assertIn("FST26125-B",values)
        self.assertEqual(sum(
            p.text.strip().upper()=="REGISTRO DE INSPEÇÃO" for p in doc.paragraphs),2)
        # O texto normativo da instrução permanece uma vez só.
        norm_count=sum("1. OBJETIVO" in p.text.upper() for p in doc.paragraphs)
        self.assertLessEqual(norm_count,1)

    def test_subprocess_photo_images_preserved_and_unique(self):
        template=(ROOT/"templates"/"IT001.docx").read_bytes()
        photo=Image.new("RGB",(300,200),(60,120,140))
        image=io.BytesIO();photo.save(image,format="PNG")
        first=sample_payload()
        first["photos"]=[{"bytes":image.getvalue(),"caption":"Evidência A"}]
        first["process"]["codigo"]="26125"
        first["group"]={"subprocesso_codigo":"A"}
        second=sample_payload()
        second["photos"]=[{"bytes":image.getvalue(),"caption":"Evidência B"}]
        second["process"]["codigo"]="26125"
        second["group"]={"subprocesso_codigo":"B"}
        doc=Document(io.BytesIO(generate_inspection(template,first)))
        append_filled_inspection_form(doc,generate_inspection(template,second))
        buffer=io.BytesIO();doc.save(buffer)
        reloaded=Document(io.BytesIO(buffer.getvalue()))
        self.assertEqual(len(reloaded.inline_shapes),2)
        identifiers=[node.get("id") for node in reloaded._element.body.iter(qn("wp:docPr"))]
        self.assertEqual(len(identifiers),len(set(identifiers)))

    def test_empty_photo_template_does_not_create_unused_section(self):
        template=(ROOT/"templates"/"IT001.docx").read_bytes()
        doc=Document(io.BytesIO(generate_inspection(template,sample_payload())))
        photo_headers=[cell.text for table in doc.tables
                       for row in table.rows for cell in row.cells
                       if "FOTOS DA INSPEÇÃO" in cell.text.upper()]
        if photo_headers:
            print("PHOTODBG",[(idx,len(t.rows),len(t.columns),
                [str(c.text)[:50] for row in t.rows[:3] for c in row.cells[:3]])
                for idx,t in enumerate(doc.tables) if any(
                    "foto" in str(c.text).lower() for row in t.rows for c in row.cells)])
        self.assertEqual(photo_headers,[])

if __name__=="__main__": unittest.main()
