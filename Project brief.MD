# Shared House Booking Calendar — Project Brief

Context for picking this project up (e.g. in Claude Code) without the
history of how it was built. The code is the source of truth for *what*
it does; this doc exists for the *why*, and for anything not obvious
from reading `index.html` / `Code.gs` alone.

## What this is

A booking coordination tool for a shared vacation property, used by up
to 4 co-investors plus one admin. Investors request stays (flexible-length,
minimum 7 nights); the admin approves or rejects. Built to extend to
multiple houses later without code changes — just new Sheet rows, or now
also via the in-app Admin tab (see below).

## Architecture

- **Frontend**: `index.html` — single file, vanilla JS, no build step,
  no framework. Hosted on GitHub Pages.
- **Backend**: `Code.gs` — Google Apps Script, deployed as a Web App,
  functions as a small JSON API (`doGet`/`doPost`).
- **Database**: a Google Sheet, 3 tabs — `Houses`, `Users`, `Bookings`.
- Deliberately low-tech: no npm, no build tools, no database server.
  This matches the owner's existing pattern for similar internal tools
  (HTML + Apps Script + GitHub Pages), not a default I'd reach for on a
  greenfield project — worth knowing before "modernizing" it.

## Data model

- **Houses**: `HouseID`, `HouseName`
- **Users**: `HouseID`, `Name`, `PIN`, `Color`, `IsAdmin`, `QuotaNights`
  (nights per year, not weeks — see v3 note below)
  — PINs are **plain text**, intentionally. Fine for this trust level
    (a family/co-investor group), not fine if this pattern gets reused
    for anything more sensitive.
- **Bookings**: `ID`, `HouseID`, `StartDate`, `EndDate` (plain
  `YYYY-MM-DD` text, not real Sheet dates — see v3 note), `UserName`,
  `Status` (`pending` / `approved` / `rejected`), `AdminNote`,
  `CreatedAt`, `DecidedAt`. Each row is one investor's one stay — there
  is no merging of separate bookings into one row.

## Business rules (enforced server-side; mirrored client-side for instant feedback)

1. Stays are flexible-length date ranges, not fixed calendar weeks: pick
   any start day, minimum 7 nights, extend a night at a time from there.
   (v2 used fixed Monday–Sunday ISO weeks; v3 dropped that entirely.)
2. Each investor can book up to their `QuotaNights` (default 28, i.e.
   4 weeks) nights per year. A stay counts toward the year of its
   **start date** — a stay spanning a New Year's Eve counts entirely
   toward the start year, not split across both.
3. Only the current year and next year are bookable (by start date).
   Further years show as locked/read-only — this is a rolling window,
   not a fixed cutoff: it advances automatically as real time passes.
4. Investors must submit requests **at least 3 weeks (21 days) before**
   the stay's start date — this gives the admin time to list unclaimed
   dates on Airbnb/Booking.com if nobody wants them. This does **not**
   apply to the admin's own direct bookings, which can be made on any
   notice.
5. Investors **submit requests** (shown grey, pending). Only admin
   approval turns a request into a confirmed booking (colored per
   investor to the admin; shown as a single generic "booked" color to
   other investors — see v3 note). The admin's own direct bookings (via
   "Acting as") skip the queue entirely — that's intentional, not a bug.
6. The approval page shows, per pending request: house, investor, the
   stay's dates and night count, quota remaining before/after this
   request, and the gap in days to the nearest **approved** stay
   immediately before and after (for spotting awkward turnover gaps).
7. Multi-house: `Houses`/`Users`/`Bookings` all carry `HouseID`. Admin
   gets a house switcher on the calendar; the approval queue shows
   pending requests from **all** houses combined, by design.

## v3 changes (flexible stays, no more Sheet-only admin)

- Bookings moved from fixed ISO weeks to arbitrary date ranges (see
  rule 1). Each request is now one row — no more splitting a multi-week
  request into one row per week, so the old "two submissions get
  grouped into one approval-page line" simplification no longer
  applies; every request shows separately with its own numbers.
- Overlap checking now also blocks the *same* investor from creating a
  second stay that overlaps their own existing one — v2 allowed this as
  a way to seamlessly extend a booking week-by-week. In v3, extend a
  stay via the +/- night stepper *before* submitting, or cancel and
  re-book; there's no merge-on-submit anymore.
- `Users.WeeklyQuota` (weeks) became `Users.QuotaNights` (nights) —
  values were multiplied by 7 during migration.
- `Bookings.Year`/`Week` became `Bookings.StartDate`/`EndDate`, stored
  as plain `YYYY-MM-DD` text (the Sheet columns are force-formatted as
  Text so they're never silently reinterpreted as real dates/serials —
  this sidesteps a timezone footgun where Apps Script's default
  timezone, Brussels, would otherwise shift a UTC midnight timestamp to
  the wrong calendar day when read back).
- The old "summer rule" (2 consecutive weeks required somewhere in
  June–September) is **removed outright** — flexible-length stays made
  it moot.
- Investor-facing privacy: non-admin viewers only ever see their own
  bookings in their own color; every other investor's approved/pending
  stay renders as one generic "unavailable" color/tooltip, with no name
  shown. Admins still see everyone's individual colors and names (they
  need that to manage the calendar and approvals).
- New admin-only **Admin** tab in the app: add/edit/delete houses and
  investors, reset PINs, and change quotas, without opening the Sheet.
  The Sheet is still the actual database underneath — this is a UI
  layer on top of it, not a replacement.
- No password hashing — see PIN note above.
- No email/notification system — approvals, rejections, and new
  requests are only visible by opening the app, nothing gets pushed to
  anyone.

## Deployment mechanics (the part that's easy to get wrong)

- **`index.html` changes**: git push → GitHub Pages auto-redeploys,
  usually within a minute or two. No manual step.
- **`Code.gs` changes**: saving in the Apps Script editor does
  **nothing** to the live URL. Requires Deploy → Manage deployments →
  pencil icon → **New version**. This is the single most common source
  of "I changed it but nothing happened" confusion on this project.

## Deploying backend changes via clasp

`Code.gs` is version-controlled and pushed via [clasp](https://github.com/google/clasp)
(`.clasp.json` / `.claspignore` in the repo root — the latter restricts
`clasp push` to only `Code.gs` + `appsscript.json`, never `index.html`
or the MD files). The usual two-step still applies:

1. `clasp push` — saves the code to the Apps Script project.
2. `clasp deploy -i <deploymentId>` — actually makes it live on the
   existing `/exec` URL. Skipping this step is the scripted equivalent
   of the old "forgot to click New version" trap.

## Not yet done

- Nothing outstanding as of v3 (PIN resets and clasp are both done —
  see the Admin tab and the section above).
