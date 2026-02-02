export function normalizeTeacherOutput(
  teacher: any,
  student_facts: any,
  gate: any,
) {
  const out = structuredClone(teacher);

  const sec = (key: string) => out.sections?.find((s: any) => s.key === key);

  const uniqPush = (arr: any[], text: string) => {
    if (!text) return;
    if (!arr.includes(text)) arr.push(text);
  };

  const removeIfPresent = (arr: any[], text: string) => {
    const i = arr.indexOf(text);
    if (i >= 0) arr.splice(i, 1);
  };

  const B = sec("B");
  const I = sec("I");

  const spo2 = student_facts?.vitals?.spo2 ?? null;
  const cc = student_facts?.presenting_problem?.chief_complaint ?? null;

  const hasUncertainties =
    Array.isArray(student_facts?.uncertainties) &&
    student_facts.uncertainties.length > 0;

  if (B) {
    B.findings = Array.isArray(B.findings) ? B.findings : [];
    B.missing = Array.isArray(B.missing) ? B.missing : [];
  }
  if (I) {
    I.findings = Array.isArray(I.findings) ? I.findings : [];
    I.missing = Array.isArray(I.missing) ? I.missing : [];
  }

  // Hard-risk minimums
  if (Number.isFinite(spo2) && spo2 < 92 && B) {
    // Prefer the more specific "on room air" if it already exists
    const hasRoomAir = B.findings.some(
      (x: any) => typeof x === "string" && /on room air/i.test(x),
    );
    if (!hasRoomAir) uniqPush(B.findings, `SpO2: ${spo2}%`);
    // If it already had "SpO2: 89% on room air", don't add the generic duplicate
    if (hasRoomAir) {
      removeIfPresent(B.findings, `SpO2: ${spo2}%`);
    }

    // Missing fields (standardized)
    uniqPush(B.missing, "SpO2 target not documented");
    uniqPush(B.missing, "oxygen therapy status not documented");
    uniqPush(B.missing, "RR not documented");

    // Remove vague duplicate if present
    removeIfPresent(B.missing, "oxygen status");
  }

  // Problem list minimum
  if (cc && I) {
    uniqPush(I.findings, `chief complaint: ${cc}`);
  }

  const K = sec("K");
  if (K) {
    K.findings = Array.isArray(K.findings) ? K.findings : [];
    K.missing = Array.isArray(K.missing) ? K.missing : [];
  }

  if (gate?.reason === "uncertainty" && K) {
    uniqPush(
      K.missing,
      "uncertainty trigger: source text contains hedging (review required)",
    );
  }

  return out;
}
