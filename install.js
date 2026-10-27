/* Lucky Poker: "Add to Home Screen" helper for Android (one-tap install) and iPhone/iPad (step-by-step sheet). */
(function () {
  var deferred = null;
  var ua = navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var isAndroid = /android/i.test(ua);
  var isSafari = isIOS && !/crios|fxios|edgios/i.test(ua);
  function standalone() {
    try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch (e) { return false; }
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    document.dispatchEvent(new Event('lp-install-ready'));
  });
  window.addEventListener('appinstalled', function () {
    deferred = null;
    try { localStorage.setItem('lp.installed', '1'); } catch (e) {}
    close();
    document.dispatchEvent(new Event('lp-install-ready'));
  });

  var css = '.lpi-ov{position:fixed;inset:0;z-index:100;background:rgb(4 20 13 / .72);display:flex;align-items:flex-end;justify-content:center;padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom,0px))}' +
    '.lpi-sh{width:100%;max-width:440px;background:#fbf7ec;color:#1c1813;border-radius:22px;padding:22px;box-shadow:0 20px 50px rgb(0 0 0 / .5);font:15px/1.45 "IBM Plex Sans",system-ui,-apple-system,sans-serif;border:1px solid #e2d6b8}' +
    '.lpi-sh h3{margin:0 0 4px;font:800 24px "Big Shoulders Display","Arial Narrow",sans-serif;letter-spacing:.03em}' +
    '.lpi-sh p{margin:0 0 14px;color:#6a5e47}' +
    '.lpi-sh ol{margin:0 0 16px;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}' +
    '.lpi-sh li{display:flex;gap:12px;align-items:center;background:#f3ecda;border-radius:12px;padding:10px 12px}' +
    '.lpi-sh li b.n{flex-shrink:0;width:28px;height:28px;border-radius:50%;background:#b8281d;color:#fff8ea;display:grid;place-items:center;font-size:14px}' +
    '.lpi-sh .ico{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:7px;background:#fff;border:1px solid #e2d6b8;vertical-align:middle;margin:0 2px}' +
    '.lpi-sh button{width:100%;min-height:48px;border-radius:12px;border:0;background:linear-gradient(#d8412f,#b8281d 55%,#8f1a13);color:#fff8ea;font:700 17px "Big Shoulders Display","Arial Narrow",sans-serif;letter-spacing:.06em;cursor:pointer}';
  function close() { var o = document.querySelector('.lpi-ov'); if (o) o.remove(); }
  var share = '<span class="ico" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg></span>';
  var plus = '<span class="ico" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1c1813" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg></span>';
  var dots = '<span class="ico" aria-hidden="true">&#8942;</span>';
  function sheet(html) {
    close();
    if (!document.getElementById('lpi-css')) { var s = document.createElement('style'); s.id = 'lpi-css'; s.textContent = css; document.head.appendChild(s); }
    var o = document.createElement('div');
    o.className = 'lpi-ov';
    o.innerHTML = '<div class="lpi-sh" role="dialog" aria-modal="true" aria-label="Add Lucky Poker to your Home Screen">' + html + '<button type="button" class="lpi-close">Got it</button></div>';
    o.addEventListener('click', function (e) { if (e.target === o || e.target.classList.contains('lpi-close')) close(); });
    document.body.appendChild(o);
  }
  function open() {
    if (deferred) {
      deferred.prompt();
      deferred.userChoice.finally(function () { deferred = null; document.dispatchEvent(new Event('lp-install-ready')); });
      return;
    }
    if (isIOS) {
      sheet('<h3>Add to Home Screen</h3><p>Lucky Poker installs like an app, with its own icon. ' + (isSafari ? '' : '<b>Open this page in Safari first.</b> ') + 'It takes 3 taps:</p>' +
        '<ol><li><b class="n">1</b><span>Tap the Share button ' + share + ' in Safari\'s toolbar.</span></li>' +
        '<li><b class="n">2</b><span>Scroll down and tap <b>Add to Home Screen</b> ' + plus + '</span></li>' +
        '<li><b class="n">3</b><span>Tap <b>Add</b>. Lucky Poker appears on your Home Screen.</span></li></ol>');
      return;
    }
    sheet('<h3>Install Lucky Poker</h3><p>Add it to your ' + (isAndroid ? 'phone' : 'device') + ' like an app:</p>' +
      '<ol><li><b class="n">1</b><span>Open your browser menu ' + dots + ' (top right in Chrome).</span></li>' +
      '<li><b class="n">2</b><span>Tap <b>Install app</b> or <b>Add to Home screen</b>.</span></li>' +
      '<li><b class="n">3</b><span>Tap <b>Install</b>. Lucky Poker appears with your other apps.</span></li></ol>');
  }
  window.LPInstall = {
    open: open,
    standalone: standalone,
    canPrompt: function () { return !!deferred; },
    isIOS: isIOS
  };
})();
