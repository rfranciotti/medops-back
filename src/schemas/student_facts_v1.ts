import { z } from "zod";

export const StudentFactsV1 = z.object({
  meta: z.object({
    schema_version: z.literal("student_facts_v1"),
    language: z.string(),
    source: z.string(),
  }),

  context: z
    .object({
      setting: z.string().nullable(),
      date_reference: z.string().nullable(),
      time_reference: z.string().nullable(),
    })
    .optional(),

  presenting_problem: z
    .object({
      chief_complaint: z.string().nullable(),
    })
    .optional(),

  vitals: z
    .object({
      spo2: z.number().nullable().optional(),
    })
    .refine((v) => v.spo2 !== undefined, {
      message: "vitals must include spo2 or be null",
    })
    .nullable()
    .optional(),

  medications: z.array(z.any()).optional(),
  exams: z.array(z.any()).optional(),

  uncertainties: z.array(z.string()).optional(),
});

export type StudentFactsV1 = z.infer<typeof StudentFactsV1>;
