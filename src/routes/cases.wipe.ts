import type { FastifyInstance } from "fastify";
import { wipeCases } from "../repo/cases.repo.js";

export async function casesWipeRoute(app: FastifyInstance) {
  app.post("/admin/wipe", async (_req, reply) => {
    wipeCases();
    return reply.send({ ok: true, message: "wiped" });
  });
}
