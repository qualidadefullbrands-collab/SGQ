# Recuperação de senha — SGQ

## Configuração obrigatória do Supabase Auth

Projeto Supabase: `app-sgq` (`gyqufucgevpczqebmdqy`).

Em [Authentication → URL Configuration](https://supabase.com/dashboard/project/gyqufucgevpczqebmdqy/auth/url-configuration):

- **Site URL:** `https://app-sgq.onrender.com`
- **Redirect URLs:** incluir exatamente `https://app-sgq.onrender.com/?auth=recovery` e, se necessário, `https://app-sgq.onrender.com/**`.
- **Remover localhost das configurações de produção** se nenhum ambiente de desenvolvimento o exigir.

O formulário do SGQ agora envia sempre `redirectTo: https://app-sgq.onrender.com/?auth=recovery`, independentemente da origem usada para solicitar o e-mail. A lista de URLs permitidas é configurada no próprio Supabase, não no código do SGQ.

## Diagnóstico e operação

- Consulte **Authentication → Logs** para `POST /recover` (aceitação do pedido), `mail.send` (e-mail enviado), `GET /verify` (validação do link) e `PUT /user` (atualização da senha).
- Links do Supabase são **de uso único**. Um segundo clique retorna `403: Email link is invalid or has expired`. Solicite outro e-mail em vez de reutilizar o anterior.
- Serviços corporativos de segurança de e-mail podem visitar os links de verificação automaticamente. Se isto ocorrer com frequência, avalie fluxo de recuperação por OTP e a personalização do template de e-mail; não desative os mecanismos de segurança.
- Não é necessário resetar ou modificar diretamente `auth.users`. O usuário redefine a própria senha após validar o link.
- Teste completo em ambiente real: solicitar e-mail → abrir somente uma vez em navegador → verificar `https://app-sgq.onrender.com/?auth=recovery` → digitar e confirmar nova senha → entrar novamente.

## Segurança

A interface de alteração de senha só é liberada após o evento `PASSWORD_RECOVERY` do Supabase. Uma sessão previamente autenticada, por si só, não autoriza redefinição a partir de `?auth=recovery`. Nenhum token ou senha deve ser salvo nos logs.
