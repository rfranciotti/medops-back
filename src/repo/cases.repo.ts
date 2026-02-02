import { db } from "./db.js";

type SaveCaseInput = {
  raw_text: string;
  student_facts: any;
  gate: any;
  teacher_output: any | null;

  student_provider: string;
  student_error: string | null;

  teacher_provider: string | null;
  teacher_error: string | null;
};

export async function saveCase(input: SaveCaseInput) {
  const caseId = `case_${Date.now()}`;
  const created_at = new Date().toISOString();

  const stmt = db.prepare(`
  INSERT INTO cases (
    id, raw_text, student_facts_json, gate_json, teacher_json, created_at,
    student_provider, student_error,
    teacher_provider, teacher_error
  )
  VALUES (
    @id, @raw_text, @student_facts_json, @gate_json, @teacher_json, @created_at,
    @student_provider, @student_error,
    @teacher_provider, @teacher_error
  )
`);

  stmt.run({
    id: caseId,
    raw_text: input.raw_text,
    student_facts_json: JSON.stringify(input.student_facts),
    gate_json: JSON.stringify(input.gate),
    teacher_json: input.teacher_output
      ? JSON.stringify(input.teacher_output)
      : null,
    created_at,

    student_provider: input.student_provider,
    student_error: input.student_error,

    teacher_provider: input.teacher_provider,
    teacher_error: input.teacher_error,
  });

  return caseId;
}

export function getCaseById(caseId: string) {
  const row = db.prepare(`SELECT * FROM cases WHERE id = ?`).get(caseId) as
    | any
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    raw_text: row.raw_text,
    student_facts: JSON.parse(row.student_facts_json),
    gate: JSON.parse(row.gate_json),
    teacher_output: row.teacher_json ? JSON.parse(row.teacher_json) : null,
    created_at: row.created_at,
    student_provider: row.student_provider ?? null,
    student_error: row.student_error ?? null,
    teacher_provider: row.teacher_provider ?? null,
    teacher_error: row.teacher_error ?? null,
  };
}
