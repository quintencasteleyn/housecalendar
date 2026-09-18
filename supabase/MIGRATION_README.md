# Migrating to Supabase — what's here and what's left

Everything in this `supabase/` folder was written without touching the live
site — `index.html` at the repo root and the live Apps Script deployment are
both untouched and still serving the real app. Nothing here goes live until
you finish the steps below and we deliberately swap `index.html`.

## What's already done (autonomous)

- `migrations/0001_init_schema.sql` — the Postgres schema: houses, users,
  bookings, with real types, constraints, and indexes instead of parsed
  spreadsheet strings.
- `migrations/0002_rls_deny_all.sql` — Row Level Security enabled with zero
  policies. Nothing can touch the data except the Edge Function below,
  which holds the service-role key.
- `functions/api/index.ts` — every action from `Code.gs`, ported function
  for function (same names, same behavior) to a Supabase Edge Function.
- `migrate-data.mjs` — a dependency-free script that reads your current
  live data from the Apps Script API and imports it into Supabase. It
  never prints or stores PINs/emails — only counts.
- `frontend/index.html` — a copy of the current site with only the network
  layer swapped to call Supabase instead of Apps Script. Everything else
  (every screen, every rule, every popup) is identical.

## What you need to do

### 1. Create a Supabase account and project

Go to [supabase.com](https://supabase.com), sign up, and create a new
project (pick any name/region; the free tier is enough for this app).
Save the database password it asks you to set somewhere safe.

### 2. Get your project's credentials

In the Supabase dashboard: **Project Settings → API**. You'll need three
values from this page later:
- **Project URL** (e.g. `https://abcdefgh.supabase.co`)
- **anon public key** — safe to put in the frontend
- **service_role key** — secret, never put this in the frontend or commit
  it anywhere. Treat it like a password.

### 3. Install the Supabase CLI

```bash
npm install -g supabase
```

(You already have Node installed from earlier setup.)

### 4. Link this repo to your new project

From the `housecalendar` folder:

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

The project ref is the part of your Project URL before `.supabase.co`.

### 5. Apply the database schema

```bash
supabase db push
```

This runs both files in `migrations/` against your new project. Check the
Supabase dashboard's **Table Editor** afterward — you should see empty
`houses`, `users`, and `bookings` tables.

### 6. Create a Resend account (for email)

Go to [resend.com](https://resend.com), sign up, and create an API key
(**API Keys** in their dashboard). Their free tier covers this app's
volume comfortably. You can start with their shared sandbox sending
address; verifying your own domain for a nicer "from" address is optional
and can happen later.

### 7. Set the Edge Function's secrets

```bash
supabase secrets set RESEND_API_KEY=<your resend api key>
supabase secrets set HOST_EMAIL=quinten.casteleynq@gmail.com
```

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically
— you don't set those yourself.)

### 8. Deploy the Edge Function

```bash
supabase functions deploy api
```

Test it's alive:

```bash
curl "https://<your-project-ref>.supabase.co/functions/v1/api?action=houses" \
  -H "apikey: <your anon key>"
```

You should get back `[]` (an empty array — no houses yet, that's expected).

### 9. Run the data migration

This is the one step that touches your real data. Run it from your own
machine, once:

**Windows PowerShell:**
```powershell
$env:APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyVjlFs-cuY7Iya7Zy7jjRejmd42LI6nlej-l82VuUdUeSjv78utJBmW6SbJLffQNWx1A/exec"
$env:ADMIN_NAME = "Quinten"
$env:ADMIN_PIN = "<your current admin PIN>"
$env:SUPABASE_URL = "https://<your-project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<your service_role key>"
node supabase/migrate-data.mjs
```

It prints counts as it goes and a summary at the end. Spot-check the
numbers against the Supabase Table Editor before trusting it fully. It's
safe to re-run on a project that's still empty; if a run fails partway,
clear the partially-imported rows in the Table Editor before retrying.

### 10. Configure and test the new frontend

Open `supabase/frontend/index.html` and fill in the two placeholders near
the top of the `<script>` section:

```js
const CONFIG = {
  SUPABASE_URL: "https://<your-project-ref>.supabase.co",
  SUPABASE_ANON_KEY: "<your anon key>",
};
```

Open that file directly in a browser (or ask me to) and test the whole
app against it — log in as yourself and as an investor, book something,
approve it, check email delivery, try the Admin tab. Don't touch the live
site yet.

### 11. Cut over

Once you're confident: replace the real `index.html` at the repo root
with the tested contents of `supabase/frontend/index.html` (same
`CONFIG` values), commit, and push. GitHub Pages redeploys automatically,
same as always. This is the one moment real family members are affected —
pick a quiet time.

### 12. Afterward

- Keep the Google Sheet and Apps Script deployment around as a fallback
  for a while — they cost nothing to leave alone.
- Once you're confident Supabase is solid, you can delete the Apps
  Script project and (if you want) stop using the Sheet, or keep it as a
  read-only historical record.

## If something needs a design decision along the way

The login model (PIN-style, matching what exists today) was already
decided when this was scaffolded — see the migration-scope document for
why. If you'd rather move to real Supabase Auth (magic links / passwords)
instead, say so before step 10 — it changes the login screen and the
Edge Function's `login()`/`authenticate()` functions, and is much less
work to change now than after real people are using it.
