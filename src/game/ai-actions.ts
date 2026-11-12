import { Game } from "./engine";
import type { Card, Effect } from "../types/card";
import type { Instance } from "./state";
import { slotCards } from "./state";
import { entryCost, materialOptions } from "./entry-cost";
import { circleWaiver } from "./deployment";
import { chooseAction } from "./action-options";
export type AiCommand = Record<string, unknown>;
interface Action {
  alvo?: Card["alvo"];
  efeitos?: Effect[];
  maxAlvos?: number;
  tiposAlvo?: Card["tiposAlvo"];
  alvoAutomatico?: string;
  apenasFrontal?: boolean;
  sourceColumn?: number;
  filtroAlvo?: { numeroCatalogo?: string; tipo?: string; elemento?: string };
  opcoes?: Card["opcoes"];
}
function combinations(ids: string[], count: number, cap = 12): string[][] {
  const out: string[][] = [];
  const walk = (at: number, picked: string[]) => {
    if (picked.length) out.push([...picked]);
    if (picked.length === count || out.length >= cap) return;
    for (let n = at; n < ids.length && out.length < cap; n++)
      walk(n + 1, [...picked, ids[n]]);
  };
  walk(0, []);
  return out;
}
export function aiCandidates(game: Game, bot: string): AiCommand[] {
  const view = game.snapshot(bot),
    player = game.player(bot),
    own = game.state.slots.filter((s) => s.ownerId === bot);
  const groups: AiCommand[][] = [[], [], [], [], [], []];
  const matches = (c: Instance, a: Action) =>
    !a.filtroAlvo ||
    ((!a.filtroAlvo.numeroCatalogo ||
      c.numeroCatalogo === a.filtroAlvo.numeroCatalogo) &&
      (!a.filtroAlvo.tipo || c.tipo === a.filtroAlvo.tipo) &&
      (!a.filtroAlvo.elemento || c.elemento === a.filtroAlvo.elemento));
  const targets = (a: Action): string[][] => {
    if (
      a.alvoAutomatico ||
      !a.alvo ||
      [
        "Global",
        "TodosInimigos",
        "TodasTropasInimigas",
        "TodosAliados",
      ].includes(a.alvo)
    )
      return [[]];
    if (["CampoAliado", "CampoInimigo"].includes(a.alvo))
      return view.slots
        .filter(
          (s) =>
            s.kind === "Tropa" &&
            (a.alvo === "CampoAliado" ? s.ownerId === bot : s.ownerId !== bot),
        )
        .map((s) => [s.id]);
    let cards: Instance[] = [];
    if (["Deck", "Reserva", "Cemiterio", "Mao"].includes(a.alvo)) {
      cards =
        a.alvo === "Cemiterio"
          ? player.graveyard
          : a.alvo === "Mao"
            ? player.hand
            : a.alvo === "Reserva"
              ? [...player.deck, ...player.graveyard]
              : player.deck;
    } else if (a.alvo === "DeckOponente") return [[]];
    else
      cards = view.slots
        .filter((s) =>
          a.alvo === "UnicoAliado" ? s.ownerId === bot : s.ownerId !== bot,
        )
        .flatMap((s) => [s.card, s.rider, s.structure])
        .filter(
          (c): c is NonNullable<typeof c> =>
            !!c &&
            !("oculta" in c && c.oculta) &&
            ["Tropa", "Mago", "Estrutura"].includes(c.tipo!),
        );
    cards = cards.filter(
      (c) =>
        (!a.apenasFrontal ||
          game.state.slots.some(
            (s) =>
              s.ownerId !== bot &&
              s.kind === "Tropa" &&
              s.column === 2 - a.sourceColumn! &&
              [s.card?.id, s.rider?.id].includes(c.id),
          )) &&
        matches(c, a) &&
        (!a.tiposAlvo || a.tiposAlvo.includes(c.tipo)),
    );
    // Card searches may use their own deck; enemy hidden zones are never inspected.
    const unique = [...new Map(cards.map((c) => [c.id, c])).values()].sort(
      (a, b) =>
        Number(b.tipo === "Mago") - Number(a.tipo === "Mago") ||
        (b.ataque ?? 0) - (a.ataque ?? 0),
    );
    const max = Math.min(3, a.maxAlvos ?? 1);
    return combinations(
      unique.slice(0, 12).map((c) => c.id),
      max,
    );
  };
  const expand = (base: AiCommand, raw: Action, group: number) => {
    for (const mode of raw.opcoes?.map((o) => o.id) ?? [undefined]) {
      const action = chooseAction(raw as any, mode) as Action;
      for (const ids of targets(action)) {
        const effects = action.efeitos ?? [];
        const destEffect = effects.some(
          (e) =>
            ["revive", "control", "relocate"].includes(e.id) ||
            (e.id === "displace" && e.direcao === "vizinho"),
        );
        const destinations = destEffect
          ? view.slots
              .filter(
                (s) =>
                  s.kind === "Tropa" &&
                  (effects.some((e) => e.id === "displace")
                    ? s.ownerId !== bot
                    : s.ownerId === bot),
              )
              .map((s) => s.id)
          : [];
        for (const destinationId of [undefined, ...destinations])
          groups[group].push({
            ...base,
            ...(mode ? { mode } : {}),
            targets: ids,
            ...(destinationId ? { destinationId } : {}),
          });
      }
    }
  };
  for (const card of player.hand) {
    if (card.tipo === "Feitico") {
      if (game.state.phase === "BATTLE")
        expand({ type: "play", cardId: card.id }, card, 1);
      continue;
    }
    if (card.tipo === "Mago") continue;
    const slots =
      card.tipo === "Armamento"
        ? view.slots.filter((s) => view.equipmentTargets.includes(s.id))
        : own.filter((s) =>
            card.tipo === "Estrutura"
              ? s.kind === "Tropa" && s.card?.tipo === "Tropa" && !s.structure
              : s.kind === "Tropa" &&
                !s.terrain &&
                (!s.card || (!!s.card.montaria && !s.rider)),
          );
    for (const slot of slots) {
      const cost = entryCost(card);
      let materials: (string[] | undefined)[] = [undefined];
      if (cost && !circleWaiver(slot as any, card)) {
        const options = materialOptions(game.state, bot, card).sort(
          (a, b) =>
            (a.origem === "campo" ? 20 + a.card.hpAtual : a.card.custoMana) -
            (b.origem === "campo" ? 20 + b.card.hpAtual : b.card.custoMana),
        );
        materials = combinations(
          options.map((o) => o.card.id),
          cost.quantidade,
          40,
        )
          .filter((p) => p.length === cost.quantidade)
          .slice(0, 3);
      }
      for (const materiais of materials)
        for (const mode of card.modosEquipamento?.map((m) => m.id) ?? [
          undefined,
        ])
          groups[card.tipo === "Tropa" ? 3 : 4].push({
            ...(mode ? { mode } : {}),
            type: "play",
            cardId: card.id,
            slotId: slot.id,
            ...(materiais ? { materiais } : {}),
          });
    }
  }
  if (game.state.phase === "BATTLE") {
    for (const slot of own) {
      const visible = view.slots.find((s) => s.id === slot.id)!;
      for (const source of ["card", "rider", "structure"] as const) {
        const card = slot[source];
        if (!card) continue;
        for (const targetId of visible.attackTargets?.[source] ?? [])
          if (view.slots.some((s) => s.id === targetId && s.card))
            groups[0].push({
              type: "attack",
              slotId: slot.id,
              targetId,
              source,
            });
        for (const targetId of visible.attackStructureTargets?.[source] ?? [])
          groups[0].push({
            type: "attack",
            slotId: slot.id,
            targetId,
            source,
            targetSource: "structure",
          });
        if (
          source === "structure" &&
          card.estrutura?.carga &&
          !card.usedAbility &&
          player.mana >= card.estrutura.carga.minimoMana
        ) {
          for (const mana of new Set([
            card.estrutura.carga.minimoMana,
            player.mana,
          ]))
            groups[2].push({ type: "chargeStructure", slotId: slot.id, mana });
        }
        for (const ability of card.habilidadesAtivas) {
          if (visible.abilityBlockReasons?.[source]?.[ability.id]) continue;
          expand(
            { type: "ability", slotId: slot.id, source, abilityId: ability.id },
            { ...ability, sourceColumn: slot.column },
            2,
          );
        }
      }
      if (slot.card?.tipo === "Tropa") {
        for (const destination of own.filter(
          (s) => s.kind === "Tropa" && s.id !== slot.id && !s.terrain,
        ))
          groups[5].push({
            type: "move",
            slotId: slot.id,
            destinationId: destination.id,
          });
        for (const destinationId of visible.mountTargets ?? [])
          groups[5].push({ type: "mount", slotId: slot.id, destinationId });
        if (visible.canDismount)
          groups[5].push({ type: "dismount", slotId: slot.id });
      }
    }
    for (const card of player.hand)
      if (
        card.habilidadesPassivas.some(
          (p) =>
            "efeitos" in p && p.efeitos.some((e) => e.id === "discardMana"),
        )
      )
        groups[5].push({ type: "discardHand", cardId: card.id });
  }
  // Round robin prevents a large hand from crowding attacks/equipment out of the budget.
  const result: AiCommand[] = [];
  for (
    let index = 0;
    result.length < 150 && groups.some((g) => index < g.length);
    index++
  )
    for (const group of groups)
      if (group[index] && result.length < 150) result.push(group[index]);
  return result;
}
