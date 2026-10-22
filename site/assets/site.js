/* Ripe Piper — shared site script.
   Forms carry data-endpoint (e.g. /api/lead). In production a Cloudflare Worker receives the POST,
   writes the lead to the database and sends the founder alert. In this sample, nothing leaves the page. */
(function () {
  "use strict";

  /* Mobile menu */
  var menuBtn = document.querySelector(".menu-btn"), mnav = document.getElementById("mnav");
  if (menuBtn && mnav) {
    menuBtn.addEventListener("click", function () {
      var open = mnav.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      menuBtn.querySelector(".ms").textContent = open ? "close" : "menu";
    });
  }

  /* Prices and currency (one source of truth for every page) */
  var PRICES = {
    AED: { revive: 3500, setup: 5000, engine: 7500, meeting: "500–900" },
    INR: { revive: 35000, setup: 50000, engine: 75000, meeting: "4,000–8,000" }
  };
  var cur = "AED";
  function fmt(n, c) {
    var sym = c === "AED" ? "AED " : "₹";
    if (typeof n === "string") return sym + n;
    return sym + (c === "INR" ? n.toLocaleString("en-IN") : n.toLocaleString("en-US"));
  }
  function compact(n, c) {
    if (c === "INR") {
      if (n >= 1e7) return "₹" + (n / 1e7).toFixed(1).replace(/\.0$/, "") + " crore";
      if (n >= 1e5) return "₹" + (n / 1e5).toFixed(1).replace(/\.0$/, "") + " lakh";
      return "₹" + Math.round(n).toLocaleString("en-IN");
    }
    if (n >= 1e6) return "AED " + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return "AED " + Math.round(n / 1e3) + "K";
    return "AED " + Math.round(n);
  }
  function applyCurrency() {
    document.querySelectorAll("[data-price]").forEach(function (el) {
      var lock = el.closest("[data-lock-cur]");
      var c = lock ? lock.getAttribute("data-lock-cur") : cur;
      el.textContent = fmt(PRICES[c][el.getAttribute("data-price")], c);
    });
    document.querySelectorAll("[data-cur]").forEach(function (el) { el.textContent = cur; });
    document.querySelectorAll("[data-set-cur]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-set-cur") === cur ? "true" : "false");
    });
    calc();
  }
  document.querySelectorAll("[data-set-cur]").forEach(function (b) {
    b.addEventListener("click", function () {
      var next = b.getAttribute("data-set-cur");
      if (next === cur) return;
      var deal = document.getElementById("cDeal");
      if (deal) deal.value = next === "INR" ? 1000000 : 40000;
      cur = next;
      applyCurrency();
    });
  });

  /* Calculator */
  function num(id) { var el = document.getElementById(id); if (!el) return 0; var v = parseFloat(el.value); return isFinite(v) && v > 0 ? v : 0; }
  function calc() {
    var out = document.getElementById("cOut");
    if (!out) return;
    var leads = num("cLeads"), deal = num("cDeal"), close = Math.min(num("cClose"), 100) / 100;
    var mLo = leads * 0.02, mHi = leads * 0.06, dLo = mLo * close, dHi = mHi * close;
    var f = function (x) { return x < 10 ? x.toFixed(1) : String(Math.round(x)); };
    document.getElementById("cMeet").textContent = Math.round(mLo) + " to " + Math.round(mHi);
    document.getElementById("cDeals").textContent = f(dLo) + " to " + f(dHi);
    out.textContent = compact(dLo * deal, cur) + " to " + compact(dHi * deal, cur);
  }
  ["cLeads", "cDeal", "cClose"].forEach(function (id) { var el = document.getElementById(id); if (el) el.addEventListener("input", calc); });

  /* Shared form helpers */
  var FREE = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "live.com", "aol.com", "rediffmail.com", "proton.me", "protonmail.com", "ymail.com"];
  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }
  function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }
  function okBox(icon, html) { return '<div class="ok"><span class="ms" aria-hidden="true">' + icon + "</span><p>" + html + "</p></div>"; }
  function firstName(n) { return n.split(" ")[0].replace(/[<>&"]/g, ""); }

  /* Live requests require explicit configuration; missing config fails closed. */
  var LIVE = !!(window.RP_CONFIG && window.RP_CONFIG.live === true);
  var UTM = (function () {
    var keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid", "li_fat_id"], out = {};
    try {
      var q = new URLSearchParams(location.search), saved = JSON.parse(sessionStorage.getItem("rp_utm") || "{}");
      keys.forEach(function (k) { if (q.get(k)) saved[k] = q.get(k); });
      if (!saved.landing_page) saved.landing_page = location.pathname;
      sessionStorage.setItem("rp_utm", JSON.stringify(saved)); out = saved;
    } catch (e) { out = { landing_page: location.pathname }; }
    return out;
  })();
  function turnstileToken() {
    var cfg = window.RP_CONFIG || {};
    if (!cfg.turnstileSiteKey) return Promise.reject(new Error("This form is not configured for live submissions. Please contact hello@ripepiper.com."));
    if (!window.turnstile || typeof window.turnstile.execute !== "function") return Promise.reject(new Error("Security verification is not available. Please reload and try again."));
    return new Promise(function (resolve, reject) {
      var node = document.createElement("div"); node.style.display = "none"; document.body.appendChild(node);
      var timer = setTimeout(function () { cleanup(); reject(new Error("Security verification timed out. Please try again.")); }, 20000);
      var widgetId;
      function cleanup() { clearTimeout(timer); if (widgetId !== undefined) try { window.turnstile.remove(widgetId); } catch (_) {} node.remove(); }
      try {
        widgetId = window.turnstile.render(node, { sitekey: cfg.turnstileSiteKey, execution: "execute", appearance: "interaction-only",
          callback: function (token) { cleanup(); resolve(token); },
          "error-callback": function () { cleanup(); reject(new Error("Security verification failed. Please try again.")); },
          "expired-callback": function () { cleanup(); reject(new Error("Security verification expired. Please try again.")); }
        });
        window.turnstile.execute(widgetId);
      } catch (e) { cleanup(); reject(e); }
    });
  }
  function post(path, body) {
    var protectedPaths = ["/api/lead", "/api/calculator", "/api/newsletter", "/api/opt-out"];
    var challenge = protectedPaths.indexOf(path) !== -1 ? turnstileToken() : Promise.resolve(null);
    return challenge.then(function (token) {
      var payload = Object.assign({}, UTM, body);
      if (token) payload.turnstile_token = token;
      return fetch(((window.RP_CONFIG || {}).apiBase || "") + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok || j.ok === false) throw new Error(j.error || "Something went wrong. Please try again."); return j; }); });
  }

  /* Book form: qualify, then show times */
  var book = document.getElementById("bookForm");
  if (book) {
    var pkg = (location.hash || "").replace("#", "");
    var sel = document.getElementById("fPkg");
    if (sel && ["revive", "signal", "response", "events"].indexOf(pkg) !== -1) sel.value = pkg;
    var err = document.getElementById("fErr"), res = document.getElementById("fResult"), leadId = null;
    var MSG_WORK = "Please use your work email address, so we can review your company before the call. You can also message us on WhatsApp.";
    var msgNotFit = function (name) { return "Thank you, " + firstName(name) + ". For deals below AED 10,000 (₹2.5 lakh), our service usually costs more than it returns. We have emailed you our calculator and a guide on reactivating old leads, so you can decide when the timing is right."; };
    book.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = val("fName"), email = val("fEmail").toLowerCase(), site = val("fSite");
      var deal = parseInt(document.getElementById("fDeal").value, 10);
      if (!name || !email || !site) { err.textContent = "Please enter your name, work email and company website."; return; }
      if (!validEmail(email)) { err.textContent = "Please enter a valid email address, for example name@company.com."; return; }
      if (!document.getElementById("fConsent").checked) { err.textContent = "Please tick the box to agree that we may contact you about this request."; return; }
      err.textContent = "";
      var show = function (html) { res.hidden = false; res.innerHTML = html; res.scrollIntoView({ behavior: "smooth", block: "nearest" }); };
      if (LIVE) {
        var country = document.getElementById("fCountry").value;
        post("/api/lead", { name: name, email: email, website: site, package: document.getElementById("fPkg").value, country: country, deal_band: deal, consent: true })
          .then(function (j) {
            leadId = j.lead_id;
            if (j.route === "work_email") return show(okBox("alternate_email", MSG_WORK));
            if (j.route === "not_fit") return show(okBox("lightbulb", msgNotFit(name)));
            show(liveSlots(j.slots || []));
          }).catch(function (x) { err.textContent = x.message; });
        return;
      }
      // Never present simulated availability as a real appointment or claim an invitation was sent.
      if (location.protocol === "file:") {
        err.textContent = "Calendar booking requires the deployed Ripe Piper website. This local file cannot access live availability. Open the staging website using its https:// address.";
      } else {
        err.textContent = "Calendar booking is not enabled on this website yet. Please email hello@ripepiper.com to arrange a call.";
      }
    });
    res.addEventListener("click", function (e) {
      var b = e.target.closest(".slot"); if (!b) return;
      res.querySelectorAll(".slot").forEach(function (s) { s.setAttribute("aria-pressed", "false"); });
      b.setAttribute("aria-pressed", "true");
      var old = res.querySelector(".ok"); if (old) old.remove();
      var add = function (html) { var d = document.createElement("div"); d.innerHTML = html; res.appendChild(d.firstChild); };
      if (LIVE) {
        res.querySelectorAll(".slot").forEach(function (s) { s.disabled = true; });
        post("/api/book", { lead_id: leadId, start: b.getAttribute("data-start") })
          .then(function (j) { add(okBox("event_available", "<strong>Your call is booked for " + j.label + ".</strong> We have sent a calendar invitation with the Google Meet link to your email. You will receive reminders 24 hours and 1 hour before the call.")); })
          .catch(function (x) { res.querySelectorAll(".slot").forEach(function (s) { s.disabled = false; }); b.setAttribute("aria-pressed", "false"); add(okBox("schedule", x.message)); });
        return;
      }
      add(okBox("schedule", "This is a preview only. No booking has been created. Please use the deployed website."));
    });
  }
  function liveSlots(list) {
    if (!list.length) return okBox("schedule", "There are no free times in the next two weeks. Please message us on WhatsApp or email hello@ripepiper.com and we will find a time.");
    var h = "<p><strong>Your company is a good fit for a call.</strong> Choose a time below. All times are Gulf Standard Time.</p><div class=\"slots\">";
    list.forEach(function (s) { h += '<button type="button" class="slot" data-start="' + s.start + '" data-slot="' + s.label + '">' + s.label.replace(" GST", "") + "</button>"; });
    return h + "</div>";
  }

  /* Calculator email gate */
  var gate = document.getElementById("gateForm");
  if (gate) {
    gate.addEventListener("submit", function (e) {
      e.preventDefault();
      var err = document.getElementById("gErr"), ok = document.getElementById("gOk");
      var name = val("gName"), email = val("gEmail").toLowerCase(), company = val("gCompany");
      if (!name || !email || !company) { err.textContent = "Please enter your name, work email and company name."; return; }
      if (!validEmail(email)) { err.textContent = "Please enter a valid email address, for example name@company.com."; return; }
      if (!document.getElementById("gConsent").checked) { err.textContent = "Please tick the box so we can email you the breakdown."; return; }
      err.textContent = "";
      var done = function () { ok.hidden = false; ok.innerHTML = okBox("mark_email_read", "Thank you, " + firstName(name) + ". Your breakdown will arrive at " + email.replace(/[<>&"]/g, "") + " within one business day."); };
      if (!LIVE) { err.textContent = "This form is not enabled. Nothing has been submitted or sent. Please contact hello@ripepiper.com."; return; }
      post("/api/calculator", { name: name, email: email, company: company, consent: true, leads: num("cLeads"), deal: num("cDeal"), close: num("cClose"), currency: cur }).then(done).catch(function (x) { err.textContent = x.message; });
    });
  }

  /* Opt-out form */
  var opt = document.getElementById("optForm");
  if (opt) {
    opt.addEventListener("submit", function (e) {
      e.preventDefault();
      var err = document.getElementById("oErr"), ok = document.getElementById("oOk"), email = val("oEmail").toLowerCase();
      if (!validEmail(email)) { err.textContent = "Please enter a valid email address."; return; }
      err.textContent = "";
      var done = function () { ok.hidden = false; ok.innerHTML = okBox("task_alt", "Done. " + email.replace(/[<>&"]/g, "") + " will be added to our do-not-contact list within 48 hours."); };
      if (!LIVE) { err.textContent = "This form is not enabled. Nothing has been submitted or sent. Please contact hello@ripepiper.com."; return; }
      post("/api/opt-out", { email: email, reason: document.getElementById("oReason").value }).then(done).catch(function (x) { err.textContent = x.message; });
    });
  }

  /* Newsletter sign-up (shared on every page) */
  var nl = document.getElementById("nlForm");
  if (nl) {
    nl.addEventListener("submit", function (e) {
      e.preventDefault();
      var err = document.getElementById("nlErr"), ok = document.getElementById("nlOk"), email = val("nlEmail").toLowerCase();
      if (!validEmail(email)) { err.textContent = "Please enter a valid email address, for example name@company.com."; return; }
      if (!document.getElementById("nlConsent").checked) { err.textContent = "Please tick the box to agree to receive the newsletter."; return; }
      err.textContent = "";
      var done = function () { ok.hidden = false; ok.innerHTML = okBox("mark_email_read", "Thank you. Please check " + email.replace(/[<>&"]/g, "") + " and click the confirmation link to complete your subscription."); };
      if (!LIVE) { err.textContent = "This form is not enabled. Nothing has been submitted or sent. Please contact hello@ripepiper.com."; return; }
      post("/api/newsletter", { email: email, consent: true }).then(done).catch(function (x) { err.textContent = x.message; });
    });
  }

  applyCurrency();
})();
