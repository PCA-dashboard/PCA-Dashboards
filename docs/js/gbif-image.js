/* GBIF 備援影像：當論文資料庫沒有原圖時,依「學名」向 GBIF(有 CORS)即時查一張
   代表性標本照。查詢結果(學名→URL+授權標註)快取到 localStorage,不重查;圖片本身
   由 <img> 顯示(跨站顯示免 CORS)並由瀏覽器原生快取。純 vanilla、無後端、無 CDN。 */
(function (global) {
  "use strict";
  var FD = global.FrogDash = global.FrogDash || {};
  var API = "https://api.gbif.org/v1";
  var mem = {};                                   // 記憶體內去重

  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : undefined; } catch (e) { return undefined; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function licenseShort(u) {
    if (!u) return "";
    var m = /creativecommons\.org\/licenses\/([a-z-]+)\/([0-9.]+)/i.exec(u);
    if (m) return "CC " + m[1].toUpperCase().replace(/-/g, "-") + " " + m[2];
    if (/publicdomain|cc0/i.test(u)) return "CC0";
    return "";
  }
  function lighten(url) {
    // iNaturalist 原圖很大 → 取 medium 縮圖
    if (/inaturalist.*\/original\./i.test(url)) return url.replace(/\/original\./i, "/medium.");
    return url;
  }

  function query(name) {
    return fetch(API + "/species/match?name=" + encodeURIComponent(name))
      .then(function (r) { return r.json(); })
      .then(function (m) {
        var key = m && m.usageKey;
        if (!key) return null;
        return fetch(API + "/occurrence/search?taxonKey=" + key + "&mediaType=StillImage&limit=6")
          .then(function (r) { return r.json(); })
          .then(function (d) {
            var recs = (d && d.results) || [];
            for (var i = 0; i < recs.length; i++) {
              var rec = recs[i], media = rec.media || [];
              for (var j = 0; j < media.length; j++) {
                var md = media[j];
                if (md.type === "StillImage" && md.identifier) {
                  var lic = md.license || rec.license || "";
                  var who = md.rightsHolder || rec.rightsHolder || md.publisher || rec.publisher || "iNaturalist / GBIF";
                  var ls = licenseShort(lic);
                  return { url: lighten(md.identifier),
                           credit: "GBIF · " + who + (ls ? " · " + ls : "") };
                }
              }
            }
            return null;
          });
      })
      .catch(function () { return null; });
  }

  // name -> Promise<{url,credit}|null>
  function get(name) {
    if (!name) return Promise.resolve(null);
    var key = "gbif:" + name;
    if (mem[key]) return mem[key];
    var cached = lsGet(key);
    if (cached !== undefined) { mem[key] = Promise.resolve(cached); return mem[key]; }
    var p = query(name).then(function (res) { lsSet(key, res || null); return res || null; });
    mem[key] = p;
    return p;
  }

  FD.GBIF = { get: get };
})(window);
