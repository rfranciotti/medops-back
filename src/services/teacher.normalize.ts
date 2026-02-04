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

  // Hard-risk minimums (REMOVIDO: viola contrato de não inventar pendências não citadas)
  /*
  if (Number.isFinite(spo2) && spo2 < 92 && B) {
    // Normaliza para SatO₂ e evita duplicidade com SpO2 ou outras grafias
    const hasSat = B.findings.some(
      (x: any) => typeof x === "string" && /(SpO₂|SatO₂|Saturação)/i.test(x),
    );

    if (!hasSat) {
      uniqPush(B.findings, `SatO₂: ${spo2}%`);
    }

    // Pendências em Português
    uniqPush(B.missing, "Meta de saturação não registrada");
    uniqPush(B.missing, "Uso/fluxo de oxigênio não documentado");
    uniqPush(B.missing, "Frequência respiratória não registrada");

    // Remove duplicatas em inglês ou variações (plural) se o LLM tiver mandado
    removeIfPresent(B.missing, "SpO₂ target not documented");
    removeIfPresent(B.missing, "SpO2 target not documented");
    removeIfPresent(B.missing, "Metas de saturação não registradas");
    removeIfPresent(B.missing, "Meta de saturação não documentada");
    removeIfPresent(B.missing, "oxygen therapy status not documented");
    removeIfPresent(B.missing, "RR not documented");
    removeIfPresent(B.missing, "oxygen status");
  }
  */

  // Problem list minimum
  if (cc && I) {
    uniqPush(I.findings, `Queixa principal: ${cc}`);
  }

  const K = sec("K");
  if (K) {
    K.findings = Array.isArray(K.findings) ? K.findings : [];
    K.missing = Array.isArray(K.missing) ? K.missing : [];
  }

  if (gate?.reason === "uncertainty" && K) {
    uniqPush(
      K.missing,
      "Gatilho de incerteza: o texto contém termos de dúvida (revisão necessária)",
    );
  }

  // ========== LIMPEZA FINAL (Post-processing conservador) ==========

  const raw_text = (student_facts?.context?.raw_text || "").toLowerCase();

  out.sections?.forEach((section: any) => {
    if (!section) return;

    section.findings = Array.isArray(section.findings) ? section.findings : [];
    section.missing = Array.isArray(section.missing) ? section.missing : [];

    // 1️⃣ Remove duplicatas entre findings e missing da MESMA seção
    section.findings = section.findings.filter(
      (f: string) => !section.missing.includes(f),
    );

    // 2️⃣ Move frases de incerteza de findings para K.findings (se não for seção K)
    if (section.key !== "K") {
      const uncertaintyPatterns =
        /\b(desconfio|não sei|talvez|incerto|dúvida|será que|suspeito)\b/i;
      const uncertainFindings: string[] = [];

      section.findings = section.findings.filter((f: string) => {
        if (typeof f === "string" && uncertaintyPatterns.test(f)) {
          uncertainFindings.push(f);
          return false; // Remove de findings
        }
        return true;
      });

      // Adiciona na seção K
      if (K && uncertainFindings.length > 0) {
        uncertainFindings.forEach((u) => uniqPush(K.findings, u));
      }
    }

    // 3️⃣ Remove pedidos irrelevantes de "missing"
    if (section.key === "E") {
      // Exposure
      // Remove "Local de atendimento" se menciona PS/UPA/Hospital
      if (/\b(ps|upa|pronto.socorro|hospital|emergencia)\b/i.test(raw_text)) {
        section.missing = section.missing.filter(
          (m: string) => !/local de atendimento/i.test(m),
        );
      }

      // Remove "Data de referência" (sempre será a data do registro)
      section.missing = section.missing.filter(
        (m: string) => !/data de refer[eê]ncia/i.test(m),
      );
    }

    // 4️⃣ Remove duplicatas de "Queixa principal" na seção I
    if (section.key === "I" && cc) {
      const queixaPrincipalItem = `Queixa principal: ${cc}`;

      // Se já tem "Queixa principal: X", remove "X" solto
      if (section.findings.includes(queixaPrincipalItem)) {
        section.findings = section.findings.filter(
          (f: string) => f === queixaPrincipalItem || f !== cc,
        );
      }
    }
  });

  return out;
}
