// src/clinical/anti-evasion.ts
type AnyObj = Record<string, any>;

export type AntiEvasionResult = {
  assertions: string[];          // linhas no formato: Label: "quote"
  forced: boolean;              // true se tivemos que injetar algo
  reasons: string[];            // motivos técnicos (debug)
};

function norm(s: string) {
  return (s || "").toLowerCase().trim();
}

function uniqCI(lines: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const k = norm(l);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l.trim());
  }
  return out;
}

// Extrai um “trecho citável” (curto) contendo o termo
function pickQuote(rawLower: string, term: string) {
  const parts = rawLower.split(/[.\n]/g).map((s) => s.trim()).filter(Boolean);
  const hit = parts.find((p) => p.includes(term)) || term;
  // corta pra não ficar gigante
  return hit.length > 180 ? hit.slice(0, 177) + "..." : hit;
}

// Detecta se existe PELO MENOS UM número “objetivo” (não precisa ser vitals perfeito)
function hasAnyObjectiveNumber(rawLower: string, vitals?: AnyObj | null) {
  const vit =
    vitals &&
    (Number.isFinite(vitals.spo2_initial) ||
      Number.isFinite(vitals.hr) ||
      Number.isFinite(vitals.bp_systolic) ||
      Number.isFinite(vitals.temp) ||
      Number.isFinite(vitals.rr));

  // qualquer padrão numérico clínico comum no texto
  const rawHasNum =
    /\b(\d{2,3})\s*%?\b/.test(rawLower) || // 86, 112, 38,5 (pegando parcial)
    /\b(\d{2,3})\s*[x\/]\s*(\d{2,3})\b/.test(rawLower) || // 120x80
    /\b(3|4|5|6|7|8|9|10)\s*l\/?min\b/.test(rawLower); // O2

  return Boolean(vit || rawHasNum);
}

/**
 * Pré-scan determinístico: afirmações fortes sem base objetiva
 * Retorna linhas no formato: "<Label>: "<quote>""
 */
export function preScanAssertiveClaims(raw_text: string, vitals?: AnyObj | null): string[] {
  const rawLower = norm(raw_text);

  const triggers: Array<{ term: string; label: string }> = [
    { term: "sepse", label: "Diagnóstico afirmado sem evidência objetiva" },
    { term: "sepse grave", label: "Diagnóstico afirmado sem evidência objetiva" },
    { term: "grave", label: "Gravidade afirmada sem dados objetivos" },
    { term: "crítico", label: "Gravidade afirmada sem dados objetivos" },
    { term: "critico", label: "Gravidade afirmada sem dados objetivos" },
    { term: "tudo indica", label: "Afirmação clínica sem base" },
    { term: "confia", label: "Gravidade subjetiva" },
    { term: "certeza", label: "Afirmação sem evidência" },
    { term: "choque", label: "Diagnóstico de choque sem base objetiva" },
    { term: "parada", label: "Referência a evento crítico sem dados" },
    { term: "muito mal", label: "Gravidade afirmada sem dados objetivos" },
    { term: "iniciei", label: "Conduta iniciada sem documentação de base" },
    { term: "antibiótico", label: "Conduta iniciada sem documentação de base" },
    { term: "antibiotico", label: "Conduta iniciada sem documentação de base" },
  ];

  const objective = hasAnyObjectiveNumber(rawLower, vitals);

  const out: string[] = [];
  for (const t of triggers) {
    if (!rawLower.includes(t.term)) continue;

    // regra: termo forte + ausência de base objetiva => vira uncertainty
    if (!objective) {
      const q = pickQuote(rawLower, t.term);
      out.push(`${t.label}: "${q}"`);
    }
  }

  // bônus: saturação vaga sem número (garante que não suma e vire pendência)
  const hasSatNumber = /\b(spo2|sat|sato2|saturacao|saturação)\b[^0-9]{0,15}(\d{2,3})\s*%?/.test(rawLower);
  const mentionsSat = /\b(spo2|sat|sato2|saturacao|saturação)\b/i.test(rawLower);
  const vagueSat = /\b(normal|bom|boa|ruim|baixo|baixa|ok|alterad[oa]|estranh[oa]|dessaturando|meio)\b/i.test(rawLower);

  if (!hasSatNumber && mentionsSat && vagueSat) {
    const q = pickQuote(rawLower, "sat");
    out.push(`Saturação vaga: "${q}"`);
  } else if (!hasSatNumber && /\b(saturando baixo|dessaturando|sat ruim|saturacao baixa|saturação baixa)\b/.test(rawLower)) {
    out.push(`Saturação vaga: "saturando baixo"`);
  }


  return uniqCI(out);
}

/**
 * Validação/normalização obrigatória do campo uncertainties
 * - garante array de string
 * - garante formato label: "quote"
 * - injeta o pré-scan se estiver faltando
 */
export function enforceUncertainties(
  student_facts: AnyObj,
  raw_text: string,
): AntiEvasionResult {
  const sf = structuredClone(student_facts || {});
  const vitals = sf?.vitals ?? null;

  const prescan = preScanAssertiveClaims(raw_text, vitals);

  const reasons: string[] = [];
  let forced = false;

  // 1) sanitiza tipo
  if (!Array.isArray(sf.uncertainties)) {
    sf.uncertainties = [];
    forced = true;
    reasons.push("uncertainties_missing_or_not_array");
  }

  sf.uncertainties = sf.uncertainties.map((u: any) => {
    if (typeof u === "string") return u.trim();
    if (u && typeof u === "object") {
      // tenta uma string segura
      const parts = Object.entries(u).map(([k, v]) => `${k}: ${String(v)}`);
      return parts.join(" | ").trim();
    }
    return String(u).trim();
  }).filter(Boolean);

  // 2) força formato label: "quote"
  const fixed: string[] = [];
  for (const line of sf.uncertainties) {
    if (/^.+?:\s*".+"$/.test(line)) {
      fixed.push(line);
      continue;
    }

    // se vier “solto”, transforma em formato canônico
    forced = true;
    reasons.push("uncertainty_bad_format_fixed");
    const safe = line.length > 180 ? line.slice(0, 177) + "..." : line;
    fixed.push(`Afirmação sem evidência: "${safe}"`);
  }
  sf.uncertainties = uniqCI(fixed);

  // 3) injeta prescan (se faltou)
  const existing = new Set(sf.uncertainties.map(norm));
  const missing = prescan.filter((p) => !existing.has(norm(p)));

  if (missing.length > 0) {
    forced = true;
    reasons.push("prescan_injected");
    sf.uncertainties = uniqCI(sf.uncertainties.concat(missing));
  }

  return { assertions: sf.uncertainties, forced, reasons };
}

/**
 * Se o Teacher “não denunciar” (K vazio/ignorado), a gente patcha.
 * Não muda clínica, só garante que a evidência determinística aparece no output.
 */
export function enforceTeacherSectionK(teacher_output: AnyObj, uncertainties: string[]) {
  if (!teacher_output || !Array.isArray(teacher_output.sections)) return teacher_output;
  const t = structuredClone(teacher_output);

  const uNorm = new Set(uncertainties.map(norm));
  if (uNorm.size === 0) return t;

  let k = t.sections.find((s: any) => s?.key === "K");
  if (!k) {
    k = { key: "K", title: "Segurança/Red Flags", findings: [], missing: [] };
    t.sections.push(k);
  }

  if (!Array.isArray(k.findings)) k.findings = [];
  const kExisting = new Set(k.findings.map(norm));

  const toAdd = uncertainties.filter((u) => !kExisting.has(norm(u)));
  if (toAdd.length > 0) {
    k.findings = uniqCI(k.findings.concat(toAdd));
  }

  return t;
}
