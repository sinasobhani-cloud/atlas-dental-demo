// ===== Open Dental client (public TEST credentials, no PHI) =====
const BASE_URL = 'https://api.opendental.com/api/v1';
const AUTH = 'ODFHIR NFF6i0KrXrxDkZHt/VzkmZEaUWOjnQX2z';
const isNullDate = (s) => !s || s.startsWith('0001-01-01');
const fmtDate = (d) => d.toISOString().slice(0, 10);

async function odGet(path, params = {}) {
  const url = new URL(`${BASE_URL}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: AUTH } });
  if (!res.ok) throw new Error(`Open Dental API ${res.status} on ${path}`);
  return res.json();
}
async function odGetAll(path, params = {}) {
  const out = [];
  for (let p = 0; p < 10; p++) {
    const b = await odGet(path, { ...params, Limit: 100, Offset: p * 100 });
    out.push(...b);
    if (b.length < 100) break;
  }
  return out;
}

// ===== Helpers =====
const $ = (id) => document.getElementById(id);
const usd = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const phoneOf = (p) => p.WirelessPhone || p.HmPhone || p.WkPhone || '';
const nameOf = (p) => `${p.FName || ''} ${p.LName || ''}`.trim();
function table(headers, rows, emptyMsg) {
  if (!rows.length) return `<div class="empty">${emptyMsg}</div>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
function kpiCard(label, value, hint, cls = '') {
  return `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`;
}

// ===== Data load =====
const D = {};
async function loadData() {
  const today = new Date(), todayStr = fmtDate(today);
  const in14 = fmtDate(new Date(today.getTime() + 14 * 86400000));
  const [appointments, tpProcs, recalls, providers, patients] = await Promise.all([
    odGetAll('appointments', { dateStart: todayStr, dateEnd: in14 }),
    odGetAll('procedurelogs', { ProcStatus: 'TP' }),
    odGetAll('recalls'),
    odGetAll('providers'),
    odGetAll('patients'),
  ]);
  const patByNum = new Map(patients.map((p) => [p.PatNum, p]));
  const provByNum = new Map(providers.map((p) => [p.ProvNum, p]));
  const scheduled = appointments.filter((a) => a.AptStatus === 'Scheduled')
    .sort((a, b) => (a.AptDateTime < b.AptDateTime ? -1 : 1));
  const hasFuture = new Set(scheduled.map((a) => a.PatNum));

  const byPatient = new Map();
  for (const proc of tpProcs) {
    if (hasFuture.has(proc.PatNum)) continue;
    const e = byPatient.get(proc.PatNum) || { patNum: proc.PatNum, total: 0, procedures: [], oldest: null };
    e.total += parseFloat(proc.ProcFee || '0') * (proc.UnitQty || 1);
    e.procedures.push({ code: proc.procCode, description: proc.descript });
    const d = isNullDate(proc.DateTP) ? null : proc.DateTP;
    if (d && (!e.oldest || d < e.oldest)) e.oldest = d;
    byPatient.set(proc.PatNum, e);
  }
  const unscheduled = [...byPatient.values()].sort((a, b) => b.total - a.total);
  const overdue = recalls.filter((r) =>
    r.IsDisabled !== 'true' && !isNullDate(r.DateDue) && r.DateDue < todayStr && isNullDate(r.DateScheduled))
    .sort((a, b) => (a.DateDue < b.DateDue ? -1 : 1));

  Object.assign(D, { scheduled, unscheduled, overdue, patients, patByNum, provByNum,
    unscheduledValue: unscheduled.reduce((s, e) => s + e.total, 0),
    unconfirmed: scheduled.filter((a) => (a.confirmed || '') === 'Unconfirmed') });
}

// ===== Core renderers =====
function renderDashboard() {
  $('kpis').innerHTML =
    kpiCard('Unscheduled Treatment', usd(D.unscheduledValue), `${D.unscheduled.length} patients · live from Open Dental`, 'money') +
    kpiCard('Overdue Recall', D.overdue.length, 'patients past due', D.overdue.length ? 'alert' : '') +
    kpiCard('Appointments', D.scheduled.length, 'next 14 days') +
    kpiCard('Unconfirmed', D.unconfirmed.length, 'need confirmation', D.unconfirmed.length ? 'alert' : '') +
    kpiCard('Active Patients', D.patients.filter((p) => p.PatStatus === 'Patient').length, 'in practice database');
  $('unschedBadgeD').textContent = usd(D.unscheduledValue);
  $('dashTopTable').innerHTML = followupRows(D.unscheduled.slice(0, 5));
  $('dashApptTable').innerHTML = scheduleRows(D.scheduled.slice(0, 8), false);
}

function followupRows(list) {
  return table(['Patient', 'Contact', 'Treatment Planned', 'Oldest Plan', 'Value', 'Action'],
    list.map((e) => {
      const p = D.patByNum.get(e.patNum);
      return `<tr>
        <td><strong>${esc(p ? nameOf(p) : 'Patient #' + e.patNum)}</strong></td>
        <td class="contact">${esc(p ? phoneOf(p) : '')}${p && p.Email ? '<br>' + esc(p.Email) : ''}</td>
        <td>${e.procedures.slice(0, 6).map((x) => esc(`${x.code} ${x.description}`)).join('<br>')}<div class="sub">${e.procedures.length} procedure${e.procedures.length > 1 ? 's' : ''}</div></td>
        <td>${e.oldest ? esc(e.oldest) : '—'}</td>
        <td class="money">${usd(e.total)}</td>
        <td><span class="pill neutral">Queue for outreach</span></td></tr>`;
    }), 'No unscheduled treatment — everything is booked.');
}

function scheduleRows(list, grouped = true) {
  if (!list.length) return '<div class="empty">No appointments in the next 14 days.</div>';
  let html = '<table><thead><tr><th>Time</th><th>Patient</th><th>Provider</th><th>Procedures</th><th>Status</th></tr></thead><tbody>';
  let lastDay = '';
  for (const a of list) {
    const day = a.AptDateTime.slice(0, 10);
    if (grouped && day !== lastDay) {
      html += `</tbody></table><div class="daygroup">${new Date(day + 'T12:00').toDateString()}</div><table><tbody>`;
      lastDay = day;
    }
    const p = D.patByNum.get(a.PatNum);
    html += `<tr>
      <td style="white-space:nowrap">${esc(a.AptDateTime.slice(11, 16))}</td>
      <td><strong>${esc(p ? nameOf(p) : 'Patient #' + a.PatNum)}</strong>${a.IsNewPatient === 'true' ? ' <span class="pill ok">NEW</span>' : ''}<div class="sub">${esc(p ? phoneOf(p) : '')}</div></td>
      <td>${esc(a.provAbbr || '')}</td>
      <td>${esc(a.ProcDescript) || '—'}</td>
      <td><span class="pill ${(a.confirmed || '') === 'Unconfirmed' ? 'warn' : 'ok'}">${esc(a.confirmed || 'Unknown')}</span></td></tr>`;
  }
  return html + '</tbody></table>';
}

function renderPatients(filter = '') {
  const f = filter.toLowerCase();
  const list = D.patients.filter((p) =>
    !f || nameOf(p).toLowerCase().includes(f) || phoneOf(p).includes(f) || (p.City || '').toLowerCase().includes(f));
  $('patientCount').textContent = `${list.length} of ${D.patients.length} patients`;
  $('patientsTable').innerHTML = table(['Patient', 'Status', 'Birthdate', 'Contact', 'City', 'Provider'],
    list.slice(0, 80).map((p) => `<tr>
      <td><strong>${esc(nameOf(p))}</strong></td>
      <td><span class="pill ${p.PatStatus === 'Patient' ? 'ok' : 'neutral'}">${esc(p.PatStatus)}</span></td>
      <td>${isNullDate(p.Birthdate) ? '—' : esc(p.Birthdate)}</td>
      <td class="contact">${esc(phoneOf(p))}${p.Email ? '<br>' + esc(p.Email) : ''}</td>
      <td>${esc(p.City) || '—'}</td>
      <td>${esc(p.priProvAbbr) || '—'}</td></tr>`),
    'No patients match.');
}

function renderRecall() {
  $('recallBadge').textContent = D.overdue.length;
  $('recallTable').innerHTML = table(['Patient', 'Contact', 'Due Date', 'Interval', 'Action'],
    D.overdue.slice(0, 40).map((r) => {
      const p = D.patByNum.get(r.PatNum);
      return `<tr>
        <td><strong>${esc(p ? nameOf(p) : 'Patient #' + r.PatNum)}</strong></td>
        <td class="contact">${esc(p ? phoneOf(p) : '')}${p && p.Email ? '<br>' + esc(p.Email) : ''}</td>
        <td><span class="pill bad">${esc(r.DateDue)}</span></td>
        <td>${esc(r.RecallInterval)}</td>
        <td><span class="pill neutral">Queue for outreach</span></td></tr>`;
    }), 'No overdue recalls.');
}

// ===== Lead Pipeline demo =====
function roiCalc() {
  const c = +$('roiCalls').value || 0, m = (+$('roiMiss').value || 0) / 100,
        r = (+$('roiRec').value || 0) / 100, v = +$('roiVal').value || 0;
  $('roiOut').textContent = usd(c * m * r * v * 4.33);
}
function renderPipeline() {
  ['roiCalls', 'roiMiss', 'roiRec', 'roiVal'].forEach((id) => $(id).addEventListener('input', roiCalc));
  roiCalc();
  $('pipeKpis').innerHTML =
    kpiCard('Calls this week', '247', 'inbound, both locations') +
    kpiCard('Leads captured', '86', "didn't book on first call") +
    kpiCard('Agent touches', '312', 'SMS + voice, consent-gated') +
    kpiCard('Booked by agent', '31', 'this month', 'money') +
    kpiCard('Opted out', '4', 'honored instantly');
  const names = ['Maria G.', 'J. Hernandez', 'D. Williams', 'A. Tran', 'S. Lopez', 'K. Johnson', 'R. Patel', 'C. Nguyen', 'T. Brooks', 'L. Rivera', 'M. Flores', 'B. Carter', 'E. Gomez', 'N. Davis', 'P. Castillo'];
  const intents = ['Pricing — cleaning', 'New patient (Medicaid)', 'MCNA coverage question', 'Pricing — crown', 'Recall lapsed', 'Tx follow-up'];
  const cols = [['New', 6], ['Contacted', 8], ['Engaged', 5], ['Scheduled', 7], ['Converted (mo.)', 31]];
  const notes = [['called 2h ago', 'called 4h ago', 'web form 1h ago'], ['SMS sent day 0', 'SMS sent day 2', 'call attempted'], ['replied yesterday', 'asked about times', 'asked about MCNA'], ['booked Thu 1:30', 'booked Fri 10:00', 'booked Mon 9:20'], ['visit completed', 'first visit 6/2', 'first visit 5/28']];
  let n = 0;
  $('pipeCols').innerHTML = cols.map(([t, k], ci) =>
    `<div class="col"><h4>${t} <span>${k}</span></h4>` +
    Array.from({ length: 3 }, (_, i) => {
      const nm = names[(n++) % names.length];
      return `<div class="leadcard"><b>${nm}</b><span class="sub">${notes[ci][i]}</span><span class="tag">${intents[(n + i) % intents.length]}</span></div>`;
    }).join('') +
    (k > 3 ? `<div class="sub" style="text-align:center;padding:4px">+${k - 3} more</div>` : '') + '</div>').join('');
}

const leadScript = [
  { k: 'sys', t: 'Mon 11:42 AM — inbound call from (817) 555-0143 · transcript excerpt' },
  { k: 'in', t: 'Hi, how much is a cleaning and exam for my son? We have Medicaid.' },
  { k: 'out', t: "We're in-network with MCNA, DentaQuest, and UnitedHealthcare — with Medicaid his cleaning and exam are fully covered, $0 out of pocket. Want me to text you our next openings?", m: 'Front desk (or Reception Agent)' },
  { k: 'in', t: 'Sure, that works.' },
  { k: 'sys', t: '✓ Lead created · intent: pricing / Medicaid · SMS consent captured · cadence started' },
  { k: 'out', t: "Hi! It's Atlas Dental Test Office. Openings for a fully-covered cleaning + exam: Thu 1:30 PM or Fri 10:00 AM. Reply 1 or 2 to book.", m: 'Follow-Up Agent · SMS · Day 0' },
  { k: 'sys', t: 'Day 2 — no reply → second touch (quiet hours respected)' },
  { k: 'out', t: "Quick reminder — your son's visit is 100% covered by MCNA Medicaid, no cost to you. Thursday 1:30 still open. Want it?", m: 'Follow-Up Agent · SMS · Day 2' },
  { k: 'in', t: 'yes thursday works' },
  { k: 'out', t: "You're booked! Thu 1:30 PM with Dr. Albert ✓ We'll text a reminder the day before. Reply STOP anytime to opt out.", m: 'Booked directly in Open Dental via API' },
  { k: 'sys', t: '● Lead → CONVERTED · attributed to Follow-Up Agent · est. first-visit production $240 · without follow-up this caller was lost' },
];

function playLeadJourney() {
  const box = $('leadThread');
  box.innerHTML = '';
  $('playLead').disabled = true;
  let i = 0;
  (function tick() {
    if (i >= leadScript.length) { $('playLead').disabled = false; return; }
    const l = leadScript[i++];
    box.insertAdjacentHTML('beforeend', l.k === 'sys'
      ? `<div class="sysline">— ${esc(l.t)} —</div>`
      : `<div class="bubble ${l.k}">${esc(l.t)}${l.m ? `<div class="meta">${esc(l.m)}</div>` : ''}</div>`);
    box.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(tick, l.k === 'sys' ? 1100 : 1400);
  })();
}

// ===== Verification demo =====
function renderVerify() {
  $('verKpis').innerHTML =
    kpiCard("Tomorrow's appts", '38', 'both locations') +
    kpiCard('Verified electronically', '31', 'TMHP 270/271 + DMO portal') +
    kpiCard('Resolved by AI call', '6', 'AIS IVR + DMO reps', 'money') +
    kpiCard('Needs review', '1', 'low-confidence extraction', 'alert') +
    kpiCard('Front-desk time saved', '≈4.2 h', 'vs. manual verification');
  const payers = ['MCNA', 'DentaQuest', 'UHC Dental'];
  const chains = ['271 ✓ → Portal ✓', '271 ✓ → Portal ✓', '271 ✓ → AIS IVR ✓', '271 ✓ → Portal ✓', '271 ✓ → Rep call ✓', '271 ✓ → Portal ✓', '271 ✓ → Rep call ⚠'];
  const rows = D.patients.slice(0, 7).map((p, i) => `<tr>
    <td><strong>${esc(nameOf(p))}</strong><div class="sub">DOB ${isNullDate(p.Birthdate) ? '—' : esc(p.Birthdate)}</div></td>
    <td>${payers[i % 3]}</td>
    <td style="white-space:nowrap">${chains[i]}</td>
    <td>${i === 6 ? '<span class="pill warn">Review</span>' : '<span class="pill ok">Verified</span>'}</td>
    <td class="sub">${i === 6 ? 'frequency answer ambiguous — audio clip linked for front desk' : 'auto-published · expires month-end'}</td></tr>`);
  $('verTable').innerHTML = `<table><thead><tr><th>Patient</th><th>DMO</th><th>Channel chain</th><th>Status</th><th>Note</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

const callScript = [
  { c: 't-sys', t: '21:04 nightly batch · 38 appointments tomorrow · 31 verified electronically · 6 routed to calling agent · playing one call' },
  { c: 't-sys', t: 'TMHP 271 already confirmed: eligible this month, enrolled with MCNA → calling MCNA provider line for benefits + history' },
  { c: 't-ivr', t: 'IVR  Thank you for calling MCNA Dental provider services. For eligibility and benefits, press 1.' },
  { c: 't-agent', t: 'AGENT  <span class="dtmf">1</span>' },
  { c: 't-ivr', t: 'IVR  Please enter your 10-digit provider NPI.' },
  { c: 't-agent', t: 'AGENT  <span class="dtmf">1 5 2 2 8 6 4 1 8 2</span>' },
  { c: 't-ivr', t: 'IVR  Enter the member ID, followed by pound.' },
  { c: 't-agent', t: 'AGENT  <span class="dtmf">5 2 8 4 4 1 0 9 3 #</span>' },
  { c: 't-ivr', t: 'IVR  Please hold for the next available representative.' },
  { c: 't-sys', t: 'on hold 6m 40s — zero human time spent · agent waits' },
  { c: 't-rep', t: 'REP  Provider services, this is Dana.' },
  { c: 't-agent', t: 'AGENT  Hi Dana — this is an automated assistant calling on behalf of Atlas Dental, NPI 1522864182, on a recorded line. Verifying benefits for member ID 528441093, DOB 02/07/2017.' },
  { c: 't-rep', t: 'REP  One moment… member is active. D1120 prophy covered twice per calendar year, last paid 11/14/2025. D0272 bitewings once per 12 months, last 11/14/2025.' },
  { c: 't-agent', t: 'AGENT  Thank you. And is prior authorization required for D2930, stainless steel crown, for members under 21?' },
  { c: 't-rep', t: 'REP  No PA required for D2930 under 21.' },
  { c: 't-agent', t: 'AGENT  Perfect — may I get a call reference number?' },
  { c: 't-rep', t: 'REP  Reference 7741-2236.' },
  { c: 't-agent', t: 'AGENT  Thanks Dana, have a good evening.' },
  { c: 't-sys', t: 'call ended 9m 12s · transcript → extraction · confidence 0.97 → auto-published to tomorrow\'s schedule' },
];

function playVerificationCall() {
  const box = $('callBox');
  box.innerHTML = '';
  $('vrec').innerHTML = '';
  $('playCall').disabled = true;
  let i = 0;
  (function tick() {
    if (i >= callScript.length) { showVrec(); $('playCall').disabled = false; return; }
    const l = callScript[i++];
    box.insertAdjacentHTML('beforeend', `<div class="${l.c}">${l.t}</div>`);
    box.scrollTop = box.scrollHeight;
    setTimeout(tick, l.c === 't-sys' ? 1300 : 1050);
  })();
}

function showVrec() {
  $('vrec').innerHTML = `
    <div class="vrec">
      <div class="vh"><span>✓ VerificationRecord — auto-published (confidence 0.97)</span><span>REF 7741-2236</span></div>
      <table>
        <thead><tr><th>Field</th><th>Result</th><th>Source</th></tr></thead>
        <tbody>
          <tr><td>Eligibility (June 2026)</td><td><span class="pill ok">Active</span></td><td>TMHP 271</td></tr>
          <tr><td>DMO enrollment</td><td>MCNA Dental</td><td>TMHP 271</td></tr>
          <tr><td>D1120 prophy</td><td>Covered · 2/calendar yr · last 11/14/2025 → <b>eligible for tomorrow's visit</b></td><td>MCNA rep call</td></tr>
          <tr><td>D0272 bitewings</td><td>Covered · 1/12mo · last 11/14/2025 → <b>not eligible until 11/14/2026</b></td><td>MCNA rep call</td></tr>
          <tr><td>D2930 SSC</td><td>Covered · no prior auth under 21</td><td>MCNA rep call</td></tr>
        </tbody>
      </table>
    </div>
    <div class="sub" style="margin-top:8px">Front desk sees this on tomorrow's schedule before the patient walks in. The bitewings flag alone prevents a write-off.</div>`;
}

// ===== Agents (mirrors the Atlas Auto Glass agent platform) =====
const AGENT_CFGS = [
  { icon: '💬', name: 'Riley', title: 'Follow-Up Agent', on: true, voiceIdx: 0,
    desc2: 'Your follow-up agent from Atlas Dental — works every lead until they schedule',
    max: 600, silence: 15,
    maxNote: 'Range 30–600 · Atlas platform default — fine for patient calls.',
    silNote: 'Range 5–30 · patients pause briefly; 15s is safe.',
    actions: [['Transfer To Human', true], ['SMS send', true], ['Check open slots (Open Dental)', true], ['Book appointment (Open Dental)', true]],
    prompt: `You are Riley. When anyone asks for your name, always answer "Riley". Never refer to yourself as "AI", "AI agent", or "AI assistant" — your name is Riley.
You handle follow-up calls and texts for Atlas Dental. Your job is to get patients scheduled.

CALL FLOW FOR TREATMENT FOLLOW-UP
Collect one question at a time. Skip any question already answered:
1. "Hi, may I speak with {patient first name}?"
2. "Dr. {provider} recommended {treatment} at your last visit — we'd love to get that scheduled for you."
3. If Medicaid: "Good news — with {plan name} this is covered, $0 out of pocket."
4. Offer exactly two open slots from the schedule (use Check open slots).
5. Confirm day, time, and provider, then use Book appointment.

CALL FLOW FOR RECALL / NEW LEADS
Same pattern: identify → reason for call → covered-cost reassurance if Medicaid → two slots → book.

RULES
- Never give clinical advice. Any clinical question → Transfer To Human.
- Cost questions: answer ONLY from the Knowledge Base approved pricing list.
- "Stop" / "not interested" → confirm politely, mark opted out, end the call.
- On SMS always include opt-out ("Reply STOP to opt out"). Quiet hours 8am–8pm.
- Never argue. If the person is upset → Transfer To Human.` },
  { icon: '🛡', name: 'Verification Assistant', title: 'Medicaid Verification Agent', on: true, voiceIdx: 3,
    desc2: 'Calls TMHP AIS and DMO provider lines to verify eligibility & benefits',
    max: 3600, silence: 120,
    maxNote: '⚠ Raised from the Atlas 600s cap — MCNA/DentaQuest hold queues can exceed 40 minutes.',
    silNote: '⚠ Hold music has long silent gaps — pair with hold-detection so the silence timer pauses while on hold.',
    actions: [['Transfer To Human (barge-in)', true], ['DTMF keypad entry', true], ['Hold detection / wait', true], ['Write VerificationRecord', true], ['SMS send', false]],
    prompt: `You are an automated verification assistant calling payers on behalf of Atlas Dental, NPI {npi}. When a human representative answers, always disclose first: "This is an automated assistant calling on behalf of Atlas Dental, on a recorded line."

IVR PHASE
Navigate using DTMF keypad entry per the payer's script (versioned config). Enter NPI / member ID / DOB / date of service when prompted. Wait through hold queues — never hang up before the maximum call time. If the IVR reads eligibility back, capture it.

REP AUTHENTICATION
Answer ONLY from the context pack: practice name, NPI, TIN, address, callback number, member ID, member name, member DOB, date of service. Any question not on this list → Transfer To Human.

QUESTIONS — ask only fields_still_needed from the context pack:
- Per procedure code: covered? frequency limit? date last paid?
- Prior authorization required?
- Any other insurance / TPL on file?
- ALWAYS end with: "May I get a reference number?"

RULES
- Never guess member data. Never invent dates.
- Ambiguous answer → one clarifying question, then flag the field and move on.
- Rep refuses an automated caller → offer a human ("One moment please", max 30s wait), otherwise thank them and end (logged as callback task).
- Claims disputes, appeals, clinical judgment → always Transfer To Human.
- Every call ends in exactly one terminal state.` },
  { icon: '📞', name: 'Maya', title: 'Reception Agent', on: false, voiceIdx: 2,
    desc2: 'Answers every inbound call 24/7 — books directly into Open Dental',
    max: 600, silence: 15,
    maxNote: 'Range 30–600 · Atlas platform default.',
    silNote: 'Range 5–30.',
    actions: [['Transfer To Human', true], ['SMS send', true], ['Check open slots (Open Dental)', false], ['Book appointment (Open Dental)', false], ['Create lead in pipeline', true]],
    prompt: `You are Maya. When anyone asks for your name, always answer "Maya". You answer inbound calls for Atlas Dental: greet, identify the caller's need, book/reschedule/confirm appointments, answer coverage questions from the Knowledge Base, and create a lead for every caller who doesn't book. Clinical questions or upset callers → Transfer To Human. (Full prompt finalized in v0.4.)` },
  { icon: '🔁', name: 'Riley', title: 'Recall & Reactivation Agent', on: false, voiceIdx: 0,
    desc2: 'Reaches patients past their hygiene recall date and fills hygiene gaps',
    max: 600, silence: 15,
    maxNote: 'Range 30–600 · Atlas platform default.',
    silNote: 'Range 5–30.',
    actions: [['Transfer To Human', true], ['SMS send', true], ['Check open slots (Open Dental)', false], ['Book appointment (Open Dental)', false]],
    prompt: `You are Riley, calling patients of Atlas Dental who are past due for their hygiene visit. Same persona and rules as the Follow-Up Agent; the offer is a covered cleaning + exam. (Full prompt finalized in v0.4.)` },
];
let currentAgent = 0;

function renderAgents() {
  $('agentCards').innerHTML = AGENT_CFGS.map((a, i) => `
    <div class="agent" onclick="openAgent(${i})">
      <div class="head"><div class="orb">${a.icon}</div><div><h3>${a.title}</h3><span class="pill ${a.on ? 'ok' : 'neutral'}">${a.on ? 'Configured · setup mode' : 'Planned'}</span></div></div>
      <div class="desc">${esc(a.desc2)}.</div>
      <div class="row"><span class="sub">Agent: ${esc(a.name)} · click to configure</span><div class="switch ${a.on ? 'on' : ''}"></div></div>
    </div>`).join('');
}

function openAgent(i) {
  currentAgent = i;
  const saved = JSON.parse(localStorage.getItem('agentcfg_' + i) || 'null') || {};
  const a = { ...AGENT_CFGS[i], ...saved };
  $('cfgName').value = a.name;
  $('cfgDesc').value = a.desc2;
  $('cfgVoice').selectedIndex = a.voiceIdx;
  $('cfgPrompt').value = a.prompt;
  $('cfgMax').value = a.max;
  $('cfgSilence').value = a.silence;
  $('cfgMaxNote').textContent = AGENT_CFGS[i].maxNote;
  $('cfgSilenceNote').textContent = AGENT_CFGS[i].silNote;
  $('cfgActions').innerHTML = AGENT_CFGS[i].actions.map(([label, on]) =>
    `<div class="action-row">${esc(label)}<div class="tgl ${on ? '' : 'off'}"></div></div>`).join('') +
    `<div class="action-row" style="color:var(--accent);font-weight:600">+ New Action</div>`;
  showPage('agentconfig');
}

function saveAgent() {
  localStorage.setItem('agentcfg_' + currentAgent, JSON.stringify({
    name: $('cfgName').value, desc2: $('cfgDesc').value, prompt: $('cfgPrompt').value,
    voiceIdx: $('cfgVoice').selectedIndex, max: $('cfgMax').value, silence: $('cfgSilence').value,
  }));
  const b = $('cfgSave');
  b.textContent = '✓ Saved (this browser)';
  setTimeout(() => { b.textContent = 'Save changes'; }, 2200);
}

function renderChat() {
  const picks = D.unscheduled.slice(0, 4).map((e) => D.patByNum.get(e.patNum)).filter(Boolean);
  const first = picks[0];
  $('convList').innerHTML = picks.map((p, i) => `
    <div class="conv ${i === 0 ? 'active' : ''}">
      <div class="who">${esc(nameOf(p))} <time>${i === 0 ? '2m' : i + 'h'}</time></div>
      <div class="last">${i === 0 ? 'Yes, what times do you have on Thursday?' : 'Sample conversation (preview)'}</div>
    </div>`).join('');
  const u = D.unscheduled[0];
  $('thread').innerHTML = first ? `
    <div class="bubble out">Hi ${esc(first.FName)}, it's Atlas Dental Test Office. Dr. Albert recommended ${u && u.procedures[0] ? esc(u.procedures[0].description.toLowerCase()) : 'treatment'} at your last visit — we'd love to get that scheduled. Would Thursday afternoon work?<div class="meta">Sent by Follow-Up Agent · preview</div></div>
    <div class="bubble in">Yes, what times do you have on Thursday?</div>
    <div class="ai-suggest"><b>AI suggested reply</b><br>"We have 1:30 PM or 3:00 PM open Thursday with Dr. Albert. Reply 1 or 2 and you're booked — confirmation sent right away."<div class="sub" style="margin-top:6px">In v0.4: one click sends via your Twilio number and books the slot in Open Dental.</div></div>` : '';
}

// ===== Morning Huddle =====
function computeFamilies() {
  const groups = new Map();
  for (const p of D.patients) {
    if (p.PatStatus !== 'Patient') continue;
    const key = (p.HmPhone || '') + '|' + (p.Address || '');
    if (key === '|') continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const hasFuture = new Set(D.scheduled.map((a) => a.PatNum));
  const fams = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const unsched = members.filter((m) => !hasFuture.has(m.PatNum));
    if (unsched.length) fams.push({ members, unsched, anchored: unsched.length < members.length });
  }
  return fams;
}

function hTile(label, value, hint, page, cls = '') {
  return `<div class="kpi ${cls} ${page ? 'tile' : ''}" ${page ? `onclick="showPage('${page}')"` : ''}>
    <div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}${page ? ' · click to open' : ''}</div></div>`;
}

function renderHuddleTab(tab) {
  document.querySelectorAll('.htabs span').forEach((s) => s.classList.toggle('on', s.dataset.htab === tab));
  const fams = computeFamilies();
  const famUnsched = fams.reduce((s, f) => s + f.unsched.length, 0);
  const todayStr = fmtDate(new Date());
  const tomorrowStr = fmtDate(new Date(Date.now() + 86400000));
  const todayAppts = D.scheduled.filter((a) => a.AptDateTime.slice(0, 10) === todayStr);
  const tomorrowAppts = D.scheduled.filter((a) => a.AptDateTime.slice(0, 10) === tomorrowStr);
  let html = '';
  if (tab === 'yesterday') {
    html = `<div class="kpis">${
      hTile('Production completed', '$6,820', 'simulated · live with v0.4 sync') +
      hTile('Agent touches sent', '23', 'SMS + calls · simulated') +
      hTile('Booked by agents', '3', '≈ $720 production · simulated', null, 'money') +
      hTile('Missed calls recovered', '2', 'leads created after hours · simulated')
    }</div>
    <section class="card"><h2>Yesterday's wins <span class="note">review in 60 seconds, then move on</span></h2>
      <div style="padding:14px 18px;font-size:13.5px;line-height:2">
        ✓ Follow-Up Agent booked 3 appointments from the unscheduled treatment list<br>
        ✓ 38/38 of today's patients verified overnight — zero front-desk verification time<br>
        ⚠ 1 verification flagged for review (frequency ambiguity) — front desk to confirm before the 10:00 visit
      </div></section>`;
  } else if (tab === 'today') {
    html = `<div class="kpis">${
      hTile('Appointments today', todayAppts.length, todayAppts.length ? 'live from Open Dental' : 'none on test-office schedule today', 'schedule') +
      hTile('Verified for today', '✓ all', 'overnight batch · simulated', 'verify') +
      hTile('Unscheduled Treatment', usd(D.unscheduledValue), `${D.unscheduled.length} patients — fill today's gaps`, 'followup', 'money') +
      hTile('Overdue Recall', D.overdue.length, 'hygiene reactivation list', 'recall', D.overdue.length ? 'alert' : '') +
      hTile('Unscheduled family members', famUnsched, `across ${fams.length} households — live from Open Dental`, null, famUnsched ? 'alert' : '')
    }</div>
    <section class="card"><h2>Today's schedule <span class="note">live</span></h2>${scheduleRows(todayAppts.length ? todayAppts : D.scheduled.slice(0, 5), false)}${todayAppts.length ? '' : '<div class="sub" style="padding:0 18px 14px">Test office has nothing today — showing next scheduled appointments.</div>'}</section>
    <section class="card"><h2>Family opportunities <span class="badge">${famUnsched}</span><span class="note">same household, not on the schedule — one call books them all</span></h2>${
      fams.length ? `<table><thead><tr><th>Household</th><th>Unscheduled members</th><th>Anchor</th><th>Action</th></tr></thead><tbody>${
        fams.slice(0, 8).map((f) => `<tr>
          <td><strong>${esc(f.members[0].LName)}</strong> family<div class="sub">${esc(f.members[0].HmPhone || f.members[0].Address || '')}</div></td>
          <td>${f.unsched.map((m) => esc(nameOf(m))).join('<br>')}</td>
          <td>${f.anchored ? '<span class="pill ok">member already scheduled</span>' : '<span class="pill warn">whole family lapsed</span>'}</td>
          <td><span class="pill neutral">Queue family outreach</span></td></tr>`).join('')
      }</tbody></table>` : '<div class="empty">No family opportunities detected.</div>'
    }</section>`;
  } else {
    html = `<div class="kpis">${
      hTile('Appointments tomorrow', tomorrowAppts.length, tomorrowAppts.length ? 'live from Open Dental' : 'none on test-office schedule', 'schedule') +
      hTile('Unconfirmed', D.unconfirmed.length, 'Follow-Up Agent confirms today', 'pipeline', D.unconfirmed.length ? 'alert' : '') +
      hTile('Verification batch', '21:00', 'tonight · TMHP 271 → portals → AI calls', 'verify')
    }</div>
    <section class="card"><h2>Tomorrow's schedule <span class="note">live · verification runs tonight</span></h2>${scheduleRows(tomorrowAppts.length ? tomorrowAppts : D.scheduled.slice(0, 5), false)}${tomorrowAppts.length ? '' : '<div class="sub" style="padding:0 18px 14px">Test office has nothing tomorrow — showing next scheduled appointments.</div>'}</section>`;
  }
  $('htabContent').innerHTML = html;
}

// ===== Open Questions (persists in localStorage) =====
const QUESTIONS = [
  ['For Enayat & Hovik — practice data', [
    'Do both offices run Open Dental today, with the eConnector service running?',
    'Patient mix per DMO (MCNA / DentaQuest / UHC) at each location?',
    'How many new-patient + pricing calls per week, per office?',
    'What % of Medicaid patients have a member ID (SubscriberID) entered in Open Dental?',
    'Current denial / write-off rate from eligibility misses (the ROI baseline)?',
    'Who staffs the human review queue + takeover console day-to-day?',
    'Front desk: complete 2 weeks of call-logging sheets (10+ calls per DMO)',
  ]],
  ['Business & partnership', [
    'Equity, vesting, and IP terms — papered before the platform ships',
    'Separate legal entity for the dental product (PHI liability, IP home)?',
    'Delivery model: software subscription vs done-for-you service?',
    'Pilot success criteria agreed in writing (e.g., X agent bookings/mo, 95% verification coverage)',
    'Pricing hypothesis to test during pilot (per location / per verification / % of recovered revenue)?',
  ]],
  ['Verification agent decisions', [
    'Which DMO do we script first (largest patient share)?',
    'Caller identity & disclosure script — approve exact wording',
    'Max hold budget per call (cost ceiling) and retry windows',
    'Extraction confidence threshold for auto-publish vs review queue',
    'Portal automation vs phone call priority, per payer',
    'Sign off on autonomy ladder gates (L1 → L2 → L3 promotion criteria)',
  ]],
  ['Follow-up agent decisions', [
    'Approve cadence: number of touches, timing, monthly reactivation count',
    'Consent capture script ("can we text you?") — approve exact wording',
    'Approved answers list: what can the agent say about pricing over SMS?',
    'Which providers / operatories can the agent book into directly?',
    'Escalation rules: what always goes to a human (clinical questions, complaints)?',
  ]],
  ['Porting the Atlas agent platform (findings from the auto glass CRM)', [
    'Raise Maximum call time for payer calls — Atlas caps at 600s; MCNA/DentaQuest holds can exceed 40 min',
    'Silence handling: end-after-silence (5–30s) would hang up during hold queues — add hold-music detection that pauses the timer',
    'New action type: DTMF keypad entry (IVR navigation for payer calls)',
    'New action types: Check open slots + Book appointment in Open Dental (replaces auto glass job booking)',
    'Transfer To Human → extend into conference barge-in (takeover console) per the playbook',
    'Agent persona names + voices for dental (Riley / Maya / Sam?) — approve with the dentists',
    'Knowledge Base sources for dental: accepted plans, approved pricing answers, practice info — who maintains them?',
    'Transcription custom vocabulary: payer names + dental codes (MCNA, TMHP, prophy, D1120, prior auth…)',
  ]],
  ['Compliance & infrastructure (start now — weeks of lead time)', [
    'BAAs: hosting, Twilio, ElevenLabs (enterprise tier?), OpenAI',
    'A2P 10DLC brand + campaign registration for SMS',
    'TMHP EDI / clearinghouse enrollment for 270/271 (trading partner agreement)',
    'Open Dental Developer Portal access (vendor.relations@opendental.com)',
    'Call recording & disclosure policy (TX one-party consent, reps still get disclosure)',
    'PHI-free logging + encryption-at-rest checklist before the first real office connects',
  ]],
];
function qSave(id, done, note) {
  const cur = JSON.parse(localStorage.getItem(id) || '{}');
  if (done !== null) cur.done = done;
  if (note !== null) cur.note = note;
  localStorage.setItem(id, JSON.stringify(cur));
  document.getElementById(id + '_row').classList.toggle('done', !!cur.done);
  updateQProgress();
}
function updateQProgress() {
  let total = 0, done = 0;
  QUESTIONS.forEach(([g, qs], gi) => qs.forEach((q, qi) => {
    total++;
    if (JSON.parse(localStorage.getItem(`q_${gi}_${qi}`) || '{}').done) done++;
  }));
  $('qProgress').textContent = `${done} / ${total} resolved`;
}
function renderQuestions() {
  $('qWrap').innerHTML = QUESTIONS.map(([g, qs], gi) =>
    `<section class="card"><h2>${g} <span class="badge">${qs.length}</span></h2>` +
    qs.map((q, qi) => {
      const id = `q_${gi}_${qi}`;
      const saved = JSON.parse(localStorage.getItem(id) || '{}');
      return `<div class="q ${saved.done ? 'done' : ''}" id="${id}_row">
        <input type="checkbox" ${saved.done ? 'checked' : ''} onchange="qSave('${id}', this.checked, null)">
        <div class="qt">${q}</div>
        <input class="qnote" placeholder="notes / answer…" value="${esc(saved.note || '')}" onchange="qSave('${id}', null, this.value)">
      </div>`;
    }).join('') + '</section>').join('');
  updateQProgress();
}
function qExportLink() {
  const data = {};
  QUESTIONS.forEach(([g, qs], gi) => qs.forEach((q, qi) => {
    const id = `q_${gi}_${qi}`;
    const s = localStorage.getItem(id);
    if (s && s !== '{}') data[id] = JSON.parse(s);
  }));
  const enc = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  const url = location.origin + location.pathname + '#q=' + enc;
  navigator.clipboard.writeText(url).then(() => {
    const b = $('shareBtn');
    b.textContent = '✓ Copied — answers travel with the link';
    setTimeout(() => { b.textContent = '⧉ Copy share link'; }, 2600);
  });
}
function qImportFromHash() {
  if (!location.hash.startsWith('#q=')) return;
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(3)))));
    Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
  } catch (e) { /* malformed hash — ignore */ }
}

// ===== Router =====
const titles = {
  dashboard: ['Dashboard', 'Cross-location overview'],
  huddle: ['Morning Huddle', 'Yesterday · Today · Tomorrow — run the day in 15 minutes'],
  schedule: ['Schedule', 'Next 14 days'],
  patients: ['Patients', 'Practice database (live from Open Dental)'],
  followup: ['Treatment Follow-Up', 'Unscheduled treatment pipeline'],
  recall: ['Recall', 'Hygiene reactivation'],
  pipeline: ['Lead Pipeline', 'Follow-Up Agent — simulated demo'],
  verify: ['Verification', 'Medicaid Verification Agent — simulated demo'],
  questions: ['Open Questions', 'Decisions to work through — saves in this browser'],
  how: ['How It Works', 'Open Dental integration & agent architecture'],
  chat: ['Chat', 'Patient messaging — preview'],
  agents: ['AI Agents', 'Same platform as Atlas Auto Glass — click an agent to configure'],
  agentconfig: ['Agent Configuration', 'Setup mode — goes live in v0.4'],
  settings: ['Settings', 'Locations & compliance'],
};
function showPage(page) {
  document.querySelectorAll('nav a').forEach((x) => x.classList.toggle('active', x.dataset.page === page));
  document.querySelectorAll('.page').forEach((p) => p.classList.add('hidden'));
  $('page-' + page).classList.remove('hidden');
  $('pageTitle').textContent = titles[page][0];
  $('pageCrumb').textContent = titles[page][1];
}
document.querySelectorAll('nav a[data-page]').forEach((a) => {
  a.onclick = () => showPage(a.dataset.page);
});
$('patientSearch').addEventListener('input', (e) => renderPatients(e.target.value));
$('playLead').addEventListener('click', playLeadJourney);
$('playCall').addEventListener('click', playVerificationCall);
$('shareBtn').addEventListener('click', qExportLink);
$('cfgBack').addEventListener('click', () => showPage('agents'));
$('cfgSave').addEventListener('click', saveAgent);
document.querySelectorAll('.htabs span').forEach((s) => {
  s.onclick = () => renderHuddleTab(s.dataset.htab);
});

// ===== Init =====
(async function init() {
  try {
    await loadData();
  } catch (e) {
    $('status').innerHTML = 'Could not reach Open Dental: ' + esc(e.message);
    return;
  }
  renderDashboard();
  $('apptBadge').textContent = D.scheduled.length;
  $('scheduleTable').innerHTML = scheduleRows(D.scheduled, true);
  renderPatients();
  $('unschedBadge').textContent = usd(D.unscheduledValue);
  $('followupTable').innerHTML = followupRows(D.unscheduled.slice(0, 40));
  renderRecall();
  renderPipeline();
  renderVerify();
  renderAgents();
  renderChat();
  renderHuddleTab('today');
  qImportFromHash();
  renderQuestions();
  $('status').classList.add('hidden');
  $('page-dashboard').classList.remove('hidden');
})();
