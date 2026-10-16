import { z } from "zod";

export const loreCategories = [
  "personagem",
  "lugar",
  "faccao",
  "universo",
] as const;
export const loreSlug = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const loreContentSchema = z
  .object({
    titulo: z.string().trim().min(1).max(120),
    subtitulo: z.string().trim().max(180).default(""),
    resumo: z.string().trim().max(360).default(""),
    categoria: z.enum(loreCategories),
    texto: z.string().trim().max(30000).default(""),
    cartas: z
      .array(z.string().regex(/^\d{3,6}$/))
      .max(12)
      .default([])
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Não repita cartas vinculadas.",
      ),
    fonteURL: z
      .string()
      .max(600)
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password;
        } catch {
          return false;
        }
      }, "Use uma URL https válida ou deixe a fonte vazia.")
      .default(""),
  })
  .strict();
export const saveLoreSchema = z
  .object({
    content: loreContentSchema,
    expectedVersion: z.number().int().min(0),
    action: z.enum(["draft", "publish", "unpublish"]),
  })
  .strict();
export type LoreContent = z.infer<typeof loreContentSchema>;
export interface LoreRecord {
  slug: string;
  version: number;
  draft: LoreContent;
  published: LoreContent | null;
  publishedAt: Date | null;
}
