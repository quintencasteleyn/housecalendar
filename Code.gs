/**
 * SHARED HOUSE BOOKING CALENDAR — Apps Script backend (v3)
 * ----------------------------------------------------------
 * v3 changes from v2:
 *  - Bookings are flexible date ranges (min 7 nights, +1 at a time) instead
 *    of fixed Monday-Sunday ISO weeks. Each stay is ONE row.
 *  - Users.WeeklyQuota (weeks) became Users.QuotaNights (nights).
 *  - The old "2 consecutive summer weeks" rule is removed.
 *  - Investors must submit requests at least 3 weeks (21 days) before the
 *    stay starts, so unclaimed time can still be listed on Airbnb/Booking.
 *    This does NOT apply to the admin's own direct bookings.
 *  - New admin-only endpoints to manage Houses/Users from the app itself
 *    (add/edit/delete houses & investors, reset PINs, change quotas) —
 *    no more need to open the Sheet directly for that.
 *
 * If you're upgrading from v2 and already have real data in Users/Bookings,
 * run migrateToV3() ONCE from this editor (function dropdown, top of file)
 * before using the app. It's safe to run even on a fresh/empty sheet.
 *
 * Sheets: Houses, Users, Bookings.
 * Deploy as a Web App (Execute as: Me, Access: Anyone). If you're pushing
 * this via clasp, remember `clasp push` only updates the saved code —
 * you still need `clasp deploy -i <deploymentId>` (or the Apps Script
 * editor's Manage deployments > pencil icon > New version) to make it live
 * on the existing /exec URL.
 */

const HOUSES_SHEET = 'Houses';
const USERS_SHEET = 'Users';
const BOOKINGS_SHEET = 'Bookings';
const MIN_NIGHTS = 7;
const MIN_ADVANCE_DAYS = 21; // investors must request at least 3 weeks ahead

// Leave this blank if you opened this script via Extensions > Apps Script
// from INSIDE the Google Sheet — that's the normal case and it just works.
// Only fill this in if you ever see "Cannot read properties of null
// (reading 'getSheetByName')": that means the script isn't bound to a
// Sheet (e.g. it was created separately at script.google.com). Fix: open
// the Sheet itself, go to Extensions > Apps Script from there instead —
// or, as a fallback, paste the Sheet's ID here (the long string in its
// URL between /d/ and /edit).
const SPREADSHEET_ID = '';

function getSS_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  throw new Error(
    'No active spreadsheet found. Open this script via Extensions > Apps Script ' +
    'from INSIDE your Google Sheet (not from script.google.com directly) — or paste ' +
    'your Sheet\'s ID into SPREADSHEET_ID near the top of Code.gs.'
  );
}

// ---------- One-time setup (fresh installs) ----------
function setupSheet() {
  const ss = getSS_();

  let houses = ss.getSheetByName(HOUSES_SHEET);
  if (!houses) houses = ss.insertSheet(HOUSES_SHEET);
  houses.clear();
  houses.appendRow(['HouseID', 'HouseName']);
  houses.appendRow(['house1', 'Sweden House']);
  houses.setFrozenRows(1);

  let users = ss.getSheetByName(USERS_SHEET);
  if (!users) users = ss.insertSheet(USERS_SHEET);
  users.clear();
  users.appendRow(['HouseID', 'Name', 'PIN', 'Color', 'IsAdmin', 'QuotaNights']);
  users.appendRow(['house1', 'Investor A', '544148', '#B65A2E', 'FALSE', 28]);
  users.appendRow(['house1', 'Investor B', '403239', '#4F7A5B', 'FALSE', 28]);
  users.appendRow(['house1', 'Investor C', '305002', '#C99A3B', 'FALSE', 28]);
  users.appendRow(['house1', 'Investor D', '605965', '#7B4B8A', 'FALSE', 28]);
  users.appendRow(['', 'Quinten', '157758', '#6B6B6B', 'TRUE', 0]);
  users.setFrozenRows(1);

  let bookings = ss.getSheetByName(BOOKINGS_SHEET);
  if (!bookings) bookings = ss.insertSheet(BOOKINGS_SHEET);
  bookings.clear();
  bookings.appendRow(['ID', 'HouseID', 'StartDate', 'EndDate', 'UserName', 'Status', 'AdminNote', 'CreatedAt', 'DecidedAt']);
  bookings.getRange('C:D').setNumberFormat('@'); // dates stored as plain 'YYYY-MM-DD' text, never auto-converted
  bookings.setFrozenRows(1);

  SpreadsheetApp.flush();
  Logger.log('Setup complete. Edit Houses/Users to match reality — see Setup.MD.');
}

// ---------- One-time v2 -> v3 migration (existing installs) ----------
function migrateToV3() {
  const ss = getSS_();

  // Users: WeeklyQuota (weeks) -> QuotaNights (nights = weeks * 7).
  const users = ss.getSheetByName(USERS_SHEET);
  const uHeader = users.getRange(1, 1, 1, 6).getValues()[0];
  if (uHeader[5] === 'WeeklyQuota') {
    const last = users.getLastRow();
    if (last > 1) {
      const range = users.getRange(2, 6, last - 1, 1);
      range.setValues(range.getValues().map(r => [(Number(r[0]) || 0) * 7]));
    }
    users.getRange(1, 6).setValue('QuotaNights');
    Logger.log('Users: WeeklyQuota converted to QuotaNights (x7).');
  } else {
    Logger.log('Users already on QuotaNights — nothing to do.');
  }

  // Bookings: Year/Week -> StartDate/EndDate. Each old weekly row becomes
  // its own 7-night Mon-Sun stay (back-to-back weeks by the same investor
  // stay as separate rows — merge manually in the Sheet afterwards if you
  // want them shown as one longer stay).
  const bookings = ss.getSheetByName(BOOKINGS_SHEET);
  const bHeader = bookings.getRange(1, 1, 1, 9).getValues()[0];
  if (bHeader[2] === 'Year' && bHeader[3] === 'Week') {
    const last = bookings.getLastRow();
    const oldRows = last > 1 ? bookings.getRange(2, 1, last - 1, 9).getValues() : [];
    bookings.getRange(1, 1, 1, 9).setValues([['ID', 'HouseID', 'StartDate', 'EndDate', 'UserName', 'Status', 'AdminNote', 'CreatedAt', 'DecidedAt']]);
    if (last > 1) bookings.getRange(2, 1, last - 1, 9).clearContent();
    bookings.getRange('C:D').setNumberFormat('@');
    oldRows.forEach(r => {
      const monday = mondayOfISOWeek_legacy_(Number(r[2]), Number(r[3]));
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      bookings.appendRow([r[0], r[1], formatISODate_(monday), formatISODate_(sunday), r[4], r[5], r[6], r[7], r[8]]);
    });
    Logger.log(`Bookings: converted ${oldRows.length} week-based row(s) to date ranges.`);
  } else {
    bookings.getRange('C:D').setNumberFormat('@');
    Logger.log('Bookings already on StartDate/EndDate — nothing to do.');
  }

  SpreadsheetApp.flush();
  Logger.log('Migration to v3 complete.');
}

// Only used by migrateToV3() to translate old Year/Week rows.
function mondayOfISOWeek_legacy_(year, week) {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay();
  const monday = new Date(simple);
  if (dow <= 4) monday.setUTCDate(simple.getUTCDate() - dow + 1);
  else monday.setUTCDate(simple.getUTCDate() + 8 - dow);
  return monday;
}

// ---------- HTTP entry points ----------
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'data';
  try {
    if (action === 'roster') return jsonOut(getRoster());
    if (action === 'houses') return jsonOut(readHouses_());
    if (action === 'data') return jsonOut(getData(e.parameter.house));
    return jsonOut({ error: 'Unknown action' });
  } catch (err) {
    return jsonOut({ error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    if (action === 'login') return jsonOut(login(body.name, body.pin));
    if (action === 'changePin') return jsonOut(changePin(body));
    if (action === 'requestBooking') return jsonOut(requestBooking(body));
    if (action === 'cancel') return jsonOut(cancelBooking(body));
    if (action === 'getPendingRequests') return jsonOut(getPendingRequests(body));
    if (action === 'decideRequest') return jsonOut(decideRequest(body));
    if (action === 'adminListUsers') return jsonOut(adminListUsers(body));
    if (action === 'adminAddHouse') return jsonOut(adminAddHouse(body));
    if (action === 'adminUpdateHouse') return jsonOut(adminUpdateHouse(body));
    if (action === 'adminDeleteHouse') return jsonOut(adminDeleteHouse(body));
    if (action === 'adminAddUser') return jsonOut(adminAddUser(body));
    if (action === 'adminUpdateUser') return jsonOut(adminUpdateUser(body));
    if (action === 'adminResetPin') return jsonOut(adminResetPin(body));
    if (action === 'adminDeleteUser') return jsonOut(adminDeleteUser(body));
    return jsonOut({ error: 'Unknown action' });
  } catch (err) {
    return jsonOut({ error: String(err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- Date helpers (dates are always plain 'YYYY-MM-DD' strings) ----------
function parseISODate_(s) {
  const parts = String(s).split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}
function formatISODate_(date) {
  const y = date.getUTCFullYear(), m = String(date.getUTCMonth() + 1).padStart(2, '0'), d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function addDaysISO_(s, days) {
  const d = parseISODate_(s);
  d.setUTCDate(d.getUTCDate() + days);
  return formatISODate_(d);
}
function daysBetweenISO_(a, b) { // b - a, in whole days
  return Math.round((parseISODate_(b) - parseISODate_(a)) / 86400000);
}
function nightsOf_(b) { return daysBetweenISO_(b.startDate, b.endDate) + 1; }
function rangesOverlap_(aStart, aEnd, bStart, bEnd) { return aStart <= bEnd && bStart <= aEnd; }

// ---------- Data access ----------
function readHouses_() {
  const sh = getSS_().getSheetByName(HOUSES_SHEET);
  const rows = sh.getDataRange().getValues();
  rows.shift();
  return rows.filter(r => r[0]).map(r => ({ id: String(r[0]), name: String(r[1]) }));
}

function readUsers_() {
  const sh = getSS_().getSheetByName(USERS_SHEET);
  const rows = sh.getDataRange().getValues();
  rows.shift();
  return rows
    .filter(r => r[1])
    .map(r => ({
      houseId: String(r[0] || ''),
      name: String(r[1]),
      pin: String(r[2]),
      color: String(r[3]),
      isAdmin: String(r[4]).toUpperCase() === 'TRUE',
      quotaNights: Number(r[5]) || 0,
    }));
}

function readBookings_() {
  const sh = getSS_().getSheetByName(BOOKINGS_SHEET);
  const rows = sh.getDataRange().getValues();
  rows.shift();
  return rows
    .filter(r => r[0])
    .map(r => ({
      id: String(r[0]),
      houseId: String(r[1]),
      startDate: String(r[2]),
      endDate: String(r[3]),
      userName: String(r[4]),
      status: String(r[5] || 'approved'), // pending | approved | rejected
      adminNote: String(r[6] || ''),
      createdAt: r[7],
      decidedAt: r[8],
    }));
}

function getRoster() {
  return readUsers_().map(u => ({ name: u.name, color: u.color, isAdmin: u.isAdmin, houseId: u.houseId }));
}

function getData(houseId) {
  const users = readUsers_()
    .filter(u => !u.isAdmin && (!houseId || u.houseId === houseId))
    .map(u => ({ name: u.name, color: u.color, quotaNights: u.quotaNights }));
  const bookings = readBookings_()
    .filter(b => (!houseId || b.houseId === houseId) && b.status !== 'rejected')
    .map(b => ({ id: b.id, startDate: b.startDate, endDate: b.endDate, userName: b.userName, status: b.status }));
  return { users, bookings, serverNow: new Date().toISOString() };
}

// ---------- Auth ----------
function login(name, pin) {
  const target = String(name || '').trim().toLowerCase();
  const user = readUsers_().find(u => u.name.trim().toLowerCase() === target && u.pin === String(pin));
  if (!user) return { ok: false, error: 'Name or PIN not recognised.' };
  const out = {
    ok: true,
    user: {
      name: user.name, color: user.color, isAdmin: user.isAdmin,
      quotaNights: user.quotaNights, houseId: user.houseId,
    },
  };
  if (user.isAdmin) out.houses = readHouses_();
  return out;
}

function authenticate_(name, pin) {
  const user = readUsers_().find(u => u.name === name && u.pin === String(pin));
  if (!user) throw new Error('Invalid login.');
  return user;
}

// ---------- Self-service PIN change ----------
function changePin(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const requester = authenticate_(body.name, body.pin); // must know the CURRENT pin
    const newPin = String(body.newPin || '').trim();
    if (!newPin) return { ok: false, error: 'New PIN cannot be empty.' };
    if (newPin.length < 4) return { ok: false, error: 'PIN should be at least 4 characters.' };
    if (newPin === requester.pin) return { ok: false, error: 'That’s already your PIN.' };

    const sh = getSS_().getSheetByName(USERS_SHEET);
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1]) === requester.name && String(rows[i][2]) === requester.pin) {
        sh.getRange(i + 1, 3).setValue(newPin); // PIN is column C
        return { ok: true };
      }
    }
    return { ok: false, error: 'Could not find your account row.' };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Booking / request logic ----------
// directApprove = true for the admin booking directly on someone's behalf
// (bypasses the approval queue AND the 3-week advance-notice rule — that
// rule exists so unclaimed time can be listed on Airbnb, which is the
// admin's call to make on shorter notice, not a restriction on the admin).
// directApprove = false for an investor's own submission (creates a
// Status=pending row that needs admin approval).
function requestBooking(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const requester = authenticate_(body.name, body.pin);
    const targetName = requester.isAdmin ? body.actingAs : requester.name;
    const houseId = requester.isAdmin ? body.houseId : requester.houseId;
    const target = readUsers_().find(u => u.name === targetName && u.houseId === houseId);
    if (!target) return { ok: false, error: 'Unknown investor for this house.' };

    const startDate = String(body.startDate || '');
    const nights = Math.round(Number(body.nights));
    const force = requester.isAdmin && !!body.force;
    const directApprove = requester.isAdmin;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { ok: false, error: 'Invalid start date.' };
    if (!nights || nights < MIN_NIGHTS) return { ok: false, error: `Stays must be at least ${MIN_NIGHTS} nights.` };

    const endDate = addDaysISO_(startDate, nights - 1);
    const year = parseISODate_(startDate).getUTCFullYear();
    const todayISO = formatISODate_(new Date());

    if (!requester.isAdmin) {
      const minStart = addDaysISO_(todayISO, MIN_ADVANCE_DAYS);
      if (startDate < minStart) {
        return { ok: false, error: `Requests need at least 3 weeks' notice — earliest bookable start date is ${minStart}.` };
      }
    }

    if (!force) {
      const curYear = new Date().getUTCFullYear();
      if (year < curYear || year > curYear + 1) {
        return { ok: false, error: `You can only book starting in ${curYear} or ${curYear + 1} right now.` };
      }
      if (startDate < todayISO) {
        return { ok: false, error: 'That start date has already passed.' };
      }

      const existingNights = readBookings_()
        .filter(b => b.houseId === houseId && b.status !== 'rejected' && b.userName === targetName &&
          parseISODate_(b.startDate).getUTCFullYear() === year)
        .reduce((sum, b) => sum + nightsOf_(b), 0);
      if (existingNights + nights > target.quotaNights) {
        return { ok: false, error: `${target.name} can only book ${target.quotaNights} nights in ${year} (would be ${existingNights + nights}).` };
      }
    }

    // Conflicts: block on anything active (pending OR approved) that overlaps,
    // including the same investor's other stays — each stay stays a clean,
    // separate row rather than silently merging with an existing one.
    const allBookings = readBookings_().filter(b => b.houseId === houseId && b.status !== 'rejected');
    const overlaps = allBookings.filter(b => rangesOverlap_(startDate, endDate, b.startDate, b.endDate));
    if (overlaps.length) {
      if (force) {
        removeRowsByIds_(getSS_().getSheetByName(BOOKINGS_SHEET), overlaps.map(o => o.id));
      } else {
        const first = overlaps[0];
        return { ok: false, error: `Not available: overlaps ${first.userName}'s ${first.status} stay (${first.startDate} to ${first.endDate}).` };
      }
    }

    const sh = getSS_().getSheetByName(BOOKINGS_SHEET);
    const id = Utilities.getUuid();
    const now = new Date();
    const status = directApprove ? 'approved' : 'pending';
    sh.appendRow([id, houseId, startDate, endDate, target.name, status, '', now, directApprove ? now : '']);

    return { ok: true, status, id };
  } finally {
    lock.releaseLock();
  }
}

function cancelBooking(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const requester = authenticate_(body.name, body.pin);
    const id = String(body.id || '');
    const sh = getSS_().getSheetByName(BOOKINGS_SHEET);
    const rows = sh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][0]) === id) {
        const ownerName = String(rows[i][4]);
        const status = String(rows[i][5]);
        if (!requester.isAdmin && ownerName !== requester.name) return { ok: false, error: 'Not allowed.' };
        if (status === 'rejected') return { ok: false, error: 'Already rejected.' };
        sh.deleteRow(i + 1);
        return { ok: true };
      }
    }
    return { ok: false, error: 'Booking not found.' };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Admin approval queue ----------
// Each pending row is already exactly one investor's one stay, so (unlike
// v2) there's no need to group multiple rows into one line — every request
// gets its own gap/quota numbers.
function getPendingRequests(body) {
  const requester = authenticate_(body.name, body.pin);
  if (!requester.isAdmin) return { ok: false, error: 'Admin only.' };

  const houses = readHouses_();
  const houseName_ = id => (houses.find(h => h.id === id) || {}).name || id;
  const users = readUsers_();
  const allBookings = readBookings_();
  const pending = allBookings.filter(b => b.status === 'pending');

  const out = pending.map(b => {
    const nights = nightsOf_(b);
    const year = parseISODate_(b.startDate).getUTCFullYear();
    const user = users.find(u => u.name === b.userName && u.houseId === b.houseId);
    const quota = user ? user.quotaNights : 0;
    const approvedNights = allBookings
      .filter(x => x.houseId === b.houseId && x.userName === b.userName && x.status === 'approved' &&
        parseISODate_(x.startDate).getUTCFullYear() === year)
      .reduce((sum, x) => sum + nightsOf_(x), 0);
    const gaps = computeGaps_(b.houseId, b.startDate, b.endDate);
    return {
      id: b.id,
      houseId: b.houseId,
      houseName: houseName_(b.houseId),
      userName: b.userName,
      startDate: b.startDate,
      endDate: b.endDate,
      nights,
      nightsLeftBefore: quota - approvedNights,
      nightsLeftAfter: quota - approvedNights - nights,
      quota,
      gapBeforeDays: gaps.gapBeforeDays,
      gapAfterDays: gaps.gapAfterDays,
      submittedAt: b.createdAt,
    };
  });
  out.sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
  return { ok: true, requests: out };
}

function decideRequest(body) {
  const requester = authenticate_(body.name, body.pin);
  if (!requester.isAdmin) return { ok: false, error: 'Admin only.' };
  const id = String(body.id || '');
  const decision = body.decision; // 'approved' | 'rejected'
  if (['approved', 'rejected'].indexOf(decision) === -1) return { ok: false, error: 'Bad decision.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rows = readBookings_();
    const row = rows.find(r => r.id === id);
    if (!row) return { ok: false, error: 'Request not found.' };
    if (decision === 'approved') {
      // Safety re-check: this stay may not overlap something already approved.
      const clash = rows.find(x => x.id !== id && x.houseId === row.houseId && x.status === 'approved' &&
        rangesOverlap_(row.startDate, row.endDate, x.startDate, x.endDate));
      if (clash) {
        return { ok: false, error: `Overlaps ${clash.userName}'s approved stay (${clash.startDate} to ${clash.endDate}) in the meantime.` };
      }
    }
    const sh = getSS_().getSheetByName(BOOKINGS_SHEET);
    const values = sh.getDataRange().getValues();
    const now = new Date();
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]) === id) {
        sh.getRange(i + 1, 6).setValue(decision);       // Status
        sh.getRange(i + 1, 7).setValue(body.note || ''); // AdminNote
        sh.getRange(i + 1, 9).setValue(now);             // DecidedAt
        break;
      }
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Gap before/after, in whole days, to the nearest APPROVED stay in the same
// house (any investor, any year).
function computeGaps_(houseId, startDate, endDate) {
  const approved = readBookings_().filter(b => b.houseId === houseId && b.status === 'approved');
  let gapBefore = null, gapAfter = null;
  approved.forEach(b => {
    if (b.endDate < startDate) {
      const diff = daysBetweenISO_(b.endDate, startDate) - 1;
      if (gapBefore === null || diff < gapBefore) gapBefore = diff;
    }
    if (b.startDate > endDate) {
      const diff = daysBetweenISO_(endDate, b.startDate) - 1;
      if (gapAfter === null || diff < gapAfter) gapAfter = diff;
    }
  });
  return { gapBeforeDays: gapBefore, gapAfterDays: gapAfter };
}

function removeRowsByIds_(sh, ids) {
  const rows = sh.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (ids.indexOf(String(rows[i][0])) !== -1) sh.deleteRow(i + 1);
  }
}

// ---------- Admin: manage houses & users from the app ----------
function adminListUsers(body) {
  const requester = authenticate_(body.name, body.pin);
  if (!requester.isAdmin) return { ok: false, error: 'Admin only.' };
  return { ok: true, houses: readHouses_(), users: readUsers_() };
}

function adminAddHouse(body) {
  const requester = authenticate_(body.name, body.pin);
  if (!requester.isAdmin) return { ok: false, error: 'Admin only.' };
  const id = String(body.houseId || '').trim();
  const name = String(body.houseName || '').trim();
  if (!id || !name) return { ok: false, error: 'House ID and name are required.' };
  if (readHouses_().some(h => h.id === id)) return { ok: false, error: 'A house with that ID already exists.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    getSS_().getSheetByName(HOUSES_SHEET).appendRow([id, name]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function adminUpdateHouse(body) {
  const requester = authenticate_(body.name, body.pin);
  if (!requester.isAdmin) return { ok: false, error: 'Admin only.' };
  const id = String(body.houseId || '');
  const newName = String(body.houseName || '').trim();
  if (!newName) return { ok: false, error: 'House name is required.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSS_().getSheetByName(HOUSES_SHEET);
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === id) { sh.getRange(i + 1, 2).setValue(newName); return { ok: true }; }
    }
    return { ok: false, error: 'House not found.' };
  } finally { lock.releaseLock(); }
}

function adminDeleteHouse(body) {
  const requester = authenticate_(body.name, body.pin);
  if (!requester.isAdmin) return { ok: false, error: 'Admin only.' };
  const id = String(body.houseId || '');
  if (readUsers_().some(u => u.houseId === id)) {
    return { ok: false, error: 'This house still has investors assigned — move or delete them first.' };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSS_().getSheetByName(HOUSES_SHEET);
    const rows = sh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][0]) === id) { sh.deleteRow(i + 1); return { ok: true }; }
    }
    return { ok: false, error: 'House not found.' };
  } finally { lock.releaseLock(); }
}

function adminAddUser(body) {
  const requester = authenticate_(body.name, body.pin);
  if (!requester.isAdmin) return { ok: false, error: 'Admin only.' };
  const name = String(body.userName || '').trim();
  const pin = String(body.newUserPin || '').trim();
  const isAdmin = !!body.isAdmin;
  const houseId = isAdmin ? '' : String(body.houseId || '');
  const color = String(body.color || '#6b6b6b');
  const quotaNights = isAdmin ? 0 : Math.max(0, Math.round(Number(body.quotaNights) || 0));
  if (!name) return { ok: false, error: 'Name is required.' };
  if (!pin || pin.length < 4) return { ok: false, error: 'PIN should be at least 4 characters.' };
  if (!isAdmin && !houseId) return { ok: false, error: 'House is required for a non-admin investor.' };
  if (readUsers_().some(u => u.name.trim().toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: 'Someone with that name already exists.' };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    getSS_().getSheetByName(USERS_SHEET).appendRow([houseId, name, pin, color, isAdmin ? 'TRUE' : 'FALSE', quotaNights]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function adminUpdateUser(body) {
  const requester = authenticate_(body.name, body.pin);
  if (!requester.isAdmin) return { ok: false, error: 'Admin only.' };
  const targetName = String(body.targetName || '');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSS_().getSheetByName(USERS_SHEET);
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1]) === targetName) {
        const isAdminVal = body.isAdmin !== undefined ? !!body.isAdmin : (String(rows[i][4]).toUpperCase() === 'TRUE');
        if (body.isAdmin !== undefined) sh.getRange(i + 1, 5).setValue(isAdminVal ? 'TRUE' : 'FALSE');
        if (isAdminVal) {
          sh.getRange(i + 1, 1).setValue(''); // admins aren't tied to a house
        } else if (body.houseId !== undefined) {
          sh.getRange(i + 1, 1).setValue(String(body.houseId));
        }
        if (body.color !== undefined) sh.getRange(i + 1, 4).setValue(String(body.color));
        if (body.quotaNights !== undefined) sh.getRange(i + 1, 6).setValue(Math.max(0, Math.round(Number(body.quotaNights) || 0)));
        return { ok: true };
      }
    }
    return { ok: false, error: 'User not found.' };
  } finally { lock.releaseLock(); }
}

function adminResetPin(body) {
  const requester = authenticate_(body.name, body.pin);
  if (!requester.isAdmin) return { ok: false, error: 'Admin only.' };
  const targetName = String(body.targetName || '');
  const newPin = String(body.newPin || '').trim();
  if (!newPin || newPin.length < 4) return { ok: false, error: 'PIN should be at least 4 characters.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSS_().getSheetByName(USERS_SHEET);
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1]) === targetName) { sh.getRange(i + 1, 3).setValue(newPin); return { ok: true }; }
    }
    return { ok: false, error: 'User not found.' };
  } finally { lock.releaseLock(); }
}

function adminDeleteUser(body) {
  const requester = authenticate_(body.name, body.pin);
  if (!requester.isAdmin) return { ok: false, error: 'Admin only.' };
  const targetName = String(body.targetName || '');
  if (targetName === requester.name) return { ok: false, error: 'You can’t delete your own account.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSS_().getSheetByName(USERS_SHEET);
    const rows = sh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][1]) === targetName) { sh.deleteRow(i + 1); return { ok: true }; }
    }
    return { ok: false, error: 'User not found.' };
  } finally { lock.releaseLock(); }
}
