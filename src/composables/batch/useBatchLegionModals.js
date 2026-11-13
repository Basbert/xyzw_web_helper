import { h, ref } from "vue";
import { formatPower } from "@/utils/batch/viewHelpers";

/**
 * Poll token WebSocket readiness instead of relying on a blind fixed sleep.
 */
async function ensureTokenWsConnected(
  tokenStore,
  tokenId,
  token,
  timeoutMs = 3000,
) {
  if (tokenStore.getWebSocketStatus(tokenId) === "connected") return;
  tokenStore.createWebSocketConnection(tokenId, token.token, token.wsUrl);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (tokenStore.getWebSocketStatus(tokenId) === "connected") return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (tokenStore.getWebSocketStatus(tokenId) !== "connected") {
    throw new Error("WebSocket 连接超时，请检查账号或网络状态");
  }
}

/**
 * Manage War Guess and Batch Apply Legion modals and queries.
 */
export function useBatchLegionModals({
  tokens,
  selectedTokens,
  tokenStore,
  message,
  addLog,
  batchWarGuessCheer,
  queryLegionById,
  batchApplyLegion,
}) {
  // War Guess Modal State
  const showWarGuessModal = ref(false);
  const warGuessList = ref([]);
  const warGuessLoading = ref(false);
  const warGuessCoin = ref(20);
  const selectedWarGuessLegionId = ref(null);

  const warGuessColumns = [
    {
      type: "selection",
      multiple: false,
    },
    { title: "ID", key: "id", width: 100 },
    {
      title: "头像",
      key: "logo",
      render(row) {
        return h("img", {
          src: row.logo,
          style: { width: "30px", height: "30px", borderRadius: "50%" },
        });
      },
      width: 60,
    },
    { title: "区服", key: "serverId", width: 80 },
    { title: "俱乐部", key: "name", width: 120 },
    {
      title: "战力",
      key: "power",
      render(row) {
        return formatPower(row.power);
      },
      width: 100,
    },
    { title: "红淬", key: "quenchNum" },
    { title: "已助威", key: "guessNum" },
    {
      title: "总热度",
      key: "totalNum",
      render(row) {
        return formatPower(row.totalNum || 0);
      },
      width: 100,
    },
  ];

  const warGuessRowProps = (row) => {
    return {
      style: "cursor: pointer",
      onClick: () => {
        selectedWarGuessLegionId.value = row.id;
      },
    };
  };

  const fetchWarGuessRank = async () => {
    if (selectedTokens.value.length === 0) {
      message.warning("请先选择一个账号用于获取月赛助威数据");
      return;
    }

    const tokenId = selectedTokens.value[0];
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) {
      message.warning("所选账号不存在");
      return;
    }

    warGuessLoading.value = true;
    try {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `正在使用 ${token.name} 获取月赛助威数据...`,
        type: "info",
      });

      await ensureTokenWsConnected(tokenStore, tokenId, token);

      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "warguess_getrank",
        { bfId: "" },
        5000,
      );

      if (res && res.list) {
        const list = Array.isArray(res.list)
          ? res.list
          : Object.values(res.list);

        warGuessList.value = list
          .sort((a, b) => (b.totalNum || 0) - (a.totalNum || 0))
          .slice(0, 20);
      } else {
        message.warning("获取月赛助威数据为空");
      }
    } catch (error) {
      console.error("Fetch rank error:", error);
      message.error(`获取月赛助威数据失败: ${error.message}`);
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `获取月赛助威数据失败: ${error.message}`,
        type: "error",
      });
    } finally {
      warGuessLoading.value = false;
    }
  };

  const openWarGuessModal = () => {
    showWarGuessModal.value = true;
    selectedWarGuessLegionId.value = null;
    warGuessList.value = [];

    if (selectedTokens.value.length > 0) {
      fetchWarGuessRank();
    }
  };

  const handleWarGuessCheer = async () => {
    if (!selectedWarGuessLegionId.value) {
      message.warning("请先选择一个俱乐部");
      return;
    }
    showWarGuessModal.value = false;
    await batchWarGuessCheer(
      selectedWarGuessLegionId.value,
      warGuessCoin.value,
    );
  };

  // Batch Apply Legion Modal State
  const showApplyLegionModal = ref(false);
  const applyLegionTargetId = ref(null);
  const applyLegionPreview = ref(null);
  const applyLegionLoading = ref(false);
  const applyLegionError = ref("");

  const openApplyLegionModal = () => {
    showApplyLegionModal.value = true;
    applyLegionError.value = "";
    applyLegionPreview.value = null;
  };

  const fetchApplyLegionTargetInfo = async () => {
    if (selectedTokens.value.length === 0) {
      message.warning("请先选择一个账号用于查询俱乐部");
      return;
    }

    if (!applyLegionTargetId.value) {
      message.warning("请先输入俱乐部ID");
      return;
    }

    const tokenId = selectedTokens.value[0];
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) {
      message.warning("所选账号不存在");
      return;
    }

    applyLegionLoading.value = true;
    applyLegionError.value = "";
    applyLegionPreview.value = null;

    try {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `正在使用 ${token.name} 查询俱乐部 ${applyLegionTargetId.value}...`,
        type: "info",
      });

      await ensureTokenWsConnected(tokenStore, tokenId, token);

      applyLegionPreview.value = await queryLegionById(
        tokenId,
        applyLegionTargetId.value,
      );

      addLog({
        time: new Date().toLocaleTimeString(),
        message: `已查询到目标俱乐部: ${applyLegionPreview.value.name} (${applyLegionPreview.value.id})`,
        type: "success",
      });
    } catch (error) {
      console.error("Fetch legion info error:", error);
      applyLegionError.value = error.message || "查询俱乐部失败";
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `查询俱乐部失败: ${applyLegionError.value}`,
        type: "error",
      });
      message.error(applyLegionError.value);
    } finally {
      applyLegionLoading.value = false;
    }
  };

  const handleBatchApplyLegion = async () => {
    if (!applyLegionPreview.value?.id) {
      message.warning("请先查询并确认目标俱乐部");
      return;
    }

    showApplyLegionModal.value = false;
    await batchApplyLegion(applyLegionPreview.value.id);
  };

  return {
    showWarGuessModal,
    warGuessList,
    warGuessLoading,
    warGuessCoin,
    selectedWarGuessLegionId,
    warGuessColumns,
    warGuessRowProps,
    openWarGuessModal,
    fetchWarGuessRank,
    handleWarGuessCheer,
    showApplyLegionModal,
    applyLegionTargetId,
    applyLegionPreview,
    applyLegionLoading,
    applyLegionError,
    openApplyLegionModal,
    fetchApplyLegionTargetInfo,
    handleBatchApplyLegion,
  };
}
