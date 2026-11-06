import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.js";

test("dashboard clock refreshes after returning to the page across China midnight", async () => {
  let timestamp = Date.UTC(2026, 10, 4, 4);
  let mounted, unmounted, listener, scheduled;
  class FakeDate extends Date {
    static now() {
      return timestamp;
    }
  }
  const document = {
    visibilityState: "visible",
    addEventListener(_name, cb) {
      listener = cb;
    },
    removeEventListener(_name, cb) {
      assert.equal(cb, listener);
      listener = null;
    },
  };
  const window = {
    setInterval(cb) {
      scheduled = cb;
      return 7;
    },
    clearInterval(id) {
      assert.equal(id, 7);
    },
  };
  const { useShanghaiClock, formatShanghaiDate } = await loadModule(
    new URL("../src/hooks/useShanghaiClock.js", import.meta.url),
    {
      vue: {
        ref: (value) => ({ value }),
        onMounted(cb) {
          mounted = cb;
        },
        onUnmounted(cb) {
          unmounted = cb;
        },
      },
    },
    { Date: FakeDate, document, window },
  );
  const now = useShanghaiClock();
  mounted();
  assert.match(formatShanghaiDate(now.value), /11月4日.*星期三/);
  timestamp = Date.UTC(2026, 10, 6, 4);
  listener();
  assert.match(formatShanghaiDate(now.value), /11月6日.*星期五/);
  timestamp += 60000;
  scheduled();
  assert.equal(now.value, timestamp);
  unmounted();
  assert.equal(listener, null);
});
