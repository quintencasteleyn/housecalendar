#!/usr/bin/env node
// One-time data migration: live Google Sheet -> Supabase Postgres.
// ---------------------------------------------------------------
// Deliberately dependency-free (matches this project's no-npm philosophy)
// — talks to both APIs with plain fetch(). Run with: node migrate-data.mjs
//
// Nothing sensitive is hardcoded here or anywhere in this repo: every
// credential comes from an environment variable you set right before
// running this, and this script never writes PINs/emails to the console
// or to disk — only counts and names, so it's safe to paste terminal
// output into a chat if you need help debugging a run.
//
// Required environment variables:
//   APPS_SCRIPT_URL              the CONFIG.API_URL already in index.html (not secret)
//   ADMIN_NAME, ADMIN_PIN        your existing admin login — used once, to read the Sheet
//   SUPABASE_URL                 from your Supabase project's API settings
//   SUPABASE_SERVICE_ROLE_KEY    from the same page — NEVER put this in the frontend
//
// This is safe to run more than once against an EMPTY Supabase project —
// it does not delete anything first, so re-running after a partial success
// will try to re-insert and fail on the duplicate names/houses, which is
// your signal to wipe the tables (Table Editor -> Delete rows) and retry
// rather than silently double-importing.

const required = ["APPS_SCRIPT_URL", "ADMIN_NAME", "ADMIN_PIN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    console.error("See the comment block at the top of this file for what each one is.");
    process.exit(1);
  }
}
const { APPS_SCRIPT_URL, ADMIN_NAME, ADMIN_PIN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

async function appsScriptPost(action, extra = {}) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, name: ADMIN_NAME, pin: ADMIN_PIN, ...extra }),
  });
  const data = await res.json();
  if (data.error || data.ok === false) throw new Error(`Apps Script ${action} failed: ${data.error}`);
  return data;
}

async function supabaseInsert(table, rows) {
  if (!rows.length) return [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Supabase insert into ${table} failed: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  console.log("Reading current data from the live Apps Script API...");
  const usersRes = await appsScriptPost("adminListUsers");
  const bookingsRes = await appsScriptPost("adminListBookings");
  const houses = usersRes.houses;
  const users = usersRes.users;
  const bookings = bookingsRes.bookings;

  console.log(`Found: ${houses.length} house(s), ${users.length} user(s), ${bookings.length} booking(s).`);
  console.log("(Names/PINs/emails are never printed by this script.)");

  console.log("\nImporting houses...");
  await supabaseInsert("houses", houses.map((h) => ({ id: h.id, name: h.name })));

  console.log("Importing users...");
  await supabaseInsert(
    "users",
    users.map((u) => ({
      name: u.name,
      pin: u.pin,
      house_id: u.houseId || null,
      color: u.color,
      is_admin: u.isAdmin,
      quota_nights: u.quotaNights,
      email: u.email || null,
    }))
  );

  console.log("Importing bookings...");
  // adminListBookings() returns houseName, not houseId — re-derive it via
  // the house-name lookup so the new table's foreign key is satisfied.
  const houseIdByName = Object.fromEntries(houses.map((h) => [h.name, h.id]));
  await supabaseInsert(
    "bookings",
    bookings.map((b) => ({
      house_id: houseIdByName[b.houseName],
      user_name: b.userName,
      start_date: b.startDate,
      end_date: b.endDate,
      status: b.status,
      admin_note: b.adminNote || "",
      created_at: b.createdAt || undefined,
      decided_at: b.decidedAt || null,
    }))
  );

  console.log(`\nDone. Imported ${houses.length} house(s), ${users.length} user(s), ${bookings.length} booking(s).`);
  console.log("Spot-check the counts in the Supabase Table Editor before trusting this fully.");
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message);
  console.error("Nothing here deletes data on either side, so it's safe to fix the issue and re-run —");
  console.error("just clear any partially-imported rows in Supabase's Table Editor first.");
  process.exit(1);
});
