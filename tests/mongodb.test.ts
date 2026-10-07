import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import dbConnect from "../src/lib/mongodb";

test("banco compartilha tentativa em curso, reconecta após encerrar e tenta de novo após falha", async () => {
  const original = mongoose.connect;
  const descriptor = Object.getOwnPropertyDescriptor(
    mongoose.connection,
    "readyState",
  );
  let state = 0,
    attempts = 0;
  let complete!: (value: typeof mongoose) => void;
  let fail!: (error: Error) => void;
  Object.defineProperty(mongoose.connection, "readyState", {
    configurable: true,
    get: () => state,
  });
  mongoose.connect = (() => {
    attempts++;
    return new Promise<typeof mongoose>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
  }) as typeof mongoose.connect;
  try {
    const first = dbConnect(),
      concurrent = dbConnect();
    assert.equal(attempts, 1);
    state = 1;
    complete(mongoose);
    await Promise.all([first, concurrent]);
    await dbConnect();
    assert.equal(attempts, 1);
    state = 0;
    const reconnect = dbConnect();
    assert.equal(attempts, 2);
    fail(new Error("indisponível"));
    await assert.rejects(reconnect, /indisponível/);
    const retry = dbConnect();
    assert.equal(attempts, 3);
    state = 1;
    complete(mongoose);
    assert.equal(await retry, mongoose);
  } finally {
    mongoose.connect = original;
    if (descriptor)
      Object.defineProperty(mongoose.connection, "readyState", descriptor);
    else delete (mongoose.connection as any).readyState;
  }
});
