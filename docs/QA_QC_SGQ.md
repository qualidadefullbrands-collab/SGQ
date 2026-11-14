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
