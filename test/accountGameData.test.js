import assert from "node:assert/strict";
import { test } from "node:test";
import { ref } from "vue";
import { createAccountGameData } from "../src/utils/accountGameData.js";

const createState = () => ({
  roleInfo: null,
  battleVersion: null,
  presetTeam: null,
});

test("background game responses do not replace the selected account's data", () => {
  const selected = ref("alpha");
  const data = createAccountGameData(selected, createState);
  const alpha = data.forToken("alpha");
  const beta = data.forToken("beta");
  alpha.value.roleInfo = { role: { id: "alpha", tickets: 2 } };
  alpha.value.battleVersion = 11;
  beta.value.roleInfo = { role: { id: "beta", tickets: 9 } };
  beta.value.battleVersion = 22;

  assert.equal(data.gameData.value.roleInfo.role.id, "alpha");
  assert.equal(data.gameData.value.battleVersion, 11);

  selected.value = "beta";
  assert.equal(data.gameData.value.roleInfo.role.id, "beta");
  assert.equal(data.gameData.value.battleVersion, 22);

  // A delayed callback for the previous account must not change the new view.
  alpha.value.roleInfo = { role: { id: "alpha", tickets: 1 } };
  assert.equal(data.gameData.value.roleInfo.role.id, "beta");
  selected.value = "alpha";
  assert.equal(data.gameData.value.roleInfo.role.tickets, 1);
});

test("replacing selected game data stays tied to the same account", () => {
  const selected = ref("alpha");
  const data = createAccountGameData(selected, createState);
  data.gameData.value = { ...data.gameData.value, presetTeam: { team: 3 } };
  assert.equal(data.forToken("alpha").value.presetTeam.team, 3);
  selected.value = "beta";
  assert.equal(data.gameData.value.presetTeam, null);
  selected.value = "alpha";
  assert.equal(data.gameData.value.presetTeam.team, 3);
});

test("removing or clearing accounts discards their cached game state", () => {
  const selected = ref("alpha");
  const data = createAccountGameData(selected, createState);
  data.forToken("alpha").value.battleVersion = 3;
  data.forToken("beta").value.battleVersion = 8;
  data.remove("alpha");
  assert.equal(data.gameData.value.battleVersion, null);
  selected.value = "beta";
  assert.equal(data.gameData.value.battleVersion, 8);
  data.clear();
  assert.equal(data.gameData.value.battleVersion, null);
  selected.value = "alpha";
  assert.equal(data.gameData.value.battleVersion, null);
});
