# App SGQ

Aplicação independente para agilizar inspeções e controlar estoque de amostras.

## Escopo do MVP

- inspeções guiadas;
- registro de medições, fotos e não conformidades;
- geração de laudo;
- retenção e movimentação de amostras;
- QR Code;
- geração de etiquetas ZPL para Zebra ZD200.

## Stack

- React + TypeScript + Vite
- Supabase (PostgreSQL, Auth e Storage)
- Render
- GitHub

## Ambiente

Copie `.env.example` para `.env.local` e preencha:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Nunca versionar segredos.
