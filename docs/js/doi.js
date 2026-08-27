/* DOI 查詢：中繼資料、引用格式（APA / BibTeX / RIS）、授權、論文↔資料 DOI 互查。
   全部走有 CORS 的公開 API，純前端，不需要後端：

     doi.org 內容協商    Accept: application/vnd.citationstyles.csl+json 等
                         → 一個端點同時吃 Crossref（期刊）與 DataCite（資料集）DOI
     api.datacite.org    relatedIdentifiers（資料 DOI ↔ 論文 DOI）

   最高原則的取捨：這是**唯一**會為了「顯示」而對外查詢的中繼資料來源，因此
   一律「查到才加值、查不到就當沒事」——離線或 API 掛掉時，畫面仍用 zip 裡既有的
   doi/citation 呈現，不會變空白也不會跳錯誤。查詢結果快取到 localStorage，
   跟 gbif-image.js 同一套做法。 */
(function (global) {
  "use strict";
  var FD = global.FrogDash = global.FrogDash || {};

  var PREFIX = "mp-doi:";
  var TTL = 30 * 24 * 3600 * 1000;        // 中繼資料幾乎不變，快取 30 天

  function lsGet(k) {
    try {
      var v = JSON.parse(localStorage.getItem(PREFIX + k));
      if (!v || (Date.now() - v.t) > TTL) return undefined;
      return v.v;
    } catch (e) { return undefined; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(PREFIX + k, JSON.stringify({ t: Date.now(), v: v })); } catch (e) {}
  }

  /** 把使用者可能貼進來的各種寫法收斂成裸 DOI。 */
  function normalize(raw) {
    var s = String(raw == null ? "" : raw).trim();
    s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
    s = s.replace(/[\s.,;)]+$/, "");
    return /^10\.\d{4,9}\/\S+$/.test(s) ? s : "";
  }

  var mem = {};
  /** 同一個 key 只查一次（同時多處呼叫也只發一個請求）。 */
  function once(key, fn) {
    if (mem[key]) return mem[key];
    var cached = lsGet(key);
    if (cached !== undefined) { mem[key] = Promise.resolve(cached); return mem[key]; }
    mem[key] = fn().then(function (v) { lsSet(key, v); return v; })
      // 失敗不寫快取：可能只是暫時沒網路，下次重新整理應該要能再試
      .catch(function (e) { delete mem[key]; throw e; });
    return mem[key];
  }

  function get(url, accept) {
    var opt = accept ? { headers: { Accept: accept } } : undefined;
    return fetch(url, opt).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return accept && accept.indexOf("json") < 0 ? r.text() : r.json();
    });
  }

  // ---- 授權：從 CSL-JSON 的 license[].URL 或 copyright 認出 Creative Commons ----
  var CC_RE = /creativecommons\.org\/(?:licenses|publicdomain)\/([a-z-]+)(?:\/([\d.]+))?/i;
  function licenseOf(csl) {
    var urls = (csl.license || []).map(function (l) { return l.URL || ""; });
    for (var i = 0; i < urls.length; i++) {
      var m = CC_RE.exec(urls[i]);
      if (m) {
        var code = m[1].toLowerCase();
        var label = code === "zero" ? "CC0" : "CC " + code.toUpperCase().replace(/-/g, "-");
        return { id: code, label: label + (m[2] ? " " + m[2] : ""), url: urls[i] };
      }
    }
    // DataCite 的 CSL 會把授權放在 copyright（例："Creative Commons Zero v1.0 Universal"）
    var c = csl.copyright || "";
    if (/creative commons zero|CC0/i.test(c)) return { id: "zero", label: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" };
    var m2 = /creative commons attribution([^,;]*)/i.exec(c);
    if (m2) {
      var extra = m2[1] || "";
      var parts = ["CC BY"];
      if (/share[- ]alike/i.test(extra)) parts.push("SA");
      if (/non[- ]?commercial/i.test(extra)) parts.push("NC");
      if (/no deriv/i.test(extra)) parts.push("ND");
      var ver = /([\d]\.[\d])/.exec(extra);
      return { id: "by", label: parts.join("-") + (ver ? " " + ver[1] : ""), url: "" };
    }
    return null;
  }

  function authorsOf(csl) {
    return (csl.author || []).map(function (a) {
      if (a.literal) return a.literal;
      return [a.family, a.given].filter(Boolean).join(", ");
    }).filter(Boolean);
  }
  function yearOf(csl) {
    var d = csl.issued || csl.published || {};
    var p = (d["date-parts"] || [[]])[0] || [];
    return p[0] || null;
  }

  /**
   * DOI 中繼資料（標題、作者、年份、期刊/出版者、授權、正式網址）。
   * 期刊 DOI 與資料集 DOI 走同一個端點，回傳同一種形狀。
   */
  function meta(raw) {
    var doi = normalize(raw);
    if (!doi) return Promise.reject(new Error("bad DOI"));
    return once("meta:" + doi.toLowerCase(), function () {
      return get("https://doi.org/" + encodeURI(doi), "application/vnd.citationstyles.csl+json")
        .then(function (csl) {
          var ct = csl["container-title"];
          return {
            doi: csl.DOI || doi,
            type: csl.type || "",
            isData: /dataset|software/i.test(csl.type || ""),
            title: Array.isArray(csl.title) ? csl.title[0] : (csl.title || ""),
            authors: authorsOf(csl),
            year: yearOf(csl),
            container: Array.isArray(ct) ? ct[0] : (ct || ""),
            publisher: csl.publisher || "",
            volume: csl.volume || "", page: csl.page || "",
            url: csl.URL ? csl.URL.replace(/^http:\/\/dx\.doi\.org/, "https://doi.org") : ("https://doi.org/" + doi),
            license: licenseOf(csl)
          };
        });
    });
  }

  /** 格式化引用字串。style 為 CSL 樣式名（apa、harvard-cite-them-right…）。 */
  function cite(raw, style) {
    var doi = normalize(raw); if (!doi) return Promise.reject(new Error("bad DOI"));
    var st = style || "apa";
    return once("cite:" + st + ":" + doi.toLowerCase(), function () {
      return get("https://doi.org/" + encodeURI(doi), "text/x-bibliography; style=" + st)
        .then(function (t) { return String(t).trim(); });
    });
  }

  function bibtex(raw) {
    var doi = normalize(raw); if (!doi) return Promise.reject(new Error("bad DOI"));
    return once("bibtex:" + doi.toLowerCase(), function () {
      return get("https://doi.org/" + encodeURI(doi), "application/x-bibtex")
        .then(function (t) { return String(t).trim(); });
    });
  }

  function ris(raw) {
    var doi = normalize(raw); if (!doi) return Promise.reject(new Error("bad DOI"));
    return once("ris:" + doi.toLowerCase(), function () {
      return get("https://doi.org/" + encodeURI(doi), "application/x-research-info-systems")
        .then(function (t) { return String(t).trim(); });
    });
  }

  var PAPER_REL = /^(isCitedBy|isSupplementTo|isDescribedBy|isReferencedBy)$/i;

  /**
   * 論文 DOI ↔ 資料 DOI 互查（DataCite 的 relatedIdentifiers）。
   *
   * 一次搜尋同時涵蓋兩個方向：
   *   doi:"X"                              → X 自己若是 DataCite 資料集，讀它指向的論文
   *   relatedIdentifiers.relatedIdentifier:"X" → 有哪個資料集宣告它跟 X 有關
   * 用搜尋而不是 GET /dois/<doi>，是因為後者對期刊 DOI 會回 404——那是正常回答，
   * 卻會在 console 留下紅字。搜尋一律 200，順便把兩個請求併成一個。
   *
   * 回傳 { paper, data }（都不含輸入自己；Dryad 的 <doi>/1、/2 這種子項目也濾掉）。
   */
  function related(raw) {
    var doi = normalize(raw); if (!doi) return Promise.reject(new Error("bad DOI"));
    var low = doi.toLowerCase();
    return once("rel:" + low, function () {
      var query = 'doi:"' + doi + '" OR relatedIdentifiers.relatedIdentifier:"' + doi + '"';
      var url = "https://api.datacite.org/dois?query=" + encodeURIComponent(query) + "&page%5Bsize%5D=25";
      return get(url).then(function (j) {
        var out = { paper: null, data: null };
        (j.data || []).forEach(function (it) {
          var id = String(it.id || "").toLowerCase();
          var a = it.attributes || {};
          var rels = (a.relatedIdentifiers || []).filter(function (r) {
            return String(r.relatedIdentifierType || "").toUpperCase() === "DOI";
          });
          if (id === low) {                       // 自己是資料集 → 找它指向的論文
            rels.forEach(function (r) {
              var rid = String(r.relatedIdentifier || "").toLowerCase();
              if (!out.paper && rid !== low && PAPER_REL.test(r.relationType || "")) out.paper = rid;
            });
          } else if (id.indexOf(low + "/") !== 0) {   // 別人指向我 → 那就是對應的資料集
            var hit = rels.some(function (r) {
              return String(r.relatedIdentifier || "").toLowerCase() === low;
            });
            if (hit && !out.data) out.data = id;
          }
        });
        return out;
      });
    });
  }

  FD.DOI = { normalize: normalize, meta: meta, cite: cite, bibtex: bibtex, ris: ris, related: related };
})(window);
