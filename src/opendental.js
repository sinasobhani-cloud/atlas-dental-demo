// Open Dental API client.
// Docs: https://www.opendental.com/site/apispecification.html
// Auth: ODFHIR {DeveloperKey}/{CustomerKey} — one CustomerKey per office/location.

const BASE_URL = process.env.OD_BASE_URL || 'https://api.opendental.com/api/v1';
const DEV_KEY = process.env.OD_DEV_KEY || 'NFF6i0KrXrxDkZHt'; // Open Dental public TEST key
const PAGE_SIZE = 100;
const MAX_PAGES = 10; // safety cap per resource per refresh

/**
 * Locations are configured via OD_LOCATIONS env:
 *   OD_LOCATIONS="Main Office:VzkmZEaUWOjnQX2z,West Branch:abc123"
 * Each entry is "{Display Name}:{CustomerKey}". Defaults to the OD test office.
 */
export function getLocations() {
  const raw = process.env.OD_LOCATIONS || 'Open Dental Test Office:VzkmZEaUWOjnQX2z';
  return raw.split(',').map((entry, i) => {
    const idx = entry.lastIndexOf(':');
    return { id: i, name: entry.slice(0, idx).trim(), custKey: entry.slice(idx + 1).trim() };
  });
}

async function odGet(custKey, path, params = {}) {
  const url = new URL(`${BASE_URL}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { Authorization: `ODFHIR ${DEV_KEY}/${custKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Open Dental API ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Paginate a list endpoint until a short page or the safety cap. */
export async function odGetAll(custKey, path, params = {}) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await odGet(custKey, path, { ...params, Limit: PAGE_SIZE, Offset: page * PAGE_SIZE });
    if (!Array.isArray(batch)) return batch;
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}

export async function getPatient(custKey, patNum) {
  return odGet(custKey, `patients/${patNum}`);
}

/** Fetch many patients with bounded concurrency; returns Map<PatNum, patient>. */
export async function getPatients(custKey, patNums, concurrency = 8) {
  const unique = [...new Set(patNums)];
  const map = new Map();
  let i = 0;
  async function worker() {
    while (i < unique.length) {
      const patNum = unique[i++];
      try {
        map.set(patNum, await getPatient(custKey, patNum));
      } catch {
        // tolerate individual failures; dashboard degrades gracefully
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  return map;
}

export const resources = {
  appointments: (custKey, dateStart, dateEnd) =>
    odGetAll(custKey, 'appointments', { dateStart, dateEnd }),
  treatmentPlannedProcedures: (custKey) =>
    odGetAll(custKey, 'procedurelogs', { ProcStatus: 'TP' }),
  recalls: (custKey) => odGetAll(custKey, 'recalls'),
  providers: (custKey) => odGetAll(custKey, 'providers'),
};
