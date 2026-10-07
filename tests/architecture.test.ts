import test from "node:test";
import assert from "node:assert/strict";
import { auditProject } from "../scripts/audit-project";
import { cardReference } from "../src/domain/deck";
import { mergeCatalog } from "../src/services/catalog";
import rawCatalog from "../src/data/catalog.json";

test("arquitetura: imports, assets com caixa exata, catálogo e guia de cada arquivo", async () => {
  const report = await auditProject();
  assert.deepEqual(report.errors, []);
  assert.equal(report.cards, 130);
});
test("referências antigas do Médico seguem o número atual sem confundir Palhaço", () => {
  assert.equal(cardReference({ id: 98, name: "Médico da Peste" }), "107");
  assert.equal(cardReference("900098"), "107");
  assert.equal(cardReference("098"), "098");
  assert.equal(
    cardReference({ numeroCatalogo: "098", nome: "Palhaço" }),
    "098",
  );
  const doctor = rawCatalog.find((c) => c.numeroCatalogo === "107")!;
  const alias = { ...doctor, numeroCatalogo: "900098", versao: 9 };
  assert.equal(mergeCatalog([alias]).cards.length, 130);
  for (const records of [
    [alias, doctor],
    [doctor, alias],
  ]) {
    const merged = mergeCatalog(records);
    assert.equal(
      merged.cards.find((c) => c.numeroCatalogo === "107")!.versao,
      doctor.versao,
    );
    assert.ok(!merged.cards.some((c) => c.numeroCatalogo === "900098"));
  }
});
