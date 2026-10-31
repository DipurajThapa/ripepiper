/* Admin area: leads, meetings (AI notes and minutes), proposals and quotations, client accounts, blog CMS.
   Only users with profiles.is_admin = true can read or change anything (enforced by row-level security). */
(function () {
  "use strict";
  var RP = window.RP, $ = function (id) { return document.getElementById(id); };
  var data = { leads: [], meetings: [], proposals: [], tenants: [], posts: [] };
  var cur = { meeting: null, proposal: null, tenant: null, post: null };
  var viewState = { loadedAt: null, partial: {}, limits: {leads:300,meetings:200,proposals:200,tenants:1000,posts:200}, error: false };
  var fetchGeneration = 0, shellWired = false;

  function renderDashboard() {
    var target = $("crmOverview");
    if (!target || !RP.crmDashboard) return;
    target.setAttribute("aria-busy", "false");
    if (viewState.error) { target.innerHTML = '<div class="crm-card"><h3>Workspace data is unavailable</h3><p>Use Refresh data to try again. Counts are not shown because the latest read could not be verified.</p></div>'; return; }
    RP.crmDashboard.render(target, data, {demo:RP.demo,loadedAt:viewState.loadedAt,partial:viewState.partial,limits:viewState.limits,now:Date.now()});
  }
  function dataStatus(message, state) {
    var node = $("crmDataStatus"); if (node) { node.textContent=message;node.dataset.state=state; }
  }
  function showSection(name, focus) {
    var titles={overview:"Overview",leads:"Inquiries",meetings:"Meetings",proposals:"Proposals",clients:"Clients",blog:"Content"};
    if (!Object.hasOwn(titles,name)) name="overview";
    document.querySelectorAll("[data-tab]").forEach(function(a){a.setAttribute("aria-current",a.dataset.tab===name?"page":"false");});
    document.querySelectorAll("[data-panel]").forEach(function(panel){panel.hidden=panel.dataset.panel!==name;});
    if ($("crmTitle")) { $("crmTitle").textContent=titles[name];if(focus)$("crmTitle").focus(); }
  }
  function showWorkspace(name) {
    var names=["account","brief","setup","campaigns","signal","events"];if(names.indexOf(name)===-1)return;
    document.querySelectorAll("[data-workspace]").forEach(function(button){button.setAttribute("aria-pressed",button.dataset.workspace===name?"true":"false");});
    document.querySelectorAll("[data-workspace-panel]").forEach(function(panel){panel.hidden=panel.dataset.workspacePanel!==name;});
  }
  function wireShell() {
    if(shellWired)return;shellWired=true;
    if ($("crmNavigation")) $("crmNavigation").hidden=false;
    if ($("crmRefresh")) $("crmRefresh").addEventListener("click",function(){
      if(RP.demo){dataStatus("Sample records refreshed. No live data connection.","sample");renderDashboard();return;}
      fetchAll().then(renderAll).catch(function(){});
    });
    document.addEventListener("click",function(e){
      var link=e.target.closest("[data-tab],[data-crm-go]");
      if(link){e.preventDefault();var name=link.dataset.tab||link.dataset.crmGo;if(location.hash!=="#"+name)history.pushState(null,"","#"+name);showSection(name,true);return;}
      var step=e.target.closest("[data-workspace]");if(step)showWorkspace(step.dataset.workspace);
    });
    function restore(){showSection(location.hash.slice(1)||"overview",false);}
    window.addEventListener("hashchange",restore);window.addEventListener("popstate",restore);
    window.addEventListener("rp:tenant-selected",function(e){if($("crmClientName"))$("crmClientName").textContent=e.detail.name;showWorkspace("account");});
    restore();
  }

  function demo() {
    data.leads = [
      { id: "l1", created_at: "2026-10-19T06:12:00Z", name: "Sara Khan", email: "sara@gulfinteriors.ae", company: "gulfinteriors.ae", country: "AE", package_interest: "revive", deal_band: 2, score: 85, status: "meeting_booked", utm_source: "linkedin" },
      { id: "l2", created_at: "2026-10-18T10:40:00Z", name: "Raj Mehta", email: "raj@punetech.in", company: "punetech.in", country: "IN", package_interest: "signal", deal_band: 1, score: 70, status: "qualified", utm_source: "google" },
      { id: "l3", created_at: "2026-10-17T15:05:00Z", name: "Omar Ali", email: "omar@smallprint.ae", company: "smallprint.ae", country: "AE", package_interest: "unsure", deal_band: 0, score: 40, status: "not_fit", utm_source: "" }];
    data.meetings = [{ id: "m1", start_at: "2026-10-20T06:00:00Z", end_at: "2026-10-20T06:15:00Z", attendee_name: "Sara Khan", attendee_email: "sara@gulfinteriors.ae", status: "held", meet_url: "https://meet.google.com/abc-defg-hij", lead_id: "l1",
      notes: { summary: "Gulf Interiors has about 900 unanswered quotes from the last 18 months and no one assigned to follow up.", pains: ["Quotes are not followed up after the first week", "Sales team spends its time on site visits"], goals: ["Restart conversations with past quotes", "Book 10 site surveys per month"], budget: "Not discussed", timeline: "Wants to start in November", decision_makers: ["Sara Khan, Managing Director"], objections: ["Worried about emailing old clients too often"] },
      requirements: { recommended_plan: "sprint", recommended_package: "revive", icp: "Companies in Dubai and Abu Dhabi that requested an office fit-out quote", markets: ["UAE"], customisations: ["Arabic versions of the messages"], risks: ["Some quote contacts may have left their companies"] },
      minutes: "# Minutes: Call with Sara Khan\n\nDate: 2026-10-20\n\n## Decisions\n- Start with a 14-day Revive sprint on the past quotes.\n\n## Actions\n- Sara to export past quotes from Zoho (owner: Sara Khan, due: 22 Oct)\n- Ripe Piper to send the pre-proposal (owner: Ripe Piper, due: 21 Oct)\n" },
      { id: "m2", start_at: "2026-10-22T07:00:00Z", end_at: "2026-10-22T07:15:00Z", attendee_name: "Raj Mehta", attendee_email: "raj@punetech.in", status: "booked", meet_url: "https://meet.google.com/xyz-abcd-efg", lead_id: "l2" }];
    data.proposals = [{ id: "p1", created_at: "2026-10-20T09:00:00Z", kind: "pre", plan: "sprint", package: "revive", currency: "AED", fixed_amount: 3500, advance_pct: 10, advance_amount: 350, status: "draft", client_email: "sara@gulfinteriors.ae",
      content_md: "# Pre-proposal for Gulf Interiors\n\n## Your situation\nGulf Interiors has about 900 office fit-out quotes from the last 18 months that were not followed up.\n\n## What we will do\nWe will contact every past quote with a short message about their project and book interested companies for a site survey.\n\n## Price and advance\n| Item | Amount |\n|---|---|\n| Ripe Revive 14-day sprint | AED 3,500 |\n| **Advance to start (10%)** | **AED 350** |\n" }];
    data.tenants = [{ id: "t1", name: "Gulf Interiors LLC", slug: "gulf-interiors", country: "AE", currency: "AED", plan: "engine", package: "signal", status: "active" }];
    data.posts = [{ id: "b1", slug: "reactivate-old-b2b-leads", title: "How to reactivate old B2B leads: a 14-day method", description: "A step-by-step method to turn old B2B inquiries and unanswered quotes into sales meetings in 14 days.", body_md: "## Why old leads are worth contacting\nAn old lead is a person who once asked about your service.", status: "published", published_at: "2026-10-19T00:00:00Z", cover_path: "/img/guide-reactivate.jpg", cover_alt: "A notebook, pen and coffee cup on a desk", updated_at: "2026-10-19T00:00:00Z" }];
  }

  function fetchAll() {
    var sb = RP.sb, ticket=++fetchGeneration, keys=["leads","meetings","proposals","tenants","posts"];
    if($("crmRefresh"))$("crmRefresh").disabled=true;
    if($("crmOverview"))$("crmOverview").setAttribute("aria-busy","true");
    dataStatus(viewState.loadedAt?"Refreshing records. Previous snapshot remains visible until the read completes.":"Loading CRM records…","loading");
    return Promise.all([
      sb.from("leads").select("*",{count:"exact"}).is("tenant_id", null).order("created_at", { ascending: false }).limit(viewState.limits.leads),
      sb.from("meetings").select("*",{count:"exact"}).is("tenant_id", null).order("start_at", { ascending: false }).limit(viewState.limits.meetings),
      sb.from("proposals").select("*",{count:"exact"}).order("created_at", { ascending: false }).limit(viewState.limits.proposals),
      sb.from("tenants").select("*",{count:"exact"}).order("name").limit(viewState.limits.tenants),
      sb.from("posts").select("*",{count:"exact"}).order("updated_at", { ascending: false }).limit(viewState.limits.posts)
    ]).then(function(results){
      if(ticket!==fetchGeneration)throw Error("A newer CRM refresh is in progress.");
      if(results.some(function(r){return !r||r.error||!Array.isArray(r.data)||r.data.some(function(row){return !row||typeof row!=="object"||Array.isArray(row);});}))throw Error("CRM records could not be loaded. Refresh data to try again.");
      var partial={};keys.forEach(function(k,i){var r=results[i];partial[k]=!Number.isInteger(r.count)||r.count!==r.data.length;});
      keys.forEach(function(k,i){data[k]=results[i].data;});viewState.partial=partial;viewState.loadedAt=new Date().toISOString();viewState.error=false;
      dataStatus("Connected records · Updated "+new Date(viewState.loadedAt).toLocaleTimeString("en-GB")+" (your browser time). "+(keys.some(function(k){return partial[k];})?"Limited snapshot: one or more lists are incomplete or their totals are unavailable. Counts use loaded records only.":"Counts use the records loaded in this workspace."),"ready");
      renderDashboard();
    }).catch(function(error){
      if(ticket===fetchGeneration){viewState.error=true;dataStatus("Refresh failed. "+(viewState.loadedAt?"Tables may show the previous snapshot; review their records again before acting.":"No verified records are available.")+" Use Refresh data to retry.","error");renderDashboard();}
      throw error;
    }).finally(function(){if(ticket===fetchGeneration&&$("crmRefresh"))$("crmRefresh").disabled=false;});
  }

  function save(table, op, payload, match) {
    if (RP.demo) return Promise.resolve({ demo: true });
    var q = RP.sb.from(table);
    q = op === "insert" ? q.insert(payload) : op === "upsert" ? q.upsert(payload, match) : q.update(payload).eq("id", match);
    return q.then(function (r) { if (r.error) throw new Error(r.error.message); return r; });
  }
  function done(el, msg) { RP.ok(el, RP.demo ? msg + " (sample mode: not saved)" : msg); }

  /* ---------------------------------------------------------- leads */
  function renderLeads() {
    var f = $("leadFilter").value, search = $("leadSearch") ? $("leadSearch").value.trim().toLowerCase() : "", rows = data.leads.filter(function (l) { return (!f || l.status === f) && (!search || [l.name,l.email,l.company].some(function(v){return String(v||"").toLowerCase().includes(search);})); });
    if($("leadCount"))$("leadCount").textContent=rows.length+" of "+data.leads.length+" loaded inquiries"+(viewState.partial.leads?" · limited snapshot":"");
    var bands = ["< AED 10k", "AED 10k–50k", "AED 50k–250k", "> AED 250k"];
    $("leadsTable").innerHTML = RP.table([
      { label: "Received", render: function (l) { return RP.dateTime(l.created_at); } }, { label: "Name", render: function (l) { return RP.esc(l.name) + '<br><span class="hint">' + RP.esc(l.email) + "</span>"; } },
      { key: "company", label: "Company" }, { key: "package_interest", label: "Package" }, { label: "Deal size", render: function (l) { return bands[l.deal_band] || "–"; } },
      { key: "score", label: "Score", num: true }, { label: "Status", render: function (l) { return RP.badge(l.status); } }, { label: "Source", render: function (l) { return RP.esc(l.utm_source || "direct"); } }
    ], rows, { empty: "No leads match this filter." });
  }

  /* ---------------------------------------------------------- meetings */
  function renderMeetings() {
    $("meetingsTable").innerHTML = RP.table([{ label: "When", render: function (m) { return RP.dateTime(m.start_at); } }, { label: "With", render: function (m) { return RP.esc(m.attendee_name || m.attendee_email); } },
      { label: "Status", render: function (m) { return RP.badge(m.attendance_review && m.attendance_review.state === "needs_review" ? "Attendance review required" : ((!m.attendance_review && (m.status === "held" || m.status === "no_show")) ? m.status + " (unverified)" : (m.status === "booked" && !m.meet_url ? "Calendar review required" : m.status))); } }, { label: "Notes", render: function (m) { return m.notes ? "Ready" : "–"; } }], data.meetings, { clickable: true, empty: "No meetings booked yet." });
  }
  function list(xs) { return xs && xs.length ? "<ul>" + xs.map(function (x) { return "<li>" + RP.esc(x) + "</li>"; }).join("") + "</ul>" : '<p class="muted">Not discussed.</p>'; }
  var meetingReviewGeneration = 0;
  function meetingDetail(m) {
    var reviewTicket = ++meetingReviewGeneration;
    cur.meeting = m;
    var n = m.notes, q = m.requirements, h = '<h3>' + RP.esc(m.attendee_name || m.attendee_email) + "</h3><p class=\"muted\">" + RP.dateTime(m.start_at) + " · " + RP.badge(m.status === "attendance_unknown" ? "Attendance unknown" : m.status) + (m.meet_url ? ' · <a href="' + RP.esc(m.meet_url) + '" rel="noopener">Meet link</a>' : "") + "</p>";
    if (m.status === "booked") {
      h += (m.meet_url ? '' : '<p>The time remains reserved. Check Google Calendar confirmation before changing this booking.</p>') + '<button class="btn btn-line" type="button" id="reconcileBooking">Check calendar confirmation</button><p id="calendarReview" role="status"></p>';
    }
    if (n) {
      h += '<div class="prose"><h3>Summary</h3><p>' + RP.esc(n.summary) + "</p><h3>Pains</h3>" + list(n.pains) + "<h3>Goals</h3>" + list(n.goals) +
        "<p><strong>Budget:</strong> " + RP.esc(n.budget) + "<br><strong>Timeline:</strong> " + RP.esc(n.timeline) + "</p><h3>Decision makers</h3>" + list(n.decision_makers) + "<h3>Objections</h3>" + list(n.objections) +
        "<h3>Requirements</h3><p>Recommended: <strong>" + RP.esc(q.recommended_plan) + ", " + RP.esc(q.recommended_package) + "</strong>. Ideal customer: " + RP.esc(q.icp) + "</p><h3>Customisations to quote</h3>" + list(q.customisations) +
        "<h3>Minutes</h3>" + RP.markdown(m.minutes || "") + "</div>";
      h += '<form id="draftForm" class="stack"><span class="kicker">Draft the pre-proposal</span><div class="form-grid">' +
        '<div class="field"><label for="dCur">Currency</label><select id="dCur"><option value="">Auto (from lead country)</option><option>AED</option><option>INR</option></select></div>' +
        '<div class="field"><label for="dPlan">Plan</label><select id="dPlan"><option value="sprint">Revive Sprint</option><option value="engine">Monthly engine</option></select></div>' +
        '<div class="field"><label for="dPkg">Package</label><select id="dPkg"><option>revive</option><option>signal</option><option>response</option><option>events</option></select></div>' +
        '<label class="consent"><input type="checkbox" id="dEvent"><span>Single event only (Ripe Events)</span></label></div>' +
        '<button class="btn btn-dark" type="submit">Create pre-proposal draft</button><p class="err" id="dErr"></p><div id="dOk" hidden></div></form>';
    } else {
      h += '<p>Draft notes can be prepared after the call if transcription was on. Notes do not verify attendee identity or attendance.</p>' +
        '<button class="btn btn-dark" type="button" id="fetchTranscript">Get transcript and create notes now</button>' +
        '<div class="field"><label for="pasteT">Or paste the transcript or your own notes</label><textarea id="pasteT" class="editor"></textarea></div>' +
        '<button class="btn btn-line" type="button" id="useT">Create notes from this text</button><p class="err" id="tErr"></p><div id="tOk" hidden></div>';
    }
    h += '<button class="btn btn-line" type="button" id="inspectReminders">Inspect reminder receipts</button><p id="reminderInspection" role="status"></p>';
    if (RP.consultationReviewMarkup) h += RP.consultationReviewMarkup(m);
    $("meetingDetail").innerHTML = h;
    if (RP.wireConsultationReview) RP.wireConsultationReview(m, function () { return fetchAll().then(function () { renderMeetings(); if (cur.meeting && cur.meeting.id === m.id) meetingDetail(data.meetings.find(function (x) { return x.id === m.id; }) || m); }); });
    var inspectReminders = $("inspectReminders");
    inspectReminders.addEventListener("click", function () {
      var result = $("reminderInspection"), meetingId = m.id;
      if (RP.demo || !RP.sb) { result.textContent = "Receipt inspection requires the connected admin site."; return; }
      inspectReminders.disabled = true; result.textContent = "Reading recorded attempts…";
      RP.api("/api/admin/meetings/" + meetingId + "/reminder-receipts", undefined, "GET").then(function (j) {
        if (reviewTicket !== meetingReviewGeneration || !cur.meeting || cur.meeting.id !== meetingId) return;
        if (j.version !== 1 || j.meetingId !== meetingId || j.canRetry !== false || !Array.isArray(j.receipts) || j.receipts.length !== 2) throw new Error("Receipt inspection unavailable.");
        result.textContent = j.receipts.map(function (r) { return r.window + ": " + (r.state === "absent" ? "No recorded attempt" : r.state + (r.requiresReview ? " — needs operator review" : "")) + (r.acknowledgedAt ? " · provider acknowledged " + RP.dateTime(r.acknowledgedAt) : "") + (r.providerMessageId ? " · receipt " + r.providerMessageId : ""); }).join(". ") + ". Provider acknowledgement does not prove delivery. Inspection does not retry or send.";
      }).catch(function (e) {
        if (reviewTicket === meetingReviewGeneration && cur.meeting && cur.meeting.id === meetingId) result.textContent = e.message;
      }).finally(function () { if (reviewTicket === meetingReviewGeneration) inspectReminders.disabled = false; });
    });
    var reconcile = $("reconcileBooking");
    if (reconcile) reconcile.addEventListener("click", function () {
      var meetingId = m.id, result = $("calendarReview");
      if (RP.demo || !RP.sb) { result.textContent = "Calendar reconciliation requires the connected admin site."; return; }
      reconcile.disabled = true;
      RP.api("/api/admin/meetings/" + meetingId + "/reconcile", {})
        .then(function () { return fetchAll(); })
        .then(function () { renderMeetings(); if (cur.meeting && cur.meeting.id === meetingId) meetingDetail(data.meetings.find(function (x) { return x.id === meetingId; }) || m); })
        .catch(function (e) { result.textContent = e.message; reconcile.disabled = false; });
    });
    if (q) { $("dPlan").value = q.recommended_plan; $("dPkg").value = q.recommended_package; }
  }
  function processMeeting(transcript) {
    $("tErr").textContent = "";
    RP.api("/api/admin/meetings/" + cur.meeting.id + "/process", transcript ? { transcript: transcript } : {})
      .then(function () { return fetchAll(); }).then(function () { renderMeetings(); meetingDetail(data.meetings.find(function (x) { return x.id === cur.meeting.id; })); })
      .catch(function (e) { $("tErr").textContent = e.message; });
  }

  /* ---------------------------------------------------------- proposals and quotations */
  function renderProposals() {
    $("proposalsTable").innerHTML = RP.table([{ label: "Created", render: function (p) { return RP.date(p.created_at); } }, { key: "client_email", label: "Client" },
      { label: "Plan", render: function (p) { return RP.esc(p.plan + ", " + p.package); } }, { label: "Advance", num: true, render: function (p) { return RP.money(p.advance_amount, p.currency); } },
      { label: "Status", render: function (p) { return RP.badge(p.status); } }], data.proposals, { clickable: true, empty: "No proposals yet. Create one from a meeting." });
  }
  function proposalDetail(p) {
    cur.proposal = p;
    var paymentGeneration = proposalDetail.paymentGeneration = (proposalDetail.paymentGeneration || 0) + 1;
    var editable = p.status === "draft";
    var h = "<h3>" + RP.esc(p.client_email) + "</h3><p class=\"muted\">Fixed-scope price " + RP.money(p.fixed_amount, p.currency) + " · advance " + p.advance_pct + "% = " + RP.money(p.advance_amount, p.currency) + " · " + RP.badge(p.status) + "</p>";
    if (editable) h += '<div class="field"><label for="propMd">Pre-proposal text (Markdown)</label><textarea id="propMd" class="editor">' + RP.esc(p.content_md) + '</textarea><span class="hint">Edit the wording if needed. Do not change the price table; prices come from the price list.</span></div>' +
      '<div class="hero-actions"><button class="btn btn-line" type="button" id="propSave">Save changes</button><button class="btn btn-dark" type="button" id="propSend">Send to client</button></div>';
    h += '<p class="err" id="propErr"></p><div id="propOk" hidden></div><div class="stack sm"><span class="kicker">Preview</span><div class="prose preview" id="propPreview">' + RP.markdown(p.content_md) + "</div></div>";
    if (p.status === "paid") {
      h += '<form id="quoteForm" class="stack"><span class="kicker">Quotation for customisations</span><div id="qItems"></div>' +
        '<button class="btn btn-line" type="button" id="qAdd">Add an item</button><p><strong>Total: <span id="qTotal">' + RP.money(0, p.currency) + "</span></strong> (calculated again on the server)</p>" +
        '<button class="btn btn-dark" type="submit">Create and send quotation</button><p class="err" id="qErr"></p><div id="qOk" hidden></div></form>';
    }
    h += '<div class="stack sm"><span class="kicker">Payment review</span><p>Inspect the recorded checkout and held notification references. This check cannot send, replace or retry a payment or notification.</p>' +
      '<button class="btn btn-line" type="button" id="propPaymentsLoad">Load payment records</button><div class="field"><label for="propPayment">Payment record (latest 20)</label><select id="propPayment" disabled><option value="">Load records for this proposal</option></select></div>' +
      '<button class="btn btn-line" type="button" id="propPaymentInspect" disabled>Check recorded payment</button><p id="propPaymentReview" role="status" style="overflow-wrap:anywhere"></p></div>';
    $("proposalDetail").innerHTML = h;
    if (p.status === "paid") addQuoteItem();
    var load = $("propPaymentsLoad"), select = $("propPayment"), inspect = $("propPaymentInspect"), result = $("propPaymentReview");
    var records = [], loadVersion = 0, receiptVersion = 0;
    var uuid = function (id) { return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id); };
    var statuses = ["pending", "paid", "failed", "refunded"], reasons = ["unknown_target", "target_binding", "unregistered_reference", "financial_or_target_binding", "legacy_payload_requires_review", "legacy_or_refunded_requires_review", "target_not_open"];
    var active = function () { return cur.proposal && cur.proposal.id === p.id && proposalDetail.paymentGeneration === paymentGeneration; };
    var connected = function () { return !RP.demo && RP.sb && uuid(p.id); };
    function fail() {
      records = []; select.disabled = true; inspect.disabled = true;
      result.textContent = "Payment review is unavailable or its response could not be verified. No action was executed. Reload records for this proposal; an operator must check the provider before any replacement.";
    }
    if (!connected()) { load.disabled = true; result.textContent = "Payment review requires the connected admin site. Sample mode cannot load or inspect payment records."; }
    load.addEventListener("click", function () {
      if (!active() || !connected()) return;
      var version = ++loadVersion; receiptVersion++; records = []; load.disabled = true; select.disabled = true; inspect.disabled = true;
      result.textContent = "Loading payment records for this proposal…";
      RP.sb.from("payments").select("id,proposal_id,provider,status").eq("proposal_id", p.id).order("created_at", { ascending: false }).limit(20)
        .then(function (response) {
          if (!active() || version !== loadVersion) return;
          if (response.error || !Array.isArray(response.data) || response.data.length > 20 || response.data.some(function (row) { return !row || !uuid(row.id) || row.proposal_id !== p.id || !["stripe", "razorpay", "bank"].includes(row.provider) || !statuses.includes(row.status); }) || new Set(response.data.map(function (row) { return row.id; })).size !== response.data.length) throw new Error("Unverified payment list");
          records = response.data;
          select.innerHTML = '<option value="">Choose a payment record</option>' + records.map(function (row) { return '<option value="' + RP.esc(row.id) + '">' + RP.esc(row.provider + " · " + row.status + " · " + row.id) + '</option>'; }).join("");
          select.value = ""; select.disabled = !records.length;
          result.textContent = records.length ? "Choose a record, then check its recorded disposition. No provider call or send is made." : "No payment records were found for this proposal.";
        }).catch(function () { if (active() && version === loadVersion) fail(); })
        .finally(function () { if (active() && version === loadVersion) load.disabled = false; });
    });
    select.addEventListener("change", function () {
      if (!active()) return;
      receiptVersion++; result.textContent = ""; inspect.disabled = !connected() || !records.some(function (row) { return row.id === select.value; });
    });
    inspect.addEventListener("click", function () {
      var id = select.value;
      if (!active() || !connected() || inspect.disabled || !records.some(function (row) { return row.id === id; })) return;
      var version = ++receiptVersion; inspect.disabled = true; result.textContent = "Checking the recorded payment disposition…";
      RP.api("/api/admin/payments/" + id + "/receipt", {})
        .then(function (receipt) {
          if (!active() || version !== receiptVersion || select.value !== id) return;
          var n = receipt && receipt.notification_disposition, review = receipt && receipt.review_disposition;
          if (!receipt || receipt.payment_id !== id || receipt.proposal_id !== p.id || (receipt.quote_id !== null && !uuid(receipt.quote_id)) || !statuses.includes(receipt.status) || !["creating", "bound", "legacy_requires_review"].includes(receipt.checkout_phase) || (receipt.settled_at !== null && (typeof receipt.settled_at !== "string" || !/^\d{4}-\d\d-\d\dT/.test(receipt.settled_at) || !Number.isFinite(Date.parse(receipt.settled_at)))) ||
              (review !== null && (!review || review.state !== "human_review_required" || !reasons.includes(review.reason))) ||
              (n !== null && (!n || n.state !== "human_review_required" || n.automatic_delivery !== false || n.key !== "billing:" + id || n.client_purpose !== (receipt.quote_id ? "quote_paid" : "advance_received") || n.client_recipient_reference !== "proposal:" + p.id || n.admin_recipient_reference !== "configured_admin"))) throw new Error("Unverified payment receipt");
          var text = "Payment record " + id + ": " + receipt.status + ". Proposal reference: " + p.id + (receipt.quote_id ? "; quote reference: " + receipt.quote_id : "") + ". ";
          text += receipt.checkout_phase === "creating" ? "Checkout creation or binding is uncertain. " : receipt.checkout_phase === "bound" ? "Bound checkout is recorded. " : "Legacy payment requires reconciliation. ";
          if (review) text += "Rejected event held for human review: " + review.reason + ". ";
          text += n ? "Notification held for human review. Reference: " + n.key + "; recipient references: " + n.client_recipient_reference + " and " + n.admin_recipient_reference + ". " : "No verified notification disposition is recorded. ";
          result.textContent = text + "Check the existing provider checkout before any replacement. This inspection made no provider call and sent no notification.";
          inspect.disabled = false;
        }).catch(function () { if (active() && version === receiptVersion && select.value === id) fail(); });
    });
  }
  function addQuoteItem() {
    var i = $("qItems").children.length;
    var d = document.createElement("div"); d.className = "form-grid q-item";
    d.innerHTML = '<div class="field full"><label for="qd' + i + '">Description</label><input id="qd' + i + '" type="text" data-q="description"></div>' +
      '<div class="field"><label for="qq' + i + '">Quantity</label><input id="qq' + i + '" type="number" min="1" value="1" data-q="quantity"></div>' +
      '<div class="field"><label for="qp' + i + '">Unit price</label><input id="qp' + i + '" type="number" min="0" step="100" data-q="unit_price"></div>';
    $("qItems").appendChild(d);
  }
  function quoteItems() {
    return [].map.call(document.querySelectorAll(".q-item"), function (row) {
      var o = {}; row.querySelectorAll("[data-q]").forEach(function (inp) { o[inp.dataset.q] = inp.dataset.q === "description" ? inp.value.trim() : Number(inp.value); }); return o;
    }).filter(function (i) { return i.description; });
  }

  /* ---------------------------------------------------------- clients */
  function renderTenants() {
    $("tenantsTable").innerHTML = RP.table([{ key: "name", label: "Client" }, { key: "currency", label: "Currency" }, { label: "Plan", render: function (t) { return RP.esc(t.plan + ", " + t.package); } },
      { label: "Status", render: function (t) { return RP.badge(t.status); } }], data.tenants, { clickable: true, empty: "No client accounts yet. Prepare one after a consultation." });
  }
  function tenantDetail(t) {
    cur.tenant = t;
    window.dispatchEvent(new CustomEvent("rp:tenant-selected", { detail: { id: t.id, name: t.name } }));
    var today = new Date(), monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
    $("tenantDetail").innerHTML = "<h3>" + RP.esc(t.name) + "</h3>" +
      (["onboarding", "paused"].indexOf(t.status) !== -1 ? '<form class="stack" data-form="activate"><span class="kicker">' + (t.status === "paused" ? 'Resume account' : 'Activate prepared account') + '</span><p class="hint">Requires the current reviewed business brief. This changes account readiness only. Campaigns, contact rights, provider connections and unrelated stops are not resumed.</p><div class="form-grid"><div class="field"><label for="activationBriefVersion">Current brief version</label><input id="activationBriefVersion" type="number" min="1" readonly required placeholder="Loading current brief"></div><div class="field"><label for="activationReason">Reason for this decision</label><input id="activationReason" type="text" minlength="8" maxlength="500" required></div></div><button class="btn btn-dark" type="submit" id="activateAccount" disabled>' + (t.status === "paused" ? 'Resume account readiness' : 'Activate account readiness') + '</button><p class="hint" id="activationHint">' + (RP.demo ? 'Sample workspace: connect the verified application environment to activate an account.' : 'Loading the current brief…') + '</p><div data-ok hidden></div><p class="err" data-err></p></form>' : '') +
      (t.status === "paused" || t.status === "ended" ? '<p class="hint">This client is ' + RP.esc(t.status) + '. Campaign execution and connected ad reporting are stopped.</p>' :
      '<form class="stack" data-form="pause"><span class="kicker">Emergency stop</span><div class="field"><label for="pauseReason">Reason for pausing</label><input id="pauseReason" type="text" minlength="8" maxlength="500" required></div><button class="btn btn-line" type="submit">Pause client execution</button><div data-ok hidden></div><p class="err" data-err></p></form>') +
      (t.status === "paused" || t.status === "ended" ? '' :
      '<form class="stack" data-form="invite"><span class="kicker">Invite a person, or change the role of someone already invited</span><div class="form-grid"><div class="field"><label for="iEmail">Email (company email or Gmail)</label><input id="iEmail" type="email"></div>' +
      '<div class="field"><label for="iRole">Role</label><select id="iRole"><option value="owner">Owner: can update deals and accept quotations</option><option value="viewer">Viewer: read only</option></select></div></div><button class="btn btn-dark" type="submit">Save access</button><div data-ok hidden></div><p class="err" data-err></p></form>') +
      '<form class="stack" data-form="weekly"><span class="kicker">Weekly outreach results</span><div class="form-grid">' +
      [["wWeek", "Week starting (Monday)", "date", monday], ["wSent", "Emails sent", "number", ""], ["wDel", "Delivered", "number", ""], ["wRep", "Replies", "number", ""], ["wPos", "Interested replies", "number", ""], ["wBook", "Meetings booked", "number", ""], ["wHeld", "Meetings held", "number", ""], ["wIcp", "Ideal customer match (%)", "number", ""]]
        .map(function (f) { return '<div class="field"><label for="' + f[0] + '">' + f[1] + '</label><input id="' + f[0] + '" type="' + f[2] + '" value="' + f[3] + '" min="0"></div>'; }).join("") +
      '</div><button class="btn btn-line" type="submit">Save weekly results</button><div data-ok hidden></div><p class="err" data-err></p></form>' +
      '<form class="stack" data-form="fee"><span class="kicker">Record a fee</span><div class="form-grid"><div class="field"><label for="fMonth">Month</label><input id="fMonth" type="month" value="' + today.toISOString().slice(0, 7) + '"></div>' +
      '<div class="field"><label for="fType">Type</label><select id="fType"><option value="retainer">Monthly fee</option><option value="setup">Setup</option><option value="performance">Performance fee</option><option value="quote">Customisation</option></select></div>' +
      '<div class="field"><label for="fAmt">Amount (' + t.currency + ')</label><input id="fAmt" type="number" min="0" step="0.01" required></div><div class="field"><label for="fNote">What it covers</label><input id="fNote" type="text"></div></div><button class="btn btn-line" type="submit">Save fee</button><div data-ok hidden></div><p class="err" data-err></p></form>' +
      (t.status === "active" ? '<form class="stack" data-form="ads"><span class="kicker">Connect an ad account (read-only reporting)</span><div class="form-grid"><div class="field"><label for="aPlat">Platform</label><select id="aPlat"><option value="google_ads">Google Ads (customer ID)</option><option value="meta">Meta (ad account ID)</option><option value="linkedin">LinkedIn (ad account ID)</option></select></div>' +
      '<div class="field"><label for="aRef">Account ID</label><input id="aRef" type="text"></div></div><p class="hint">The client must first give our business account read access to this ad account.</p><button class="btn btn-line" type="submit">Connect</button><div data-ok hidden></div><p class="err" data-err></p></form>' : '') +
      '<form class="stack" data-form="note"><span class="kicker">Add an update to the client\'s activity timeline</span><div class="field"><label for="nKind">Type</label><select id="nKind"><option value="note">Note</option><option value="change">Change we made</option><option value="milestone">Milestone</option><option value="alert">Alert</option></select></div>' +
      '<div class="field"><label for="nMsg">Message (what changed, why, and what happens next)</label><textarea id="nMsg" required maxlength="2000"></textarea></div><button class="btn btn-line" type="submit">Publish update</button><div data-ok hidden></div><p class="err" data-err></p></form>';
    if (!RP.demo && ["onboarding", "paused"].indexOf(t.status) !== -1) {
      RP.sb.from("business_briefs").select("version").eq("tenant_id", t.id).order("version", { ascending: false }).limit(1).then(function (r) {
        if (!cur.tenant || cur.tenant.id !== t.id || !$("activationBriefVersion")) return;
        var brief = r && r.data && r.data[0];
        if (!r || r.error || !brief || !Number.isInteger(brief.version) || brief.version < 1) { $("activationHint").textContent = "Save a reviewed business brief, then reopen this client before activation."; return; }
        $("activationBriefVersion").value = brief.version; $("activateAccount").disabled = false;
        $("activationHint").textContent = "Version " + brief.version + " will be rechecked with account state at submission. Expired briefs cannot activate an account.";
      }).catch(function () { if (cur.tenant && cur.tenant.id === t.id && $("activationHint")) $("activationHint").textContent = "The brief could not be loaded. Reopen this client before activation."; });
    }
  }
  function tenantSubmit(form) {
    var t = cur.tenant, kind = form.dataset.form, ok = form.querySelector("[data-ok]"), err = form.querySelector("[data-err]"), v = function (id) { return $(id).value; };
    err.textContent = "";
    if (kind === "fee" && !(v("fAmt") !== "" && +v("fAmt") >= 0)) { err.textContent = "Enter the fee amount."; return; }
    if (kind === "note" && !v("nMsg").trim()) { err.textContent = "Write the update before publishing."; return; }
    var p;
    if (kind === "activate") p = RP.api("/api/admin/tenants/" + t.id + "/activate", { expected_status: t.status, expected_version: t.execution_version || 0, brief_version: +v("activationBriefVersion"), reason: v("activationReason") });
    if (kind === "pause") p = RP.api("/api/admin/tenants/" + t.id + "/pause", { reason: v("pauseReason") });
    if (kind === "invite") p = RP.demo ? Promise.resolve() : RP.api("/api/admin/tenants/" + t.id + "/invite", { email: v("iEmail"), role: v("iRole") });
    if (kind === "weekly") p = save("outreach_weekly", "upsert", { tenant_id: t.id, week_start: v("wWeek"), sent: +v("wSent") || 0, delivered: +v("wDel") || 0, replies: +v("wRep") || 0, positive_replies: +v("wPos") || 0, meetings_booked: +v("wBook") || 0, meetings_held: +v("wHeld") || 0, icp_match_pct: v("wIcp") === "" ? null : +v("wIcp") }, { onConflict: "tenant_id,week_start" });
    if (kind === "fee") p = save("fees", "insert", { tenant_id: t.id, month: v("fMonth") + "-01", type: v("fType"), amount: +v("fAmt"), currency: t.currency, note: v("fNote") });
    if (kind === "ads") p = save("ad_accounts", "insert", { tenant_id: t.id, platform: v("aPlat"), account_ref: v("aRef").replace(/[^0-9a-zA-Z_-]/g, "") });
    if (kind === "note") p = save("activity_log", "insert", { tenant_id: t.id, actor: "Ripe Piper", kind: v("nKind"), message: v("nMsg").trim(), visible_to_client: true });
    p.then(function () { if (kind === "pause" || kind === "activate") return fetchAll().then(function () { renderTenants(); var current = data.tenants.find(function (row) { return row.id === t.id; }); if (current && cur.tenant && cur.tenant.id === t.id) tenantDetail(current); }); else done(ok, "Saved."); })
      .catch(function (e) { err.textContent = e.message; });
  }

  /* ---------------------------------------------------------- blog CMS */
  function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90); }
  function renderPosts() {
    $("postsTable").innerHTML = RP.table([{ key: "title", label: "Title" }, { label: "Status", render: function (p) { return RP.badge(p.status); } }, { label: "Updated", render: function (p) { return RP.date(p.updated_at); } }],
      data.posts, { clickable: true, empty: "No articles yet." });
  }
  function openPost(p) {
    cur.post = p || null;
    $("postForm").hidden = false; $("pOk").hidden = true; $("pErr").textContent = "";
    $("pTitle").value = p ? p.title : ""; $("pSlug").value = p ? p.slug : ""; $("pDesc").value = p ? p.description : "";
    $("pCover").value = p ? p.cover_path || "" : ""; $("pCoverAlt").value = p ? p.cover_alt || "" : ""; $("pBody").value = p ? p.body_md : "";
    $("pSlug").dataset.touched = p ? "1" : "";
    updatePostPreview();
  }
  function updatePostPreview() {
    var t = $("pTitle").value, d = $("pDesc").value, s = $("pSlug").value;
    $("pTitleCount").textContent = "(" + t.length + " of 60 characters recommended)";
    $("pDescCount").textContent = "(" + d.length + " of 155 characters recommended)";
    $("pSlugPreview").textContent = s;
    $("serpUrl").textContent = "ripepiper.com › blog › " + s; $("serpTitle").textContent = (t || "Article title") + " | Ripe Piper"; $("serpDesc").textContent = d || "Search description";
    $("pPreview").innerHTML = RP.markdown($("pBody").value);
  }
  function submitPost(status) {
    var err = $("pErr"), title = $("pTitle").value.trim(), slug = slugify($("pSlug").value || title), desc = $("pDesc").value.trim(), body = $("pBody").value;
    if (!title || !desc || !body.trim()) { err.textContent = "Please add a title, a search description and the article text."; return; }
    if (slug.length < 3) { err.textContent = "The web address must have at least 3 letters or numbers."; return; }
    var row = { slug: slug, title: title, description: desc, body_md: body, cover_path: $("pCover").value.trim() || null, cover_alt: $("pCoverAlt").value.trim() || null, status: status };
    if (status === "published" && !(cur.post && cur.post.published_at)) row.published_at = new Date().toISOString();
    var p = cur.post && cur.post.id ? save("posts", "update", row, cur.post.id) : save("posts", "insert", row);
    p.then(function () {
      if (RP.demo) { if (cur.post) Object.assign(cur.post, row, { updated_at: new Date().toISOString() }); else data.posts.unshift(Object.assign({ id: "b" + Date.now(), updated_at: new Date().toISOString() }, row)); renderPosts(); return; }
      return fetchAll().then(renderPosts);
    }).then(function () { done($("pOk"), status === "published" ? "Published. The article is live at /blog/" + slug + "." : "Draft saved."); })
      .catch(function (e) { err.textContent = /duplicate|unique/i.test(e.message) ? "Another article already uses this web address. Please change it." : e.message; });
  }

  /* ---------------------------------------------------------- wiring */
  function wire() {
    $("tenantForm").addEventListener("submit", function (e) {
      e.preventDefault(); $("tenantErr").textContent = ""; $("tenantOk").hidden = true;
      var body = { name: $("tName").value.trim(), slug: $("tSlug").value.trim().toLowerCase(), country: $("tCountry").value,
        currency: $("tCurrency").value, package: $("tPkg").value };
      if (!body.name || !/^[a-z0-9-]{2,60}$/.test(body.slug)) { $("tenantErr").textContent = "Enter a client name and a valid lowercase slug."; return; }
      RP.api("/api/admin/tenants", body).then(function () { return fetchAll(); }).then(function () {
        renderTenants(); done($("tenantOk"), "Account prepared in onboarding. No campaign is active.");
      }).catch(function (error) { $("tenantErr").textContent = error.message; });
    });
    $("leadFilter").addEventListener("change", renderLeads);
    if($("leadSearch"))$("leadSearch").addEventListener("input",renderLeads);
    RP.onRowClick($("meetingsTable"), function () { return data.meetings; }, meetingDetail);
    RP.onRowClick($("proposalsTable"), function () { return data.proposals; }, proposalDetail);
    RP.onRowClick($("tenantsTable"), function () { return data.tenants; }, tenantDetail);
    RP.onRowClick($("postsTable"), function () { return data.posts; }, openPost);
    $("newPost").addEventListener("click", function () { openPost(null); });
    ["pTitle", "pSlug", "pDesc", "pBody"].forEach(function (id) { $(id).addEventListener("input", function () {
      if (id === "pSlug") $("pSlug").dataset.touched = "1";
      if (id === "pTitle" && !$("pSlug").dataset.touched) $("pSlug").value = slugify($("pTitle").value);
      updatePostPreview();
    }); });
    $("postForm").addEventListener("submit", function (e) { e.preventDefault(); submitPost(e.submitter && e.submitter.dataset.status || "draft"); });
    document.addEventListener("submit", function (e) {
      var f = e.target;
      if (f.dataset.form) { e.preventDefault(); tenantSubmit(f); }
      if (f.id === "draftForm") {
        e.preventDefault();
        RP.api("/api/admin/meetings/" + cur.meeting.id + "/draft-proposal", { currency: $("dCur").value, plan: $("dPlan").value, package: $("dPkg").value, single_event: $("dEvent").checked })
          .then(function () { return fetchAll(); }).then(function () { renderProposals(); done($("dOk"), "Draft created. Open the Proposals tab to review it."); })
          .catch(function (er) { $("dErr").textContent = er.message; });
      }
      if (f.id === "quoteForm") {
        e.preventDefault();
        var items = quoteItems();
        if (!items.length) { $("qErr").textContent = "Add at least one item with a description."; return; }
        RP.api("/api/admin/quotes", { proposal_id: cur.proposal.id, items: items })
          .then(function (j) { return RP.api("/api/admin/quotes/" + j.quote.id + "/send").then(function () { done($("qOk"), "Quotation of " + j.total_label + " sent to the client's dashboard."); }); })
          .catch(function (er) { $("qErr").textContent = er.message; });
      }
    });
    document.addEventListener("click", function (e) {
      var id = e.target.closest("button") && e.target.closest("button").id;
      if (id === "fetchTranscript") processMeeting(null);
      if (id === "useT") { var t = $("pasteT").value.trim(); if (t.length < 200) { $("tErr").textContent = "Please paste at least a few paragraphs."; return; } processMeeting(t); }
      if (id === "qAdd") addQuoteItem();
      if (id === "propSave") save("proposals", "update", { content_md: $("propMd").value }, cur.proposal.id).then(function () { cur.proposal.content_md = $("propMd").value; $("propPreview").innerHTML = RP.markdown(cur.proposal.content_md); done($("propOk"), "Saved."); }).catch(function (er) { $("propErr").textContent = er.message; });
      if (id === "propSend") { var md = $("propMd").value, pid = cur.proposal.id; (md !== cur.proposal.content_md ? save("proposals", "update", { content_md: md }, pid).then(function () { cur.proposal.content_md = md; }) : Promise.resolve()).then(function () { return RP.api("/api/admin/proposals/" + pid + "/send"); }).then(function () { return fetchAll(); }).then(function () { renderProposals(); done($("propOk"), "Sent. The client received an email with a secure link."); }).catch(function (er) { $("propErr").textContent = er.message; }); }
    });
    document.addEventListener("input", function (e) {
      if (e.target.id === "propMd") $("propPreview").innerHTML = RP.markdown(e.target.value);
      if (e.target.dataset && e.target.dataset.q) $("qTotal").textContent = RP.money(quoteItems().reduce(function (s, i) { return s + (i.quantity || 0) * (i.unit_price || 0); }, 0), cur.proposal.currency);
    });
  }

  function renderAll() { renderLeads(); renderMeetings(); renderProposals(); renderTenants(); renderPosts(); renderDashboard(); }

  RP.auth(function (user) {
    $("whoami").textContent = "Signed in as " + user.email;
    var go = function () { wire(); wireShell(); };
    if (RP.demo) { demo();viewState.loadedAt=new Date().toISOString();go();renderAll();if($("crmRefresh"))$("crmRefresh").disabled=false;dataStatus("Sample records · Illustrative snapshot, not live performance.","sample");return; }
    RP.sb.from("profiles").select("is_admin").eq("id", user.id).single().then(function (r) {
      if (!r || r.error || !r.data || r.data.is_admin!==true) {
        $("whoami").textContent = "Administrator access is required.";
        dataStatus("Administrator access could not be verified. Sign out and use an invited admin account.","error");
        document.querySelectorAll("[data-panel],.tabs").forEach(function (p) { p.hidden = true; });
        return;
      }
      go();return fetchAll().then(renderAll).catch(function(){});
    }).catch(function(){dataStatus("Administrator access could not be verified. Sign out and try again.","error");});
  });
})();
