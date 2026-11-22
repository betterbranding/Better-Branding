# Thornberry Move

Move planner for **9008 Thornberry Dr, North Richland Hills, TX** (move day 12/15/2026): to-dos, budget, items to buy, and a furniture wishlist with AI live pricing from photos or links.

- **Frontend:** Vite + React, red & white, Helvetica.
- **Sign-in & data:** Supabase (Google sign-in + Postgres). Row-level security only lets the emails in `move_allowed_users` read or write.
- **AI pricing:** `api/price.ts` (Vercel function) sends the photo/link to Gemini with Google Search grounding and returns current prices.
- **Hosting:** Vercel project with Root Directory set to `thornberry-move`. It only rebuilds when files in this folder change.

## Environment variables (Vercel)

| Key | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable / anon key |
| `GEMINI_API_KEY` | Google AI Studio key, used by `/api/price` for AI furniture pricing |

## Database

Run `supabase/schema.sql` once, then add the people who can sign in.

To give someone access:

```sql
insert into public.move_allowed_users (email) values ('someone@gmail.com');
```

## Google sign-in setup

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application).
2. Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
3. Supabase → Authentication → Sign In / Providers → Google: paste the client ID and secret, enable.
4. Supabase → Authentication → URL Configuration: set Site URL to the Vercel URL and add it to Redirect URLs.

## Local development

```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev
```
