/* 圖片處理：比對物種、縮圖、命名、預算試算。
   設計與決策見 Source repo `docs/intake_design.md` §6。

   **規劃與命名是純函式**（planImages / safeName / estimate），可在 Node 直接 require 測試；
   只有真正解碼像素的 downscale / processAll 需要瀏覽器。分開是為了讓「哪張圖配哪個物種、
   輸出叫什麼名字、會不會超過 GitHub 上限」這些容易出錯的邏輯能被語料庫釘住。

   兩個關鍵決定（見設計文件）：
   - **預設縮圖**（長邊 640、JPEG q82）：對齊 image_pipeline/ 既有做法。不縮的 6MB 原圖
     約 170 張就撐爆 GitHub Pages 的 1GB；縮完 ~15KB/張，同樣空間放得下約 6 萬張。
   - **預設散檔**（img/ + image_base_url）而不是塞進統一 Zip：packageSite 會把統一 Zip
     整包 base64 烤進 baked.js（膨脹 33%），載入端再用逐 byte 迴圈還原，而且 zip-loader
     對 zip 內圖片是 eager 的。散檔則是 <img> 按需抓 + 瀏覽器原生快取。
*/
(function (global) {
  "use strict";

  // GitHub 的硬性上限（查證自官方文件），預算表就是拿這些數字當天花板
  var LIMITS = {
    site: 1024 * 1024 * 1024,          // 已發布的 Pages 站 ≤ 1 GB
    fileHard: 100 * 1024 * 1024,       // git 單檔 > 100 MiB 直接擋
    fileWarn: 50 * 1024 * 1024,        // > 50 MiB git 會警告
    webUpload: 25 * 1024 * 1024,       // GitHub 網頁介面上傳單檔上限
    deployFiles: 5000                  // 檔數太多，部署 10 分鐘可能逾時
  };
  var AVG_RESIZED = 15 * 1024;         // 縮圖後的實測平均（本專案 img/ 是 11～16 KB）
  var DEFAULTS = { maxSide: 640, quality: 0.82 };

  var IMAGE_EXT_RE = /\.(jpe?g|png|svg|webp|gif|tiff?|heic|heif|bmp)$/i;
  var VECTOR_RE = /\.svg$/i;

  function baseName(p) { return String(p || "").split("/").pop(); }
  function stripExt(n) { return baseName(n).replace(/\.[^.]+$/, ""); }
  function extOf(n) { var m = /\.[^.]+$/.exec(baseName(n)); return m ? m[0].toLowerCase() : ""; }

  /** 檔名安全：對齊專案慣例「species_id 檔名安全，用底線」。 */
  function safeName(s) {
    return String(s == null ? "" : s).trim()
      .replace(/[^\w.-]+/g, "_")
      .replace(/_+/g, "_").replace(/^[_.]+|_+$/g, "") || "image";
  }

  function norm(s) {
    return String(s == null ? "" : s).trim().toLowerCase()
      .replace(/\.[a-z0-9]{2,5}$/i, "")          // 去副檔名
      .replace(/[\s_]*\(\d+\)\s*$/, "")         // 作業系統的「副本」尾巴：Genus species (2).jpg
      .replace(/[\s\-.]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  }

  /**
   * 決定哪張圖配哪個物種、輸出叫什麼名字。**純函式。**
   *
   * @param images  [{ name, size }]  投入的影像檔（name 是相對路徑）
   * @param taxaIds [sid, ...]        taxa 裡的物種 ID（原樣）
   * @param opts.fromColumn { sid: "檔名" }  taxa 有圖片欄時的對照（優先於檔名比對）
   * @param opts.resize     true 時輸出一律重新編碼成 .jpg
   * @returns {
   *   pairs:   [{ file, sids:[...], out, size }]   一個檔可對到多個物種（科代表照）
   *   extra:   [file, ...]        對不到任何物種的圖（提示，不是錯誤）
   *   dupes:   [{ sid, kept, dropped:[...] }]      一物種多張，取第一張
   *   covered: n, total: n
   * }
   */
  function planImages(images, taxaIds, opts) {
    opts = opts || {};
    var resize = opts.resize !== false;
    var ids = (taxaIds || []).map(function (s) { return String(s); });
    var byNorm = {};
    ids.forEach(function (sid) { if (!byNorm[norm(sid)]) byNorm[norm(sid)] = sid; });

    var imgs = (images || []).filter(function (f) { return IMAGE_EXT_RE.test(f.name); });
    var imgByNorm = {};
    imgs.forEach(function (f) {
      var k = norm(baseName(f.name));
      (imgByNorm[k] = imgByNorm[k] || []).push(f);
    });

    var pairs = [], dupes = [], used = {}, matchedSid = {};
    // 兩個不同的 species_id 正規化後可能相同（Sp-a 與 Sp.a）。那會讓它們默默共用一張圖，
    // 使用者卻以為各自有圖。不自作主張，列進 ambiguous 讓 UI 攤開來問。
    var ambiguous = [], seenNorm = {};
    ids.forEach(function (sid) {
      var k = norm(sid);
      if (seenNorm[k] && seenNorm[k] !== sid) ambiguous.push({ key: k, ids: [seenNorm[k], sid] });
      else seenNorm[k] = sid;
    });

    function attach(file, sid) {
      var key = file.name;
      var p = pairs.filter(function (x) { return x.file === key; })[0];
      if (!p) { p = { file: key, sids: [], out: "", size: file.size || 0 }; pairs.push(p); }
      p.sids.push(sid);
      used[key] = 1;
      matchedSid[sid] = key;
    }

    ids.forEach(function (sid) {
      if (matchedSid[sid]) return;
      var want = opts.fromColumn && opts.fromColumn[sid];
      var cands = imgByNorm[norm(want || sid)] || [];
      if (!cands.length) return;
      attach(cands[0], sid);
      if (cands.length > 1) {
        dupes.push({ sid: sid, kept: cands[0].name, dropped: cands.slice(1).map(function (f) { return f.name; }) });
      }
    });

    // 輸出檔名：只對到一個物種就用 species_id；多個物種共用（科代表照）保留原檔名語意
    var taken = {};
    pairs.forEach(function (p) {
      var stem = p.sids.length === 1 ? safeName(p.sids[0]) : safeName(stripExt(p.file));
      var ext = resize && !VECTOR_RE.test(p.file) ? ".jpg" : (extOf(p.file) || ".jpg");
      var out = stem + ext, n = 2;
      while (taken[out.toLowerCase()]) { out = stem + "_" + (n++) + ext; }   // 不同物種撞名
      taken[out.toLowerCase()] = 1;
      p.out = out;
    });

    var extra = imgs.filter(function (f) { return !used[f.name]; }).map(function (f) { return f.name; });
    return {
      pairs: pairs, extra: extra, dupes: dupes, ambiguous: ambiguous,
      covered: Object.keys(matchedSid).length, total: ids.length
    };
  }

  /**
   * 預算試算。**純函式**，給打包前的「會不會超過 GitHub 上限」面板用。
   * 縮圖後的大小用 min(原大小, 15KB) 估：已經很小的圖不會變大，大照片會掉到 ~15KB。
   */
  function estimate(sizes, opts) {
    opts = opts || {};
    var resize = opts.resize !== false;
    var arr = (sizes || []).map(function (n) { return +n || 0; });
    var bytes = arr.reduce(function (a, b) { return a + b; }, 0);
    var out = resize
      ? arr.reduce(function (a, b) { return a + Math.min(b, AVG_RESIZED); }, 0)
      : bytes;
    var maxFile = arr.length ? Math.max.apply(null, arr) : 0;
    var warnings = [];
    if (out > LIMITS.site) warnings.push({ level: "error", key: "site", value: out });
    if (!resize && maxFile > LIMITS.fileHard) warnings.push({ level: "error", key: "fileHard", value: maxFile });
    else if (!resize && maxFile > LIMITS.fileWarn) warnings.push({ level: "warn", key: "fileWarn", value: maxFile });
    if (arr.length > LIMITS.deployFiles) warnings.push({ level: "warn", key: "deployFiles", value: arr.length });
    return { count: arr.length, bytes: bytes, outBytes: out, maxFile: maxFile, resize: resize, warnings: warnings };
  }

  function humanBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }

  // ---- 以下需要瀏覽器 ----

  /** 縮圖並重新編碼成 JPEG。SVG 是向量，不縮也不重編，原樣帶過。 */
  function downscale(file, opts) {
    opts = opts || {};
    var maxSide = opts.maxSide || DEFAULTS.maxSide, q = opts.quality || DEFAULTS.quality;
    if (VECTOR_RE.test(file.name || "")) return Promise.resolve(file);
    if (typeof createImageBitmap !== "function") return Promise.reject(new Error("no createImageBitmap"));
    var shrunk = false;
    return createImageBitmap(file).then(function (bmp) {
      var s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      shrunk = s < 1;
      var w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
      var cv, ctx;
      if (typeof OffscreenCanvas === "function") cv = new OffscreenCanvas(w, h);
      else { cv = document.createElement("canvas"); cv.width = w; cv.height = h; }
      ctx = cv.getContext("2d");
      ctx.drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      if (cv.convertToBlob) return cv.convertToBlob({ type: "image/jpeg", quality: q });
      return new Promise(function (res, rej) {
        cv.toBlob(function (b) { b ? res(b) : rej(new Error("toBlob 失敗")); }, "image/jpeg", q);
      });
    }).then(function (blob) {
      // 尺寸真的被縮過就一定用縮過的版本——**不能因為位元組沒變小就退回原圖**。
      // 雜訊多的大圖（1200x900 的照片）轉成 JPEG 後常常比原本的 PNG 大，
      // 若在這裡退回原圖，等於整張原尺寸上傳，縮圖形同虛設（這個坑實測踩過）。
      // 只有「本來就在尺寸內」時才比大小，避免把小圖重新編碼反而變大。
      if (shrunk) return blob || file;
      return (blob && blob.size < file.size) ? blob : file;
    });
  }

  /**
   * 依 plan 把每個檔處理成可寫入的 blob。
   *
   * 解不開的檔（HEIC 是已知疑慮，但任何損毀檔也一樣）**不會讓整批失敗**，
   * 而是收進 failed 並附原因——這樣不管瀏覽器支不支援某格式，行為都是對的。
   */
  function processAll(plan, fileByName, opts, onProgress) {
    opts = opts || {};
    var pairs = plan.pairs || [];
    var entries = [], failed = [];
    var i = 0;
    function step() {
      if (i >= pairs.length) return Promise.resolve();
      var p = pairs[i++];
      var f = fileByName(p.file);
      if (!f) { failed.push({ file: p.file, reason: "notfound" }); return step(); }
      var job = opts.resize === false ? Promise.resolve(f) : downscale(f, opts);
      return job.then(function (blob) {
        entries.push({ out: p.out, blob: blob, sids: p.sids, size: blob.size, from: p.file });
      }).catch(function (e) {
        failed.push({ file: p.file, reason: (e && e.message) || String(e) });
      }).then(function () {
        if (onProgress) onProgress(i, pairs.length);
        return step();
      });
    }
    return step().then(function () {
      return {
        entries: entries, failed: failed,
        bytes: entries.reduce(function (a, e) { return a + e.size; }, 0)
      };
    });
  }

  var Images = {
    LIMITS: LIMITS, DEFAULTS: DEFAULTS, AVG_RESIZED: AVG_RESIZED,
    safeName: safeName, planImages: planImages, estimate: estimate, humanBytes: humanBytes,
    downscale: downscale, processAll: processAll
  };

  if (global) { global.FrogDash = global.FrogDash || {}; global.FrogDash.Images = Images; }
  if (typeof module !== "undefined" && module.exports) module.exports = Images;   // Node 測試用
})(typeof window !== "undefined" ? window : null);
