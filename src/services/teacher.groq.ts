import { groq, GROQ_MODEL } from "../llm/groq.js";

export async function runTeacherGroq(student_facts: any) {
  const now = new Date().toISOString();
  const system = `
You are a clinical documentation auditor.

Return ONLY valid JSON.
Do NOT infer diagnoses.
Do NOT suggest treatment.
Only: (a) factual findings from student_facts, (b) documentation gaps.

Hard rules:
- findings[] and missing[] MUST be arrays of STRINGS only. Never put objects.
- Use short, human-readable bullets (e.g., "SpO2: 89% on room air", "chief complaint: dyspnea").
- If a field is absent/null, do NOT invent it. Put it in missing[] if relevant.
- DO NOT add any extra keys.

Output MUST match exactly this schema and keys:

{
  "version": "teacher_v1_groq",
  "sections": [
    { "key": "A", "title": "Airway", "findings": [], "missing": [] },
    { "key": "B", "title": "Breathing", "findings": [], "missing": [] },
    { "key": "C", "title": "Circulation", "findings": [], "missing": [] },
    { "key": "D", "title": "Disability", "findings": [], "missing": [] },
    { "key": "E", "title": "Exposure", "findings": [], "missing": [] },
    { "key": "F", "title": "Labs/Imaging", "findings": [], "missing": [] },
    { "key": "G", "title": "Medications", "findings": [], "missing": [] },
    { "key": "H", "title": "Allergies", "findings": [], "missing": [] },
    { "key": "I", "title": "Problem List", "findings": [], "missing": [] },
    { "key": "J", "title": "Plan/Next Steps (documentation gaps only)", "findings": [], "missing": [] },
    { "key": "K", "title": "Safety/Uncertainties", "findings": [], "missing": [] }
  ],
  "meta": { "generated_at": "<iso8601>", "note": "no inference; no treatment advice" }
}

Important:
- meta.generated_at MUST equal the provided timestamp exactly.
  `.trim();

  const user = JSON.stringify({
    generated_at: now,
    student_facts,
    guidance: {
      // lightweight expectations for hard risk case (still no inference)
      if_spo2_present: [
        "Add SpO2 to Breathing findings",
        "If oxygen status is not documented, add to Breathing missing",
        "Add SpO2 target missing if not present",
      ],
      if_uncertainties_present: ["List uncertainties in K findings"],
    },
  });

  const resp = await groq.chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const content = resp.choices[0]?.message?.content ?? "";
  return JSON.parse(content);
}
