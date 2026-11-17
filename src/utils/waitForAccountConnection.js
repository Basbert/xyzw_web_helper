import { watch } from "vue";

/**
 * Wait for the selected account's actual connection, with bounded cleanup.
 * Resolves false on timeout, account switch, or cancellation.
 */
export function waitForAccountConnection(
  tokenStore,
  tokenId,
  { timeoutMs = 20000, signal } = {},
) {
  return new Promise((resolve) => {
    let finished = false;
    let stopWatching = () => {};
    let timer;
    const finish = (connected) => {
      if (finished) return;
      finished = true;
      stopWatching();
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      resolve(connected);
    };
    const cancel = () => finish(false);
    const check = () => {
      if (signal?.aborted || tokenStore.selectedToken?.id !== tokenId) {
        finish(false);
      } else if (tokenStore.getWebSocketStatus(tokenId) === "connected") {
        finish(true);
      }
    };

    stopWatching = watch(
      () => [
        tokenStore.selectedToken?.id,
        tokenStore.getWebSocketStatus(tokenId),
      ],
      check,
      { flush: "sync" },
    );
    timer = setTimeout(cancel, timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    check();
  });
}
