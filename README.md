# CarOS

A family-first car research and planning app. One shared code, everyone's
preferences, a live AI-generated plan, and full cost-of-ownership math.

## Run locally

```bash
npm install
npm run dev
```

Opens at http://localhost:5173. Works immediately on **localStorage**
(single device) with no backend. Use the demo, or set up a new family.

## Go persistent (cross-device) with Supabase

1. Create a project at supabase.com
2. In the SQL editor, run `supabase_setup.sql` (creates tables + security)
3. Copy `.env.example` to `.env` and fill in your URL + anon key
   (Supabase: Project Settings -> API)
4. In `src/CarOS.jsx`, set `USE_SUPABASE = true`

That's the whole swap — the data layer is already written for both.

## Deploy (Vercel)

1. Push this repo to GitHub
2. Import it at vercel.com — it auto-detects Vite
   (build: `vite build`, output: `dist`)
3. Add env vars in project settings: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   and `ANTHROPIC_API_KEY` (for the AI chat/plan — stays server-side via `api/claude.js`)
4. Deploy

The Supabase anon key is meant to be public; Row Level Security
(in `supabase_setup.sql`) is what protects the data.

## Stack

React + Vite, Supabase (Postgres), Anthropic API for the chat and plan.
