import 'dotenv/config';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLocations } from './src/opendental.js';
import { buildDashboard } from './src/aggregate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true });

app.register(fastifyStatic, { root: path.join(__dirname, 'public') });

app.get('/api/locations', async () => getLocations().map(({ id, name }) => ({ id, name })));

app.get('/api/dashboard', async (req, reply) => {
  const locations = getLocations();
  const id = Number(req.query.location ?? 0);
  const location = locations.find((l) => l.id === id);
  if (!location) return reply.code(404).send({ error: 'Unknown location' });
  try {
    return await buildDashboard(location);
  } catch (err) {
    req.log.error(err);
    return reply.code(502).send({ error: 'Open Dental API error', detail: String(err.message) });
  }
});

// All locations rolled up — the multi-location view.
app.get('/api/dashboard/all', async (req, reply) => {
  const locations = getLocations();
  try {
    const results = await Promise.all(locations.map((l) => buildDashboard(l)));
    return {
      generatedAt: new Date().toISOString(),
      locations: results.map((r) => ({ location: r.location, kpis: r.kpis })),
      totals: results.reduce(
        (t, r) => ({
          unscheduledValue: t.unscheduledValue + r.kpis.unscheduledValue,
          unscheduledPatients: t.unscheduledPatients + r.kpis.unscheduledPatients,
          overdueRecalls: t.overdueRecalls + r.kpis.overdueRecalls,
          appointmentsNext14: t.appointmentsNext14 + r.kpis.appointmentsNext14,
          unconfirmedNext14: t.unconfirmedNext14 + r.kpis.unconfirmedNext14,
        }),
        { unscheduledValue: 0, unscheduledPatients: 0, overdueRecalls: 0, appointmentsNext14: 0, unconfirmedNext14: 0 },
      ),
    };
  } catch (err) {
    req.log.error(err);
    return reply.code(502).send({ error: 'Open Dental API error', detail: String(err.message) });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`Atlas Dental running at http://localhost:${port}`);
});
