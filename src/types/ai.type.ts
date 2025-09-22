import { z } from "zod";

export const aiStatusSchema = z.enum([
  "idle",
  "sending",
  "generating",
  "generated",
  "error",
  "edit",
  "adding-sound",
  "added-sound",
]);

export type AiStatus = z.infer<typeof aiStatusSchema>;

export const aiToolTypeSchema = z.enum(["image", "video", "music"]);

export type AiToolType = z.infer<typeof aiToolTypeSchema>;

export const generateBaseResultSchema = z.object({
  isError: z.boolean().optional().nullable(),
  text: z.string(),
});

export const generateTextResultSchema = z.object({
  taskId: z.string(),
  url: z.string().optional().nullable(),
});

export const generatedResultErrorSchema = z.object({
  isError: z.literal(true),
  error: z.string(),
});
export const generatedResultSuccessSchema = z.object({
  isError: z.literal(false),
  taskId: z.string(),
  url: z.string().optional().nullable(),
});

export const generatedResultSchema = z.union([
  generatedResultErrorSchema,
  generatedResultSuccessSchema,
]);
export type GeneratedResult = z.infer<typeof generatedResultSchema>;

// music is only sync without taskId
export const generateTextMusicResultSchema = z.object({
  url: z.string(),
});

export const generatedResultSuccessMusicSchema = z.object({
  isError: z.literal(false),
  url: z.string(),
});

export const generatedResultMusicSchema = z.union([
  generatedResultErrorSchema,
  generatedResultSuccessMusicSchema,
]);

export type GeneratedResultMusic = z.infer<typeof generatedResultMusicSchema>;
