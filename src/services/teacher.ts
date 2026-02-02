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
          ? [`chief complaint: ${probs.chief_complaint}`]
          : [],
        missing: [
          ...missingVitals,
          "SpO2 target not documented",
          "oxygen therapy status not documented",
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
        missing: ["airway status not documented"],
      },
      {
        key: "B",
        title: "Breathing",
        findings: probs?.chief_complaint
          ? [`chief complaint: ${probs.chief_complaint}`]
          : [],
        missing: [
          ...missingVitals,
          "SpO2 target not documented",
          "oxygen therapy status not documented",
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

export async function runTeacherWithMeta(student_facts: any) {
  const provider = process.env.TEACHER_PROVIDER || "rules";

  if (provider === "rules") {
    return {
      teacher: await runTeacherRules(student_facts),
      providerUsed: "rules",
      error: null as string | null,
    };
  }

  if (provider === "groq") {
    try {
      const t = await runTeacherGroq(student_facts);
      return { teacher: t, providerUsed: "groq", error: null as string | null };
    } catch (e: any) {
      return {
        teacher: await runTeacherRules(student_facts),
        providerUsed: "rules_fallback",
        error: String(e?.message || e),
      };
    }
  }

  return {
    teacher: await runTeacherRules(student_facts),
    providerUsed: "rules",
    error: `unsupported provider ${provider}`,
  };
}
