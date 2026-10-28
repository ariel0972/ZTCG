import { randomUUID } from "node:crypto";
import initial from "../data/catalog.json";
import { cardSchema } from "../types/card";
import { AppError } from "../lib/errors";
import { Game } from "./engine";
import type { Instance } from "./state";

export const tutorialVersion = 1;
export const tutorialLessons = [
  {
    id: "welcome",
    title: "Sua primeira partida",
    body: "Vença reduzindo a vida do mago inimigo a zero. Você vai aprender jogando, em cerca de 3 minutos.",
    hint: "Este é um treino guiado, sem cronômetro, XP ou histórico. O mago de treino já está ferido, com 5 PV, para terminar rápido.",
    button: "Começar treino",
    action: "continue",
    focus: "board",
  },
  {
    id: "hand",
    title: "Conheça sua mão",
    body: "As cartas na parte de baixo estão na sua mão. Clique no Assassino para conhecer seus números antes de jogar.",
    hint: "Na mão, o número azul é o custo de mana. O coração mostra a vida e a espada, o ataque. A descrição explica habilidades e passivas.",
    action: "inspect",
    focus: "hand",
  },
  {
    id: "preparation",
    title: "Prepare seu campo",
    body: "Escolha o Assassino na mão e um espaço vazio da sua frente para colocá-lo em campo.",
    hint: "Na preparação, tropas comuns entram de graça. Você pode retirar ou trocar suas tropas antes de confirmar. Feitiços e Invocações ficam bloqueados.",
    action: "play",
    focus: "hand",
    card: "020",
  },
  {
    id: "ready",
    title: "Tudo pronto?",
    body: "Sua tropa está em campo. O indicador azul agora mostra quanto ela recupera de mana no início do seu turno.",
    hint: "Seu mago fica atrás. As tropas ficam na frente. Depois que os dois confirmam a preparação, vem o cara ou coroa.",
    button: "Confirmar preparação",
    action: "endTurn",
    focus: "end",
  },
  {
    id: "coin",
    title: "Quem começa?",
    body: "Escolha cara ou coroa. O adversário recebe a face oposta. Em partidas normais, a moeda decide quem começa, com chances iguais.",
    hint: "O resultado deste treino é guiado: você começa para praticar a abertura.",
    action: "chooseCoin",
    focus: "coin",
  },
  {
    id: "coinResult",
    title: "Você começa o treino",
    body: "A moeda mostrou a sua escolha! Agora começa o combate, com turnos alternados entre os dois jogadores.",
    hint: "No início do seu turno, você compra 1 carta e recupera mana com o mago e as cartas em campo, até o máximo de 20.",
    button: "Iniciar combate",
    action: "continue",
    focus: "coin",
  },
  {
    id: "opening",
    title: "O primeiro turno é diferente",
    body: "No turno 1, quem começa só pode mobilizar tropas. Você já tem uma tropa preparada; passe para acompanhar a vez do adversário.",
    hint: "Nos turnos 1 e 2, armamentos e estruturas são proibidos. No turno 2, o segundo jogador pode atacar e usar ações que não causem dano. A partir do turno 3, tudo é liberado.",
    button: "Passar turno",
    action: "endTurn",
    focus: "end",
  },
  {
    id: "opponentOpening",
    title: "Agora é a vez do adversário",
    body: "Você não pode fazer suas ações enquanto o adversário joga. Neste exemplo, ele vai atacar seu Assassino e depois passar o turno.",
    hint: "Uma rodada de efeito é um ciclo completo: você passa e o adversário passa. Isso não depende de quem começou a partida.",
    button: "Ver o turno do adversário",
    action: "continue",
    focus: "opponent",
  },
  {
    id: "mobilize",
    title: "Mana e mobilização",
    body: "Sua vez de novo! Você comprou uma carta e recuperou mana. Coloque o Guerreiro em outro espaço destacado, que alcance o inimigo; agora ele custa 3 de mana.",
    hint: "Mobilize antes de começar seus ataques. Os limites de tropas, ataques e feitiços aparecem junto do mago e são renovados no seu turno.",
    action: "play",
    focus: "hand",
    card: "023",
  },
  {
    id: "ability",
    title: "Use uma habilidade",
    body: "Clique no Guerreiro e use Modo Ofensivo. A habilidade custa 2 de mana e dá +2 ao ataque básico por 2 rodadas.",
    hint: "Habilidade é uma ação da carta em campo. Passiva funciona automaticamente quando a condição descrita acontece. Status podem bloquear ataques ou habilidades.",
    action: "ability",
    focus: "warrior",
  },
  {
    id: "attack",
    title: "Escolha quem atacar",
    body: "Clique no Guerreiro, escolha Atacar e clique na tropa inimiga. Ele tem alcance Universal: alcança a frente e as diagonais.",
    hint: "O ataque básico normalmente não custa mana, mas consome um uso. Alcance e status podem impedir um alvo. O mago inimigo só fica exposto quando suas tropas forem eliminadas.",
    action: "attack",
    focus: "warrior",
  },
  {
    id: "spell",
    title: "Feitiços e efeitos",
    body: "Escolha Lâmina de Vento da sua mão e use na tropa inimiga ferida. Ela causa 3 de dano e aplica Sangramento.",
    hint: "O feitiço gasta mana e vai ao cemitério. Sangramento causa dano por ciclo. Ao ver um ícone de efeito, abra a carta para ler a duração. Elementos também podem gerar reações, fraquezas e resistências.",
    action: "play",
    focus: "hand",
    card: "057",
  },
  {
    id: "effectFirstHalf",
    title: "O efeito não acaba ao passar",
    body: "A tropa inimiga ficou com 1 PV e Sangramento. Passe o turno: o primeiro dano do efeito ainda vai esperar o ciclo completo.",
    hint: "Efeitos de 1 rodada continuam quando você passa; terminam depois que o adversário também passa. Sangramento dura mais ciclos e aparece no ícone da tropa.",
    button: "Passar turno",
    action: "endTurn",
    focus: "effect",
  },
  {
    id: "effectSecondHalf",
    title: "Falta a outra metade do ciclo",
    body: "Veja: a tropa continua com Sangramento. Agora o adversário vai passar; o efeito causará dano e eliminará essa tropa.",
    hint: "Queimação e Veneno também causam dano periódico. Cada efeito tem sua própria duração e intensidade na descrição.",
    button: "Acompanhar o fim do ciclo",
    action: "continue",
    focus: "effect",
  },
  {
    id: "graveyard",
    title: "O cemitério guarda as cartas usadas",
    body: "O Sangramento eliminou a tropa. Clique no cemitério do adversário para conferir a carta que saiu do campo.",
    hint: "Tropas derrotadas e feitiços usados normalmente vão ao cemitério. Algumas cartas podem recuperá-los; cartas banidas ficam em uma zona separada.",
    action: "inspectGraveyard",
    focus: "graveyard",
  },
  {
    id: "finish",
    title: "Ataque o mago para vencer",
    body: "Sem tropas inimigas em campo, o mago de treino ficou exposto. Ataque-o com o Guerreiro para tirar seus últimos 5 PV.",
    hint: "Antes de passar um turno real, confira se ainda há ataques disponíveis. Você pode abrir qualquer carta para reler suas regras.",
    action: "attack",
    focus: "warrior",
  },
  {
    id: "complete",
    title: "Você já sabe começar!",
    body: "Você preparou o campo, usou mana, habilidade, ataque e feitiço, acompanhou um efeito e venceu a partida de treino.",
    hint: "Próximo passo: monte seu baralho com 1 mago e 40 cartas, até 3 cópias de cada carta. Depois, procure uma partida. O treino pode ser refeito pelo menu Tutorial.",
    action: "complete",
    focus: "complete",
  },
] as const;
export type TutorialGame = ReturnType<Game["exportState"]>;
export interface TutorialProgress {
  _id: string;
  version: number;
  step: number;
  courseVersion: number;
  game: TutorialGame | null;
  lastActionId?: string;
  completedAt?: Date;
  skippedAt?: Date;
}
export interface TutorialInput {
  actionId: string;
  version: number;
  type: string;
  cardId?: string;
  slotId?: string;
  targetId?: string;
  abilityId?: string;
  targets?: string[];
  face?: "heads" | "tails";
}
const catalog = initial.map((c) => cardSchema.parse(c));
const coachId = "tutorial-coach";
function makeCard(ref: string, ownerId: string): Instance {
  const c = structuredClone(catalog.find((c) => c.numeroCatalogo === ref)!);
  return {
    ...c,
    id: randomUUID(),
    ownerId,
    hpAtual: c.hp ?? 0,
    attacked: false,
    usedAbility: false,
    statuses: [],
  };
}
export function createTutorial(userId: string, nome: string): TutorialProgress {
  const cards = catalog
    .filter((c) => c.publicado && c.tipo === "Tropa")
    .flatMap((c) => Array(3).fill(c.numeroCatalogo))
    .slice(0, 40);
  const g = new Game(
    randomUUID(),
    [
      {
        id: userId,
        nome,
        deck: { nome: "Primeira partida", mago: "016", cartas: cards },
      },
      {
        id: coachId,
        nome: "Guia de Zacornia",
        deck: { nome: "Treino", mago: "016", cartas: cards },
      },
    ],
    catalog,
    () => 0.2,
  );
  g.state.current = userId;
  for (const p of g.state.players) {
    p.hand = [];
    p.deck = ["021", "001", "022", "021", "020"].map((id) =>
      makeCard(id, p.id),
    );
    p.preparation = { ready: false, redraws: 0, started: true, bonusDraws: 0 };
  }
  g.player(userId).hand = ["020", "023", "057"].map((id) =>
    makeCard(id, userId),
  );
  g.player(coachId).mage.hpAtual = 5;
  g.state.slots.find(
    (s) => s.ownerId === coachId && s.kind === "Tropa" && s.column === 1,
  )!.card = makeCard("020", coachId);
  return {
    _id: userId,
    version: 0,
    step: 0,
    courseVersion: tutorialVersion,
    game: g.exportState(),
  };
}
export function tutorialExpected(progress: TutorialProgress) {
  if (!progress.game) return {};
  const g = Game.restore(progress.game),
    uid = progress._id,
    lesson = tutorialLessons[progress.step];
  const troop = (ref: string, owner = uid) =>
    g.state.slots.find(
      (s) => s.ownerId === owner && s.card?.numeroCatalogo === ref,
    );
  const card =
    "card" in lesson
      ? g.player(uid).hand.find((c) => c.numeroCatalogo === lesson.card)
      : undefined;
  const target = troop("020", coachId);
  const destinations = g.state.slots
    .filter(
      (s) =>
        s.ownerId === uid &&
        s.kind === "Tropa" &&
        !s.card &&
        !s.terrain &&
        (lesson.id !== "mobilize" ||
          !target ||
          Math.abs(target.column - (2 - s.column)) <= 1),
    )
    .map((s) => s.id);
  return {
    destinations,
    cardId:
      lesson.id === "hand"
        ? g.player(uid).hand.find((c) => c.numeroCatalogo === "020")?.id
        : card?.id,
    sourceSlotId: troop("023")?.id,
    targetSlotId:
      lesson.id === "finish"
        ? g.state.slots.find((s) => s.ownerId === coachId && s.kind === "Mago")
            ?.id
        : troop("020", coachId)?.id,
    abilityId: "modoOfensivo",
    coachId,
  };
}
export function advanceTutorial(
  progress: TutorialProgress,
  input: TutorialInput,
): TutorialProgress {
  if (input.type === "skip")
    return {
      ...progress,
      step: tutorialLessons.length - 1,
      version: progress.version + 1,
      lastActionId: input.actionId,
      game: null,
      completedAt: new Date(),
      skippedAt: new Date(),
    };
  const current = tutorialLessons[progress.step];
  if (!current || current.id === "complete" || !progress.game)
    throw new AppError(409, "Este treino já terminou.");
  if (input.type !== current.action)
    throw new AppError(422, "Siga a ação destacada para aprender esta etapa.");
  const expected = tutorialExpected(progress),
    uid = progress._id;
  const g = Game.restore(progress.game, () =>
    input.face === "tails" ? 0.8 : 0.2,
  );
  const execute = (user: string, command: object) =>
    g.execute(user, {
      ...command,
      actionId: randomUUID(),
      version: g.state.version,
    });
  if (input.type === "inspect" && input.cardId !== expected.cardId)
    throw new AppError(422, "Abra o Assassino da sua mão.");
  if (input.type === "play") {
    if (input.cardId !== expected.cardId)
      throw new AppError(422, "Escolha a carta destacada para esta etapa.");
    if (current.id === "spell") {
      const target = g.state.slots.find(
        (s) => s.id === expected.targetSlotId,
      )?.card;
      if (input.targets?.length !== 1 || input.targets[0] !== target?.id)
        throw new AppError(422, "Escolha a tropa inimiga ferida.");
      execute(uid, {
        type: "play",
        cardId: input.cardId,
        targets: input.targets,
      });
    } else {
      if (!expected.destinations?.includes(input.slotId!))
        throw new AppError(
          422,
          "Escolha um espaço destacado que alcance o inimigo.",
        );
      execute(uid, {
        type: "play",
        cardId: input.cardId,
        slotId: input.slotId,
        targets: [],
      });
    }
  }
  if (input.type === "endTurn") {
    execute(uid, { type: "endTurn" });
    if (current.id === "ready") {
      const hero = g.state.slots.find(
          (s) => s.ownerId === uid && s.card?.numeroCatalogo === "020",
        )!,
        from = g.state.slots.find(
          (s) => s.ownerId === coachId && s.card?.tipo === "Tropa",
        )!,
        to = g.state.slots.find(
          (s) =>
            s.ownerId === coachId &&
            s.kind === "Tropa" &&
            s.column === 2 - hero.column,
        )!;
      if (from.id !== to.id)
        execute(coachId, {
          type: "move",
          slotId: from.id,
          destinationId: to.id,
        });
      execute(coachId, { type: "endTurn" });
      g.state.coinToss!.chooserId = uid;
    }
  }
  if (input.type === "chooseCoin")
    execute(uid, { type: "chooseCoin", face: input.face });
  if (input.type === "ability") {
    if (
      input.slotId !== expected.sourceSlotId ||
      input.abilityId !== expected.abilityId
    )
      throw new AppError(422, "Use Modo Ofensivo do Guerreiro.");
    execute(uid, {
      type: "ability",
      slotId: input.slotId,
      abilityId: input.abilityId,
      targets: [],
    });
  }
  if (input.type === "attack") {
    if (
      input.slotId !== expected.sourceSlotId ||
      input.targetId !== expected.targetSlotId
    )
      throw new AppError(422, "Ataque o alvo destacado com o Guerreiro.");
    execute(uid, {
      type: "attack",
      slotId: input.slotId,
      targetId: input.targetId,
    });
  }
  if (current.id === "coinResult") g.timeout();
  if (current.id === "opponentOpening") {
    const attacker = g.state.slots.find(
        (s) => s.ownerId === coachId && s.card?.tipo === "Tropa",
      )!,
      target = g.state.slots.find(
        (s) => s.ownerId === uid && s.card?.tipo === "Tropa",
      )!;
    execute(coachId, {
      type: "attack",
      slotId: attacker.id,
      targetId: target.id,
    });
    execute(coachId, { type: "endTurn" });
  }
  if (current.id === "effectSecondHalf") execute(coachId, { type: "endTurn" });
  const step = progress.step + 1,
    done = step === tutorialLessons.length - 1;
  if (done && (g.state.status !== "FINISHED" || g.state.winner !== uid))
    throw new AppError(
      409,
      "O treino precisa terminar com a vitória do jogador.",
    );
  return {
    ...progress,
    step,
    version: progress.version + 1,
    lastActionId: input.actionId,
    game: done ? null : g.exportState(),
    ...(done ? { completedAt: new Date() } : {}),
  };
}
export function tutorialView(progress: TutorialProgress) {
  return {
    version: progress.version,
    step: progress.step,
    total: tutorialLessons.length - 1,
    lesson: progress.skippedAt
      ? {
          ...tutorialLessons.at(-1)!,
          title: "Treino disponível quando quiser",
          body: "Você pulou o tutorial. Pode começar a jogar e voltar a este treino pelo menu Tutorial.",
          hint: "Se precisar de ajuda, confira as regras das cartas e o guia de turnos abaixo.",
        }
      : tutorialLessons[progress.step],
    skipped: !!progress.skippedAt,
    expected: tutorialExpected(progress),
    completed: !!progress.completedAt,
    match: progress.game
      ? Game.restore(progress.game).snapshot(progress._id)
      : null,
  };
}
