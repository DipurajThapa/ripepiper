/* Admin area: leads, meetings (AI notes and minutes), proposals and quotations, client accounts, blog CMS.
   Only users with profiles.is_admin = true can read or change anything (enforced by row-level security). */
(function () {
  "use strict";
  var RP = window.RP, $ = function (id) { return document.getElementById(id); };
  var data = { leads: [], meetings: [], proposals: [], tenants: [], posts: [] };
  var cur = { meeting: null, proposal: null, tenant: null, post: null };

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
    var sb = RP.sb;
    return Promise.all([
      sb.from("leads").select("*").is("tenant_id", null).order("created_at", { ascending: false }).limit(300),
      sb.from("meetings").select("*").is("tenant_id", null).order("start_at", { ascending: false }).limit(200),
      sb.from("proposals").select("*").order("created_at", { ascending: false }).limit(200),
      sb.from("tenants").select("*").order("name"),
      sb.from("posts").select("*").order("updated_at", { ascending: false })
    ]).then(function (r) { ["leads", "meetings", "proposals", "tenants", "posts"].forEach(function (k, i) { data[k] = r[i].data || []; }); });
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
    var f = $("leadFilter").value, rows = data.leads.filter(function (l) { return !f || l.status === f; });
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
      { label: "Status", render: function (m) { return RP.badge(m.status); } }, { label: "Notes", render: function (m) { return m.notes ? "Ready" : "–"; } }], data.meetings, { clickable: true, empty: "No meetings booked yet." });
  }
  function list(xs) { return xs && xs.length ? "<ul>" + xs.map(function (x) { return "<li>" + RP.esc(x) + "</li>"; }).join("") + "</ul>" : '<p class="muted">Not discussed.</p>'; }
  function meetingDetail(m) {
    cur.meeting = m;
    var n = m.notes, q = m.requirements, h = '<h3>' + RP.esc(m.attendee_name || m.attendee_email) + "</h3><p class=\"muted\">" + RP.dateTime(m.start_at) + " · " + RP.badge(m.status) + (m.meet_url ? ' · <a href="' + RP.esc(m.meet_url) + '" rel="noopener">Meet link</a>' : "") + "</p>";
    if (n) {
      h += '<div class="prose"><h3>Summary</h3><p>' + RP.esc(n.summary) + "</p><h3>Pains</h3>" + list(n.pains) + "<h3>Goals</h3>" + list(n.goals) +
        "<p><strong>Budget:</strong> " + RP.esc(n.budget) + "<br><strong>Timeline:</strong> " + RP.esc(n.timeline) + "</p><h3>Decision makers</h3>" + list(n.decision_makers) + "<h3>Objections</h3>" + list(n.objections) +
        "<h3>Requirements</h3><p>Recommended: <strong>" + RP.esc(q.recommended_plan) + ", " + RP.esc(q.recommended_package) + "</strong>. Ideal customer: " + RP.esc(q.icp) + "</p><h3>Customisations to quote</h3>" + list(q.customisations) +
        "<h3>Minutes</h3>" + RP.markdown(m.minutes || "") + "</div>";
      h += '<form id="draftForm" class="stack"><span class="kicker">Draft the pre-proposal</span><div class="form-grid">' +
        '<div class="field"><label for="dCur">Currency</label><select id="dCur"><option>AED</option><option>INR</option></select></div>' +
        '<div class="field"><label for="dPlan">Plan</label><select id="dPlan"><option value="sprint">Revive Sprint</option><option value="engine">Monthly engine</option></select></div>' +
        '<div class="field"><label for="dPkg">Package</label><select id="dPkg"><option>revive</option><option>signal</option><option>response</option><option>events</option></select></div>' +
        '<label class="consent"><input type="checkbox" id="dEvent"><span>Single event only (Ripe Events)</span></label></div>' +
        '<button class="btn btn-dark" type="submit">Create pre-proposal draft</button><p class="err" id="dErr"></p><div id="dOk" hidden></div></form>';
    } else {
      h += '<p>Notes are created automatically about 20 minutes after the call ends, if Google Meet transcription was on.</p>' +
        '<button class="btn btn-dark" type="button" id="fetchTranscript">Get transcript and create notes now</button>' +
        '<div class="field"><label for="pasteT">Or paste the transcript or your own notes</label><textarea id="pasteT" class="editor"></textarea></div>' +
        '<button class="btn btn-line" type="button" id="useT">Create notes from this text</button><p class="err" id="tErr"></p><div id="tOk" hidden></div>';
    }
    $("meetingDetail").innerHTML = h;
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
    $("proposalDetail").innerHTML = h;
    if (p.status === "paid") addQuoteItem();
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
      (t.status === "paused" || t.status === "ended" ? '<p class="hint">This client is ' + RP.esc(t.status) + '. Campaign execution and connected ad reporting are stopped.</p>' :
      '<form class="stack" data-form="pause"><span class="kicker">Emergency stop</span><div class="field"><label for="pauseReason">Reason for pausing</label><input id="pauseReason" type="text" minlength="8" maxlength="500" required></div><button class="btn btn-line" type="submit">Pause client execution</button><div data-ok hidden></div><p class="err" data-err></p></form>') +
      (t.status === "paused" || t.status === "ended" ? '' :
      '<form class="stack" data-form="invite"><span class="kicker">Invite a person to the dashboard</span><div class="form-grid"><div class="field"><label for="iEmail">Email (company email or Gmail)</label><input id="iEmail" type="email"></div>' +
      '<div class="field"><label for="iRole">Role</label><select id="iRole"><option value="owner">Owner: can update deals and accept quotations</option><option value="viewer">Viewer: read only</option></select></div></div><button class="btn btn-dark" type="submit">Save invitation</button><div data-ok hidden></div><p class="err" data-err></p></form>') +
      '<form class="stack" data-form="weekly"><span class="kicker">Weekly outreach results</span><div class="form-grid">' +
      [["wWeek", "Week starting (Monday)", "date", monday], ["wSent", "Emails sent", "number", ""], ["wDel", "Delivered", "number", ""], ["wRep", "Replies", "number", ""], ["wPos", "Interested replies", "number", ""], ["wBook", "Meetings booked", "number", ""], ["wHeld", "Meetings held", "number", ""], ["wIcp", "Ideal customer match (%)", "number", ""]]
        .map(function (f) { return '<div class="field"><label for="' + f[0] + '">' + f[1] + '</label><input id="' + f[0] + '" type="' + f[2] + '" value="' + f[3] + '" min="0"></div>'; }).join("") +
      '</div><button class="btn btn-line" type="submit">Save weekly results</button><div data-ok hidden></div><p class="err" data-err></p></form>' +
      '<form class="stack" data-form="fee"><span class="kicker">Record a fee</span><div class="form-grid"><div class="field"><label for="fMonth">Month</label><input id="fMonth" type="month" value="' + today.toISOString().slice(0, 7) + '"></div>' +
      '<div class="field"><label for="fType">Type</label><select id="fType"><option value="retainer">Monthly fee</option><option value="setup">Setup</option><option value="performance">Performance fee</option><option value="quote">Customisation</option></select></div>' +
      '<div class="field"><label for="fAmt">Amount (' + t.currency + ')</label><input id="fAmt" type="number" min="0"></div><div class="field"><label for="fNote">What it covers</label><input id="fNote" type="text"></div></div><button class="btn btn-line" type="submit">Save fee</button><div data-ok hidden></div><p class="err" data-err></p></form>' +
      (t.status === "active" ? '<form class="stack" data-form="ads"><span class="kicker">Connect an ad account (read-only reporting)</span><div class="form-grid"><div class="field"><label for="aPlat">Platform</label><select id="aPlat"><option value="google_ads">Google Ads (customer ID)</option><option value="meta">Meta (ad account ID)</option><option value="linkedin">LinkedIn (ad account ID)</option></select></div>' +
      '<div class="field"><label for="aRef">Account ID</label><input id="aRef" type="text"></div></div><p class="hint">The client must first give our business account read access to this ad account.</p><button class="btn btn-line" type="submit">Connect</button><div data-ok hidden></div><p class="err" data-err></p></form>' : '') +
      '<form class="stack" data-form="note"><span class="kicker">Add an update to the client\'s activity timeline</span><div class="field"><label for="nKind">Type</label><select id="nKind"><option value="note">Note</option><option value="change">Change we made</option><option value="milestone">Milestone</option><option value="alert">Alert</option></select></div>' +
      '<div class="field"><label for="nMsg">Message (what changed, why, and what happens next)</label><textarea id="nMsg"></textarea></div><button class="btn btn-line" type="submit">Publish update</button><div data-ok hidden></div><p class="err" data-err></p></form>';
  }
  function tenantSubmit(form) {
    var t = cur.tenant, kind = form.dataset.form, ok = form.querySelector("[data-ok]"), err = form.querySelector("[data-err]"), v = function (id) { return $(id).value; };
    err.textContent = "";
    var p;
    if (kind === "pause") p = RP.api("/api/admin/tenants/" + t.id + "/pause", { reason: v("pauseReason") });
    if (kind === "invite") p = RP.demo ? Promise.resolve() : RP.api("/api/admin/tenants/" + t.id + "/invite", { email: v("iEmail"), role: v("iRole") });
    if (kind === "weekly") p = save("outreach_weekly", "upsert", { tenant_id: t.id, week_start: v("wWeek"), sent: +v("wSent") || 0, delivered: +v("wDel") || 0, replies: +v("wRep") || 0, positive_replies: +v("wPos") || 0, meetings_booked: +v("wBook") || 0, meetings_held: +v("wHeld") || 0, icp_match_pct: v("wIcp") === "" ? null : +v("wIcp") }, { onConflict: "tenant_id,week_start" });
    if (kind === "fee") p = save("fees", "insert", { tenant_id: t.id, month: v("fMonth") + "-01", type: v("fType"), amount: +v("fAmt"), currency: t.currency, note: v("fNote") });
    if (kind === "ads") p = save("ad_accounts", "insert", { tenant_id: t.id, platform: v("aPlat"), account_ref: v("aRef").replace(/[^0-9a-zA-Z_-]/g, "") });
    if (kind === "note") p = save("activity_log", "insert", { tenant_id: t.id, actor: "Ripe Piper", kind: v("nKind"), message: v("nMsg"), visible_to_client: true });
    p.then(function () { if (kind === "pause") { t.status = "paused"; renderTenants(); tenantDetail(t); } else done(ok, "Saved."); })
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
      if (id === "propSend") RP.api("/api/admin/proposals/" + cur.proposal.id + "/send").then(function () { return fetchAll(); }).then(function () { renderProposals(); done($("propOk"), "Sent. The client received an email with a secure link."); }).catch(function (er) { $("propErr").textContent = er.message; });
    });
    document.addEventListener("input", function (e) {
      if (e.target.id === "propMd") $("propPreview").innerHTML = RP.markdown(e.target.value);
      if (e.target.dataset && e.target.dataset.q) $("qTotal").textContent = RP.money(quoteItems().reduce(function (s, i) { return s + (i.quantity || 0) * (i.unit_price || 0); }, 0), cur.proposal.currency);
    });
  }

  function renderAll() { renderLeads(); renderMeetings(); renderProposals(); renderTenants(); renderPosts(); }

  RP.auth(function (user) {
    $("whoami").textContent = "Signed in as " + user.email;
    var go = function () { wire(); renderAll(); RP.tabs(); };
    if (RP.demo) { demo(); return go(); }
    RP.sb.from("profiles").select("is_admin").eq("id", user.id).single().then(function (r) {
      if (!r.data || !r.data.is_admin) {
        $("whoami").textContent = user.email + " is not an administrator. Sign out and sign in with an admin account.";
        document.querySelectorAll("[data-panel],.tabs").forEach(function (p) { p.hidden = true; });
        return;
      }
      fetchAll().then(go);
    });
  });
})();
