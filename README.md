# Atlas Dental — Practice Pulse (v0.1)

Multi-location practice intelligence on top of **Open Dental**. First vertical slice:
a live dashboard showing the three numbers a practice owner actually acts on —
unscheduled treatment dollars, overdue recall, and schedule health.

> Public demo: connects only to Open Dental's public test database (no PHI, public
> test credentials). No secrets in this repo.

## Quick start

```bash
npm install
npm start
# open http://localhost:3000
```

Requires Node.js 20+ (https://nodejs.org).

## Connecting a real office

1. Get Developer Portal access: email vendor.relations@opendental.com
   (1–3 business days). Portal: https://api.opendental.com/portal/
2. Generate a **Customer API key** per office in the portal; the office enables it
   under Setup → Advanced Setup → API. The office needs the eConnector running.
3. Configure `.env`:

```env
OD_DEV_KEY=yourDeveloperKey
# One entry per location: "Display Name:CustomerKey", comma-separated
OD_LOCATIONS=Glendale Office:custKey1,Burbank Office:custKey2
```

Each location = one Open Dental database = one customer key. The dashboard
aggregates across all configured locations (`/api/dashboard/all`).

## API

- `GET /api/locations` — configured locations
- `GET /api/dashboard?location=0` — full dashboard payload for one location
- `GET /api/dashboard/all` — cross-location KPI rollup

## What it computes

- **Unscheduled treatment**: procedures with status `TP` for patients who have no
  upcoming scheduled appointment, rolled up per patient, ranked by dollar value.
  This is the front desk's call list.
- **Overdue recall**: recall records past `DateDue` with nothing scheduled.
- **Schedule health**: next-14-day appointments + unconfirmed count.

## Before real patient data (PHI) touches this

This slice is read-only and currently points at a public test database. Before
connecting a production office:

- [ ] Sign Open Dental / hosting BAAs; deploy to HIPAA-eligible infrastructure
- [ ] Add authentication, RBAC, and audit logging
- [ ] Scrub logs of PHI (no patient names/phones in server logs)
- [ ] TLS everywhere, encrypted at rest
