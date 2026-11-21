import { toRaw, watch } from "vue";

export const getAccountClient = (store, tokenId) =>
  toRaw(
    store.getWebSocketClient?.(tokenId) ??
      store.wsConnections?.[tokenId]?.client,
  ) ?? null;

/** Pin a connected client and socket. An observed disconnect invalidates them for this run. */
export function trackAccountConnection(
  store,
  tokenId,
  client = getAccountClient(store, tokenId),
  socket = client?.socket,
) {
  const expectedClient = toRaw(client);
  const expectedSocket = toRaw(socket) ?? null;
  const snapshot = () => {
    const current = getAccountClient(store, tokenId);
    // Read the socket through the reactive view before unwrapping it for comparison.
    const reactiveClient = store.wsConnections?.[tokenId]?.client ?? current;
    return [
      store.getWebSocketStatus?.(tokenId),
      current,
      toRaw(reactiveClient?.socket) ?? null,
    ];
  };
  const matches = ([status, current, currentSocket]) =>
    Boolean(expectedClient) &&
    (status === undefined || status === "connected") &&
    current === expectedClient &&
    currentSocket === expectedSocket;

  let invalidated = !matches(snapshot());
  const stop = watch(
    snapshot,
    (state) => {
      if (!matches(state)) invalidated = true;
    },
    { flush: "sync" },
  );

  return {
    isIntact: () => !invalidated && matches(snapshot()),
    stop,
  };
}
