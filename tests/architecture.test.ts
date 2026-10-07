import test from "node:test";
import assert from "node:assert/strict";
import { auditProject } from "../scripts/audit-project";

test("arquitetura: imports, assets com caixa exata, catálogo e guia de cada arquivo", async () => {
  const report = await auditProject();
  assert.deepEqual(report.errors, []);
  assert.equal(report.cards, 130);
});
