import fs from "node:fs";
import path from "node:path";

export async function runStudent(raw_text: string) {
  if (raw_text.includes("89")) {
    return JSON.parse(
      fs.readFileSync(
        path.join("src/fixtures/student/ps_hard_risk.json"),
        "utf8",
      ),
    );
  }

  if (raw_text.includes("acho") || raw_text.includes("talvez")) {
    return JSON.parse(
      fs.readFileSync(
        path.join("src/fixtures/student/ps_uncertain.json"),
        "utf8",
      ),
    );
  }

  return JSON.parse(
    fs.readFileSync(path.join("src/fixtures/student/ps_minimal.json"), "utf8"),
  );
}
