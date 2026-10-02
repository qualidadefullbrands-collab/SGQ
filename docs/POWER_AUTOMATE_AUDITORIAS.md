# Integração Power Automate — Auditorias SGQ

O aplicativo **não depende do SharePoint para concluir uma inspeção**. O registro é salvo no Supabase primeiro. A integração Microsoft acontece depois, por HTTP.

## Segredos do Supabase

Configurar quando o fluxo estiver pronto:

- `POWER_AUTOMATE_WEBHOOK_URL`: URL do gatilho **When an HTTP request is received**.
- `POWER_AUTOMATE_SHARED_SECRET`: opcional. Se configurado, o backend envia o header `x-sgq-secret`.

A URL não deve ser exposta no frontend.

## Edge Function

`sgq-auditoria-integracao`

Entrada:

```json
{
  "executionId": "uuid-da-auditoria",
  "documentBase64": "base64-do-docx-final"
}
```

Enquanto o gerador do Word ainda não estiver concluído, a função responde com `document_required` e não envia um registro incompleto ao Power Automate.

## Payload enviado ao Power Automate

```json
{
  "event": "inspection.completed",
  "inspectionId": "...",
  "rq": {
    "code": "RQ015",
    "title": "Checklist Mensal de Porta-Paletes",
    "version": "02/2026"
  },
  "inspection": {
    "date": "2026-10-02",
    "referenceMonth": "outubro de 2026",
    "responsible": "Nome do auditor",
    "finishedAt": "2026-10-02T..."
  },
  "routing": {
    "rule": "RQ015",
    "year": "2026",
    "month": "OUTUBRO",
    "folderName": "2026",
    "fileName": "RQ 015 - OUTUBRO.docx"
  },
  "summary": {
    "status": "concluida",
    "answers": 13,
    "nonConformities": 2,
    "findings": 2
  },
  "answers": [],
  "findings": [],
  "conversation": [],
  "document": {
    "fileName": "RQ 015 - OUTUBRO.docx",
    "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "contentBase64": "..."
  }
}
```

## Regras de roteamento

### RQ 014
- Pasta na base de Extintores: `RQ 014 - MÊS.ANO`
- Arquivo: `RQ 014 - MÊS.ANO.docx`

### RQ 015
- Selecionar/criar pasta do ano.
- Arquivo: `RQ 015 - MÊS.docx`

### RQ 016
- Selecionar/criar pasta do ano.
- Arquivo: `RQ 016 - Avaliação 5S dd.mm.aaaa.docx`

### RQ 016-B
- Selecionar/criar pasta do ano em Pré Avaliação 5S / Realizadas.
- Arquivo: `Avaliação Pré Avaliação 5S - Mês.aaaa.docx`

## Fluxo recomendado no Power Automate

1. **When an HTTP request is received**
2. Opcional: validar `x-sgq-secret`
3. `Switch` em `routing.rule`
4. Selecionar/criar a pasta correspondente
5. Converter `document.contentBase64` para binário
6. **Create file** no SharePoint
7. Enviar e-mail informando que a inspeção foi concluída
8. Responder ao HTTP com:

```json
{
  "success": true,
  "status": "archived",
  "fileName": "...",
  "sharePointUrl": "...",
  "emailSent": true
}
```

O aplicativo pode guardar essa resposta em `auditoria_execucoes.power_automate_resposta`.
