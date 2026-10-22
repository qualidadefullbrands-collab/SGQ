# SGQ → Power Automate → SharePoint

Integração implementada no backend .NET do SGQ. Não há URL de fluxo ou segredo no frontend.

## Fluxo

1. Crie um fluxo **automatizado via gatilho "When an HTTP request is received"** no Power Automate, com um gatilho HTTP protegido. Algumas licenças exigem Power Automate Premium.
2. Configure o corpo JSON (schema gerado pelo próprio Power Automate) a partir deste exemplo:

```json
{
  "eventId":"sha256-do-documento",
  "origem":"sgq",
  "tipoDocumento":"relatorio_inspecao",
  "inspecaoId":"id-interno",
  "laudoId":"id-interno",
  "numeroFst":"FST12345",
  "cliente":"Cliente",
  "filename":"FST12345 - Cliente - Relatorio de Inspecao.docx",
  "contentType":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "contentBase64":"<BASE64 DO ARQUIVO>",
  "pastaAno":"2026"
}
```

3. Adicione a ação **SharePoint → Create file**. Nome: `triggerBody()?['filename']`; conteúdo do arquivo: `base64ToBinary(triggerBody()?['contentBase64'])`. Se organizar por ano/FST, garanta que as pastas de destino existam antes de gravar.
4. Use `eventId` como **chave de idempotência** no fluxo, para não criar cópias duplicadas quando a mesma inspeção for reenviada. Por exemplo, mantenha uma lista SharePoint com os eventos já processados ou verifique a existência do arquivo.
5. Opcional: responda com HTTP 200 e `{"webUrl":"https://..."}` depois de confirmar a criação no SharePoint. O SGQ registrará o link e o sucesso no banco.
6. Copie a URL exata do gatilho HTTP para a variável **POWER_AUTOMATE_SGQ_WEBHOOK_URL** no serviço privado `app-sgq-api` no Render. **Não use variável VITE_** nem insira a URL no GitHub: a URL inclui um token de acesso ao fluxo.
7. No SGQ, conclua a inspeção e gere o Word. Depois clique em **Enviar ao SharePoint**. A ação autenticada chama `POST /api/inspecoes/{id}/enviar-automate`, que busca o Word do bucket privado `laudos`, envia o conteúdo ao fluxo e registra o resultado em `sgq_documento_integracoes`.

## Segurança, limites e operação

- A API exige sessão autenticada com perfil SGQ autorizado, Word já armazenado e inspeção concluída.
- O gatilho só aceita HTTPS; a URL completa fica no Render, não no navegador.
- A integração não modifica o documento original nem remove a cópia no Supabase.
- Erros de envio não excluem Word; consulte `sgq_documento_integracoes` e o histórico de execuções do Power Automate.
- A exportação automática assim que um laudo for gerado pode ser ativada em etapa posterior, depois de testar o fluxo e o controle de duplicidade. Nesta versão o disparo é explícito pelo botão do usuário.
- Nada será enviado para o SharePoint enquanto a variável do Render não estiver configurada.

## Situação de homologação

A API e a estrutura do banco foram implementadas. O teste fim a fim depende da URL de um fluxo HTTP existente na organização e de permissões de gravação na biblioteca SharePoint.
