import fs from "node:fs";
import path from "node:path";
import { groq, GROQ_MODEL } from "../llm/groq.js";

function load(name: string) {
  return JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "src/fixtures/student", name),
      "utf8",
    ),
  );
}

async function runStudentFixtures(raw_text: string) {
  const text = raw_text.toLowerCase();

  if (text.includes("89") || text.includes("sat 89"))
    return load("ps_hard_risk.json");
  if (
    text.includes("acho") ||
    text.includes("talvez") ||
    text.includes("incerto")
  )
    return load("ps_uncertain.json");
  return load("ps_minimal.json");
}

export async function runStudent(raw_text: string) {
  const provider = process.env.STUDENT_PROVIDER || "fixtures";

  if (provider === "groq") return runStudentGroq(raw_text);

  // placeholder: próxima etapa é groq aqui
  throw new Error(`Unsupported STUDENT_PROVIDER: ${provider}`);
}

async function runStudentGroq(raw_text: string) {
  const prompt = `
You are a CLINICAL FACT EXTRACTOR.
Return ONLY valid JSON.
Rules:
- Do not infer. Do not diagnose. Do not suggest treatment.
- If missing, use null or [].
- schema_version must be "student_facts_v1"
- language "pt-BR"
- source "free_text"

Output schema (minimal):
{
  "meta": { "schema_version": "student_facts_v1", "language": "pt-BR", "source": "free_text" },
  "context": { "setting": null, "date_reference": null, "time_reference": null },
  "presenting_problem": { "chief_complaint": null },
  "vitals": null,
  "medications": [],
  "exams": [],
  "uncertainties": []
}

Text:
"""${raw_text}"""
`.trim();

  const resp = await groq.chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  const content = resp.choices[0]?.message?.content ?? "";
  return JSON.parse(content);
}
export async function runStudentWithMeta(raw_text: string) {
  const provider = process.env.STUDENT_PROVIDER || "fixtures";

  if (provider === "fixtures") {
    return {
      student: await runStudentFixtures(raw_text),
      providerUsed: "fixtures",
      error: null as string | null,
    };
  }

  if (provider === "groq") {
    try {
      const s = await runStudentGroq(raw_text);
      return { student: s, providerUsed: "groq", error: null as string | null };
    } catch (e: any) {
      return {
        student: await runStudentFixtures(raw_text),
        providerUsed: "fixtures_fallback",
        error: String(e?.message || e),
      };
    }
  }

  return {
    student: await runStudentFixtures(raw_text),
    providerUsed: "fixtures",
    error: `unsupported provider ${provider}`,
  };
}
