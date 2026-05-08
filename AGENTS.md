# AGENTS.md

## Cursor Cloud specific instructions

### Overview

CodeLens is a Next.js 15 application (TypeScript, App Router) that provides AI-powered codebase analysis. It uses PostgreSQL (via Prisma ORM), GitHub OAuth, and the Anthropic Claude API.

### Running services

- **Dev server**: `npm run dev` (port 3000)
- **PostgreSQL**: Must be running on localhost:5432. Start with `sudo pg_ctlcluster 16 main start`.
- **Database**: `codelens` DB, user `codelens`, password `codelens`. Connection string: `postgresql://codelens:codelens@localhost:5432/codelens`

### Key commands

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Dev server | `npm run dev` |
| Lint | `npm run lint` |
| Build | `npm run build` |
| Prisma generate | `npx prisma generate` |
| Prisma push schema | `npx prisma db push` |

### Important gotchas

- **Prisma CLI** must be installed as a devDependency (`prisma@6.3.1`). The project's `package.json` originally only had `@prisma/client`.
- **Prisma reads `.env` not `.env.local`** for `DATABASE_URL`. A `.env` file with `DATABASE_URL` must exist at the project root for Prisma CLI commands to work (the Next.js runtime reads `.env.local` properly).
- **`npm run build` fails** due to pre-existing ESLint errors in the codebase (unused vars, `no-explicit-any`). The dev server (`npm run dev`) works fine regardless.
- **No test framework is configured** — there are no Jest/Vitest/Playwright configs or test scripts.
- **Environment variables**: The app requires `GITHUB_ID`, `GITHUB_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_GITHUB_TOKEN`, and `NEXT_PUBLIC_ANTHROPIC_API_KEY` in `.env.local`. Without real GitHub/Anthropic credentials, the homepage shows a "Bad credentials" error, but the server and DB routes still function.
- **The `hello-prisma/` directory** is an unrelated sub-project (Prisma tutorial) — not part of the main CodeLens product.
