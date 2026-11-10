import assert from "node:assert/strict";
import test from "node:test";
import {
  isDreamShopChecked,
  markDreamShopChecked,
  subscribeDreamShopChecks,
} from "../src/utils/dreamShopCheckState.js";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}
const taskDay = Date.parse("2026-11-11T00:00:00+08:00") / 1000;

test("按服务端日常日期和角色保存，跨角色及北京时间跨日失效", () => {
  const storage = memoryStorage();
  assert.equal(
    markDreamShopChecked({ roleId: 123, taskDay }, { storage }),
    true,
  );
  assert.equal(
    isDreamShopChecked({ roleId: "123", dayKey: "261111" }, { storage }),
    true,
  );
  assert.equal(
    isDreamShopChecked({ roleId: "456", dayKey: "261111" }, { storage }),
    false,
  );
  assert.equal(
    isDreamShopChecked({ roleId: "123", dayKey: "261112" }, { storage }),
    false,
  );
});

test("无服务端身份或日期、存储失败时不显示已检查", () => {
  const storage = memoryStorage();
  for (const data of [
    { taskDay },
    { roleId: "0", taskDay },
    { roleId: 123 },
    { roleId: 123, taskDay: Number.NaN },
  ])
    assert.equal(markDreamShopChecked(data, { storage }), false);
  const badStorage = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  assert.equal(
    markDreamShopChecked({ roleId: 123, taskDay }, { storage: badStorage }),
    false,
  );
  assert.equal(
    isDreamShopChecked(
      { roleId: 123, dayKey: "261111" },
      { storage: badStorage },
    ),
    false,
  );
});

test("同页更新和跨标签页存储事件通知订阅者并可注销", () => {
  const storage = memoryStorage();
  const target = new EventTarget();
  let updates = 0;
  const unsubscribe = subscribeDreamShopChecks(() => updates++, target);
  markDreamShopChecked({ roleId: 123, taskDay }, { storage, target });
  const changed = new Event("storage");
  Object.defineProperty(changed, "key", { value: "dream-shop-checked:v1:123" });
  target.dispatchEvent(changed);
  const other = new Event("storage");
  Object.defineProperty(other, "key", { value: "unrelated" });
  target.dispatchEvent(other);
  assert.equal(updates, 2);
  unsubscribe();
  target.dispatchEvent(changed);
  assert.equal(updates, 2);
});
