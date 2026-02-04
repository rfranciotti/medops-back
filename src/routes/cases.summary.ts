import type { FastifyPluginAsync } from "fastify";
import { getCaseById } from "../repo/cases.repo.ts";

/**
 * String helper: transforma qualquer coisa em string “segura”.
 */
function toStr(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function uniqClean(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines
    .map((l) => l.trim())
    .filter((l) => l && !/unknown|null/i.test(l))
    .filter((l) => {
      const lower = l.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
}

function toLines(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v))
    return v
      .map(toStr)
      .map((s) => s.trim())
      .filter(Boolean);
  const s = toStr(v);
  return s ? [s] : [];
}

function bulletize(lines: string[], prefix = "• "): string[] {
  return lines.map((l) => `${prefix}${l}`);
}

/**
 * Extrai “findings” e “missing” sem inferência:
 * só pega o que estiver explicitamente em campos típicos.
 */
function extractFindings(section: any): string[] {
  const direct = toLines(section?.findings)
    .concat(toLines(section?.notes))
    .concat(toLines(section?.attention))
    .concat(toLines(section?.observations));

  const objArr = (arr: any): string[] =>
    Array.isArray(arr)
      ? arr
          .map(
            (x) =>
              toStr(x) ||
              toStr(x?.text) ||
              toStr(x?.value) ||
              toStr(x?.message),
          )
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  return direct
    .concat(objArr(section?.findings))
    .concat(objArr(section?.notes))
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractMissing(section: any): string[] {
  const direct = toLines(section?.missing)
    .concat(toLines(section?.gaps))
    .concat(toLines(section?.missing_items));

  const objArr = (arr: any): string[] =>
    Array.isArray(arr)
      ? arr
          .map(
            (x) =>
              toStr(x) ||
              toStr(x?.text) ||
              toStr(x?.value) ||
              toStr(x?.message),
          )
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  return direct
    .concat(objArr(section?.missing))
    .concat(objArr(section?.gaps))
    .map((s) => s.trim())
    .filter(Boolean);
}

const REASON_HUMAN_MAP: Record<string, string> = {
  hard_risk_spo2_lt_92: "HARD RISK: (SpO₂) abaixo de 92%",
  hard_risk_neuro_change: "HARD RISK: Alteração neurológica aguda",
  uncertainty: "Incerteza clínica detectada",
  operational_chaos: "Cenário de caos operacional",
  documentation_risk: "Risco de registro incompleto",
  soft_risk_plus_uncertainty: "SOFT RISK: Risco clínico com incerteza",
  soft_risk_plus_chaos: "SOFT RISK: Risco clínico com caos",
  skip_safe_case: "Caso sem alertas críticos",
};

function getGateMetadata(c: any) {
  const g = c?.gate_output || c?.gate || c?.gate_result;
  const v = c?.student_facts?.vitals;
  const ot = c?.student_facts?.oxygen_therapy;
  if (!g) return null;

  const vitalsStrings: string[] = [];
  if (v?.bp_systolic && v?.bp_diastolic) {
    vitalsStrings.push(`PA: ${v.bp_systolic}x${v.bp_diastolic} mmHg`);
  }
  
  const hrVal = v?.hr || v?.fc || v?.heart_rate;
  if (hrVal) {
    vitalsStrings.push(`FC: ${hrVal} bpm`);
  }

  const hasIn = v?.spo2_initial;
  const hasOn = v?.spo2_on_o2;

  let o2Label = "";
  if (ot?.device) {
    o2Label = `O₂ ${ot.device}`;
    if (ot.flow_l_min) o2Label += ` ${ot.flow_l_min}L/min`;
  } else if (ot?.flow_l_min) {
    o2Label = `O₂ ${ot.flow_l_min}L/min`;
  }

  if (hasIn && hasOn) {
    const labelOn = o2Label ? ` (${o2Label})` : "";
    vitalsStrings.push(`SpO₂: ${hasIn}% (AA) → ${hasOn}%${labelOn}`);
  } else {
    if (hasIn) vitalsStrings.push(`SpO₂: ${hasIn}% (AA)`);
    if (hasOn) {
      const labelOn = o2Label ? ` (${o2Label})` : "";
      vitalsStrings.push(`SpO₂: ${hasOn}%${labelOn}`);
    }
  }

  // Shock Index (calc - internal only, removed from UI)


  let alertEvidences: string[] = [];
  if (g.reason === "hard_risk_spo2_lt_92") {
    alertEvidences = vitalsStrings.filter((s) => s.includes("SpO₂"));
  } else if (g.reason === "hard_risk_neuro_change") {
    const neuro = c?.student_facts?.physical_exam?.neuro;
    if (neuro) {
      const cleanNeuro = String(neuro).replace(/^alteração\s+do\s+estado\s+mental\s*\/\s*/i, "").trim();
      alertEvidences.push(`Neuro: ${cleanNeuro}`);
    } else {
      // Fallback: se não tem neuro estruturado, pega trecho do texto que disparou o gate
      const neuroText = (c.raw_text || "").match(/\b(confus[ao]|desorientad[oa]|rebaixamento|sonolent[oa])\b/i);
      if (neuroText) alertEvidences.push(`Alteração mental: "${neuroText[0]}"`);
    }
  } else {
    alertEvidences = [...vitalsStrings];
  }

  let reasonHuman = REASON_HUMAN_MAP[g.reason] || g.reason;

  if (g.reason.startsWith("hard_risk_") && !reasonHuman.startsWith("HARD RISK:")) {
    reasonHuman = `HARD RISK: ${reasonHuman}`;
  } else if (g.reason.startsWith("soft_risk_") && !reasonHuman.startsWith("SOFT RISK:")) {
    reasonHuman = `SOFT RISK: ${reasonHuman}`;
  }

  return {
    reason_code: g.reason,
    reason_human: reasonHuman,
    evidences: alertEvidences,
    vitals: vitalsStrings,
  };
}

function getClinicalScores(c: any) {
  const p = c?.student_facts?.patient;
  const v = c?.student_facts?.vitals;
  const scores: any = {};

  if (p?.weight_kg && p?.height_m && p.height_m > 0) {
    const imc = p.weight_kg / (p.height_m * p.height_m);
    scores.imc = { value: Number(imc.toFixed(1)) };
  }

  if (v?.hr && v?.bp_systolic) {
    const hr = v.hr;
    const sbp = v.bp_systolic;
    if (hr >= 20 && hr <= 250 && sbp >= 50 && sbp <= 300) {
      const si = hr / sbp;
      if (si >= 0.8) {
        let alert = si > 0.9 ? "🚨" : "⚠️";
        scores.shock_index = { value: Number(si.toFixed(2)), alert };
      }
    }
  }

  return scores;
}

export const casesSummaryRoute: FastifyPluginAsync = async (app) => {
  app.get("/cases/:id/summary", async (req, reply) => {
    const { id } = req.params as any;
    const c = getCaseById(id);
    if (!c)
      return reply.code(404).send({ ok: false, message: "Case not found." });

    const text = (c.raw_text || "").toLowerCase();
    const sf = c.student_facts;
    const teacher = c.teacher_output;
    const sections = teacher?.sections || [];
    const paMatches = text.match(/\b(\d{2,3})[x\/](\d{2,3})\b/g);

    // 1. Coleta e Limpeza de Incertezas
    const rawUncertainties: string[] = [];
    if (sf?.uncertainties) rawUncertainties.push(...sf.uncertainties);
    sections.forEach((s: any) => {
      if (s.key === "K") rawUncertainties.push(...extractFindings(s));
    });
    if (paMatches && paMatches.length > 1)
      rawUncertainties.push(`⚠️ CONFLITO DE PA: ${paMatches.join(", ")}`);

    const rawLowerText = text;
    if (rawLowerText.includes("hipertenso?") || rawLowerText.includes("hipertenso ?")) {
      rawUncertainties.push(`Hipertensão incerta: "Hipertenso?" (texto contém '?')`);
    }

    const opIssues = sf?.operational_context?.issues || [];
    const clean = (arr: string[]) =>
      uniqClean(arr)
        .map((s) => s.replace(/[\"';]|chief_complaint:?\s*/gi, "").trim())
        .filter((s) => !opIssues.includes(s));

    const uncList = clean(rawUncertainties);

    // 2. Evidence Quality Gate (Regra de Ouro)
    const evidence_quality: Record<string, string> = {
      vitals: "objective",
      oxygen: "objective",
      neuro: "objective",
      ausculta: "objective",
      medications: "objective",
      history: "objective",
      exams: "objective",
      bp: (sf?.vitals?.bp_systolic && sf?.vitals?.bp_diastolic) ? "objective" : "missing",
      antibiotic: "objective",
    };

    // 2.1 Coleta de Qualidade (Independente de formato/idioma)
    uncList.forEach((u) => {
      const uLow = u.toLowerCase();
      if (uLow.includes("bp vague") || uLow.includes("pa vago") || uLow.includes("pa vaga") || uLow.includes("bp vago")) evidence_quality.bp = "vague";
      if (/uncertain|incerto|antibiotic|antibi[óo]tico/i.test(uLow)) evidence_quality.antibiotic = "uncertain";
      if (/unknown|desconhecido|medication|rem[ée]dio|medica[çc][ãa]o/i.test(uLow)) evidence_quality.medications = "unknown";
      if (/third-party|terceiro|history|hist[óo]rico/i.test(uLow)) evidence_quality.history = "third_party";
      if (/exam|exame|raio-x|rx|sangue/i.test(uLow)) evidence_quality.exams = "uncertain";
    });

    const UNC_LABELS: Record<string, string> = {
      "bp vague": "PA vaga",
      "bp vago": "PA vaga",
      "pa vaga": "PA vaga",
      "pa vago": "PA vaga",
      "antibiotic uncertain": "Antibiótico incerto",
      "antibiótico incerto": "Antibiótico incerto",
      "unknown medications": "Medicações crônicas desconhecidas",
      "medicações crônicas desconhecidas": "Medicações crônicas desconhecidas",
      "médicos crônicos desconhecidos": "Medicações crônicas desconhecidas",
      "resp history third-party": "História respiratória (terceiros)",
      "história respiratória terceirizada": "História respiratória (terceiros)",
      "história respiratória (terceiros)": "História respiratória (terceiros)",
      "saturação contraditória": "Saturação contraditória",
      "spo2 vague": "Saturação vaga",
      "saturação vaga": "Saturação vaga",
      "fc incerta": "FC incerta",
      "achado pulmonar vago": "Achado pulmonar vago",
      "achado vago": "Achado vago",
      "diagnóstico incerto": "Diagnóstico incerto",
      "diagnóstico sem evidência": "Diagnóstico sem evidência",
      "diagnóstico afirmado sem evidência objetiva": "Diagnóstico afirmado sem evidência objetiva",
      "gravidade subjetiva": "Gravidade subjetiva",
      "gravidade afirmada sem dados objetivos": "Gravidade afirmada sem dados objetivos",
      "gravidade afirmada sem dados": "Gravidade afirmada sem dados",
      "conduta sem base": "Conduta sem base",
      "antibiótico iniciado sem documentação de critérios clínicos": "Antibiótico iniciado sem documentação de critérios clínicos",
      "antibiótico iniciado sem documentação": "Antibiótico iniciado sem documentação",
      "unsupported authoritative statements": "Afirmação sem evidência",
    };

    // 2.2 Processamento Estrito para EXIBIÇÃO das Incertezas (PT-BR, Quote, Dedupe)
    const finalUncertainties: string[] = [];
    const uncSeen = new Set<string>();

    const hasHR = !!(sf?.vitals?.hr || sf?.vitals?.fc || sf?.vitals?.heart_rate);
    const hasBP = !!(sf?.vitals?.bp_systolic);
    const hasSat = !!(sf?.vitals?.spo2_initial || sf?.vitals?.spo2_on_o2);
    const hasTemp = !!sf?.vitals?.temp;

    uncList.forEach((u) => {
      // 1. Regex de validade para exibição: apenas com citação entre aspas
      if (!/^.+?:\s*".+"$/.test(u)) return;

      // 2. Canonização de Label e Idioma
      let [label, quote] = u.split(/:\s*(.+)/);
      if (!quote) return;

      const cleanLabel = label.toLowerCase().trim();

      // BLOCKER: Se já temos o dado objetivo, NÃO listamos incertezas subjetivas sobre o mesmo vital.
      if (hasHR && (cleanLabel.includes("fc") || cleanLabel.includes("heart rate") || cleanLabel.includes("frequência cardíaca"))) return;
      if (hasBP && (cleanLabel.includes("bp") || cleanLabel.includes("pa") || cleanLabel.includes("pressão") || cleanLabel.includes("blood pressure"))) return;
      if (hasSat && (cleanLabel.includes("spo2") || cleanLabel.includes("saturação") || cleanLabel.includes("sat"))) return;
      if (hasTemp && (cleanLabel.includes("temp") || cleanLabel.includes("febre"))) return;

      const canonLabel = UNC_LABELS[cleanLabel] || label;
      
      let finalQuote = quote.trim().replace(/^"(.*)"$/, "$1"); // remove aspas
      // Anti-redundância: se a quote começa com o próprio label canonizado ou labels internos vãos
      finalQuote = finalQuote.replace(/^(achado vago|achado pulmonar vago|diagnóstico incerto|incerto|uncertain|unsupported authoritative statements|vague|vago|vaga):\s*/i, "").trim();
      
      const canonLine = `${canonLabel}: "${finalQuote}"`;

      // 3. Dedupe exato
      if (!uncSeen.has(canonLine.toLowerCase())) {
        finalUncertainties.push(canonLine);
        uncSeen.add(canonLine.toLowerCase());
      }
    });

    // 3. Coleta de Achados e Pendências
    const rawFindings: string[] = [];
    const rawMissing: string[] = [];

    sections.forEach((s: any) => {
      if (s.key === "K") return;
      rawFindings.push(...extractFindings(s));
      rawMissing.push(...extractMissing(s));
    });

    // 4. Renderização de Achados (Regra de Ouro)
    // --- SEÇÃO 4: DETERMINISTIC MERGE (CORE FIX) ---

    // 4.1. Antecedentes (Fonte: Student Facts + Negativos Determinísticos)
    const enrichHistory = (): string[] => {
       const history: string[] = [];
       const rawLow = text; // já é c.raw_text.toLowerCase()

       // A. Comorbidades e Histórico (Student Facts)
       const comorb = sf?.comorbidities || [];
       const pmh = sf?.past_medical_history || [];
       const combined = uniqClean([...comorb, ...pmh]).filter(h => {
          const hLow = h.toLowerCase();
          return !finalUncertainties.some(u => u.toLowerCase().includes(hLow));
       });

       if (combined.length > 0) {
          history.push(`Comorbidades: ${combined.join(", ")}`);
       }

       // B. Tabagismo
       if (rawLow.includes("ex-tabagista") || rawLow.includes("extabagista")) {
          history.push("Tabagismo: ex-tabagista");
       } else if (rawLow.includes("tabagista") || rawLow.includes("fumante")) {
          history.push("Tabagismo: ativo");
       } else if (rawLow.includes("nega tabagismo") || rawLow.includes("não fuma") || rawLow.includes("não é fumante")) {
          history.push("Tabagismo: negado");
       }

       // C. Alergias e Cirurgias (Negativos e Positivos Fatuais)
       if (rawLow.includes("nega alergia") || rawLow.includes("sem alergia") || rawLow.includes("alergias: nega") || rawLow.includes("nega alergias")) {
          history.push("Alergias: negadas");
       } else {
          const allerg = (sf?.medications || []).filter((m: any) => String(m?.name || m).toLowerCase().includes("alergia"));
          if (allerg.length > 0) history.push(`Alergias: ${allerg.map((a: any) => toStr(a?.name || a)).join(", ")}`);
       }

       if (rawLow.includes("nega cirurgia") || rawLow.includes("sem cirurgia") || rawLow.includes("sem cirurgias importantes") || rawLow.includes("nega cirurgias")) {
          history.push("Cirurgias prévias: negadas");
       }

       // D. Medicações Habituais
       if (rawLow.includes("medicações habituais") || rawLow.includes("remedios habituais") || rawLow.includes("medicações de uso contínuo") || rawLow.includes("uso de medicação habitual")) {
          const medsMatch = (c.raw_text || "").match(/(uso de medicações habituais[^.]*|medicações habituais[^.]*|remédios habituais[^.]*|medicações de uso contínuo[^.]*|uso de medicação habitual[^.]*)/i);
          if (medsMatch) history.push(`Medicações habituais: ${medsMatch[0].trim()}`);
          else history.push("Medicações habituais: em uso (conforme relato)");
       }

       return history;
    };

    // 4.2. Conduta / Plano (Fonte: Student Facts + Texto Determinístico)
    // Retorna: { initiated: string[], planned: string[] }
    const enrichPlan = (): { initiated: string[], planned: string[] } => {
       const initiated: string[] = [];
       const planned: string[] = [];
       const rawLow = text;
       const rawOriginal = c.raw_text || "";

       // A. Oxigenioterapia
       const ot = sf?.oxygen_therapy;
       if (rawLow.includes("o2") || rawLow.includes("oxigênio") || rawLow.includes("oxigenio") || ot?.device || ot?.flow_l_min) {
          const device = toStr(ot?.device);
          const flow = ot?.flow_l_min ? `${ot.flow_l_min}L/min` : "";
          const combined = `${device}${device && flow ? " " : ""}${flow}`.trim();
          if (combined && combined !== "null" && combined !== "") {
             initiated.push(`Oxigenioterapia: ${combined}`);
          } else if (rawLow.includes("o2") || rawLow.includes("oxigenio")) {
             initiated.push("Oxigenioterapia iniciada/mantida");
          }
       }

       // B. Condutas Determinísticas (verificar se é condicional com contexto amplo)
       const conds = [
          { name: "Hidratação EV", key: "hidratacao", regex: /\bhidrata[çc][ãa]o\s+ev\b|\bsoro\b|\bfluido\b/i },
          { name: "Analgesia", key: "analgesia", regex: /\banalgesia\b|\bdipirona\b|\btramal\b|\bmorfina\b/i },
       ];

       conds.forEach(cnd => {
          if (cnd.regex.test(rawLow)) {
             // Extract sentence context to check for "se necessário"
             const sentenceMatch = rawOriginal.match(new RegExp(`[^.]*${cnd.key}[^.]*`, 'i'));
             // Check if conditional (fixed regex: necess[aá]rio instead of nece[scs][sá]rio)
             const isConditional = sentenceMatch && /se\s+necess[aá]rio/i.test(sentenceMatch[0]);
             
             if (isConditional) {
                planned.push(`${cnd.name} (se necessário)`);
             } else {
                initiated.push(cnd.name);
             }
          }
       });

       // C. Antibioticoterapia - APENAS se não houver antibióticos específicos listados
       const hasAntibiotics = /\b(ceftriaxona|azitromicina|sulfametoxazol|trimetoprima|penicilina|amoxicilina)\b/i.test(rawLow);
       const mentionsGenericATB = /\bantibiotico\b|\bantibiótico\b|\batb\b/i.test(rawLow);
       
       // D. Medicações ativas (Student Facts) - primeiro para saber se há antibióticos
       const activeMeds = (sf?.medications || []).map((m: any) => toStr(m?.name || m)).filter(Boolean);
       const hasSpecificAntibiotics = activeMeds.some((m: string) => /ceftriaxona|azitromicina|sulfametoxazol|trimetoprima|penicilina|amoxicilina/i.test(m));

       // Se menciona antibiótico genérico MAS não tem específicos, adiciona genérico
       if (mentionsGenericATB && !hasAntibiotics && !hasSpecificAntibiotics) {
          initiated.push("Antibioticoterapia");
       }

       // E. Monitorização e Acompanhamento (termos específicos documentados)
       if (rawLow.includes("manter monitorização") || rawLow.includes("monitorização no ps")) {
          initiated.push("Monitorização no PS");
       } else if (rawLow.includes("monitoriz") || rawLow.includes("monitoria") || rawLow.includes("monitor")) {
          initiated.push("Monitorização contínua");
       }

       if (rawLow.includes("segue sob minha avaliação") || rawLow.includes("sob avaliação")) {
          initiated.push("Sob avaliação médica");
       } else if (rawLow.includes("segue em observação") || rawLow.includes("segue comigo")) {
          initiated.push("Em observação médica");
       }

       // F. Medicações específicas (Student Facts)
       activeMeds.forEach((m: string) => {
          const mLow = m.toLowerCase();
          if (/(has|dm|alergia|hipertens|diabet)/i.test(mLow)) return;
          if (!initiated.some(p => p.toLowerCase().includes(mLow))) initiated.push(`Medicação: ${m}`);
       });

       return { 
          initiated: uniqClean(initiated), 
          planned: uniqClean(planned) 
       };
    };

    // 4.3. Exames Solicitados (Fonte: Student Facts + Texto - SEM FILTRO)
    const enrichRequestedExams = (): string[] => {
       const rawLow = text;
       const exams: string[] = [];

       // EXPANDED: Add ALL common lab and imaging tests
       const cfg = [
          // Imaging
          { name: "RX de tórax", regex: /\b(rx|raio-?x)\s+(de\s+)?t[óo]rax\b/i },
          { name: "TC de tórax", regex: /\b(tc|tomografia)\s+(de\s+)?t[óo]rax\b/i },
          { name: "ECG", regex: /\becg\b|\beletrocardiograma\b/i },
          { name: "Ecocardiograma", regex: /\becocardiograma\b|\beco\s+cardio\b/i },
          { name: "Doppler de MMII", regex: /\bdoppler(\s+de)?\s+mmii\b/i },
          
          // Lab tests - Blood
          { name: "Hemograma", regex: /\bhemograma\b/i },
          { name: "Eletrólitos", regex: /\beletr[óo]litos?\b/i },
          { name: "Função renal", regex: /\bfun[çc][ãa]o\s+renal\b|\bcreatinina\b|\bur[ée]ia\b/i },
          { name: "TGO/TGP", regex: /\btgo\b|\btgp\b|\btransaminases?\b/i },
          { name: "PCR", regex: /\bpcr\b(?!\s+respirat)/i }, // PCR lab, not respiratory PCR
          { name: "Procalcitonina", regex: /\bprocalcitonina\b/i },
          { name: "D-dímero", regex: /\bd-?d[íi]mero\b/i },
          { name: "Troponina", regex: /\btroponina(\s+seriada)?\b/i },
          { name: "Gasometria arterial", regex: /\bgasometria(\s+arterial)?\b/i },
          { name: "Coagulograma", regex: /\bcoagulograma\b/i },
          { name: "Lactato", regex: /\blactato\b/i },
          { name: "BNP", regex: /\bbnp\b/i },
          { name: "Hemoculturas", regex: /\bhemoculturas?\b/i },
          
          // Urine
          { name: "Urina tipo I", regex: /\burina\s+tipo\s+i\b|\beas\b|\burin[aá]lise\b/i },
          
          // Viral/Respiratory
          { name: "Sorologias virais", regex: /\bsorologias?\s+virais?\b/i },
          { name: "PCR respiratório", regex: /\bpcr\s+respirat[óo]rio\b/i },
       ];

       const isRequested = /\b(solicitei|pedi|pedido|solicitado|aguardando|aguardo|aguardamos|protocolo)\b/i.test(rawLow);

       // Extract from text using patterns
       if (isRequested) {
          cfg.forEach(ex => {
             if (ex.regex.test(rawLow)) exams.push(ex.name);
          });
       }

       // CRITICAL: Extract ALL from student_facts.exams and pending_exams (NO FILTER)
       const sfExams = (sf?.pending_exams || []).concat((sf?.exams || []).map((e: any) => toStr(e?.name || e)));
       uniqClean(sfExams).forEach((e: string) => {
          if (!exams.some(ex => ex.toLowerCase() === e.toLowerCase())) exams.push(e);
       });

       // CRITICAL: Extract ALL from student_facts.lab_results (NO FILTER)
       const labResults = sf?.lab_results || [];
       labResults.forEach((lab: any) => {
          const testName = toStr(lab?.test || lab?.name);
          if (testName && !exams.some(ex => ex.toLowerCase() === testName.toLowerCase())) {
             exams.push(testName);
          }
       });

       // SEMANTIC DEDUPLICATION: Prefer more specific exam names
       const normalized = uniqClean(exams);
       const deduped: string[] = [];
       
       // Rules: Keep the most specific version
       const dedupRules = [
          { generic: /^tc de t[óo]rax$/i, specific: /tc de t[óo]rax com contraste/i },
          { generic: /^pcr respirat[óo]rio$/i, specific: /pcr respirat[óo]rio completo/i },
          { generic: /^troponina$/i, specific: /troponina seriada/i },
          { generic: /^gasometria$/i, specific: /gasometria arterial/i },
       ];

       normalized.forEach(exam => {
          const examLow = exam.toLowerCase();
          let skip = false;

          // Check if this is a generic version and a specific version exists
          for (const rule of dedupRules) {
             if (rule.generic.test(examLow)) {
                // Check if we have the specific version
                if (normalized.some(e => rule.specific.test(e.toLowerCase()))) {
                  skip = true; // Skip the generic, keep the specific
                  break;
                }
             }
          }

          if (!skip) deduped.push(exam);
       });

       return deduped;
    };

    // 4.4. Contexto Operacional / Documental (Fonte: Texto Explícito)
    const enrichOperationalContext = (): string[] => {
       const context: string[] = [];
       const rawLow = text;

       // A. Limitações documentais explícitas
       if (rawLow.includes("sem tempo para") && rawLow.includes("anamnese")) {
          const match = (c.raw_text || "").match(/(sem tempo para [^.]+)/i);
          if (match) context.push(`⚠️ ${match[0].trim()}`);
       }

       // B. Estado geral do paciente
       if (rawLow.includes("regular estado geral")) {
          context.push("Estado geral: regular");
       } else if (rawLow.includes("bom estado geral")) {
          context.push("Estado geral: bom");
       } else if (rawLow.includes("mau estado geral") || rawLow.includes("mal estado geral")) {
          context.push("Estado geral: mau");
       }

       // C. Outras observações operacionais (citações do médico, não avaliação do sistema)
       // FIX: Extrair citação COMPLETA sem truncamento
       if (rawLow.includes("quadro evidente") || rawLow.includes("quadro bem típico") || rawLow.includes("sem muita dificuldade diagnóstica")) {
          // Extract complete sentence (até o próximo ponto)
          const completeMatch = (c.raw_text || "").match(/(História bem típica[^.]+diagnóstica|sem muita dificuldade diagnóstica|quadro [ée] evidente)/i);
          if (completeMatch) {
             context.push(`Observação do médico: "${completeMatch[0].trim()}"`);
          }
       }

       if (rawLow.includes("aguardando exames") || rawLow.includes("aguardo") && rawLow.includes("resultado")) {
          context.push("Status: aguardando resultados de exames");
       }

       return context;
    };

    // 4.5. Resumo dos Achados (Fonte: Teacher Output + Student Facts Acute)
    const enrichFindings = (findings: string[]): string[] => {
      const enriched: string[] = [];
      const rawLow = text;

      // A. Dados Físicos (Student Facts)
      const p = sf?.patient;
      if (p?.weight_kg || p?.height_m) {
        let line = "Dados físicos: ";
        if (p.weight_kg) line += `${p.weight_kg}kg`;
        if (p.height_m) line += `${line.includes("kg") ? " / " : ""}${String(p.height_m).replace(".", ",")}m`;
        enriched.push(line);
      }

      // B. Queixa Principal
      if (sf?.presenting_problem?.chief_complaint) {
        let qp = `Queixa principal: ${sf.presenting_problem.chief_complaint}`;
        if (sf.presenting_problem.onset) qp += ` (início: ${sf.presenting_problem.onset})`;
        else if (sf.presenting_problem.duration) qp += ` (${sf.presenting_problem.duration})`;
        enriched.push(qp);
      }

      // B.1. Sintomas Adicionais (Student Facts - additional_symptoms)
      const additionalSymptoms = sf?.presenting_problem?.additional_symptoms || [];
      if (additionalSymptoms.length > 0) {
        const symptomsClean = uniqClean(additionalSymptoms.map(toStr).filter(Boolean));
        if (symptomsClean.length > 0) {
          enriched.push(`Sintomas associados: ${symptomsClean.join(", ")}`);
        }
      }

      // C. Fatos Clínicos Agudos
      if (rawLow.includes("sepse")) enriched.push("Suspeita declarada: sepse");
      if (rawLow.includes("nega dor torácica")) enriched.push("Nega dor torácica");
      if (rawLow.includes("consciente") && rawLow.includes("orientado")) enriched.push("Consciente e orientado");
      if (rawLow.includes("lúcido")) enriched.push("Lúcido");
      
      // C.1. Estado do Paciente (dispneico, etc)
      if (rawLow.includes("dispneico") || rawLow.includes("dispnéico")) enriched.push("Paciente dispneico");

      // D. Vitais Numéricos
      const v = sf?.vitals;
      if (v?.spo2_initial) enriched.push(`SpO₂ inicial: ${v.spo2_initial}% em AA`);
      if (v?.spo2_on_o2) enriched.push(`SpO₂ sob oxigênio: ${v.spo2_on_o2}%`);
      if (v?.temp) enriched.push(`Temperatura: ${v.temp}ºC`);

      // E. Exame Físico Objetivo (Student Facts - ALL findings)
      const allPhysicalFindings = sf?.physical_exam?.findings || [];
      allPhysicalFindings.forEach((finding: any) => {
        const findingStr = toStr(finding);
        if (!findingStr) return;
        const fLow = findingStr.toLowerCase();
        
        // Skip vitals that are already shown in dedicated vitals section
        if (/(sat|spo2|fc|pa|temp)\s+\d/i.test(fLow)) return;
        
        // Ausculta findings
        if (/\b(estertor|ronco|murm|sibilo|respirat|pulm[oã]o)\b/i.test(fLow)) {
          if (!enriched.some(e => e.toLowerCase().includes(findingStr.toLowerCase()))) {
            enriched.push(`Ausculta: ${findingStr}`);
          }
          return;
        }
        
        // Other physical exam findings
        if (!enriched.some(e => e.toLowerCase().includes(findingStr.toLowerCase()))) {
          enriched.push(`Exame físico: ${findingStr}`);
        }
      });
      
      // E.1. Abdome e Extremidades (explicit text extraction)
      if (rawLow.includes("abdome") && (rawLow.includes("sem alterações") || rawLow.includes("sem alteracao"))) {
        if (!enriched.some(e => e.toLowerCase().includes("abdome"))) {
          enriched.push("Abdome: sem alterações");
        }
      }
      
      if (rawLow.includes("extremidades perfundidas")) {
        if (!enriched.some(e => e.toLowerCase().includes("extremidades"))) {
          enriched.push("Extremidades: perfundidas");
        }
      }

      if (sf?.physical_exam?.neuro) enriched.push(`Neurológico: ${sf.physical_exam.neuro}`);

      // F. Filtro de Auditoria (Teacher Output)
      findings.forEach((f: string) => {
        const fLow = f.toLowerCase();
        
        // REGRA DE OURO: Bloqueia o que já está categorizado
        if (/(hipertens|diabet|has|dm|tabag|alergia|cirurg|habitu|uso cont[ií]nuo)/i.test(fLow)) return; 
        if (/(oxig[êe]nio|o2|soro|fluido|hidrata[çc][ãa]o|analgesi|atb|antibiotico|monitor)/i.test(fLow)) return; 
        if (/(rx|raio|tc|tomograf|ecg|eletro|exame|laborat|sangue|colhido|pedido|aguardando)/i.test(fLow)) return; 
        if (/(temp|press[atilde]o|pa|spo2|sat)/i.test(fLow)) return; 
        if (/(normal|bom|boa|ruim|ok|est[aacute]vel|sem\s+particularidades)/i.test(fLow) && !/\d/.test(fLow)) return;
        
        enriched.push(f);
      });

      return uniqClean(enriched);
    };

    // 5. Coleta de Pendências Canonizadas
    const pendingSet = new Set<string>();
    const missingRaw = [...rawMissing];
    
    [...rawFindings, ...rawUncertainties].forEach((txt: string) => {
      const tLow = txt.toLowerCase();
      if (hasHR && /(fc|hr|heart|bpm|frequ[êe]ncia)/i.test(tLow)) return;
      if (hasBP && /(pa|bp|press[ãa]o|sist[óo]lica|diast[óo]lica)/i.test(tLow)) return;
      if (hasSat && /(spo2|sat|satura[çc][ãa]o)/i.test(tLow)) return;
      if (hasTemp && /(temp|febre)/i.test(tLow)) return;

      if (
        /colhido|pedido|aguardando|solicitado|pendente|realizado/i.test(tLow) ||
        (/oxig[êe]nio/i.test(tLow) && !/fluxo|l\/min|cateter|m[aacute]scara/i.test(tLow)) ||
        /n[ãa]o\s+(registrad[oa]|documentad[oa]|aferid[oa]|informad[oa]|not\s+documented|missing)/i.test(tLow) ||
        (/temp|press[atilde]o|bp|pa|sist[óo]lica|diast[óo]lica|spo2|satura[çc][atilde]o|fc[:\s]|cardiaca/i.test(tLow) && !/\d/.test(tLow))
      ) {
        missingRaw.push(txt);
      }
    });

    if (sf?.pending_exams) missingRaw.push(...sf.pending_exams);

    const explicitNoVitals = /\b(n[ãa]o\s+(anotei|registrei|tenho|coloquei)|sem)\s+(sinais\s+vitais|vitais|dados)\b/i.test(text);
    let bpGap = false, tempGap = false, hrGap = false, spo2Gap = false;
    
    missingRaw.forEach(m => {
      const mLow = m.toLowerCase();
      if (/no\s+explicit|not\s+documented|timing\s+not|allergies\s+not/i.test(mLow)) return;
      if (/age|sex|dob|birth|birthdate/i.test(mLow)) return;
      
      if (/(bp|pa|press[ãa]o)/i.test(mLow) && !sf?.vitals?.bp_systolic) bpGap = true;
      else if (/temp/i.test(mLow) && !sf?.vitals?.temp) tempGap = true;
      else if (/(fc|hr|heart|bpm)/i.test(mLow) && !hasHR) hrGap = true;
      else if (/(spo2|sat)/i.test(mLow) && !hasSat) spo2Gap = true;
      else pendingSet.add(m);
    });

    const isBenign = /\b(exame\s+f[íi]sico\s+normal|sem\s+queixas|saturando\s+bem|est[aacute]vel|quadro\s+leve)\b/i.test(text);
    const hasGravity = /\b(sepse|choque|cr[íi]tico|grave|urgente|emerg[êe]ncia|mal|ruim|caiu|baixo|hipotens|confus[ao]|desorientad[oa]|dispneia|falta de ar|dor|suando frio|sudorese)\b/i.test(text);

    let gateData = getGateMetadata(c);
    if (gateData && gateData.reason_code === "uncertainty" && isBenign && !hasGravity) {
       gateData.reason_code = "skip_safe_case";
       gateData.reason_human = REASON_HUMAN_MAP["skip_safe_case"];
    }

    const isOperational = gateData?.reason_code === "documentation_risk" || gateData?.reason_code === "operational_chaos";

    if (explicitNoVitals) { bpGap = true; tempGap = true; hrGap = true; spo2Gap = true; }

    const clinicalHistory = enrichHistory();
    const clinicalPlan = enrichPlan();
    const requestedExams = enrichRequestedExams();
    const auditedFindings = enrichFindings(clean(rawFindings));
    const operationalNotes = enrichOperationalContext();

    console.log("[DEBUG] Case ID:", c.id);
    console.log("[DEBUG] text length:", text.length);
    console.log("[DEBUG] sf exists:", !!sf);
    console.log("[DEBUG] clinicalHistory:", clinicalHistory);
    console.log("[DEBUG] clinicalPlan:", clinicalPlan);
    console.log("[DEBUG] requestedExams:", requestedExams);
    console.log("[DEBUG] auditedFindings:", auditedFindings);
    console.log("[DEBUG] operationalNotes:", operationalNotes);

    const finalMissing: string[] = [];
    if (bpGap) finalMissing.push("PA objetiva (sistólica/diastólica)");
    if (tempGap) finalMissing.push("Temperatura (valor numérico ausente)");
    if (hrGap) finalMissing.push("FC objetiva (valor numérico ausente)");
    if (spo2Gap) finalMissing.push("SpO₂ numérica");

    pendingSet.forEach(p => {
       const pLow = p.toLowerCase();
       if (requestedExams.some(re => pLow.includes(re.toLowerCase()))) return;
       const allPlanItems = [...clinicalPlan.initiated, ...clinicalPlan.planned];
       if (allPlanItems.some((cp: string) => pLow.includes(cp.toLowerCase()))) return;
       if (clinicalHistory.some(ch => pLow.includes(ch.toLowerCase()))) return;
       if (auditedFindings.some(af => pLow.includes(af.toLowerCase()))) return;
       if (isOperational && /internado|fila|sistema|enfermagem|evolui/i.test(pLow)) return;
       if (!finalMissing.some(f => pLow.includes(f.toLowerCase()))) finalMissing.push(p);
    });

    const vIn = sf?.vitals || null;
    const otIn = sf?.oxygen_therapy;
    const hasIn = vIn?.spo2_initial;
    const hasOn = vIn?.spo2_on_o2;

    let o2L = "";
    if (otIn?.device) {
      o2L = `O₂ ${otIn.device}`;
      if (otIn.flow_l_min) o2L += ` ${otIn.flow_l_min}L/min`;
    } else if (otIn?.flow_l_min) {
      o2L = `O₂ ${otIn.flow_l_min}L/min`;
    }

    let spo2V = null;
    if (hasIn && hasOn) spo2V = `${hasIn}% (AA) → ${hasOn}%${o2L ? ` (${o2L})` : ""}`;
    else if (hasIn) spo2V = `${hasIn}% (AA)`;
    else if (hasOn) spo2V = `${hasOn}%${o2L ? ` (${o2L})` : ""}`;

    const vitalsOut = vIn
      ? {
          ...vIn,
          fc: (vIn as any).fc ?? (vIn as any).hr ?? (vIn as any).heart_rate ?? null,
          spo2: (spo2V || (vIn as any).spo2 || (vIn as any).spo2_initial || null),
        }
      : null;

    const patientHeader = sf?.patient?.name || "Nome não informado";

    return reply.send({
      ok: true,
      case_id: c.id,
      patient: { ...(sf?.patient || {}), name: patientHeader },
      vitals: vitalsOut,
      gate: gateData,
      analysis: {
        findings: auditedFindings,
        history: clinicalHistory,
        initiated_interventions: clinicalPlan.initiated,
        planned_interventions: clinicalPlan.planned.length > 0 ? clinicalPlan.planned : null,
        // Manter plan para backward compatibility (pode ser removido depois que bot for atualizado)
        plan: [...clinicalPlan.initiated, ...clinicalPlan.planned],
        requested_exams: requestedExams,
        operational_notes: operationalNotes.length > 0 ? operationalNotes : null,
        missing: uniqClean(clean(finalMissing)),
        uncertainties: finalUncertainties,
        evidence_quality: Object.keys(evidence_quality).length > 0 ? evidence_quality : null,
      },
      clinical_scores: getClinicalScores(c),
      operational_context: sf?.operational_context || null,
      text: "",
    });

  });
};
