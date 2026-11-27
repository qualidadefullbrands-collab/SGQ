-- Reclassificação transacional, somente registros sem evidências de execução.
-- Nenhuma exclusão física. FST, itens, fotos de cadastro e histórico permanecem.
-- O caderno continua único; grupos substituídos deixam de integrar o laudo ativo.
alter table public.grupos_inspecao add column if not exists reclassificado_em timestamptz;

create or replace function public.sgq_plano_reclassificacao(p_lote integer,p_nivel text)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('lote',p_lote,'codigo',s.codigo,'amostra',least(s.tamanho,p_lote),'ac',s.ac,'re',s.re)
  from (values
    (2,8,'A','A','B','A','A','A','A'),
    (9,15,'A','B','C','A','A','A','A'),
    (16,25,'B','C','D','A','A','B','B'),
    (26,50,'C','D','E','A','B','B','C'),
    (51,90,'C','E','F','B','B','C','C'),
    (91,150,'D','F','G','B','B','C','D'),
    (151,280,'E','G','H','B','C','D','E'),
    (281,500,'F','H','J','B','C','D','E'),
    (501,1200,'G','J','K','C','C','E','F'),
    (1201,3200,'H','K','L','C','D','E','G'),
    (3201,10000,'J','L','M','C','D','F','H'),
    (10001,35000,'K','M','N','C','D','F','J'),
    (35001,150000,'L','N','P','D','E','G','K'),
    (150001,500000,'M','P','Q','D','E','G','L'),
    (500001,2147483647,'N','Q','R','D','E','H','M')
  ) as r(minimo,maximo,i,ii,iii,s1,s2,s3,s4)
  join (values ('A',2,0,1),('B',3,0,1),('C',5,0,1),('D',8,0,1),('E',13,0,1),('F',20,1,2),('G',32,1,2),('H',50,2,3),('J',80,3,4),('K',125,5,6),('L',200,7,8),('M',315,10,11),('N',500,14,15),('P',800,21,22),('Q',1250,21,22),('R',2000,21,22)) as s(codigo,tamanho,ac,re)
    on s.codigo=case p_nivel when 'I' then r.i when 'II' then r.ii when 'III' then r.iii when 'S1' then r.s1 when 'S2' then r.s2 when 'S3' then r.s3 when 'S4' then r.s4 end
  where p_lote between r.minimo and r.maximo
  union all select jsonb_build_object('lote',1,'codigo','','amostra',0,'ac',null,'re',null)
    where p_lote=1 and p_nivel in ('I','II','III','S1','S2','S3','S4')
$$;
revoke all on function public.sgq_plano_reclassificacao(integer,text) from public,anon;
grant execute on function public.sgq_plano_reclassificacao(integer,text) to authenticated;

create or replace function public.sgq_reclassificacao_bloqueio(p_id uuid)
returns text language sql stable security invoker set search_path='' as $$
 select case
  when i.excluido_em is not null or i.status not in ('aberta','em_andamento') then 'Inspeção concluída, cancelada ou arquivada: requer retificação supervisionada.'
  when coalesce(i.total_inspecionado,0)<>0 or coalesce(i.total_conforme,0)<>0 or coalesce(i.total_nao_conforme,0)<>0
    or coalesce(i.resultado,'pendente')<>'pendente' or i.dimensionais_finalizados is true or i.testes_finalizados is true
    or i.concluida_em is not null or i.documento_gerado_em is not null or i.retencao_decisao is not null
    or nullif(btrim(i.observacoes),'') is not null or nullif(btrim(i.justificativa_decisao),'') is not null
    or exists(select 1 from public.inspecao_checklist_resultados where inspecao_id=i.id)
    or exists(select 1 from public.inspecao_dimensionais where inspecao_id=i.id)
    or exists(select 1 from public.inspecao_dimensional_configuracoes where inspecao_id=i.id)
    or exists(select 1 from public.inspecao_testes_resultados where inspecao_id=i.id)
    or exists(select 1 from public.inspecao_nao_conformidades where inspecao_id=i.id)
    or exists(select 1 from public.inspecao_registros where inspecao_id=i.id)
    or exists(select 1 from public.inspecao_fotos where inspecao_id=i.id)
    or exists(select 1 from public.inspecao_chat_mensagens where inspecao_id=i.id)
    or exists(select 1 from public.amostras where inspecao_id=i.id or grupo_inspecao_id=i.grupo_inspecao_id)
    or exists(select 1 from public.laudos where inspecao_id=i.id)
    or exists(select 1 from public.sgq_documento_integracoes where inspecao_id=i.id)
   then 'Há registros de execução, evidências, retenção ou laudo. Atribuição e revalidação precisam ser revisadas; nada será removido.'
  else null end
 from public.inspecoes i where i.id=p_id
$$;
revoke all on function public.sgq_reclassificacao_bloqueio(uuid) from public,anon;
grant execute on function public.sgq_reclassificacao_bloqueio(uuid) to authenticated;

create or replace function public.sgq_reclassificar_inspecao(
 p_inspecao_id uuid,p_modo text default 'contexto',p_selecionadas uuid[] default '{}',
 p_unidades jsonb default '{}'::jsonb,p_it uuid default null,p_nivel text default null,
 p_confirmacao text default null,p_motivo text default null
) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
 v_actor uuid:=auth.uid();
 v_ins public.inspecoes%rowtype; v_group public.grupos_inspecao%rowtype;
 v_process public.processos%rowtype;
 v_ids uuid[]; v_groups uuid[]; v_links uuid[]; v_items uuid[];
 v_skus text[]; v_block text; v_count integer; v_total integer;
 v_it uuid; v_level text; v_plan jsonb:='[]'::jsonb; v_target jsonb;
 v_snapshot jsonb; v_signature text; v_new_ids uuid[]:='{}';
 v_subs text[]; v_codes text[]; v_sub text; v_code text;
 v_anchor_sku text; v_sku text; v_group_id uuid; v_new_id uuid;
 v_target_links uuid[]; v_first_item uuid; v_lot integer; v_info jsonb;
 v_name text; v_boxes numeric; v_eval numeric; v_num integer;
 v_ratio numeric; v_entry record; v_previous jsonb;
begin
 if v_actor is null or not exists(select 1 from public.profiles where id=v_actor and ativo and perfil in ('administrador','gestor','inspetor')) then
  raise exception 'Sem permissão para reclassificar inspeções.' using errcode='42501';
 end if;
 if p_modo not in ('contexto','separar','agrupar') then raise exception 'Modo de reclassificação inválido.' using errcode='22023'; end if;
 select * into v_ins from public.inspecoes where id=p_inspecao_id;
 if not found then raise exception 'Inspeção não encontrada.' using errcode='P0002'; end if;
 select * into v_group from public.grupos_inspecao where id=v_ins.grupo_inspecao_id;
 if not found then raise exception 'Entrada não encontrada.' using errcode='P0002'; end if;
 select * into v_process from public.processos where id=v_group.processo_id and excluido_em is null;
 if not found then raise exception 'FST não encontrado ou arquivado.' using errcode='P0002'; end if;
 if p_modo='contexto' then
  return jsonb_build_object('ok',true,'fst',v_process.codigo,'tipo',v_group.tipo,'it',v_ins.it_versao_id,'nivel',v_ins.nivel_inspecao,
    'entradas',coalesce((select jsonb_agg(jsonb_build_object(
       'id',i.id,'entrada',g.subprocesso_codigo,'tipo',g.tipo,'status',i.status,'nf',g.nota_fiscal,
       'it',i.it_versao_id,'nivel',i.nivel_inspecao,'bloqueio',public.sgq_reclassificacao_bloqueio(i.id),
       'skus',coalesce((select jsonb_agg(jsonb_build_object('sku',p.sku,'nome',p.nome,'quantidade',x.quantidade,'unidades',l.unidades_por_conjunto) order by p.sku)
             from public.grupo_inspecao_itens l join public.processo_itens x on x.id=l.processo_item_id
             join public.produtos p on p.id=x.produto_id where l.grupo_inspecao_id=g.id),'[]'::jsonb))
      order by g.subprocesso_codigo,i.id) from public.inspecoes i join public.grupos_inspecao g on g.id=i.grupo_inspecao_id
      where g.processo_id=v_process.id and g.reclassificado_em is null and g.status is distinct from 'cancelado'
        and i.excluido_em is null and i.status<>'cancelada'),'[]'::jsonb));
 end if;

 -- Serialize corrections on the FST, then lock original rows and item links.
 select * into v_process from public.processos where id=v_process.id and excluido_em is null for update;
 if not found then raise exception 'FST arquivado durante a operação.'; end if;
 if p_confirmacao is not null then
  select dados->'resultado' into v_previous from public.audit_log
   where entidade='processos' and entidade_id::text=v_process.id::text and acao='reclassificacao_skus'
   and dados->>'confirmacao'=p_confirmacao and usuario_id=v_actor order by id desc limit 1;
  if found then return v_previous || jsonb_build_object('replay',true); end if;
 end if;
 select array_agg(distinct id order by id) into v_ids from unnest(array_append(coalesce(p_selecionadas,'{}'),p_inspecao_id)) id where id is not null;
 if cardinality(v_ids)>26 or (p_modo='separar' and cardinality(v_ids)<>1) or (p_modo='agrupar' and cardinality(v_ids)<2) then
  raise exception 'Selecione uma inspeção de kit para separar ou pelo menos duas entradas independentes para reunir.';
 end if;
 perform 1 from public.inspecoes where id=any(v_ids) order by id for update;
 select * into v_ins from public.inspecoes where id=p_inspecao_id;
 select * into v_group from public.grupos_inspecao where id=v_ins.grupo_inspecao_id for update;
 select array_agg(distinct g.id order by g.id),count(*) into v_groups,v_count
   from public.inspecoes i join public.grupos_inspecao g on g.id=i.grupo_inspecao_id
   where i.id=any(v_ids) and i.excluido_em is null and i.status<>'cancelada' and g.processo_id=v_process.id
     and g.reclassificado_em is null and g.status is distinct from 'cancelado'
     and g.tipo=case p_modo when 'separar' then 'kit_componentes' else 'individual' end;
 if v_count<>cardinality(v_ids) or cardinality(v_groups)<>cardinality(v_ids) then
  raise exception 'Seleção alterada, arquivada ou não pertence ao mesmo FST e tipo esperado. Atualize e tente novamente.';
 end if;
 perform 1 from public.grupos_inspecao where id=any(v_groups) order by id for update;
 if exists(select 1 from public.inspecoes where grupo_inspecao_id=any(v_groups) and excluido_em is null and not(id=any(v_ids))) then
  raise exception 'Uma entrada tem outra inspeção ativa. Reclassificação precisa de revisão.';
 end if;
 if exists(select 1 from public.grupos_inspecao g join public.inspecoes i on i.grupo_inspecao_id=g.id and i.id=any(v_ids)
  where g.id=any(v_groups) and (g.nota_fiscal is distinct from v_group.nota_fiscal or g.chegada_cd is distinct from v_group.chegada_cd
    or g.origem is distinct from v_group.origem or g.transporte is distinct from v_group.transporte
    or i.data_inspecao is distinct from v_ins.data_inspecao)) then
  raise exception 'As entradas possuem NF, data ou logística diferentes. Não podem ser reunidas automaticamente.';
 end if;
 select public.sgq_reclassificacao_bloqueio(id) into v_block from unnest(v_ids) id
  where public.sgq_reclassificacao_bloqueio(id) is not null limit 1;
 if v_block is not null then raise exception '%',v_block; end if;
 perform 1 from public.grupo_inspecao_itens where grupo_inspecao_id=any(v_groups) order by id for update;
 select array_agg(l.id order by l.id),array_agg(distinct l.processo_item_id order by l.processo_item_id),count(*)
  into v_links,v_items,v_count from public.grupo_inspecao_itens l where l.grupo_inspecao_id=any(v_groups);
 if v_count<2 or v_count<>cardinality(v_items) then raise exception 'Os vínculos dos produtos precisam de revisão.'; end if;
 perform 1 from public.processo_itens where id=any(v_items) order by id for update;
 if exists(select 1 from public.grupo_inspecao_itens l where l.processo_item_id=any(v_items) and not(l.grupo_inspecao_id=any(v_groups))) then
  raise exception 'Há itens compartilhados por outra entrada; não é seguro alterar automaticamente.';
 end if;
 if exists(select 1 from public.processo_itens x left join public.produtos p on p.id=x.produto_id
   where x.id=any(v_items) and (x.processo_id is distinct from v_process.id or p.id is null or nullif(btrim(p.sku),'') is null
   or x.quantidade is null or x.quantidade<=0 or x.quantidade<>trunc(x.quantidade) or x.quantidade>2147483647)) then
  raise exception 'Confira os códigos e quantidades inteiras positivas dos produtos.';
 end if;
 select array_agg(distinct upper(btrim(p.sku)) order by upper(btrim(p.sku))) into v_skus
  from public.processo_itens x join public.produtos p on p.id=x.produto_id where x.id=any(v_items);
 if cardinality(v_skus)<2 then raise exception 'A reclassificação exige pelo menos dois SKUs distintos.'; end if;
 if p_modo='agrupar' and exists(select 1 from public.grupo_inspecao_itens l join public.processo_itens x on x.id=l.processo_item_id
  join public.produtos p on p.id=x.produto_id where l.id=any(v_links) group by l.grupo_inspecao_id having count(distinct upper(btrim(p.sku)))<>1) then
  raise exception 'Uma das entradas não é realmente independente.';
 end if;
 if p_modo='agrupar' and exists(select 1 from public.grupo_inspecao_itens l join public.processo_itens x on x.id=l.processo_item_id
  join public.produtos p on p.id=x.produto_id where l.id=any(v_links) group by upper(btrim(p.sku)) having count(distinct l.grupo_inspecao_id)>1) then
  raise exception 'Há o mesmo SKU em mais de uma entrada. Confira os lotes antes de agrupar.';
 end if;
 v_it:=coalesce(p_it,v_ins.it_versao_id); v_level:=coalesce(p_nivel,v_ins.nivel_inspecao);
 if v_it is null or not exists(select 1 from public.it_versoes where id=v_it and status='publicada')
    or v_level is null or v_level not in ('I','II','III','S1','S2','S3','S4') then
  raise exception 'Confirme uma IT publicada e um nível de inspeção válido.';
 end if;
 if p_modo='agrupar' then
  if jsonb_typeof(p_unidades) is distinct from 'object' then raise exception 'Informe as unidades de cada componente.'; end if;
  foreach v_sku in array v_skus loop
   if coalesce(p_unidades->>v_sku,'') !~ '^[1-9][0-9]{0,8}$' then raise exception 'Informe unidades inteiras positivas por conjunto para %.',v_sku; end if;
  end loop;
 end if;
 select coalesce(array_agg(subprocesso_codigo) filter(where subprocesso_codigo is not null),'{}'),coalesce(array_agg(codigo),'{}')
 into v_subs,v_codes from public.grupos_inspecao where processo_id=v_process.id;
 if v_group.subprocesso_codigo is null then raise exception 'A entrada original precisa de uma letra de subprocesso.'; end if;
 -- The original entry is retained as the first destination. Additional letters are allocated only if needed.
 select upper(btrim(p.sku)) into v_anchor_sku from public.processo_itens x join public.produtos p on p.id=x.produto_id
  where x.id=v_ins.processo_item_id and x.id=any(v_items);
 v_anchor_sku:=coalesce(v_anchor_sku,v_skus[1]);
 if p_modo='agrupar' then v_skus:=array['']; else
  select array_agg(s order by (s=v_anchor_sku) desc,s) into v_skus from unnest(v_skus) s;
 end if;
 v_num:=0;
 foreach v_sku in array v_skus loop
  v_num:=v_num+1;
  select array_agg(l.id order by l.id), (array_agg(x.id order by (x.id=v_ins.processo_item_id) desc,x.id))[1],
    min(floor(x.quantidade / case when p_modo='agrupar' then (p_unidades->>upper(btrim(p.sku)))::numeric else 1 end))::integer,
    string_agg(distinct p.nome,' + ' order by p.nome),sum(x.caixas_recebidas),sum(x.caixas_inspecionadas)
   into v_target_links,v_first_item,v_lot,v_name,v_boxes,v_eval
  from public.grupo_inspecao_itens l join public.processo_itens x on x.id=l.processo_item_id
  join public.produtos p on p.id=x.produto_id where l.id=any(v_links) and (p_modo='agrupar' or upper(btrim(p.sku))=v_sku);
  if v_lot is null or v_lot<1 then raise exception 'Quantidade insuficiente para formar ao menos um conjunto completo.'; end if;
  v_info:=public.sgq_plano_reclassificacao(v_lot,v_level);
  if v_info is null then raise exception 'Plano de amostragem não localizado.'; end if;
  if v_num=1 then v_sub:=v_group.subprocesso_codigo;v_code:=v_group.codigo; else
    select chr(n) into v_sub from generate_series(65,90) n where not(chr(n)=any(v_subs)) order by n limit 1;
    if v_sub is null then raise exception 'O FST não possui letras livres suficientes; não foi feita nenhuma alteração.'; end if;
    select 'G'||lpad(n::text,2,'0') into v_code from generate_series(1,99) n
      where not(('G'||lpad(n::text,2,'0'))=any(v_codes)) order by n limit 1;
    if v_code is null then raise exception 'O FST não possui código de entrada livre.'; end if;
    v_subs:=array_append(v_subs,v_sub);v_codes:=array_append(v_codes,v_code);
  end if;
  v_plan:=v_plan||jsonb_build_array(jsonb_build_object('entrada',v_sub,'codigo',v_code,'sku',v_sku,'nome',v_name,
    'links',to_jsonb(v_target_links),'primeiro_item',v_first_item,'it',v_it,'nivel',v_level,'plano',v_info,
    'caixas_recebidas',v_boxes,'caixas_avaliar',v_eval));
 end loop;
 v_snapshot:=jsonb_build_object('processo',to_jsonb(v_process),
  'inspecoes',(select jsonb_agg(to_jsonb(i) order by i.id) from public.inspecoes i where i.id=any(v_ids)),
  'grupos',(select jsonb_agg(to_jsonb(g) order by g.id) from public.grupos_inspecao g where g.id=any(v_groups)),
  'itens',(select jsonb_agg(to_jsonb(x) order by x.id) from public.processo_itens x where x.id=any(v_items)),
  'vinculos',(select jsonb_agg(to_jsonb(l) order by l.id) from public.grupo_inspecao_itens l where l.id=any(v_links)));
 v_signature:=md5(jsonb_build_object('antes',v_snapshot,'plano',v_plan,'modo',p_modo,'unidades',p_unidades)::text);
 if p_confirmacao is null then
  return jsonb_build_object('ok',true,'confirmacao',v_signature,'fst',v_process.codigo,'modo',p_modo,'destinos',v_plan,
    'originais',to_jsonb(v_ids),'aviso','Dados de cadastro serão reaproveitados. A amostragem será recalculada. Nenhuma evidência será apagada.');
 end if;
 if p_confirmacao<>v_signature then raise exception 'O cadastro mudou depois da prévia. Gere uma nova prévia.'; end if;
 if nullif(btrim(p_motivo),'') is null then raise exception 'Informe o motivo da correção.'; end if;
 -- Source inspections are retained as history; new operational IDs prevent a stale screen from saving against a reclassified inspection.
 update public.inspecoes set excluido_em=now(),excluido_por=v_actor,status='cancelada',
  parametros_amostragem=coalesce(parametros_amostragem,'{}'::jsonb)||jsonb_build_object('reclassificacao',v_signature)
  where id=any(v_ids);
 get diagnostics v_total=row_count;
 if v_total<>cardinality(v_ids) then raise exception 'Não foi possível preservar todas as inspeções originais.'; end if;
 v_num:=0;
 for v_target in select value from jsonb_array_elements(v_plan) loop
  v_num:=v_num+1;
  if v_num=1 then
   v_group_id:=v_group.id;
   update public.grupos_inspecao set tipo=case p_modo when 'agrupar' then 'kit_componentes' else 'individual' end,
    nome=v_target->>'nome',tamanho_lote_estatistico=(v_target->'plano'->>'lote')::integer,status='em_inspecao'
    where id=v_group_id;
  else
   insert into public.grupos_inspecao(processo_id,codigo,subprocesso_codigo,nome,tipo,tamanho_lote_estatistico,status,nota_fiscal,origem,transporte,chegada_cd)
   values(v_process.id,v_target->>'codigo',v_target->>'entrada',v_target->>'nome','individual',(v_target->'plano'->>'lote')::integer,
     'em_inspecao',v_group.nota_fiscal,v_group.origem,v_group.transporte,v_group.chegada_cd) returning id into v_group_id;
  end if;
  select array_agg(value::uuid) into v_target_links from jsonb_array_elements_text(v_target->'links');
  update public.grupo_inspecao_itens l set grupo_inspecao_id=v_group_id,quantidade_componente=x.quantidade,
    unidades_por_conjunto=case p_modo when 'agrupar' then (p_unidades->>upper(btrim(p.sku)))::numeric else 1 end
   from public.processo_itens x join public.produtos p on p.id=x.produto_id where l.id=any(v_target_links) and l.processo_item_id=x.id;
  get diagnostics v_total=row_count;
  if v_total<>cardinality(v_target_links) then raise exception 'Falha ao reaproveitar os itens; operação revertida.'; end if;
  update public.grupo_inspecao_its set principal=false where grupo_inspecao_id=v_group_id and principal;
  insert into public.grupo_inspecao_its(grupo_inspecao_id,it_versao_id,principal)
    select v_group_id,v_it,true where not exists(select 1 from public.grupo_inspecao_its where grupo_inspecao_id=v_group_id and it_versao_id=v_it);
  update public.grupo_inspecao_its set principal=true where grupo_inspecao_id=v_group_id and it_versao_id=v_it;
  v_new_id:=gen_random_uuid();
  insert into public.inspecoes(id,numero,processo_item_id,grupo_inspecao_id,it_versao_id,status,resultado,tamanho_lote,tamanho_amostra,
    limite_aceitacao,limite_rejeicao,nivel_inspecao,nivel_inspecao_origem,regime_inspecao,tipo_plano,codigo_amostragem,
    nqa_critico,nqa_grave,nqa_toleravel,caixas_recebidas,caixas_avaliar,data_inspecao,responsavel_id,observacao_interna,parametros_amostragem)
   values(v_new_id,'INS-'||extract(year from now())::integer||'-'||upper(left(replace(v_new_id::text,'-',''),8)),
    (v_target->>'primeiro_item')::uuid,v_group_id,v_it,'aberta','pendente',(v_target->'plano'->>'lote')::integer,
    (v_target->'plano'->>'amostra')::integer,(v_target->'plano'->>'ac')::integer,(v_target->'plano'->>'re')::integer,
    v_level,'it','normal','simples',v_target->'plano'->>'codigo',0.40,1.50,4.00,
    (v_target->>'caixas_recebidas')::numeric,(v_target->>'caixas_avaliar')::numeric,v_ins.data_inspecao,v_ins.responsavel_id,
    v_ins.observacao_interna,jsonb_build_object('fonte','backend_dotnet','regra_caixas','informada_por_item','versao','2026-10',
     'modo_teste',true,'somente_it_obrigatoria',true,'modelo_inspecao',case p_modo when 'agrupar' then 'conjunto' else 'individual' end,
     'reclassificacao_origem',to_jsonb(v_ids),'reclassificacao',v_signature));
  v_new_ids:=array_append(v_new_ids,v_new_id);
 end loop;
 update public.grupos_inspecao set status='cancelado',reclassificado_em=now() where id=any(v_groups) and id<>v_group.id;
 update public.processos set status='em_inspecao',atualizado_em=now() where id=v_process.id;
 v_previous:=jsonb_build_object('ok',true,'fst',v_process.codigo,'modo',p_modo,'originais',to_jsonb(v_ids),
  'novas',to_jsonb(v_new_ids),'destinos',v_plan);
 insert into public.audit_log(usuario_id,entidade,entidade_id,acao,dados)
 values(v_actor,'processos',v_process.id::text,'reclassificacao_skus',
  jsonb_build_object('confirmacao',v_signature,'motivo',left(btrim(p_motivo),2000),'antes',v_snapshot,'resultado',v_previous));
 return v_previous;
end;
$fn$;
revoke all on function public.sgq_reclassificar_inspecao(uuid,text,uuid[],jsonb,uuid,text,text,text) from public,anon;
grant execute on function public.sgq_reclassificar_inspecao(uuid,text,uuid[],jsonb,uuid,text,text,text) to authenticated;
