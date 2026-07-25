/* 遠端影像抓取：從 Zenodo 的大型 zip 以 HTTP Range 只抓「單張圖」的位元組，
   用瀏覽器原生 DecompressionStream 解壓，顯示並快取到 IndexedDB。
   不下載整包、不需後端、不需 CDN。索引（species_id -> [offset, csize]）於 build 階段烤好。 */
(function (global) {
  "use strict";
  var FD = global.FrogDash = global.FrogDash || {};

  var DB_NAME = "morpho-img", STORE = "img", DB = null;
  function openDB() {
    return new Promise(function (res, rej) {
      if (DB) return res(DB);
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { DB = r.result; res(DB); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function cacheGet(key) {
    return openDB().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        tx.onsuccess = function () { res(tx.result || null); };
        tx.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  function cachePut(key, blob) {
    return openDB().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(STORE, "readwrite").objectStore(STORE).put(blob, key);
        tx.onsuccess = function () { res(true); };
        tx.onerror = function () { res(false); };
      });
    }).catch(function () {});
  }

  function inflateRaw(bytes) {
    // method 8 (raw DEFLATE) → 原生 DecompressionStream；不支援時回傳 null
    if (typeof DecompressionStream === "undefined") return Promise.resolve(null);
    try {
      var ds = new DecompressionStream("deflate-raw");
      var stream = new Response(bytes).body.pipeThrough(ds);
      return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    } catch (e) { return Promise.resolve(null); }
  }

  function RemoteImages(cfg) {
    this.zipUrl = cfg.zip_url;
    this.objects = cfg.objects || {};      // species_id -> [localHeaderOffset, compressedSize]
    this.record = cfg.record; this.license = cfg.license; this.citation = cfg.citation;
    this.ns = "z1:";                        // 快取命名空間（避免不同 zip 撞 key）
    this._pending = {};
  }
  RemoteImages.prototype.has = function (id) { return !!this.objects[id]; };

  RemoteImages.prototype.get = function (id) {
    var self = this;
    if (this._pending[id]) return this._pending[id];
    var ent = this.objects[id];
    if (!ent) return Promise.resolve(null);
    var key = this.ns + id;
    var p = cacheGet(key).then(function (blob) {
      if (blob) return URL.createObjectURL(blob);            // 命中快取
      return self._fetch(id, ent).then(function (b) {
        if (!b) return null;
        cachePut(key, b);
        return URL.createObjectURL(b);
      });
    });
    this._pending[id] = p;
    p.finally && p.finally(function () { delete self._pending[id]; });
    return p;
  };

  RemoteImages.prototype._fetch = function (id, ent) {
    var off = ent[0], csize = ent[1];
    // 一次抓：本地檔頭(30)+檔名+extra(過抓 512B) + 壓縮資料
    var start = off, end = off + 512 + csize;
    return fetch(this.zipUrl, { headers: { Range: "bytes=" + start + "-" + end } })
      .then(function (r) { if (!r.ok && r.status !== 206) throw new Error("range " + r.status); return r.arrayBuffer(); })
      .then(function (ab) {
        var b = new Uint8Array(ab);
        if (!(b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04)) throw new Error("bad local header");
        var nlen = b[26] | (b[27] << 8), elen = b[28] | (b[29] << 8);
        var dataStart = 30 + nlen + elen;
        var comp = b.subarray(dataStart, dataStart + csize);
        return inflateRaw(comp);
      })
      .then(function (raw) {
        if (!raw) return null;
        return new Blob([raw], { type: "image/jpeg" });
      })
      .catch(function (e) { console.warn("remote-image", id, e && e.message); return null; });
  };

  // 由已載入的資料集設定（catalog 的 remote_images）建立；否則回傳 null
  FD.RemoteImages = null;
  FD.setupRemoteImages = function (cfg) {
    if (!cfg || !cfg.index_url) { FD.RemoteImages = null; return Promise.resolve(null); }
    return fetch(cfg.index_url).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (idx) {
        if (!idx) { FD.RemoteImages = null; return null; }
        FD.RemoteImages = new RemoteImages(idx);
        return FD.RemoteImages;
      }).catch(function () { FD.RemoteImages = null; return null; });
  };
})(window);
