import type { FastifyInstance } from "fastify";

function includesAny(arr: any[], substr: string) {
  return (
    Array.isArray(arr) &&
    arr.some((x) => typeof x === "string" && x.includes(substr))
  );
}

const cases = [
  {
    name: "hard_risk_spo2",
    raw_text: "Paciente em PS. Sat 89% em ar ambiente. Dispneia.",
    expect: { ranTeacher: true, reason: "hard_risk_spo2_lt_92" },
  },
  {
    name: "uncertainty_text",
    raw_text: "Paciente em PS, acho que iniciou hoje, talvez piorando.",
    expect: { ranTeacher: true, reason: "uncertainty" },
  },
  {
    name: "safe_minimal",
    raw_text: "Paciente em PS, tosse leve, exame ok.",
    expect: { ranTeacher: false, reason: "skip_safe_case" },
  },
  {
    name: "neuro_change",
    raw_text: "Paciente em PS. Muito agitado e confuso desde a chegada.",
    expect: { ranTeacher: true, reason: "hard_risk_neuro_change" },
  },
  {
    name: "soft_risk_no_trigger",
    raw_text: "Paciente em PS com O₂ em cateter, mas sem outras info.",
    expect: { ranTeacher: false, reason: "skip_safe_case" },
  },
];

export async function smokeRoute(app: FastifyInstance) {
  app.post("/smoke", async (_req, reply) => {
    const results: any[] = [];

    for (const c of cases) {
      const res = await app.inject({
        method: "POST",
        url: "/cases/ingest",
        payload: { raw_text: c.raw_text },
      });

      const body = res.json();

      let teacherOk: boolean | null = null;
      let summaryOk: boolean | null = null;

      const got = body?.data ?? {};
      const caseId = got?.caseId;

      const okBase =
        got.ranTeacher === c.expect.ranTeacher &&
        got.reason === c.expect.reason;

      // ---------- Teacher validations (já existentes) ----------
      if (c.name === "hard_risk_spo2") {
        const g = await app.inject({ method: "GET", url: `/cases/${caseId}` });
        const full = g.json()?.data;

        const B = full?.teacher_output?.sections?.find(
          (s: any) => s.key === "B",
        );
        const I = full?.teacher_output?.sections?.find(
          (s: any) => s.key === "I",
        );

        teacherOk =
          !!B &&
          !!I &&
          includesAny(B.findings, "SatO₂") &&
          includesAny(B.missing, "Meta de saturação não registrada") &&
          includesAny(B.missing, "Uso/fluxo de oxigênio não documentado") &&
          includesAny(I.findings, "Queixa principal:");

        // ---------- Summary validation ----------
        const s = await app.inject({
          method: "GET",
          url: `/cases/${caseId}/summary`,
        });
        const sb = s.json();

        summaryOk =
          s.statusCode === 200 &&
          sb?.ok === true &&
          Array.isArray(sb?.analysis?.findings) &&
          sb.analysis.findings.some((x: string) => x.includes("SatO₂"));
      }

      if (c.name === "uncertainty_text") {
        const g = await app.inject({ method: "GET", url: `/cases/${caseId}` });
        const full = g.json()?.data;

        const K = full?.teacher_output?.sections?.find(
          (s: any) => s.key === "K",
        );

        teacherOk =
          !!K &&
          Array.isArray(K.missing) &&
          (K.missing.length > 0 ||
            (Array.isArray(K.findings) && K.findings.length > 0));

        // ---------- Summary validation ----------
        const s = await app.inject({
          method: "GET",
          url: `/cases/${caseId}/summary`,
        });
        const sb = s.json();

        summaryOk =
          s.statusCode === 200 &&
          sb?.ok === true &&
          Array.isArray(sb?.analysis?.missing) &&
          sb.analysis.missing.length > 0;
      }

      if (c.name === "safe_minimal") {
        // ---------- Summary validation (skip case) ----------
        const s = await app.inject({
          method: "GET",
          url: `/cases/${caseId}/summary`,
        });
        const sb = s.json();

        summaryOk =
          s.statusCode === 200 &&
          sb?.ok === true &&
          sb.analysis.findings.length === 0;
      }

      const ok =
        okBase &&
        (teacherOk === null ? true : teacherOk) &&
        (summaryOk === null ? true : summaryOk);

      results.push({
        name: c.name,
        ok,
        got: {
          ranTeacher: got.ranTeacher,
          reason: got.reason,
          student_provider: got.student_provider,
        },
        expect: c.expect,
        teacherOk,
        summaryOk,
      });
    }

    const allOk = results.every((r) => r.ok);

    return reply.send({
      success: allOk,
      data: { allOk, results },
      message: allOk ? "ok" : "failed",
    });
  });
}
