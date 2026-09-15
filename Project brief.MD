# Shared House Booking Calendar — Project Brief

Context for picking this project up (e.g. in Claude Code) without the
history of how it was built. The code is the source of truth for *what*
it does; this doc exists for the *why*, and for anything not obvious
from reading `index.html` / `Code.gs` alone.

## What this is

A booking coordination tool for a shared vacation property, used by up
to 4 co-investors plus one admin. Investors request weeks; the admin
approves or rejects. Built to extend to multiple houses later without
code changes — just new Sheet rows.

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
- **Users**: `HouseID`, `Name`, `PIN`, `Color`, `IsAdmin`, `WeeklyQuota`
  — PINs are **plain text**, intentionally. Fine for this trust level
    (a family/co-investor group), not fine if this pattern gets reused
    for anything more sensitive.
- **Bookings**: `ID`, `HouseID`, `Year`, `Week`, `UserName`, `Status`
  (`pending` / `approved` / `rejected`), `AdminNote`, `CreatedAt`,
  `DecidedAt`

## Business rules (enforced server-side; mirrored client-side for instant feedback)

1. Weeks are ISO 8601 (Monday–Sunday). A week "belongs" to whichever
   month contains its **Thursday** — the standard ISO convention, and
   what decides whether a week counts toward the summer rule below.
2. Each investor can book up to their `WeeklyQuota` (default 4) weeks
   per year.
3. Only the current year and next year are bookable. Further years show
   as locked/read-only — this is a rolling window, not a fixed cutoff:
   it advances automatically as real time passes.
4. **Summer rule**: for weeks falling in June–September, an investor
   needs at least one block of 2 *consecutive* weeks among their summer
   bookings. One extra, non-adjacent summer week alongside that block
   is fine. Two or more isolated single summer weeks with no adjacent
   pair among them is rejected.
5. Investors **submit requests** (shown grey, pending). Only admin
   approval turns a request into a confirmed booking (colored, per
   investor). The admin's own direct bookings (via "Acting as") skip
   the queue entirely — that's intentional, not a bug.
6. The approval page shows, per pending request: house, investor, weeks
   requested, quota remaining before/after this request, and the gap in
   days to the nearest **approved** booking immediately before and
   after (for spotting awkward turnover gaps).
7. Multi-house: `Houses`/`Users`/`Bookings` all carry `HouseID`. Admin
   gets a house switcher on the calendar; the approval queue shows
   pending requests from **all** houses combined, by design.

## Known simplifications (intentional, not bugs)

- Two separate pending submissions from the same investor, same house,
  same year get **grouped into one line** on the approval page and are
  approved/rejected together — not split out individually. Would need
  a bigger change to the approval-page logic to fix.
- The gap-before/after calculation treats a whole multi-week request as
  **one span** (earliest week's Monday to latest week's Sunday), not
  per contiguous sub-block within it.
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

## Not yet done

- `Code.gs` was not version-controlled in the GitHub repo as of this
  brief — it only lived in the Apps Script web editor. First good task
  for whoever picks this up: add it to the repo, and consider setting
  up `clasp` (Google's official Apps Script CLI) so backend deploys can
  be scripted/git-driven instead of manual clicking through the Apps
  Script UI.
- An in-app "admin resets someone's PIN" button was discussed but not
  built. Current fallback: admin edits the PIN cell directly in the
  Users tab — works fine, just manual.
