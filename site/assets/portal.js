/* Client portal: live, tenant-scoped results. Row-level security in the database makes sure
   each signed-in user receives only their own company's rows. */
(function () {
  "use strict";
  var RP = window.RP, $ = function (id) { return document.getElementById(id); };
  var state = { tenants: [], tenant: null, role: "viewer", monthly: [], month: null, sources: [], ads: [], fees: [], deals: [], proposals: [], quotes: [], payments: [], activity: [], adAccounts: [] };

  /* ---------------------------------------------------------- sample data (shown only when Supabase is not connected) */
  function demoData() {
    var months = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"];
    var base = [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [62, 9, 1200, 1150, 64, 21, 7, 5, 9000, 7500], [80, 13, 1600, 1560, 98, 33, 10, 8, 11000, 7500],
      [94, 16, 1800, 1765, 121, 41, 12, 10, 12500, 7500], [101, 19, 1900, 1872, 140, 48, 15, 12, 13000, 9300], [88, 17, 1700, 1675, 129, 44, 13, 11, 12000, 9100]];
    var won = [0, 0, 60000, 85000, 120000, 95000], open = [0, 40000, 150000, 210000, 260000, 300000];
    state.tenant = { id: "t1", name: "Gulf Interiors LLC (sample)", currency: "AED", plan: "engine", package: "signal", attribution_model: "first_touch", status: "active" };
    state.tenants = [state.tenant]; state.role = "owner";
    state.monthly = months.map(function (m, i) {
      var b = base[i], fees = b[9], ad = b[8], cost = fees + ad;
      return { month: m, currency: "AED", leads: b[0], qualified_leads: b[1] * 2, emails_sent: b[2], emails_delivered: b[3], replies: b[4], positive_replies: b[5],
        meetings_booked: b[6] + 2, meetings_held: b[7], icp_match_pct: [0, 71, 78, 83, 86, 88][i], ad_spend: ad, fees: fees, total_cost: cost, won_revenue: won[i], open_pipeline: open[i],
        deals_won: [0, 0, 1, 1, 2, 1][i], cost_per_meeting: b[7] ? cost / b[7] : null, cost_per_qualified_lead: b[1] ? cost / (b[1] * 2) : null,
        reply_rate_pct: b[3] ? 100 * b[4] / b[3] : null, roi_pct: cost ? 100 * (won[i] - cost) / cost : null };
    });
    state.sources = [{ source: "outreach", leads: 310, qualified: 58, won_revenue: 245000 }, { source: "google", leads: 64, qualified: 12, won_revenue: 60000 },
      { source: "linkedin", leads: 33, qualified: 9, won_revenue: 55000 }, { source: "meta", leads: 18, qualified: 2, won_revenue: 0 }];
    state.ads = [{ platform: "google_ads", day: "2026-10-12", spend: 6200, impressions: 41000, clicks: 1180, conversions: 21 },
      { platform: "linkedin", day: "2026-10-12", spend: 4100, impressions: 18500, clicks: 260, conversions: 7 },
      { platform: "meta", day: "2026-10-12", spend: 1700, impressions: 52000, clicks: 640, conversions: 6 }];
    state.fees = [{ month: "2026-06-01", type: "setup", amount: 2750, note: "10% advance on the fixed-scope price" }, { month: "2026-06-01", type: "setup", amount: 2250, note: "Setup balance" }]
      .concat(months.slice(1).map(function (m) { return { month: m, type: "retainer", amount: 7500, note: "Monthly engine" }; }))
      .concat([{ month: "2026-09-01", type: "performance", amount: 1800, note: "3 meetings above the monthly floor" }, { month: "2026-10-01", type: "performance", amount: 1600, note: "2 meetings above the monthly floor" }]);
    state.deals = [{ id: "d1", name: "Head office fit-out, Business Bay", stage: "won", value: 95000, currency: "AED", source: "outreach", closed_at: "2026-10-08" },
      { id: "d2", name: "Clinic interiors, Al Barsha", stage: "proposal", value: 140000, currency: "AED", source: "linkedin", closed_at: null },
      { id: "d3", name: "Retail kiosk refurbishment", stage: "negotiation", value: 60000, currency: "AED", source: "google", closed_at: null },
      { id: "d4", name: "Warehouse office, Jebel Ali", stage: "meeting", value: 100000, currency: "AED", source: "outreach", closed_at: null }];
    state.proposals = [{ id: "p1", kind: "pre", plan: "engine", package: "signal", currency: "AED", fixed_amount: 27500, advance_amount: 2750, status: "paid", paid_at: "2026-06-03T09:00:00Z", access_token: "" }];
    state.quotes = [{ id: "q1", status: "sent", currency: "AED", total: 4500, items: [{ description: "Arabic versions of all outreach messages", quantity: 1, unit_price: 3000 }, { description: "Weekly HubSpot sync of deal stages", quantity: 1, unit_price: 1500 }] }];
    state.payments = [{ purpose: "advance", amount: 2750, currency: "AED", status: "paid", provider: "stripe", created_at: "2026-06-03T09:00:00Z" }];
    state.activity = [{ at: "2026-10-14T08:00:00Z", kind: "change", actor: "Ripe Piper", message: "We paused Meta ads. Cost per qualified lead was three times higher than LinkedIn. The budget moved to LinkedIn from 15 October." },
      { at: "2026-10-07T08:00:00Z", kind: "note", actor: "Ripe Piper", message: "Reply rate dropped from 7.5% to 6.9% after the Diwali week. We expect it to recover this week." },
      { at: "2026-09-02T08:00:00Z", kind: "milestone", actor: "Ripe Piper", message: "Ideal customer match passed 85% for the first time after we added the 'new office' signal." },
      { at: "2026-06-03T09:00:00Z", kind: "milestone", actor: "Ripe Piper", message: "Advance of AED 2,750 received. The engagement has started." }];
    state.adAccounts = [{ platform: "google_ads", last_synced_at: "2026-10-19T22:05:00Z" }];
  }

  /* ---------------------------------------------------------- live data */
  function load(tenantId) {
    var sb = RP.sb, t = tenantId;
    return Promise.all([
      sb.from("v_tenant_monthly").select("*").eq("tenant_id", t).order("month"),
      sb.from("v_tenant_sources").select("*").eq("tenant_id", t),
      sb.from("ad_metrics_daily").select("platform,day,spend,impressions,clicks,conversions").eq("tenant_id", t).gte("day", new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10)),
      sb.from("fees").select("*").eq("tenant_id", t).order("month"),
      sb.from("deals").select("*").eq("tenant_id", t).order("created_at", { ascending: false }),
      sb.from("proposals").select("id,kind,plan,package,currency,fixed_amount,advance_amount,status,paid_at,access_token").eq("tenant_id", t),
      sb.from("quotes").select("*").eq("tenant_id", t).order("created_at", { ascending: false }),
      sb.from("payments").select("purpose,amount,currency,status,provider,created_at").eq("tenant_id", t).order("created_at", { ascending: false }),
      sb.from("activity_log").select("*").eq("tenant_id", t).order("at", { ascending: false }).limit(50),
      sb.from("ad_accounts").select("platform,last_synced_at,status").eq("tenant_id", t)
    ]).then(function (r) {
      ["monthly", "sources", "ads", "fees", "deals", "proposals", "quotes", "payments", "activity", "adAccounts"].forEach(function (k, i) { state[k] = r[i].data || []; });
    });
  }

  /* ---------------------------------------------------------- rendering */
  function cur() { return state.tenant.currency; }
  function monthRow(m) { return state.monthly.find(function (x) { return x.month === m; }) || {}; }
  function prevMonth(m) { var i = state.monthly.findIndex(function (x) { return x.month === m; }); return i > 0 ? state.monthly[i - 1] : null; }

  function kpi(label, value, prev, fmt, lowerIsBetter, note) {
    var delta = "";
    if (prev != null && value != null && !isNaN(prev) && Number(prev) !== 0) {
      var ch = (Number(value) - Number(prev)) / Math.abs(Number(prev)) * 100, good = lowerIsBetter ? ch < 0 : ch > 0;
      delta = '<span class="delta ' + (Math.abs(ch) < 0.5 ? "flat" : good ? "up" : "down") + '">' + (ch > 0 ? "+" : "") + ch.toFixed(0) + "% vs last month</span>";
    } else delta = '<span class="delta flat">No earlier month to compare</span>';
    return '<div class="kpi"><span class="muted">' + label + "</span><b>" + fmt(value) + "</b>" + delta + (note ? '<span class="hint">' + note + "</span>" : "") + "</div>";
  }

  function renderOverview() {
    var m = monthRow(state.month), p = prevMonth(state.month) || {}, c = cur(), mon = function (v) { return RP.money(v, c); };
    $("kpis").innerHTML = [
      kpi("Qualified leads", m.qualified_leads, p.qualified_leads, RP.num),
      kpi("Meetings held", m.meetings_held, p.meetings_held, RP.num),
      kpi("Cost per meeting held", m.cost_per_meeting, p.cost_per_meeting, mon, true, "Our fees plus ad spend, divided by meetings held"),
      kpi("Open pipeline", m.open_pipeline, p.open_pipeline, mon),
      kpi("Revenue from won deals", m.won_revenue, p.won_revenue, mon),
      kpi("Return on investment", m.roi_pct, p.roi_pct, RP.pct, false, "Won revenue minus total cost, divided by total cost")
    ].join("");
    var last = state.monthly.slice(-6), max = Math.max.apply(null, last.map(function (x) { return Math.max(x.qualified_leads || 0, x.meetings_held || 0); }).concat([1]));
    $("trend").innerHTML = '<div class="legend"><span><i class="ready"></i>Qualified leads</span><span><i class="warm"></i>Meetings held</span></div>' +
      last.map(function (x) {
        return '<div class="bar-row"><span class="mono">' + RP.monthLabel(x.month).slice(0, 3) + '</span><div class="bar-pair">' +
          '<div class="bar"><i class="ready" style="width:' + (100 * (x.qualified_leads || 0) / max) + '%"></i></div><span class="mono">' + RP.num(x.qualified_leads) + "</span>" +
          '<div class="bar"><i class="warm" style="width:' + (100 * (x.meetings_held || 0) / max) + '%"></i></div><span class="mono">' + RP.num(x.meetings_held) + "</span></div></div>";
      }).join("");
  }

  function renderFunnel() {
    var m = monthRow(state.month);
    var steps = [["Emails delivered", m.emails_delivered], ["Replies", m.replies], ["Interested replies", m.positive_replies], ["Meetings booked", m.meetings_booked], ["Meetings held", m.meetings_held], ["Deals won", m.deals_won]];
    var top = steps[0][1] || 1;
    $("funnel").innerHTML = steps.map(function (s, i) {
      var prev = i ? steps[i - 1][1] : null, share = prev ? " · " + RP.pct(100 * (s[1] || 0) / prev) + " of previous step" : "";
      return '<div class="f-row"><span>' + s[0] + '</span><div class="bar"><i class="ready" style="width:' + Math.max(2, 100 * (s[1] || 0) / top) + '%"></i></div><span class="mono">' + RP.num(s[1]) + '<span class="hint">' + share + "</span></span></div>";
    }).join("");
    var icp = m.icp_match_pct;
    $("icp").innerHTML = '<p class="muted">Share of contacted companies that match the ideal customer description you agreed with us.</p>' +
      '<div class="f-row"><span>Ideal customer match</span><div class="bar"><i class="ready" style="width:' + (icp || 0) + '%"></i></div><span class="mono">' + RP.pct(icp) + "</span></div>" +
      '<p class="hint">' + (icp == null ? "Not measured this month." : icp >= 80 ? "On target: 80% or more." : "Below our 80% target. We are tightening the targeting.") + "</p>";
    var model = { first_touch: "first touch", last_touch: "last touch", linear: "equal credit to every touch" }[state.tenant.attribution_model] || "first touch";
    $("attrTitle").textContent = "Leads by source (attribution: " + model + ")";
    $("sources").innerHTML = RP.table([{ key: "source", label: "Source" }, { key: "leads", label: "Leads", num: true }, { key: "qualified", label: "Qualified", num: true },
      { label: "Won revenue", num: true, render: function (r) { return RP.money(r.won_revenue, cur()); } }], state.sources);
  }

  function renderAds() {
    var mm = state.month.slice(0, 7), by = {};
    state.ads.filter(function (r) { return String(r.day).slice(0, 7) === mm; }).forEach(function (r) {
      var b = by[r.platform] = by[r.platform] || { platform: r.platform, spend: 0, impressions: 0, clicks: 0, conversions: 0 };
      b.spend += Number(r.spend); b.impressions += Number(r.impressions); b.clicks += Number(r.clicks); b.conversions += Number(r.conversions);
    });
    var names = { google_ads: "Google Ads", meta: "Meta (Facebook and Instagram)", linkedin: "LinkedIn" };
    var rows = Object.keys(by).map(function (k) { return by[k]; });
    $("adsTable").innerHTML = RP.table([
      { label: "Platform", render: function (r) { return names[r.platform] || r.platform; } },
      { label: "Spend", num: true, render: function (r) { return RP.money(r.spend, cur()); } },
      { label: "Impressions", num: true, render: function (r) { return RP.num(r.impressions); } },
      { label: "Clicks", num: true, render: function (r) { return RP.num(r.clicks); } },
      { label: "Click rate", num: true, render: function (r) { return r.impressions ? RP.pct(100 * r.clicks / r.impressions) : "–"; } },
      { label: "Leads from ads", num: true, render: function (r) { return RP.num(r.conversions); } },
      { label: "Cost per lead", num: true, render: function (r) { return r.conversions ? RP.money(r.spend / r.conversions, cur()) : "–"; } }
    ], rows, { empty: "No ad accounts are connected for this month." });
  }

  function renderValue() {
    var m = monthRow(state.month), c = cur(), mon = function (v) { return RP.money(v, c); };
    var all = state.monthly.reduce(function (a, x) { a.cost += Number(x.total_cost || 0); a.won += Number(x.won_revenue || 0); a.fees += Number(x.fees || 0); a.ads += Number(x.ad_spend || 0); return a; }, { cost: 0, won: 0, fees: 0, ads: 0 });
    $("valueKpis").innerHTML =
      '<div class="kpi"><span class="muted">Our fees this month</span><b>' + mon(m.fees) + "</b></div>" +
      '<div class="kpi"><span class="muted">Your ad spend this month</span><b>' + mon(m.ad_spend) + "</b></div>" +
      '<div class="kpi"><span class="muted">Revenue from won deals this month</span><b>' + mon(m.won_revenue) + "</b></div>" +
      '<div class="kpi"><span class="muted">Total cost since the start</span><b>' + mon(all.cost) + '</b><span class="hint">Fees ' + mon(all.fees) + " + ad spend " + mon(all.ads) + "</span></div>" +
      '<div class="kpi"><span class="muted">Won revenue since the start</span><b>' + mon(all.won) + "</b></div>" +
      '<div class="kpi"><span class="muted">Return since the start</span><b>' + (all.cost ? RP.pct(100 * (all.won - all.cost) / all.cost) : "–") + '</b><span class="hint">Each 1 spent returned ' + (all.cost ? (all.won / all.cost).toFixed(1) : "–") + " in won revenue</span></div>";
    var labels = { setup: "Setup", retainer: "Monthly fee", performance: "Performance fee", quote: "Customisation" };
    $("feesTable").innerHTML = RP.table([{ label: "Month", render: function (r) { return RP.monthLabel(String(r.month).slice(0, 10)); } }, { label: "Fee", render: function (r) { return labels[r.type] || r.type; } },
      { key: "note", label: "What it covers" }, { label: "Amount", num: true, render: function (r) { return RP.money(r.amount, c); } }], state.fees.slice().reverse(), { empty: "No fees recorded yet." });
  }

  function renderDeals() {
    var owner = state.role === "owner", stages = ["meeting", "proposal", "negotiation", "won", "lost"];
    $("dealsHelp").textContent = owner ? "You can update the stage and value of each deal. Keeping them current makes your revenue and return accurate." : "Your company's account owner can update deal stages and values.";
    $("dealsTable").innerHTML = RP.table([{ key: "name", label: "Deal" }, { key: "source", label: "Source" },
      { label: "Stage", render: function (r) { return owner ? '<select data-deal="' + r.id + '" data-f="stage" aria-label="Stage for ' + RP.esc(r.name) + '">' + stages.map(function (s) { return "<option" + (s === r.stage ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select>" : RP.badge(r.stage); } },
      { label: "Value", num: true, render: function (r) { return owner ? '<input type="number" min="0" step="1000" value="' + Number(r.value) + '" data-deal="' + r.id + '" data-f="value" aria-label="Value for ' + RP.esc(r.name) + '">' : RP.money(r.value, cur()); } }
    ], state.deals, { empty: "Deals appear here after your first meetings." });
  }

  function renderQuotes() {
    var c = cur(), owner = state.role === "owner";
    var html = state.proposals.map(function (p) {
      return '<div class="formbox"><div class="price-head flush"><h3>' + (p.kind === "pre" ? "Pre-proposal" : "Proposal") + ": " + (p.plan === "sprint" ? "Revive Sprint" : "Monthly engine") + ", " + RP.esc(p.package) + "</h3>" + RP.badge(p.status) + "</div>" +
        "<p>Fixed-scope price " + RP.money(p.fixed_amount, c) + ". Advance " + RP.money(p.advance_amount, c) + (p.paid_at ? ", paid on " + RP.date(p.paid_at) : "") + ".</p>" +
        (p.access_token ? '<a class="link" href="/p/' + p.access_token + '">Open the proposal' + RP.icon("arrow_forward") + "</a>" : "") + "</div>";
    }).join("");
    html += state.quotes.map(function (q) {
      var items = (q.items || []).map(function (i) { return "<tr><td>" + RP.esc(i.description) + '</td><td class="r mono">' + RP.num(i.quantity) + '</td><td class="r mono">' + RP.money(i.unit_price, c) + "</td></tr>"; }).join("");
      return '<div class="formbox"><div class="price-head flush"><h3>Quotation for customisations</h3>' + RP.badge(q.status) + "</div>" +
        '<div class="table-wrap flush"><table class="text"><thead><tr><th>Item</th><th class="r">Quantity</th><th class="r">Price</th></tr></thead><tbody>' + items + "</tbody></table></div>" +
        "<p><strong>Total " + RP.money(q.total, c) + "</strong>. Prices exclude " + (c === "AED" ? "VAT" : "GST") + ".</p>" +
        (q.status === "sent" && owner ? '<button class="btn btn-dark" type="button" data-accept="' + q.id + '">Accept and pay' + RP.icon("arrow_forward") + '</button><p class="err" data-qerr="' + q.id + '"></p>' : "") + "</div>";
    }).join("");
    html += '<div class="stack"><h3>Payments</h3><div class="table-wrap flush">' + RP.table([{ label: "Date", render: function (r) { return RP.date(r.created_at); } }, { key: "purpose", label: "For" },
      { label: "Status", render: function (r) { return RP.badge(r.status); } }, { label: "Amount", num: true, render: function (r) { return RP.money(r.amount, r.currency); } }], state.payments, { empty: "No payments yet." }) + "</div></div>";
    $("quotesList").innerHTML = html;
  }

  function renderActivity() {
    var icons = { note: "chat", change: "tune", milestone: "flag", alert: "warning" };
    $("activity").innerHTML = state.activity.length ? state.activity.map(function (a) {
      return '<div class="tl"><b>' + RP.date(a.at) + '</b><div class="stack sm"><span class="kicker">' + RP.icon(icons[a.kind] || "chat") + " " + RP.esc(a.kind) + "</span><p>" + RP.esc(a.message) + "</p></div></div>";
    }).join("") : '<p class="muted pad">Updates from our team will appear here.</p>';
  }

  function renderAll() {
    $("tenantName").textContent = state.tenant.name;
    $("tenantPlan").textContent = (state.tenant.plan === "sprint" ? "Revive Sprint" : "Monthly engine") + " · " + state.tenant.package + " · " + (state.role === "owner" ? "Account owner" : "Viewer");
    var synced = state.adAccounts.map(function (a) { return a.last_synced_at; }).filter(Boolean).sort().pop();
    $("freshness").textContent = "Outreach and deals update live. Ad data last updated " + (synced ? RP.dateTime(synced) : "when you connect an ad account") + ".";
    renderOverview(); renderFunnel(); renderAds(); renderValue(); renderDeals(); renderQuotes(); renderActivity();
  }

  function fillMonths() {
    var sel = $("monthSelect"), months = state.monthly.map(function (m) { return m.month; });
    sel.innerHTML = months.slice().reverse().map(function (m) { return '<option value="' + m + '">' + RP.monthLabel(m) + "</option>"; }).join("");
    state.month = months[months.length - 1];
  }

  /* ---------------------------------------------------------- events */
  document.addEventListener("change", function (e) {
    if (e.target.id === "monthSelect") { state.month = e.target.value; renderAll(); }
    if (e.target.id === "tenantSelect") { pick(e.target.value); }
    var id = e.target.dataset && e.target.dataset.deal;
    if (id) {
      var f = e.target.dataset.f, val = f === "value" ? Number(e.target.value) : e.target.value, patch = {}; patch[f] = val;
      if (f === "stage" && (val === "won" || val === "lost")) patch.closed_at = new Date().toISOString().slice(0, 10);
      var d = state.deals.find(function (x) { return x.id === id; }); Object.assign(d, patch);
      if (!RP.demo) RP.sb.from("deals").update(patch).eq("id", id).then(function (r) { if (r.error) $("dealsHelp").textContent = "We could not save that change. Please refresh the page and try again."; else load(state.tenant.id).then(renderAll); });
    }
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-accept]"); if (!b) return;
    var errEl = document.querySelector('[data-qerr="' + b.dataset.accept + '"]');
    RP.api("/api/portal/quotes/" + b.dataset.accept + "/accept").then(function (j) { location.href = j.payment_url; })
      .catch(function (err) { errEl.textContent = err.message; });
  });

  function pick(tenantId) {
    state.tenant = state.tenants.find(function (t) { return t.id === tenantId; });
    state.role = state.tenant._role || "viewer";
    return load(tenantId).then(function () { fillMonths(); renderAll(); });
  }

  RP.auth(function (user) {
    RP.tabs();
    if (RP.demo) { demoData(); fillMonths(); renderAll(); return; }
    RP.api("/api/portal/accept-invites").then(function () {
      return RP.sb.from("memberships").select("role, tenants(*)").eq("user_id", user.id);
    }).then(function (r) {
      if (r.error) throw r.error;
      var rows = r.data || [];
      if (!rows.length) {
        $("tenantName").textContent = "Your account is not linked to a company yet";
        $("freshness").textContent = "Ask us to invite " + user.email + ", then refresh this page.";
        document.querySelectorAll("[data-panel]").forEach(function (p) { p.hidden = true; });
        return;
      }
      state.tenants = rows.map(function (x) { var t = x.tenants; t._role = x.role; return t; });
      if (state.tenants.length > 1) {
        $("tenantSelect").hidden = false; $("tenantSelectLabel").hidden = false;
        $("tenantSelect").innerHTML = state.tenants.map(function (t) { return '<option value="' + t.id + '">' + RP.esc(t.name) + "</option>"; }).join("");
      }
      pick(state.tenants[0].id);
    }).catch(function () {
      $("tenantName").textContent = "We could not check your account";
      $("freshness").textContent = "Please refresh this page, or contact Ripe Piper if the issue continues.";
      document.querySelectorAll("[data-panel]").forEach(function (p) { p.hidden = true; });
    });
  });
})();
