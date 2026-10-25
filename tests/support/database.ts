// Banco isolado para testes. Nunca é importado pelo servidor de produção.
import { mock } from "node:test";
import { Types } from "mongoose";
import User from "../../src/db/models/user";
import Deck from "../../src/db/models/decks";
import CardModel from "../../src/db/models/Card";
import Match from "../../src/db/models/match";
import { AdminControl, AdminAudit } from "../../src/db/models/admin";
import { Friendship, Invitation } from "../../src/db/models/social";
import { Card, cardSchema } from "../../src/types/card";
import initial from "../../src/data/catalog.json";
import bcrypt from "bcrypt";
import { playerNameKey } from "../../src/services/player-name";
import { socialModels } from "../../src/game/social";
import Avatar from "../../src/db/models/avatar";
import { invalidateCatalog } from "../../src/services/catalog";
import { invalidateRankings } from "../../src/services/ranking-cache";
import Lore from "../../src/db/models/lore";
import { invalidateLore } from "../../src/services/lore";
export async function fakeDatabase() {
  invalidateRankings();
  invalidateCatalog();
  invalidateLore();
  const users: any[] = [],
    decks: any[] = [],
    cards: any[] = [],
    matches: any[] = [],
    friendships: any[] = [],
    invitations: any[] = [],
    lores: any[] = [],
    adminControls: any[] = [],
    adminAudits: any[] = [];
  function equal(a: unknown, b: unknown) {
    return String(a) === String(b);
  }
  function find(rows: any[], filter: any) {
    function matches(row: any, condition: any): boolean {
      return Object.entries(condition ?? {}).every(
        ([key, value]: [string, any]) => {
          if (key === "$or") return value.some((c: any) => matches(row, c));
          if (key === "players.userId")
            return row.players?.some((p: any) =>
              value?.$in
                ? value.$in.some((id: any) => equal(p.userId, id))
                : equal(p.userId, value),
            );
          const actual = key
            .split(".")
            .reduce((v: any, k: string) => v?.[k], row);
          if (
            value &&
            typeof value === "object" &&
            !(value instanceof Date) &&
            Object.keys(value).some((k) => k.startsWith("$"))
          )
            return Object.entries(value).every(([op, v]: [string, any]) => {
              if (op === "$exists") return (actual !== undefined) === v;
              if (op === "$in")
                return v.some((item: any) => equal(actual, item));
              if (op === "$ne") return !equal(actual, v);
              if (op === "$gt") return actual > v;
              if (op === "$gte") return actual >= v;
              if (op === "$elemMatch")
                return actual?.some((entry: any) => matches(entry, v));
              if (op === "$lte") return actual <= v;
              if (op === "$lt") return actual < v;
              if (op === "$regex")
                return new RegExp(v, value.$options).test(actual);
              return op === "$options";
            });
          return Array.isArray(actual)
            ? actual.some((v) => equal(v, value))
            : equal(actual, value);
        },
      );
    }
    return rows.filter((row) => matches(row, filter));
  }
  function document(row: any) {
    return row && { ...row, toObject: () => structuredClone(row) };
  }
  function query(result: any) {
    let value = result;
    const q: any = {
      then: (resolve: any, reject: any) =>
        Promise.resolve(value).then(resolve, reject),
      select: () => q,
      lean: () => q,
      option: () => q,
      sort: (sort: any) => {
        if (Array.isArray(value))
          value = [...value].sort((a, b) => {
            for (const [key, direction] of Object.entries(sort)) {
              const av = key
                  .split(".")
                  .reduce((v: any, k: string) => v?.[k], a),
                bv = key.split(".").reduce((v: any, k: string) => v?.[k], b);
              if (av < bv) return -Number(direction);
              if (av > bv) return Number(direction);
            }
            return 0;
          });
        return q;
      },
      skip: (n: number) => {
        if (Array.isArray(value)) value = value.slice(n);
        return q;
      },
      limit: (n: number) => {
        if (Array.isArray(value)) value = value.slice(0, n);
        return q;
      },
    };
    return q;
  }
  function patch(object: any, key: string, fn: (...args: any[]) => any) {
    mock.method(object, key, fn);
  }
  patch(User, "findById", (id) => query(document(find(users, { _id: id })[0])));
  patch(User, "findOne", (filter) => query(document(find(users, filter)[0])));
  patch(User, "exists", (filter) =>
    Promise.resolve(
      find(users, filter)[0] ? { _id: find(users, filter)[0]._id } : null,
    ),
  );
  patch(User, "find", (filter = {}) =>
    query(find(users, filter).map(document)),
  );
  function update(row: any, change: any) {
    if (
      change.$set?.nomeKey &&
      users.some((u) => u._id !== row._id && u.nomeKey === change.$set.nomeKey)
    )
      throw Object.assign(new Error("duplicate"), {
        code: 11000,
        keyPattern: { nomeKey: 1 },
      });
    Object.assign(row, change.$set);
    for (const [k, v] of Object.entries(change.$inc ?? {}))
      row[k] = (row[k] ?? 0) + Number(v);
    for (const k of Object.keys(change.$unset ?? {})) delete row[k];
    for (const [k, v] of Object.entries(change.$max ?? {}))
      if (row[k] === undefined || row[k] < (v as any)) row[k] = v;
  }
  for (const [model, rows] of [
    [User, users],
    [Deck, decks],
    [Avatar, []],
    [Lore, lores],
    [AdminControl, adminControls],
    [AdminAudit, adminAudits],
    [Friendship, friendships],
    [Invitation, invitations],
    ...Object.values(socialModels).map((model) => [model, []] as [any, any[]]),
  ] as [any, any[]][]) {
    if (
      model === Avatar ||
      model === AdminControl ||
      model === AdminAudit ||
      Object.values(socialModels).includes(model)
    )
      patch(model, "findById", (id) =>
        query(document(find(rows, { _id: id })[0])),
      );
    patch(model, "countDocuments", (filter: any) =>
      query(find(rows, filter).length),
    );
    patch(model, "updateOne", (filter, change, opts = {}) => {
      let row = find(rows, filter)[0];
      if (!row && opts.upsert) {
        if (filter._id && rows.some((r) => r._id === filter._id))
          throw Object.assign(new Error("duplicate"), { code: 11000 });
        row = { _id: filter._id, ...change.$setOnInsert };
        rows.push(row);
      }
      if (row) update(row, change);
      return query({ matchedCount: row ? 1 : 0 });
    });
    patch(model, "findOneAndUpdate", (filter, change, opts = {}) => {
      let row = find(rows, filter)[0];
      const before = row ? structuredClone(row) : null;
      if (!row && opts.upsert) {
        if (filter._id && rows.some((r) => r._id === filter._id))
          throw Object.assign(new Error("duplicate"), { code: 11000 });
        row = { ...filter, ...change.$setOnInsert };
        rows.push(row);
      }
      if (row) update(row, change);
      return query(document(opts.new ? row : before));
    });
    if (model !== User) {
      patch(model, "find", (filter = {}) =>
        query(find(rows, filter).map(document)),
      );
      patch(model, "findOne", (filter) =>
        query(document(find(rows, filter)[0])),
      );
      patch(model, "exists", (filter) => query(find(rows, filter)[0] ?? null));
      patch(model, "create", (data) => {
        if (model === Lore && rows.some((r) => r.slug === data.slug))
          throw Object.assign(new Error("duplicate"), { code: 11000 });
        if (data._id && rows.some((r) => r._id === data._id))
          throw Object.assign(new Error("duplicate"), { code: 11000 });
        const row = { status: "pending", ...data };
        rows.push(row);
        return query(document(row));
      });
      patch(model, "deleteOne", (filter) => {
        const row = find(rows, filter)[0];
        if (row) rows.splice(rows.indexOf(row), 1);
        return query({ deletedCount: row ? 1 : 0 });
      });
    }
  }
  patch(User, "create", (data) => {
    if (users.some((u) => u.email === data.email))
      throw Object.assign(new Error("duplicate"), { code: 11000 });
    if (data.nomeKey && users.some((u) => u.nomeKey === data.nomeKey))
      throw Object.assign(new Error("duplicate"), {
        code: 11000,
        keyPattern: { nomeKey: 1 },
      });
    const row = {
      _id: new Types.ObjectId().toHexString(),
      avatarURL: "/assets/avatar.png",
      nivel: 1,
      vitorias: 0,
      partidas: 0,
      admin: false,
      ...data,
    };
    users.push(row);
    return Promise.resolve(document(row));
  });
  patch(User, "findByIdAndUpdate", (id, update) => {
    const row = find(users, { _id: id })[0];
    if (row) {
      if (
        update.$set.nomeKey &&
        users.some(
          (u) => u._id !== row._id && u.nomeKey === update.$set.nomeKey,
        )
      )
        throw Object.assign(new Error("duplicate"), {
          code: 11000,
          keyPattern: { nomeKey: 1 },
        });
      Object.assign(row, update.$set);
    }
    return query(document(row));
  });
  patch(Deck, "create", (data) => {
    const row = {
      _id: new Types.ObjectId().toHexString(),
      icone: "/assets/icons/neutro.svg",
      revisao: 0,
      ...data,
    };
    decks.push(row);
    return Promise.resolve(document(row));
  });
  patch(Deck.collection, "find", (filter) => ({
    toArray: async () => find(decks, filter).map((row) => structuredClone(row)),
  }));
  patch(Deck.collection, "findOne", (filter) =>
    Promise.resolve(find(decks, filter)[0] ?? null),
  );
  patch(Deck, "exists", (filter) =>
    Promise.resolve(
      find(decks, filter)[0] ? { _id: find(decks, filter)[0]._id } : null,
    ),
  );
  patch(Deck, "findOneAndUpdate", (filter, update) => {
    const row = find(decks, filter)[0];
    if (row) {
      Object.assign(row, update.$set);
      row.revisao = (row.revisao ?? 0) + update.$inc.revisao;
    }
    return query(document(row));
  });
  patch(Deck, "findOneAndDelete", (filter) => {
    const row = find(decks, filter)[0];
    if (row) decks.splice(decks.indexOf(row), 1);
    return query(document(row));
  });
  patch(CardModel, "find", () => query(cards));
  patch(CardModel, "findOne", (filter) =>
    query(document(find(cards, filter)[0])),
  );
  patch(CardModel, "create", (card) => {
    cards.push(structuredClone(card));
    return query(document(card));
  });
  patch(CardModel, "findOneAndUpdate", (filter, update) => {
    const row = find(cards, filter)[0];
    if (row) Object.assign(row, update.$set);
    return query(document(row));
  });
  patch(Match, "updateOne", (filter, change, options = {}) => {
    let row = find(matches, filter)[0];
    if (!row && options.upsert) {
      row = structuredClone(change.$setOnInsert);
      matches.push(row);
    }
    if (row) update(row, change);
    return Promise.resolve({ acknowledged: true, matchedCount: row ? 1 : 0 });
  });
  patch(Match, "updateMany", (filter, change) => {
    const rows = find(matches, filter);
    rows.forEach((row) => update(row, change));
    return Promise.resolve({
      matchedCount: rows.length,
      modifiedCount: rows.length,
    });
  });
  patch(Match, "countDocuments", (filter) =>
    query(find(matches, filter).length),
  );
  patch(Match, "find", (filter) => query(find(matches, filter)));
  // Monthly leaderboard fixture. The actual Mongo aggregation is also exercised in mongo.integration.
  patch(Match, "aggregate", (pipeline) => {
    const records = find(matches, pipeline[0].$match);
    const ranked = decks
      .filter((d) => d.publico && users.some((u) => equal(u._id, d.userId)))
      .map((d) => {
        const games = records.filter((m) =>
          m.players.some(
            (p: any) => equal(p.userId, d.userId) && equal(p.deckId, d._id),
          ),
        );
        const wins = games.filter((m) => equal(m.winner, d.userId)).length;
        return {
          ...d,
          ownerName: users.find((u) => equal(u._id, d.userId))?.nome,
          ranking: {
            partidas: games.length,
            vitorias: wins,
            rate: wins / games.length,
          },
        };
      })
      .filter((d) => d.ranking.partidas >= 10)
      .sort(
        (a, b) =>
          b.ranking.rate - a.ranking.rate ||
          b.ranking.vitorias - a.ranking.vitorias ||
          Number(a.createdAt) - Number(b.createdAt) ||
          String(a._id).localeCompare(String(b._id)),
      );
    const skip = pipeline.at(-1).$facet.rows[0].$skip;
    return query([
      {
        podium: ranked.slice(0, 3),
        rows: ranked.slice(skip, skip + 20),
        count: [{ total: ranked.length }],
      },
    ]);
  });
  const catalog: Card[] = (initial as unknown[]).map((c) =>
    cardSchema.parse(c),
  );
  const refs: string[] = [];
  for (const c of catalog.filter((c) => c.publicado && c.tipo === "Tropa"))
    for (let i = 0; i < 3 && refs.length < 40; i++) refs.push(c.numeroCatalogo);
  const senha = await bcrypt.hash("teste-ztcg-123", 4);
  for (let i = 1; i <= 3; i++) {
    const id = String(i).repeat(24);
    users.push({
      _id: id,
      nome: `Duelista ${i}`,
      nomeKey: playerNameKey(`Duelista ${i}`),
      email: `p${i}@test.local`,
      senha,
      admin: i === 3,
      avatarURL: "/assets/avatar.png",
      nivel: 1,
      vitorias: 0,
      partidas: 0,
    });
    decks.push({
      _id: String(i + 3).repeat(24),
      userId: id,
      nome: `Baralho ${i}`,
      cartas: [...refs],
      mago: "108",
      icone: "/assets/icons/neutro.svg",
      revisao: 0,
    });
  }
  return {
    users,
    decks,
    cards,
    matches,
    friendships,
    invitations,
    catalog,
    lores,
    adminControls,
    adminAudits,
    restore: () => {
      invalidateCatalog();
      invalidateRankings();
      invalidateLore();
      mock.restoreAll();
    },
  };
}
