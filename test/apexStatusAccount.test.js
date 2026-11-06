import assert from "node:assert/strict";
import test from "node:test";
import { computed, nextTick, reactive, ref, watch } from "vue";
import { loadModule } from "./helpers/loadModule.js";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

async function setup() {
  const pending = [];
  const cleanup = [];
  const { useApexGuessStatus } = await loadModule(
    new URL("../src/hooks/useApexGuessStatus.js", import.meta.url),
    {
      vue: {
        computed,
        ref,
        watch,
        onMounted() {},
        onUnmounted(fn) {
          cleanup.push(fn);
        },
      },
      "@/utils/apexGuessHelper.js": {
        getApexGuessStatus(_store, id) {
          const request = deferred();
          pending.push({ id, ...request });
          return request.promise;
        },
      },
    },
    { document: { removeEventListener() {} }, window: { clearInterval() {} } },
  );
  const store = reactive({
    selectedToken: { id: "alpha" },
    statuses: { alpha: "connected", beta: "connected" },
    getWebSocketStatus(id) {
      return this.statuses[id];
    },
  });
  return { store, pending, cleanup, state: useApexGuessStatus(store) };
}

test("late status responses cannot overwrite the newly selected account", async () => {
  const f = await setup();
  assert.equal(f.pending[0].id, "alpha");
  f.store.selectedToken = { id: "beta" };
  await nextTick();
  assert.equal(f.pending[1].id, "beta");
  f.pending[1].resolve({ summaryText: "beta status", pendingStagesCount: 1 });
  await nextTick();
  await nextTick();
  assert.equal(f.state.state.value.summaryText, "beta status");
  f.pending[0].resolve({
    summaryText: "old alpha status",
    pendingStagesCount: 0,
  });
  await nextTick();
  await nextTick();
  assert.equal(f.state.state.value.summaryText, "beta status");
  f.cleanup.forEach((fn) => fn());
});

test("failed status reads remain distinguishable from completed guesses", async () => {
  const f = await setup();
  f.pending[0].reject(new Error("disconnected"));
  await nextTick();
  await nextTick();
  assert.equal(f.state.state.value.kind, "error");
  assert.match(f.state.state.value.summaryText, /无法获取/);
  f.cleanup.forEach((fn) => fn());
});
