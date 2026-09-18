// Shared House Booking Calendar — Supabase Edge Function
// ---------------------------------------------------------
// Mechanical port of Code.gs. Every action below matches the equivalent
// function there in name and behavior, so the two can be diffed against
// each other. Deliberate differences are called out inline.
//
// This function holds the service-role key and is the ONLY way into the
// database (see supabase/migrations/0002_rls_deny_all.sql) — it performs
// its own authorization checks, exactly as authenticate_() did in
// Code.gs, rather than relying on Postgres RLS policies keyed to a JWT.
//
// Secrets this function needs (set via `supabase secrets set`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — auto-provided by Supabase
//   RESEND_API_KEY                           — from resend.com, for email
//   HOST_EMAIL                               — defaults to the value below
//   EMAIL_FROM                               — defaults to Resend's sandbox address;
//                                               replace once you verify your own domain

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
const HOST_EMAIL = Deno.env.get("HOST_EMAIL") ?? "quinten.casteleynq@gmail.com";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "onboarding@resend.dev";

const MIN_NIGHTS = 7;
const MIN_ADVANCE_DAYS = 21;

const db = createClient(supabaseUrl, serviceKey);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// ---------- Date helpers (dates are native Postgres DATE, JS strings 'YYYY-MM-DD') ----------
function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function formatISO(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function addDays(s: string, days: number): string {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() + days);
  return formatISO(d);
}
function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}
function nightsOf(b: { start_date: string; end_date: string }): number {
  return daysBetween(b.start_date, b.end_date) + 1;
}
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
function todayISO(): string {
  return formatISO(new Date());
}

// ---------- Email (Resend) ----------
// Fire-and-forget from the caller's point of view where it matters (e.g.
// decideRequest never lets a mail failure undo an already-saved decision)
// — mirrors the try/catch-and-swallow pattern used in Code.gs.
async function sendEmail(to: string, subject: string, body: string, replyTo?: string) {
  if (!resendKey) throw new Error("RESEND_API_KEY not set — see supabase/MIGRATION_README.md");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, text: body, reply_to: replyTo }),
  });
  if (!res.ok) throw new Error(`Resend error: ${res.status} ${await res.text()}`);
}

// ---------- Data access ----------
async function readHouses() {
  const { data, error } = await db.from("houses").select("id, name");
  if (error) throw error;
  return data;
}
async function readUsers() {
  const { data, error } = await db.from("users").select("*");
  if (error) throw error;
  return data;
}
async function readBookings() {
  const { data, error } = await db.from("bookings").select("*");
  if (error) throw error;
  return data;
}
async function getRoster() {
  const users = await readUsers();
  return users.map((u) => ({ name: u.name, color: u.color, isAdmin: u.is_admin, houseId: u.house_id }));
}
async function getData(houseId: string | null) {
  const users = (await readUsers())
    .filter((u) => !u.is_admin && (!houseId || u.house_id === houseId))
    .map((u) => ({ name: u.name, color: u.color, quotaNights: u.quota_nights }));
  const bookings = (await readBookings())
    .filter((b) => (!houseId || b.house_id === houseId) && b.status !== "rejected")
    .map((b) => ({ id: b.id, startDate: b.start_date, endDate: b.end_date, userName: b.user_name, status: b.status }));
  return { users, bookings, serverNow: new Date().toISOString() };
}

// ---------- Auth ----------
async function login(identifier: string, pin: string) {
  const target = String(identifier || "").trim().toLowerCase();
  const users = await readUsers();
  let user = users.find((u) => u.email && u.email.trim().toLowerCase() === target && u.pin === String(pin));
  if (!user) user = users.find((u) => u.name.trim().toLowerCase() === target && u.pin === String(pin));
  if (!user) return { ok: false, error: "Email/name or PIN not recognised." };
  const out: Record<string, unknown> = {
    ok: true,
    user: { name: user.name, color: user.color, isAdmin: user.is_admin, quotaNights: user.quota_nights, houseId: user.house_id, email: user.email },
  };
  if (user.is_admin) {
    out.houses = await readHouses();
  } else {
    const bookings = await readBookings();
    out.notifications = bookings
      .filter((b) => b.user_name === user!.name && b.decided_at && !b.notified_at && (b.status === "approved" || b.status === "rejected"))
      .map((b) => ({ id: b.id, status: b.status, startDate: b.start_date, endDate: b.end_date, adminNote: b.admin_note }));
  }
  return out;
}
async function authenticate(name: string, pin: string) {
  const target = String(name || "").trim().toLowerCase();
  const users = await readUsers();
  const user = users.find((u) => u.name.trim().toLowerCase() === target && u.pin === String(pin));
  if (!user) throw new Error("Invalid login.");
  return user;
}

async function changePin(body: any) {
  const requester = await authenticate(body.name, body.pin);
  const newPin = String(body.newPin || "").trim();
  if (!newPin) return { ok: false, error: "New PIN cannot be empty." };
  if (newPin.length < 4) return { ok: false, error: "PIN should be at least 4 characters." };
  if (newPin === requester.pin) return { ok: false, error: "That’s already your PIN." };
  const { error } = await db.from("users").update({ pin: newPin }).eq("id", requester.id);
  if (error) throw error;
  return { ok: true };
}

async function requestPinReset(body: any) {
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) return { ok: true };
  const users = await readUsers();
  const user = users.find((u) => u.email && u.email.trim().toLowerCase() === email);
  if (user) {
    const newPin = String(Math.floor(100000 + Math.random() * 900000));
    // Send BEFORE writing — a failed send must not leave the user locked
    // out of an account whose new PIN they were never actually told.
    await sendEmail(
      user.email,
      "Your new Shared House PIN",
      `Hi ${user.name},\n\nA new PIN was requested for your Shared House Booking Calendar account.\n\n` +
        `Your new PIN is: ${newPin}\n\nYou can log in with it right away. We'd recommend changing it to ` +
        `something you'll remember via "Change PIN" once you're in.\n\nIf you didn't request this, someone ` +
        `may have entered your email by mistake — you can just ignore this, or let ${HOST_EMAIL} know.\n`
    ); // throws on failure, propagates to the top-level catch — PIN below is never written if this fails
    const { error } = await db.from("users").update({ pin: newPin }).eq("id", user.id);
    if (error) throw error;
  }
  // Always the same response whether or not the email was found — so this
  // can't be used to check which emails are registered.
  return { ok: true };
}

async function contactHost(body: any) {
  const requester = await authenticate(body.name, body.pin);
  const message = String(body.message || "").trim();
  if (!message) return { ok: false, error: "Message cannot be empty." };
  await sendEmail(
    HOST_EMAIL,
    `[Shared House] Message from ${requester.name}`,
    `${message}\n\n— sent via the Shared House Booking Calendar by ${requester.name}` + (requester.email ? ` (${requester.email})` : ""),
    requester.email || undefined
  );
  return { ok: true };
}

async function updateMyColor(body: any) {
  const requester = await authenticate(body.name, body.pin);
  const color = String(body.color || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { ok: false, error: "Invalid color." };
  const { error } = await db.from("users").update({ color }).eq("id", requester.id);
  if (error) throw error;
  return { ok: true };
}

async function acknowledgeNotification(body: any) {
  const requester = await authenticate(body.name, body.pin);
  const id = String(body.id || "");
  const { data, error } = await db.from("bookings").update({ notified_at: new Date().toISOString() }).eq("id", id).eq("user_name", requester.name).select();
  if (error) throw error;
  if (!data || !data.length) return { ok: false, error: "Not found." };
  return { ok: true };
}

// ---------- Booking / request logic ----------
async function requestBooking(body: any) {
  const requester = await authenticate(body.name, body.pin);
  const targetName = requester.is_admin ? body.actingAs : requester.name;
  const houseId = requester.is_admin ? body.houseId : requester.house_id;
  const users = await readUsers();
  const target = users.find((u) => u.name === targetName && u.house_id === houseId);
  if (!target) return { ok: false, error: "Unknown investor for this house." };

  const startDate = String(body.startDate || "");
  const nights = Math.round(Number(body.nights));
  const force = requester.is_admin && !!body.force;
  const directApprove = requester.is_admin;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { ok: false, error: "Invalid start date." };
  if (!nights || nights < MIN_NIGHTS) return { ok: false, error: `Stays must be at least ${MIN_NIGHTS} nights.` };

  const endDate = addDays(startDate, nights - 1);
  const year = parseISO(startDate).getUTCFullYear();
  const today = todayISO();

  if (!requester.is_admin) {
    const minStart = addDays(today, MIN_ADVANCE_DAYS);
    if (startDate < minStart) {
      return { ok: false, error: `Requests need at least 3 weeks' notice — earliest bookable start date is ${minStart}.` };
    }
  }

  const allBookings = (await readBookings()).filter((b) => b.house_id === houseId && b.status !== "rejected");

  if (!force) {
    const curYear = new Date().getUTCFullYear();
    if (year < curYear || year > curYear + 1) {
      return { ok: false, error: `You can only book starting in ${curYear} or ${curYear + 1} right now.` };
    }
    if (startDate < today) return { ok: false, error: "That start date has already passed." };

    const existingNights = allBookings
      .filter((b) => b.user_name === targetName && parseISO(b.start_date).getUTCFullYear() === year)
      .reduce((sum, b) => sum + nightsOf(b), 0);
    if (existingNights + nights > target.quota_nights) {
      return { ok: false, error: `${target.name} can only book ${target.quota_nights} nights in ${year} (would be ${existingNights + nights}).` };
    }
  }

  const conflicting = allBookings.filter((b) => overlaps(startDate, endDate, b.start_date, b.end_date));
  if (conflicting.length) {
    if (force) {
      const { error } = await db.from("bookings").delete().in("id", conflicting.map((c) => c.id));
      if (error) throw error;
    } else {
      const first = conflicting[0];
      return { ok: false, error: `Not available: overlaps ${first.user_name}'s ${first.status} stay (${first.start_date} to ${first.end_date}).` };
    }
  }

  const status = directApprove ? "approved" : "pending";
  const { data, error } = await db
    .from("bookings")
    .insert({
      house_id: houseId,
      user_name: target.name,
      start_date: startDate,
      end_date: endDate,
      status,
      decided_at: directApprove ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error) throw error;
  return { ok: true, status, id: data.id };
}

async function cancelBooking(body: any) {
  const requester = await authenticate(body.name, body.pin);
  const id = String(body.id || "");
  const { data: rows, error: selErr } = await db.from("bookings").select("*").eq("id", id).limit(1);
  if (selErr) throw selErr;
  const row = rows?.[0];
  if (!row) return { ok: false, error: "Booking not found." };
  if (!requester.is_admin && row.user_name !== requester.name) return { ok: false, error: "Not allowed." };
  if (row.status === "rejected") return { ok: false, error: "Already rejected." };
  const { error } = await db.from("bookings").delete().eq("id", id);
  if (error) throw error;
  return { ok: true };
}

// Gap before/after, in whole days, to the nearest APPROVED stay in the
// same house (any investor, any year) — unchanged from Code.gs: this
// already compared against every investor, not just the requester.
function computeGaps(approved: any[], houseId: string, startDate: string, endDate: string) {
  let gapBefore: number | null = null, gapAfter: number | null = null;
  for (const b of approved.filter((x) => x.house_id === houseId)) {
    if (b.end_date < startDate) {
      const diff = daysBetween(b.end_date, startDate) - 1;
      if (gapBefore === null || diff < gapBefore) gapBefore = diff;
    }
    if (b.start_date > endDate) {
      const diff = daysBetween(endDate, b.start_date) - 1;
      if (gapAfter === null || diff < gapAfter) gapAfter = diff;
    }
  }
  return { gapBeforeDays: gapBefore, gapAfterDays: gapAfter };
}

async function getPendingRequests(body: any) {
  const requester = await authenticate(body.name, body.pin);
  if (!requester.is_admin) return { ok: false, error: "Admin only." };
  const houses = await readHouses();
  const houseName = (id: string) => houses.find((h) => h.id === id)?.name ?? id;
  const users = await readUsers();
  const allBookings = await readBookings();
  const approved = allBookings.filter((b) => b.status === "approved");
  const pending = allBookings.filter((b) => b.status === "pending");

  const out = pending.map((b) => {
    const nights = nightsOf(b);
    const year = parseISO(b.start_date).getUTCFullYear();
    const user = users.find((u) => u.name === b.user_name && u.house_id === b.house_id);
    const quota = user ? user.quota_nights : 0;
    const approvedNights = approved
      .filter((x) => x.house_id === b.house_id && x.user_name === b.user_name && parseISO(x.start_date).getUTCFullYear() === year)
      .reduce((sum, x) => sum + nightsOf(x), 0);
    const gaps = computeGaps(approved, b.house_id, b.start_date, b.end_date);
    return {
      id: b.id, houseId: b.house_id, houseName: houseName(b.house_id), userName: b.user_name,
      startDate: b.start_date, endDate: b.end_date, nights,
      nightsLeftBefore: quota - approvedNights, nightsLeftAfter: quota - approvedNights - nights, quota,
      gapBeforeDays: gaps.gapBeforeDays, gapAfterDays: gaps.gapAfterDays, submittedAt: b.created_at,
    };
  });
  out.sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
  return { ok: true, requests: out };
}

async function decideRequest(body: any) {
  const requester = await authenticate(body.name, body.pin);
  if (!requester.is_admin) return { ok: false, error: "Admin only." };
  const id = String(body.id || "");
  const decision = body.decision;
  if (!["approved", "rejected"].includes(decision)) return { ok: false, error: "Bad decision." };

  const allBookings = await readBookings();
  const row = allBookings.find((r) => r.id === id);
  if (!row) return { ok: false, error: "Request not found." };

  if (decision === "approved") {
    const clash = allBookings.find(
      (x) => x.id !== id && x.house_id === row.house_id && x.status === "approved" && overlaps(row.start_date, row.end_date, x.start_date, x.end_date)
    );
    if (clash) return { ok: false, error: `Overlaps ${clash.user_name}'s approved stay (${clash.start_date} to ${clash.end_date}) in the meantime.` };
  }

  const { error } = await db
    .from("bookings")
    .update({ status: decision, admin_note: body.note || "", decided_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;

  // Email is a bonus on top of the in-app notification (guaranteed, since
  // it doesn't depend on mail working) — never let a mail failure undo an
  // already-saved decision.
  try {
    const users = await readUsers();
    const target = users.find((u) => u.name === row.user_name);
    if (decision === "approved" && target?.email) {
      await sendEmail(
        target.email,
        "Your Shared House request was approved",
        `Hi ${target.name},\n\nGood news — your request for ${row.start_date} to ${row.end_date} has been approved.` +
          (body.note ? `\n\nNote from the host: ${body.note}` : "") + `\n\nSee you then!\n`
      );
    } else if (decision === "rejected" && body.sendEmail && target?.email) {
      // PLACEHOLDER wording — draft the real copy, then replace this body text.
      await sendEmail(
        target.email,
        "Update on your Shared House request",
        `Hi ${target.name},\n\nYour request for ${row.start_date} to ${row.end_date} was not approved this time.` +
          (body.note ? `\n\nNote from the host: ${body.note}` : "") + `\n\nGet in touch if you have questions.\n`
      );
    }
  } catch {
    // Swallow — e.g. RESEND_API_KEY not set yet. The decision itself
    // already succeeded and the in-app notification will still reach them.
  }

  return { ok: true };
}

// ---------- Admin: houses & users ----------
async function adminListUsers(body: any) {
  const requester = await authenticate(body.name, body.pin);
  if (!requester.is_admin) return { ok: false, error: "Admin only." };
  const year = new Date().getUTCFullYear();
  const bookings = (await readBookings()).filter((b) => b.status !== "rejected" && parseISO(b.start_date).getUTCFullYear() === year);
  const users = (await readUsers()).map((u) => {
    const mine = bookings.filter((b) => b.user_name === u.name);
    return {
      ...camelUser(u),
      approvedNightsThisYear: mine.filter((b) => b.status === "approved").reduce((s, b) => s + nightsOf(b), 0),
      pendingNightsThisYear: mine.filter((b) => b.status === "pending").reduce((s, b) => s + nightsOf(b), 0),
    };
  });
  return { ok: true, houses: await readHouses(), users, statsYear: year };
}
function camelUser(u: any) {
  return { houseId: u.house_id, name: u.name, pin: u.pin, color: u.color, isAdmin: u.is_admin, quotaNights: u.quota_nights, email: u.email };
}

async function adminListBookings(body: any) {
  const requester = await authenticate(body.name, body.pin);
  if (!requester.is_admin) return { ok: false, error: "Admin only." };
  const houses = await readHouses();
  const houseName = (id: string) => houses.find((h) => h.id === id)?.name ?? id;
  const bookings = (await readBookings())
    .map((b) => ({
      id: b.id, houseName: houseName(b.house_id), userName: b.user_name,
      startDate: b.start_date, endDate: b.end_date, nights: nightsOf(b),
      status: b.status, adminNote: b.admin_note, createdAt: b.created_at, decidedAt: b.decided_at,
    }))
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  return { ok: true, bookings };
}

async function adminAddHouse(body: any) {
  const requester = await authenticate(body.name, body.pin);
  if (!requester.is_admin) return { ok: false, error: "Admin only." };
  const id = String(body.houseId || "").trim();
  const name = String(body.houseName || "").trim();
  if (!id || !name) return { ok: false, error: "House ID and name are required." };
  const { error } = await db.from("houses").insert({ id, name });
  if (error) return { ok: false, error: error.message.includes("duplicate") ? "A house with that ID already exists." : error.message };
  return { ok: true };
}

async function adminUpdateHouse(body: any) {
  const requester = await authenticate(body.name, body.pin);
  if (!requester.is_admin) return { ok: false, error: "Admin only." };
  const newName = String(body.houseName || "").trim();
  if (!newName) return { ok: false, error: "House name is required." };
  const { data, error } = await db.from("houses").update({ name: newName }).eq("id", body.houseId).select();
  if (error) throw error;
  if (!data?.length) return { ok: false, error: "House not found." };
  return { ok: true };
}

async function adminDeleteHouse(body: any) {
  const requester = await authenticate(body.name, body.pin);
  if (!requester.is_admin) return { ok: false, error: "Admin only." };
  const stillUsed = (await readUsers()).some((u) => u.house_id === body.houseId);
  if (stillUsed) return { ok: false, error: "This house still has investors assigned — move or delete them first." };
  const { data, error } = await db.from("houses").delete().eq("id", body.houseId).select();
  if (error) throw error;
  if (!data?.length) return { ok: false, error: "House not found." };
  return { ok: true };
}

async function adminAddUser(body: any) {
  const requester = await authenticate(body.name, body.pin);
  if (!requester.is_admin) return { ok: false, error: "Admin only." };
  const name = String(body.userName || "").trim();
  const pin = String(body.newUserPin || "").trim();
  const isAdmin = !!body.isAdmin;
  const houseId = isAdmin ? null : String(body.houseId || "");
  const color = String(body.color || "#6b6b6b");
  const quotaNights = isAdmin ? 0 : Math.max(0, Math.round(Number(body.quotaNights) || 0));
  const email = String(body.email || "").trim() || null;
  if (!name) return { ok: false, error: "Name is required." };
  if (!pin || pin.length < 4) return { ok: false, error: "PIN should be at least 4 characters." };
  if (!isAdmin && !houseId) return { ok: false, error: "House is required for a non-admin investor." };
  const { error } = await db.from("users").insert({ name, pin, house_id: houseId, color, is_admin: isAdmin, quota_nights: quotaNights, email });
  if (error) {
    if (error.message.includes("users_name")) return { ok: false, error: "Someone with that name already exists." };
    if (error.message.includes("users_email")) return { ok: false, error: "Someone with that email already exists." };
    throw error;
  }
  return { ok: true };
}

async function adminUpdateUser(body: any) {
  const requester = await authenticate(body.name, body.pin);
  if (!requester.is_admin) return { ok: false, error: "Admin only." };
  const users = await readUsers();
  const target = users.find((u) => u.name === body.targetName);
  if (!target) return { ok: false, error: "User not found." };

  const patch: Record<string, unknown> = {};
  const isAdminVal = body.isAdmin !== undefined ? !!body.isAdmin : target.is_admin;
  if (body.isAdmin !== undefined) patch.is_admin = isAdminVal;
  if (isAdminVal) patch.house_id = null;
  else if (body.houseId !== undefined) patch.house_id = String(body.houseId);
  if (body.color !== undefined) patch.color = String(body.color);
  if (body.quotaNights !== undefined) patch.quota_nights = Math.max(0, Math.round(Number(body.quotaNights) || 0));
  if (body.email !== undefined) patch.email = String(body.email).trim() || null;

  const { error } = await db.from("users").update(patch).eq("id", target.id);
  if (error) throw error;
  return { ok: true };
}

async function adminResetPin(body: any) {
  const requester = await authenticate(body.name, body.pin);
  if (!requester.is_admin) return { ok: false, error: "Admin only." };
  const newPin = String(body.newPin || "").trim();
  if (!newPin || newPin.length < 4) return { ok: false, error: "PIN should be at least 4 characters." };
  const { data, error } = await db.from("users").update({ pin: newPin }).eq("name", body.targetName).select();
  if (error) throw error;
  if (!data?.length) return { ok: false, error: "User not found." };
  return { ok: true };
}

async function adminDeleteUser(body: any) {
  const requester = await authenticate(body.name, body.pin);
  if (!requester.is_admin) return { ok: false, error: "Admin only." };
  if (body.targetName === requester.name) return { ok: false, error: "You can’t delete your own account." };
  const { data, error } = await db.from("users").delete().eq("name", body.targetName).select();
  if (error) throw error;
  if (!data?.length) return { ok: false, error: "User not found." };
  return { ok: true };
}

// ---------- HTTP entry point ----------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const action = url.searchParams.get("action") || "data";
      if (action === "roster") return json(await getRoster());
      if (action === "houses") return json(await readHouses());
      if (action === "data") return json(await getData(url.searchParams.get("house")));
      return json({ error: "Unknown action" });
    }

    const body = await req.json();
    const action = body.action;
    const handlers: Record<string, (b: any) => Promise<unknown>> = {
      login: (b) => login(b.identifier, b.pin),
      changePin, requestPinReset, contactHost, updateMyColor, acknowledgeNotification,
      requestBooking, cancel: cancelBooking, getPendingRequests, decideRequest,
      adminListUsers, adminListBookings, adminAddHouse, adminUpdateHouse, adminDeleteHouse,
      adminAddUser, adminUpdateUser, adminResetPin, adminDeleteUser,
    };
    const handler = handlers[action];
    if (!handler) return json({ error: "Unknown action" });
    return json(await handler(body));
  } catch (err) {
    return json({ error: String(err) });
  }
});
