# App SGQ

Aplicação de Qualidade para inspeções, retenção de amostras, estoque, auditorias e documentos.

## Arquitetura

O SGQ segue o mesmo princípio arquitetural do ecossistema DW Full Brands:

```text
React / PWA
    |
    v
Sgq.Api - ASP.NET Core / .NET 10
    |
    +--> Supabase PostgreSQL
    +--> Supabase Storage
    +--> Supabase Edge Functions
    +--> integrações externas (OMIE / IA)
```

O frontend usa Supabase diretamente apenas para **Auth/sessão**. Dados e regras operacionais usam endpoints explícitos da API .NET. Uploads de arquivos também passam pela API antes de chegar ao Supabase Storage. Não existe mais gateway genérico de tabelas ou de Edge Functions exposto ao frontend.

### Serviços Render

- `app-sgq`: frontend React/PWA;
- `app-sgq-api`: backend ASP.NET Core;
- `app-sgq-docs`: worker legado/especializado para geração dos documentos de auditoria Contlog.

## Responsabilidades

### React / TypeScript

- UI/UX;
- navegação;
- captura de dados e arquivos;
- estados transitórios da tela;
- autenticação via Supabase Auth;
- nenhuma regra crítica de persistência ou decisão de inspeção.

### ASP.NET Core

- regras de negócio;
- criação e execução das inspeções;
- amostragem e Ac/Re;
- integração OMIE;
- histórico de qualidade do produto;
- retenção;
- estoque;
- gestão de ITs;
- fotos/metadados;
- geração e armazenamento de laudos;
- agregação das consultas usadas pelo frontend;
- endpoints de domínio para Full e Contlog;
- orquestração de IA, OMIE, documentos e integrações.

### Supabase

- persistência PostgreSQL;
- RLS e segurança de dados;
- autenticação;
- Storage de fotos, ITs e laudos;
- Edge Functions especializadas.

## Escopo funcional

- inspeções guiadas;
- registro de medições, fotos e não conformidades;
- geração de laudo;
- retenção e movimentação de amostras;
- QR Code;
- etiquetas ZPL para Zebra ZD200;
- biblioteca de ITs;
- auditorias Contlog;
- IA assistida.

## Ambiente do frontend

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_URL`

## Ambiente da API

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `AUDIT_DOCS_URL`

Nunca versionar segredos.
