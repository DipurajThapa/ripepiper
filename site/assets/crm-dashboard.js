/* Read-only CRM overview of records already loaded by the existing admin shell. */
(function () {
  "use strict";
  var RP = window.RP = window.RP || {};
  var DAY = 86400000;
  var STATUS = [
    ["new", "New"], ["qualified", "Qualified"], ["meeting_booked", "Meeting booked"],
    ["meeting_held", "Meeting held"], ["proposal", "Proposal"], ["won", "Won"],
    ["lost", "Lost"], ["not_fit", "Not a fit"], ["unsubscribed", "Unsubscribed"], ["other", "Other"]
  ];
  var CAPABILITIES = [["revive", "Ripe Revive"], ["signal", "Ripe Signal"], ["response", "Ripe Response"], ["events", "Ripe Events"], ["other", "Other / unassigned"]];
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function rows(value) { return Array.isArray(value) ? value.filter(function (row) { return row && typeof row === "object" && !Array.isArray(row); }) : []; }
  function instant(value) {
    if (typeof value !== "string") return NaN;
    var match = /^(\d{4})-(\d\d)-(\d\d)T\d\d:\d\d(?::\d\d(?:\.\d{1,6})?)?(?:Z|[+-]\d\d:\d\d)$/i.exec(value);
    if (!match) return NaN;
    var year = +match[1], month = +match[2], day = +match[3];
    var calendar = new Date(0); calendar.setUTCFullYear(year, month - 1, day); calendar.setUTCHours(0, 0, 0, 0);
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return NaN;
    return Date.parse(value);
  }
  function text(value, fallback) { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
  function groups(items, definitions, key) {
    var counts = Object.create(null);
    definitions.forEach(function (entry) { counts[entry[0]] = 0; });
    items.forEach(function (row) { var value = row[key]; counts[typeof value === "string" && Object.prototype.hasOwnProperty.call(counts, value) && value !== "other" ? value : "other"]++; });
    return definitions.map(function (entry) { return { key: entry[0], label: entry[1], count: counts[entry[0]], percent: items.length ? Math.round(counts[entry[0]] / items.length * 100) : 0 }; });
  }
  function model(data, options) {
    data = data || {}; options = options || {};
    var now = typeof options.now === "number" ? options.now : instant(options.now);
    if (!Number.isFinite(now) || Math.abs(now) > 8640000000000000) now = Date.now();
    var leads = rows(data.leads), meetings = rows(data.meetings), proposals = rows(data.proposals), tenants = rows(data.tenants);
    var partial = {}, limits = {}, defaults = { leads: 300, meetings: 200, proposals: 200, tenants: null };
    Object.keys(defaults).forEach(function (key) {
      partial[key] = !!(options.partial && options.partial[key] === true);
      var supplied = options.limits && options.limits[key];
      limits[key] = supplied === null ? null : Number.isInteger(supplied) && supplied > 0 ? supplied : defaults[key];
    });
    var today = new Date(now); today.setUTCHours(0, 0, 0, 0);
    var start = today.getTime() - 13 * DAY;
    var trend = Array.from({ length: 14 }, function (_, i) { return { date: new Date(start + i * DAY).toISOString().slice(0, 10), count: 0 }; });
    var invalidDates = 0, futureDates = 0;
    leads.forEach(function (lead) {
      var at = instant(lead.created_at);
      if (!Number.isFinite(at)) { invalidDates++; return; }
      if (at > now) { futureDates++; return; }
      if (at >= start) trend[Math.floor((at - start) / DAY)].count++;
    });
    var maxTrend = Math.max.apply(null, trend.map(function (day) { return day.count; }).concat([1]));
    trend.forEach(function (day) { day.percent = Math.round(day.count / maxTrend * 100); });
    var upcoming = meetings.filter(function (meeting) { return meeting.status === "booked" && instant(meeting.start_at) > now; }).slice().sort(function (a, b) { return instant(a.start_at) - instant(b.start_at); });
    var reviewMeetings = meetings.filter(function (meeting) {
      return meeting.attendance_review && meeting.attendance_review.state === "needs_review" ||
        meeting.status === "attendance_unknown" ||
        (meeting.status === "booked" && (!meeting.meet_url || !Number.isFinite(instant(meeting.start_at)) || instant(meeting.start_at) <= now)) ||
        ((meeting.status === "held" || meeting.status === "no_show") && (!meeting.attendance_review || meeting.attendance_review.state !== "reviewed" || meeting.attendance_review.classification !== meeting.status || meeting.attendance_review.verified !== true || (meeting.status === "no_show" && meeting.attendance_review.rosterComplete !== true)));
    }).length;
    var loadedAt = instant(options.loadedAt);
    return {
      demo: options.demo === true, now: now, loadedAt: Number.isFinite(loadedAt) ? new Date(loadedAt).toISOString() : null,
      partial: partial, limits: limits,
      counts: { leads: leads.length, meetings: meetings.length, proposals: proposals.length, tenants: tenants.length },
      kpis: { inquiries: leads.length, calls: upcoming.length, drafts: proposals.filter(function (p) { return p.status === "draft"; }).length, active: tenants.filter(function (t) { return t.status === "active"; }).length },
      statuses: groups(leads, STATUS, "status"), capabilities: groups(tenants, CAPABILITIES, "package"),
      trend: trend, trendTotal: trend.reduce(function (sum, day) { return sum + day.count; }, 0), invalidDates: invalidDates, futureDates: futureDates,
      upcoming: upcoming.slice(0, 3).map(function (m) { return { name: text(m.attendee_name, text(m.attendee_email, "Unnamed attendee")), startAt: new Date(instant(m.start_at)).toISOString(), calendarPending: !m.meet_url }; }),
      review: { leads: leads.filter(function (lead) { return lead.status === "new"; }).length, meetings: reviewMeetings, proposals: proposals.filter(function (p) { return p.status === "draft"; }).length, clients: tenants.filter(function (t) { return t.status === "onboarding" || t.status === "prospect"; }).length }
    };
  }
  function link(section, label) { return '<a href="#' + section + '" data-crm-go="' + section + '">' + esc(label) + '</a>'; }
  function note(partial) { return partial ? " Partial result; additional records may exist." : ""; }
  function barList(groupsToShow) {
    return '<ul class="crm-bars">' + groupsToShow.map(function (group) {
      return '<li class="crm-bar"><span>' + esc(group.label) + '</span><strong>' + group.count + '</strong><span class="crm-bar-track" aria-hidden="true"><i style="width:' + group.percent + '%"></i></span></li>';
    }).join("") + '</ul>';
  }
  function render(container, data, options) {
    if (!container) return;
    var m = model(data, options);
    var source = m.demo ? "Sample data — demonstration only." : "Connected data — loaded CRM records.";
    var scopeLabels = { leads: "Website inquiries", meetings: "Public consultations", proposals: "Proposals", tenants: "Client accounts" };
    var scope = Object.keys(scopeLabels).map(function (key) {
      return scopeLabels[key] + ": " + m.counts[key] + " loaded" + (m.limits[key] ? " (query limit " + m.limits[key] + ")" : "") + "." + note(m.partial[key]);
    }).join(" ");
    var kpis = [["inquiries", "Website inquiries", "leads", "Loaded public website inquiries."], ["calls", "Upcoming booked calls", "meetings", "Booked consultations with a valid future start."], ["drafts", "Draft proposals", "proposals", "Loaded proposals awaiting review."], ["active", "Active clients", "tenants", "Loaded client accounts with active status."]];
    var html = '<p class="hint" data-crm-source>' + source + (m.loadedAt ? ' Updated <time datetime="' + m.loadedAt + '">' + esc(m.loadedAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")) + '</time>.' : ' Refresh time unavailable.') + '</p>' +
      '<div class="crm-kpis">' + kpis.map(function (kpi) {
        return '<article class="crm-kpi" data-crm-kpi="' + kpi[0] + '"><h3>' + esc(kpi[1]) + '</h3><p class="crm-kpi-value">' + m.kpis[kpi[0]] + '</p><p class="hint">' + esc(kpi[3] + note(m.partial[kpi[2]])) + '</p>' + link(kpi[2] === "tenants" ? "clients" : kpi[2], "View " + kpi[1].toLowerCase()) + '</article>';
      }).join("") + '</div><div class="crm-grid">' +
      '<article class="crm-card" data-crm-chart="statuses"><h3>Website inquiry statuses</h3><p class="hint">Current status distribution of ' + m.counts.leads + ' loaded inquiries. These are separate status counts, not a conversion funnel.' + note(m.partial.leads) + '</p>' + (m.counts.leads ? barList(m.statuses.filter(function (group) { return group.count; })) : '<p class="crm-empty">No website inquiries loaded.</p>') + '</article>' +
      '<article class="crm-card" data-crm-chart="trend"><h3>Website inquiries · last 14 days</h3><p class="hint">UTC calendar days, including today. ' + m.trendTotal + ' dated inquiries in this period.' + note(m.partial.leads) + '</p><ol class="crm-trend">' + m.trend.map(function (day) {
        return '<li class="crm-trend-column"><strong>' + day.count + '</strong><span class="crm-trend-track" aria-hidden="true"><i style="height:' + day.percent + '%"></i></span><time datetime="' + day.date + '" aria-label="' + day.date + ' UTC" title="' + day.date + ' UTC">' + day.date.slice(8) + '</time></li>';
      }).join("") + '</ol>' + (!m.trendTotal ? '<p class="crm-empty">No dated inquiries in this period.</p>' : '') + '<p class="hint">' + m.invalidDates + ' undated or invalid-date inquiries and ' + m.futureDates + ' future-dated inquiries excluded from this chart.</p></article>' +
      '<article class="crm-card" data-crm-chart="capabilities"><h3>Client capability mix</h3><p class="hint">Selected capability across all ' + m.counts.tenants + ' loaded client accounts, including inactive accounts. This does not measure campaign readiness.' + note(m.partial.tenants) + '</p>' + (m.counts.tenants ? barList(m.capabilities.filter(function (group) { return group.count; })) : '<p class="crm-empty">No client accounts loaded.</p>') + '</article>' +
      '<article class="crm-card" data-crm-review><h3>Review next</h3><ul class="crm-list"><li>' + link("leads", "New website inquiries") + '<strong>' + m.review.leads + '</strong></li><li>' + link("meetings", "Consultations to review") + '<strong>' + m.review.meetings + '</strong></li><li>' + link("proposals", "Draft proposals") + '<strong>' + m.review.proposals + '</strong></li><li>' + link("clients", "Prospect / onboarding accounts") + '<strong>' + m.review.clients + '</strong></li></ul><p class="hint">Review counts use loaded records. Consultation reviews include missing calendar confirmation, unresolved attendance, invalid starts and past bookings.</p></article>' +
      '<article class="crm-card" data-crm-upcoming><h3>Next booked calls</h3>' + (m.upcoming.length ? '<ul class="crm-list">' + m.upcoming.map(function (meeting) {
        return '<li><div><strong>' + esc(meeting.name) + '</strong><br><time datetime="' + meeting.startAt + '">' + esc(meeting.startAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")) + '</time>' + (meeting.calendarPending ? '<br><span class="hint">Calendar confirmation needs review.</span>' : '') + '</div>' + link("meetings", "Review call") + '</li>';
      }).join("") + '</ul>' : '<p class="crm-empty">No upcoming booked calls in the loaded records.</p>') + '<p class="hint">Earliest three future booked public consultations. Times shown in UTC.' + note(m.partial.meetings) + '</p></article></div><details class="crm-scope"><summary>Data coverage and definitions</summary><p class="hint" data-crm-scope>' + esc(scope) + ' Counts describe loaded records, not totals across the database. Website inquiries and consultations are public records; proposals and client accounts include all loaded accounts.</p></details>';
    container.innerHTML = html;
    return m;
  }
  RP.crmDashboard = { model: model, render: render };
}());
