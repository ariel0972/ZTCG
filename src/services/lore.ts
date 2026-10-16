import Lore from "../db/models/lore";
import initial from "../data/lore.json";
import { AppError } from "../lib/errors";
import { ReadCache } from "../lib/read-cache";
import {
  loreContentSchema,
  type LoreContent,
  type LoreRecord,
  type saveLoreSchema,
} from "../types/lore";
import type { z } from "zod";
import { getCatalog } from "./catalog";

const seeds = new Map<string, LoreRecord>(
  initial.map(({ slug, ...raw }) => {
    const content = loreContentSchema.parse(raw);
    return [
      slug,
      {
        slug,
        version: 1,
        draft: content,
        published: content,
        publishedAt: null,
      },
    ];
  }),
);
const publicCache = new ReadCache<{ slug: string; content: LoreContent }[]>(
  15000,
  1,
);
export const invalidateLore = () => publicCache.clear();
export async function loreCards() {
  return (await getCatalog()).map(({ numeroCatalogo, nome, tipo, imgURL }) => ({
    numeroCatalogo,
    nome,
    tipo,
    imgURL,
  }));
}
async function publishedLore() {
  return publicCache.get("public", async () => {
    const map = new Map(
      [...seeds].map(([slug, entry]) => [slug, entry.published]),
    );
    // Read only the public snapshot; drafts are never loaded into the public cache.
    const records = await Lore.find().select("slug published").lean();
    for (const entry of records)
      map.set(
        entry.slug,
        entry.published ? loreContentSchema.parse(entry.published) : null,
      );
    return [...map].flatMap(([slug, content]) =>
      content ? [{ slug, content }] : [],
    );
  });
}
export async function listPublicLore() {
  const [entries, cards] = await Promise.all([publishedLore(), loreCards()]);
  return entries.map(({ slug, content: { texto: _text, ...content } }) => ({
    slug,
    ...content,
    cards: cards.filter((card) => content.cartas.includes(card.numeroCatalogo)),
  }));
}
export async function publicLore(slug: string) {
  const entry = (await publishedLore()).find((e) => e.slug === slug);
  if (!entry) throw new AppError(404, "História não encontrada.", "NOT_FOUND");
  const cards = (await loreCards()).filter((card) =>
    entry.content.cartas.includes(card.numeroCatalogo),
  );
  return { ...structuredClone(entry.content), slug, cards };
}
export async function editorLore(slug: string): Promise<LoreRecord | null> {
  const record = await Lore.findOne({ slug }).lean();
  return record
    ? {
        slug: record.slug,
        version: record.version,
        draft: loreContentSchema.parse(record.draft),
        published: record.published
          ? loreContentSchema.parse(record.published)
          : null,
        publishedAt: record.publishedAt,
      }
    : structuredClone(seeds.get(slug) ?? null);
}
export async function listEditorLore() {
  const map = new Map(
    [...seeds].map(([slug, entry]) => [
      slug,
      {
        slug,
        titulo: entry.draft.titulo,
        categoria: entry.draft.categoria,
        publicado: !!entry.published,
      },
    ]),
  );
  const records = await Lore.find()
    .select("slug draft.titulo draft.categoria published.titulo")
    .lean();
  for (const entry of records)
    map.set(entry.slug, {
      slug: entry.slug,
      titulo: entry.draft.titulo,
      categoria: entry.draft.categoria,
      publicado: !!entry.published,
    });
  return [...map.values()].sort((a, b) =>
    a.titulo.localeCompare(b.titulo, "pt-BR"),
  );
}
export async function saveLore(
  slug: string,
  body: z.infer<typeof saveLoreSchema>,
) {
  const cards = await loreCards();
  if (
    body.content.cartas.some(
      (id) => !cards.some((card) => card.numeroCatalogo === id),
    )
  )
    throw new AppError(
      422,
      "Uma das cartas vinculadas não existe no catálogo.",
    );
  if (
    body.action === "publish" &&
    (!body.content.texto.trim() || !body.content.resumo.trim())
  )
    throw new AppError(
      422,
      "Preencha o resumo e a história antes de publicar.",
    );
  const stored = await Lore.findOne({ slug }).lean();
  const current = stored ?? seeds.get(slug);
  if ((current?.version ?? 0) !== body.expectedVersion)
    throw new AppError(
      409,
      "A história foi alterada. Recarregue antes de salvar.",
      "CONFLICT",
    );
  const next: LoreRecord = {
    slug,
    version: body.expectedVersion + 1,
    draft: body.content,
    published:
      body.action === "publish"
        ? body.content
        : body.action === "unpublish"
          ? null
          : (current?.published ?? null),
    publishedAt:
      body.action === "publish"
        ? new Date()
        : body.action === "unpublish"
          ? null
          : (current?.publishedAt ?? null),
  };
  if (stored) {
    const saved = await Lore.findOneAndUpdate(
      { slug, version: body.expectedVersion },
      { $set: next },
      { new: true, runValidators: true },
    );
    if (!saved)
      throw new AppError(
        409,
        "A história foi alterada. Recarregue antes de salvar.",
        "CONFLICT",
      );
  } else {
    try {
      await Lore.create(next);
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new AppError(
          409,
          "Esse endereço de história já existe. Recarregue.",
          "CONFLICT",
        );
      throw error;
    }
  }
  if (body.action !== "draft") invalidateLore();
  return structuredClone(next);
}
