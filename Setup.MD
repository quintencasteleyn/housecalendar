# Shared House Booking Calendar — Setup (v2)

Same architecture as before: `index.html` on GitHub Pages, `Code.gs` on
Google Apps Script, one Google Sheet as the database. This version adds
a request/approval workflow, an admin approvals page, and support for
more than one house later.

**If you already set up v1:** you need to replace the Apps Script code
and re-deploy a new version (not just save) — see step 4. Your existing
Sheet needs the two new tabs/columns described in step 2 if you want to
keep old data; simplest is to just re-run `setupSheet()` on a fresh
Sheet if you don't have real bookings yet.

## 1. Create the Google Sheet + backend

1. sheets.google.com → new blank Sheet → name it "Shared House Bookings".
2. Extensions → Apps Script → delete the placeholder → paste in the full
   contents of `Code.gs`.
3. Function dropdown → select **setupSheet** → **Run** → grant
   permissions. This creates three tabs: `Houses`, `Users`, `Bookings`.

## 2. Fill in real data

`setupSheet()` already fills the Users tab with real, working PINs (not
placeholders) — see the table below. You only need to rename "Investor
A/B/C/D" to real names; the PINs already work as-is, and everyone can
change theirs later from inside the app (see step 5).

| Who | PIN |
|---|---|
| Investor A | 544148 |
| Investor B | 403239 |
| Investor C | 305002 |
| Investor D | 605965 |
| Quinten (admin) | 157758 |

Open the Sheet:

- **Houses tab**: one row per property. `HouseID` is a short code you
  make up (e.g. `sweden1`, `doel`) — used internally, never shown to
  investors. `HouseName` is what actually displays (e.g. "Sweden
  House"). Starts with one example row — rename it, and see step 6 for
  adding more later.
- **Users tab**: one row per investor, `HouseID` matching one of the
  house codes above. Real names, PINs, colors (hex codes — the four
  defaults are `#B65A2E` `#4F7A5B` `#C99A3B` `#7B4B8A`, chosen to stay
  visually distinct from the blue (selecting) and grey (pending) states
  the app uses for booking status). Your own row: leave `HouseID` blank,
  `IsAdmin` = `TRUE`, `WeeklyQuota` doesn't matter (admin doesn't book
  for themself).
- **Bookings tab**: leave empty — the app fills this in.

## 3. Deploy as a Web App

Apps Script editor → **Deploy → New deployment** → Type: **Web app** →
Execute as **Me** → Who has access **Anyone** → **Deploy**. Copy the
Web app URL (ends in `/exec`).

**Upgrading from v1:** use **Manage deployments → pencil icon → New
version** instead, so the same URL keeps working.

## 4. Configure and publish the frontend

1. In `index.html`, find near the top of the `<script>` section:
   ```js
   const CONFIG = { API_URL: "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE" };
   ```
   Paste in the Web app URL.
2. Commit `index.html` to your GitHub repo (replacing the old version).
3. If Pages is already enabled from before, it redeploys automatically
   within a minute or two of the push. If not: repo → **Settings →
   Pages** → deploy from branch → `main` / `root`.

## 5. How it works now

- **Investors**: select weeks (they turn **blue**), then **Submit for
  approval**. The weeks turn **light grey** for everyone — reserved,
  not yet confirmed. Nothing becomes a real booking until you approve it.
- **You (admin)**: two tabs at the top — **Calendar** and **Approvals**.
  - *Calendar*: pick a house from the dropdown, optionally "act as" any
    investor, and book/cancel directly — this bypasses approval
    entirely (it's your call as admin).
  - *Approvals*: every pending request across **all houses**, one line
    per investor's current pending batch, showing the house, the weeks
    requested, how many weeks they have left before and after this
    request, and the gap in days to the nearest approved booking before
    and after it. Approve or reject with one click.
- Rejected requests free the weeks back up immediately; approved ones
  turn into that investor's own color on the calendar.
- **Changing PIN**: everyone (investors and you) has a "Change PIN"
  button next to "Log out" — asks for current PIN plus the new one
  twice, updates it themselves, no Sheet editing needed. If someone
  forgets their PIN entirely, you can still just overwrite it directly
  in the Users tab — that always works as a fallback since it's your Sheet.

**One simplification worth knowing:** if an investor has two separate
pending submissions for the same house and year (submitted at different
times), they show up as one combined line on the Approvals page rather
than two — you approve/reject their whole current pending batch
together. Ask if you'd rather review each submission separately; it's a
bigger change to the approval-page logic.

## 6. Adding a second house later

No code changes needed:
1. Add a row to the **Houses** tab with a new `HouseID` and name.
2. Add that house's investors to the **Users** tab with the matching
   `HouseID`.
3. Done — it'll appear in your house-switcher dropdown automatically,
   and its investors log in with their own name + PIN exactly like the
   first house's.

## 7. Test it

- Log in as an investor, select 2 consecutive summer weeks, submit —
  should turn grey immediately.
- Log in as admin, go to **Approvals** — you should see that request
  with weeks-left and gap numbers filled in. Approve it — back on the
  Calendar it should now show in that investor's color.
- Try rejecting a request — the weeks should become selectable again.
- Try the **House** dropdown (admin only) if you've added a second
  house — the calendar should switch to that house's investors and
  bookings.
