/* 文字編碼偵測與解碼。設計見 Source repo `docs/intake_design.md` 第 4 期。

   為什麼需要：`FileReader.readAsText` 與 `Blob.text()` 一律當成 UTF-8。台灣、日本、
   中國的實驗室資料常常是 Big5 / Shift_JIS / GBK，用 UTF-8 解會整份變亂碼——
   而且不是「報錯」，是**安靜地變成亂碼**：欄名認不出來、判讀直接失敗，
   使用者只看到「看不出是表格資料」，完全不知道真正的原因是編碼。

   **純函式、吃 bytes**，所以可以在 Node 直接測（TextDecoder 是 Node 與瀏覽器共有的）。

   誠實的邊界：
   - U+FFFD（替換字元）的數量能可靠分辨「UTF-8 vs 舊編碼」與「單位元組解錯」。
   - 但**分不出 Big5 與 GBK**：兩者結構幾乎一樣，用錯的那個解出來往往是
     「合法但意思不對」的漢字，不會產生 U+FFFD。所以一定要讓使用者能覆寫，
     並且把解碼後的表頭**秀給他看**——他一眼就知道是不是亂碼。
*/
(function (global) {
  "use strict";

  // 提供給 UI 的選項；值就是 TextDecoder 的 label
  var SUPPORTED = ["utf-8", "big5", "gbk", "shift_jis", "euc-kr", "utf-16le", "utf-16be", "windows-1252"];

  function u8(bytes) {
    if (bytes instanceof Uint8Array) return bytes;
    if (bytes && bytes.buffer) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return new Uint8Array(bytes || []);
  }

  /** BOM：最可靠的證據，有就別猜了。回傳 { encoding, skip } 或 null。 */
  function sniffBOM(b) {
    if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return { encoding: "utf-8", skip: 3 };
    if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return { encoding: "utf-16le", skip: 2 };
    if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return { encoding: "utf-16be", skip: 2 };
    return null;
  }

  /** UTF-8 結構檢查。回傳 { valid, multibyte }。 */
  function checkUTF8(b) {
    var i = 0, multibyte = false;
    while (i < b.length) {
      var c = b[i];
      if (c < 0x80) { i++; continue; }
      var n;
      if ((c & 0xE0) === 0xC0) n = 1;
      else if ((c & 0xF0) === 0xE0) n = 2;
      else if ((c & 0xF8) === 0xF0) n = 3;
      else return { valid: false, multibyte: true };
      // 尾端被 64KB 截斷的多位元組字元不算錯
      if (i + n >= b.length) return { valid: true, multibyte: true, truncated: true };
      for (var k = 1; k <= n; k++) if ((b[i + k] & 0xC0) !== 0x80) return { valid: false, multibyte: true };
      multibyte = true;
      i += n + 1;
    }
    return { valid: true, multibyte: multibyte };
  }

  /** 沒有 BOM 的 UTF-16：ASCII 文字會有一半是 0x00，而且固定落在同一種位置。 */
  function sniffUTF16(b) {
    if (b.length < 16) return null;
    var evenNul = 0, oddNul = 0, n = Math.min(b.length, 4096);
    for (var i = 0; i < n; i++) { if (b[i] !== 0) continue; if (i % 2) oddNul++; else evenNul++; }
    var total = evenNul + oddNul;
    if (total < n * 0.2) return null;                       // NUL 太少，不是 UTF-16
    if (oddNul > evenNul * 4) return "utf-16le";            // 'a',0,'b',0 → NUL 在奇數位
    if (evenNul > oddNul * 4) return "utf-16be";
    return null;
  }

  /** Big5／GBK 這類雙位元組編碼的合理性：高位元組是否都能組成合法的雙位元組對。 */
  function dbcsPlausible(b) {
    var pairs = 0, loose = 0, i = 0;
    while (i < b.length) {
      var c = b[i];
      if (c < 0x80) { i++; continue; }
      if (c >= 0x81 && c <= 0xFE && i + 1 < b.length) {
        var t = b[i + 1];
        if ((t >= 0x40 && t <= 0x7E) || (t >= 0xA1 && t <= 0xFE)) { pairs++; i += 2; continue; }
      }
      loose++; i++;
    }
    return { pairs: pairs, loose: loose, ok: pairs > 0 && loose <= pairs * 0.02 };
  }

  /**
   * 偵測編碼。**純函式。**
   * @returns { encoding, confidence, reason, skip }
   */
  function detect(bytes) {
    var b = u8(bytes);
    if (!b.length) return { encoding: "utf-8", confidence: 0, reason: "empty", skip: 0 };

    var bom = sniffBOM(b);
    if (bom) return { encoding: bom.encoding, confidence: 1, reason: "bom", skip: bom.skip };

    var u16 = sniffUTF16(b);
    if (u16) return { encoding: u16, confidence: 0.9, reason: "nul-pattern", skip: 0 };

    var utf8 = checkUTF8(b);
    if (utf8.valid && !utf8.multibyte) return { encoding: "utf-8", confidence: 1, reason: "ascii", skip: 0 };
    if (utf8.valid) return { encoding: "utf-8", confidence: 0.95, reason: "valid-utf8", skip: 0 };

    // 不是合法 UTF-8 → 舊編碼。雙位元組結構成立就猜 Big5（本專案的主要使用者在台灣），
    // 但這個猜測**分不出 Big5 與 GBK**，所以信心度刻意壓低，UI 一定要讓使用者覆寫。
    var d = dbcsPlausible(b);
    if (d.ok) return { encoding: "big5", confidence: 0.5, reason: "dbcs", skip: 0 };
    return { encoding: "windows-1252", confidence: 0.3, reason: "single-byte", skip: 0 };
  }

  /** 用指定編碼解碼，順便數 U+FFFD——那是「解錯了」最可靠的訊號。 */
  function decode(bytes, encoding, skip) {
    var b = u8(bytes);
    if (skip) b = b.subarray(skip);
    var text;
    try { text = new TextDecoder(encoding).decode(b); }
    catch (e) { text = new TextDecoder("utf-8").decode(b); encoding = "utf-8"; }
    var bad = (text.match(/�/g) || []).length;
    return { text: text, encoding: encoding, replacements: bad };
  }

  function isCJK(c) {
    return (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) ||   // 漢字
           (c >= 0x3040 && c <= 0x30FF) ||                                    // 假名
           (c >= 0xAC00 && c <= 0xD7AF) ||                                    // 諺文
           (c >= 0xFF00 && c <= 0xFFEF);                                      // 全形
  }
  function isLatinLetter(c) {
    return (c >= 0xC0 && c <= 0x24F) && c !== 0xD7 && c !== 0xF7;             // 含重音的拉丁字母
  }
  function isAsciiLetter(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }

  /** 解出來的字看起來像不像真的文字。**關鍵是上下文,不是字元種類。**
   *
   *  光數 CJK 字數會判錯：法文的 é(0xE9) 後面接 ASCII，恰好符合 Big5 的雙位元組結構，
   *  用 Big5 解出來是 4 個漢字，分數反而比正確的 windows-1252 高（實測踩過）。
   *  真正的判別訊號是位置：
   *    - 漢字挨著漢字 → 成詞，合理
   *    - 漢字夾在拉丁字母中間（Crapaud 廧ineux）→ 不可能，重罰
   *    - 重音字母挨著拉丁字母（épineux）→ 正是法文的樣子
   */
  function scoreDecoded(text) {
    var score = 0, cjk = 0, latin = 0, weird = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) continue;
      if (c === 0xFFFD) continue;                    // 替換字元另外罰，不重複計
      var prev = i > 0 ? text.charCodeAt(i - 1) : 0;
      var next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (isCJK(c)) {
        cjk++;
        if (isCJK(prev) || isCJK(next)) score += 3;
        else if (isAsciiLetter(prev) || isAsciiLetter(next)) score -= 4;
      } else if (isLatinLetter(c)) {
        latin++;
        score += (isAsciiLetter(prev) || isAsciiLetter(next) ||
                  isLatinLetter(prev) || isLatinLetter(next)) ? 3 : 1;
      } else { weird++; score -= 4; }
    }
    return { score: score, cjk: cjk, latin: latin, weird: weird };
  }

  /** 一個候選編碼的總分。U+FFFD 罰最重（那是「確定解錯」）。 */
  function scoreCandidate(r) {
    return scoreDecoded(r.text).score - r.replacements * 10;
  }

  /**
   * 挑最好的解碼結果。
   * @param prefer 使用者指定的編碼（"" 或 "auto" 代表自動）
   *
   * 自動模式下會拿偵測結果與幾個常見候選比 U+FFFD 數量，取最少的。
   * 這能抓到「UTF-8 解舊編碼」與「單位元組解錯」；抓不到 Big5/GBK 互換
   * （用錯的那個會解出合法但意思不對的字），所以呼叫端要把解碼後的表頭秀出來。
   */
  function best(bytes, prefer) {
    var b = u8(bytes);
    if (prefer && prefer !== "auto") {
      var bom0 = sniffBOM(b);
      var r = decode(b, prefer, bom0 && bom0.encoding === prefer ? bom0.skip : 0);
      r.detected = prefer; r.forced = true; r.confidence = 1; r.reason = "user";
      return r;
    }
    var det = detect(b);
    var first = decode(b, det.encoding, det.skip);
    first.detected = det.encoding; first.confidence = det.confidence; first.reason = det.reason;
    // BOM、UTF-16、純 ASCII、合法 UTF-8 都是可靠證據，不必再猜
    if (det.reason === "bom" || det.reason === "nul-pattern" ||
        det.reason === "ascii" || det.reason === "valid-utf8") return first;

    // 舊編碼：純結構分不出來，改成「每個候選都解一次，比誰解出來像真的文字」。
    // 順序就是同分時的偏好（本專案主要使用者在台灣，big5 排在 gbk 前面）。
    var alts = ["big5", "shift_jis", "gbk", "euc-kr", "windows-1252", "utf-8"];
    var bestR = first, bestScore = scoreCandidate(first), second = -Infinity;
    for (var i = 0; i < alts.length; i++) {
      if (alts[i] === det.encoding) continue;
      var c = decode(b, alts[i], 0);
      var sc = scoreCandidate(c);
      if (sc > bestScore) {
        second = bestScore;
        c.detected = alts[i]; c.reason = "text-plausibility";
        bestR = c; bestScore = sc;
      } else if (sc > second) second = sc;
    }
    bestR.score = bestScore;
    // 前兩名分數接近 → 靠機器分不出來（Big5 vs GBK 就是這種），一定要人來確認
    bestR.ambiguous = second > -Infinity && bestScore - second < Math.max(4, bestScore * 0.15);
    bestR.confidence = bestR.ambiguous ? 0.35 : 0.6;
    return bestR;
  }

  var Encoding = {
    SUPPORTED: SUPPORTED, detect: detect, decode: decode, best: best,
    sniffBOM: sniffBOM, checkUTF8: checkUTF8, scoreDecoded: scoreDecoded
  };

  if (global) { global.FrogDash = global.FrogDash || {}; global.FrogDash.Encoding = Encoding; }
  if (typeof module !== "undefined" && module.exports) module.exports = Encoding;   // Node 測試用
})(typeof window !== "undefined" ? window : null);
