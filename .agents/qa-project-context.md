# Contexto QA/QC — SGQ

**Fonte e revisão:** repositório `qualidadefullbrands-collab/SGQ` (branch `main`, 13–14/11/2026), `package.json`, `README.md`, `.github/workflows/sgq-validation.yml`, testes e serviços Render. Este documento descreve estado **observado**, não certificação de produção.

## Produto
Ferramenta interna de Sistema de Gestão da Qualidade (SGQ) para inspeções, ITs, laudos, amostras, estoque/inventário, auditorias e integrações.

**Jornadas de maior impacto:**
1. Login, perfis e acesso aos dados autorizados.
2. Cadastro de processo/entrada e seleção de SKU/IT.
3. Amostragem, verificações, dimensionais, fotos, conclusão e retificação auditada.
4. Geração de laudo Word sob demanda e fidelidade do formulário/IT por SKU/subprocesso.
5. Inventário FST por localização: contar, salvar uma foto, recuperar falha de envio sem perder contagem.
6. Conciliação: referência física do SGQ na mesma localização; Omie somente código/descrição, nunca quantidades.
7. Retenção/movimentação de amostras com trilha de auditoria.
8. Integração Omie, alertas de PV, erro de API e sincronização de fotos.
9. Auditorias e inspeções de armazém, equipamentos e evidências.

## Tech Stack
- **Frontend:** React 19, TypeScript 5.9, Vite 7; PWA, hospedado em Render Static Site `app-sgq` (`https://app-sgq.onrender.com`).
- **API:** ASP.NET Core / .NET 10, Render `app-sgq-api` (`https://app-sgq-api.onrender.com`).
- **Persistência:** Supabase PostgreSQL, Supabase Auth, Storage e Edge Functions; projeto `app-sgq`. Consulta de catálogo Omie separada de saldo de inventário.
- **Word:** `server/` com testes Python; worker/integrações auxiliares conforme `README.md`.
- **Git:** `qualidadefullbrands-collab/SGQ`, branch de entrega `main`.

## Test Stack — detectado
- **Frontend/contratos:** `node --test tests/*.test.mjs`; muitos testes verificam padrões do código-fonte, além de testes funcionais de funções isoladas.
- **API:** `dotnet build` no CI. Não presumir teste de integração de API apenas a partir do build.
- **Word:** `python -m unittest discover -s server/tests -v`.
- **Edge:** `deno check --node-modules-dir=auto supabase/functions/sgq-inventario-omie/index.ts`.
- **HTTP:** `tests/http-smoke.test.mjs` contém testes reais, mas usa `skip` quando `SGQ_TEST_API_URL` não existe. Na execução #519, 314 casos Node, 309 aprovados, 5 ignorados. O total **não é medida de cobertura de linhas**.
- **E2E navegador, visual, acessibilidade automática:** não foi identificado Playwright/Cypress configurado no `package.json`; **não afirmar executados**.
- **QC de publicação:** workflow separado de smoke público sem credenciais, no caminho `tests/qa/production-smoke.mjs` (a partir desta implementação).

## CI/CD
- `.github/workflows/sgq-validation.yml` em push/PR para `main` e disparo manual.
- Quatro jobs: frontend, api, word, inventory-photo-edge.
- O frontend do Render utiliza **autoDeploy desativado**; merge não implica produção publicada.
- Toda evidência deve vincular **SHA do commit**, **SHA efetivamente publicado**, ambiente, data/hora, testes aprovados/falhos/ignorados/bloqueados e URL do workflow.

## Ambientes
- **Produção:** URLs acima; não usar dados operacionais reais para testes com gravação.
- **Homologação isolada com credenciais sintéticas:** não foi comprovada. Fluxos autenticados e de escrita são **bloqueados para automação** até existir ambiente e massa de teste dedicados.
- **Preview branches existentes:** não equivalem automaticamente a homologação atual.

## Qualidade — metas propostas, ainda não medidas
- Zero falhas de P0/P1 abertas na liberação.
- 100% das verificações públicas de smoke configuradas e executadas no gate de release; `skip` em smoke obrigatório implica gate incompleto.
- Toda mudança de conciliação/inspeção/Word deve ter teste negativo/limite relevante e teste positivo.
- Testes de browser E2E para jornadas críticas e critérios WCAG 2.2 AA a implementar após ambiente de testes dedicado.
- Registrar duração da suíte, taxa de instabilidade e incidentes por release; não inventar cobertura medida.

## Riscos operacionais iniciais
Matriz e hipóteses em `docs/QA_QC_SGQ.md`. Evidências existentes: fluxo de fotos/Omie e erros de API, regra quantitativa da conciliação, testes do Word, dependência do Render/Supabase. Probabilidades ainda são **estimativas preliminares**, não estatística observada.

## Responsabilidade, processo e convenções
- Autores/revisores/aprovadores: definidos pelo fluxo de governança da empresa; não atribuir nomes sem uma designação atual.
- Testes Node: `tests/*.test.mjs`, assertivas com `node:assert/strict`.
- Smoke de produção: separado em `tests/qa/production-smoke.mjs`, somente GET e sem token, deve falhar quando configuração obrigatória falta.
- Seletores de futuros testes browser: preferir papéis/nomes acessíveis e `data-testid` estável nas ações críticas.
- Correções seguem branch/PR → CI → revisão → deploy manual Render → QC pós-deploy com evidência.
- Sem credenciais, notas fiscais reais, CPF ou dados pessoais em fixtures, logs ou commits.

## Skills externas aplicadas como método (não instaladas como código executável)
Biblioteca MIT `petrkindlmann/qa-skills`: `qa-project-context`, `risk-based-testing`, `release-readiness`, `ai-qa-review`. Referência: https://github.com/petrkindlmann/qa-skills
