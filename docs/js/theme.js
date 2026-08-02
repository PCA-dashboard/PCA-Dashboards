/* 主題控制：深/淺主題（可跟隨系統）＋ accent 主視覺色，localStorage 記憶。
   切換時重繪 Plotly 與親緣樹以套用新色。純 vanilla、無外部依賴。 */
(function (global) {
  "use strict";
  var FD = global.FrogDash = global.FrogDash || {};
  var root = document.documentElement;
  var mql = null;
  try { mql = global.matchMedia("(prefers-color-scheme: dark)"); } catch (e) { mql = null; }

  function ls(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var pref = ls("mp-themepref", "auto");                 // auto | dark | light
  if (["auto", "dark", "light"].indexOf(pref) < 0) pref = "auto";
  var accent = ls("mp-accent", "lime");
  if (["lime", "cyan", "violet", "amber", "coral"].indexOf(accent) < 0) accent = "lime";

  function effective() { return pref === "auto" ? (mql && mql.matches ? "dark" : "light") : pref; }

  function apply() {
    root.setAttribute("data-theme", effective());
    root.setAttribute("data-accent", accent);
    syncUI();
  }
  function retheme() {
    if (FD.redrawPCA) try { FD.redrawPCA(); } catch (e) {}
    if (FD.TreeView && FD.TreeView.tree) try { FD.TreeView.build(); } catch (e) {}
  }
  function setPref(p) { pref = p; save("mp-themepref", p); apply(); retheme(); }
  function setAccent(a) { accent = a; save("mp-accent", a); apply(); retheme(); }

  function syncUI() {
    var st = document.getElementById("set-theme");
    if (st) st.querySelectorAll("[data-themepref]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-themepref") === pref);
    });
    var sa = document.getElementById("set-accent");
    if (sa) sa.querySelectorAll("[data-accent]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-accent") === accent);
    });
    syncLangUI();
  }
  function syncLangUI() {
    var sl = document.getElementById("set-lang");
    var cur = (FD.i18n && FD.i18n.lang) || "zh";
    if (sl) sl.querySelectorAll("[data-lang]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-lang") === cur);
    });
  }
  FD.syncLangUI = syncLangUI;

  if (mql) {
    var onScheme = function () { if (pref === "auto") { apply(); retheme(); } };
    try { mql.addEventListener("change", onScheme); } catch (e) { try { mql.addListener(onScheme); } catch (e2) {} }
  }

  function wire() {
    apply();
    var menu = document.getElementById("settings-menu");
    var tile = document.getElementById("settings-tile");
    if (tile && menu) {
      tile.addEventListener("click", function (e) {
        e.stopPropagation();
        var willOpen = menu.hidden; menu.hidden = !willOpen; tile.classList.toggle("active", willOpen);
      });
      document.addEventListener("click", function (e) {
        if (!menu.hidden && !menu.contains(e.target) && !tile.contains(e.target)) {
          menu.hidden = true; tile.classList.remove("active");
        }
      });
    }
    var st = document.getElementById("set-theme");
    if (st) st.addEventListener("click", function (e) {
      var b = e.target.closest("[data-themepref]"); if (b) setPref(b.getAttribute("data-themepref"));
    });
    var sa = document.getElementById("set-accent");
    if (sa) sa.addEventListener("click", function (e) {
      var b = e.target.closest("[data-accent]"); if (b) setAccent(b.getAttribute("data-accent"));
    });
    var sl = document.getElementById("set-lang");
    if (sl) sl.addEventListener("click", function (e) {
      var b = e.target.closest("[data-lang]"); if (b && FD.i18n) FD.i18n.setLang(b.getAttribute("data-lang"));
    });

    // 手機漢堡：展開/收合頂部列
    var burger = document.getElementById("menu-toggle");
    var topbar = document.querySelector(".topbar");
    if (burger && topbar) burger.addEventListener("click", function () {
      var open = topbar.classList.toggle("nav-open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });

    // 分頁膠囊：概覽 / 分析 / 載入資料 / 建立精靈
    var nav = document.getElementById("nav-pills");
    if (nav) nav.addEventListener("click", function (e) {
      var b = e.target.closest("[data-screen]"); if (!b) return;
      var s = b.getAttribute("data-screen");
      if (s === "welcome") { var zi = document.getElementById("zip-input"); if (zi) zi.click(); return; }
      nav.querySelectorAll(".nav-pill").forEach(function (p) { p.classList.toggle("active", p === b); });
      if (s === "analytics") { var el = document.getElementById("pca-row"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }
      else global.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  apply();  // 盡早套用，避免閃爍
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  FD.theme = { setPref: setPref, setAccent: setAccent, current: effective };
})(window);
