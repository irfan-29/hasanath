// Pull to refresh, injected by the Hasanath Android app.
//
// Like the browser's: at the very top of the page, drag down and let go to
// reload. It only starts when the whole page is scrolled to the top and the
// finger is not inside something that scrolls on its own (a menu, a picker,
// a sheet) or inside an open dialog, so it never fights the page's own
// gestures. The spinner uses the user's accent colour.
(function () {
  if (window.__hsPull) return;
  window.__hsPull = 1;

  var THRESHOLD = 72;      // px of indicator travel needed to refresh
  var MAX = 110;           // indicator never travels further than this
  var RESIST = 0.5;        // finger moves 2px for every 1px of travel

  var css = document.createElement('style');
  css.textContent =
    '#hs-pull{position:fixed;left:50%;top:0;z-index:2147483000;width:40px;height:40px;margin-left:-20px;' +
    'border-radius:50%;background:var(--surface-1,#fff);box-shadow:0 2px 10px rgba(0,0,0,.22);' +
    'display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:0;' +
    'transform:translateY(-48px);will-change:transform,opacity}' +
    '#hs-pull svg{width:22px;height:22px;display:block}' +
    '#hs-pull.hs-snap{transition:transform .22s ease,opacity .22s ease}' +
    '#hs-pull.hs-spin svg{animation:hs-spin .8s linear infinite}' +
    '@keyframes hs-spin{to{transform:rotate(360deg)}}' +
    '[data-theme="dark"] #hs-pull{background:#1f2933}';
  document.head.appendChild(css);

  var el = document.createElement('div');
  el.id = 'hs-pull';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round">' +
    '<path id="hs-pull-arc" d="M20 12a8 8 0 1 1-2.34-5.66" stroke="var(--accent-fill-1,#0d9488)"/>' +
    '<path d="M20 4v5h-5" stroke="var(--accent-fill-1,#0d9488)"/></svg>';
  document.body.appendChild(el);
  var svg = el.firstChild;

  var startY = 0, startX = 0, pulling = false, armed = false, travel = 0, busy = false;

  function pageTop() {
    var s = document.scrollingElement || document.documentElement;
    return (s.scrollTop || window.scrollY || 0) <= 0;
  }

  // True if the finger is in something that scrolls by itself and is not at
  // its own top, or inside a dialog / overlay, where a pull means something else.
  function blocked(node) {
    for (var n = node; n && n !== document.body && n.nodeType === 1; n = n.parentElement) {
      if (n.getAttribute('role') === 'dialog' || n.getAttribute('aria-modal') === 'true') return true;
      var st = getComputedStyle(n);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 1) {
        if (n.scrollTop > 0) return true;
        // A scroll container that is its own little page (dropdown, sheet).
        if (st.position === 'fixed' || st.position === 'absolute') return true;
      }
    }
    return false;
  }

  function headerOffset() {
    // Sit just below the app's fixed phone header, if there is one.
    var top = document.elementFromPoint(window.innerWidth / 2, 2);
    for (var n = top; n && n !== document.body; n = n.parentElement) {
      var st = getComputedStyle(n);
      if (st.position === 'fixed' || st.position === 'sticky') return n.getBoundingClientRect().bottom;
    }
    return 0;
  }

  function show(px) {
    var p = Math.min(1, px / THRESHOLD);
    el.style.opacity = String(Math.min(1, p * 1.4));
    el.style.transform = 'translateY(' + (baseTop + px - 48) + 'px) rotate(' + (p * 270) + 'deg)';
    svg.style.opacity = p >= 1 ? '1' : '0.55';
  }

  var baseTop = 0;

  document.addEventListener('touchstart', function (e) {
    if (busy || e.touches.length !== 1) return;
    pulling = false; armed = false; travel = 0;
    if (!pageTop() || blocked(e.target)) return;
    armed = true;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!armed || busy) return;
    var dy = e.touches[0].clientY - startY;
    var dx = e.touches[0].clientX - startX;
    if (!pulling) {
      // Decide once: a downward, mostly-vertical drag at the top is a pull.
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      if (dy <= 0 || Math.abs(dx) > dy || !pageTop()) { armed = false; return; }
      pulling = true;
      baseTop = headerOffset();
      el.classList.remove('hs-snap', 'hs-spin');
    }
    travel = Math.min(MAX, Math.max(0, dy * RESIST));
    show(travel);
    if (e.cancelable) e.preventDefault();   // keep the page still while pulling
  }, { passive: false });

  function end() {
    if (!pulling) { armed = false; return; }
    pulling = false; armed = false;
    el.classList.add('hs-snap');
    if (travel >= THRESHOLD) {
      busy = true;
      el.classList.add('hs-spin');
      el.style.transform = 'translateY(' + (baseTop + THRESHOLD - 48) + 'px)';
      el.style.opacity = '1';
      svg.style.opacity = '1';
      try { if (navigator.vibrate) navigator.vibrate(8); } catch (err) { /* optional */ }
      setTimeout(function () { location.reload(); }, 120);
    } else {
      el.style.transform = 'translateY(-48px)';
      el.style.opacity = '0';
    }
    travel = 0;
  }
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
})();
