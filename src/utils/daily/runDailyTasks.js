import { runDailyDreamPurchase } from "../dailyDreamPurchase.js";
import { DailyTaskRunner } from "../dailyTaskRunner.js";
import { markDreamShopChecked } from "../dreamShopCheckState.js";

export { markDreamShopChecked };

/** Shared entry point for dashboard, daily view and batch scheduling. */
export function runDailyTasks({
  tokenStore,
  tokenId,
  settings,
  delays,
  callbacks,
}) {
  const runner = new DailyTaskRunner(
    tokenStore,
    delays ??
      (settings && {
        commandDelay: settings.commandDelay,
        taskDelay: settings.taskDelay,
      }),
    {
      onDreamShopChecked: markDreamShopChecked,
      runDreamShopPurchases: ({ tokenId, checkActive, sleep, log }) =>
        runDailyDreamPurchase({
          accountId: tokenId,
          isOpen: true,
          send: (command, params) => {
            checkActive();
            return tokenStore.sendMessageWithPromise(
              tokenId,
              command,
              params,
              15000,
            );
          },
          checkActive,
          pause: sleep,
          onProgress: ({ confirmed, total }) =>
            log(`梦境商品：已确认购买 ${confirmed}/${total} 件`),
        }),
    },
  );
  return runner.run(tokenId, callbacks, settings);
}
