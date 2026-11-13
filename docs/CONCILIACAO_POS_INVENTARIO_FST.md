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
