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
    var key = PropertiesService.getScriptProperties().getProperty('KEY');
    if (!key || req.key !== key) return json_({ error: 'bad_key' });
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

/* ---------------- player ---------------- */

function player_(a, req) {
  var props = PropertiesService.getScriptProperties();
  if (a === 'pStart') {
    var email = cleanEmail_(req.email);
    if (!email) return { error: 'bad_email' };
    var cache = CacheService.getScriptCache();
    var sent = Number(cache.get('SENT_' + email) || 0);
    if (sent >= 5) return { error: 'too_many' };
    var code = String(Math.floor(100000 + Math.random() * 900000));
    cache.put('OTP_' + email, hash_(code) + '|0', 600);
    cache.put('SENT_' + email, String(sent + 1), 3600);
    MailApp.sendEmail({
      to: email,
      subject: 'Your Lucky Poker sign-in code: ' + code,
      body: 'Your Lucky Poker sign-in code is ' + code + '.\n\nIt works for 10 minutes. If you did not ask for this, you can ignore this email.',
      name: 'Lucky Poker'
    });
    return { ok: true };
  }
  if (a === 'pVerify') {
    var em = cleanEmail_(req.email);
    var c2 = CacheService.getScriptCache();
    var rec = c2.get('OTP_' + em);
    if (!em || !rec) return { error: 'code_expired' };
    var parts = rec.split('|');
    var tries = Number(parts[1] || 0);
    if (tries >= 5) { c2.remove('OTP_' + em); return { error: 'code_expired' }; }
    if (hash_(String(req.code || '').trim()) !== parts[0]) { c2.put('OTP_' + em, parts[0] + '|' + (tries + 1), 600); return { error: 'bad_code' }; }
    c2.remove('OTP_' + em);
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('S_' + token, JSON.stringify({ email: em, exp: Date.now() + SESSION_DAYS * 864e5 }));
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
