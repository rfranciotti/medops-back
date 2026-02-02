import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { runStudent, runStudentWithMeta } from "../services/student.js";
import { runGate } from "../services/gate.js";
import {
  runTeacher,
  runTeacherRules,
  runTeacherWithMeta,
} from "../services/teacher.js";
import { saveCase } from "../repo/cases.repo.js";
import { StudentFactsV1 } from "../schemas/student_facts_v1.ts";
import { TeacherOutputV1 } from "../schemas/teacher_output_v1.ts";
import { normalizeStudentFacts } from "../services/student.normalize.ts";
import { sanitizeTeacherOutput } from "../services/teacher.sanitize.ts";
import { normalizeTeacherOutput } from "../services/teacher.normalize.ts";

const Body = z.object({
  raw_text: z.string().min(10),
});

export async function casesIngestRoute(app: FastifyInstance) {
  app.post("/cases/ingest", async (req, reply) => {
    const { raw_text } = Body.parse(req.body);

    const {
      student: student_facts_raw,
      providerUsed,
      error,
    } = await runStudentWithMeta(raw_text);
    const normalized = normalizeStudentFacts(student_facts_raw, raw_text);
    const student_facts = StudentFactsV1.parse(normalized);
    const gate = runGate(student_facts, raw_text);

    let teacher_provider: string | null = null;
    let teacher_error: string | null = null;
    let teacher_output: any | null = null;

    if (gate.runTeacher) {
      const teacher_meta = await runTeacherWithMeta(student_facts);
      teacher_provider = teacher_meta.providerUsed;

      try {
        const candidate = normalizeTeacherOutput(
          teacher_meta.teacher,
          student_facts,
          gate,
        );
        teacher_output = TeacherOutputV1.parse(candidate);
      } catch (e: any) {
        teacher_error = `teacher_output_invalid: ${e?.message || String(e)}`;
        teacher_provider = "rules_fallback_invalid_output";

        const rules = await runTeacherRules(student_facts);
        teacher_output = TeacherOutputV1.parse(rules);
      }

      if (teacher_meta.error) {
        teacher_error = teacher_error ?? teacher_meta.error;
      }
    }

    const caseId = await saveCase({
      raw_text,
      student_facts,
      gate,
      teacher_output,

      student_provider: providerUsed,
      student_error: error,

      teacher_provider,
      teacher_error,
    });

    return reply.send({
      success: true,
      data: {
        caseId,
        ranTeacher: gate.runTeacher,
        reason: gate.reason,
        student_provider: providerUsed,
        teacher_provider,
      },
      message: "ok",
    });
  });
}
