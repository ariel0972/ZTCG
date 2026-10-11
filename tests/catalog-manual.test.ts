import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cardSchema } from "../src/types/card";
import { playableErrors } from "../src/game/capabilities";
import CardModel from "../src/db/models/Card";

test("todos os exemplos completos do manual TXT são válidos, executáveis e persistíveis", async () => {
  const text = await readFile(
    path.join(__dirname, "../MANUAL_EFEITOS_CATALOGO.txt"),
    "utf8",
  );
  const blocks = [
    ...text.matchAll(
      /EXEMPLO_JSON_INICIO [^\n]+\n([\s\S]*?)\nEXEMPLO_JSON_FIM/g,
    ),
  ];
  assert.ok(blocks.length >= 20);
  const types = new Set<string>(),
    elements = new Set<string>();
  for (const [, json] of blocks) {
    const card = cardSchema.parse(JSON.parse(json));
    assert.deepEqual(playableErrors(card), [], card.nome);
    const document = new CardModel(card);
    await document.validate();
    const { _id, __v, ...stored } = document.toObject();
    assert.doesNotThrow(() => cardSchema.parse(stored), card.nome);
    types.add(card.tipo);
    if (card.elemento) elements.add(card.elemento);
  }
  assert.equal(types.size, 5);
  assert.equal(elements.size, 6);
});

test("combinações novas incoerentes são recusadas pelo catálogo", () => {
  const base = {
    numeroCatalogo: "999",
    nome: "Teste",
    tipo: "Feitico",
    custoMana: 1,
    alvo: "UnicoInimigo",
  };
  for (const efeitos of [
    [{ id: "searchNamed" }],
    [{ id: "damage", valor: 2, seNaoUsada: "053" }],
    [{ id: "damage", valor: 2, unidade: "turno" }],
    [{ id: "status", status: "BonusAtaque", duracao: 1 }],
    [{ id: "status", status: "Queimacao", duracao: 1, unidade: "turno" }],
    [
      {
        id: "status",
        status: "ReducaoDano",
        valor: 2,
        duracao: 1,
        requerStatus: "Inventado",
      },
    ],
  ])
    assert.ok(
      playableErrors(cardSchema.parse({ ...base, efeitos })).length,
      JSON.stringify(efeitos),
    );
});
