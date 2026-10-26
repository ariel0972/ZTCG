import { completeCoin } from "./support/coin";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import raw from "../src/data/catalog.json";
import { cardSchema, Card } from "../src/types/card";
import { Game } from "../src/game/engine";
import type { Instance } from "../src/game/state";
import { playableErrors } from "../src/game/capabilities";
import CardModel from "../src/db/models/Card";
import { cleanCard } from "../src/services/catalog";
const catalog = raw.map((c) => cardSchema.parse(c));

test("configurações especiais preservam variantes e espera na persistência e rejeitam combinações sem uso", () => {
  for (const id of ["005", "008", "016", "028"]) {
    const card = catalog.find((c) => c.numeroCatalogo === id)!;
    const doc = new CardModel(card);
    assert.equal(doc.validateSync(), undefined);
    const restored = cardSchema.parse(cleanCard(doc.toObject()));
    assert.deepEqual(restored.efeitos, card.efeitos);
    assert.deepEqual(restored.habilidadesPassivas, card.habilidadesPassivas);
    assert.deepEqual(playableErrors(restored), []);
  }
  const base = catalog.find((c) => c.numeroCatalogo === "005")!;
  assert.ok(
    playableErrors(
      cardSchema.parse({
        ...base,
        efeitos: [{ id: "damage", valor: 3, variantesMago: [] }],
      }),
    ).length,
  );
  assert.ok(
    playableErrors(
      cardSchema.parse({
        ...base,
        efeitos: [{ id: "arrowRain", valor: 3, duracao: 0 }],
      }),
    ).length,
  );
  assert.ok(
    playableErrors(
      cardSchema.parse({
        ...base,
        efeitos: [
          {
            id: "arrowRain",
            valor: 3,
            variantesMago: [
              {
                elemento: "Agua",
                efeitos: [
                  {
                    id: "status",
                    alvo: "TodasTropasInimigas",
                    status: "Queimando",
                    valor: 9,
                    duracao: 2,
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).length,
    "aliases também respeitam o limite de intensidade",
  );
  assert.ok(
    playableErrors(
      cardSchema.parse({
        ...base,
        efeitos: [
          {
            id: "arrowRain",
            valor: 3,
            variantesMago: [{ elemento: "Fogo" }, { elemento: "Fogo" }],
          },
        ],
      }),
    ).length,
  );
});

test("Chuva usa dano e duração configurados, com bônus da variante do mago", () => {
  let g = make("Fogo");
  const target = troop(g, "p2", 0, 50);
  cast(g, "005", [], "p1", {
    efeitos: [
      {
        id: "arrowRain",
        valor: 4,
        duracao: 3,
        variantesMago: [{ elemento: "Fogo", bonusDano: 2 }],
      },
    ],
  });
  assert.equal(g.state.ongoingSpells![0].damage, 6);
  assert.equal(g.state.ongoingSpells![0].rounds, 3);
  assert.equal(target.card!.hpAtual, 50);
  g = Game.restore(g.exportState());
  for (const rounds of [2, 1, 0]) {
    endRound(g);
    assert.equal(g.state.ongoingSpells![0]?.rounds ?? 0, rounds);
  }
  assert.equal(g.player("p2").mage.hpAtual, 2);
  assert.equal(
    g.state.slots.find((s) => s.id === target.id)!.card!.hpAtual,
    32,
  );
});

test("variante troca o status e configura duração/intensidade sem congelar pelo código fixo", () => {
  const g = make("Agua"),
    target = troop(g, "p2", 0, 50);
  cast(g, "005", [], "p1", {
    efeitos: [
      {
        id: "arrowRain",
        valor: 2,
        duracao: 1,
        variantesMago: [
          {
            elemento: "Agua",
            efeitos: [
              {
                id: "status",
                alvo: "TodasTropasInimigas",
                status: "Queimado",
                valor: 2,
                duracao: 4,
                unidade: "rodada",
              },
            ],
          },
        ],
      },
    ],
  });
  const burned = target.card!.statuses.find((s) => s.nome === "Queimado")!;
  assert.equal(burned.turnosRestantes, 4);
  assert.equal(burned.valor, 2);
  assert.ok(!target.card!.statuses.some((s) => s.nome === "Congelado"));
  assert.equal(g.player("p2").mage.statuses.length, 0);
  endRound(g);
  assert.equal(target.card!.hpAtual, 46);
  assert.equal(g.player("p2").mage.hpAtual, 18);
});

test("Bola configura dano, status e duração por mago; variante vazia desliga dano e legado continua compatível", () => {
  const g = make("Ar");
  cast(g, "008", [], "p1", {
    efeitos: [
      {
        id: "lightOrb",
        valor: 4,
        status: "Cego",
        duracao: 1,
        variantesMago: [
          {
            elemento: "Ar",
            causaDano: true,
            bonusDano: 2,
            status: "Incapacitado",
            duracao: 3,
          },
        ],
      },
    ],
  });
  assert.equal(g.player("p2").mage.hpAtual, 14);
  assert.equal(
    g.player("p2").mage.statuses.find((s) => s.nome === "Incapacitado")!
      .turnosRestantes,
    3,
  );
  assert.ok(!g.player("p2").mage.statuses.some((s) => s.nome === "Cego"));
  const noDamage = make("Fogo");
  cast(noDamage, "008", [], "p1", {
    efeitos: [
      { id: "lightOrb", valor: 9, status: "", duracao: 1, variantesMago: [] },
    ],
  });
  assert.equal(noDamage.player("p2").mage.hpAtual, 20);
  assert.ok(
    !noDamage.player("p2").mage.statuses.some((s) => s.nome === "Cego"),
  );
  const legacy = make("Fogo");
  cast(legacy, "008", [], "p1", { efeitos: [{ id: "lightOrb", valor: 3 }] });
  assert.equal(legacy.player("p2").mage.hpAtual, 17);
  assert.equal(
    legacy.player("p2").mage.statuses.find((s) => s.nome === "Cego")!
      .turnosRestantes,
    1,
  );
  const opening = make("Ar");
  opening.state.phase = "PREPARATION";
  assert.throws(
    () =>
      cast(opening, "008", [], "p1", {
        efeitos: [
          {
            id: "lightOrb",
            valor: 4,
            variantesMago: [{ elemento: "Ar", causaDano: true }],
          },
        ],
      }),
    /preparação/,
  );
});
function act(g: Game, user: string, data: object) {
  return g.execute(user, {
    ...data,
    actionId: randomUUID(),
    version: g.state.version,
  });
}
function instance(
  id: string,
  ownerId = "p1",
  extra: Partial<Card> = {},
): Instance {
  const c = cardSchema.parse({
    ...catalog.find((c) => c.numeroCatalogo === id),
    ...extra,
  });
  return {
    ...c,
    id: randomUUID(),
    ownerId,
    hpAtual: c.hp ?? 0,
    statuses: [],
    attacked: false,
    usedAbility: false,
  };
}
function make(element: Card["elemento"] = "Neutro") {
  const cartas = catalog
    .filter((c) => c.publicado && c.tipo === "Tropa")
    .flatMap((c) => Array(3).fill(c.numeroCatalogo))
    .slice(0, 40);
  const g = new Game(
    randomUUID(),
    ["p1", "p2"].map((id) => ({
      id,
      nome: id,
      deck: { nome: "Test", mago: "108", cartas },
    })),
    catalog,
    () => 0.2,
  );
  act(g, "p1", { type: "endTurn" });
  act(g, "p2", { type: "endTurn" });
  completeCoin(g);
  g.state.current = "p1";
  g.state.turn = 3;
  g.state.round = 2;
  for (const p of g.state.players) {
    p.hand = [];
    p.mage.habilidadesPassivas = [];
    // Cenário neutro de 20 PV para medir somente as regras dos feitiços.
    p.mage.hp = 20;
    p.mage.hpAtual = 20;
    p.mage.fraqueza = [];
    p.mage.resistencia = [];
    p.mage.limites[0].feiticosUsados = 20;
    p.mana = 20;
  }
  g.player("p1").mage.elemento = element;
  return g;
}
function troop(g: Game, owner = "p2", column = 0, hp = 30) {
  const slot = g.state.slots.find(
    (s) => s.ownerId === owner && s.kind === "Tropa" && s.column === column,
  )!;
  slot.card = instance("020", owner, {
    hp,
    elemento: "Neutro",
    fraqueza: [],
    resistencia: [],
    habilidadesPassivas: [],
  });
  slot.card.hpAtual = hp;
  return new Proxy(slot, {
    get: (_target, key) =>
      Reflect.get(
        g.state.slots.find((s) => s.id === slot.id)!,
        key,
      ),
    set: (_target, key, value) =>
      Reflect.set(
        g.state.slots.find((s) => s.id === slot.id)!,
        key,
        value,
      ),
  });
}
function cast(
  g: Game,
  id: string,
  targets: string[] = [],
  user = "p1",
  extra: Partial<Card> = {},
) {
  const c = instance(id, user, extra);
  g.player(user).hand.push(c);
  act(g, user, { type: "play", cardId: c.id, targets });
  return c;
}
function endRound(g: Game) {
  act(g, "p1", { type: "endTurn" });
  act(g, "p2", { type: "endTurn" });
}
test("12 definições publicadas têm efeitos e descrições válidos", () => {
  for (const id of [
    "001",
    "002",
    "003",
    "004",
    "005",
    "006",
    "007",
    "008",
    "009",
    "010",
    "040",
    "090",
  ]) {
    const c = catalog.find((c) => c.numeroCatalogo === id)!;
    assert.equal(c.publicado, true);
    assert.ok(c.descricao.length > 30);
    assert.deepEqual(playableErrors(c), []);
  }
});
test("Tremor de Terra atinge tropas e mago, aplica Atordoado e Abalo ignora estrutura", () => {
  const g = make("Terra"),
    s = troop(g);
  s.structure = instance("060", "p2", { hp: 50 });
  s.structure.hpAtual = 50;
  const hp = g.player("p2").mage.hpAtual;
  cast(g, "007");
  assert.equal(s.card!.hpAtual, 24);
  assert.equal(s.structure.hpAtual, 50);
  assert.equal(g.player("p2").mage.hpAtual, hp - 6);
  assert.ok(s.card!.statuses.some((s) => s.nome === "Atordoado"));
  assert.ok(s.structure.statuses.some((s) => s.nome === "Abalo"));
});
test("pedras alternam alvos vivos e restantes vão ao mago; Neutro não cria token", () => {
  const g = make(),
    s = troop(g, "p2", 0, 1),
    hp = g.player("p2").mage.hpAtual;
  cast(g, "003");
  assert.equal(s.card, null);
  assert.equal(g.player("p2").mage.hpAtual, hp - 4);
  const g2 = make(),
    a = troop(g2);
  cast(g2, "010", [a.id]);
  assert.equal(a.card!.hpAtual, 28);
  assert.equal(a.appliedElement, undefined);
});
test("escudo bloqueia três golpes completos e quebra no terceiro", () => {
  const g = make(),
    s = troop(g, "p1");
  cast(g, "006", [s.id]);
  g.state.current = "p2";
  for (let i = 0; i < 3; i++) cast(g, "002", [s.id], "p2");
  assert.equal(s.card!.hpAtual, 30);
  assert.ok(!s.card!.statuses.some((s) => s.nome === "EscudoProtecao"));
  cast(g, "002", [s.id], "p2");
  assert.equal(s.card!.hpAtual, 26);
});
test("Furacão devolve tropa sem dano periódico ao mago e sobrevive serialização", () => {
  let g = make();
  const s = troop(g),
    id = s.card!.id,
    hp = g.player("p2").mage.hpAtual;
  cast(g, "004", [s.id]);
  assert.equal(g.state.slots.find((slot) => slot.id === s.id)!.card, null);
  assert.ok(g.player("p2").hand.some((c) => c.id === id));
  g = Game.restore(JSON.parse(JSON.stringify(g.exportState())));
  endRound(g);
  endRound(g);
  assert.equal(g.player("p2").mage.hpAtual, hp);
  assert.equal(g.state.ongoingSpells?.length ?? 0, 0);
});
test("Chuva de Flechas não causa dano inicial, impede duplicata e aplica dano no fim", () => {
  const g = make(),
    s = troop(g),
    hp = g.player("p2").mage.hpAtual;
  cast(g, "005");
  assert.equal(s.card!.hpAtual, 30);
  assert.throws(() => cast(g, "005"), /Chuva de Flechas/);
  endRound(g);
  assert.equal(s.card!.hpAtual, 27);
  assert.equal(g.player("p2").mage.hpAtual, hp - 3);
});
test("Chuva de Flechas de Água congela, mas seu dano periódico continua atingindo tropas", () => {
  const g = make("Agua"),
    s = troop(g),
    hp = g.player("p2").mage.hpAtual;
  cast(g, "005");
  assert.ok(s.card!.statuses.some((s) => s.nome === "Congelado"));
  endRound(g);
  assert.equal(s.card!.hpAtual, 27);
  assert.equal(g.player("p2").mage.hpAtual, hp - 3);
});
test("Bola de Luz impede conjuração do mago Cego", () => {
  const g = make("Fogo"),
    s = troop(g);
  cast(g, "008");
  assert.equal(s.card!.hpAtual, 27);
  g.state.current = "p2";
  assert.throws(
    () => cast(g, "002", [g.player("p1").mage.id], "p2"),
    /Cego|cego/,
  );
});
test("Furacão de Areia só cega e causa dano em tropas e rouba uma carta com mago de Ar", () => {
  const g = make("Ar"),
    s = troop(g),
    deck = g.player("p2").deck.length;
  const enemyHp = g.player("p2").mage.hpAtual;
  cast(g, "009");
  assert.equal(g.player("p2").deck.length, deck - 1);
  assert.equal(s.card!.hpAtual, 30);
  assert(s.card!.statuses.some((status) => status.nome === "Cego"));
  assert(
    !g.player("p2").mage.statuses.some((status) => status.nome === "Cego"),
  );
  endRound(g);
  assert.equal(s.card!.hpAtual, 28);
  assert.equal(g.player("p2").mage.hpAtual, enemyHp);
});
test("Meteoros escolhe tropas; só Golém próprio habilita todos e nunca mago", () => {
  const g = make(),
    a = troop(g),
    b = troop(g, "p2", 1);
  const hp = g.player("p2").mage.hpAtual;
  cast(g, "010", [a.id]);
  assert.equal(b.card!.hpAtual, 30);
  const own = troop(g, "p1");
  own.card!.numeroCatalogo = "025";
  cast(g, "010");
  assert.equal(b.card!.hpAtual, 28);
  assert.equal(g.player("p2").mage.hpAtual, hp);
  const g2 = make(),
    enemy = troop(g2);
  enemy.card!.numeroCatalogo = "025";
  assert.throws(() => cast(g2, "010"), /alvo|Alvo/);
});
test("Bola de Fogo + Furacão não concede mais o dano da combinação antiga", () => {
  for (const reverse of [false, true]) {
    const g = make(),
      a = troop(g),
      b = troop(g, "p2", 1),
      hp = g.player("p2").mage.hpAtual;
    if (reverse) {
      cast(g, "004", [a.id]);
      cast(g, "001");
    } else {
      cast(g, "001");
      cast(g, "004", [a.id]);
    }
    assert.equal(g.state.slots.find((s) => s.id === b.id)!.card!.hpAtual, 27);
    assert.equal(g.player("p2").mage.hpAtual, hp);
    assert.equal(g.state.ongoingSpells?.length ?? 0, 0);
  }
});
test("Lágrima/Fluxo ativam somente com outro Zarcos posterior, uma vez por cópia", () => {
  const g = make();
  g.player("p1").mana = 5;
  const tear = cast(g, "040");
  assert.equal(g.player("p1").mana, 8);
  const flow = cast(g, "090");
  assert.ok(g.player("p1").hand.some((c) => c.id === tear.id));
  const before = g.player("p1").deck.length;
  act(g, "p1", { type: "play", cardId: tear.id });
  assert.equal(g.player("p1").deck.length, before - 1);
  cast(g, "040");
  assert.ok(g.player("p1").graveyard.some((c) => c.id === tear.id));
  assert.ok(g.player("p1").zarcosTriggered?.includes(flow.id));
});

test("feitiços de rodada coexistem por jogador, bloqueiam só duplicata própria e preservam a arte", () => {
  const g = make();
  cast(g, "005");
  assert.throws(() => cast(g, "005"), /ativo/);
  g.state.current = "p2";
  cast(g, "005", [], "p2");
  assert.equal(g.state.ongoingSpells?.length, 2);
  assert.ok(
    g.state.ongoingSpells?.every((s) =>
      s.card?.imgURL?.includes("Chuva de Flechas"),
    ),
  );
  const restored = Game.restore(g.exportState());
  restored.state.current = "p1";
  const before = restored.state.players.map((p) => p.mage.hpAtual);
  endRound(restored);
  assert.deepEqual(
    restored.state.players.map((p) => p.mage.hpAtual),
    before.map((h) => h - 3),
  );
  assert.deepEqual(
    restored.state.ongoingSpells?.map((s) => s.rounds),
    [1, 1],
  );
  endRound(restored);
  assert.equal(restored.state.ongoingSpells?.length, 0);
  for (const id of ["009"]) {
    const game = make();
    const a = troop(game);
    cast(game, id, id === "004" ? [a.id] : []);
    const next = troop(game);
    assert.throws(() => cast(game, id, id === "004" ? [next.id] : []), /ativo/);
    game.state.current = "p2";
    // Isolate coexistence; the independent Cego casting restriction is tested above.
    game.player("p2").mage.statuses = [];
    const own = troop(game, "p1");
    cast(game, id, id === "004" ? [own.id] : [], "p2");
    assert.equal(game.state.ongoingSpells?.length, 2);
  }
});

test("efeitos de lados opostos que derrotam ambos os magos no mesmo fim de rodada empatam", () => {
  for (const reverse of [false, true]) {
    const g = make();
    cast(g, "005");
    g.state.current = "p2";
    cast(g, "005", [], "p2");
    if (reverse) g.state.ongoingSpells!.reverse();
    for (const p of g.state.players) p.mage.hpAtual = 3;
    g.state.current = "p1";
    endRound(g);
    assert.equal(g.state.status, "FINISHED");
    assert.equal(g.state.winner, null);
    assert.match(g.state.reason!, /dois magos/);
    assert.ok(g.state.players.every((p) => p.mage.hpAtual <= 0));
  }
});
test("Jato fora de turno cancela multi-alvo sem dano, consome tudo e conta passivas", () => {
  const g = make("Fogo");
  g.player("p1").mage.habilidadesPassivas = catalog.find(
    (c) => c.numeroCatalogo === "016",
  )!.habilidadesPassivas;
  const a = troop(g),
    jato = instance("002", "p2");
  g.player("p2").hand.push(jato);
  const spell = cast(g, "001");
  assert.ok(g.state.pendingSpell);
  assert.equal(a.card!.hpAtual, 30);
  assert.throws(
    () => act(g, "p1", { type: "endTurn" }),
    /resposta|pendente|Aguarde/,
  );
  act(g, "p2", { type: "respondSpell", cardId: jato.id });
  assert.equal(g.state.pendingSpell, undefined);
  assert.equal(a.card!.hpAtual, 30);
  assert.equal(g.player("p1").mana, 16);
  assert.equal(g.player("p2").mana, 17);
  assert.equal(g.player("p2").counters.spells, 1);
  assert.ok(g.player("p1").graveyard.some((c) => c.id === spell.id));
  assert.equal(g.player("p1").mage.fireSpellsCast, 1);
});
test("Jato não oferece janela para assinatura, sem mana ou limite esgotado; declinar resolve", () => {
  for (const mode of ["signature", "mana", "limit"]) {
    const g = make(),
      s = troop(g);
    g.player("p2").hand.push(instance("002", "p2"));
    if (mode === "mana") g.player("p2").mana = 2;
    if (mode === "limit") g.player("p2").counters.spells = 20;
    cast(g, "001", [], "p1", { assinatura: mode === "signature" });
    assert.equal(g.state.pendingSpell, undefined);
    assert.equal(s.card!.hpAtual, 27);
  }
  const g = make(),
    s = troop(g);
  g.player("p2").hand.push(instance("002", "p2"));
  cast(g, "001");
  act(g, "p2", { type: "respondSpell" });
  assert.equal(s.card!.hpAtual, 27);
});
test("sacrifício é exclusivo do Necromante", () => {
  const g = make(),
    s = troop(g, "p1");
  g.player("p1").mage.numeroCatalogo = "017";
  assert.throws(
    () => act(g, "p1", { type: "sacrifice", slotId: s.id }),
    /Necromante/,
  );
});
