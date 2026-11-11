import assert from "node:assert/strict";
import test from "node:test";
import { runTowerClimb } from "../src/utils/towerClimbRunner.js";

function fixture({
  energy = 2,
  hp = 10,
  uncertain = false,
  fail = false,
  isWin,
  advance = true,
} = {}) {
  let remaining = energy;
  let stage = 1;
  let active = true;
  const calls = [];
  const progress = [];
  const args = {
    send: async (command) => {
      calls.push(command);
      if (command === "role_getroleinfo")
        return { role: { tower: { energy: remaining, id: stage } } };
      if (fail) throw new Error("timeout");
      remaining--;
      if (advance && !uncertain && hp > 0 && isWin !== false) stage++;
      return uncertain
        ? {}
        : {
            battleData: { result: { isWin, sponsor: { ext: { curHP: hp } } } },
          };
    },
    checkSession: () => {
      if (!active) throw new Error("changed");
    },
    shouldStop: () => false,
    onProgress: (count) => progress.push(count),
    delay: async () => {},
  };
  return {
    args,
    calls,
    progress,
    change: () => {
      active = false;
    },
  };
}

test("逐次核对体力并报告完成次数", async () => {
  const f = fixture();
  assert.deepEqual(await runTowerClimb(f.args), {
    attempts: 2,
    reason: "energy",
  });
  assert.deepEqual(f.progress, [1, 2]);
  assert.equal(f.calls.filter((item) => item === "fight_starttower").length, 2);
});

test("挑战失败自动重试，直至小鱼干不足", async () => {
  for (const options of [{ hp: 0 }, { hp: 10, isWin: false }]) {
    const f = fixture(options);
    assert.deepEqual(await runTowerClimb(f.args), {
      attempts: 2,
      reason: "energy",
    });
    assert.equal(
      f.calls.filter((item) => item === "fight_starttower").length,
      2,
    );
  }
});

test("连续失败后成功时继续爬下一层，无 100 次上限", async () => {
  let remaining = 103;
  let stage = 1;
  const stages = [];
  const f = fixture();
  f.args.send = async (command) => {
    if (command === "role_getroleinfo")
      return { role: { tower: { energy: remaining, id: stage } } };
    stages.push(stage);
    remaining--;
    if (stages.length > 101) stage++;
    return { battleData: { result: { isWin: stages.length > 101 } } };
  };
  assert.deepEqual(await runTowerClimb(f.args), {
    attempts: 103,
    reason: "energy",
  });
  assert.equal(stages[100], 1);
  assert.equal(stages[101], 1);
  assert.equal(stages[102], 2);
});

test("结果无法确认或声称成功但层数未推进时停止", async () => {
  for (const [options, reason] of [
    [{ uncertain: true }, "uncertain"],
    [{ hp: 10, isWin: true, advance: false }, "uncertain"],
  ]) {
    const f = fixture(options);
    assert.deepEqual(await runTowerClimb(f.args), { attempts: 1, reason });
    assert.equal(
      f.calls.filter((item) => item === "fight_starttower").length,
      1,
    );
  }
});

test("停止、连接变化或战斗超时不会发起下一次挑战", async () => {
  const stopped = fixture();
  stopped.args.shouldStop = () => true;
  assert.deepEqual(await runTowerClimb(stopped.args), {
    attempts: 0,
    reason: "stopped",
  });
  assert.deepEqual(stopped.calls, []);
  const changed = fixture();
  changed.args.delay = async () => changed.change();
  await assert.rejects(runTowerClimb(changed.args), /changed/);
  assert.equal(
    changed.calls.filter((item) => item === "fight_starttower").length,
    1,
  );
  const failed = fixture({ fail: true });
  await assert.rejects(runTowerClimb(failed.args), /timeout/);
  assert.equal(
    failed.calls.filter((item) => item === "fight_starttower").length,
    1,
  );
});

test("失败后等待期间手动停止，不再发起下一次挑战", async () => {
  const f = fixture({ hp: 0 });
  let stop = false;
  f.args.shouldStop = () => stop;
  f.args.delay = async () => {
    stop = true;
  };
  assert.deepEqual(await runTowerClimb(f.args), {
    attempts: 1,
    reason: "stopped",
  });
  assert.equal(f.calls.filter((item) => item === "fight_starttower").length, 1);
});

test("缺失层数时不发起战斗，只有服务端确认层数推进才继续", async () => {
  const missing = fixture();
  missing.args.send = async (command) => {
    missing.calls.push(command);
    return { role: { tower: { energy: 1 } } };
  };
  await assert.rejects(runTowerClimb(missing.args), /未返回当前咸将塔层数/);
  assert.deepEqual(missing.calls, ["role_getroleinfo"]);

  const progressed = fixture({ hp: undefined });
  let stage = 1;
  let energy = 1;
  progressed.args.send = async (command) => {
    progressed.calls.push(command);
    if (command === "role_getroleinfo")
      return { role: { tower: { energy, id: stage } } };
    stage++;
    energy--;
    return {};
  };
  assert.deepEqual(await runTowerClimb(progressed.args), {
    attempts: 1,
    reason: "energy",
  });
});
