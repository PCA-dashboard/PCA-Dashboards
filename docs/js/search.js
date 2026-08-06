/* 物種搜尋：即時過濾，選取後高亮 + 開資訊視窗。
   外觀/動效為指定元件的 vanilla 重現：聚焦展開、漸層流光、gooey 粒子、
   點擊漣漪＋爆散粒子、送出時 icon 擺動、逐項彈入的建議清單。無框架、無 CDN。 */
(function (global) {
  "use strict";
  var Store = global.FrogDash.Store;
  var wrap, form, pill, input, list, particleHost, submitBtn;
  var items = [], active = -1, model = null, blurTimer = null;

  var DOT = '<span class="dot"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/></svg></span>';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function buildIndex(m) {
    model = m;
    items = m.taxaOrder.map(function (sid) {
      var t = m.taxa[sid];
      var label = t[m.displayLabelCol] || sid;
      var hay = [label, sid, t.genus, t.species, t.family, t.clade]
        .filter(Boolean).join(" ").toLowerCase();
      return { sid: sid, label: label, sci: [t.genus, t.species].filter(Boolean).join(" "), hay: hay };
    });
  }

  // ---- 建議清單 ----
  function render(matches) {
    list.innerHTML = "";
    active = -1;
    if (!matches.length) { list.hidden = true; return; }
    matches.slice(0, 50).forEach(function (m, i) {
      var li = document.createElement("li");
      li.dataset.sid = m.sid;
      li.style.setProperty("--i", (i * 35) + "ms");
      li.innerHTML = DOT + "<span>" + esc(m.label) + "</span>" +
        (m.sci && m.sci !== m.label ? " <span class='sci'>" + esc(m.sci) + "</span>" : "");
      li.addEventListener("mousedown", function (e) { e.preventDefault(); choose(m.sid); });
      li.addEventListener("mouseenter", function () { setActive(i); });
      list.appendChild(li);
    });
    list.hidden = false;
  }

  function setActive(i) {
    var lis = list.querySelectorAll("li");
    lis.forEach(function (li, j) { li.classList.toggle("active", j === i); });
    active = i;
  }

  function choose(sid) {
    input.value = "";
    wrap.classList.remove("has-text");
    list.hidden = true;
    Store.setHighlight([sid], "search");
    Store.focus(sid, "search");
  }

  function onInput() {
    var q = input.value.trim().toLowerCase();
    wrap.classList.toggle("has-text", !!input.value);
    if (!q || !model) { list.hidden = true; return; }
    render(items.filter(function (it) { return it.hay.indexOf(q) >= 0; }));
  }

  function onKey(e) {
    if (list.hidden) return;
    var lis = list.querySelectorAll("li");
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(active + 1, lis.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    else if (e.key === "Enter") { /* 交給 form submit */ }
    else if (e.key === "Escape") { list.hidden = true; input.blur(); }
  }

  // ---- 動效：聚焦粒子 / 點擊漣漪爆散 / icon 擺動 ----
  function spawnFocusParticles() {
    if (!particleHost) return;
    particleHost.innerHTML = "";
    for (var i = 0; i < 18; i++) {
      var p = document.createElement("span");
      p.className = "sb-particle";
      p.style.left = (Math.random() * 100) + "%";
      p.style.top = (Math.random() * 100) + "%";
      p.style.setProperty("--tx", ((Math.random() - 0.5) * 40).toFixed(1) + "px");
      p.style.setProperty("--ty", ((Math.random() - 0.5) * 40).toFixed(1) + "px");
      p.style.setProperty("--s", (Math.random() * 0.8 + 0.4).toFixed(2));
      p.style.setProperty("--d", (Math.random() * 1.5 + 1.5).toFixed(2) + "s");
      p.style.animationDelay = (Math.random() * 1.2).toFixed(2) + "s";
      particleHost.appendChild(p);
    }
  }

  function clickBurst(e) {
    if (!pill) return;
    var rect = pill.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    wrap.classList.add("clicked");
    setTimeout(function () { wrap.classList.remove("clicked"); }, 800);

    var ripple = document.createElement("span");
    ripple.className = "sb-ripple";
    pill.appendChild(ripple);
    setTimeout(function () { ripple.remove(); }, 800);

    var BURST = ["#0072B2", "#56B4E9", "#009E73", "#7fd3f0", "#005b8f"];  // dashboard 藍/青綠色盤
    for (var i = 0; i < 14; i++) {
      var d = document.createElement("span");
      d.className = "sb-click";
      d.style.left = x + "px"; d.style.top = y + "px";
      d.style.background = BURST[Math.floor(Math.random() * BURST.length)];
      d.style.setProperty("--tx", ((Math.random() - 0.5) * 160).toFixed(0) + "px");
      d.style.setProperty("--ty", ((Math.random() - 0.5) * 160).toFixed(0) + "px");
      d.style.setProperty("--s", (Math.random() * 0.8 + 0.2).toFixed(2));
      d.style.setProperty("--d", (Math.random() * 0.8 + 0.5).toFixed(2) + "s");
      pill.appendChild(d);
      (function (el) { setTimeout(function () { el.remove(); }, 1400); })(d);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    var lis = list.querySelectorAll("li");
    var sid = (active >= 0 && lis[active]) ? lis[active].dataset.sid : (lis[0] ? lis[0].dataset.sid : null);
    wrap.classList.add("searching");
    setTimeout(function () { wrap.classList.remove("searching"); }, 700);
    if (sid) choose(sid);
  }

  function init() {
    wrap = document.getElementById("search-wrap");
    form = document.getElementById("sb-form");
    pill = document.getElementById("sb-pill");
    input = document.getElementById("search-input");
    list = document.getElementById("search-results");
    particleHost = document.getElementById("sb-particles");
    submitBtn = document.getElementById("sb-submit");

    // 沒有搜尋框的頁面直接跳過；裝飾性外框（pill/粒子/表單）為選配，
    // 缺少時以離線節點承接 class 切換，讓精簡版頁面（如建立精靈）也能用搜尋。
    if (!input || !list) return;
    if (!wrap) wrap = document.createElement("div");
    if (!particleHost) particleHost = document.createElement("span");

    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKey);
    input.addEventListener("focus", function () {
      if (blurTimer) clearTimeout(blurTimer);
      wrap.classList.add("focused");
      spawnFocusParticles();
      if (input.value) onInput();
    });
    input.addEventListener("blur", function () {
      blurTimer = setTimeout(function () {
        wrap.classList.remove("focused");
        particleHost.innerHTML = "";
        list.hidden = true;
      }, 200);
    });
    // 點 pill 任一處 → 聚焦 input + 漣漪/爆散
    if (pill) pill.addEventListener("click", function (e) {
      if (e.target.closest(".sb-submit")) return;   // 送出鈕不觸發爆散
      clickBurst(e);
      input.focus();
    });
    if (form) form.addEventListener("submit", onSubmit);
    else input.addEventListener("keydown", function (e) { if (e.key === "Enter") onSubmit(e); });

    Store.on("data", buildIndex);
  }

  global.FrogDash = global.FrogDash || {};
  global.FrogDash.initSearch = init;
})(window);
