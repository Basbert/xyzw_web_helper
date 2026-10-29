import { ref, watch } from "vue";

/** Keep game responses tied to their account while exposing the selected one. */
export function createAccountGameData(selectedTokenId, createInitialState) {
  const accounts = new Map();
  const gameData = ref(createInitialState());

  const forToken = (tokenId) => {
    if (!tokenId) throw new Error("无法识别游戏账号");
    if (!accounts.has(tokenId))
      accounts.set(tokenId, ref(createInitialState()));
    return accounts.get(tokenId);
  };

  watch(
    selectedTokenId,
    (tokenId) => {
      gameData.value = tokenId ? forToken(tokenId).value : createInitialState();
    },
    { immediate: true, flush: "sync" },
  );

  // Some existing components replace gameData while updating a preset team.
  watch(
    gameData,
    (value) => {
      if (selectedTokenId.value) forToken(selectedTokenId.value).value = value;
    },
    { flush: "sync" },
  );

  const remove = (tokenId) => {
    accounts.delete(tokenId);
    if (selectedTokenId.value === tokenId)
      gameData.value = forToken(tokenId).value;
  };

  const clear = () => {
    accounts.clear();
    gameData.value = selectedTokenId.value
      ? forToken(selectedTokenId.value).value
      : createInitialState();
  };

  return { gameData, forToken, remove, clear };
}
