// Aggregation layer: turns raw Open Dental data into practice intelligence.

import { resources, getPatients } from './opendental.js';

const NULL_DATE = '0001-01-01';
const cache = new Map(); // locationId -> { at, data }
const TTL_MS = 5 * 60 * 1000;

const fmtDate = (d) => d.toISOString().slice(0, 10);
const isNullDate = (s) => !s || s.startsWith(NULL_DATE);

function patientLite(p, patNum) {
  if (!p) return { patNum, name: `Patient #${patNum}`, phone: '', email: '' };
  return {
    patNum,
    name: `${p.FName || ''} ${p.LName || ''}`.trim() || `Patient #${patNum}`,
    phone: p.WirelessPhone || p.HmPhone || p.WkPhone || '',
    email: p.Email || '',
  };
}

export async function buildDashboard(location) {
  const hit = cache.get(location.id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const today = new Date();
  const in14 = new Date(today.getTime() + 14 * 86400000);
  const todayStr = fmtDate(today);

  const [appointments, tpProcs, recalls, providers] = await Promise.all([
    resources.appointments(location.custKey, todayStr, fmtDate(in14)),
    resources.treatmentPlannedProcedures(location.custKey),
    resources.recalls(location.custKey),
    resources.providers(location.custKey),
  ]);

  const providerByNum = new Map(providers.map((p) => [p.ProvNum, p]));

  // --- Schedule health (next 14 days) ---
  const scheduled = appointments.filter((a) => a.AptStatus === 'Scheduled');
  const unconfirmed = scheduled.filter((a) => (a.confirmed || '') === 'Unconfirmed');
  const patientsWithFutureApt = new Set(scheduled.map((a) => a.PatNum));

  // --- Unscheduled treatment (the money list) ---
  // TP procedures for patients with no upcoming scheduled appointment,
  // rolled up per patient and ranked by dollars sitting unscheduled.
  const byPatient = new Map();
  for (const proc of tpProcs) {
    if (patientsWithFutureApt.has(proc.PatNum)) continue;
    const entry = byPatient.get(proc.PatNum) || { patNum: proc.PatNum, total: 0, procedures: [], oldestTpDate: null };
    entry.total += parseFloat(proc.ProcFee || '0') * (proc.UnitQty || 1);
    entry.procedures.push({
      code: proc.procCode,
      description: proc.descript,
      fee: parseFloat(proc.ProcFee || '0'),
      provider: providerByNum.get(proc.ProvNum)?.Abbr || proc.provAbbr || '',
      dateTp: isNullDate(proc.DateTP) ? null : proc.DateTP,
    });
    const d = isNullDate(proc.DateTP) ? null : proc.DateTP;
    if (d && (!entry.oldestTpDate || d < entry.oldestTpDate)) entry.oldestTpDate = d;
    byPatient.set(proc.PatNum, entry);
  }
  const unscheduled = [...byPatient.values()].sort((a, b) => b.total - a.total);
  const unscheduledValue = unscheduled.reduce((s, e) => s + e.total, 0);

  // --- Overdue recall ---
  const overdueRecalls = recalls.filter(
    (r) =>
      r.IsDisabled !== 'true' &&
      !isNullDate(r.DateDue) &&
      r.DateDue < todayStr &&
      isNullDate(r.DateScheduled),
  );
  overdueRecalls.sort((a, b) => (a.DateDue < b.DateDue ? -1 : 1));

  // --- Patient details for the lists we actually show ---
  const topUnscheduled = unscheduled.slice(0, 25);
  const topRecalls = overdueRecalls.slice(0, 25);
  const patNums = [
    ...topUnscheduled.map((e) => e.patNum),
    ...topRecalls.map((r) => r.PatNum),
    ...scheduled.map((a) => a.PatNum),
  ];
  const patientMap = await getPatients(location.custKey, patNums);

  const data = {
    location: { id: location.id, name: location.name },
    generatedAt: new Date().toISOString(),
    kpis: {
      unscheduledValue: Math.round(unscheduledValue * 100) / 100,
      unscheduledPatients: unscheduled.length,
      overdueRecalls: overdueRecalls.length,
      appointmentsNext14: scheduled.length,
      unconfirmedNext14: unconfirmed.length,
    },
    unscheduledTreatment: topUnscheduled.map((e) => ({
      ...patientLite(patientMap.get(e.patNum), e.patNum),
      total: Math.round(e.total * 100) / 100,
      oldestTpDate: e.oldestTpDate,
      procedures: e.procedures.slice(0, 8),
    })),
    overdueRecall: topRecalls.map((r) => ({
      ...patientLite(patientMap.get(r.PatNum), r.PatNum),
      dateDue: r.DateDue,
      interval: r.RecallInterval,
    })),
    upcomingAppointments: scheduled
      .sort((a, b) => (a.AptDateTime < b.AptDateTime ? -1 : 1))
      .slice(0, 40)
      .map((a) => ({
        ...patientLite(patientMap.get(a.PatNum), a.PatNum),
        dateTime: a.AptDateTime,
        provider: a.provAbbr || providerByNum.get(a.ProvNum)?.Abbr || '',
        confirmed: a.confirmed || 'Unknown',
        isNewPatient: a.IsNewPatient === 'true',
        procedures: a.ProcDescript || '',
      })),
  };

  cache.set(location.id, { at: Date.now(), data });
  return data;
}
