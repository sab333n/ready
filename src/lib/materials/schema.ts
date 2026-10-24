import { z } from "zod";

export const MaterialExtraction = z.object({
  course: z.object({
    code: z.string().nullable().describe("Course code such as PHARM 201, or null"),
    name: z.string().nullable().describe("Course title, or null"),
  }),
  deadlines: z.array(
    z.object({
      title: z.string(),
      kind: z.enum(["exam", "quiz", "assignment", "other"]),
      date: z.string().describe("YYYY-MM-DD"),
      time: z.string().nullable().describe("HH:MM 24h, or null"),
    }),
  ),
  topics: z.array(z.object({ name: z.string(), prerequisites: z.array(z.string()) })),
  notes: z.string().nullable(),
});

export type MaterialExtraction = z.infer<typeof MaterialExtraction>;
