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

function headerLine(section: any): string {
  if (!section) return "";
  const label =
    toStr(section.label) ||
    toStr(section.key) ||
    toStr(section.code) ||
    toStr(section.id);
  const title = toStr(section.title) || toStr(section.name);
  const h = [label, title].filter(Boolean).join(" — ");
  return h ? `## ${h}` : "";
}

/**
 * Extrai “findings” e “missing” sem inferência:
 * só pega o que estiver explicitamente em campos típicos.
 */
function extractFindings(section: any): string[] {
  // aceita: findings, notes, attention_notes etc. (defensivo)
  const direct = toLines(section?.findings)
    .concat(toLines(section?.notes))
    .concat(toLines(section?.attention))
    .concat(toLines(section?.observations));

  // aceita estrutura do tipo: findings: [{ text }], notes: [{ value }]
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

/**
 * Fallback genérico pra quando o Teacher vier em formato diferente:
 * text/summary/content + lines + bullets/items
 */
function extractGenericContent(section: any): string[] {
  const out: string[] = [];

  const text =
    toStr(section?.text) ||
    toStr(section?.summary) ||
    toStr(section?.content) ||
    toStr(section?.message);

  if (text) out.push(text);

  // lines
  const lines = Array.isArray(section?.lines)
    ? section.lines.map(toStr).filter(Boolean)
    : [];
  out.push(...lines);

  // bullets/items
  const bulletsArr: any[] = Array.isArray(section?.bullets)
    ? section.bullets
    : [];
  const itemsArr: any[] = Array.isArray(section?.items) ? section.items : [];

  for (const b of bulletsArr) {
    const s =
      toStr(b) || toStr(b?.text) || toStr(b?.value) || toStr(b?.message);
    if (s) out.push(s);
  }

  for (const it of itemsArr) {
    const s =
      toStr(it) || toStr(it?.text) || toStr(it?.value) || toStr(it?.message);
    if (s) out.push(s);
  }

  return out.map((s) => s.trim()).filter(Boolean);
}

function renderSection(section: any): string {
  if (!section) return "";

  const header = headerLine(section);

  const findings = extractFindings(section);
  const missing = extractMissing(section);

  // se não vier findings/missing, cai no fallback genérico
  const generic = extractGenericContent(section);

  const parts: string[] = [];

  if (header) parts.push(header);

  if (findings.length) {
    parts.push("Findings:");
    parts.push(...bulletize(findings));
  }

  if (missing.length) {
    parts.push("Missing:");
    parts.push(...bulletize(missing));
  }

  // Evita duplicar: se já teve findings/missing, só adiciona generic se trouxer algo “novo”
  if (!findings.length && !missing.length && generic.length) {
    parts.push(...bulletize(generic));
  }

  return parts.filter(Boolean).join("\n");
}

function renderGateHeader(c: any): string {
  const g = c?.gate_output || c?.gate || c?.gate_result;
  if (!g) return "";

  const should =
    typeof g.shouldRunTeacher === "boolean"
      ? `shouldRunTeacher=${g.shouldRunTeacher}`
      : "";
  const reason = toStr(g.reason);
  const flagsObj = g.flags && typeof g.flags === "object" ? g.flags : null;

  const flags = flagsObj
    ? Object.entries(flagsObj)
        .map(([k, v]) => `${k}=${toStr(v)}`)
        .filter(Boolean)
        .join(", ")
    : "";

  const line = [
    should,
    reason ? `reason=${reason}` : "",
    flags ? `flags=${flags}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  return line ? `# Gate\n${line}\n` : "";
}

function renderTeacherSectionsToText(c: any): string {
  const teacher = c?.teacher_output;
  const sections = teacher?.sections;

  const gateHeader = renderGateHeader(c);

  if (!Array.isArray(sections) || sections.length === 0) {
    // mantém contrato e dá uma mensagem curta
    return gateHeader
      ? `${gateHeader}\nSem teacher_output.sections para renderizar.`
      : "Sem teacher_output.sections para renderizar.";
  }

  const rendered = sections
    .map(renderSection)
    .map((s) => s.trim())
    .filter(Boolean);

  const body = rendered.join("\n\n");
  return gateHeader ? `${gateHeader}\n${body}` : body;
}

export const casesSummaryRoute: FastifyPluginAsync = async (app) => {
  app.get("/cases/:id/summary", async (req, reply) => {
    const { id } = req.params as any;

    if (!id || typeof id !== "string") {
      return reply.code(400).send({ ok: false, message: "Missing case id." });
    }

    const c = getCaseById(id);
    if (!c)
      return reply.code(404).send({ ok: false, message: "Case not found." });

    const text = renderTeacherSectionsToText(c);

    return reply.send({
      ok: true,
      case_id: c.id,
      text,
    });
  });
};
