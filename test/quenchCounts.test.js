import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  countQuenchRecords,
  findOwnHeroEquipment,
} from "../src/utils/quenchCounts.js";

const fullEquipment = {
  1: { quenches: { 1: { colorId: "6" }, 2: { colorId: 5 } } },
  2: { quenches: { 1: { colorId: 6 }, 2: { colorId: 4 } } },
  3: { quenches: { 1: { colorId: 3 }, 2: { colorId: 2 } } },
  4: { quenches: {} },
};
const publicEquipment = {
  1: { quenches: { 1: { colorId: "6" } } },
  2: { quenches: { 1: { colorId: 6 } } },
  3: { quenches: {} },
  4: { quenches: {} },
};
const ownRole = {
  roleId: 3854,
  heroes: { 123: { heroId: 123, equipment: fullEquipment } },
};

test("count red records independently from all returned quench records", () => {
  assert.deepEqual(countQuenchRecords(fullEquipment), {
    redCount: 2,
    recordCount: 6,
    hasRecords: true,
    complete: true,
  });
  assert.deepEqual(countQuenchRecords(publicEquipment), {
    redCount: 2,
    recordCount: 2,
    hasRecords: true,
    complete: true,
  });
});

test("incomplete or malformed equipment never certifies a full slot count", () => {
  assert.equal(countQuenchRecords(null).complete, false);
  assert.equal(countQuenchRecords({ 1: {} }).hasRecords, false);
  const invalid = { ...fullEquipment, 2: { quenches: { 1: null } } };
  assert.equal(countQuenchRecords(invalid).complete, false);
  assert.equal(
    findOwnHeroEquipment(
      3854,
      { ...ownRole, heroes: { 123: { equipment: invalid } } },
      123,
    ),
    null,
  );
});

test("detailed account data is used only for the matching role and hero", () => {
  assert.equal(findOwnHeroEquipment("3854", ownRole, "123"), fullEquipment);
  assert.equal(findOwnHeroEquipment(3855, ownRole, 123), null);
  assert.equal(findOwnHeroEquipment(null, ownRole, 123), null);
  assert.equal(findOwnHeroEquipment(3854, ownRole, 124), null);
  const wrongKey = {
    roleId: 3854,
    heroes: { 123: { heroId: 124, equipment: fullEquipment } },
  };
  assert.equal(findOwnHeroEquipment(3854, wrongKey, 123), null);
  const arrayRole = {
    roleId: 3854,
    heroes: [{ heroId: 123, equipment: fullEquipment }],
  };
  assert.equal(findOwnHeroEquipment(3854, arrayRole, 123), fullEquipment);
});

const component = await readFile(
  new URL("../src/components/Club/ClubInfo.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
const source = ts.createSourceFile(
  "ClubInfo.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const declaration = source.statements.find(
  (statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(
      (item) => item.name.getText(source) === "getHeroInfo",
    ),
);
assert.ok(declaration);
const context = {
  countQuenchRecords,
  findOwnHeroEquipment,
  HERO_DICT: {},
  console,
};
vm.createContext(context);
vm.runInContext(
  `${declaration.getText(source)}\nglobalThis.getHeroInfo = getHeroInfo;`,
  context,
);

test("club member details show own complete slots, but never infer another player's total", () => {
  const heroes = [{ heroId: 123, equipment: publicEquipment }];
  const own = context.getHeroInfo(heroes, 3854, ownRole);
  assert.equal(own.redCount, 2);
  assert.equal(own.holeCount, 6);
  assert.equal(own.heroList[0].equipment, fullEquipment);

  const other = context.getHeroInfo(heroes, 3855, ownRole);
  assert.equal(other.redCount, 2);
  assert.equal(other.holeCount, null);
  assert.equal(other.heroList[0].equipment, publicEquipment);
});

test("missing equipment leaves the total unknown without discarding other heroes", () => {
  const heroes = [
    { heroId: 123, equipment: publicEquipment },
    { heroId: 124, equipment: { 1: {} } },
  ];
  const result = context.getHeroInfo(heroes, 3855, ownRole);
  assert.equal(result.heroList.length, 2);
  assert.equal(result.heroList[0].red, 2);
  assert.equal(result.redCount, null);
  assert.equal(result.holeCount, null);
});
