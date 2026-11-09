# SGQ / webhook de PV do Omie

Escuta os tópicos `VendaProduto.Incluida`, `VendaProduto.Alterada` e `VendaProduto.Cancelada`.
Não cria inspeções automaticamente: preenche a fila de pedidos para revisão.

## Segurança
- Função pública **somente com token secreto** de URL, validado por SHA-256 no banco, conferindo `appHash`.
- Não coloque o token em código ou repositório. Configure URL no Omie em **Meus aplicativos → Webhooks**.
- Eventos são idempotentes por `messageId` e armazenados antes de responder.
- Credenciais Omie lidas exclusivamente pelo backend (`OMIE_APP_KEY` / `OMIE_APP_SECRET`).

## Operação
- Endpoint: `https://gyqufucgevpczqebmdqy.supabase.co/functions/v1/sgq-omie-pv-webhook?token=<SEGREDO>`
- `verify_jwt = false` é intencional: o Omie não envia JWT do Supabase.
- Retry de eventos com `status=erro` e reconciliação de PVs devem ser monitorados.
- A conexão efetiva depende do cadastro manual da URL no Omie.
