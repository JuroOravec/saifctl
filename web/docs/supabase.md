# Supabase Setup

This document covers how we use Supabase for the waitlist and how to obtain and configure credentials.

## What We Use It For

Supabase powers the **waitlist** — when a visitor submits an email via "Request Early Access" or "Book a Demo", it is stored in a `waitlist` table. There is no serverless layer; the Next.js app uses the Supabase JS client directly from the browser.

**PII:** The only personal data collected is the email address the user voluntarily submits. No other data is sent to Supabase. See the [Privacy Policy](/privacy) for full details.

## Architecture

- **Client:** [`@supabase/supabase-js`](https://github.com/supabase/supabase-js) with lazy initialization — the client is only created when `insertWaitlistEmail()` is called at runtime. This keeps the module safe to import during static build (no env vars required at build time).
- **Auth:** We use the public `anon` key. It is safe to expose in the frontend because Row Level Security (RLS) restricts access.
- **RLS:** The `waitlist` table allows **INSERT only** for anonymous users. SELECT, UPDATE, and DELETE are denied. This prevents anyone from reading or tampering with the list even if they have the anon key.
- **Hosting:** Prefer an EU region (e.g. Frankfurt or London) for GDPR compliance.

## Obtaining Credentials

1. Go to [Supabase](https://supabase.com) and sign in.
2. Create a project (or select an existing one).
3. Choose an **EU region** when prompted (Frankfurt, London) for GDPR compliance.
4. Go to **Project Settings** → **API** (or `https://app.supabase.com/project/<your-project-ref>/settings/api`).
5. Copy:
   - **Project URL** → use for `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → use for `NEXT_PUBLIC_SUPABASE_ANON_KEY`

These are the only two values the app needs. Do **not** use the `service_role` key — that bypasses RLS and must stay server-side only.

## Environment Variables

| Variable                        | Required | Description                                           |
| ------------------------------- | -------- | ----------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Yes      | Project URL, e.g. `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes      | The anon public API key                               |

### Local development

Copy `web/.env.local.example` to `web/.env.local` and fill in your values. The `.env.local` file is gitignored and never committed.

### Deployment (GitHub Actions)

The deploy workflow injects these variables from **GitHub repository secrets** at build time — nothing is stored in the repo.

1. Go to your repository on GitHub → **Settings** → **Secrets and variables** → **Actions**.
2. Add repository secrets:
   - `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — your anon public key

The workflow passes these to the build step so they are inlined into the static export. Without them, the deployed site will throw when a user submits the waitlist form.

## Database Setup

Create the `waitlist` table and enable RLS in the Supabase SQL Editor (Supabase Dashboard → SQL Editor).

### Table schema

```sql
create table public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  created_at timestamptz not null default now()
);
-- Unique on email yields Postgres error 23505 for duplicates
```

### Row Level Security (RLS)

```sql
alter table public.waitlist enable row level security;

-- Anonymous users can INSERT only. No SELECT/UPDATE/DELETE.
create policy "Allow anonymous insert"
  on public.waitlist
  for insert
  to anon
  with check (true);
```

### Grants

RLS controls which rows can be affected; the `anon` role also needs table-level privileges. Without these, inserts fail with `42501 permission denied for table waitlist`:

```sql
grant usage on schema public to anon;
grant insert on public.waitlist to anon;
```

After running the full setup (schema + RLS + grants), unauthenticated clients can insert rows but cannot read or modify existing data.

## Integration Points

| File                               | Role                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/lib/supabase.ts`              | `insertWaitlistEmail()` — lazy client init, single insert                                                |
| `src/components/WaitlistModal.tsx` | Calls `insertWaitlistEmail()` on form submit; handles `23505` (already on list) as user-friendly message |

## Error Handling

The app handles Postgres error code `23505` (unique violation) and surfaces "You're already on the list!" to the user. Other errors show a generic retry message.
