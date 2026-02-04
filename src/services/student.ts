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
If the text is vague, your output MUST be vague. Do not compensate poor documentation with structure.
Return ONLY valid JSON.
Rules:
- Do not infer. Do not diagnose. Do not suggest treatment.
- If missing, use null or [].
- schema_version must be "student_facts_v1"
- language "pt-BR"
- source "free_text"

Patient data extraction rules:
- age: extract as number if present (e.g., "74a" -> 74).
- weight_kg: extract numeric value if present (e.g., "67kg" -> 67).
- height_m: extract numeric value in meters if present (e.g., "1.70m" -> 1.7).
- sex: extract as "M" or "F" ONLY if explicitly stated in the text (e.g., "sexo M", "homem", "mulher"). Otherwise null.
- name: extract only if explicitly stated.
- context.setting: extract location details. Include modality ONLY if explicitly mentioned.

Vitals Extraction (STRICT - REQUIRED: Use ONLY null or numeric values):
- vitals.spo2_initial:
  Prefer SpO2 explicitly on room air ("ar ambiente"). If none, use the first SpO2 mentioned.
- vitals.spo2_on_o2:
  SpO2 explicitly mentioned AFTER oxygen therapy or while on oxygen.
- vitals.hr: heart rate as number ONLY. Use null if not a digit.
- vitals.rr: respiratory rate ONLY. Use null if not a digit.
- vitals.bp_systolic/diastolic:
  Extract ONLY numeric mmHg from clear formats (e.g., "150x90").
  ⚠️ CRITICAL: Use NULL for "13 por 8" or "PA ok". NEVER put strings or "13" in these fields.
- vitals.temp: Extract ONLY numeric value. Use null if not a digit.

⚠️ EXTREME WARNING - STOP HALLUCINATING NUMBERS:
- NEVER, UNDER ANY CIRCUMSTANCE, INVENT A NUMBER. 
- A number (digit) MUST exist in the original text to be extracted.
- If the text says "saturando baixo" -> spo2_initial MUST be NULL.
- If you output "70" when "70" is not in the text, you HAVE FAILED.
- If no numeric digit is found for a vital, leave it NULL.

⚠️ EXTREME RULE: VAGUE LANGUAGE IS NOT DATA ⚠️
- NEVER convert vague, relative, or subjective adjectives into structured clinical findings.
- VAGUE/INVALID terms: "normal", "bom", "ruim", "alterado", "estranho", "ok", "talvez", "parece", "provável", "meio".
- Ambiguous combinations: "normal mas ruim", "alterada talvez", "boa talvez".

How to handle:
1. DO NOT fill the corresponding objective field. If the value is vague/qualitative, use null.
   - Ex: "Sat normal" -> spo2_initial: null
   - Ex: "PA boa" -> bp_systolic: null
   - Ex: "Pulmão estranho" -> physical_exam.findings: []
2. ALWAYS record in uncertainties[].
   - Copy the vague snippet LITERALLY.
   - Explanation: Always follow the format <category>: "<quote>".
   - If in doubt between "finding" and "uncertainty": ALWAYS choose uncertainty.

⚠️ ANTI-INFERENCE & OBJECTIVITY RULE:
- findings[] and additional_symptoms[] MUST only contain objective, present states (e.g., "falta de ar", "tosse", "vômito", "estertores").
- If it is not a literal and objective fact, it IS an uncertainty.
- Do not infer. Do not normalize. Do not interpret.

Medical History Rules:
- comorbidities[]: CURRENT chronic conditions explicitly confirmed (e.g., "Hipertensão").
- past_medical_history[]: Past events confirmed.

Lab Results Rules:
- lab_results[]: Add ONLY if a lab test and result are mentioned (e.g., "TGO 40", "TGP normal").
- Each item MUST be an object: { "test": "name", "result": "value", "status": "done" }.
- ⚠️ CRITICAL: status MUST be one of: "done", "pending", "not_done".
- ⚠️ status: Defaults to "done" if a result is mentioned.
- ⚠️ status "pending" only if text says "colhido", "aguardando", "pedido".
- ⚠️ status "not_done" only if text says "não realizado", "negado".
- If you are unsure if it's a lab result or a physical finding, prefer uncertainties[].
- ⚠️ If only a name is mentioned as "requested" but not "done", use pending_exams[].

Medications Rules:
- medications[]: Add ONLY if a medication name (or clear class) is explicitly mentioned.
  ⚠️ CRITICAL: DO NOT guess medicine names based on disease.

⚠️ ARCHITECTURAL RULE: ASSERTION MINUS DATA EQUALS UNCERTAINTY.
- If a strong clinical claim (Diagnosis, Severity, or Treatment) is made BUT the text lacks objective data (vitals, numbers, results), this claim IS AN UNCERTAINTY.
- ASSERTIVE TRIGGERS: "tudo indica", "é sepse", "sepse grave", "grave", "crítico", "vai morrer", "confia", "certeza", "iniciei antibiótico", "antibiótico potente", "choque", "parada", "muito mal".
- These claims MUST NOT appear in other fields as facts.

uncertainties (STRICT FORMAT - Array of STRINGS):
- Return a simple flat array of strings: ["Category: 'Literal quote'"].
- Each entry must be: <category>: "<literal quote>".
- Category examples: "Achado pulmonar vago", "Saturação vaga", "PA vaga", "Diagnóstico sem evidência", "Gravidade afirmada sem dados".
- Examples:
  "PA vaga: 'PA boa'"
  "Achado pulmonar vago: 'Pulmão estranho'"
  "Saturação contraditória: 'Sat normal, mas também estava ruim'"
  "Gravidade afirmada sem dados objetivos: 'Provável coisa grave'"
  "FC incerta: 'FC alterada talvez'"

Output schema (STRICT JSON):
{
  "meta": { "schema_version": "student_facts_v1", "language": "pt-BR", "source": "free_text" },
  "patient": { "name": null, "age": null, "sex": null, "weight_kg": null, "height_m": null },
  "context": { "setting": null, "date_reference": null, "time_reference": null },
  "presenting_problem": { "chief_complaint": null, "duration": null, "onset": null, "additional_symptoms": [] },
  "comorbidities": [],
  "past_medical_history": [],
  "physical_exam": { "neuro": null, "findings": [] },
  "vitals": { "spo2_initial": null, "spo2_on_o2": null, "hr": null, "bp_systolic": null, "bp_diastolic": null, "temp": null, "rr": null },
  "oxygen_therapy": { "device": null, "flow_l_min": null },
  "medications": [],
  "exams": [],
  "pending_exams": [],
  "lab_results": [],
  "uncertainties": ["Categoria: 'Citação'"]
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
  const cleaned = String(content)
    .trim()
    // remove \`\`\`json e \`\`\` (se vier)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  return JSON.parse(cleaned);
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
