# Picklester — Vercel Edition

Picklester is a mobile-first pickleball community PWA with verified games,
QR pairing, live scoring, MMR rankings, profiles, social activity, support
tickets, and Game Pass controls.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Production build

```bash
npm run build
```

The project is configured for Vercel's native Next.js runtime. See
`VERCEL-DEPLOYMENT.md` for environment variables and OAuth URL changes.

## Portable production ZIP

Run `npm run export:production` to verify the production build and create a
complete source handoff at `dist/Picklester-production-source.zip`. Connection
details and continuation instructions are included in `PRODUCTION-HANDOFF.md`.
