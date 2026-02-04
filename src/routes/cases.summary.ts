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

    const sf = c.student_facts;
    const teacher = c.teacher_output;
    const sections = teacher?.sections || [];
    const paMatches = (c.raw_text || "").match(/\b(\d{2,3})[x\/](\d{2,3})\b/g);

    // 1. Coleta e Limpeza de Incertezas
    const rawUncertainties: string[] = [];
    if (sf?.uncertainties) rawUncertainties.push(...sf.uncertainties);
    sections.forEach((s: any) => {
      if (s.key === "K") rawUncertainties.push(...extractFindings(s));
    });
    if (paMatches && paMatches.length > 1)
      rawUncertainties.push(`⚠️ CONFLITO DE PA: ${paMatches.join(", ")}`);

    const rawLowerText = (c.raw_text || "").toLowerCase();
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
    const enrichFindings = (findings: string[]): string[] => {
      const enriched: string[] = [];
      const symptomaticLines: string[] = [];
      const rawText = c.raw_text || "";
      const rawLow = rawText.toLowerCase();

      // A. Cabeçalho Paciente (Peso/Altura)
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
        else if (sf.presenting_problem.duration) {
          let dur = String(sf.presenting_problem.duration).trim();
          if (/^\d+$/.test(dur)) dur += " dias";
          if (!dur.startsWith("há")) dur = `há ${dur}`;
          qp += ` (${dur})`;
        }
        enriched.push(qp);
      }

      // C. Declarações Factuais (Mão de Ferro)
      if (rawLow.includes("sepse")) {
        enriched.push("Suspeita declarada: sepse grave");
      }

      // Antibióticos (Factual)
      const antibiotics: string[] = [];
      if (rawLow.includes("ceftriaxona")) antibiotics.push("Ceftriaxona");
      if (rawLow.includes("azitromicina")) antibiotics.push("Azitromicina");
      
      if (antibiotics.length > 0) {
        enriched.push(`Antibiótico: ${antibiotics.join(" e ")}`);
      } else if (rawLow.includes("antibi")) {
        enriched.push("Antibiótico iniciado (relato do médico)");
      }

      if (rawLow.includes("saturação ruim") || (rawLow.includes("sat") && rawLow.includes("ruim"))) {
        enriched.push("Saturação declarada como ruim");
      }
      if (rawLow.includes("pressão caiu") || rawLow.includes("pa caiu") || rawLow.includes("hipotens")) {
        enriched.push("Relato de queda pressórica");
      }
      if (rawLow.includes("situação crítica") || rawLow.includes("estado crítico")) {
        enriched.push("Estado clínico declarado: crítico");
      }
      if (rawLow.includes("suando frio") || rawLow.includes("sudorese")) {
        enriched.push("Relato de sudorese/suando frio");
      }
      if (rawLow.includes("exame físico normal") || rawLow.includes("exame fisico normal")) {
        enriched.push("Exame físico normal");
      }
      if (rawLow.includes("saturando bem")) {
        enriched.push("Saturando bem");
      }

      // D. Vitais e Oxigênio (Consolidado com Incerteza)
      const hasInitialSpO2 = Number.isFinite(sf?.vitals?.spo2_initial);
      const hasO2SpO2 = Number.isFinite(sf?.vitals?.spo2_on_o2);
      const ot = sf?.oxygen_therapy;

      // Helper para detectar faixas no texto (ex: 91-92, 2 ou 3)
      const findRange = (num: number, contextSuffix: string): string => {
        const pattern = new RegExp(`(${num})\\s*([\\-–/]|ou)\\s*(\\d+)`, "i");
        const m = rawText.match(pattern);
        if (m) return `${m[1]}-${m[3]}${contextSuffix}`;
        return `${num}${contextSuffix}`;
      };

      if (hasInitialSpO2) {
        let satLine = `SpO₂ inicial: ${sf.vitals.spo2_initial}% em ar ambiente`;
        if (hasO2SpO2) {
          const hasOT = ot?.device || ot?.flow_l_min;
          const satOnO2Value = findRange(sf.vitals.spo2_on_o2, "%");
          if (hasOT) {
            const flow = ot?.flow_l_min ? ` ${findRange(ot.flow_l_min, "L/min")}` : "";
            const device = ot?.device ? ` ${ot.device}` : "";
            satLine += ` → ${satOnO2Value} sob O₂${device}${flow}`;
          } else {
            satLine += ` → ${satOnO2Value}`;
          }
        }
        enriched.push(satLine.trim());
      }

      // Linha de administração de O2
      if (rawLow.includes("melhorou") || rawLow.includes("saturou melhor")) {
        enriched.push("Oxigênio administrado com melhora clínica referida");
      } else {
        const device = toStr(ot?.device);
        const flow = ot?.flow_l_min ? `${findRange(ot.flow_l_min, "L/min")}` : "";
        if (device || flow) {
          const combined = `${device}${device && flow ? " " : ""}${flow}`.trim();
          // Anti-tautologia: se device/flow apenas diz "oxigênio"
          if (combined.toLowerCase() === "oxigênio" || combined.toLowerCase() === "oxigenio") {
            enriched.push("Oxigênio");
          } else {
            enriched.push(`Oxigênio: ${combined}`);
          }
        } else if (rawLow.includes("o2") && !hasInitialSpO2) {
          enriched.push("Oxigênio");
        }
      }

      if (Number.isFinite(sf?.vitals?.temp)) enriched.push(`Temperatura: ${sf.vitals.temp}ºC`);

      // C. Exame Físico Objetivo
      const respRegex = /\b(roncos|estertores|murm[uú]rio|crepita|sibilo|sibilante|fricção|respira|pulm[oã]o|bases?|ápices?)\b/i;
      const auscultaRaw = [
        ...(sf?.physical_exam?.findings || []),
        ...(sf?.presenting_problem?.additional_symptoms || []).filter((s: string) => respRegex.test(s.toLowerCase()))
      ];
      const vagueRegex = /(normal|bom|boa|ruim|estranho|alterado|ok|talvez|parece|prov[áa]vel|meio|est[áa]vel|grave|sepse|choque|mal|morrer)/i;
      
      const auscultaFiltered = auscultaRaw.filter((f: string) => {
         const fLow = f.toLowerCase();
         return respRegex.test(fLow) && !vagueRegex.test(fLow);
      });

      if (auscultaFiltered.length > 0)
        enriched.push(`Ausculta pulmonar: ${auscultaFiltered.join(", ")}`);

      if (sf?.physical_exam?.neuro) {
        const cleanNeuro = sf.physical_exam.neuro.replace(/^alteração\s+do\s+estado\s+mental\s*\/\s*/i, "").trim();
        if (cleanNeuro) enriched.push(`Estado mental: ${cleanNeuro}`);
      }

      // EXAMES REALIZADOS (Extração Factual)
      if (rawLow.includes("tgo e tgp normais")) {
        enriched.push("TGO: normal");
        enriched.push("TGP: normal");
      }

      // D. Sintomas Associados (Aggregated & Filtered)
      const symptoms = (sf?.presenting_problem?.additional_symptoms || [])
        .filter((s: string) => {
           const sLow = s.toLowerCase().trim().replace(/[^a-z0-9]/g, "");
           const qpRaw = (sf?.presenting_problem?.chief_complaint || "").toLowerCase().trim();
           const qpLow = qpRaw.replace(/[^a-z0-9]/g, "");
           
           // Bloqueia duplicata da Queixa Principal (limpeza agressiva)
           if (sLow === qpLow || qpLow.includes(sLow) || sLow.includes(qpLow)) return false;
           
           // Bloqueia se for achado pulmonar (já foi para Ausculta)
           if (respRegex.test(s.toLowerCase())) return false;

           // Bloqueia se for vago (deveria estar em incertezas)
           if (/(normal|bom|boa|ruim|estranho|alterado|ok|talvez|parece|prov[áa]vel|meio|est[áa]vel|grave|sepse|choque|mal|morrer)/i.test(sLow) && !/\d/.test(sLow)) return false;
           
           // Bloqueia se já está nas incertezas
           if (finalUncertainties.some(u => u.toLowerCase().replace(/[^a-z0-9]/g, "").includes(sLow))) return false;
           
           return true;
        });

      if (symptoms.length > 0) {
        const symptomsLine = `Sintomas associados: ${symptoms.join(", ")}`;
        enriched.push(symptomsLine);
        symptomaticLines.push(...symptoms.map((s: string) => s.toLowerCase().trim()));
      }

      // E. Comorbidades (Apenas objetivas)
      const comorb = sf?.comorbidities || [];
      if (evidence_quality.history === "objective") {
        const validComorb = comorb.filter((com: string) => {
          const comLow = com.toLowerCase();
          if ((comLow.includes("hiperten") || comLow.includes("has")) && (rawLow.includes("hipertenso?") || rawLow.includes("hipertenso ?"))) return false;
          return !finalUncertainties.some((u: string) => u.toLowerCase().includes(comLow));
        });
        if (validComorb.length > 0)
          enriched.push(`Comorbidades autorreferidas: ${validComorb.join(", ")}`);
      }

      // F. Filtro de Findings (Regra de Ouro - POSITIVE OBSERVABLES ONLY)
      findings.forEach((f: string) => {
        const fLow = f.toLowerCase().trim();

        // 1. Dedupe Semântico de Sintomas (Regra final 1)
        if (symptomaticLines.some((s: string) => fLow === s || fLow.includes(s))) return;

        // 2. Bloqueios de Ausência / Falta / Subjectividade / Placeholders (NÃO é achado observável positivo)
        if (/(temperatura|press[ãa]o|bp|pa|sist[óo]lica|diast[óo]lica|frequ[êe]ncia|spo2|satura[çc][ãa]o|oxig[êe]nio)/i.test(fLow) && !/\d/.test(fLow)) return;
        if (/n[ãa]o\s+(registrad[oa]|documentad[oa]|aferid[oa]|informad[oa]|relatad[oa])/i.test(fLow)) return;
        if (/(inalterad[oa]|est[aacute]vel|sem\s+particularidades|nada\s+digno|unremarkable|normal|bom|boa|ruim|estranho|alterado|ok|talvez|parece|prov[áa]vel|meio|grave|cr[íi]tico|urgente|sepse|choque|mal|morrer)/i.test(fLow)) return;
        if (/missing|not\s+documented|unknown|vitals\s+not|exames\s+mencionados|medica[çc][õo]es\s+mencionadas/i.test(fLow)) return;
        // Anti-interpretação
        if (fLow.includes("desconforto respirat") && !c.raw_text?.toLowerCase().includes("desconforto respirat")) return;

        // 3. Bloqueios de Qualidade (Incertezas) - REGRA ABSOLUTA PARA MEDICAÇÃO
        if (evidence_quality.antibiotic !== "objective" || evidence_quality.medications !== "objective") {
          if (/antibi[óo]tico|atb|ceftriaxona|piperacilina|azitro|remedio|medica/i.test(fLow)) return;
        }
        
        if (evidence_quality.bp !== "objective" && /pa[:\s]|press[atilde]o|13\s+por\s+8/i.test(fLow)) return;
        if (evidence_quality.history !== "objective" && /hist[óo]rico|bronquite|enfisema/i.test(fLow)) return;

        // 4. Bloqueios de Processo / Log Operacional
        if (/soro|fluido|iv\s+access|acesso\s+venoso|gotejamento|hidrata[çc][ãa]o/i.test(fLow)) return;
        if (/colhido|pedido|aguardando|solicitado|pendente|realizado/i.test(fLow)) return;
        if (/raio-x|rx|t[óo]rax|sangue|laborat|tc|tomografia|rm|resson[âa]ncia|gasometria|pcr|procalcitonina|d-d[íi]mero|troponina|bnp|eco|ecocardiograma|cultura|bi[óo]psia/i.test(fLow)) return;

        // 5. Bloqueios de Redundância e Comorbidades
        if (/sat|spo2|satura[çc][atilde]o|fc[:\s]|cardiaca/i.test(fLow)) return;
        if (/o2|oxig[êe]nio|cateter|fluxo/i.test(fLow)) return;
        if (respRegex.test(fLow)) return;
        if (/neuro|confuso|orientado|mental/i.test(fLow)) return;
        if (/hipertenso|diabetes|has|dm|bronquite|enfisema|problema\s+no\s+pulm[oã]o/i.test(fLow)) return;
        if (sf?.presenting_problem?.chief_complaint && fLow.includes(sf.presenting_problem.chief_complaint.toLowerCase())) return;

        // 6. Regra Final de Observabilidade: deve descrever algo positivo/físico
        if (f.length > 3) enriched.push(f);
      });

      return enriched;
    };

    // 5. Coleta de Pendências Canonizadas
    const pendingSet = new Set<string>();
    
    const missingRaw = [...rawMissing];
    
    // Varre findings E incertezas em busca de menções vagas que devem virar cobrança
    [...rawFindings, ...rawUncertainties].forEach((txt: string) => {
      const tLow = txt.toLowerCase();

      // BLOCKER: Anti-regressão de vitais (Se tem número, não cobra incerteza textual)
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

    const text = (c.raw_text || "").toLowerCase();

    // PENDÊNCIAS EXPLÍCITAS (Factual)
    if (text.includes("ainda nao fiz ecg") || text.includes("ainda não fiz ecg")) {
      missingRaw.push("ECG não realizado (relato do médico)");
    }
    if (text.includes("sem gasometria")) {
      missingRaw.push("Gasometria não realizada (relato do médico)");
    }
    if (text.includes("rx?") || (text.includes("raio-x") && text.includes("?"))) {
      missingRaw.push("Confirmar RX (feito?) / resultado");
    }
    if (text.includes("antibiotico") && (text.includes("nao lembro") || text.includes("não lembro") || text.includes("nao sei") || text.includes("não sei"))) {
      missingRaw.push("Nome do antibiótico (e se possível dose/horário)");
    }

    // Canonização de Gaps
    let bpGap = false;
    let tempGap = false;
    let fluidGap = false;
    let spo2Gap = false;
    let o2Gap = false;
    let hrGap = false;

    // ✅ FIX Determinístico (Anti-Evasão): se mencionou vital no texto sem número, COBRA.
    const mentionsSat = /\b(spo2|sat(urando|urou|uraç[ãa]o|o2)?)\b/i.test(text);
    const hasSatNum = /\b(spo2|sat(urando|urou|uraç[ãa]o|o2)?)\b[^0-9]{0,15}(\d{2,3})\s*%?/i.test(text);
    const benignSat = /\b(saturando\s+bem|sat\s+normal|sat\s+ok)\b/i.test(text);
    const satUnc = finalUncertainties?.some(u => /saturação vaga|saturação contraditória|spo2 vague/i.test(String(u).toLowerCase())) ?? false;
    
    if (mentionsSat && !hasSatNum && !benignSat) spo2Gap = true;
    if (satUnc) spo2Gap = true;

    const mentionsFC = /\b(fc|frequ[êe]n(cia)?\s*card[ií]aca|heart\s*rate|hr|bpm)\b/i.test(text);
    const hasFCNumber = /\b(fc|frequ[êe]n(cia)?\s*card[ií]aca|heart\s*rate|hr|bpm)\b[^0-9]{0,12}(\d{2,3})\b/i.test(text);
    if (mentionsFC && !hasFCNumber) hrGap = true;

    // ✅ FIX: Se declarar explicitamente que não anotou/anotou sinais, cobrar TUDO.
    const explicitNoVitals = /\b(n[ãa]o\s+(anotei|registrei|tenho|coloquei)|sem)\s+(sinais\s+vitais|vitais|dados)\b/i.test(text);

    missingRaw.forEach(m => {
      const mLow = m.toLowerCase();
      // Ignora generic gaps que não são fatos contextuais ou demográficos básicos
      if (/no\s+explicit|not\s+documented|timing\s+not|allergies\s+not/i.test(mLow)) return;
      if (/age|sex|dob|birth|birthdate/i.test(mLow)) return;
      if (/radiology|labs|imaging|history|comorb/i.test(mLow) && !text.includes("exame") && !text.includes("hist[óo]r")) return;
      if (/antibi[óo]tico|atb|exames\s+solicitados/i.test(mLow) && !text.includes("antibi") && !text.includes("exame")) return;
      
      // SÓ gera gap se o termo foi mencionado no texto bruto (Anti-alucinação de pendência)
      // E SE o dado numérico correspondente estiver ausente (Fix: supressão se já extraído)
      if (/(bp|pa|sist[óo]lica|diast[óo]lica|press[ãa]o)/i.test(mLow) && /\b(pa|press[ãa]o|bp)\b/i.test(text) && !sf?.vitals?.bp_systolic) bpGap = true;
      else if (/temp/i.test(mLow) && /\b(temp(eratura)?|febre)\b/i.test(text) && !sf?.vitals?.temp) tempGap = true;
      else if (/(oxig[êe]nio|o2)/i.test(mLow) && /\b(o2|oxig[êe]nio|cateter|m[aacute]scara)\b/i.test(text)) o2Gap = true;
      else if (/(soro|fluido|hidrata)/i.test(mLow) && /\b(soro|fluido|hidrata|gotejamento)\b/i.test(text)) fluidGap = true;
      else {
        // Se já temos a queixa principal no texto, não cobrar como pendência
        const qp = toStr(sf?.presenting_problem?.chief_complaint).toLowerCase();
        if (qp && mLow.includes(qp)) return;
        if (/queixa|complaint/i.test(mLow) && qp) return;

        // Se não for um gap de vital (que tem tratamento próprio abaixo), adiciona como pendência textual
        pendingSet.add(m);
      }
    });

    if (explicitNoVitals) {
      bpGap = true;
      tempGap = true;
      hrGap = true;
      spo2Gap = true;
      // respiratory rate gap
    }

    const isBenign = /\b(exame\s+f[íi]sico\s+normal|sem\s+queixas|saturando\s+bem|est[aacute]vel|quadro\s+leve)\b/i.test(text);
    const hasGravity = /\b(sepse|choque|cr[íi]tico|grave|urgente|emerg[êe]ncia|mal|ruim|caiu|baixo|hipotens|confus[ao]|desorientad[oa]|dispneia|falta de ar|dor|suando frio|sudorese)\b/i.test(text);
    const hasNums = /\b(\d{2,3})\s*[x\/]\s*(\d{2,3})\b/.test(text) ||
                   /\b(spo2|sat(urando|urou|uraç[ãa]o|o2)?)\b[^0-9]{0,12}(\d{2,3})\s*%?/.test(text) ||
                   /\b(temp(eratura)?)\b[^0-9]{0,10}(\d{2})([.,](\d))?\b/.test(text) ||
                   /\b(fc|frequ[êe]n(cia)?\s*card[ií]aca|hr|bpm)\b[^0-9]{0,10}(\d{2,3})\b/.test(text) ||
                   /\b(pa|press[ãa]o|bp)\b[^0-9]{0,10}(\d{2,3})\b/.test(text);

    let gateData = getGateMetadata(c);
    if (gateData && gateData.reason_code === "uncertainty" && isBenign && !hasGravity) {
       gateData.reason_code = "skip_safe_case";
       gateData.reason_human = REASON_HUMAN_MAP["skip_safe_case"];
    }

    const isOperational = gateData?.reason_code === "documentation_risk" || gateData?.reason_code === "operational_chaos";
    const finalMissing: string[] = [];
    if (bpGap) finalMissing.push("PA objetiva (sistólica/diastólica)");
    if (tempGap) finalMissing.push("Temperatura (valor numérico ausente)");
    if (hrGap) finalMissing.push("FC objetiva (valor numérico ausente)");
    if (spo2Gap) finalMissing.push("SpO₂ numérica");
    if (explicitNoVitals) finalMissing.push("Frequência Respiratória (FR)");
    if (o2Gap) finalMissing.push("Uso/flow de oxigênio não documentado");
    if (fluidGap) finalMissing.push("Fluidos/soro (não documentado)");

    if (isOperational) {
      const hasQP = text.includes("queixa") || text.includes("motivo") || (sf?.presenting_problem?.chief_complaint && sf.presenting_problem.chief_complaint.length > 3);
      const hasPhysical = text.includes("exame") || text.includes("ausculta") || (sf?.physical_exam?.findings && sf.physical_exam.findings.length > 0);
      const hasObjectiveVitals = hasNums || (sf?.vitals?.bp_systolic && sf?.vitals?.spo2_initial);

      if (!hasQP) finalMissing.push("Motivo clínico da internação / queixa principal");
      if (!hasPhysical) finalMissing.push("Exame físico objetivo");
      if (!hasObjectiveVitals) finalMissing.push("Sinais vitais objetivos");
    }
    
    pendingSet.forEach(p => {
      const pLow = p.toLowerCase();
      // Filtra ruído de incertezas operacionais (ex: internado, fila, etc)
      if (isOperational && /internado|fila|sistema|enfermagem|evolui/i.test(pLow)) return;
      // Filtra o erro específico "Achado pulmonar vago: Paciente internado"
      if (pLow.includes("achado pulmonar vago") && pLow.includes("internado")) return;

      if (!finalMissing.some(f => pLow.includes(f.toLowerCase()))) {
        finalMissing.push(p);
      }
    });

    const vIn = sf?.vitals || null;
    const ot = sf?.oxygen_therapy;
    const hasIn = vIn?.spo2_initial;
    const hasOn = vIn?.spo2_on_o2;

    let o2Label = "";
    if (ot?.device) {
      o2Label = `O₂ ${ot.device}`;
      if (ot.flow_l_min) o2Label += ` ${ot.flow_l_min}L/min`;
    } else if (ot?.flow_l_min) {
      o2Label = `O₂ ${ot.flow_l_min}L/min`;
    }

    let spo2Value = null;
    if (hasIn && hasOn) {
      const labelOn = o2Label ? ` (${o2Label})` : "";
      spo2Value = `${hasIn}% (AA) → ${hasOn}%${labelOn}`;
    } else if (hasIn) {
      spo2Value = `${hasIn}% (AA)`;
    } else if (hasOn) {
      const labelOn = o2Label ? ` (${o2Label})` : "";
      spo2Value = `${hasOn}%${labelOn}`;
    }

    const vitalsOut = vIn
      ? {
          ...vIn,
          fc: (vIn as any).fc ?? (vIn as any).hr ?? (vIn as any).heart_rate ?? null,
          spo2: (spo2Value || (vIn as any).spo2 || (vIn as any).spo2_initial || null),
        }
      : null;

    const patientHeader = sf?.patient?.name || "Nome não informado";

    return reply.send({
      ok: true,
      case_id: c.id,
      patient: {
        ...(sf?.patient || {}),
        name: patientHeader
      },
      vitals: vitalsOut,
      gate: gateData,
      analysis: {
        findings: uniqClean(enrichFindings(clean(rawFindings))),
        missing: uniqClean(clean(finalMissing)),
        uncertainties: finalUncertainties,
        evidence_quality:
          Object.keys(evidence_quality).length > 0 ? evidence_quality : null,
      },
      clinical_scores: getClinicalScores(c),
      operational_context: sf?.operational_context || null,
      text: "",
    });

  });
};
