/* Shared helpers for the client portal and the admin area: sign-in, API calls, tabs, formatting, tables. */
(function () {
  "use strict";
  var cfg = window.RP_CONFIG || {};
  var RP = (window.RP = {});
  RP.demo = !cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase;
  RP.sb = RP.demo ? null : window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  RP.esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
  RP.money = function (n, cur) {
    if (n == null || isNaN(n)) return "–";
    n = Number(n);
    return cur === "INR" ? "₹" + Math.round(n).toLocaleString("en-IN") : "AED " + Math.round(n).toLocaleString("en-US");
  };
  RP.num = function (n) { return n == null || isNaN(n) ? "–" : Number(n).toLocaleString("en-US"); };
  RP.pct = function (n) { return n == null || isNaN(n) ? "–" : Number(n).toFixed(1) + "%"; };
  RP.date = function (iso) { return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }) : "–"; };
  RP.dateTime = function (iso) { return iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }) + " GST" : "–"; };
  RP.monthLabel = function (iso) { return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }); };
  RP.icon = function (n) { return '<span class="ms" aria-hidden="true">' + n + "</span>"; };

  /** cols: [{key, label, num?, render?}] */
  RP.table = function (cols, rows, opts) {
    opts = opts || {};
    if (!rows.length) return '<p class="muted pad">' + RP.esc(opts.empty || "Nothing to show yet.") + "</p>";
    var h = '<table class="' + (opts.cls || "text") + '"><thead><tr>' + cols.map(function (c) { return "<th" + (c.num ? ' class="r"' : "") + ">" + RP.esc(c.label) + "</th>"; }).join("") + "</tr></thead><tbody>";
    rows.forEach(function (r, i) {
      h += "<tr" + (opts.clickable ? ' class="click" tabindex="0" data-i="' + i + '"' : "") + ">" + cols.map(function (c) {
        var v = c.render ? c.render(r) : RP.esc(r[c.key]);
        return "<td" + (c.num ? ' class="r mono"' : "") + ">" + v + "</td>";
      }).join("") + "</tr>";
    });
    return h + "</tbody></table>";
  };
  /** rows may be a function, so the handler always reads the latest data after a reload. */
  RP.onRowClick = function (container, rows, fn) {
    var get = function () { return typeof rows === "function" ? rows() : rows; };
    container.addEventListener("click", function (e) { var tr = e.target.closest("tr.click"); if (tr) fn(get()[Number(tr.dataset.i)], tr); });
    container.addEventListener("keydown", function (e) { if (e.key === "Enter") { var tr = e.target.closest("tr.click"); if (tr) fn(get()[Number(tr.dataset.i)], tr); } });
  };
  RP.badge = function (status) { return '<span class="badge b-' + RP.esc(status) + '">' + RP.esc(String(status).replace(/_/g, " ")) + "</span>"; };
  RP.ok = function (el, msg) { el.hidden = false; el.innerHTML = '<div class="ok">' + RP.icon("task_alt") + "<p>" + msg + "</p></div>"; };

  /** Tabs: links with data-tab show the matching [data-panel]. The address hash keeps the open tab. */
  RP.tabs = function (onOpen) {
    var links = document.querySelectorAll("[data-tab]");
    function open(name) {
      var found = false;
      links.forEach(function (a) { var on = a.dataset.tab === name; if (on) found = true; a.setAttribute("aria-current", on ? "page" : "false"); });
      if (!found) name = links[0].dataset.tab;
      document.querySelectorAll("[data-panel]").forEach(function (p) { p.hidden = p.dataset.panel !== name; });
      if (onOpen) onOpen(name);
    }
    links.forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); history.replaceState(null, "", "#" + a.dataset.tab); open(a.dataset.tab); }); });
    open((location.hash || "").slice(1) || links[0].dataset.tab);
  };

  /** Sign-in: Google or an email link. Calls ready(user) when signed in. */
  RP.auth = function (ready) {
    var login = document.getElementById("login"), app = document.getElementById("app");
    function show(user) { login.hidden = true; app.hidden = false; ready(user); }
    if (RP.demo) { document.getElementById("demoNote").hidden = false; return show({ id: "demo", email: "demo@ripepiper.com" }); }
    RP.sb.auth.getSession().then(function (r) {
      var s = r.data.session;
      if (s) return show(s.user);
      login.hidden = false;
    });
    RP.sb.auth.onAuthStateChange(function (evt, session) { if (evt === "SIGNED_IN" && session && app.hidden) show(session.user); });
    document.querySelector("[data-login=google]").addEventListener("click", function () {
      RP.sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    });
    document.getElementById("magicForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("magicEmail").value.trim(), err = document.getElementById("magicErr");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = "Please enter a valid email address."; return; }
      err.textContent = "";
      RP.sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname } }).then(function (r) {
        if (r.error) { err.textContent = "We could not send the link. Please try again in a minute."; return; }
        RP.ok(document.getElementById("magicOk"), "Check your inbox. The sign-in link is valid for one hour.");
      });
    });
    var out = document.getElementById("signOut");
    if (out) out.addEventListener("click", function () { RP.sb.auth.signOut().then(function () { location.reload(); }); });
  };

  /** Calls the Ripe Piper API with the signed-in user's token. */
  RP.api = function (path, body) {
    if (RP.demo) return Promise.reject(new Error("Sample mode: connect Supabase and deploy the API to use this action."));
    return RP.sb.auth.getSession().then(function (r) {
      return fetch((cfg.apiBase || "") + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + r.data.session.access_token },
        body: JSON.stringify(body || {})
      }).then(function (res) { return res.json().then(function (j) { if (!res.ok || j.ok === false) throw new Error(j.error || "Request failed."); return j; }); });
    });
  };

  /** Safe Markdown preview (HTML in the source is shown as text, matching the live blog). */
  RP.markdown = function (src) {
    if (!window.marked) return "<pre>" + RP.esc(src) + "</pre>";
    if (!RP._mdReady) { window.marked.use({ renderer: { html: function (t) { return RP.esc(typeof t === "string" ? t : t.text || ""); } } }); RP._mdReady = true; }
    return window.marked.parse(src || "");
  };
})();
