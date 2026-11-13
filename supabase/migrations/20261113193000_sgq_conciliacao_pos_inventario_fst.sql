-- Post-inventory reconciliation for the FST blind inventory.
-- All stock adjustments remain OUTSIDE this module. Decisions are auditable
-- and cannot alter Omie or local stock balances.
create table if not exists public.sgq_inventario_conciliacoes (
 inventario_id uuid primary key references public.sgq_inventarios_cegos(id) on delete restrict,
 status text not null default 'em_analise' check(status in ('em_analise','concluida')),
 iniciado_em timestamptz not null default now(),
 iniciado_por uuid not null references auth.users(id),
 concluido_em timestamptz,
 concluido_por uuid references auth.users(id),
 constraint sgq_recon_final_check check (
  (status='em_analise' and concluido_em is null and concluido_por is null)
  or (status='concluida' and concluido_em is not null and concluido_por is not null)
 )
);

create table if not exists public.sgq_inventario_conciliacao_itens (
 item_id uuid primary key references public.sgq_inventario_cego_itens(id) on delete restrict,
 inventario_id uuid not null references public.sgq_inventario_conciliacoes(inventario_id) on delete restrict,
 quantidade_original numeric(18,3) not null check(quantidade_original>=0),
 quantidade_referencia numeric(18,3) check(quantidade_referencia>=0),
 referencia_fonte text,
 referencia_evidencia text,
 quantidade_recontagem numeric(18,3) check(quantidade_recontagem>=0),
 recontagem_justificativa text,
 status text not null default 'pendente'
   check(status in ('pendente','recontagem_solicitada','recontada','conciliado','divergencia_aprovada')),
 justificativa_analise text,
 revisado_por uuid references auth.users(id),
 revisado_em timestamptz,
 atualizado_em timestamptz not null default now(),
 constraint sgq_recon_reference_together check(
  (quantidade_referencia is null and referencia_fonte is null and referencia_evidencia is null)
  or (quantidade_referencia is not null and length(btrim(referencia_fonte)) between 5 and 240
   and length(btrim(referencia_evidencia)) between 5 and 500)
 ),
 constraint sgq_recon_review_together check (
  (revisado_por is null and revisado_em is null)
  or (revisado_por is not null and revisado_em is not null)
 )
);
create index if not exists sgq_recon_itens_inventory on public.sgq_inventario_conciliacao_itens(inventario_id,status);

create table if not exists public.sgq_inventario_conciliacao_eventos (
 id bigint generated always as identity primary key,
 inventario_id uuid not null references public.sgq_inventario_conciliacoes(inventario_id) on delete restrict,
 item_id uuid references public.sgq_inventario_cego_itens(id) on delete restrict,
 acao text not null check(acao in ('encerrar','referencia','solicitar_recontagem','recontar','revisar','finalizar')),
 registrado_por uuid not null references auth.users(id),
 criado_em timestamptz not null default now(),
 dados jsonb not null default '{}'::jsonb
);
create index if not exists sgq_recon_events_inventory on public.sgq_inventario_conciliacao_eventos(inventario_id,criado_em desc);

alter table public.sgq_inventario_conciliacoes enable row level security;
alter table public.sgq_inventario_conciliacao_itens enable row level security;
alter table public.sgq_inventario_conciliacao_eventos enable row level security;
revoke all on public.sgq_inventario_conciliacoes from public, anon, authenticated;
revoke all on public.sgq_inventario_conciliacao_itens from public, anon, authenticated;
revoke all on public.sgq_inventario_conciliacao_eventos from public, anon, authenticated;
grant select on public.sgq_inventario_conciliacoes to authenticated;
grant select on public.sgq_inventario_conciliacao_itens to authenticated;
grant select on public.sgq_inventario_conciliacao_eventos to authenticated;
create policy sgq_recon_header_read on public.sgq_inventario_conciliacoes
 for select to authenticated
 using (private.current_sgq_role() in ('administrador','gestor','inspetor','consulta'));
create policy sgq_recon_items_read on public.sgq_inventario_conciliacao_itens
 for select to authenticated
 using (private.current_sgq_role() in ('administrador','gestor','inspetor','consulta'));
create policy sgq_recon_events_read on public.sgq_inventario_conciliacao_eventos
 for select to authenticated
 using (private.current_sgq_role() in ('administrador','gestor','inspetor','consulta'));

-- Single transactional API. All writes are server-authorized with the
-- authenticated user's active SGQ role; the browser has read-only access.
create or replace function public.sgq_conciliacao_operar(
 p_acao text,
 p_inventario uuid,
 p_item uuid default null,
 p_quantidade numeric default null,
 p_fonte text default null,
 p_justificativa text default null
) returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
 v_user uuid:=auth.uid();
 v_role text:=private.current_sgq_role();
 v_manager boolean;
 v_session public.sgq_inventarios_cegos%rowtype;
 v_header public.sgq_inventario_conciliacoes%rowtype;
 v_row public.sgq_inventario_conciliacao_itens%rowtype;
 v_total integer;
 v_pending integer;
 v_delta numeric;
 v_note text:=btrim(coalesce(p_justificativa,''));
 v_source text:=btrim(coalesce(p_fonte,''));
 v_next text;
begin
 if v_user is null or v_role not in ('administrador','gestor','inspetor') then
  raise exception 'Sessão sem permissão para conciliação.' using errcode='42501';
 end if;
 v_manager:=v_role in ('administrador','gestor');
 if p_inventario is null then
  raise exception 'Inventário não informado.' using errcode='22023';
 end if;
 select * into v_session from public.sgq_inventarios_cegos
  where id=p_inventario for update;
 if not found or v_session.processo_codigo is null then
  raise exception 'Inventário FST não encontrado.' using errcode='22023';
 end if;

 if p_acao='encerrar' then
  if not v_manager then raise exception 'Somente gestor pode encerrar a contagem.' using errcode='42501'; end if;
  if v_session.status<>'aberto' then raise exception 'Este inventário não está aberto.' using errcode='22023'; end if;
  select count(*) into v_total from public.sgq_inventario_cego_itens where inventario_id=p_inventario;
  if v_total=0 then raise exception 'Não há itens contados para encerrar.' using errcode='22023'; end if;
  update public.sgq_inventarios_cegos set status='fechado',fechado_por=v_user,fechado_em=now()
   where id=p_inventario and status='aberto';
  insert into public.sgq_inventario_conciliacoes(inventario_id,iniciado_por)
   values(p_inventario,v_user);
  insert into public.sgq_inventario_conciliacao_itens(item_id,inventario_id,quantidade_original)
   select id,p_inventario,quantidade_contada
   from public.sgq_inventario_cego_itens where inventario_id=p_inventario;
  insert into public.sgq_inventario_conciliacao_eventos(inventario_id,acao,registrado_por,dados)
   values(p_inventario,'encerrar',v_user,jsonb_build_object('itens',v_total));
  return jsonb_build_object('ok',true,'status','em_analise','itens',v_total);
 end if;

 if v_session.status<>'fechado' then
  raise exception 'Encerre a contagem antes da conciliação.' using errcode='22023';
 end if;
 select * into v_header from public.sgq_inventario_conciliacoes
  where inventario_id=p_inventario for update;
 if not found then raise exception 'Conciliação não inicializada para esta contagem.' using errcode='22023'; end if;
 if v_header.status<>'em_analise' then
  raise exception 'Conciliação concluída. As decisões estão bloqueadas.' using errcode='22023';
 end if;

 if p_acao='finalizar' then
  if not v_manager then raise exception 'Somente gestor pode concluir a conciliação.' using errcode='42501'; end if;
  select count(*),count(*) filter(where quantidade_referencia is null or
    status not in ('conciliado','divergencia_aprovada'))
   into v_total,v_pending from public.sgq_inventario_conciliacao_itens
    where inventario_id=p_inventario;
  if v_total=0 or v_pending>0 then
   raise exception 'Revise todos os itens e suas referências antes de concluir.' using errcode='22023';
  end if;
  update public.sgq_inventario_conciliacoes
   set status='concluida',concluido_em=now(),concluido_por=v_user
   where inventario_id=p_inventario;
  insert into public.sgq_inventario_conciliacao_eventos(inventario_id,acao,registrado_por,dados)
   values(p_inventario,'finalizar',v_user,jsonb_build_object('itens',v_total));
  return jsonb_build_object('ok',true,'status','concluida','itens',v_total);
 end if;

 if p_item is null then raise exception 'Selecione o item da contagem.' using errcode='22023'; end if;
 select * into v_row from public.sgq_inventario_conciliacao_itens
  where item_id=p_item and inventario_id=p_inventario for update;
 if not found then raise exception 'Item não pertence a esta conciliação.' using errcode='22023'; end if;

 if p_acao='referencia' then
  if not v_manager then raise exception 'Somente gestor pode informar a referência.' using errcode='42501'; end if;
  if p_quantidade is null or p_quantidade<0 or scale(p_quantidade)>3 or p_quantidade>=1e15 then
   raise exception 'Informe quantidade de referência válida (até três decimais).' using errcode='22023';
  end if;
  if length(v_source) not between 5 and 240 or length(v_note) not between 5 and 500 then
   raise exception 'Identifique a origem e a evidência da referência da mesma localização.' using errcode='22023';
  end if;
  update public.sgq_inventario_conciliacao_itens set
   quantidade_referencia=p_quantidade,referencia_fonte=v_source,referencia_evidencia=v_note,
   status='pendente',quantidade_recontagem=null,recontagem_justificativa=null,
   revisado_por=null,revisado_em=null,justificativa_analise=null,atualizado_em=now()
   where item_id=p_item;
  insert into public.sgq_inventario_conciliacao_eventos(inventario_id,item_id,acao,registrado_por,dados)
   values(p_inventario,p_item,'referencia',v_user,jsonb_build_object(
    'anterior',v_row.quantidade_referencia,'quantidade',p_quantidade,
    'fonte',v_source,'evidencia',v_note));
  return jsonb_build_object('ok',true,'status','pendente');
 elsif p_acao='solicitar_recontagem' then
  if not v_manager then raise exception 'Somente gestor pode solicitar recontagem.' using errcode='42501'; end if;
  if v_row.quantidade_referencia is null then raise exception 'Informe primeiro a referência.' using errcode='22023'; end if;
  if v_row.status in ('conciliado','divergencia_aprovada') then
   raise exception 'Reabra a análise pela atualização de referência antes de solicitar recontagem.' using errcode='22023';
  end if;
  if length(v_note) not between 5 and 500 then raise exception 'Informe o motivo da recontagem.' using errcode='22023'; end if;
  update public.sgq_inventario_conciliacao_itens set
   status='recontagem_solicitada',quantidade_recontagem=null,recontagem_justificativa=v_note,
   atualizado_em=now() where item_id=p_item;
  insert into public.sgq_inventario_conciliacao_eventos(inventario_id,item_id,acao,registrado_por,dados)
   values(p_inventario,p_item,'solicitar_recontagem',v_user,jsonb_build_object('motivo',v_note));
  return jsonb_build_object('ok',true,'status','recontagem_solicitada');
 elsif p_acao='recontar' then
  if v_row.status<>'recontagem_solicitada' then raise exception 'Não há recontagem solicitada para este item.' using errcode='22023'; end if;
  if p_quantidade is null or p_quantidade<0 or scale(p_quantidade)>3 or p_quantidade>=1e15 then
   raise exception 'Informe quantidade recontada válida.' using errcode='22023';
  end if;
  if length(v_note) not between 5 and 500 then
   raise exception 'Registre observação sobre a recontagem.' using errcode='22023';
  end if;
  update public.sgq_inventario_conciliacao_itens set
   quantidade_recontagem=p_quantidade,recontagem_justificativa=v_note,
   status='recontada',atualizado_em=now() where item_id=p_item;
  insert into public.sgq_inventario_conciliacao_eventos(inventario_id,item_id,acao,registrado_por,dados)
   values(p_inventario,p_item,'recontar',v_user,jsonb_build_object(
    'quantidade_original',v_row.quantidade_original,'quantidade_recontagem',p_quantidade,'observacao',v_note));
  return jsonb_build_object('ok',true,'status','recontada');
 elsif p_acao='revisar' then
  if not v_manager then raise exception 'Somente gestor pode aprovar a análise.' using errcode='42501'; end if;
  if v_row.quantidade_referencia is null then raise exception 'Referência ainda não informada.' using errcode='22023'; end if;
  if v_row.status='recontagem_solicitada' then raise exception 'Aguarde a recontagem solicitada.' using errcode='22023'; end if;
  v_delta:=coalesce(v_row.quantidade_recontagem,v_row.quantidade_original)-v_row.quantidade_referencia;
  if v_delta<>0 and length(v_note)<5 then
   raise exception 'Justifique a aprovação da divergência.' using errcode='22023';
  end if;
  if length(v_note)>500 then raise exception 'Justificativa acima de 500 caracteres.' using errcode='22023'; end if;
  v_next:=case when v_delta=0 then 'conciliado' else 'divergencia_aprovada' end;
  update public.sgq_inventario_conciliacao_itens set status=v_next,
   justificativa_analise=nullif(v_note,''),revisado_por=v_user,revisado_em=now(),
   atualizado_em=now() where item_id=p_item;
  insert into public.sgq_inventario_conciliacao_eventos(inventario_id,item_id,acao,registrado_por,dados)
   values(p_inventario,p_item,'revisar',v_user,jsonb_build_object(
    'diferenca',v_delta,'status',v_next,'justificativa',v_note));
  return jsonb_build_object('ok',true,'status',v_next,'diferenca',v_delta);
 else
  raise exception 'Ação de conciliação não reconhecida.' using errcode='22023';
 end if;
end;
$$;
revoke all on function public.sgq_conciliacao_operar(text,uuid,uuid,numeric,text,text) from public,anon;
grant execute on function public.sgq_conciliacao_operar(text,uuid,uuid,numeric,text,text) to authenticated;
comment on function public.sgq_conciliacao_operar(text,uuid,uuid,numeric,text,text)
 is 'Fecha inventário e audita conciliação FST; nunca movimenta estoque nem altera saldos Omie.';
