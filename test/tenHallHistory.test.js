import assert from "node:assert/strict";
import test from "node:test";
import {
  readTenHallHistory,
  removeTenHallHistory,
  saveTenHallHistory,
  TEN_HALL_HISTORY_LIMIT,
} from "../src/utils/tenHallHistory.js";

function storageFixture() {
  const map = new Map();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

function entry(overrides = {}) {
  return {
    id: "batch-a",
    time: 1000,
    hall: 1,
    requestedCount: 10,
    status: "running",
    setup: {
      heroes: [{ slot: 0, heroId: 110 }],
      weaponId: 2,
      petId: 501,
      hasPet: true,
      petUId: "private-pet-uid",
    },
    results: [
      {
        isWin: true,
        rounds: 11,
        downCount: 0,
        heroes: [{ heroId: 110, slot: 0, isDown: false }],
        loadout: {
          heroes: "matched",
          weapon: { status: "matched", actualId: 2 },
          pet: { status: "matched", actualId: 501 },
        },
        loadoutSignature: "private-pet-uid",
        battleData: { token: "secret-token" },
      },
    ],
    ...overrides,
  };
}

test("stores only battle display data and separates different roles", () => {
  const storage = storageFixture();
  saveTenHallHistory(100, entry(), storage);
  saveTenHallHistory(200, entry({ id: "batch-b", hall: 2 }), storage);
  assert.equal(readTenHallHistory(100, storage)[0].hall, 1);
  assert.equal(readTenHallHistory(200, storage)[0].hall, 2);
  assert.equal(readTenHallHistory(300, storage).length, 0);
  const saved = [...storage.map.values()].join(" ");
  assert.doesNotMatch(
    saved,
    /private-pet-uid|secret-token|battleData|loadoutSignature/,
  );
});

test("updates partial batches in place and retains only recent records", () => {
  const storage = storageFixture();
  saveTenHallHistory(100, entry(), storage);
  saveTenHallHistory(
    100,
    entry({
      status: "completed",
      results: [entry().results[0], entry().results[0]],
    }),
    storage,
  );
  let list = readTenHallHistory(100, storage);
  assert.equal(list.length, 1);
  assert.equal(list[0].status, "completed");
  assert.equal(list[0].results.length, 2);
  for (let i = 0; i < 25; i++)
    saveTenHallHistory(
      100,
      entry({ id: `batch-${i}`, time: 1001 + i }),
      storage,
    );
  list = readTenHallHistory(100, storage);
  assert.equal(list.length, TEN_HALL_HISTORY_LIMIT);
  assert.equal(list[0].id, "batch-24");
  assert.ok(!list.some((item) => item.id === "batch-a"));
});

test("deletes one batch without affecting another role or batch", () => {
  const storage = storageFixture();
  saveTenHallHistory(100, entry(), storage);
  saveTenHallHistory(100, entry({ id: "next" }), storage);
  saveTenHallHistory(200, entry(), storage);
  removeTenHallHistory(100, "batch-a", storage);
  assert.deepEqual(
    readTenHallHistory(100, storage).map((item) => item.id),
    ["next"],
  );
  assert.equal(readTenHallHistory(200, storage).length, 1);
});

test("does not invent missing battle data or save an empty batch", () => {
  const storage = storageFixture();
  const [saved] = saveTenHallHistory(
    100,
    entry({ results: [{ isWin: null, rounds: null, downCount: null }] }),
    storage,
  );
  assert.equal(saved.results[0].isWin, null);
  assert.equal(saved.results[0].rounds, null);
  assert.equal(saved.results[0].downCount, null);
  assert.throws(
    () => saveTenHallHistory(100, entry({ results: [] }), storage),
    /缺少/,
  );
  assert.deepEqual(readTenHallHistory(null, storage), []);
});

test("storage errors are exposed for the caller to report without interrupting battle logic", () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.throws(() => saveTenHallHistory(100, entry(), storage), /quota/);
});
