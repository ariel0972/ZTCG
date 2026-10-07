// Banco isolado para testes. Nunca é importado pelo servidor de produção.
import { mock } from "node:test";
import { Types } from "mongoose";
import User from "../../src/db/models/user";
import Deck from "../../src/db/models/decks";
import CardModel from "../../src/db/models/Card";
import Match from "../../src/db/models/match";
import { Friendship, Invitation } from "../../src/db/models/social";
import { Card, cardSchema } from "../../src/types/card";
import initial from "../../src/data/catalog.json";
import bcrypt from "bcrypt";
export async function fakeDatabase() {
  const users: any[] = [],
    decks: any[] = [],
    cards: any[] = [],
    matches: any[] = [],
    friendships: any[] = [],
    invitations: any[] = [];
  function equal(a: unknown, b: unknown) {
    return String(a) === String(b);
  }
  function find(rows: any[], filter: any) {
    function matches(row: any, condition: any): boolean {
      return Object.entries(condition ?? {}).every(
        ([key, value]: [string, any]) => {
          if (key === "$or") return value.some((c: any) => matches(row, c));
          if (key === "players.userId")
            return row.players?.some((p: any) => equal(p.userId, value));
          const actual = row[key];
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
      sort: (sort: any) => {
        if (Array.isArray(value))
          value = [...value].sort((a, b) => {
            for (const [key, direction] of Object.entries(sort)) {
              const av = a[key],
                bv = b[key];
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
    Object.assign(row, change.$set);
    for (const [k, v] of Object.entries(change.$inc ?? {}))
      row[k] = (row[k] ?? 0) + Number(v);
    for (const k of Object.keys(change.$unset ?? {})) delete row[k];
  }
  for (const [model, rows] of [
    [User, users],
    [Friendship, friendships],
    [Invitation, invitations],
  ] as [any, any[]][]) {
    patch(model, "updateOne", (filter, change) => {
      const row = find(rows, filter)[0];
      if (row) update(row, change);
      return query({ matchedCount: row ? 1 : 0 });
    });
    patch(model, "findOneAndUpdate", (filter, change, opts = {}) => {
      let row = find(rows, filter)[0];
      const before = row ? structuredClone(row) : null;
      if (!row && opts.upsert) {
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
    if (row) Object.assign(row, update.$set);
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
  patch(Match, "updateOne", (filter, update) => {
    if (!find(matches, filter).length)
      matches.push(structuredClone(update.$setOnInsert));
    return Promise.resolve({ acknowledged: true });
  });
  patch(Match, "countDocuments", (filter) =>
    query(find(matches, filter).length),
  );
  patch(Match, "find", (filter) => query(find(matches, filter)));
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
    restore: () => mock.restoreAll(),
  };
}
