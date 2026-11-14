# SGQ — Design System Master

> Direção de UX/UI validada a partir das regras e catálogos da **UI/UX Pro Max**, adaptada ao SGQ React existente.
> Fonte: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/.claude/skills/ui-ux-pro-max/SKILL.md
> Iniciativa: #72 | PR inicial: #73 | Referência: 13/11/2026

## Contexto e direção
- **Produto:** sistema interno de gestão da qualidade, inspeção e rastreabilidade; React 19 + TypeScript + Vite/PWA, API .NET 10.
- **Público e tarefas:** inspetores e operação de armazém (desktop, tablet e celular), qualidade e gestão.
- **Estilo:** *Minimalism & Swiss Style* + *Accessible & Ethical* + densidade controlada de *Data-Dense Dashboard* (não aplicar estética de landing page nem tendências decorativas).
- **Prioridade:** concluir tarefas sem erros; legibilidade e feedback > animações/efeitos.
- **Identidade:** preservar navegação azul-marinho, superfícies brancas e azul de ação atualmente adotados. Não redesenhar marca nem trocar toda a paleta para seguir exemplo genérico da skill.

## Tokens semânticos base
| Token | Valor | Uso |
|---|---|---|
| --sgq-ui-ink | #112D50 | Texto principal em superfícies claras |
| --sgq-ui-subtle | #526D8F | Texto auxiliar em branco (contraste 5,33:1) |
| --sgq-ui-blue | #0875BD | Ação e links em superfícies claras |
| --sgq-ui-blue-dark | #055287 | Hover e ênfase |
| --sgq-ui-blue-soft | #EDF6FD | Seleção/foco contextual |
| --sgq-ui-white | #FFFFFF | Card/superfície |
| --sgq-ui-border | #DBE5F1 | Divisórias secundárias |
| --sgq-ui-focus | #176FAC | Foco em fundo claro (5,38:1 vs branco) |
| --sgq-ui-focus-inverse | #F7BD49 | Foco sobre sidebar azul-marinho |
| --sgq-ui-success-ink | #08765E | Texto de sucesso em branco |
| --sgq-ui-error-ink | #B42318 | Erro/ação destrutiva |

Cores representam **semântica**, jamais a única informação sobre estado. Preservar valores existentes de negócio. Não trocar contraste medido por valores de catálogo que não combinem com a identidade.

## Tipografia e ritmo
- Família: **Inter**, já definida no CSS global; fallback para sistema.
- Corpo padrão pretendido: 14–16px; textos críticos de campo/resultado >=14px; auxílio >=12px, sempre com contraste adequado.
- Títulos: hierarquia H1/H2/H3, evitando várias chamadas principais por página.
- Escala de espaçamento: 4 / 8 / 12 / 16 / 24 / 32px; margens de página 16–28px conforme viewport.
- Cards com borda leve, raio 10–16px e sombra discreta; hierarquia por agrupamento e espaço, não por muitos gradientes.
- Tabelas densas apenas onde agregam; em celular, refluem para linhas/cartões úteis, sem esconder ações obrigatórias.

## Padrões de interação — obrigatórios
1. **Acessibilidade:** texto normal mínimo 4,5:1, componentes não textuais 3:1, indicador de foco visível; rótulos persistentes para inputs; ícones decorativos fora da árvore de acessibilidade.
2. **Mobile/touch:** alvos principais de pelo menos 44x44 CSS px quando `pointer:coarse`; 8px entre ações próximas; manter zoom/pinch do navegador.
3. **Navegação:** menu atual identificável visualmente e via `aria-current`; ações primárias previsíveis; caminho de retorno consistente; atalho “Pular para o conteúdo”.
4. **Formulários:** validação próxima ao campo, sem sobrescrever entradas; manter rascunho e avisar antes de perder alterações; diferenciar campo obrigatório/opcional.
5. **Feedback:** usar texto + indicador para carregando, erro, sucesso e pendência; evitar esconder processos lentos atrás de spinner eterno; bloquear apenas ação que realmente não pode repetir.
6. **Persistência:** status offline/sincronização visível; na falha de foto/Omie preservar a contagem/inspeção já salva e oferecer nova tentativa.
7. **Responsividade:** testar 320, 375, 768, 1024 e 1440px; nenhum formulário crítico exige rolagem horizontal para funcionar.
8. **Performance:** lazy loading por rota/funcionalidade, componentes pequenos e foco em interações de baixo custo. Extrair gradualmente fluxos monolíticos do `App.tsx`.
9. **Animação:** 120–200ms apenas em feedback leve; respeitar `prefers-reduced-motion`. Evitar transições que desloquem campos sob o cursor.
10. **Dominial:** o React apresenta; o backend .NET permanece autoridade para amostragem, regras Ac/Re, integridade, API Omie e geração de documentos.

## Padrões por módulo
| Módulo | UX principal | Decisões de UI |
|---|---|---|
| Dashboard | Identificar pendências e agir | Indicadores clicáveis, exceções acima de contagens cosméticas, filtros persistentes |
| Processos / Inbox Omie | Conferir origem e recebimento | FST/NF/cliente/itens agrupados, estados de consulta, revisão antes de aplicar dados |
| Nova inspeção | Concluir cadastro sem perder contexto | Formulário dividido em etapas, resumo persistente e mensagens próximas ao campo |
| Execução | Avaliar produto sem se perder | Barra de progresso, SKU/lote/IT visíveis, salvar/avançar, suporte offline |
| Laudos | Conferir antes de gerar | Preview fiel, agrupamento por SKU/subprocesso, geração Word com status claro |
| ITs | Controlar a versão correta | Estados Vigente/Em revisão/Rascunho/Obsoleto, histórico e ações contextualizadas |
| Estoque/Amostras | Localizar e movimentar com confiança | Busca por SKU/endereço, QR/etiquetas, saldos e origem auditáveis |
| Inventário | Contagem rápida e rastreável | Localização > FST/NF > SKU > quantidade/foto > salvar e próximo; conciliação clara |
| Armazém/Auditorias | Executar checklist e evidenciar | Etapas e anexos com progresso e recuperação de falhas |
| Equipamentos/Configurações | Administração sem ruído | Listas filtráveis, permissões e formulários com confirmação |

## Definition of Done para cada PR
- Fluxos anteriores equivalentes com dados reais de homologação; nenhuma regra de negócio alterada pelo CSS/JSX de apresentação.
- `npm run build` (testes + TypeScript + Vite) concluído e QA manual desktop + celular.
- Tab/Shift+Tab, Enter/Espaço, foco, leitor de tela básico, zoom 200%, estados de erro/carregamento e sem rede.
- Capturas antes/depois e roteiro de teste; regressão do modo Fotos, edição, inventário, geração Word e sincronização offline.
- Abertura de PR por etapa, revisão/homologação antes de release.

## Origem das decisões
- UI/UX Pro Max: `SKILL.md`, `references/quick-reference.md`, `data/ui-reasoning.csv`, `data/colors.csv`, `data/styles.csv`, `data/typography.csv` e `data/stacks/react.csv`, consultados na versão pública do upstream em 13/11/2026.
- Escolhas de paleta e tipografia adaptadas ao CSS real do SGQ. Este documento **não** foi gerado pela execução local do script de busca `search.py`; é uma implementação manual fundamentada nos catálogos e nas regras da skill.
