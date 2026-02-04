type GateResult = { runTeacher: boolean; reason: string };

function hasKeyword(raw: string, re: RegExp) {
  return re.test(raw);
}

function hasAnyObjectiveNumber(raw: string) {
  // números “objetivos” simples: PA 120x80, SpO2 89, temp 38.5 etc.
  return (
    /\b(\d{2,3})\s*[x\/]\s*(\d{2,3})\b/.test(raw) ||
    /\b(spo2|sat(urando|urou|uraç[ãa]o|o2)?)\b[^0-9]{0,12}(\d{2,3})\s*%?/.test(raw) ||
    /\b(temp(eratura)?)\b[^0-9]{0,10}(\d{2})([.,](\d))?\b/.test(raw) ||
    /\b(fc|frequ[êe]n(cia)?\s*card[ií]aca|hr|bpm)\b[^0-9]{0,10}(\d{2,3})\b/.test(raw) ||
    /\b(pa|press[ãa]o(?!.*arterial.*[x\/])|bp)\b[^0-9]{0,10}(\d{2,3})\b/.test(raw)
  );
}

export function runGate(student_facts: any, raw_text: string): GateResult {
  const raw = (raw_text || "").toLowerCase();

  // 0) Flags base
  const studentUnc =
    Array.isArray(student_facts?.uncertainties) &&
    student_facts.uncertainties.length > 0;

  const textUnc = hasKeyword(
    raw,
    /\b(nao sei|não sei|incerto|duvida|dúvida|talvez|parece|provavel|provável|acho que|sem certeza)\b/,
  );

  const docRisk = hasKeyword(
    raw,
    /\b(nao evolu[ia]|não evolu[ia]|sem evolucao|sem evolução|nao registrei|não registrei|registro incompleto|evolui direito|esqueci de registrar)\b/,
  );

  const chaos = hasKeyword(
    raw,
    /\b(correria|sobrecarga|sem tempo|lotad[oa]|chei[oa]|caos|sistema (caiu|fora|lento|travou)|enfermagem reclamando|plantao pegando fogo|plantão pegando fogo|nao deu tempo|não deu tempo|to perdido|tô perdido|fila (cheia|parada|longa))\b/,
  );

  const soft = hasKeyword(
    raw,
    /\b(o2|oxigenio|oxigênio|cateter|mascara|máscara|venturi|antibiotico|antibiótico|atb|ceftriaxona|piperacilina|azitromicina)\b/,
  );

  // Fallback mínimo anti-evasão
  const assertive = hasKeyword(
    raw,
    /\b(sepse( grave)?|choque|confia|tudo indica|iniciei|antibiotico|antibiótico|grave|cr[ií]tico|muito mal)\b/,
  );
  const hasNums = hasAnyObjectiveNumber(raw);

  // (1) ASSERTIVA SEM DADOS / SITUAÇÃO CRÍTICA (Regra de Ouro)
  // Se declarou gravidade extrema ou intervenção forte sem números, esse é o motivo principal (uncertainty)
  const critical = hasKeyword(raw, /\b(cr[íi]tico|muito mal|situa[çc][ãa]o\s+grave|emerg[êe]ncia|choque|sepse|urgente|mal)\b/);
  if ((assertive || critical) && !hasNums) {
    return { runTeacher: true, reason: "uncertainty" };
  }

  // (2) HARD RISK ABSOLUTO: SpO2 < 92
  const spo2Vital =
    student_facts?.vitals?.spo2_initial ?? student_facts?.vitals?.spo2;
  if (Number.isFinite(spo2Vital) && spo2Vital < 92) {
    return { runTeacher: true, reason: "hard_risk_spo2_lt_92" };
  }

  // (3) HARD RISK: Alteração neurológica
  const neuroStudent = student_facts?.physical_exam?.neuro;
  const neuroText = hasKeyword(
    raw,
    /\b(confus[ao]|desorientad[oa]|agita(d[oa]|cao)|rebaixamento|sonolent[oa])\b/,
  );
  if (neuroStudent || neuroText) {
    return { runTeacher: true, reason: "hard_risk_neuro_change" };
  }

  // (4) DOCUMENTATION RISK
  // Se admitiu falha de registro literal
  if (docRisk) {
    return { runTeacher: true, reason: "documentation_risk" };
  }

  // (5) CAOS OPERACIONAL
  if (chaos) {
    return { runTeacher: true, reason: "operational_chaos" };
  }

  // (6) SOFT RISK só dispara se combinado
  if (soft && (studentUnc || textUnc)) {
    return { runTeacher: true, reason: "soft_risk_plus_uncertainty" };
  }
  if (soft && chaos) {
    return { runTeacher: true, reason: "soft_risk_plus_chaos" };
  }

  // (7) INCERTEZA ALTA (Fallback final)
  if ((studentUnc || textUnc) && !hasNums) {
    return { runTeacher: true, reason: "uncertainty" };
  }

  return { runTeacher: false, reason: "skip_safe_case" };
}
