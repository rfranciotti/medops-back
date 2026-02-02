export function sanitizeTeacherOutput(out: any) {
  if (!out || typeof out !== "object") return out;

  if (Array.isArray(out.sections)) {
    for (const s of out.sections) {
      if (Array.isArray(s.findings)) {
        s.findings = s.findings.map((x: any) =>
          typeof x === "string" ? x : JSON.stringify(x),
        );
      }
      if (Array.isArray(s.missing)) {
        s.missing = s.missing.map((x: any) =>
          typeof x === "string" ? x : JSON.stringify(x),
        );
      }
    }
  }
  return out;
}
