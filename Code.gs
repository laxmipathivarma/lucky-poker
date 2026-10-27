/**
 * Lucky Poker – sync service (Google Apps Script)
 * Stores all games in your Google Drive and keeps one Google Sheet,
 * "Lucky Poker – All games", up to date with a tab per game.
 *
 * Setup: paste this file into a new Apps Script project, run setup() once,
 * then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 */

var FOLDER_NAME = 'Lucky Poker';
var DATA_FILE = 'lucky-poker-data.json';
var SHEET_NAME = 'Lucky Poker – All games';

function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('KEY')) {
    props.setProperty('KEY', Utilities.getUuid().replace(/-/g, ''));
  }
  var folder = getFolder_();
  getDataFile_(folder);
  var ss = getSheet_(folder);
  Logger.log('Sheet: ' + ss.getUrl());
  Logger.log('KEY: ' + props.getProperty('KEY'));
  return props.getProperty('KEY');
}

function doGet() {
  return json_({ ok: true, app: 'Lucky Poker sync' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: 'bad_request' }); }
  var key = PropertiesService.getScriptProperties().getProperty('KEY');
  if (!key || req.key !== key) return json_({ error: 'bad_key' });

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var folder = getFolder_();
    var file = getDataFile_(folder);
    var data = JSON.parse(file.getBlob().getDataAsString() || '{}');
    data.games = data.games || {};
    data.deleted = data.deleted || [];
    data.tabs = data.tabs || {};

    if (req.action === 'save') {
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
    var ss = getSheet_(folder);
    return json_({ ok: true, data: { games: data.games, deleted: data.deleted }, sheetUrl: ss.getUrl() });
  } finally {
    lock.releaseLock();
  }
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
