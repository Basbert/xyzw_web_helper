import assert from "node:assert/strict";
import test from "node:test";
import {
  heroUpgradeOptions,
  selectedUpgradeHero,
} from "../src/utils/heroUpgradeData.js";

const dictionary = { 110: { name: "黄月英", avatar: "/hero.png" } };

test("disconnected or incomplete role data leaves the hero list empty", () => {
  for (const data of [null, {}, { role: null }, { role: {} }]) {
    assert.deepEqual(heroUpgradeOptions(data, dictionary), []);
    assert.equal(selectedUpgradeHero(data, 110, dictionary), null);
  }
});

test("loaded heroes show updated levels and tolerate an unknown hero", () => {
  const info = {
    role: {
      heroes: {
        110: { heroId: 110, level: 1200 },
        999: { heroId: 999, level: "6000" },
      },
    },
  };
  const options = heroUpgradeOptions(info, dictionary);
  assert.deepEqual(options, [
    { label: "黄月英(1200/6000)", value: 110, disabled: false },
    { label: "武将 999(6000/6000)", value: 999, disabled: true },
  ]);
  assert.equal(selectedUpgradeHero(info, 110, dictionary).avatar, "/hero.png");
  assert.equal(selectedUpgradeHero(info, 999, dictionary), null);
  info.role.heroes[110].level = 1250;
  assert.equal(selectedUpgradeHero(info, 110, dictionary).level, 1250);
});
