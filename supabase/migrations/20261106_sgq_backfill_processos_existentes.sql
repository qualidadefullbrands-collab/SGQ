-- Migração pontual SGQ (06/11/2026): apenas os seis processos ATIVOS conhecidos.
-- Mantém os UUIDs das inspeções, grupos, itens, evidências, amostras, laudos e histórico.
-- Registros excluídos/cancelados NÃO são reativados nem alterados.
-- O cadastro antigo cancelado "26152" impede reutilizar esse código único;
-- por isso o registro ativo "26152-B" passa a "FST26152" (mesma exibição).
--
-- Copia antes/depois em schema privativo, bloqueado à API de dados.
create schema if not exists sgq_audit;
revoke all on schema sgq_audit from public, anon, authenticated;

create table if not exists sgq_audit.migracao_processos_20261106 (
    processo_id uuid primary key,
    grupo_id uuid not null unique,
    inspecao_id uuid not null,
    codigo_anterior text not null,
    codigo_novo text not null,
    letra_subprocesso text not null,
    processo_antes jsonb not null,
    grupo_antes jsonb not null,
    status_inspecao_antes text not null,
    migrado_em timestamptz not null default now()
);
alter table sgq_audit.migracao_processos_20261106 enable row level security;
revoke all on sgq_audit.migracao_processos_20261106 from public, anon, authenticated;

do $migration$
declare
    v_expected text[] := array[
        '26152-B', '26125-B', '26223-A', '26314', '26151-A', '26169-A'
    ];
    v_count integer;
    v_updated_groups integer;
    v_updated_processes integer;
    v_archived_before integer;
begin
    -- Fail closed: stop if records or their relationships have changed.
    select count(*) into v_count
      from public.processos p
     where p.excluido_em is null and p.codigo = any(v_expected);
    if v_count <> 6 then
        raise exception 'Migração SGQ cancelada: esperados seis processos ativos, encontrados %', v_count;
    end if;
    if exists (
        select 1
          from public.processos p
          left join public.grupos_inspecao g on g.processo_id=p.id
          left join public.inspecoes i on i.grupo_inspecao_id=g.id
         where p.excluido_em is null and p.codigo=any(v_expected)
         group by p.id
        having count(distinct g.id)<>1
            or count(distinct i.id)<>1
            or bool_or(i.excluido_em is not null)
            or bool_or(i.it_versao_id is distinct from p.it_versao_id)
            or bool_or(g.subprocesso_codigo is not null)
            or bool_or(g.nota_fiscal is not null)
    ) then
        raise exception 'Migração SGQ cancelada: grupos, inspeções ou ITs já não correspondem ao levantamento';
    end if;
    if exists (
        select 1 from public.processos p
         where p.excluido_em is null
           and p.codigo=any(v_expected)
           and p.it_versao_id is null
    ) then
        raise exception 'Migração SGQ cancelada: IT principal não informada';
    end if;
    if exists (
        select 1
        from public.processos p
        join public.processos other
          on other.codigo =
             case when p.codigo='26152-B' then 'FST26152'
                  else regexp_replace(p.codigo,'-[A-Z]$','') end
         and other.id<>p.id
        where p.excluido_em is null and p.codigo=any(v_expected)
    ) then
        raise exception 'Migração SGQ cancelada: colisão no código do FST principal';
    end if;
    select count(*) into v_archived_before from public.processos where excluido_em is not null;

    insert into sgq_audit.migracao_processos_20261106 (
        processo_id,grupo_id,inspecao_id,codigo_anterior,codigo_novo,
        letra_subprocesso,processo_antes,grupo_antes,status_inspecao_antes
    )
    select p.id,g.id,i.id,p.codigo,
           case when p.codigo='26152-B' then 'FST26152'
                else regexp_replace(p.codigo,'-[A-Z]$','') end,
           coalesce(substring(p.codigo from '-([A-Z])$'),'A'),
           to_jsonb(p),to_jsonb(g),i.status
      from public.processos p
      join public.grupos_inspecao g on g.processo_id=p.id
      join public.inspecoes i on i.grupo_inspecao_id=g.id
     where p.excluido_em is null and p.codigo=any(v_expected);
    get diagnostics v_count=row_count;
    if v_count<>6 then
        raise exception 'Migração SGQ cancelada: apenas % snapshots feitos',v_count;
    end if;

    -- A letra e a NF pertencem ao subprocesso, NÃO ao FST principal.
    update public.grupos_inspecao g
       set subprocesso_codigo=a.letra_subprocesso,
           nota_fiscal=nullif(btrim(p.nota_fiscal),'')
      from sgq_audit.migracao_processos_20261106 a
      join public.processos p on p.id=a.processo_id
     where g.id=a.grupo_id;
    get diagnostics v_updated_groups=row_count;

    update public.processos p
       set codigo=a.codigo_novo,
           nota_fiscal=null,
           atualizado_em=now(),
           status=case
               when not exists (
                   select 1 from public.grupos_inspecao g
                   left join public.inspecoes i on i.grupo_inspecao_id=g.id
                   where g.processo_id=p.id
                   and (i.id is null or i.excluido_em is not null or i.status<>'concluida')
               ) then 'concluido'
               else p.status
           end
      from sgq_audit.migracao_processos_20261106 a
     where p.id=a.processo_id;
    get diagnostics v_updated_processes=row_count;

    if v_updated_groups<>6 or v_updated_processes<>6 then
        raise exception 'Migração SGQ cancelada: atualizações incompletas (grupos %, FSTs %)',
           v_updated_groups,v_updated_processes;
    end if;
    if exists (
        select 1
          from sgq_audit.migracao_processos_20261106 a
          join public.processos p on p.id=a.processo_id
          join public.grupos_inspecao g on g.id=a.grupo_id
          join public.inspecoes i on i.id=a.inspecao_id
         where p.codigo<>a.codigo_novo
            or p.nota_fiscal is not null
            or g.subprocesso_codigo<>a.letra_subprocesso
            or g.nota_fiscal is distinct from
                nullif(btrim(a.processo_antes->>'nota_fiscal'),'')
            or g.processo_id<>a.processo_id
            or i.grupo_inspecao_id<>a.grupo_id
            or i.status<>a.status_inspecao_antes
            or i.it_versao_id is distinct from p.it_versao_id
    ) then
        raise exception 'Migração SGQ cancelada: falha na verificação de integridade';
    end if;
    if (select count(*) from public.processos where excluido_em is not null)<>v_archived_before then
        raise exception 'Migração SGQ cancelada: total de históricos arquivados mudou';
    end if;
end
$migration$;
