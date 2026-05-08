# CodeLens - Agent Instructions

## Overview

CodeLens is an AI-powered codebase analysis tool built with Next.js 15 (App Router), Prisma ORM (PostgreSQL), and integrations with GitHub API and Anthropic Claude. It helps users understand repositories by generating Mermaid.js architecture diagrams, tracking concepts across commits, and providing AI-driven analysis.

## Cursor Cloud specific instructions

### Services

| Service | Purpose | Required |
|---------|---------|----------|
| Next.js dev server (`npm run dev`) | Main application (frontend + API routes) | Yes |
| PostgreSQL | Persistent data (users, repos, analyses) | Yes |

### Environment Variables

The app requires a `.env.local` file with:
- `DATABASE_URL` — PostgreSQL connection string (e.g. `postgresql://user:pass@localhost:5432/codelens`)
- `NEXT_PUBLIC_GITHUB_TOKEN` — GitHub personal access token for repo fetching
- `NEXT_PUBLIC_ANTHROPIC_API_KEY` — Anthropic API key for Claude-based analysis
- `GITHUB_ID` / `GITHUB_SECRET` — GitHub OAuth app credentials (for NextAuth)
- `NEXTAUTH_SECRET` — Random string for NextAuth session encryption

### Development Commands

```bash
npm install              # Install dependencies
npx prisma generate     # Generate Prisma client (after schema changes)
npx prisma db push      # Push schema to database (dev; no migration files)
npm run dev              # Start Next.js dev server on port 3000
npm run lint             # Run ESLint (next lint)
npm run build            # Production build
```

### Database Setup

PostgreSQL must be running locally. After ensuring `DATABASE_URL` is set in `.env.local`:
```bash
npx prisma db push       # Sync schema to DB
```

### Key Caveats

- The `hello-prisma/` directory is an independent experimental sub-project; ignore it for normal development.
- The `@mermaid-js/mermaid-cli` dependency pulls in Chromium/Puppeteer as transitive deps, which makes `npm install` slower and requires significant disk space.
- The project uses `package-lock.json` (npm). Do not mix package managers.
- There are no automated tests in this repository.
- The app uses Next.js App Router; API routes are under `src/app/api/`.
