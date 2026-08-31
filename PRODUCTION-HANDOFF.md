# Picklester production handoff

This archive contains the complete production source needed to continue the
project in another ChatGPT account or local development environment.

## Production connections

- Live app: https://picklester-vercel.vercel.app
- GitHub repository: https://github.com/chiomegadeveloper-svg/picklester-vercel
- Supabase project URL: https://vqieqybctuywwcppzqor.supabase.co
- Supabase publishable key: stored in `.env.example`
- Google OAuth callback: https://vqieqybctuywwcppzqor.supabase.co/auth/v1/callback

The publishable browser key is included. Private service-role keys, database
passwords, Google client secrets, and other privileged credentials are never
included in the archive.

## Continue development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Verify and export a new handoff

```bash
npm run export:production
```

That command runs the full Next.js production build before creating
`dist/Picklester-production-source.zip` from the tracked source tree.

## Supabase SQL

For a new Supabase database, run `supabase/picklester-schema.sql`, followed by
the numbered upgrade files in ascending order through
`picklester-v23-honesty-start.sql`.

Honesty game sequence:

1. The creator checks **HONESTY MODE** before pressing Create game.
2. Only player slots are shown; no referee slot is created.
3. After every player joins, only the creator sees **Start game**.
4. The creator presses Start game to open the shared scoring form.
