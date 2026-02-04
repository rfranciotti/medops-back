import { runTeacherGroq } from "./teacher.groq.ts";

type TeacherOutput = {
  version: "teacher_v1_rules_stub";
  sections: Array<{
    key: string; // "A".."K"
    title: string;
    findings: string[]; // bullets objetivos
    missing: string[]; // lacunas explícitas
  }>;
  meta: {
    generated_at: string;
    note: string;
  };
};

export async function runTeacher(student_facts: any): Promise<TeacherOutput> {
  const now = new Date().toISOString();

  const vitals = student_facts?.vitals ?? null;
  const meds = student_facts?.medications ?? [];
  const exams = student_facts?.exams ?? [];
  const probs = student_facts?.presenting_problem ?? null;

  // Helper: se não tiver campo, marca como missing (sem inventar)
  const missingVitals = vitals == null ? ["vitals not provided"] : [];

  return {
    version: "teacher_v1_rules_stub",
    sections: [
      {
        key: "A",
        title: "Airway",
        findings: [],
        missing: ["airway status not documented"],
      },
      {
        key: "B",
        title: "Breathing",
        findings: probs?.chief_complaint
          ? [`Queixa principal: ${probs.chief_complaint}`]
          : [],
        missing: [
          ...missingVitals,
          "Meta de saturação não registrada",
          "Uso/fluxo de oxigênio não documentado",
        ],
      },
      {
        key: "C",
        title: "Circulation",
        findings: [],
        missing: [
          ...missingVitals,
          "BP/HR not documented",
          "IV access/fluids not documented",
        ],
      },
      {
        key: "D",
        title: "Disability",
        findings: [],
        missing: ["neuro status (GCS/orientation) not documented"],
      },
      {
        key: "E",
        title: "Exposure",
        findings: [],
        missing: [
          "temperature not documented",
          "focused exam summary not documented",
        ],
      },
      {
        key: "F",
        title: "Labs/Imaging",
        findings:
          Array.isArray(exams) && exams.length ? ["exams mentioned"] : [],
        missing: ["no explicit labs/imaging listed"],
      },
      {
        key: "G",
        title: "Medications",
        findings:
          Array.isArray(meds) && meds.length ? ["medications mentioned"] : [],
        missing: ["medication list/timing not documented"],
      },
      {
        key: "H",
        title: "Allergies",
        findings: [],
        missing: ["allergies not documented"],
      },
      {
        key: "I",
        title: "Problem List",
        findings: probs?.chief_complaint
          ? [`presenting problem: ${probs.chief_complaint}`]
          : [],
        missing: [
          "differential/working impression not documented (ok to omit, but should be explicit)",
        ],
      },
      {
        key: "J",
        title: "Plan/Next Steps (documentation gaps only)",
        findings: [],
        missing: ["no documented plan/checklist items"],
      },
      {
        key: "K",
        title: "Safety/Uncertainties",
        findings:
          Array.isArray(student_facts?.uncertainties) &&
          student_facts.uncertainties.length
            ? ["uncertainties present in notes"]
            : [],
        missing:
          Array.isArray(student_facts?.uncertainties) &&
          student_facts.uncertainties.length
            ? []
            : ["uncertainties not explicitly addressed"],
      },
    ],
    meta: {
      generated_at: now,
      note: "rules-only stub to validate pipeline shape; no inference or clinical advice",
    },
  };
}
export async function runTeacherRules(student_facts: any) {
  const now = new Date().toISOString();

  const vitals = student_facts?.vitals ?? null;
  const meds = student_facts?.medications ?? [];
  const exams = student_facts?.exams ?? [];
  const probs = student_facts?.presenting_problem ?? null;

  // Helper: se não tiver campo, marca como missing (sem inventar)
  const missingVitals = vitals == null ? ["vitals not provided"] : [];

  return {
    version: "teacher_v1_rules_stub",
    sections: [
      {
        key: "A",
        title: "Airway",
        findings: [],
        missing: [],
      },
      {
        key: "B",
        title: "Breathing",
        findings: probs?.chief_complaint
          ? [`Queixa principal: ${probs.chief_complaint}`]
          : [],
        missing: [],
      },
      {
        key: "C",
        title: "Circulation",
        findings: [],
        missing: [],
      },
      {
        key: "D",
        title: "Disability",
        findings: [],
        missing: [],
      },
      {
        key: "E",
        title: "Exposure",
        findings: [],
        missing: [],
      },
      {
        key: "F",
        title: "Labs/Imaging",
        findings: [],
        missing: [],
      },
      {
        key: "G",
        title: "Medications",
        findings: [],
        missing: [],
      },
      {
        key: "H",
        title: "Allergies",
        findings: [],
        missing: [],
      },
      {
        key: "I",
        title: "Problem List",
        findings: probs?.chief_complaint
          ? [`Queixa principal: ${probs.chief_complaint}`]
          : [],
        missing: [],
      },
      {
        key: "J",
        title: "Plan/Next Steps (documentation gaps only)",
        findings: [],
        missing: [],
      },
      {
        key: "K",
        title: "Safety/Uncertainties",
        findings:
          Array.isArray(student_facts?.uncertainties) &&
          student_facts.uncertainties.length
            ? ["uncertainties present in notes"]
            : [],
        missing: [],
      },
    ],
    meta: {
      generated_at: now,
      note: "rules-only stub to validate pipeline shape; no inference or clinical advice",
    },
  };
}

import { enforceTeacherSectionK } from "./anti-evasion.js";

export async function runTeacherWithMeta(
  student_facts: any,
  raw_text?: string,
) {
  const provider = process.env.TEACHER_PROVIDER || "rules";

  const uncertainties: string[] = Array.isArray(student_facts?.uncertainties)
    ? student_facts.uncertainties
    : [];

  if (provider === "rules") {
    const teacher = await runTeacherRules(student_facts);
    return {
      teacher: enforceTeacherSectionK(teacher, uncertainties),
      providerUsed: "rules_patched",
      error: null as string | null,
    };
  }

  if (provider === "groq") {
    try {
      const t = await runTeacherGroq(student_facts, raw_text);

      // ✅ Se Groq “não denunciar”, a gente injeta no K mesmo assim
      const patched = enforceTeacherSectionK(t, uncertainties);

      return {
        teacher: patched,
        providerUsed: "groq_patched",
        error: null as string | null,
      };
    } catch (e: any) {
      const fallback = await runTeacherRules(student_facts);
      return {
        teacher: enforceTeacherSectionK(fallback, uncertainties),
        providerUsed: "rules_fallback_patched",
        error: String(e?.message || e),
      };
    }
  }

  const teacher = await runTeacherRules(student_facts);
  return {
    teacher: enforceTeacherSectionK(teacher, uncertainties),
    providerUsed: "rules_patched",
    error: `unsupported provider ${provider}`,
  };
}
