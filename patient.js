// patient.js — CRM-style patient record drill-in.
// Live from Open Dental: demographics, procedures (completed + planned), appointments, insurance chain.
// Simulated (labeled): chats & call history.

(function setupPatientPage() {
  const css = `
  .pat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 14px; }
  .pat-grid .card { margin-bottom: 0; }
  .pat-kv { padding: 12px 16px; font-size: 13.5px; }
  .pat-kv div { display: flex; justify-content: space-between; gap: 14px; padding: 5px 0; border-bottom: 1px dashed var(--line); }
  .pat-kv div:last-child { border-bottom: none; }
  .pat-kv span:first-child { color: var(--muted); }
  .pat-kv span:last-child { font-weight: 600; text-align: right; }
  .legend { display: flex; gap: 16px; padding: 0 18px 14px; font-size: 12.5px; color: var(--muted); align-items: center; }
  .legend i { display: inline-block; width: 14px; height: 14px; border-radius: 4px; margin-right: 5px; vertical-align: -2px; }
  td strong { cursor: pointer; }
  td strong:hover { color: var(--accent); text-decoration: underline; }
  .callrow summary { cursor: pointer; font-weight: 600; font-size: 13.5px; }
  .callrow { padding: 10px 18px; border-bottom: 1px solid var(--line); }
  .callrow .t { color: var(--muted); font-size: 12.5px; margin-top: 6px; line-height: 1.7; white-space: pre-line; }`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  const div = document.createElement('div');
  div.className = 'page hidden';
  div.id = 'page-patient';
  div.innerHTML = `
    <div style="margin-bottom:12px"><span id="patBack" style="color:var(--muted);cursor:pointer;font-size:13.5px">‹ Back to patients</span></div>
    <div id="patHead"></div>
    <div class="htabs" id="patTabs">
      <span class="on" data-ptab="overview">Overview</span>
      <span data-ptab="chart">Dental Chart</span>
      <span data-ptab="tx">Treatment History</span>
      <span data-ptab="appts">Appointments</span>
      <span data-ptab="ins">Insurance</span>
      <span data-ptab="comms">Chats &amp; Calls</span>
    </div>
    <div id="patBody"></div>`;
  document.querySelector('main').appendChild(div);

  titles.patient = ['Patient Record', 'Live from Open Dental · chats & calls simulated'];
  document.getElementById('patBack').onclick = () => showPage('patients');
  document.getElementById('patTabs').addEventListener('click', (e) => {
    const t = e.target.dataset && e.target.dataset.ptab;
    if (t) renderPatTab(t);
  });
  // Click any patient name anywhere in the app to open their record
  document.addEventListener('click', (e) => {
    const el = e.target.closest('td strong');
    if (!el || !D.patients) return;
    const nm = el.textContent.replace(/\s+NEW$/, '').trim();
    const p = D.patients.find((x) => nameOf(x) === nm);
    if (p) openPatient(p.PatNum);
  });
})();

let PAT = null;
const PX = { loaded: false };

async function loadPatientExtras() {
  if (PX.loaded) return;
  const today = fmtDate(new Date());
  const [procsC, procsTP, apptsPast, inssubs, insplans, carriers] = await Promise.all([
    odGetAll('procedurelogs', { ProcStatus: 'C' }),
    odGetAll('procedurelogs', { ProcStatus: 'TP' }),
    odGetAll('appointments', { dateStart: '2005-01-01', dateEnd: today }),
    odGetAll('inssubs'),
    odGetAll('insplans'),
    odGetAll('carriers'),
  ]);
  PX.procs = [...procsC.map((p) => ({ ...p, _st: 'C' })), ...procsTP.map((p) => ({ ...p, _st: 'TP' }))];
  PX.apptsPast = apptsPast;
  PX.subByPat = new Map(inssubs.map((s) => [s.Subscriber, s]));
  PX.planByNum = new Map(insplans.map((p) => [p.PlanNum, p]));
  PX.carrierByNum = new Map(carriers.map((c) => [c.CarrierNum, c]));
  PX.loaded = true;
}

function insFor(patNum) {
  const sub = PX.subByPat.get(patNum);
  if (!sub) return null;
  const plan = PX.planByNum.get(sub.PlanNum);
  const carrier = plan ? PX.carrierByNum.get(plan.CarrierNum) : null;
  return carrier ? { sub, plan, carrier } : null;
}
const patProcs = () => PX.procs.filter((p) => p.PatNum === PAT.PatNum)
  .sort((a, b) => (a.ProcDate < b.ProcDate ? 1 : -1));
const patAppts = () => [...PX.apptsPast, ...D.scheduled].filter((a) => a.PatNum === PAT.PatNum)
  .sort((a, b) => (a.AptDateTime < b.AptDateTime ? 1 : -1));

async function openPatient(patNum) {
  PAT = D.patByNum.get(patNum);
  if (!PAT) return;
  showPage('patient');
  document.getElementById('patHead').innerHTML = '<div class="empty">Loading full record from Open Dental…</div>';
  document.getElementById('patBody').innerHTML = '';
  await loadPatientExtras();
  const ins = insFor(patNum);
  const unsch = D.unscheduled.find((u) => u.patNum === patNum);
  document.getElementById('patHead').innerHTML = `
    <section class="card" style="padding:16px 18px;display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <div class="avatar" style="width:46px;height:46px;font-size:17px">${esc(((PAT.FName || '?')[0] || '?') + ((PAT.LName || '?')[0] || '?'))}</div>
      <div>
        <div style="font-size:19px;font-weight:750">${esc(nameOf(PAT))}</div>
        <div class="sub">DOB ${isNullDate(PAT.Birthdate) ? '—' : esc(PAT.Birthdate)} · ${esc(PAT.PatStatus)} · ${esc(phoneOf(PAT) || 'no phone')}${PAT.Email ? ' · ' + esc(PAT.Email) : ''}</div>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
        ${ins ? `<span class="pill ok">${esc(ins.carrier.CarrierName)}</span>` : '<span class="pill neutral">no insurance on file</span>'}
        ${unsch ? `<span class="pill warn">${usd(unsch.total)} unscheduled treatment</span>` : ''}
      </div>
    </section>`;
  renderPatTab('overview');
}

function renderPatTab(tab) {
  document.querySelectorAll('#patTabs span').forEach((s) => s.classList.toggle('on', s.dataset.ptab === tab));
  const body = document.getElementById('patBody');
  const procs = patProcs();
  const appts = patAppts();
  const ins = insFor(PAT.PatNum);
  const unsch = D.unscheduled.find((u) => u.patNum === PAT.PatNum);
  const futureAppts = appts.filter((a) => a.AptStatus === 'Scheduled' && a.AptDateTime >= fmtDate(new Date()));
  const pastVisits = appts.filter((a) => a.AptStatus === 'Complete');

  if (tab === 'overview') {
    body.innerHTML = `<div class="pat-grid">
      <section class="card"><h2>Contact</h2><div class="pat-kv">
        <div><span>Mobile / Home</span><span>${esc(phoneOf(PAT) || '—')}</span></div>
        <div><span>Email</span><span>${esc(PAT.Email || '—')}</span></div>
        <div><span>Address</span><span>${esc([PAT.Address, PAT.City, PAT.State].filter(Boolean).join(', ') || '—')}</span></div>
        <div><span>Text OK</span><span>${esc(PAT.TxtMsgOk || 'Unknown')}</span></div>
        <div><span>Provider</span><span>${esc(PAT.priProvAbbr || '—')}</span></div>
      </div></section>
      <section class="card"><h2>Visits</h2><div class="pat-kv">
        <div><span>Next appointment</span><span>${futureAppts.length ? esc(futureAppts[futureAppts.length - 1].AptDateTime.slice(0, 16)) : '— none scheduled'}</span></div>
        <div><span>Last completed visit</span><span>${pastVisits.length ? esc(pastVisits[0].AptDateTime.slice(0, 10)) : '—'}</span></div>
        <div><span>Total appointments</span><span>${appts.length}</span></div>
        <div><span>Completed procedures</span><span>${procs.filter((p) => p._st === 'C').length}</span></div>
      </div></section>
      <section class="card"><h2>Opportunity</h2><div class="pat-kv">
        <div><span>Treatment planned</span><span>${unsch ? usd(unsch.total) : '$0'}</span></div>
        <div><span>Planned procedures</span><span>${procs.filter((p) => p._st === 'TP').length}</span></div>
        <div><span>Recall status</span><span>${D.overdue.some((r) => r.PatNum === PAT.PatNum) ? '⚠ overdue' : 'current'}</span></div>
        <div><span>Follow-up queue</span><span>${unsch || D.overdue.some((r) => r.PatNum === PAT.PatNum) ? 'eligible for agent outreach' : '—'}</span></div>
      </div></section>
      <section class="card"><h2>Insurance</h2><div class="pat-kv">
        <div><span>Carrier</span><span>${ins ? esc(ins.carrier.CarrierName) : '—'}</span></div>
        <div><span>Member ID</span><span>${ins ? esc(ins.sub.SubscriberID) : '—'}</span></div>
        <div><span>Group</span><span>${ins ? esc(ins.plan.GroupNum || ins.plan.GroupName || '—') : '—'}</span></div>
        <div><span>Verification</span><span>${ins ? 'see Insurance tab' : '—'}</span></div>
      </div></section>
    </div>`;
  } else if (tab === 'chart') {
    body.innerHTML = `<section class="card">
      <h2>Dental chart <span class="note">drawn live from Open Dental procedure history — hover a tooth</span></h2>
      <div style="padding:18px">${odontogram(procs)}</div>
      <div class="legend"><span><i style="background:#0e7490"></i>completed work</span>
        <span><i style="background:#fef6e7;border:2px solid #b45309"></i>treatment planned</span>
        <span><i style="background:#fff;border:2px solid #cbd5e1"></i>no recorded work</span>
        <span style="margin-left:auto">${procs.filter((p) => +p.ToothNum >= 1 && +p.ToothNum <= 32).length} tooth-specific procedures on file</span></div>
    </section>`;
  } else if (tab === 'tx') {
    body.innerHTML = `<section class="card"><h2>Treatment history <span class="badge">${procs.length}</span><span class="note">completed + planned, live from Open Dental</span></h2>${
      table(['Date', 'Code', 'Procedure', 'Tooth/Surface', 'Status', 'Fee'],
        procs.slice(0, 60).map((p) => `<tr>
          <td style="white-space:nowrap">${isNullDate(p.ProcDate) ? '—' : esc(p.ProcDate)}</td>
          <td>${esc(p.procCode)}</td>
          <td>${esc(p.descript)}</td>
          <td>${esc(p.ToothNum || '—')}${p.Surf ? ' / ' + esc(p.Surf) : ''}</td>
          <td>${p._st === 'C' ? '<span class="pill ok">Completed</span>' : '<span class="pill warn">Planned</span>'}</td>
          <td class="money">${usd(parseFloat(p.ProcFee || '0'))}</td></tr>`),
        'No procedures on file.')}</section>`;
  } else if (tab === 'appts') {
    body.innerHTML = `<section class="card"><h2>Appointment history <span class="badge">${appts.length}</span><span class="note">live from Open Dental</span></h2>${
      table(['When', 'Status', 'Provider', 'Procedures', 'Confirmation'],
        appts.slice(0, 40).map((a) => `<tr>
          <td style="white-space:nowrap">${esc(a.AptDateTime.slice(0, 16))}</td>
          <td><span class="pill ${a.AptStatus === 'Complete' ? 'ok' : a.AptStatus === 'Broken' ? 'bad' : 'neutral'}">${esc(a.AptStatus)}</span></td>
          <td>${esc(a.provAbbr || '')}</td>
          <td>${esc(a.ProcDescript) || '—'}</td>
          <td>${esc(a.confirmed || '—')}</td></tr>`),
        'No appointments on file.')}</section>`;
  } else if (tab === 'ins') {
    body.innerHTML = ins ? `<div class="pat-grid">
      <section class="card"><h2>Coverage <span class="note">live from Open Dental</span></h2><div class="pat-kv">
        <div><span>Carrier</span><span>${esc(ins.carrier.CarrierName)}</span></div>
        <div><span>Member / Subscriber ID</span><span>${esc(ins.sub.SubscriberID)}</span></div>
        <div><span>Group</span><span>${esc(ins.plan.GroupNum || '—')} ${esc(ins.plan.GroupName || '')}</span></div>
        <div><span>Effective</span><span>${isNullDate(ins.sub.DateEffective) ? '—' : esc(ins.sub.DateEffective)}</span></div>
        <div><span>Carrier phone (agent dials this)</span><span>${esc(ins.carrier.Phone || '—')}</span></div>
        <div><span>EDI payer ID (270/271)</span><span>${esc(ins.carrier.ElectID || '—')}</span></div>
      </div></section>
      <section class="card"><h2>Verification <span class="badge">simulated</span></h2><div class="pat-kv">
        <div><span>Last verified</span><span>last night · 21:04 batch</span></div>
        <div><span>Channel</span><span>271 ✓ → portal ✓</span></div>
        <div><span>Eligibility</span><span><span class="pill ok">Active this month</span></span></div>
        <div><span>Expires</span><span>month-end (Medicaid is month-to-month)</span></div>
      </div>
      <div style="padding:0 16px 16px"><button class="playbtn" onclick="showPage('verify')">View verification queue →</button></div></section>
    </div>` : '<section class="card"><div class="empty">No insurance plan attached to this patient in Open Dental — the Follow-Up Agent can collect a member ID by SMS.</div></section>';
  } else if (tab === 'comms') {
    const tx = unsch && unsch.procedures[0] ? unsch.procedures[0].description.toLowerCase() : 'a check-up';
    body.innerHTML = `
    <div class="preview-banner"><span class="tag">SIMULATED</span>
      <div>Chat and call history shown as it will appear in v0.4 — every SMS and agent call attached to the patient record, synced with the Lead Pipeline.</div></div>
    <div class="pat-grid">
      <section class="card"><h2>SMS thread</h2>
        <div class="thread" style="min-height:260px">
          <div class="bubble out">Hi ${esc(PAT.FName || '')}, it's Atlas Dental. Dr. Albert recommended ${esc(tx)} — want me to text you our next openings?<div class="meta">Follow-Up Agent · Tue 10:02 AM</div></div>
          <div class="bubble in">Yes please</div>
          <div class="bubble out">Great — Thu 1:30 PM or Fri 10:00 AM. Reply 1 or 2 to book. (Reply STOP to opt out)<div class="meta">Follow-Up Agent · Tue 10:03 AM</div></div>
          <div class="bubble in">1</div>
          <div class="bubble out">You're booked for Thu 1:30 PM with Dr. Albert ✓<div class="meta">Booked in Open Dental · Tue 10:04 AM</div></div>
        </div></section>
      <section class="card"><h2>Call history</h2>
        <div class="callrow"><details><summary>📞 Inbound · Mon 11:42 AM · 3m 12s · answered by Reception Agent</summary>
          <div class="t">CALLER: Hi, do you take Medicaid for kids?
AGENT: We do — we're in-network with MCNA, DentaQuest, and UnitedHealthcare. Cleanings and exams are fully covered. Would you like to book?
CALLER: I need to check our schedule first.
AGENT: No problem — can I text you our open times? → consent captured ✓ · lead created</div></details></div>
        <div class="callrow"><details><summary>📞 Outbound · Tue 2:15 PM · 1m 48s · Follow-Up Agent · no answer</summary>
          <div class="t">No answer after 25s — voicemail left: "Hi, it's Atlas Dental about scheduling ${esc(tx)} for ${esc(PAT.FName || 'you')} — we'll text you some times."
→ cadence advanced to SMS day-2 touch</div></details></div>
        <div class="callrow"><details><summary>🛡 Verification · last night 9:04 PM · MCNA rep call · REF 7741-2236</summary>
          <div class="t">Eligibility active · D1120 2/yr, last 11/14/2025 · D0272 1/12mo → not eligible until 11/14/2026 · no PA for D2930 under 21
→ published to tomorrow's schedule</div></details></div>
      </section>
    </div>`;
  }
}

function odontogram(procs) {
  const byTooth = {};
  for (const p of procs) {
    const t = parseInt(p.ToothNum, 10);
    if (t >= 1 && t <= 32) { (byTooth[t] = byTooth[t] || []).push(p); }
  }
  const pos = (t) => (t <= 16 ? { x: 14 + (t - 1) * 44, y: 18 } : { x: 14 + (32 - t) * 44, y: 92 });
  let cells = '';
  for (let t = 1; t <= 32; t++) {
    const { x, y } = pos(t);
    const list = byTooth[t] || [];
    const hasC = list.some((p) => p._st === 'C');
    const hasTP = list.some((p) => p._st === 'TP');
    const fill = hasC ? '#0e7490' : hasTP ? '#fef6e7' : '#ffffff';
    const stroke = hasTP && !hasC ? '#b45309' : hasC ? '#0b5c73' : '#cbd5e1';
    const tip = list.length
      ? list.map((p) => `${p.procCode} ${p.descript} — ${p._st === 'C' ? 'done' : 'planned'}${isNullDate(p.ProcDate) ? '' : ' ' + p.ProcDate}`).join('\n')
      : 'no recorded work';
    cells += `<g><title>Tooth ${t}\n${esc(tip)}</title>
      <rect x="${x}" y="${y}" width="36" height="46" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      <text x="${x + 18}" y="${y + 28}" text-anchor="middle" font-size="12" font-weight="700" fill="${hasC ? '#fff' : '#475569'}">${t}</text></g>`;
  }
  return `<svg viewBox="0 0 740 160" style="width:100%;max-width:780px;display:block">${cells}
    <text x="6" y="12" font-size="10" fill="#94a3b8">UPPER (1–16)</text>
    <text x="6" y="156" font-size="10" fill="#94a3b8">LOWER (17–32)</text></svg>`;
}
