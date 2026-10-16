import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../src/application";
import { fakeDatabase } from "./support/database";
import Lore from "../src/db/models/lore";
import { loreContentSchema } from "../src/types/lore";

test("lore: leitura pública leve, rascunho separado, publicar/retirar e conflito de versões", async () => {
  process.env.SECRET = "lore-tests-only-012345678901234567890123456789";
  const db = await fakeDatabase();
  const server = createServer(createApp([], async () => mongoose));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const admin = jwt.sign({ id: "3".repeat(24) }, process.env.SECRET);
  const player = jwt.sign({ id: "1".repeat(24) }, process.env.SECRET);
  const headers = {
    Authorization: `Bearer ${admin}`,
    "Content-Type": "application/json",
  };
  const request = async (path: string, options: RequestInit = {}) => {
    const response = await fetch(base + path, options);
    return { response, data: await response.json() };
  };
  try {
    for (const path of ["/lore", "/lore/llan-dukai", "/HTML/admin-lore.html"])
      assert.equal((await fetch(base + path)).status, 200);
    const catalog = await request("/cards");
    const initial = await request("/lore-data");
    assert.equal(initial.data.entries.length, 2);
    assert.ok(
      initial.data.entries.every(
        (entry: any) =>
          !Object.prototype.hasOwnProperty.call(entry, "texto") &&
          !Object.prototype.hasOwnProperty.call(entry, "draft"),
      ),
    );
    assert.match(
      initial.response.headers.get("Cache-Control")!,
      /must-revalidate/,
    );
    const first = (await request("/lore-data/llan-dukai")).data.entry;
    assert.match(first.texto, /Oronai/);
    assert.equal(first.cards[0].numeroCatalogo, "020");
    assert.equal(
      first.cards[0].habilidadesPassivas,
      undefined,
      "lore não transporta regras de combate",
    );
    const arena = (await request("/lore-data/arena-de-thumos")).data.entry;
    assert.match(arena.texto, /três anos/);
    assert.match(arena.texto, /Unma/);
    assert.equal((await request("/admin/lore")).response.status, 401);
    assert.equal(
      (
        await request("/admin/lore", {
          headers: { Authorization: `Bearer ${player}` },
        })
      ).response.status,
      401,
    );
    const editor = await request("/admin/lore/llan-dukai", { headers });
    assert.equal(editor.response.headers.get("Cache-Control"), "no-store");
    const content = {
      ...editor.data.entry.draft,
      titulo: "Título em revisão",
      texto: "CONTEUDO_PRIVADO_RASCUNHO",
      resumo: "Resumo em revisão.",
    };
    const save = (action: string, expectedVersion: number, next = content) =>
      request("/admin/lore/llan-dukai", {
        method: "PUT",
        headers,
        body: JSON.stringify({ action, expectedVersion, content: next }),
      });
    const draft = await save("draft", 1);
    assert.equal(draft.response.status, 200);
    assert.equal(draft.data.entry.version, 2);
    assert.equal(
      (await request("/lore-data/llan-dukai")).data.entry.texto,
      first.texto,
    );
    assert.ok(
      !JSON.stringify((await request("/lore-data")).data).includes(
        "CONTEUDO_PRIVADO_RASCUNHO",
      ),
    );
    assert.equal((await save("publish", 1)).response.status, 409);
    assert.equal(
      (await save("publish", 2, { ...content, texto: "" })).response.status,
      422,
    );
    assert.equal(
      (await save("publish", 2, { ...content, cartas: ["999999"] })).response
        .status,
      422,
    );
    assert.equal(
      (
        await save("publish", 2, {
          ...content,
          fonteURL: "javascript:alert(1)",
        })
      ).response.status,
      422,
    );
    const publish = await save("publish", 2);
    assert.equal(publish.response.status, 200);
    assert.equal(
      (await request("/lore-data/llan-dukai")).data.entry.texto,
      content.texto,
    );
    const revised = { ...content, texto: "OUTRA_REVISAO_PRIVADA" };
    const pending = await save("draft", 3, revised);
    assert.equal(pending.data.entry.version, 4);
    assert.equal(
      (await request("/lore-data/llan-dukai")).data.entry.texto,
      content.texto,
    );
    const hidden = await save("unpublish", 4, revised);
    assert.equal(hidden.data.entry.version, 5);
    assert.equal(
      (await request("/lore-data/llan-dukai")).response.status,
      404,
      "rascunho não reativa o texto inicial do Notion",
    );
    assert.equal((await request("/lore-data")).data.entries.length, 1);
    assert.equal(
      (await request("/admin/lore/llan-dukai", { headers })).data.entry.draft
        .texto,
      revised.texto,
    );
    assert.equal((await save("publish", 5, revised)).response.status, 200);
    assert.equal(
      (await request("/lore-data/llan-dukai")).data.entry.texto,
      revised.texto,
    );
    const parallel = await Promise.all([save("draft", 6), save("draft", 6)]);
    assert.deepEqual(parallel.map((r) => r.response.status).sort(), [200, 409]);
    assert.deepEqual(
      (await request("/cards")).data,
      catalog.data,
      "editar lore não altera o catálogo do jogo",
    );
    assert.equal(db.lores.length, 1);
    const createDraft = await request("/admin/lore/historia-nova", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        action: "draft",
        expectedVersion: 0,
        content: { titulo: "Só um começo", categoria: "universo" },
      }),
    });
    assert.equal(createDraft.response.status, 200);
    assert.equal(createDraft.data.entry.published, null);
    assert.equal(
      (await request("/lore-data/historia-nova")).response.status,
      404,
    );
    assert.ok(
      (await request("/admin/lore", { headers })).data.entries.some(
        (entry: any) => entry.slug === "historia-nova" && !entry.publicado,
      ),
    );
    const model = new Lore(createDraft.data.entry);
    assert.equal(model.validateSync(), undefined);
    assert.deepEqual(
      loreContentSchema.parse(model.toObject().draft),
      createDraft.data.entry.draft,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.restore();
  }
});
