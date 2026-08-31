# Picklester Vercel deployment

## Environment variables

Add these in Vercel Project Settings → Environment Variables for Production,
Preview, and Development:

```text
NEXT_PUBLIC_SUPABASE_URL=https://vqieqybctuywwcppzqor.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your Supabase publishable key
```

## Build configuration

- Framework preset: Next.js
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: leave blank

## Authentication URLs

After Vercel assigns the production domain, add it to Supabase Authentication
URL Configuration and Google Cloud OAuth Authorized JavaScript origins.

Keep this Google Authorized redirect URI unchanged:

```text
https://vqieqybctuywwcppzqor.supabase.co/auth/v1/callback
```
