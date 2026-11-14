# Plano de qualidade e controle de qualidade (QA/QC) — SGQ

**Aplicação:** app-sgq (React/PWA + API .NET + Supabase + Word/Omie).  
**Data da linha de base:** 13/11/2026, horário de Brasília.  
**Método:** `qa-project-context` → `risk-based-testing` → `release-readiness` da coleção QA Skills (MIT).  
**Situação:** plano técnico e testes verificáveis, **não** certificado de conformidade nem homologação de todas as jornadas.

## 1. QA e QC não são a mesma atividade

- **QA — garantia preventiva:** requisitos rastreáveis, contrato de API, revisão de PR, matriz de risco, teste antes do merge, definição de pronto, reversão e gestão de defeitos.
- **QC — verificação da entrega:** execução de testes, testes negativos, smoke HTTP real do ambiente publicado, evidências do Word, integridade de dados, inspeção visual e validação de resultados.
- Teste que apenas confere `assert.match(source, /.../)` protege contratos estruturais, **não** comprova execução do fluxo real.

## 2. Matriz de risco inicial

**Impacto (I) e probabilidade (P)** de 1–5; **R = I × P**. Os valores abaixo são hipóteses para priorização, baseadas na complexidade, integrações e alteração recente do SGQ, **não taxas de incidentes medidas**.

| ID | Jornada / falha evitada | I | P* | R | QC obrigatório antes de liberar |
|---|---|---:|---:|---:|---|
| R01 | Inventário salva contagem, mas foto Omie falha ou resultado é ambíguo | 5 | 4 | **20 crítico** | Testar persistência isolada, erro da foto, reenvio e idempotência com fixture |
| R02 | Conciliação usa saldo do Omie ou referência de outra localização | 5 | 3 | **15 crítico** | Testes negativos UI + constraint/RPC; origem física, SKU, endereço e evidência |
| R03 | Amostragem / Ac-Re incorreta reprova ou aprova lote indevidamente | 5 | 3 | **15 crítico** | Casos de fronteira NQA, critérios dimensionais e alteração auditada |
| R04 | Permissão incorreta expõe dados ou permite revisão indevida | 5 | 3 | **15 crítico** | 401/403 por perfil e testes RLS/RPC; nenhum token real nos logs |
| R05 | Falha offline duplica ou perde contagens, fotos ou inspeções | 4 | 4 | **16 crítico** | Fila offline, perda de conexão, reenvio e deduplicação |
| R06 | Word contém SKU ou subprocesso errado, fotos fora da IT | 4 | 3 | **12 alto** | Testes de modelo real, A/B, fotos, dimensões não feitas e nome do arquivo |
| R07 | Troca/versão de IT altera inspeção sem histórico ou invalida fotos | 4 | 3 | **12 alto** | Reinício da inspeção, reaproveitamento da foto, vigência e auditoria |
| R08 | Front React publica sem corresponder ao SHA testado | 4 | 3 | **12 alto** | Comparar GitHub `main`, CI e commit live Render; smoke após deploy |
| R09 | Navegação responsiva inacessível ou com regressão visual | 3 | 3 | **9 médio** | Verificação mobile, teclado, foco e audit WCAG |
| R10 | Indicadores de painel desatualizados ou incorretos | 3 | 2 | **6 médio** | Contratos de dados, distinção de zero, indisponível e loading |

`* P` = suposição de planejamento a calibrar com logs, incidentes e histórico de bugs. Revisar após cada incidente, mudança de fornecedor, versão de IT, ajuste de integração ou alteração em tabela crítica.

### Modos de falha prioritários
- **R01:** API registra contagem mas upload Omie retorna erro. Esperado: contagem preservada, foto pendente/erro, retry explícito, sem sobrescrever outra imagem.
- **R02:** operador informa origem textual `Omie` ou tenta fechar pela RPC. Esperado: origem não admissível no banco, divergência não pode ser aprovada/fechada e decisão anterior permanece auditada.
- **R03:** mudança de quantidade/lote altera `n`, Ac/Re ou aprovação. Esperado: recálculo determinístico; comparação com tabela oficial e boundary tests.
- **R04:** sessão ausente ou papel insuficiente tenta acessar rota protegida. Esperado: 401/403, nenhuma escrita, nenhum vazamento de dados sensíveis.
- **R05:** rede cai após salvar quantidade e antes de foto. Esperado: nenhuma dupla contagem e estado de sincronização legível.
- **R06/R07:** IT ou subprocesso troca durante edição. Esperado: versão/identidade correta no Word e trilha de alterações.

## 3. Matriz de rastreabilidade (amostra de cobertura)

| Requisito | Evidência automatizada existente | Lacuna e decisão QC |
|---|---|---|
| Inventário por FST, SKU e localização | `tests/sgq-inventario-unificado-uma-foto.test.mjs` | Fluxo E2E autenticado e falha de rede: **pendente** |
| Foto: envio Omie e falha idempotente | `tests/sgq-omie-photo-cdn-verification.test.mjs` | Teste de integração com sandbox/conta sintética: **pendente** |
| Quantidade Omie excluída da conciliação | `tests/stock-quantity-policy.test.mjs`, `tests/sgq-conciliacao-referencia-local.test.mjs` | Teste RPC real com transação e dados sintéticos: **pendente** |
| Fluxo da IT e laudo Word | `server/tests`, `tests/process-save-and-word-readiness.test.mjs` | Inspeção visual dos arquivos Word em caso real: **pendente** |
| Controle de acesso e rota protegida | `tests/http-smoke.test.mjs` (depende de `SGQ_TEST_API_URL`) | Smoke público obrigatório fora do teste local, sem token: **implantado neste trabalho** |
| Front ativo responde e carrega assets | Não comprovado pela suíte Node de código-fonte | Smoke público do frontend: **implantado neste trabalho** |
| E2E de navegação React / acessibilidade | Sem framework browser configurado | Adotar Playwright/axe em ambiente isolado: **pendente** |

## 4. Gate de liberação (GO / NO-GO)

**Critério de GO** — todas as evidências devem ter SHA, ambiente e data:
- [ ] CI verde para o **commit candidato** (testes Node, build TypeScript/Vite, build .NET, Word e Edge).
- [ ] Nenhum defeito P0/P1 aberto relacionado à versão.
- [ ] Smoke público (frontend raiz/assets + API health + 401 anônimo + amostragem) executado de fato. **Skipped/blocked não conta como aprovado.**
- [ ] Para mudança crítica: teste de integração/E2E com massa sintética, incluindo erro e reprocessamento, aprovado.
- [ ] Para mudança de banco: migração versionada, pré-verificação de dados, teste negativo e evidência da constraint/RPC, com plano de recuperação.
- [ ] Critérios de aceite e impacto no fluxo da Qualidade revisados por responsável autorizado.
- [ ] Publicação manual Render concluída; commit **live** comparado ao commit aprovado; QC pós-deploy executado.
- [ ] Estratégia de reversão documentada para frontend/API; banco requer procedimento compatível com dados reais.

**Decisão:** `GO`, `NO-GO` ou `BLOQUEADO`, com responsável, data, versão, evidência e riscos aceitos. Nenhuma contagem de testes autoriza `GO` sozinha.

## 5. QC de produção — smoke somente leitura

### Execução
- Workflow `.github/workflows/sgq-qa-qc-smoke.yml`, acionamento manual e em PR.
- Script `tests/qa/production-smoke.mjs`, usando `SGQ_QC_FRONTEND_URL` e `SGQ_QC_API_URL`.
- Apenas HTTP GET público, sem token, sem operação de escrita e sem CPF/FST/NF real.
- Checa HTML React e pelo menos um asset, saúde da API, plano público de amostragem e 401 para rota protegida.
- Logs com status e duração; falha de rede/endpoint/variável faltante = **FAIL**, nunca sucesso oculto por skip.

### Limitações
- Smoke não autentica, não executa inventário, não compara Word, não verifica consistência transacional de banco.
- Browser E2E/console, WCAG e performance são gates adicionais a construir em ambiente isolado.
- Render `autoDeploy=off`; não usar resultado de smoke da versão anterior como prova da versão recém-integrada.

### Evidência real — primeira execução do smoke

- Execução [#43536939385](https://github.com/qualidadefullbrands-collab/SGQ/actions/runs/43536939385), 14/11/2026 00:51 UTC: **2 PASS / 3 FAIL / 0 SKIP**. HTML e bundle React passaram; três acessos API retornaram HTTP 503.
- Logs do Render `app-sgq-api`: processo auxiliar iniciou às 00:51:53 UTC e ASP.NET Core ficou disponível às 00:51:56 UTC, **depois** das requisições 503. Causa provável: inicialização após ociosidade em instância Free; não há evidência de falha de build.
- Issue [#78](https://github.com/qualidadefullbrands-collab/SGQ/issues/78) acompanha risco de disponibilidade. O script registra 503 transitório e aguarda o endpoint real de prontidão, com limite de 90 segundos; **503 persistente continua FAIL**.
- Não converter a primeira falha histórica em sucesso. Em caso de recuperação tardia, registrar a latência como **degradação**, mesmo se as demais verificações passarem.

## 6. Defeitos e release
- **P0:** segurança/dados críticos comprometidos ou indisponibilidade abrangente → interromper release e responder ao incidente.
- **P1:** fluxo crítico bloqueado, divergência sem auditoria, foto/Word com risco de perda ou dado incorreto → bloquear GO.
- **P2:** erro funcional com contorno confiável → registrar issue e decisão de aceite de risco.
- **P3:** apresentação/cópia/estética sem risco operacional → backlog com evidência.

Em cada issue: versão/ambiente, passos, esperado/obtido, evidência sanitizada, prioridade, impacto, teste de regressão e resultado após correção. Não incluir dados pessoais ou credenciais.

## 7. Fontes
- `README.md`, `package.json`, `.github/workflows/sgq-validation.yml`, `tests/http-smoke.test.mjs` e suites de domínio do repositório.
- QA Skills (MIT): https://github.com/petrkindlmann/qa-skills — `risk-based-testing`, `release-readiness`, `ai-qa-review`.
- Nenhuma ferramenta externa de QA foi instalada na máquina do usuário por este documento.


## 8. Testes E2E do React — ambiente sintético isolado

### Implementação e execução
- `npm run test:e2e`, `playwright.config.mjs`, `e2e/fixtures/isolated.mjs`.
- GitHub Actions `.github/workflows/sgq-e2e-isolated.yml`: Chromium desktop e emulação móvel Pixel 7; evidências HTML, trace e screenshots de falha.
- Inicia Vite **local** em `http://127.0.0.1:4178`, com `VITE_API_URL=https://sgq-api.qa.invalid` e `VITE_SUPABASE_URL=https://sgq-auth.qa.invalid`. O mock intercepta toda rede externa, permite autenticação **apenas sintética** e **não** permite gravações operacionais.
- Fluxos: login inválido, login sintético, navegação IT, pesquisa/filtros, estoque/conciliação física, senha expirada, visualização mobile, axe em login/recuperação.
- Não criar credenciais reais, acessar dados da empresa, alterar Supabase nem enviar conteúdo ao Omie por esses testes.
- A emulação mobile comprova responsividade do navegador, **não** comportamento em iPhone/Android físicos.

### Status de cobertura
- Testes de UI isolada: implementados, sujeitos a evidências da execução CI da PR específica; não contam como testes reais de autenticação Supabase, integrações Omie, persistência de fotos, banco/RPC, Word ou tratamento de falhas de dados.
- Para concluir a issue #79 integralmente ainda é necessário preparar um projeto SGQ de homologação com dados e papéis sintéticos, migrar schema, habilitar API/Storage/Edge de sandbox, e executar fluxos autenticados de gravação com rollback/limpeza.
- Falhas de axe-core sérias/críticas devem gerar correção de acessibilidade, sem permitir filtros silenciosos ou saltar testes.


## 9. Integração PostgreSQL efêmera — conciliação física

**Finalidade:** confirmar que o PostgreSQL executa as mesmas regras de fonte física local e os bloqueios reais da RPC, além dos testes Node que apenas leem o SQL.

- Workflow: `.github/workflows/sgq-db-integrity.yml`, em PR e manual, runner GitHub Actions com PostgreSQL 16 descartável.
- Bootstrap: `tests/integration/postgres/bootstrap.sql` com tabelas/usuários **exclusivamente sintéticos**, `auth.uid()` e resolvedor de perfil simulado, sem importar dados ou credenciais.
- **Migrações reais** aplicadas no banco efêmero, sem edição ou cópia: `20261113193000_sgq_conciliacao_pos_inventario_fst.sql` e `20261114003316_sgq_conciliacao_referencia_local.sql`.
- Assertivas SQL: constraint ativa/validada, trigger habilitado, ausência de permissionamento de escrita no navegador, rejeição de referência quantitativa Omie, aceitação das três fontes físicas, recusa de fechamento pendente, trilha de eventos, recontagem, aprovação justificada, diferenciação de papéis e comportamento de RLS.
- Teste negativo de legado: remover temporariamente a constraint **no banco efêmero e em uma transação que é revertida**; verificar que o trigger impede conclusão com origem Omie mesmo assim.
- Nenhum projeto Supabase externo é acessado; não cria custos de projeto ou registros operacionais. Falha SQL cancela o workflow e preserva log por 30 dias.

**Limitações de evidência:** é PostgreSQL real com DDL de conciliação real, mas o ambiente não reproduz toda a estrutura Supabase: `auth.uid()`, `private.current_sgq_role()`, funções gerenciadas, políticas de Storage e tabelas pré-existentes estão simuladas/minimizadas. Isso comprova a execução dos contratos SQL de conciliação em isolamento, **não** a homologação completa de Supabase Auth/RLS/Storage/Edge/Omie. A issue #79 permanece aberta até o ciclo integrado.


## 10. Integração Auth e Storage locais — Supabase em CI

- Workflow `.github/workflows/sgq-auth-storage-local.yml`: inicia GoTrue Auth, PostgreSQL, Storage, API Gateway e PostgREST via Supabase CLI **v2.84.2** numa pasta temporária do GitHub Actions, sem `supabase link` e sem credenciais/projetos hosted.
- O arquivo `tests/integration/supabase-local/setup.mjs` **extrai e executa, sem reescrever**, a seção original de buckets e políticas Storage da migração `20261113080000_sgq_inventario_cego_omie_fotos.sql`.
- O setup local cria somente a tabela de inventários mínima e uma implementação **simulada** de `private.current_sgq_role()`, ligada a usuários sintéticos; **não reproduz** o cadastro/perfis de produção.
- `auth-storage.test.mjs` cria contas por Admin Auth local e realiza login real com senha/JWT. Em Storage verifica upload/foto PNG, leitura privada, duplicate `upsert=false`, prefixo de usuário, sessão fechada, perfil somente consulta, acesso anônimo, leitura permitida, MIME e limite 8 MiB.
- Somente `localhost/127.0.0.1` são aceitos pela suite. Nenhuma URL ou token de produção entra no teste; secrets local-only ficam no diretório temporário do runner e não são publicados como artifacts.
- Resultado do CI deve ser considerado **PASS apenas após execução**, não pela presença do arquivo ou criação da PR.

**Limitação:** Auth, gateway e Storage são serviços reais *locais*; a função de papel e o cadastro de inventário são simulações mínimas. Essa etapa verifica políticas originais e comunicação entre serviços, mas ainda **não** testa toda a API .NET, a autenticação/perfis reais do projeto hospedado, Edge Functions/Omie ou geração Word. O item #79 continua parcialmente aberto até a homologação ponta a ponta em ambiente isolado.


## 11. Teste HTTP real API .NET → Word FastAPI com dados sintéticos

A workflow `.github/workflows/sgq-api-word-http.yml` compila e inicia **o backend ASP.NET Core 10 real** e **o servidor FastAPI/Word real** em `127.0.0.1` no GitHub Actions. O projeto de produção não é acionado.

- `tests/integration/api_word/mock_supabase.py`: somente **Auth/PostgREST/Storage simulados**, com FST fictício, subprocessos A/B, duas inspeções concluídas, duas fotos PNG sintéticas e autorização dos tokens `qc-ready`, `qc-pending`, `qc-missing-photo`. Qualquer escrita no stub retorna HTTP 405. Nenhuma conexão com projetos Supabase externos ou Omie.
- `tests/integration/api_word/run.py`: configura URLs locais de API, Word e stub; inicia os serviços, espera readiness, executa a suite e encerra os processos, com logs para falhas.
- `tests/integration/api_word/test_api_word.py`: valida `/health/word` (self-test Word com 8 modelos), falta de Bearer ou token inválido (401), parâmetros inválidos (400), consulta real de prontidão (A/B), bloqueio de Word sem foto (409), laudo consolidado (A+B), opção individual, DOCX/ZIP legível, conteúdo por SKU e evidências, falha de foto física (503) e verificação do stub somente leitura.

**Escopo comprovável:** chamadas HTTP reais, geração `.docx` com `python-docx`, leitura/propagação de erros e identificação de subprocessos. **Limites:** não usa Supabase Auth real, políticas RLS reais, tabelas da produção, nem Storage real nesta etapa; a suite local Auth/Storage da PR #86 e a suite PostgreSQL da PR #85 cobrem aspectos complementares, mas **não constituem um único teste ponta a ponta com todos os serviços reais**. A issue #79 permanece aberta para essa integração completa.
