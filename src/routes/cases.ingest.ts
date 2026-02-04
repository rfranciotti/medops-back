import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { runStudentWithMeta } from "../services/student.js";
import { runGate } from "../services/gate.js";
import { runTeacherRules, runTeacherWithMeta } from "../services/teacher.js";
import { saveCase } from "../repo/cases.repo.js";
import { StudentFactsV1 } from "../schemas/student_facts_v1.ts";
import { TeacherOutputV1 } from "../schemas/teacher_output_v1.ts";
import { normalizeStudentFacts } from "../services/student.normalize.ts";
import { normalizeTeacherOutput } from "../services/teacher.normalize.ts";

import { enforceTeacherSectionK } from "../services/anti-evasion.js";

const Body = z
  .object({
    raw_text: z.string().min(10).optional(),
    text: z.string().min(10).optional(),
  })
  .refine((b) => !!(b.raw_text ?? b.text), {
    message: "raw_text or text is required",
    path: ["raw_text"],
  });


  function coercePresentingProblemDuration(input: any) {
  if (!input || typeof input !== "object") return input;

  const pp = (input as any).presenting_problem;
  if (!pp || typeof pp !== "object") return input;

  const d = (pp as any).duration;

  if (typeof d === "number" && Number.isFinite(d)) {
    return {
      ...(input as any),
      presenting_problem: { ...(pp as any), duration: String(d) },
    };
  }

  return input;
}

// FIX ÚNICO: LLM às vezes retorna vitals como array.
// O schema StudentFactsV1 exige object -> pegamos o 1º item.
function coerceVitalsShape(input: any) {
  if (!input || typeof input !== "object") return input;

  const v = (input as any).vitals;
  if (Array.isArray(v)) {
    return { ...(input as any), vitals: v[0] ?? null };
  }
  return input;
}

export async function casesIngestRoute(app: FastifyInstance) {
  app.post("/cases/ingest", async (req, reply) => {
    let raw_text: string;

    try {
      const parsed = Body.parse(req.body);
      raw_text = (parsed.raw_text ?? parsed.text) as string;

      function normalizePatientHeader(t: string) {
        const s = String(t || "");
        const head = s.slice(0, 200);

        // "Paciente Maria Aparecida S., 74a" -> "Paciente: Maria Aparecida S."
        const m = head.match(/^\s*Paciente\s+([^,\n]{3,80})\s*,/i);
        if (m && m[1]) {
          const name = m[1].trim();
          return s.replace(
            /^\s*Paciente\s+[^,\n]{3,80}\s*,/i,
            `Paciente: ${name}\n`,
          );
        }

        return s;
      }

      raw_text = normalizePatientHeader(raw_text);
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          data: { issues: e.issues },
          message: "invalid body",
        });
      }
      throw e;
    }

    const {
      student: student_facts_raw,
      providerUsed,
      error,
    } = await runStudentWithMeta(raw_text);

    const coerced = coerceVitalsShape(student_facts_raw);
    const normalized = normalizeStudentFacts(coerced, raw_text);

    // ✅ ADD THIS
const normalized2 = coercePresentingProblemDuration(normalized);

    const student_facts = StudentFactsV1.parse(normalized2);
    const gate = runGate(student_facts, raw_text);

    let teacher_provider: string | null = null;
    let teacher_error: string | null = null;
    let teacher_output: any | null = null;

    if (gate.runTeacher) {
      const teacher_meta = await runTeacherWithMeta(student_facts, raw_text);
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
        const patched = enforceTeacherSectionK(
          rules,
          Array.isArray(student_facts?.uncertainties) ? student_facts.uncertainties : [],
        );
        teacher_output = TeacherOutputV1.parse(patched);
      }

      if (teacher_meta.error) {
        teacher_error = teacher_error ?? teacher_meta.error;
      }
    } else {
      // 3) Fallback para casos seguros: sempre fornece relatório canônico mínimo (K patchado)
      const rules = await runTeacherRules(student_facts);
      teacher_output = TeacherOutputV1.parse(
        enforceTeacherSectionK(rules, student_facts.uncertainties ?? []),
      );
      teacher_provider = "rules_skip_gate";
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
