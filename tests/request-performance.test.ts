import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import jwt from "jsonwebtoken";
import { JSDOM } from "jsdom";
import User from "../src/db/models/user";
import { checkToken } from "../src/middlewares/checkToken";

test("leituras sociais simultâneas compartilham rede, sem cache de resultado, escrita ou conta", async () => {
  const dom = new JSDOM("", { url: "https://example.test" });
  let calls = 0;
  const waiting: Array<(value: unknown) => void> = [];
  const source = (await readFile("public/JS/auth.js", "utf8"))
    .replace(/^import.*;\s*/gm, "")
    .replace(/^export /gm, "");
  const api = new Function(
    "sessionStorage",
    "localStorage",
    "fetch",
    `${source}\nreturn api;`,
  )(dom.window.sessionStorage, dom.window.localStorage, () => {
    calls++;
    return new Promise((resolve) => waiting.push(resolve));
  });
  const resolve = () => {
    while (waiting.length)
      waiting.shift()!({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });
  };
  try {
    dom.window.sessionStorage.setItem("token", "account-a");
    const first = api("/friends"),
      second = api("/friends");
    assert.equal(calls, 1);
    resolve();
    await Promise.all([first, second]);
    const next = api("/friends");
    assert.equal(calls, 2, "a completed result is never cached");
    const fresh = api("/friends", { cache: "reload" });
    assert.equal(calls, 3, "refresh after a mutation bypasses a pending read");
    dom.window.sessionStorage.setItem("token", "account-b");
    const other = api("/friends");
    assert.equal(calls, 4, "sessions cannot share a response");
    const writes = [
      api("/friends/requests", { method: "POST" }),
      api("/friends/requests", { method: "POST" }),
    ];
    assert.equal(calls, 6);
    resolve();
    await Promise.all([next, fresh, other, ...writes]);
  } finally {
    resolve();
    dom.window.close();
  }
});

test("falha do banco não revoga sessão nem dispara renovação, e sessões inválidas continuam bloqueadas", async () => {
  process.env.SECRET = "secret-only-for-tests-01234567890123456789";
  const original = User.findById;
  let account: any = { sessionVersion: 2 },
    broken = false,
    reads = 0;
  (User as any).findById = () => {
    reads++;
    return {
      select: () => ({
        lean: async () => {
          if (broken) throw Error("database timeout");
          return account;
        },
      }),
    };
  };
  const valid = jwt.sign({ id: "1".repeat(24), sv: 2 }, process.env.SECRET!);
  const auth = async (token: string) => {
    let error: any;
    await checkToken(
      { headers: { authorization: `Bearer ${token}` } } as any,
      {} as any,
      (e) => {
        error = e;
      },
    );
    return error;
  };
  try {
    assert.equal(await auth(valid), undefined);
    broken = true;
    const failed = await auth(valid);
    assert.equal(failed.status, 503);
    assert.equal(failed.code, "DATABASE_UNAVAILABLE");
    broken = false;
    account = { sessionVersion: 3 };
    assert.equal((await auth(valid)).status, 401);
    account = null;
    assert.equal((await auth(valid)).status, 401);
    const before = reads;
    assert.equal((await auth("invalid-token")).status, 401);
    assert.equal(reads, before, "invalid signatures never reach the database");
  } finally {
    User.findById = original;
  }
});
