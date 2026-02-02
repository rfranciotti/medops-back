import type { FastifyInstance } from "fastify";
import { getCaseById } from "../repo/cases.repo.js";

export async function casesGetRoute(app: FastifyInstance) {
  app.get("/cases/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const found = getCaseById(id);
    if (!found) {
      return reply.code(404).send({ success: false, message: "not_found" });
    }

    return reply.send({ success: true, data: found, message: "ok" });
  });
}
