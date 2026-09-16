# Shared House Booking Calendar — Setup (v3)

Same architecture as before: `index.html` on GitHub Pages, `Code.gs` on
Google Apps Script, one Google Sheet as the database. This version
switches from fixed Monday–Sunday weeks to flexible-length stays (7+
nights, any start day), replaces the old "2 consecutive summer weeks"
rule with a 3-week advance-notice requirement for investor requests,
hides other investors' identities behind a generic "booked" color, and
adds an in-app **Admin** tab for managing houses/investors/PINs.

**If you already set up v1 or v2 with real data:** run `migrateToV3()`
once from the Apps Script editor (function dropdown, top of file) —
converts `Users.WeeklyQuota` to `Users.QuotaNights` (×7) and
`Bookings.Year`/`Week` rows into `StartDate`/`EndDate` ranges. Safe to
run even on an empty/fresh sheet (it's a no-op if already migrated). If
you have no real bookings yet, it's just as easy to re-run `setupSheet()`
on a fresh Sheet instead.

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
  `IsAdmin` = `TRUE`, `QuotaNights` doesn't matter (admin doesn't book
  for themself). You can also do all of this from the app's **Admin**
  tab once it's deployed, instead of editing the Sheet directly.
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

- **Investors**: click a start day to select a stay — it defaults to 7
  nights (shown **blue**), and can be extended a night at a time (click
  further out, or use the +/− stepper) before hitting **Submit for
  approval**. The stay turns **light grey** for everyone — reserved, not
  yet confirmed. Nothing becomes a real booking until you approve it.
  Requests need at least 3 weeks' notice from today.
  Investors only ever see *their own* stays in their own color — every
  other investor's stay (pending or approved) shows as one generic
  "booked, not available" grey, with no name attached.
- **You (admin)**: three tabs at the top — **Calendar**, **Approvals**,
  **Admin**.
  - *Calendar*: pick a house from the dropdown, optionally "act as" any
    investor, and book/cancel directly on any notice — this bypasses
    both the approval queue and the 3-week rule (it's your call as
    admin). You still see every investor's stays in their own color.
  - *Approvals*: every pending request across **all houses**, one row
    per request, showing the house, investor, stay dates/nights, how
    many nights they have left before and after this request, and the
    gap in days to the nearest approved stay before and after it.
    Approve or reject with one click.
  - *Admin*: add, edit, or delete houses and investors; reset anyone's
    PIN; change quotas — all without opening the Google Sheet. The
    Sheet is still the real database underneath.
- Rejected requests free the dates back up immediately; approved ones
  turn into that investor's own color on the calendar (to you — other
  investors still just see "booked").
- **Changing PIN**: everyone (investors and you) has a "Change PIN"
  button next to "Log out" — asks for current PIN plus the new one
  twice, updates it themselves, no Sheet editing needed. As admin, you
  can also reset anyone's PIN directly from the **Admin** tab, or as a
  last resort overwrite it directly in the Users tab.

## 6. Adding a second house later

No code changes needed:
1. Add a row to the **Houses** tab with a new `HouseID` and name.
2. Add that house's investors to the **Users** tab with the matching
   `HouseID`.
3. Done — it'll appear in your house-switcher dropdown automatically,
   and its investors log in with their own name + PIN exactly like the
   first house's.

## 7. Test it

- Log in as an investor, pick a start day at least 3 weeks out, submit
  the default 7-night stay — should turn grey immediately.
- Log in as admin, go to **Approvals** — you should see that request
  with nights-left and gap numbers filled in. Approve it — back on the
  Calendar it should now show in that investor's color.
- Try rejecting a request — the dates should become selectable again.
- Log back in as an investor and confirm every *other* investor's stay
  shows as one generic "booked" grey, not their own color.
- Try the **House** dropdown (admin only) if you've added a second
  house — the calendar should switch to that house's investors and
  bookings.
- Try the **Admin** tab: add a test investor, reset their PIN, then
  delete them again.
