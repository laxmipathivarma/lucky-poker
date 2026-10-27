/**
 * Lucky Poker – sync service and player sign-in (Google Apps Script, free)
 *
 * Admin app: saves all games here and keeps one Google Sheet,
 *   "Lucky Poker – All games", up to date with a tab per game.
 * Player app: players sign in with a one-time code sent to their email,
 *   add their phone number, and once you approve them they see only
 *   their own games, tables, upcoming invites and track record.
 *
 * Setup: paste into a new Apps Script project, run setup() once,
 * then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 */

var FOLDER_NAME = 'Lucky Poker';
var DATA_FILE = 'lucky-poker-data.json';
var SHEET_NAME = 'Lucky Poker – All games';
var SESSION_DAYS = 60;

function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('KEY')) props.setProperty('KEY', Utilities.getUuid().replace(/-/g, ''));
  var folder = getFolder_();
  getDataFile_(folder);
  var ss = getSheet_(folder);
  MailApp.getRemainingDailyQuota();
  Logger.log('Sheet: ' + ss.getUrl());
  Logger.log('KEY: ' + props.getProperty('KEY'));
  return props.getProperty('KEY');
}

function doGet() {
  return json_({ ok: true, app: 'Lucky Poker' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: 'bad_request' }); }
  var a = String(req.action || '');
  try {
    if (a.indexOf('p') === 0) return json_(player_(a, req));
    if (a === 'adminLogin') return json_(adminLogin_(req));
    var key = PropertiesService.getScriptProperties().getProperty('KEY');
    if (!key || req.key !== key) return json_({ error: 'bad_key' });
    if (a === 'setAdmin') return json_(setAdmin_(req));
    return json_(admin_(a, req));
  } catch (err) {
    return json_({ error: 'server', message: String(err && err.message || err) });
  }
}

/* ---------------- admin ---------------- */

function admin_(a, req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var folder = getFolder_();
    var file = getDataFile_(folder);
    var data = readData_(file);

    if (a === 'save') {
      (req.deleted || []).forEach(function (id) {
        if (data.deleted.indexOf(id) < 0) data.deleted.push(id);
        delete data.games[id];
      });
      var games = req.games || {};
      Object.keys(games).forEach(function (id) {
        if (data.deleted.indexOf(id) >= 0) return;
        var cur = data.games[id];
        if (!cur || (games[id].updatedAt || 0) >= (cur.updatedAt || 0)) data.games[id] = games[id];
      });
      file.setContent(JSON.stringify(data));
      if (req.sheets && req.sheets.tabs) writeSheets_(folder, data, req.sheets.tabs);
      file.setContent(JSON.stringify(data));
    }
    if (a === 'approve') {
      var pr = data.profiles[String(req.email || '').toLowerCase()];
      if (pr) { pr.status = req.ok ? 'approved' : 'rejected'; pr.reviewedAt = Date.now(); }
      file.setContent(JSON.stringify(data));
    }
    var ss = getSheet_(folder);
    return {
      ok: true,
      data: { games: data.games, deleted: data.deleted },
      profiles: profileList_(data),
      sheetUrl: ss.getUrl()
    };
  } finally {
    lock.releaseLock();
  }
}

function profileList_(data) {
  return Object.keys(data.profiles).map(function (em) {
    var p = data.profiles[em];
    return { email: em, name: p.name || '', phone: p.phone || '', status: p.status, at: p.at || 0, matched: !!findPlayerName_(data, p.phone) };
  });
}

/* ---------------- admin sign-in ---------------- */

function adminLogin_(req) {
  var props = PropertiesService.getScriptProperties();
  var user = props.getProperty('ADMIN_USER'), hash = props.getProperty('ADMIN_HASH');
  if (!user || !hash) return { error: 'not_set' };
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('AFAIL') || 0);
  if (fails >= 8) return { error: 'too_many' };
  if (String(req.user || '').trim() !== user || hash_('admin:' + String(req.pass || '')) !== hash) {
    cache.put('AFAIL', String(fails + 1), 900);
    return { error: 'bad_login' };
  }
  cache.remove('AFAIL');
  return { ok: true, key: props.getProperty('KEY') };
}

function setAdmin_(req) {
  var user = String(req.user || '').trim(), pass = String(req.pass || '');
  if (!user || pass.length < 8) return { error: 'bad_request' };
  var props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_USER', user);
  props.setProperty('ADMIN_HASH', hash_('admin:' + pass));
  return { ok: true };
}

/* ---------------- player ---------------- */

function player_(a, req) {
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();

  /* Send a 4-digit code: purpose 'signup' (new account) or 'reset' (forgot password). */
  if (a === 'pStart') {
    var email = cleanEmail_(req.email);
    var purpose = req.purpose === 'reset' ? 'reset' : 'signup';
    if (!email) return { error: 'bad_email' };
    var exists = !!props.getProperty('A_' + email);
    if (purpose === 'signup' && exists) return { error: 'exists' };
    if (purpose === 'reset' && !exists) return { error: 'no_account' };
    var sent = Number(cache.get('SENT_' + email) || 0);
    if (sent >= 5) return { error: 'too_many' };
    var code = String(Math.floor(1000 + Math.random() * 9000));
    cache.put('OTP_' + purpose + '_' + email, hash_(code) + '|0', 600);
    cache.put('SENT_' + email, String(sent + 1), 3600);
    sendCode_(email, code, purpose);
    return { ok: true };
  }

  /* Check the code; returns a short-lived token that allows setting a password once. */
  if (a === 'pVerify') {
    var em = cleanEmail_(req.email);
    var pur = req.purpose === 'reset' ? 'reset' : 'signup';
    var ck = 'OTP_' + pur + '_' + em;
    var rec = cache.get(ck);
    if (!em || !rec) return { error: 'code_expired' };
    var parts = rec.split('|');
    var tries = Number(parts[1] || 0);
    if (tries >= 5) { cache.remove(ck); return { error: 'code_expired' }; }
    if (hash_(String(req.code || '').trim()) !== parts[0]) { cache.put(ck, parts[0] + '|' + (tries + 1), 600); return { error: 'bad_code' }; }
    cache.remove(ck);
    var setup = Utilities.getUuid().replace(/-/g, '');
    cache.put('SETUP_' + setup, JSON.stringify({ email: em, purpose: pur }), 900);
    return { ok: true, setup: setup };
  }

  /* Create or reset the password using the token from pVerify. */
  if (a === 'pSetPassword') {
    var raw = cache.get('SETUP_' + String(req.setup || ''));
    if (!raw) return { error: 'code_expired' };
    var su = JSON.parse(raw);
    var pw = String(req.password || '');
    if (pw.length < 8) return { error: 'weak_password' };
    var salt = Utilities.getUuid();
    props.setProperty('A_' + su.email, JSON.stringify({ salt: salt, hash: pwHash_(pw, salt), at: Date.now() }));
    cache.remove('SETUP_' + req.setup);
    if (su.purpose === 'reset') endSessions_(su.email);
    return { ok: true, email: su.email };
  }

  /* Email + password sign-in. */
  if (a === 'pLogin') {
    var le = cleanEmail_(req.email);
    if (!le) return { error: 'bad_login' };
    var fails = Number(cache.get('LFAIL_' + le) || 0);
    if (fails >= 8) return { error: 'too_many' };
    var acc = props.getProperty('A_' + le);
    if (!acc) { cache.put('LFAIL_' + le, String(fails + 1), 900); return { error: 'bad_login' }; }
    acc = JSON.parse(acc);
    if (pwHash_(String(req.password || ''), acc.salt) !== acc.hash) { cache.put('LFAIL_' + le, String(fails + 1), 900); return { error: 'bad_login' }; }
    cache.remove('LFAIL_' + le);
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('S_' + token, JSON.stringify({ email: le, exp: Date.now() + SESSION_DAYS * 864e5 }));
    return { ok: true, token: token };
  }

  var sess = session_(req.token);
  if (!sess) return { error: 'signed_out' };

  if (a === 'pSignOut') { props.deleteProperty('S_' + req.token); return { ok: true }; }

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var file = getDataFile_(getFolder_());
    var data = readData_(file);
    var prof = data.profiles[sess.email] || null;

    if (a === 'pProfile') {
      var phone = normPhone_(req.phone);
      if (!phone) return { error: 'bad_phone' };
      var name = String(req.name || '').slice(0, 60);
      if (!prof || prof.phone !== phone) {
        prof = { name: name, phone: phone, status: 'pending', at: Date.now() };
      } else {
        prof.name = name;
      }
      data.profiles[sess.email] = prof;
      file.setContent(JSON.stringify(data));
    }
    return { ok: true, me: myView_(data, sess.email, prof) };
  } finally {
    lock.releaseLock();
  }
}

/* Build the signed-in player's own view. Never includes other players' names, phones or results. */
function myView_(data, email, prof) {
  var out = { email: email, profile: prof ? { name: prof.name, phone: prof.phone, status: prof.status } : null, games: [], upcoming: [], stats: null };
  if (!prof || prof.status !== 'approved') return out;
  var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  var ids = Object.keys(data.games);
  var tot = { played: 0, net: 0, wins: 0, losses: 0, best: null, worst: null };
  ids.forEach(function (id) {
    var g = data.games[id];
    if (!g || g.sample) return;
    var me = (g.players || []).filter(function (p) { return normPhone_(p.phone) === prof.phone; })[0];
    if (!me) return;
    var tables = g.tables || [];
    var t = tables.filter(function (x) { return x.id === me.table; })[0] || tables[0] || { name: 'Table 1' };
    var b = (me.buyins || []).reduce(function (s, x) { return s + Number(x.amt || 0); }, 0);
    var share = shareOf_(g);
    var paid = (g.expenses || []).filter(function (e) { return e.by === me.id; }).reduce(function (s, e) { return s + Number(e.amt || 0); }, 0);
    var row = {
      date: g.date, time: g.time || '', name: g.name, venue: g.venue || '', address: g.address || '',
      maps: g.mapsUrl || '', gatePass: g.gatePass || '', notes: g.notes || '', table: t.name, cur: g.cur || '₹'
    };
    if (g.date > today && me.out == null) {
      out.upcoming.push(row);
      return;
    }
    row.buyIns = me.buyins ? me.buyins.length : 0;
    row.boughtIn = b;
    row.cashOut = me.out == null ? null : Number(me.out);
    row.result = me.out == null ? null : Number(me.out) - b;
    row.expenseShare = Math.round(share * 100) / 100;
    row.net = me.out == null ? null : Math.round((Number(me.out) - b - share) * 100) / 100;
    row.finished = !!g.finished;
    var mine = ((g.settle && g.settle.list) || []).filter(function (x) { return x.from === me.id || x.to === me.id; });
    row.settle = mine.map(function (x) { return { pay: x.from === me.id, amt: x.amt, done: !!x.done }; });
    if (me.out == null) row.status = 'Playing';
    out.games.push(row);
    if (row.net != null) {
      tot.played++; tot.net += row.net;
      if (row.net > 0) tot.wins++; else if (row.net < 0) tot.losses++;
      if (tot.best == null || row.net > tot.best) tot.best = row.net;
      if (tot.worst == null || row.net < tot.worst) tot.worst = row.net;
    }
  });
  out.games.sort(function (x, y) { return x.date < y.date ? 1 : -1; });
  out.upcoming.sort(function (x, y) { return x.date > y.date ? 1 : -1; });
  tot.net = Math.round(tot.net * 100) / 100;
  out.stats = tot;
  return out;
}

function shareOf_(g) {
  var n = (g.players || []).length;
  if (!n) return 0;
  var shared = (g.expenses || []).filter(function (e) { return e.split === 'players'; }).reduce(function (s, e) { return s + Number(e.amt || 0); }, 0);
  return shared / n;
}

function findPlayerName_(data, phone) {
  if (!phone) return '';
  var ids = Object.keys(data.games);
  for (var i = 0; i < ids.length; i++) {
    var g = data.games[ids[i]];
    var p = (g.players || []).filter(function (x) { return normPhone_(x.phone) === phone; })[0];
    if (p) return p.name;
  }
  return '';
}

function pwHash_(pw, salt) {
  var h = salt + ':' + pw;
  for (var i = 0; i < 300; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
  }
  return h;
}

function endSessions_(email) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('S_') !== 0) return;
    try { if (JSON.parse(all[k]).email === email) props.deleteProperty(k); } catch (e) {}
  });
}

function sendCode_(email, code, purpose) {
  var title = purpose === 'reset' ? 'Reset your password' : 'Verify your email';
  var line = purpose === 'reset'
    ? 'Use this code in Lucky Poker to set a new password.'
    : 'Use this code in Lucky Poker to finish creating your account.';
  var digits = code.split('').map(function (d) {
    return '<td style="padding:0 5px"><div style="width:52px;height:64px;line-height:64px;border-radius:12px;background:#fbf7ec;border:2px solid #d4a73a;font:800 34px Arial,sans-serif;color:#1c1813;text-align:center">' + d + '</div></td>';
  }).join('');
  var html =
    '<div style="margin:0;padding:24px 12px;background:#0b3324">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;border-collapse:collapse">' +
    '<tr><td style="padding:20px 24px;background:#0c3d2a;border-radius:16px 16px 0 0;border-bottom:2px solid #d4a73a;text-align:center">' +
    '<div style="display:inline-block;padding:8px 22px;background:#b8281d;border-radius:6px;font:800 22px Arial Narrow,Arial,sans-serif;letter-spacing:3px;color:#fbeed2">&#9824; LUCKY POKER</div>' +
    '<div style="margin-top:8px;font:700 12px Arial,sans-serif;letter-spacing:4px;color:#f6d67a;text-transform:uppercase">Game night at home</div></td></tr>' +
    '<tr><td style="padding:28px 24px;background:#fbf7ec;border-radius:0 0 16px 16px;text-align:center">' +
    '<div style="font:800 24px Arial,sans-serif;color:#1c1813">' + title + '</div>' +
    '<p style="margin:10px 0 22px;font:15px/1.5 Arial,sans-serif;color:#6a5e47">' + line + '</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>' + digits + '</tr></table>' +
    '<p style="margin:22px 0 0;font:13px/1.5 Arial,sans-serif;color:#6a5e47">The code works for 10 minutes. If you did not ask for it, you can ignore this email.</p>' +
    '</td></tr>' +
    '<tr><td style="padding:14px;text-align:center;font:12px Arial,sans-serif;color:#a8b6a6">Lucky Poker &middot; poker.nammane.in</td></tr>' +
    '</table></div>';
  MailApp.sendEmail({
    to: email,
    subject: code + ' is your Lucky Poker code',
    body: title + '\n\nYour Lucky Poker code is ' + code + '.\n' + line + '\nIt works for 10 minutes.',
    htmlBody: html,
    name: 'Lucky Poker'
  });
}

function session_(token) {
  if (!token) return null;
  var raw = PropertiesService.getScriptProperties().getProperty('S_' + token);
  if (!raw) return null;
  var s = JSON.parse(raw);
  if (s.exp < Date.now()) { PropertiesService.getScriptProperties().deleteProperty('S_' + token); return null; }
  return s;
}

function normPhone_(ph) {
  var d = String(ph || '').replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return d.length >= 11 ? d : '';
}

function cleanEmail_(e) {
  e = String(e || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}

function hash_(s) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s + PropertiesService.getScriptProperties().getProperty('KEY'));
  return Utilities.base64Encode(b);
}

/* ---------------- storage + sheet ---------------- */

function readData_(file) {
  var data = JSON.parse(file.getBlob().getDataAsString() || '{}');
  data.games = data.games || {};
  data.deleted = data.deleted || [];
  data.tabs = data.tabs || {};
  data.profiles = data.profiles || {};
  return data;
}

function writeSheets_(folder, data, tabs) {
  var ss = getSheet_(folder);
  var keep = {};
  tabs.forEach(function (t, i) {
    var sh = null;
    var sid = data.tabs[t.key];
    if (sid != null) sh = ss.getSheets().filter(function (s) { return s.getSheetId() === sid; })[0] || null;
    var name = uniqueName_(ss, t.name, sh);
    if (!sh) { sh = ss.insertSheet(name); data.tabs[t.key] = sh.getSheetId(); }
    else if (sh.getName() !== name) sh.setName(name);
    keep[sh.getSheetId()] = true;
    var rows = t.rows || [];
    var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
    var grid = rows.map(function (r) {
      var out = r.slice();
      while (out.length < width) out.push('');
      return out;
    });
    sh.clear();
    if (grid.length) {
      sh.getRange(1, 1, grid.length, width).setValues(grid);
      if (t.header) sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#f3ecda');
      grid.forEach(function (r, ix) {
        if (r[0] && r.slice(1).join('') === '' && /^[A-Z][A-Z \-&]+$/.test(String(r[0]))) {
          sh.getRange(ix + 1, 1).setFontWeight('bold').setFontColor('#b8281d');
        }
      });
      sh.setFrozenRows(t.header ? 1 : 0);
      try { sh.autoResizeColumns(1, width); } catch (e) {}
    }
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  Object.keys(data.tabs).forEach(function (k) {
    var sid = data.tabs[k];
    if (keep[sid]) return;
    var sh = ss.getSheets().filter(function (s) { return s.getSheetId() === sid; })[0];
    if (sh && ss.getSheets().length > 1) ss.deleteSheet(sh);
    delete data.tabs[k];
  });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
}

function uniqueName_(ss, base, self) {
  base = String(base || 'Game').replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 90);
  var name = base, i = 2;
  while (true) {
    var other = ss.getSheetByName(name);
    if (!other || (self && other.getSheetId() === self.getSheetId())) return name;
    name = base + ' ' + (i++);
  }
}

function getFolder_() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function getDataFile_(folder) {
  var it = folder.getFilesByName(DATA_FILE);
  return it.hasNext() ? it.next() : folder.createFile(DATA_FILE, '{}', MimeType.PLAIN_TEXT);
}

function getSheet_(folder) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var ss = SpreadsheetApp.create(SHEET_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
