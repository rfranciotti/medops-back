import { groq, GROQ_MODEL } from "../llm/groq.js";

export async function runTeacherGroq(student_facts: any, raw_text?: string) {
  const now = new Date().toISOString();
  const system = `
You are a CLINICAL FACT EXTRACTOR AND AUDITOR.
If the text is vague, your output MUST be vague. Do not compensate poor documentation with structure.
You are NOT a doctor. You do NOT diagnose. You do NOT infer. You do NOT suggest treatment.
Return ONLY valid JSON.

Your job is to:
1) Extract ONLY what is explicitly written in the text.
2) Detect uncertainty, vagueness, and poor documentation.
3) REFUSE to invent, complete, guess, normalize, or improve the note.

ABSOLUTE RULES (NO EXCEPTIONS):
- If a symptom, vital sign, exam, medication, or finding is NOT EXPLICITLY written, it DOES NOT EXIST.
- NEVER invent numbers. NEVER invent symptoms. NEVER invent exams.
- ⚠️ VAGUE LANGUAGE IS NOT DATA: "normal", "bom", "ruim", "alterado", "estranho", "ok", "talvez", "parece", "provável", "meio".
- Any finding containing these adjectives WITHOUT numerical/objective support MUST move to Section K.
- ⚠️ MANDATORY: Every vague mention (vitals, exams, symptoms) MUST also trigger an explicit entry in 'missing' fields or Section J (Gaps).
- ⚠️ CRITICAL CONTRACT: NEVER generate a 'missing' item for metrics or facts NOT mentioned in the text. If "Temperature" or "Respiratory Rate" are not in the text, DO NOT ask for them.
- ⚠️ LOGICAL RULE: ASSERTION MINUS DATA EQUALS UNCERTAINTY.
- Detect "Authoritative but unsupported" statements. Phrases like "tudo indica", "é sepse", "sepse grave", "grave", "crítico", "vai morrer", "confia", "certeza", "iniciei antibiótico", "choque", "parada", "muito mal" MUST move to Section K (Uncertainties) if no objective supporting data (numbers/vitals/exams) exists.

CLASSIFICATION RULES:
- findings[]: ONLY explicit, positive, present FACTS (e.g. "falta de ar", "SpO2 89%", "estertores"). No interpretations or vague adjectives.
- missing[]: ONLY for variables EXPLICITLY mentioned in a vague/subjective way in the original text.
  * Example: "PA boa" -> "PA objetiva (sistólica/diastólica)"
  * Example: "Sat normal" -> "SpO2 com valor numérico"
  * Example: "FC alterada" -> "FC objetiva"
- FORBIDDEN: Do NOT list "labs", "imaging", "exams", "history", "temp", "rr" or "dates" UNLESS the text explicitly mentions them. No checklists.

uncertainty (Section K): Mirror strong assertions or vague findings that lack proof. Quote them in Portuguese as found in the text.
* "PA vaga: 'PA boa'"
* "Achado pulmonar vago: 'Pulmão estranho'"
* "Diagnóstico sem evidência: 'tudo indica sepse'"

Output MUST match exactly this schema and keys (keep keys in English):
{
  "version": "teacher_v1_groq",
  "sections": [
    { "key": "A", "title": "Via Aérea", "findings": [], "missing": [] },
    { "key": "B", "title": "Respiração", "findings": [], "missing": [] },
    { "key": "C", "title": "Circulação", "findings": [], "missing": [] },
    { "key": "D", "title": "Disfunção/Neuro", "findings": [], "missing": [] },
    { "key": "E", "title": "Exposição", "findings": [], "missing": [] },
    { "key": "F", "title": "Medicações/Fluidos", "findings": [], "missing": [] },
    { "key": "G", "title": "Sinais de Sepse/Infecção", "findings": [], "missing": [] },
    { "key": "H", "title": "Labs/Imagem/Pendências", "findings": [], "missing": [] },
    { "key": "I", "title": "Lista de Problemas/Histórico", "findings": [], "missing": [] },
    { "key": "J", "title": "Lacunas de Registro (GAPs)", "findings": [], "missing": [] },
    { "key": "K", "title": "Segurança/Red Flags", "findings": [], "missing": [] }
  ],
  "meta": { "generated_at": "<iso8601>", "note": "não inferência; audit" }
}

Language: PT-BR only. Dry, minimal, clinical format.
`.trim();



  const user = JSON.stringify({
    generated_at: now,
    raw_text: raw_text || "(not provided)",
    student_facts,
    audit_focus: {
      A: "Airway patency and protection",
      B: "SpO2 (initial vs current), O2 therapy (device/flow), RR, Lung auscultation",
      C: "HR, BP, Temp, CRT, Fluid status",
      D: "Mental status, GCS markers, Neuro changes",
      E: "Skin, Temperature, Exposure details",
      F: "Antibiotics, Fluids running, Chronic meds",
      G: "Sepsis signals (temp, pulse, bp, focal infection)",
      H: "Requested vs Resulted exams, Radiology, Labs",
      I: "Chief complaint + ONSET (time), Past medical history (DPOC/Bronchitis etc), Comorbidities",
      J: "Explicit missing data points found in text vs structured",
      K: "Critical risks, hypoxia, confusion, treatment lag",
    },
    guidance: {
      oxygen:
        "If O2 is mentioned, extract device and flow specifically to section B findings.",
      history:
        "Move pulmonary history (DPOC/enfisema) and comorbidities to section I.",
      physical_exam:
        "ALWAYS include physical_exam.findings (like roncos, estertores) in section B (if respiratory) or I.",
      symptoms: "Include additional_symptoms in section i or B as appropriate.",
      exams: "List requested exams with no result in section H missing.",
      uncertainty: "Move doubt phrases to section K.",
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
