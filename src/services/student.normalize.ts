export function normalizeStudentFacts(student_facts: any, raw_text: string) {
  const out = structuredClone(student_facts);

  // Se vitals vier {} -> vira null
  if (
    out?.vitals &&
    typeof out.vitals === "object" &&
    Object.keys(out.vitals).length === 0
  ) {
    out.vitals = null;
  }

  // Extrair SpO2 do texto se Student não trouxe
  const raw = (raw_text || "").toLowerCase();
  const m = raw.match(
    /\b(spo2|sat|sato2|saturacao)\b[^0-9]{0,10}(\d{2,3})\s*%?/,
  );
  const spo2 = m ? Number(m[2]) : null;

  if (Number.isFinite(spo2) && spo2 !== null) {
    if (out.vitals == null) out.vitals = {};
    if (out.vitals.spo2 == null) out.vitals.spo2 = spo2;
  }

  return out;
}
