# Conciliação pós-inventário às cegas · SGQ

## Fluxo
1. O inspetor registra os produtos e quantidades reais em **Estoque > Inventário às cegas · Omie**. A fotografia de cada SKU permanece vinculada ao item e ao seu processo FST/localização.
2. Um **gestor ou administrador** acessa **Estoque > Conciliação pós-inventário**, seleciona a sessão correta (FST + rua/armário), confere os itens e seleciona **Encerrar contagem e conciliar**. O sistema congela os valores originais e gera um registro por item.
3. O gestor registra **quantidade de referência da mesma localização**, origem da referência e identificação da evidência/relatório. Não há leitura automática do saldo global do Omie como se fosse o saldo da localização física.
4. A diferença é **quantidade física (ou recontagem) - quantidade de referência**. Se houver dúvida, o gestor pode solicitar recontagem com motivo. Inspetor, gestor ou administrador pode registrar nova quantidade e justificativa sem alterar a foto ou o valor original.
5. O gestor confirma itens coincidentes e justifica/aprova as diferenças. Todas as ações ficam no histórico, vinculadas a usuário e data.
6. Após a revisão de **todos** os itens, o gestor seleciona **Concluir conciliação**. Decisões ficam bloqueadas.

## Separação de responsabilidades
A conciliação **não executa ajustes automáticos de estoque**, não movimenta amostras, não altera NFs, não manipula os saldos no Omie e não infere equivalência entre saldos de locais distintos. Qualquer ajuste futuro precisa de uma operação própria, com validação fiscal/operacional e autorização expressa.

## Persistência e segurança
- `sgq_inventario_conciliacoes`: sessão e fechamento.
- `sgq_inventario_conciliacao_itens`: snapshot da contagem, referência, evidência, recontagem, decisão e revisor.
- `sgq_inventario_conciliacao_eventos`: auditoria imutável pelo usuário.
- `sgq_conciliacao_operar`: operação transacional com validação de papel ativo. Tabelas são legíveis somente para usuários SGQ autorizados e não recebem INSERT/UPDATE/DELETE do cliente.
- Arquivos de fotos são abertos por link assinado privado de cinco minutos.

## Limites e próximos passos
A revisão cobre os **itens efetivamente contados** na sessão. Ela não prova, por si só, que todos os SKUs esperados para o processo foram contados. A origem da referência é informada pelo gestor e precisa corresponder à localização, ao SKU e ao período. Este módulo não contém autorização de ajuste de estoque ou cálculo fiscal.

## Acompanhamento de status
A aba **Estoque > Status do inventário às cegas** oferece uma visão de todos os FST e localizações registrados, incluindo:
- Etapa da sessão (contagem aberta, encerrada ou cancelada), cliente, NF e datas.
- Quantidade de SKUs contados e última atividade por localização.
- Fotos confirmadas, pendentes, em transmissão ou com erro no Omie, e motivo da falha.
- Conciliação aguardando início, em análise ou concluída, com itens aprovados/total.
- Pesquisa por FST, local, SKU e filtro por etapa ou fotos com erro.
- Acesso direto às telas de contagem e conciliação.

A visão é **somente leitura** e não altera saldos. Ela registra números de lançamentos realizados, não um percentual de cobertura do FST: a lista oficial de itens esperados deve ser validada separadamente.

## Quantidade esperada e divergências cadastrais
A modalidade operacional é **Inventário FST · Omie**. A análise não oculta a quantidade esperada. Na tela de status, quando existe uma referência documentada registrada na conciliação, são apresentados lado a lado:
- **Esperado no local:** quantidade de referência autorizada para o mesmo SKU, processo e localização.
- **Contado:** quantidade física inicialmente registrada ou a recontagem mais recente.
- **Diferença:** contado menos esperado, com sinal e indicação de divergência.

Antes de registrar a referência, a quantidade esperada aparece como **Não informado**. Nunca substituir essa lacuna pelo saldo geral do Omie, que pode abranger vários locais e processos.

A tela de status e a conciliação consultam o cadastro de produtos diretamente no Omie por uma Edge Function autenticada e somente leitura. Cada SKU apresenta os códigos e descrições de ambos os sistemas e destaca: código divergente, descrição diferente, código não localizado e consulta indisponível. A conferência é executada quando o operador abre os itens, com até três consultas simultâneas e cache de dois minutos para reduzir latência e chamadas à API. Divergências são alertas de revisão, não alteram automaticamente cadastros nem estoque.
