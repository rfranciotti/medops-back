import { z } from "zod";

export const StudentFactsV1 = z.object({
  meta: z.object({
    schema_version: z.literal("student_facts_v1"),
    language: z.string(),
    source: z.string(),
  }),

  patient: z
    .object({
      name: z.string().nullable(),
      age: z.number().nullable().optional(),
      sex: z.string().nullable().optional(),
      weight_kg: z.number().nullable().optional(),
      height_m: z.number().nullable().optional(),
    })
    .optional(),

  context: z
    .object({
      setting: z.string().nullable().optional(),
      date_reference: z.string().nullable().optional(),
      time_reference: z.string().nullable().optional(),
    })
    .optional(),

  presenting_problem: z
    .object({
      chief_complaint: z.string().nullable(),
      duration: z.string().nullable().optional(),
      onset: z.string().nullable().optional(), // "desde ontem à noite"
      additional_symptoms: z.array(z.string()).optional(),
    })
    .optional(),

  comorbidities: z.array(z.string()).optional(),
  past_medical_history: z.array(z.string()).optional(), // DPOC, problemas pulmonares

  physical_exam: z
    .object({
      general: z.string().nullable().optional(),
      neuro: z.string().nullable().optional(), // "meio confuso"
      findings: z.array(z.string()).optional(),
    })
    .optional(),

  vitals: z
    .object({
      spo2_initial: z.number().nullable().optional(),
      spo2_on_o2: z.number().nullable().optional(),
      hr: z.number().nullable().optional(),
      bp_systolic: z.number().nullable().optional(),
      bp_diastolic: z.number().nullable().optional(),
      temp: z.number().nullable().optional(),
      rr: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),

  oxygen_therapy: z
    .object({
      device: z.string().nullable().optional(), // "cateter nasal"
      flow_l_min: z.number().nullable().optional(), // 3
      is_active: z.boolean().optional(),
    })
    .optional(),

  medications: z.array(z.any()).optional(),
  exams: z.array(z.any()).optional(),
  pending_exams: z.array(z.string()).optional(), // ["Raio-X tórax", "Sangue"]

  lab_results: z
    .array(
      z.object({
        test: z.string(),
        result: z.string(),
        status: z.enum(["done", "pending", "not_done"]).optional(),
      }),
    )
    .optional(),

  uncertainties: z.array(z.string()).optional(),
  operational_context: z
    .object({
      chaos_detected: z.boolean(),
      issues: z.array(z.string()),
    })
    .optional(),
});

export type StudentFactsV1 = z.infer<typeof StudentFactsV1>;
