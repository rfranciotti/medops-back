import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "medops.sqlite"));

db.exec(`
  PRAGMA journal_mode=WAL;

  CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    raw_text TEXT NOT NULL,
    student_facts_json TEXT NOT NULL,
    gate_json TEXT NOT NULL,
    teacher_json TEXT NULL,
    created_at TEXT NOT NULL
  );
`);
