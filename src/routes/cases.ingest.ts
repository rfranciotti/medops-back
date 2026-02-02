import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { runStudent } from "../services/student.js";
import { runGate } from "../services/gate.js";
import { runTeacher } from "../services/teacher.js";
import { saveCase } from "../repo/cases.repo.js";

const Body = z.object({
  raw_text: z.string().min(10),
});

export async function casesIngestRoute(app: FastifyInstance) {
  app.post("/cases/ingest", async (req, reply) => {
    const { raw_text } = Body.parse(req.body);

    const student_facts = await runStudent(raw_text);
    const gate = runGate(student_facts, raw_text);

    const teacher_output = gate.runTeacher
      ? await runTeacher(student_facts)
      : null;

    const caseId = await saveCase({
      raw_text,
      student_facts,
      gate,
      teacher_output,
    });

    return reply.send({
      success: true,
      data: { caseId, ranTeacher: gate.runTeacher, reason: gate.reason },
      message: "ok",
    });
  });
}
