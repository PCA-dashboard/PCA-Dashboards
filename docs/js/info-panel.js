/* 物種資訊：滑鼠移到點上→浮出資訊卡（不必點）；點擊→釘選到側邊常駐面板 (#7/#8)。
   缺圖優雅降級為佔位圖。 */
(function (global) {
  "use strict";
  var Store = global.FrogDash.Store;
  var card, panel, panelBody, panelToggle;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function buildHTML(model, sid) {
    var t = model.taxa[sid]; if (!t) return "";
    var name = t[model.displayLabelCol] || sid;
    var g = Store.groupOf(sid);
    var groupHTML = g ? global.FrogDash.svgSymbol(g.symbol, g.color, 14) + "<span>" + esc(g.label) + "</span>" : "";
    // 影像區：照片（烤入 / Zenodo Range / GBIF 學名備援，擇一）＋ 形態輪廓（可選）並存
    var photo = model.imageURLs[sid];
    var outline = model.outlineURLs ? model.outlineURLs[sid] : null;
    var caption = model.imageCaptionCol ? t[model.imageCaptionCol] : "";
    var ri = global.FrogDash.RemoteImages;
    var remoteId = (!photo && ri && ri.has(sid)) ? sid : null;
    var gbifName = (!remoteId && global.FrogDash.gbifFallback && global.FrogDash.GBIF)
      ? (t[global.FrogDash.gbifFallback] || name) : null;

    var figs = [];
    if (photo) {
      figs.push('<figure class="info-fig"><img src="' + photo + '" alt="' + esc(name) + '"/>' +
        (caption ? '<figcaption>' + esc(caption) + '</figcaption>' : '') + '</figure>');
    } else if (remoteId) {
      var attrib = esc((ri.citation || "") + (ri.license ? " · " + ri.license : ""));
      figs.push('<figure class="info-fig remote loading" data-remote="' + esc(remoteId) + '"><img alt="' + esc(name) + '" />' +
        (attrib ? '<figcaption>' + attrib + '</figcaption>' : '') + '</figure>');
    }
    if (gbifName) {   // GBIF 代表照（與既有圖表/輪廓並存）
      figs.push('<figure class="info-fig remote loading gbif" data-gbif="' + esc(gbifName) + '"><img alt="' + esc(name) + '" /><figcaption class="gbif-cred"></figcaption></figure>');
    }
    if (outline) {
      figs.push('<figure class="info-fig outline"><img src="' + outline + '" alt="' + esc(name) + ' 輪廓"/><figcaption>形態輪廓</figcaption></figure>');
    }
    var imgHTML = figs.length
      ? '<div class="info-image-wrap' + (figs.length > 1 ? ' dual' : '') + '">' + figs.join("") + '</div>'
      : '<div class="info-image-wrap placeholder"></div>';
    var rows = "<tr><td class='k'>species_id</td><td>" + esc(sid) + "</td></tr>";
    (model.infoFields || []).forEach(function (f) {
      var v = t[f.column];
      if (v != null && v !== "") rows += "<tr><td class='k'>" + esc(f.label) + "</td><td>" + esc(v) + "</td></tr>";
    });
    return imgHTML +
      '<div class="info-text"><h3>' + esc(name) + '</h3>' +
      (groupHTML ? '<div class="info-group">' + groupHTML + '</div>' : "") +
      '<table class="info-table">' + rows + '</table></div>';
  }

  function hydrateRemote(root) {
    if (!root) return;
    var ri = global.FrogDash.RemoteImages;
    if (ri) root.querySelectorAll("[data-remote]").forEach(function (wrap) {
      var id = wrap.getAttribute("data-remote"), img = wrap.querySelector("img");
      ri.get(id).then(function (url) {
        if (!document.body.contains(wrap)) { if (url) URL.revokeObjectURL(url); return; }
        if (!url) { wrap.style.display = "none"; return; }
        if (img) { img.onload = function () { wrap.classList.remove("loading"); }; img.src = url; }
      });
    });
    // GBIF 學名備援
    var gb = global.FrogDash.GBIF;
    if (gb) root.querySelectorAll("[data-gbif]").forEach(function (wrap) {
      var nm = wrap.getAttribute("data-gbif"), img = wrap.querySelector("img"), cred = wrap.querySelector(".gbif-cred");
      gb.get(nm).then(function (res) {
        if (!document.body.contains(wrap)) return;
        function fail() { wrap.style.display = "none"; }
        if (!res || !res.url) return fail();
        if (cred) cred.textContent = res.credit || "";
        if (img) { img.onload = function () { wrap.classList.remove("loading"); }; img.onerror = fail; img.referrerPolicy = "no-referrer"; img.src = res.url; }
      });
    });
  }

  function showCard(p) {
    if (!Store.data) return;
    card.innerHTML = '<div class="info-body">' + buildHTML(Store.data, p.speciesId) + '</div>';
    hydrateRemote(card);
    card.hidden = false;
    // 定位在游標旁，超出邊界則翻面
    var pos = p.pos || { x: 40, y: 40 };
    var r = card.getBoundingClientRect();
    var x = pos.x + 16, y = pos.y + 16;
    if (x + r.width > window.innerWidth - 8) x = pos.x - r.width - 16;
    if (y + r.height > window.innerHeight - 8) y = window.innerHeight - r.height - 8;
    card.style.left = Math.max(8, x) + "px";
    card.style.top = Math.max(8, y) + "px";
  }
  function hideCard() { if (card) card.hidden = true; }

  function reflow() {
    // 內容寬度改變 → 讓 Plotly 圖與樹重新貼合
    setTimeout(function () {
      window.dispatchEvent(new Event("resize"));
      if (global.FrogDash.TreeView) global.FrogDash.TreeView.resize();
    }, 60);
  }
  function openPanel(sid) {
    if (!Store.data) return;
    panelBody.innerHTML = '<div class="info-body">' + buildHTML(Store.data, sid) + '</div>';
    hydrateRemote(panelBody);
    var wasHidden = panel.hidden;
    panel.hidden = false;
    document.body.classList.add("has-side-panel");
    if (panelToggle) panelToggle.classList.add("active");
    if (wasHidden) reflow();
  }
  function closePanel() {
    panel.hidden = true;
    document.body.classList.remove("has-side-panel");
    if (panelToggle) panelToggle.classList.remove("active");
    reflow();
  }

  function init() {
    card = document.getElementById("info-card");
    panel = document.getElementById("side-panel");
    panelBody = document.getElementById("side-panel-body");
    panelToggle = document.getElementById("side-panel-toggle");

    Store.on("hover", showCard);
    Store.on("unhover", hideCard);
    Store.on("focus", function (p) { hideCard(); openPanel(p.speciesId); });

    var closeBtn = document.getElementById("side-panel-close");
    if (closeBtn) closeBtn.addEventListener("click", closePanel);
    if (panelToggle) panelToggle.addEventListener("click", function () {
      if (panel.hidden) { if (Store._lastFocus) openPanel(Store._lastFocus); else { panel.hidden = false; document.body.classList.add("has-side-panel"); panelToggle.classList.add("active"); } }
      else closePanel();
    });
    Store.on("focus", function (p) { Store._lastFocus = p.speciesId; });
  }

  global.FrogDash = global.FrogDash || {};
  global.FrogDash.initInfoPanel = init;
})(window);
