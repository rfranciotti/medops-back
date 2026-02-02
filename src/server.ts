import "dotenv/config";
import Fastify from "fastify";
import { casesIngestRoute } from "./routes/cases.ingest.js";
import { casesGetRoute } from "./routes/cases.get.ts";
import { smokeRoute } from "./routes/smoke.ts";
import { casesSummaryRoute } from "./routes/cases.summary.ts";

const app = Fastify({
  logger: { transport: { target: "pino-pretty" } },
});

app.get("/health", async () => ({ ok: true }));

app.register(casesIngestRoute);
app.register(casesGetRoute);
app.register(casesSummaryRoute);
app.register(smokeRoute);

const port = Number(process.env.PORT || 3333);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
