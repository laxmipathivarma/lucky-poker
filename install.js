/* NamMane: "Add to Home Screen" helper for Android (one-tap install) and iPhone/iPad (step-by-step sheet). */
(function () {
  var deferred = null;
  var ua = navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var isAndroid = /android/i.test(ua);
  var isSafari = isIOS && !/crios|fxios|edgios|opios|gsa\//i.test(ua);
  var iosBrowser = /crios/i.test(ua) ? 'Chrome' : /fxios/i.test(ua) ? 'Firefox' : /edgios/i.test(ua) ? 'Edge' : /gsa\//i.test(ua) ? 'Google' : 'Safari';
  var inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\//i.test(ua);
  var isMobile = isIOS || isAndroid || /mobile/i.test(ua);
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
    o.innerHTML = '<div class="lpi-sh" role="dialog" aria-modal="true" aria-label="Add NamMane to your Home Screen">' + html + '<button type="button" class="lpi-close">Got it</button></div>';
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
      var head = '<h3>Add to Home Screen</h3><p>NamMane installs like an app with its own icon. It takes 3 taps:</p>';
      if (inApp) {
        sheet('<h3>Open in Safari first</h3><p>You opened this link inside another app. To install NamMane:</p><ol><li><b class="n">1</b><span>Tap <b>&#8942;</b> or <b>&#8230;</b> (top right) and choose <b>Open in Safari</b>.</span></li><li><b class="n">2</b><span>In Safari, tap Share ' + share + ' then <b>Add to Home Screen</b> ' + plus + '</span></li><li><b class="n">3</b><span>Tap <b>Add</b>.</span></li></ol>');
        return;
      }
      if (isSafari) {
        sheet(head + '<ol><li><b class="n">1</b><span>Tap the Share button ' + share + ' at the bottom of Safari (on iPad: top right). On newer iPhones you may need to tap <b>&#8230;</b> first.</span></li>' +
          '<li><b class="n">2</b><span>Scroll down and tap <b>Add to Home Screen</b> ' + plus + '</span></li>' +
          '<li><b class="n">3</b><span>Tap <b>Add</b>. NamMane appears on your Home Screen.</span></li></ol>');
        return;
      }
      sheet(head + '<ol><li><b class="n">1</b><span>In ' + iosBrowser + ', tap the Share button ' + share + ' in the address bar (or <b>&#8943;</b> menu &rarr; <b>Share</b>).</span></li>' +
        '<li><b class="n">2</b><span>Tap <b>Add to Home Screen</b> ' + plus + '. If you don\'t see it, scroll the list or open this page in Safari.</span></li>' +
        '<li><b class="n">3</b><span>Tap <b>Add</b>. NamMane appears on your Home Screen.</span></li></ol>');
      return;
    }
    sheet('<h3>Install NamMane</h3><p>Add it to your ' + (isAndroid ? 'phone' : 'device') + ' like an app:</p>' +
      '<ol><li><b class="n">1</b><span>Open your browser menu ' + dots + ' (top right in Chrome).</span></li>' +
      '<li><b class="n">2</b><span>Tap <b>Install app</b> or <b>Add to Home screen</b>.</span></li>' +
      '<li><b class="n">3</b><span>Tap <b>Install</b>. NamMane appears with your other apps.</span></li></ol>');
  }
  var bcss = '.lpb{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:90;max-width:460px;margin:0 auto;display:flex;align-items:center;gap:12px;background:#fbf7ec;color:#1c1813;border:1px solid #d4a73a;border-radius:18px;padding:10px 10px 10px 12px;box-shadow:0 14px 40px rgb(0 0 0 / .45);font:14px/1.35 "IBM Plex Sans",system-ui,-apple-system,sans-serif;animation:lpbIn .35s ease-out}' +
    '.lpb img{width:46px;height:46px;border-radius:11px;flex-shrink:0}.lpb div{flex:1;min-width:0}.lpb b{display:block;font-size:15px}.lpb span{color:#6a5e47;font-size:13px}' +
    '.lpb .go{border:0;border-radius:12px;min-height:44px;padding:0 16px;background:linear-gradient(#d8412f,#b8281d 55%,#8f1a13);color:#fff8ea;font:700 16px "Big Shoulders Display","Arial Narrow",sans-serif;letter-spacing:.05em;cursor:pointer;white-space:nowrap}' +
    '.lpb .x{border:0;background:none;width:32px;height:44px;font-size:22px;color:#6a5e47;cursor:pointer;flex-shrink:0}' +
    'body.has-tabbar .lpb{bottom:calc(84px + env(safe-area-inset-bottom,0px))}@keyframes lpbIn{from{transform:translateY(20px);opacity:0}}@media (prefers-reduced-motion:reduce){.lpb{animation:none}}';
  function banner() {
    if (standalone() || !isMobile || document.querySelector('.lpb')) return;
    try { var until = Number(localStorage.getItem('lp.bannerHide') || 0); if (until > Date.now()) return; } catch (e) {}
    if (!document.getElementById('lpb-css')) { var st = document.createElement('style'); st.id = 'lpb-css'; st.textContent = bcss; document.head.appendChild(st); }
    if (window.matchMedia && window.matchMedia('(max-width:760px)').matches && document.querySelector('nav.tabs,.tabbar')) document.body.classList.add('has-tabbar');
    var b = document.createElement('div');
    b.className = 'lpb';
    b.setAttribute('role', 'region');
    b.setAttribute('aria-label', 'Install NamMane');
    b.innerHTML = '<img src="icon-192.png" alt=""><div><b>Install NamMane</b><span>Add it to your Home Screen as an app</span></div><button type="button" class="go">Add</button><button type="button" class="x" aria-label="Not now">&times;</button>';
    b.querySelector('.go').onclick = function () { open(); };
    b.querySelector('.x').onclick = function () { b.remove(); try { localStorage.setItem('lp.bannerHide', String(Date.now() + 3 * 864e5)); } catch (e) {} };
    document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(banner, 1200); });
  else setTimeout(banner, 1200);
  window.LPInstall = {
    open: open,
    standalone: standalone,
    canPrompt: function () { return !!deferred; },
    banner: banner,
    isIOS: isIOS
  };
})();
