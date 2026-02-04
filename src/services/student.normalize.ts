import { enforceUncertainties } from "./anti-evasion.js";

/**
 * Detecção de problemas operacionais e de infraestrutura
 */
export function detectOperationalIssues(raw_text: string) {
  const raw = (raw_text || "").toLowerCase();
  const issues: string[] = [];

  if (
    /\b(sistema (caiu|fora|lento|travou)|computador|internet|informatica)\b/.test(
      raw,
    )
  ) {
    issues.push("Instabilidade de infraestrutura/sistema detectada");
  }

  if (
    /\b(fila (cheia|lotada|parada|longa)|muito paciente|lotad[oa]|chei[oa])\b/.test(
      raw,
    )
  ) {
    issues.push("Sobrecarga de fluxo/fila detectada");
  }

  if (
    /\b(enfermagem reclamando|conflito|briga|caos|sobrecarga|equipe estressada)\b/.test(
      raw,
    )
  ) {
    issues.push("Stress ou conflito de equipe detectado");
  }

  if (
    /\b(nao evolu[ia]|sem evolucao|nao registrei|registro incompleto|evolui direito|esqueci de registrar)\b/.test(
      raw,
    )
  ) {
    issues.push("Admissão de falha/atraso no registro clínico");
  }

  return {
    chaos_detected: issues.length > 0,
    issues,
  };
}

export function normalizeStudentFacts(student_facts: any, raw_text: string) {
  const out = structuredClone(student_facts);

  // Se vitals ver {} -> vira null
  if (
    out?.vitals &&
    typeof out.vitals === "object" &&
    Object.keys(out.vitals).length === 0
  ) {
    out.vitals = null;
  }

  // Extrair SpO2 do texto se Student não trouxe
  const raw = (raw_text || "").toLowerCase();

  // Detecção de SpO2 inicial vs O2
  const m = raw.match(/\b(spo2|sat|saturacao)\b[^0-9]{0,10}(\d{2,3})\s*%?/g);
  if (m && m.length > 0 && out.vitals) {
    const values = m
      .map((x) => {
        const valMatch = x.match(/(\d{2,3})/);
        return valMatch ? Number(valMatch[0]) : null;
      })
      .filter((v) => v !== null && v <= 100) as number[];

    if (values.length > 1) {
      out.vitals.spo2_initial = Math.min(...values);
      out.vitals.spo2_on_o2 = Math.max(...values);
    } else if (values.length === 1 && !out.vitals.spo2_initial) {
      out.vitals.spo2_initial = values[0];
    }
  }

  // Extração determinística de FC e RR (Fix: Anti-Troca)
  const fcMatch = raw.match(/\b(fc|hr|bpm|heart\s*rate|frequencia\s*cardiaca)\b[^0-9]{0,10}(\d{2,3})\b/i);
  const rrMatch = raw.match(/\b(rr|fr|respirac[ao]|frequencia\s*respiratoria|rpm)\b[^0-9]{0,10}(\d{1,3})\b/i);

  if (out.vitals) {
    if (fcMatch) {
      const val = Number(fcMatch[2]);
      // Se detectamos FC no texto, garantimos que ela esteja no campo hr
      out.vitals.hr = val;
    }
    if (rrMatch) {
      const val = Number(rrMatch[2]);
      // RR raramente passa de 60; se detectamos RR no texto e o valor é plausível, setamos.
      if (val < 60) {
        out.vitals.rr = val;
      }
    }

    // Heurística de segurança: se o RR vindo do LLM/Student é absurdamente alto (>=60)
    // E bate com o valor que identificamos como FC no texto, corrigimos o mapeamento.
    if (out.vitals.rr && out.vitals.rr >= 60) {
      if (fcMatch && Number(fcMatch[2]) === out.vitals.rr) {
        out.vitals.hr = out.vitals.rr;
        out.vitals.rr = null;
      } else {
        // Se é alto mas não sabemos o que é, melhor deixar nulo do que poluir RR
        out.vitals.rr = null;
      }
    }
  }

  // Detecção de confusão mental
  if (!out.physical_exam) out.physical_exam = { findings: [] };
  if (
    !out.physical_exam.neuro &&
    /\b(confus[oa]|desorientad[oa]|meio confuso)\b/i.test(raw)
  ) {
    out.physical_exam.neuro = "Alteração do estado mental / Confusão detectada";
  }

  // === ANTI-EVASÃO (OBRIGATÓRIO) ===
  const anti = enforceUncertainties(out, raw_text);
  out.uncertainties = anti.assertions;

  // Contexto Operacional
  const op = detectOperationalIssues(raw_text);
  if (op) {
    (op as any).anti_evasion = {
      forced: anti.forced,
      reasons: anti.reasons,
      count: anti.assertions.length,
    };
  }
  out.operational_context = op;

  // ANTI-ALUCINAÇÃO: Valida additional_symptoms
  if (Array.isArray(out?.presenting_problem?.additional_symptoms)) {
    const validated = out.presenting_problem.additional_symptoms.filter(
      (symptom: string) => {
        const symptomLower = symptom.toLowerCase();
        // Verifica se o sintoma realmente aparece no texto
        return raw.includes(symptomLower);
      },
    );
    out.presenting_problem.additional_symptoms = validated;
  }

  // NORMALIZAÇÃO lab_results (Anti-ZodError)
  if (Array.isArray(out.lab_results)) {
    out.lab_results = out.lab_results.map((item: any) => {
      if (typeof item === "string") {
        return {
          test: item,
          result: "referido",
          status: "done"
        };
      }
      return item;
    });
  }

  return out;
}
