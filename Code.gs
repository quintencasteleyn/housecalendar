/**
 * SHARED HOUSE BOOKING CALENDAR — Apps Script backend (v2)
 * ----------------------------------------------------------
 * Now supports: multiple houses, a request/approval workflow (investors
 * submit requests, the admin approves or rejects them from a separate
 * admin page), and per-request gap/quota info for the admin.
 *
 * Sheets: Houses, Users, Bookings.
 * Run setupSheet() once to create them with example data, then edit.
 * Deploy as a Web App (Execute as: Me, Access: Anyone) same as before —
 * if you're upgrading from v1, you need a NEW deployment version
 * (Deploy > Manage deployments > pencil icon > New version) for these
 * changes to take effect.
 */

const HOUSES_SHEET = 'Houses';
const USERS_SHEET = 'Users';
const BOOKINGS_SHEET = 'Bookings';

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

// ---------- One-time setup ----------
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
  users.appendRow(['HouseID', 'Name', 'PIN', 'Color', 'IsAdmin', 'WeeklyQuota']);
  users.appendRow(['house1', 'Investor A', '544148', '#B65A2E', 'FALSE', 4]);
  users.appendRow(['house1', 'Investor B', '403239', '#4F7A5B', 'FALSE', 4]);
  users.appendRow(['house1', 'Investor C', '305002', '#C99A3B', 'FALSE', 4]);
  users.appendRow(['house1', 'Investor D', '605965', '#7B4B8A', 'FALSE', 4]);
  users.appendRow(['', 'Quinten', '157758', '#6B6B6B', 'TRUE', 0]);
  users.setFrozenRows(1);

  let bookings = ss.getSheetByName(BOOKINGS_SHEET);
  if (!bookings) bookings = ss.insertSheet(BOOKINGS_SHEET);
  bookings.clear();
  bookings.appendRow(['ID', 'HouseID', 'Year', 'Week', 'UserName', 'Status', 'AdminNote', 'CreatedAt', 'DecidedAt']);
  bookings.setFrozenRows(1);

  SpreadsheetApp.flush();
  Logger.log('Setup complete. Edit Houses/Users to match reality — see SETUP.md for adding more houses later.');
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
    return jsonOut({ error: 'Unknown action' });
  } catch (err) {
    return jsonOut({ error: String(err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

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
      weeklyQuota: Number(r[5]) || 0,
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
      year: Number(r[2]),
      week: Number(r[3]),
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
    .map(u => ({ name: u.name, color: u.color, weeklyQuota: u.weeklyQuota }));
  const bookings = readBookings_()
    .filter(b => (!houseId || b.houseId === houseId) && b.status !== 'rejected')
    .map(b => ({ year: b.year, week: b.week, userName: b.userName, status: b.status }));
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
      weeklyQuota: user.weeklyQuota, houseId: user.houseId,
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
    if (newPin === requester.pin) return { ok: false, error: 'That\u2019s already your PIN.' };

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

// ---------- ISO week helpers ----------
function isoWeek_(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
function isoWeekYear_(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}
function mondayOfISOWeek_(year, week) {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay();
  const monday = new Date(simple);
  if (dow <= 4) monday.setUTCDate(simple.getUTCDate() - dow + 1);
  else monday.setUTCDate(simple.getUTCDate() + 8 - dow);
  return monday;
}
function isSummerWeek_(year, week) {
  const monday = mondayOfISOWeek_(year, week);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const month = thursday.getUTCMonth() + 1;
  return month >= 6 && month <= 9;
}
function currentISOWeekInfo_() {
  const now = new Date();
  return { year: isoWeekYear_(now), week: isoWeek_(now) };
}

// ---------- Booking / request logic ----------
// directApprove = true for the admin booking directly on someone's behalf
// (bypasses the approval queue, same as v1's admin override).
// directApprove = false for an investor's own submission (creates
// Status=pending rows that need admin approval).
function requestBooking(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const requester = authenticate_(body.name, body.pin);
    const targetName = requester.isAdmin ? body.actingAs : requester.name;
    const houseId = requester.isAdmin ? body.houseId : requester.houseId;
    const target = readUsers_().find(u => u.name === targetName && u.houseId === houseId);
    if (!target) return { ok: false, error: 'Unknown investor for this house.' };

    const year = Number(body.year);
    const newWeeks = (body.weeks || []).map(Number);
    const force = requester.isAdmin && !!body.force;
    const directApprove = requester.isAdmin;

    if (!newWeeks.length) return { ok: false, error: 'No weeks selected.' };

    const allBookings = readBookings_().filter(b => b.houseId === houseId && b.status !== 'rejected');
    const existingActiveForTarget = allBookings
      .filter(b => b.userName === targetName && b.year === year)
      .map(b => b.week);

    const proposed = Array.from(new Set(existingActiveForTarget.concat(newWeeks))).sort((a, b) => a - b);

    if (!force) {
      const cur = currentISOWeekInfo_();
      if (year < cur.year || year > cur.year + 1) {
        return { ok: false, error: `You can only book for ${cur.year} or ${cur.year + 1} right now.` };
      }
      if (year === cur.year) {
        const pastRequested = newWeeks.filter(w => w < cur.week);
        if (pastRequested.length) {
          return { ok: false, error: `Week ${pastRequested[0]} of ${year} has already passed.` };
        }
      }
      if (proposed.length > target.weeklyQuota) {
        return { ok: false, error: `${target.name} can only book ${target.weeklyQuota} weeks in ${year} (would be ${proposed.length}).` };
      }
      const summerWeeks = proposed.filter(w => isSummerWeek_(year, w));
      if (summerWeeks.length > 0) {
        let hasPair = false;
        for (let i = 0; i < summerWeeks.length - 1; i++) {
          if (summerWeeks[i + 1] - summerWeeks[i] === 1) { hasPair = true; break; }
        }
        if (!hasPair) {
          return { ok: false, error: 'Summer bookings (June\u2013September) need at least one block of 2 consecutive weeks.' };
        }
      }
    }

    // Conflicts: block on anything active (pending OR approved) by someone else.
    const conflicts = [];
    const toRemoveIds = [];
    for (const w of newWeeks) {
      const clash = allBookings.find(b => b.year === year && b.week === w && b.userName !== targetName);
      if (clash) {
        if (force) toRemoveIds.push(clash.id);
        else conflicts.push({ week: w, by: clash.userName, status: clash.status });
      }
    }
    if (conflicts.length && !force) {
      const list = conflicts.map(c => `week ${c.week} (${c.status === 'pending' ? 'pending, ' : ''}${c.by})`).join(', ');
      return { ok: false, error: `Not available: ${list}.` };
    }

    const sh = getSS_().getSheetByName(BOOKINGS_SHEET);
    if (toRemoveIds.length) removeRowsByIds_(sh, toRemoveIds);

    const toInsert = newWeeks.filter(w => !existingActiveForTarget.includes(w));
    const now = new Date();
    const status = directApprove ? 'approved' : 'pending';
    toInsert.forEach(w => {
      const id = Utilities.getUuid();
      sh.appendRow([id, houseId, year, w, target.name, status, '', now, directApprove ? now : '']);
    });

    return { ok: true, status };
  } finally {
    lock.releaseLock();
  }
}

function cancelBooking(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const requester = authenticate_(body.name, body.pin);
    const targetName = requester.isAdmin ? body.actingAs : requester.name;
    if (!requester.isAdmin && targetName !== requester.name) {
      return { ok: false, error: 'Not allowed.' };
    }
    const houseId = requester.isAdmin ? body.houseId : requester.houseId;
    const year = Number(body.year);
    const week = Number(body.week);
    const sh = getSS_().getSheetByName(BOOKINGS_SHEET);
    const rows = sh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i];
      if (String(r[1]) === houseId && Number(r[2]) === year && Number(r[3]) === week &&
          String(r[4]) === targetName && r[5] !== 'rejected') {
        sh.deleteRow(i + 1);
        break;
      }
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Admin approval queue ----------
function getPendingRequests(body) {
  const requester = authenticate_(body.name, body.pin);
  if (!requester.isAdmin) return { ok: false, error: 'Admin only.' };

  const houses = readHouses_();
  const houseName_ = id => (houses.find(h => h.id === id) || {}).name || id;
  const allBookings = readBookings_();
  const pending = allBookings.filter(b => b.status === 'pending');

  // Group pending rows by house+year+userName so a multi-week request
  // shows as one line with one set of gap/quota numbers, not one row per week.
  const groups = {};
  pending.forEach(b => {
    const key = b.houseId + '|' + b.year + '|' + b.userName;
    if (!groups[key]) groups[key] = { houseId: b.houseId, year: b.year, userName: b.userName, weeks: [], ids: [], createdAt: b.createdAt };
    groups[key].weeks.push(b.week);
    groups[key].ids.push(b.id);
  });

  const out = Object.values(groups).map(g => {
    g.weeks.sort((a, b) => a - b);
    const user = readUsers_().find(u => u.name === g.userName && u.houseId === g.houseId);
    const approvedForUser = allBookings.filter(b =>
      b.houseId === g.houseId && b.year === g.year && b.userName === g.userName && b.status === 'approved'
    ).length;
    const quota = user ? user.weeklyQuota : 0;
    const gaps = computeGaps_(g.houseId, g.year, g.weeks);
    return {
      houseId: g.houseId,
      houseName: houseName_(g.houseId),
      userName: g.userName,
      year: g.year,
      weeks: g.weeks,
      ids: g.ids,
      weeksLeftBefore: quota - approvedForUser,
      weeksLeftAfter: quota - approvedForUser - g.weeks.length,
      quota: quota,
      gapBeforeDays: gaps.gapBeforeDays,
      gapAfterDays: gaps.gapAfterDays,
      submittedAt: g.createdAt,
    };
  });
  out.sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
  return { ok: true, requests: out };
}

function decideRequest(body) {
  const requester = authenticate_(body.name, body.pin);
  if (!requester.isAdmin) return { ok: false, error: 'Admin only.' };
  const ids = body.ids || [];
  const decision = body.decision; // 'approved' | 'rejected'
  if (['approved', 'rejected'].indexOf(decision) === -1) return { ok: false, error: 'Bad decision.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (decision === 'approved') {
      // Safety re-check: none of these weeks may already be approved for someone else.
      const rows = readBookings_();
      const theseRows = rows.filter(r => ids.indexOf(r.id) !== -1);
      for (const r of theseRows) {
        const clash = rows.find(x => x.houseId === r.houseId && x.year === r.year && x.week === r.week &&
          x.userName !== r.userName && x.status === 'approved');
        if (clash) {
          return { ok: false, error: `Week ${r.week}, ${r.year} was approved for ${clash.userName} in the meantime.` };
        }
      }
    }
    const sh = getSS_().getSheetByName(BOOKINGS_SHEET);
    const values = sh.getDataRange().getValues();
    const now = new Date();
    for (let i = 1; i < values.length; i++) {
      if (ids.indexOf(String(values[i][0])) !== -1) {
        sh.getRange(i + 1, 6).setValue(decision);       // Status
        sh.getRange(i + 1, 7).setValue(body.note || ''); // AdminNote
        sh.getRange(i + 1, 9).setValue(now);             // DecidedAt
      }
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Gap before/after, in whole days, to the nearest APPROVED booking in the
// same house (any investor, any year) — treats the whole request as one
// span from its earliest week's Monday to its latest week's Sunday.
function computeGaps_(houseId, year, weeks) {
  const approved = readBookings_().filter(b => b.houseId === houseId && b.status === 'approved');
  const start = mondayOfISOWeek_(year, weeks[0]);
  const end = new Date(mondayOfISOWeek_(year, weeks[weeks.length - 1]));
  end.setUTCDate(end.getUTCDate() + 6);

  let gapBefore = null, gapAfter = null;
  approved.forEach(b => {
    const bMonday = mondayOfISOWeek_(b.year, b.week);
    const bSunday = new Date(bMonday);
    bSunday.setUTCDate(bMonday.getUTCDate() + 6);
    if (bSunday < start) {
      const diff = Math.round((start - bSunday) / 86400000) - 1;
      if (gapBefore === null || diff < gapBefore) gapBefore = diff;
    }
    if (bMonday > end) {
      const diff = Math.round((bMonday - end) / 86400000) - 1;
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
