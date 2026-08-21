/* PCA 散佈圖（Plotly）：分群著色＋形狀（可切換欄位/自訂）、軸切換、
   hover 浮出資訊卡、click 釘選、框選多點、跨視圖連動高亮、固定軸比例尺。

   拖曳只有一個，平移與框選必須分時共用：
   - 預設 dragmode='pan'（拖曳平移、滾輪縮放，維持原本手感）
   - 面板上的「框選」鈕切成 dragmode='select'（此時 Plotly 原生支援 Shift 加選）
   - 沒開框選時，按住 Shift 拖曳＝臨時框選，放開就變回平移 */
(function (global) {
  "use strict";
  var Store = global.FrogDash.Store, Groups = global.FrogDash.Groups;

  // 由目前主題（CSS 變數）取得 Plotly 用色，深/淺主題與 accent 皆自動套用
  function cssvar(n, fb) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(n);
    return (v && v.trim()) || fb;
  }
  function themeColors() {
    return {
      grid: cssvar("--grid", "rgba(255,255,255,.06)"),
      zero: cssvar("--grid-strong", "rgba(255,255,255,.14)"),
      fg: cssvar("--muted", "#8f9184"),
      hoverBg: cssvar("--surface", "#15160f"),
      hoverFg: cssvar("--hover-fg", "#f3f4ee"),
      hoverBd: cssvar("--bd2", "rgba(255,255,255,.15)")
    };
  }

  function PCAView(opts) {
    this.viewId = opts.viewId;
    this.plotEl = document.getElementById(opts.plotId);
    this.xSel = document.getElementById(opts.xId);
    this.ySel = document.getElementById(opts.yId);
    this.titleEl = document.getElementById(opts.titleId);
    this.view = null;
    this.traces = [];
    this.groupOfTrace = [];
    this.selectMode = false;      // 使用者用「框選」鈕切換的持續狀態
    this.tempSelect = false;      // 按住 Shift 的臨時狀態
    var self = this;
    this.xSel.addEventListener("change", function () { self.draw(); });
    this.ySel.addEventListener("change", function () { self.draw(); });
  }

  PCAView.prototype.setData = function (model) {
    this.model = model;
    this.view = model.views[this.viewId];
    if (!this.view) return;
    this.titleEl.textContent = this.view.label;
    var pcs = this.view.pcs;
    [this.xSel, this.ySel].forEach(function (sel) {
      sel.innerHTML = "";
      pcs.forEach(function (p) {           // 已移除變量解釋(%)，僅列 PC 名
        var opt = document.createElement("option");
        opt.value = p; opt.textContent = p;
        sel.appendChild(opt);
      });
    });
    this.xSel.value = this.view.defaultAxes[0] || pcs[0];
    this.ySel.value = this.view.defaultAxes[1] || pcs[1] || pcs[0];
    this.buildTraces();
    this.draw();
  };

  PCAView.prototype.buildTraces = function () {
    var model = this.model, view = this.view;
    var members = Groups.members();
    var byGroup = {};
    members.forEach(function (g) { byGroup[g.value] = { g: g, ids: [] }; });
    view.ids.forEach(function (sid) {
      var v = Groups.valueOf(sid);
      (byGroup[v] || (byGroup[v] = { g: { value: v, label: v, color: "#888", symbol: "circle" }, ids: [] })).ids.push(sid);
    });
    var order = members.map(function (g) { return byGroup[g.value]; })
      .concat(Object.keys(byGroup).filter(function (v) { return !members.some(function (m) { return m.value === v; }); })
        .map(function (v) { return byGroup[v]; }));

    this.traces = [];
    this.groupOfTrace = [];
    this.speciesIndexInTrace = {};
    var self = this;
    order.forEach(function (entry, ti) {
      entry.ids.forEach(function (sid, idx) { self.speciesIndexInTrace[sid] = { trace: ti, idx: idx }; });
      self.traces.push({
        type: "scattergl", mode: "markers", name: entry.g.label,
        customdata: entry.ids,
        text: entry.ids.map(function (sid) { return (model.taxa[sid] || {})[model.displayLabelCol] || sid; }),
        hovertemplate: "%{text}<extra></extra>",
        marker: { color: entry.g.color, symbol: entry.g.symbol, size: 9, line: { color: "#33404d", width: 0.6 }, opacity: 0.95 },
        selected: { marker: { size: 15, opacity: 1 } },
        unselected: { marker: { opacity: 0.12 } },
        x: [], y: []
      });
      self.groupOfTrace.push(entry.g.value);
    });
  };

  // 以「全體資料」計算固定的方形軸範圍（等尺度），與群組顯示與否無關 (#11)
  PCAView.prototype.computeRange = function (px, py) {
    var view = this.view, minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    view.ids.forEach(function (sid) {
      var x = view.scores[sid][px], y = view.scores[sid][py];
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    });
    var cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    var span = Math.max(maxx - minx, maxy - miny) * 1.12 || 1;
    return { x: [cx - span / 2, cx + span / 2], y: [cy - span / 2, cy + span / 2] };
  };

  PCAView.prototype.draw = function () {
    if (!this.view) return;
    var px = this.xSel.value, py = this.ySel.value, view = this.view;
    this.traces.forEach(function (tr) {
      tr.x = tr.customdata.map(function (sid) { return view.scores[sid][px]; });
      tr.y = tr.customdata.map(function (sid) { return view.scores[sid][py]; });
    });
    var rng = this.computeRange(px, py);
    var T = themeColors();
    var GRID = T.grid, ZERO = T.zero, FG = T.fg;
    var layout = {
      margin: { l: 44, r: 10, t: 8, b: 38 },
      font: { color: FG, family: "Archivo, system-ui, sans-serif", size: 11 },
      xaxis: { title: { text: px, font: { size: 11, color: FG } }, gridcolor: GRID, tickfont: { color: FG },
               zeroline: true, zerolinecolor: ZERO, autorange: false, range: rng.x.slice() },
      yaxis: { title: { text: py, font: { size: 11, color: FG } }, gridcolor: GRID, tickfont: { color: FG }, scaleanchor: "x", scaleratio: 1,
               zeroline: true, zerolinecolor: ZERO, autorange: false, range: rng.y.slice() },
      showlegend: false, hovermode: "closest", dragmode: this.dragMode(),
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      hoverlabel: { bgcolor: T.hoverBg, bordercolor: T.hoverBd, font: { color: T.hoverFg, family: "Archivo" } }
    };
    var config = { displayModeBar: false, responsive: true, scrollZoom: true };
    var self = this;
    this.plotEl._pcaDrag = layout.dragmode;
    Plotly.react(this.plotEl, this.traces, layout, config).then(function () {
      if (!self._bound) {
        self._bound = true;
        self.plotEl.on("plotly_click", function (ev) {
          if (!ev.points || !ev.points.length) return;
          var sid = ev.points[0].customdata;
          Store.focus(sid, self.viewId);
          Store.setHighlight([sid], self.viewId);
        });
        self.plotEl.on("plotly_hover", function (ev) {
          if (!ev.points || !ev.points.length) return;
          var sid = ev.points[0].customdata;
          var me = ev.event || {};
          Store.hover(sid, { x: me.clientX, y: me.clientY }, self.viewId);
        });
        self.plotEl.on("plotly_unhover", function () { Store.unhover(); });
        // 框選：把框到的點全部設成高亮（樹、側邊面板、其他視圖都會跟著連動）
        self.plotEl.on("plotly_selected", function (ev) {
          if (!ev || !ev.points) return;               // 未框到東西時 Plotly 會給 undefined
          var ids = ev.points.map(function (p) { return p.customdata; })
                             .filter(function (x) { return x != null; });
          // applyHighlight() 用 restyle 寫回 selectedpoints，Plotly 會再丟一次
          // plotly_selected；不擋掉就是 selected → setHighlight → restyle → selected
          // 的無限遞迴（實測直接 Maximum call stack size exceeded）。
          if (sameSet(ids, Store.highlight)) return;
          if (ids.length) Store.setHighlight(ids, self.viewId);
          else Store.clearHighlight();
        });
        self.plotEl.on("plotly_deselect", function () {
          if (self._clearingSel) return;        // 我們自己清選取框，不是使用者取消選取
          Store.clearHighlight();
        });
      }
      self.applyHighlight(Store.highlight);
      self.applyGroups(Store.disabledGroups);
    });
  };

  /** ids 與目前高亮集合是否相同（順序無關）。 */
  function sameSet(ids, set) {
    if (!set || ids.length !== set.size) return false;
    for (var i = 0; i < ids.length; i++) if (!set.has(ids[i])) return false;
    return true;
  }

  PCAView.prototype.dragMode = function () {
    return (this.selectMode || this.tempSelect) ? "select" : "pan";
  };

  /** 切換拖曳行為。用 relayout 就好，不必整張重畫（重畫會閃、也會丟掉目前的縮放）。
   *
   *  回平移時必須順手把 Plotly 的選取框（_fullLayout.selections）清掉：Plotly 2.x
   *  框完會留下一個「可再拖動」的選取物件，它會把後續的拖曳吃掉去搬動選取框，
   *  於是切回平移後拖曳完全沒反應。點的高亮是我們自己用 selectedpoints 畫的，
   *  清掉選取框不影響顯示。留在框選模式時則不清，Plotly 原生的 Shift 加選才有東西可加。 */
  PCAView.prototype.syncDragMode = function () {
    if (!this.plotEl || !this.plotEl.data) return;
    var want = this.dragMode();
    if (this.plotEl._pcaDrag === want) return;
    this.plotEl._pcaDrag = want;
    var patch = { dragmode: want };
    var self = this;
    if (want !== "select") {
      patch.selections = [];
      this._clearingSel = true;                 // 別讓隨之而來的 deselect 清掉高亮
      Plotly.relayout(this.plotEl, patch).then(function () {
        self._clearingSel = false;
        self.applyHighlight(Store.highlight);   // relayout 會順便重置 selectedpoints
      });
      return;
    }
    Plotly.relayout(this.plotEl, patch);
  };

  PCAView.prototype.setSelectMode = function (on) {
    this.selectMode = !!on;
    var btn = document.querySelector('.sel-mode[data-view="' + this.viewId + '"]');
    if (btn) {
      btn.classList.toggle("active", this.selectMode);
      btn.setAttribute("aria-pressed", this.selectMode ? "true" : "false");
    }
    this.syncDragMode();
  };

  PCAView.prototype.applyHighlight = function (idSet) {
    if (!this.view) return;
    var hasSel = idSet && idSet.size > 0;
    var selByTrace = this.traces.map(function () { return null; });
    if (hasSel) {
      this.traces.forEach(function (tr, ti) { selByTrace[ti] = []; });
      var self = this;
      idSet.forEach(function (sid) {
        var loc = self.speciesIndexInTrace[sid];
        if (loc) selByTrace[loc.trace].push(loc.idx);
      });
    }
    Plotly.restyle(this.plotEl, { selectedpoints: selByTrace });
  };

  PCAView.prototype.applyGroups = function (disabled) {
    var vis = this.groupOfTrace.map(function (gv) { return !disabled.has(gv); });
    Plotly.restyle(this.plotEl, { visible: vis });   // 只改可見性，範圍不變 (#11)
  };

  PCAView.prototype.rebuild = function () {   // 分組欄位/配色改變後
    if (!this.view) return;
    this.buildTraces();
    this.draw();
  };

  // 依 manifest 動態建立每個視圖的面板 DOM（已移除 scree）
  function buildPanel(row, view) {
    var vid = view.id;
    var sec = document.createElement("section");
    sec.className = "panel pca-panel";
    sec.innerHTML =
      '<div class="panel-head">' +
        '<h2 id="' + vid + '-title">' + esc(view.label) + '</h2>' +
        '<div class="axis-ctrls">' +
          '<label>X <select id="' + vid + '-x" class="axis-select"></select></label>' +
          '<label>Y <select id="' + vid + '-y" class="axis-select"></select></label>' +
          '<button class="btn small sel-mode" data-view="' + vid + '" aria-pressed="false"' +
            ' data-i18n-title="pca.selTip" title="' + esc(T("pca.selTip")) + '">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/></svg> ' +
            '<span data-i18n="pca.select">' + esc(T("pca.select")) + '</span></button>' +
          '<button class="btn small dl" data-view="' + vid + '" data-i18n-title="pca.png" title="' + esc(T("pca.png")) + '">↓ PNG</button>' +
        '</div>' +
      '</div>' +
      '<div id="' + vid + '-plot" class="plot"></div>';
    row.appendChild(sec);
  }
  function T(k, p) { return global.FrogDash.t ? global.FrogDash.t(k, p) : k; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  var views = {};
  function init() {
    Store.on("data", function (model) {
      var row = document.getElementById("pca-row");
      row.innerHTML = "";
      views = {};
      row.style.gridTemplateColumns = model.viewOrder.length === 1 ? "1fr" : "1fr 1fr";
      model.viewOrder.forEach(function (vid) { buildPanel(row, model.views[vid]); });
      model.viewOrder.forEach(function (vid) {
        views[vid] = new PCAView({ viewId: vid, plotId: vid + "-plot", xId: vid + "-x", yId: vid + "-y", titleId: vid + "-title" });
        views[vid].setData(model);
      });
      global.FrogDash.pcaViews = views;
    });
    // 「框選」鈕（面板是動態產生的，用委派）
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".sel-mode"); if (!btn) return;
      var v = views[btn.dataset.view]; if (!v) return;
      v.setSelectMode(!v.selectMode);
    });

    // 按住 Shift＝臨時框選。只往「平移→框選」單向借用：框選模式下的 Shift
    // 要留給 Plotly 原生的「加選」，不能被搶走。
    function shift(on) {
      Object.keys(views).forEach(function (k) {
        var v = views[k];
        if (v.selectMode) return;
        if (v.tempSelect === on) return;
        v.tempSelect = on;
        v.syncDragMode();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Shift" || e.repeat) return;
      var a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;   // 打字時不要動
      shift(true);
    });
    document.addEventListener("keyup", function (e) { if (e.key === "Shift") shift(false); });
    // 視窗失焦時收不到 keyup，會卡在框選模式
    global.addEventListener("blur", function () { shift(false); });

    Store.on("highlight", function (p) { Object.keys(views).forEach(function (k) { views[k].applyHighlight(p.ids); }); });
    Store.on("groups", function (disabled) { Object.keys(views).forEach(function (k) { views[k].applyGroups(disabled); }); });
    Store.on("groupschanged", function () { Object.keys(views).forEach(function (k) { views[k].rebuild(); }); });
  }

  global.FrogDash = global.FrogDash || {};
  global.FrogDash.initPCA = init;
  global.FrogDash.pcaViews = views;
  global.FrogDash.redrawPCA = function () { Object.keys(views).forEach(function (k) { views[k].draw(); }); };
})(window);
