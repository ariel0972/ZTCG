import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import {
  createTutorial,
  advanceTutorial,
  tutorialView,
} from "../src/game/tutorial";

test("jogador conclui tutorial por cartas e alvos reais, pode pular e refazer sem erro de interface", async () => {
  const dom = new JSDOM(await readFile("public/HTML/tutorial.html", "utf8"), {
    url: "http://localhost/tutorial",
    pretendToBeVisual: true,
  });
  const doc = dom.window.document,
    previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: doc,
  });
  Object.assign(dom.window.HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.open = true;
    },
    close(this: HTMLDialogElement) {
      this.open = false;
    },
  });
  const path = "../public/JS/tutorial-controller.js";
  const { createTutorialController } = await import(path);
  let progress = createTutorial("1".repeat(24), "Aprendiz"),
    errors: any[] = [];
  const controller = createTutorialController(
    doc,
    { id: progress._id },
    {
      request: async (path: string, opts: any) => {
        if (path === "/tutorial/restart")
          progress = {
            ...createTutorial(progress._id, "Aprendiz"),
            version: progress.version + 1,
          };
        else if (opts)
          progress = advanceTutorial(progress, JSON.parse(opts.body));
        return tutorialView(progress);
      },
      onError: (e: any) => errors.push(e),
    },
  );
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const click = async (selector: string, text?: string) => {
    const node = [...doc.querySelectorAll<HTMLButtonElement>(selector)].find(
      (n) => !text || n.textContent?.includes(text),
    );
    assert.ok(node, "Missing " + selector + " " + text);
    assert.equal(node.disabled, false);
    node.click();
    await settle();
  };
  try {
    await controller.load();
    assert.match(
      doc.getElementById("lesson-title")!.textContent!,
      /primeira partida/i,
    );
    await click("#lesson-controls button", "Começar");
    await click('.tutorial-hand-card[data-catalog="020"]');
    assert.equal(
      (doc.getElementById("tutorial-card-dialog") as HTMLDialogElement).open,
      true,
    );
    assert.match(
      doc.getElementById("tutorial-card-content")!.textContent!,
      /Vida: 9/,
    );
    await click("#tutorial-card-close");
    await click('.tutorial-hand-card[data-catalog="020"]');
    await click("#tutorial-action button", "Mobilizar");
    await click(".tutorial-slot.tutorial-highlight");
    await click("#lesson-controls button", "Confirmar");
    await click("#lesson-controls button", "Cara");
    await new Promise((r) => setTimeout(r, 900));
    await click("#lesson-controls button", "Iniciar");
    await click("#lesson-controls button", "Passar");
    await click("#lesson-controls button", "Ver o turno");
    await click('.tutorial-hand-card[data-catalog="023"]');
    await click("#tutorial-action button", "Mobilizar");
    await click(".tutorial-slot.tutorial-highlight");
    await click('.tutorial-slot[data-catalog="023"]');
    await click("#tutorial-action button", "Modo Ofensivo");
    await click('.tutorial-slot[data-catalog="023"]');
    await click("#tutorial-action button", "Atacar");
    await click(".tutorial-slot.tutorial-highlight");
    await click('.tutorial-hand-card[data-catalog="057"]');
    await click("#tutorial-action button", "Conjurar");
    await click(".tutorial-slot.tutorial-highlight");
    await click("#lesson-controls button", "Passar");
    assert.match(
      doc.getElementById("lesson-title")!.textContent!,
      /metade do ciclo/,
    );
    await click("#lesson-controls button", "Acompanhar");
    await click('button[data-graveyard="tutorial-coach"]');
    await click("#tutorial-card-close");
    await click('.tutorial-slot[data-catalog="023"]');
    await click("#tutorial-action button", "Atacar");
    await click(".tutorial-mage.tutorial-highlight");
    assert.equal(controller.snapshot.completed, true);
    assert.equal(doc.getElementById("tutorial-complete")!.hidden, false);
    assert.equal(
      doc.querySelector<HTMLElement>(".tutorial-lesson")!.hidden,
      true,
    );
    assert.equal(doc.activeElement?.id, "tutorial-complete-title");
    assert.equal(doc.getElementById("tutorial-recap")!.hidden, false);
    assert.deepEqual(errors, []);
    await click("#restart-tutorial");
    assert.equal(controller.snapshot.step, 0);
    assert.equal(
      doc.querySelector<HTMLElement>(".tutorial-lesson")!.hidden,
      false,
    );
    await click("#skip-tutorial");
    assert.equal(controller.snapshot.skipped, true);
    assert.equal(doc.getElementById("tutorial-recap")!.hidden, true);
    assert.match(
      doc.getElementById("tutorial-complete-title")!.textContent!,
      /começar/,
    );
  } finally {
    controller.close();
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
    dom.window.close();
  }
});
test("redirecionamento exige tutorial uma vez e mantém a própria página acessível", async () => {
  const path = "../public/JS/tutorial-access.js";
  const { landingPage, needsTutorialRedirect, loginDestination } = await import(
    path
  );
  assert.equal(landingPage({ tutorialRequired: true }), "/tutorial");
  assert.equal(landingPage({ tutorialRequired: false }), "/");
  assert.equal(
    await loginDestination({ tutorialRequired: true }, async () => ({
      match: { status: "ACTIVE" },
    })),
    "/HTML/index.html",
  );
  assert.equal(
    await loginDestination({ tutorialRequired: true }, async () => ({
      match: null,
    })),
    "/tutorial",
  );
  assert.equal(
    needsTutorialRedirect({ tutorialRequired: true }, "/HTML/index.html"),
    true,
  );
  assert.equal(
    needsTutorialRedirect({ tutorialRequired: true }, "/tutorial"),
    false,
  );
  assert.equal(
    needsTutorialRedirect({ tutorialRequired: false }, "/HTML/login.html"),
    false,
  );
});
