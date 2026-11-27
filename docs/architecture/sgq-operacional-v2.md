# SGQ operacional — especificação de arquitetura e aceitação

Status: proposta de implementação, ainda não publicada em produção.
Baseline: 874271ed49074bfd17bff388a30dcc0930006092.
Objetivo: permitir a execução de uma inspeção real com o menor esforço administrativo possível e gerar o documento oficial completo automaticamente.

## Restrições não negociáveis
- Custo incremental zero: manter planos gratuitos e stack atual (React/Vite, ASP.NET, PostgreSQL/Supabase, Word/FastAPI, Render). Não contratar IA, serviços de OCR, filas, armazenamento ou servidores. Não aumentar planos. Serviços existentes devem ser opcionais quando não essenciais.
- Dados históricos, ITs publicadas e versões, instrumentos, RLS/Auth, evidências originais, laudos e trilhas de auditoria preservados. Nada de exclusão física ou mudança silenciosa de requisitos.
- Omie é referência comercial/documental, não estoque físico. Quantidade de pedido/NF e recebimento real são campos distintos.
- Documento oficial de referência fornecido pela responsável é confidencial; este repositório público deve conter somente exemplos sintéticos, sem o arquivo, imagens ou identificadores reais.
- Uma tarefa concluída significa comportamento funcional demonstrado, não apenas compilação, teste de regex ou resposta HTTP 200.

## Diagnóstico do baseline
- App.tsx concentra aproximadamente 5,2 mil linhas e decisões de navegação, rede, edição, execução e persistência offline. NewInspectionGuide é navegação por âncoras de um formulário, e InspectionJourney fixa oito etapas, inclusive as que podem não se aplicar. O progresso conta quatro etapas técnicas fixas.
- API CreateIndependentInspectionBatch agrupa por SKU e envia SubprocessoCodigo=null para o motor existente, que reserva letras distintas. Isto confunde recebimento físico com unidade de inspeção.
- server/app.py gera Word por processo, mas usa um mapa by_group que escolhe apenas uma inspeção por grupo. Não admite simplesmente acrescentar múltiplas inspeções ao mesmo grupo sem adaptar a seleção, a prontidão e a geração de anexos.
- Reclassificação no PR 102 ainda não validada (integração com banco falhou). Não publicar nem tratar o modelo daquele PR como definitivo.
- Atrasos devem ser localizados por ação e requisição, separando cold start, transferência, renderização e persistência. Não há baseline autenticado completo que comprove os ganhos.

## Decisão de arquitetura
Refatoração incremental por fluxo vertical, não reescrita destrutiva nem novos remendos visuais. Reutilizar os motores de cálculo, permissões, evidência e documentos após testes de equivalência. Isolar a lógica de negócio em funções testáveis e os componentes de UI por responsabilidade. Criar uma nova experiência atrás de configuração de release reversível; manter acesso às funções existentes até demonstrar equivalência.

### Modelo operacional
1. FST: processo comercial.
2. Entrada/recebimento: letra ou identidade operacional real, NF, chegada, logística e itens físicos. Uma entrada pode conter vários SKUs.
3. Unidade de inspeção: um SKU independente/lote conforme critérios aplicáveis ou um conjunto confirmado de componentes. N unidades de inspeção podem pertencer à MESMA entrada. Identidade técnica distinta da letra visível.
4. Cada unidade possui própria IT versionada, plano estatístico, estado, resultados, evidências e decisão. Componentes de kit mantêm seus vínculos e resultados atribuíveis. Não inferir composição apenas por FST, PV, cliente ou IT.
5. Documento: agrupa unidades de inspeção do escopo aprovado do FST/entrada; reproduz cada IT oficial necessária uma vez, preservando versões e anexos por unidade. Para a mesma IT e entrada, um caderno e vários registros, todos com o mesmo código de entrada. Confirmar regra já existente para recebimentos diferentes antes de alterá-la.

Mapeamento físico preferencial: avaliar entidade explícita de recebimento acima de grupos de inspeção, mantendo IDs e FKs atuais. Alternativa é um identificador de recebimento no grupo com FK e restrição coerente. Escolher depois de inspecionar constraints, RLS, consultas, documentos e registros legados; não inferir retrospectivamente que letras antigas são o mesmo recebimento sem confirmação. Migração aditiva, auditável, rollback compatível; não alterar ou apagar laudos históricos.

## Fluxo principal
### Identificar
Uma busca FST/pedido, retorno de cliente, produtos e dados disponíveis. Dados comuns editáveis em um único local. Tabela curta para validar recebido, caixas, lote e divergências. Valores comerciais são identificados como tais, jamais assumidos como conferência física. Campos raros sob detalhes, sem esconder pendências obrigatórias.
### Planejar
Sugestões determinísticas: combinação exata já confirmada, IT publicada validada para SKU/contexto, nível previsto. Exibir origem e permitir correção. Classificar imediatamente após seleção de SKUs: independentes, kit ou agrupamentos mistos. Permitir selecionar subconjuntos e razão de unidades por kit. Não inferir quantidades ou classificação sem confirmação. Calcular amostragem/Ac/Re e caixas pela regra aprovada, com prévia e validação da divergência.
### Executar
Um workspace por recebimento, com seleção rápida da unidade de inspeção. Próxima tarefa é derivada de requisitos da IT + progresso confirmado + bloqueios. Dados preenchidos não reaparecem como tarefa. Dimensionais e testes aparecem somente quando aplicáveis. Evidência suplementar não implica obrigação técnica. Mostrar verificação com instrução curta, critério e Conforme/Não conforme/Não se aplica. Permitir ação em lote para verificações efetivamente realizadas e SKUs explicitamente selecionados, com confirmação; NA exige motivo quando requerido. Não aprovar por padrão, não copiar resultados históricos. Auto-save local e sincronização segura; erros claros, não perder digitação.
### Evidenciar e concluir
Captura em lote vinculada à unidade/componente/tarefa, sugestões simples de legenda e numeração determinística, fotos processadas para limitar transferência sem perda de evidência necessária. Não presumir conteúdo de foto. Retenção: registrar quantidade e motivo reais; saldo calculado, sem movimentação automática no Omie. Resultado sugerido somente a partir de registros confirmados e critérios aprovados, com aprovação humana autorizada. Pendências acionáveis, botão único para gerar Word quando pronto.

## Correção de classificação
Antes de execução: prévia com destinos, vínculos, ITs, planos, motivo; transação, idempotência, controle de concorrência e auditoria. Reusar o recebimento, não criar outra letra. Agrupar subset selecionado, mantendo terceiros.
Depois de execução: não mover evidências de maneira silenciosa. Preservar revisões originais; atribuição verificável de cada registro, confirmar o que pode ser reaproveitado e o que exige nova medição. Fluxo explícito de retificação e revisão, com documentos anteriores imutáveis e versão atual. Bloqueio seguro até esse fluxo existir. Não transformar falta de implementação em instrução para recadastrar manualmente.

## Performance e capacidade gratuitas
Instrumentar tempos no navegador (interação, dados, pronto para agir) e API (endpoint, duração e contagem de chamadas, sem dados sensíveis). Medir cold start e warm separadamente, p50/p95 em amostra definida e em condições iguais. Metas propostas: navegação com feedback imediato, resumo utilizável em até 2s p95 warm e sem consultas serializadas dispensáveis; escrita de registro com feedback local imediato e sincronização observável. Não prometer metas sem medida. Paginação e seleção de colunas, consulta agregada e índices justificados por EXPLAIN, cache por usuário/versão com invalidação, lazy-load de módulos e imagens. Usar geração Word existente; evitar buscas repetidas por anexo e downloads de fotos duplicados. Monitorar limites atuais de storage, transferência e banco; evitar keep-alive artificial e serviço pago. Operação offline já existente deve ser preservada e testada. Sem dados reais em logs/CI.

## Critérios de aceitação funcional (sintéticos)
| Caso | Resultado exigido |
| --- | --- |
| Dois SKUs distintos na entrada A, mesma IT | Dois registros e planos separados com a mesma entrada A; uma IT e dois anexos em um DOCX |
| Resultados divergentes | Cada anexo representa seu próprio resultado; não propaga reprovação automaticamente |
| Kit 1+2 | Uma unidade de inspeção; quantidades, plano, fotos e achados atribuíveis aos componentes |
| Recebimento misto | Dois SKUs como kit e terceiro independente sem nova letra artificial |
| IT sem dimensionais | Nenhuma tarefa dimensional obrigatória; fotos com medição podem ser anexadas |
| IT com dimensão e teste obrigatório | Conclusão bloqueada se requisito real faltar; NA só conforme regra e confirmação |
| Retenção | Quantidade recebida, retida e saldo consistentes; preservação dos valores originais |
| Word | IT oficial preservada, anexos completos (identificação, amostragem, checklist, decisão, observações, evidências), cabeçalho/rodapé/paginação e fotos em ordem; não só busca de texto |
| Correção | Separar/agrupar antes da execução, transação idempotente, sem apagar históricos; pós-execução exige revisão |
| Regressão | ITs e Equipamentos acessíveis, consulta/edição, login, permissões, mobile, offline, upload e histórico; sem reabrir módulo não solicitado |
| Segurança | RLS com identidades reais isoladas; não permitir vincular SKU ou evidência de outro FST sem autorização |

Massa de teste inteiramente sintética com duas unidades independentes, mesma IT, uma entrada, checklists diferentes e evidências próprias. Comparar documento produzido com referência estrutural; renderizar e conferir páginas em QA, sem publicar o documento do cliente. A regra de amostragem registrada no exemplo real deve ser comparada com o cálculo vigente e a IT antes de adotar valores como norma geral.

## Métricas de sucesso operacional
Medir do FST até Word pronto: campos digitados, cliques/toques, telas, repetições de campos comuns, retrabalho, tempo ativo do operador e espera por rede (separados). Comparar com a versão atual no mesmo cenário sintético; meta proposta reduzir pela metade ações administrativas sem reduzir verificações técnicas. Teste de primeira utilização: operador sem orientação deve localizar o recebimento, registrar resultados/NA, anexar evidência e localizar o Word. Não declarar “dispensa treinamento” sem validação de uso por uma pessoa.

## Ordem de implementação e release
1. Congelar baseline, adicionar testes comportamentais que exponham a confusão entrada/SKU e a exigência indevida de etapas. Rever PR 102 antes de merge.
2. Modelo de recebimento e seleção correta de unidades na API/Word. Migração aditiva validada em PostgreSQL isolado, sem gravar produção como teste. Verificar também serviço Word em branch/deploy separado.
3. Identificação e planejamento assistido. Reutilizar Omie/catálogo, testar valores comerciais vs físicos, confirmar classificação cedo.
4. Workspace dirigido por tarefa e IT; seleção rápida, registro em lote confirmado, retomada, estados de erro, fotos.
5. Retenção/conclusão/documento e retificação, conforme IT e critérios existentes.
6. Testes reais de integração, snapshots de documento e navegador desktop/mobile; medir baseline e candidato. Validar permissões, offline, histórico, ITs e equipamentos.
7. Publicação incremental e reversível, verificar SHA e smoke pós-deploy. Não declarar homologação humana a partir de CI. Sem alteração do plano contratado.

## Referências metodológicas
Consultadas como referências, sem instalar código externo:
- https://github.com/obra/superpowers/tree/main/skills/brainstorming
- https://github.com/obra/superpowers/tree/main/skills/systematic-debugging
- https://github.com/obra/superpowers/tree/main/skills/verification-before-completion
- https://github.com/openai/plugins/tree/main/plugins/build-web-apps/skills/frontend-app-builder
