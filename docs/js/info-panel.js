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
    // 影像區：照片（可選，含來源標註）＋ 形態輪廓（可選）並存；皆缺則佔位
    var photo = model.imageURLs[sid];
    var outline = model.outlineURLs ? model.outlineURLs[sid] : null;
    var caption = model.imageCaptionCol ? t[model.imageCaptionCol] : "";
    var figs = "";
    if (photo) {
      figs += '<figure class="info-fig"><img src="' + photo + '" alt="' + esc(name) + '"/>' +
        (caption ? '<figcaption>' + esc(caption) + '</figcaption>' : '') + '</figure>';
    }
    if (outline) {
      figs += '<figure class="info-fig outline"><img src="' + outline + '" alt="' + esc(name) + ' 輪廓"/>' +
        '<figcaption>本種頭盾輪廓</figcaption></figure>';
    }
    // 無烤入圖時，若資料集設定了遠端影像且此物件有圖 → 佔位並非同步 Range 抓取
    var ri = global.FrogDash.RemoteImages;
    var remoteId = (!photo && ri && ri.has(sid)) ? sid : null;
    var imgHTML;
    if (figs) {
      imgHTML = '<div class="info-image-wrap' + (photo && outline ? ' dual' : '') + '">' + figs + '</div>';
    } else if (remoteId) {
      var attrib = esc((ri.citation || "") + (ri.license ? " · " + ri.license : ""));
      imgHTML = '<div class="info-image-wrap remote loading" data-remote="' + esc(remoteId) + '">' +
        '<figure class="info-fig"><img alt="' + esc(name) + '" />' +
        (attrib ? '<figcaption>' + attrib + '</figcaption>' : '') + '</figure></div>';
    } else {
      imgHTML = '<div class="info-image-wrap placeholder"></div>';
    }
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
    var ri = global.FrogDash.RemoteImages; if (!ri || !root) return;
    root.querySelectorAll("[data-remote]").forEach(function (wrap) {
      var id = wrap.getAttribute("data-remote"), img = wrap.querySelector("img");
      ri.get(id).then(function (url) {
        if (!document.body.contains(wrap)) { if (url) URL.revokeObjectURL(url); return; }
        if (!url) { wrap.classList.remove("loading"); wrap.classList.add("placeholder"); wrap.innerHTML = ""; return; }
        if (img) { img.onload = function () { wrap.classList.remove("loading"); }; img.src = url; }
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
