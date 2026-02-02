import { z } from "zod";

export const TeacherSection = z.object({
  key: z.string(), // depois a gente restringe pra A..K
  title: z.string(),
  findings: z.array(z.string()),
  missing: z.array(z.string()),
});

export const TeacherOutputV1 = z.object({
  version: z.string(),
  sections: z.array(TeacherSection),
  meta: z.object({
    generated_at: z.string(),
    note: z.string(),
  }),
});

export type TeacherOutputV1 = z.infer<typeof TeacherOutputV1>;
