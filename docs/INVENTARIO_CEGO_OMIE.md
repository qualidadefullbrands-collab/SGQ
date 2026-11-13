# SGQ · Inventário às cegas com Omie e fotos

## Objetivo
A modalidade **Estoque > Inventário às cegas · Omie** é independente de **Inventário** (amostras). Consulta os produtos do ERP somente por código, recuperando descrição, sem trazer saldos de estoque ao conferente. O produto é identificado por código Omie e a contagem registra quantidade física, endereço e observação.

**Nenhuma contagem causa ajuste de estoque no Omie ou no SGQ.** Uma eventual reconciliação precisa de processo separado, sob aprovação contábil/operacional.

## Fluxo operacional
1. Inspetor/gestor abre uma sessão de contagem cega e informa o setor opcional.
2. Digita ou lê o código, consulta a integração já existente `/api/estoque/validar-sku`.
3. Confere produto físico, informa quantidade (inclusive zero) e, se desejar, anexa foto JPG/PNG. O envio da foto também atualiza a imagem principal do cadastro local do produto no SGQ, reutilizando a consulta autenticada de código e o bucket `produto-fotos` já existentes.
4. Pode marcar a foto para sugerir substituição da imagem principal no Omie. O arquivo é armazenado em bucket **privado** no SGQ.
5. Gestor encerra a sessão. A contagem fica travada.
6. Gestor abre a foto, confere código/produto, aprova expressamente e dispara `sgq-inventario-omie`.
7. A Edge Function cria uma cópia **pública** da imagem aprovada, consulta o produto no Omie, preserva as imagens existentes (até o limite suportado), coloca a foto aprovada em primeiro e envia `AlterarProduto`.
8. Nova consulta `ConsultarProduto` verifica se a URL consta no cadastro. Só então registra como sincronizada com usuário/data e auditoria. Se houver falha, a foto original permanece no SGQ e o estado vira erro.

A foto pode ficar pública por ser imagem do catálogo de produtos, por isso a publicação só ocorre após aprovação de gestor. Uma foto já sincronizada não é reenviada.

## Implementação e ativação
- Frontend: `src/stock/BlindInventoryPage.tsx`
- Banco: `supabase/migrations/20261113080000_sgq_inventario_cego_omie_fotos.sql`
- Backend de sincronização: `supabase/functions/sgq-inventario-omie/index.ts`
- A consulta do SKU já utiliza o backend autenticado do SGQ.
- A Edge Function usa credenciais de integração `OMIE_APP_KEY` e `OMIE_APP_SECRET` já previstas no padrão do SGQ, sem transmiti-las ao navegador.
- A função exige JWT de usuário real, perfil gestor/administrador, sessão fechada, foto marcada e confirmação manual.

**Antes de liberar em produção:** aplicar a migração em homologação, publicar a Edge Function no projeto SGQ e executar integração ponta-a-ponta com **produto de teste expressamente autorizado**. Verificar especialmente se `AlterarProduto` aceita `imagens[].url_imagem` sem alterar campos fiscais ou comerciais, se o Omie consegue buscar a URL pública e se `ConsultarProduto` retorna a URL confirmando a atualização. Se o Omie processar e transformar a URL da imagem, adaptar o critério de verificação antes do deploy.

O Omie suporta até seis imagens por produto; a primeira funciona como capa. Quando já existem seis, a foto aprovada substitui a capa antiga e preserva as outras cinco. Quando há menos de seis, preserva as imagens existentes. Validar esse comportamento no cadastro de teste antes de publicar.

## Segurança e integridade
- No banco de contagem cega não há campos de saldo/quantidade esperada: o isolamento não depende somente de CSS.
- A foto de evidência permanece em Storage privado; somente a cópia aprovada vai para bucket de catálogo público.
- As regras RLS não permitem ao conferente alterar o estado de sincronização; a Edge Function controla a escrita e audita aprovação/erros.
- As tabelas não são ligadas ao inventário de amostras nem ao ajuste de estoque do ERP.
- Nenhum envio ao Omie deve ser automatizado apenas pelo checkbox. O checkbox registra intenção, não autorização.
- Não modificar a foto do Omie, dados ou saldos na conta real durante testes automatizados.

## Homologação mínima
1. Criar inventário com usuário inspetor. Conferir que nenhum saldo do sistema aparece.
2. Consultar código existente e inexistente, registrar quantidade zero e valor decimal, testar duplicidade por código/endereço.
3. Capturar foto no celular, marcar foto e salvar. Confirmar arquivo privado e estado pendente.
4. Confirmar que a foto principal local foi gravada em `produto-fotos` e vinculada ao cadastro `produtos`. Conferir impedimento de aprovação do Omie pelo inspetor e bloqueio de alterações depois de fechar.
5. Abrir foto com gestor, sincronizar **somente produto de teste**; verificar imagem na capa e as antigas preservadas, a auditoria e a atualização no SGQ.
6. Simular falha Omie e confirmar que nenhuma contagem ou estoque foi alterado e que o erro é recuperável.
7. Verificar permissões do bucket público: usuário comum não pode publicar ou substituir fotos diretamente.

## Referências Omie
- API de produtos: https://api.omie.com.br/docs/apis/geral/produtos
- Imagens de produtos: https://ajuda.omie.com.br/pt-BR/articles/3623413-incluindo-imagens-aos-seus-produtos
