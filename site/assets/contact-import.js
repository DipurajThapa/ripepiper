/* Local-only contact file preparation. No persistence, network or contact rights. */
(function () {
  "use strict";
  var headers = ["email", "company", "reference", "rights_reference", "observed_at"];
  var maxBytes = 65536;
  function bytes(text) {
    var count = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 128) count++; else if (code < 2048) count += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { count += 4; i++; }
      else count += 3;
    }
    return count;
  }
  function cells(text, delimiter) {
    var records = [], row = [], field = "", quoted = false, closed = false, started = false, line = 1, start = 1, blankRows = 0;
    function finish() {
      row.push(field);
      if (row.length === 1 && !started && !field.trim()) blankRows++;
      else records.push({line: start, cells: row});
      if (records.length > 51) throw Error("Use at most 50 contacts plus one header row.");
      row = []; field = ""; closed = false; started = false;
    }
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
        else if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; field += '\n'; line++; }
        else field += c;
      } else if (c === delimiter) {
        row.push(field); field = ""; closed = false; started = true;
        if (row.length > 5) throw Error("Line " + start + ": expected five columns. Check the separator and quoting.");
      } else if (c === '\r' || c === '\n') {
        finish(); if (c === '\r' && text[i + 1] === '\n') i++; line++; start = line;
      } else if (c === '"') {
        if (field !== "" || closed) throw Error("Line " + line + ": quotation marks must begin a field; double embedded quotes.");
        quoted = true; started = true;
      } else {
        if (closed) throw Error("Line " + line + ": unexpected text after a closing quote.");
        field += c;
      }
    }
    if (quoted) throw Error("Line " + start + ": quoted field is not closed.");
    if (field !== "" || row.length || started) finish();
    return {records: records, blankRows: blankRows};
  }
  function date(value, now) {
    var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(value);
    if (!m || +m[1] < 1000 || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate()) return null;
    // "Today" is the user's calendar day; a date ahead of UTC is clamped to now so the server's not-after-now check holds.
    var d = new Date(now), local = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    if (value > local) return null;
    var instant = value + "T00:00:00Z";
    return Date.parse(instant) <= now ? instant : d.toISOString();
  }
  function parse(text, options) {
    options = options || {};
    if (typeof text !== "string" || !text.trim()) throw Error("Choose a file or paste contact rows first.");
    if (bytes(text) > maxBytes) throw Error("Use a UTF-8 file or pasted text no larger than 64 KiB.");
    if (options.format !== "csv" && options.format !== "tsv") throw Error("Choose CSV or tab-separated text.");
    if (typeof options.synthetic !== "boolean") throw Error("Select the contact evidence mode.");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var parsed = cells(text, options.format === "csv" ? "," : "\t"), records = parsed.records, order = headers.slice();
    if (options.header) {
      if (!records.length) throw Error("The file has no header row.");
      order = records.shift().cells.map(function (v) { return v.trim().toLowerCase(); });
      if (order.length !== 5 || headers.some(function (h) { return order.filter(function (v) { return v === h; }).length !== 1; }))
        throw Error("Use each header exactly once: " + headers.join(", ") + ". Columns may be reordered.");
    }
    if (!records.length || records.length > 50) throw Error("Import between 1 and 50 contacts; split larger files before importing.");
    var seenEmail = Object.create(null), seenReference = Object.create(null), issues = 0, warnings = 0;
    var existing = options.existing || [], now = options.now === undefined ? Date.now() : options.now;
    var reports = records.map(function (record, index) {
      var row = {}, errors = [], notices = [], raw = record.cells;
      if (raw.length !== 5) errors.push("Expected exactly five columns.");
      headers.forEach(function (key) { row[key] = String(raw[order.indexOf(key)] || "").trim(); });
      row.email = row.email.toLowerCase();
      if (row.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push("Enter a valid email address.");
      if (options.synthetic !== row.email.endsWith(".invalid")) errors.push("Email must match the selected synthetic/business evidence mode.");
      ["company", "reference", "rights_reference"].forEach(function (key) {
        if (!row[key] || row[key].length > 240) errors.push(key + " is required and must be at most 240 characters.");
      });
      headers.forEach(function (key) {
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(row[key]) || (key !== "company" && /[\r\n\t]/.test(row[key]))) errors.push(key + " contains unsupported control characters.");
      });
      var observed = date(row.observed_at, now);
      if (!observed) errors.push("observed_at must be a real date, YYYY-MM-DD, no later than today.");
      else row.observed_at = observed;
      if (row.reference && seenReference[row.reference]) errors.push("Source reference also appears in row " + seenReference[row.reference] + "; each file row needs a distinct source reference.");
      else if (row.reference) seenReference[row.reference] = index + 1;
      if (row.email && seenEmail[row.email]) notices.push("Same contact as row " + seenEmail[row.email] + "; its distinct source will link to one contact. Existing company data is preserved.");
      else if (row.email) seenEmail[row.email] = index + 1;
      var known = existing.find(function (lead) { return typeof lead.email === "string" && lead.email.toLowerCase() === row.email; });
      if (known) notices.push("Existing account contact: link this source without overwriting its saved company or identity.");
      issues += errors.length; warnings += notices.length;
      return {row: index + 1, line: record.line, contact: row, errors: errors, warnings: notices};
    });
    var rows = reports.map(function (r) { return r.contact; });
    if (JSON.stringify({synthetic: options.synthetic, rows: rows}).length > 60000) throw Error("The encoded import is too large. Split this file into smaller batches.");
    return {valid: issues === 0, rows: rows, reports: reports, errorCount: issues, warningCount: warnings, blankRows: parsed.blankRows};
  }
  window.RP.contactImport = {parse: parse, maxBytes: maxBytes, headers: headers.slice()};
})();
