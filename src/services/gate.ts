type GateResult = { runTeacher: boolean; reason: string };

function hasKeyword(raw: string, re: RegExp) {
  return re.test(raw);
}

export function runGate(student_facts: any, raw_text: string): GateResult {
  const raw = (raw_text || "").toLowerCase();

  // (1) HARD RISK: SpO2 numérica < 92 OU alteração neurológica explícita
  // SpO2: pega "spo2 89", "sat 89%", "saturacao 89", "sato2 89"
  const spo2Match = raw.match(
    /\b(spo2|sat|sato2|saturacao)\b[^0-9]{0,10}(\d{2,3})\s*%?/,
  );
  const spo2 = spo2Match ? Number(spo2Match[2]) : null;
  if (Number.isFinite(spo2) && spo2 !== null && spo2 < 92) {
    return { runTeacher: true, reason: "hard_risk_spo2_lt_92" };
  }

  if (
    hasKeyword(
      raw,
      /\b(confus[ao]|desorientad[oa]|agita(d[oa]|cao)|rebaixamento|sonolent[oa])\b/,
    )
  ) {
    return { runTeacher: true, reason: "hard_risk_neuro_change" };
  }

  // (2) Incerteza alta: Student uncertainties OU keywords no texto
  const studentUnc =
    Array.isArray(student_facts?.uncertainties) &&
    student_facts.uncertainties.length > 0;
  const textUnc = hasKeyword(
    raw,
    /\b(nao sei|incerto|duvida|talvez|parece|provavel|acho que|sem certeza)\b/,
  );
  if (studentUnc || textUnc) {
    return { runTeacher: true, reason: "uncertainty" };
  }

  // (3) Caos operacional: keywords explícitas
  if (
    hasKeyword(
      raw,
      /\b(correria|sem tempo|lotad[oa]|cheio|caos|plantao pegando fogo|nao deu tempo|to perdido)\b/,
    )
  ) {
    return { runTeacher: true, reason: "operational_chaos" };
  }

  // (4) SOFT RISK: O2 em uso ou antibiótico iniciado -> só roda se combinado com incerteza ou caos
  const soft = hasKeyword(
    raw,
    /\b(o2|oxigenio|cateter|mascara|venturi|antibiotico|atb|ceftriaxona|piperacilina|azitromicina)\b/,
  );
  if (soft && (studentUnc || textUnc)) {
    return { runTeacher: true, reason: "soft_risk_plus_uncertainty" };
  }
  if (
    soft &&
    hasKeyword(
      raw,
      /\b(correria|sem tempo|lotad[oa]|cheio|caos|nao deu tempo|to perdido)\b/,
    )
  ) {
    return { runTeacher: true, reason: "soft_risk_plus_chaos" };
  }

  return { runTeacher: false, reason: "skip_safe_case" };
}
