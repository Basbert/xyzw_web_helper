import { ref } from "vue";

export const GROUP_COLORS = [
  "#1677ff", // 蓝色
  "#52c41a", // 绿色
  "#faad14", // 橙色
  "#f5222d", // 红色
  "#722ed1", // 紫色
  "#13c2c2", // 青色
  "#eb2f96", // 粉色
  "#fa8c16", // 赤红色
];

/**
 * Manage batch token groups CRUD and group-based token selection.
 */
export function useBatchTokenGroups({
  tokenGroups,
  sortedTokens,
  selectedTokens,
  tokenStore,
  message,
  confirmFn,
}) {
  const showGroupManageModal = ref(false);
  const selectedGroups = ref([]);
  const newGroupName = ref("");
  const newGroupColor = ref("#1677ff");
  const newGroupSelectedTokens = ref([]);
  const editingGroupId = ref(null);
  const editingGroupName = ref("");
  const editingGroupColor = ref("");

  const createNewGroup = () => {
    const trimmedName = newGroupName.value.trim();
    if (!trimmedName) {
      message.warning("请输入分组名称");
      return;
    }

    const newGroup = tokenStore.createTokenGroup(
      trimmedName,
      newGroupColor.value,
    );

    if (newGroupSelectedTokens.value.length > 0) {
      newGroupSelectedTokens.value.forEach((tokenId) => {
        tokenStore.addTokenToGroup(newGroup.id, tokenId);
      });
    }

    message.success("分组创建成功");
    newGroupName.value = "";
    newGroupColor.value = "#1677ff";
    newGroupSelectedTokens.value = [];
  };

  const selectAllNewGroup = () => {
    newGroupSelectedTokens.value = sortedTokens.value.map((t) => t.id);
  };

  const deselectAllNewGroup = () => {
    newGroupSelectedTokens.value = [];
  };

  const deleteGroup = (groupId) => {
    const confirmed = confirmFn
      ? confirmFn("确定要删除这个分组吗？分组中的token不会被删除。")
      : // eslint-disable-next-line no-alert -- Preserve native confirmation flow.
        window.confirm("确定要删除这个分组吗？分组中的token不会被删除。");
    if (confirmed) {
      tokenStore.deleteTokenGroup(groupId);
      selectedGroups.value = selectedGroups.value.filter(
        (id) => id !== groupId,
      );
      message.success("分组已删除");
    }
  };

  const saveEditGroup = () => {
    if (!editingGroupId.value) return;

    const trimmedName = editingGroupName.value.trim();
    if (!trimmedName) {
      message.warning("请输入分组名称");
      return;
    }

    tokenStore.updateTokenGroup(editingGroupId.value, {
      name: trimmedName,
      color: editingGroupColor.value,
    });

    message.success("分组已更新");
    editingGroupId.value = null;
    editingGroupName.value = "";
    editingGroupColor.value = "";
  };

  const startEditGroup = (groupId) => {
    const group = tokenGroups.value.find((g) => g.id === groupId);
    if (group) {
      editingGroupId.value = groupId;
      editingGroupName.value = group.name;
      editingGroupColor.value = group.color;
    }
  };

  const cancelEditGroup = () => {
    editingGroupId.value = null;
    editingGroupName.value = "";
    editingGroupColor.value = "";
  };

  const updateSelectedTokensFromGroups = () => {
    const tokenIds = new Set();

    selectedGroups.value.forEach((groupId) => {
      const validTokenIds = tokenStore.getValidGroupTokenIds(groupId);
      validTokenIds.forEach((id) => tokenIds.add(id));
    });

    selectedTokens.value = Array.from(tokenIds);
  };

  const toggleGroupSelection = (groupId) => {
    const index = selectedGroups.value.indexOf(groupId);
    if (index > -1) {
      selectedGroups.value.splice(index, 1);
    } else {
      selectedGroups.value.push(groupId);
    }
    updateSelectedTokensFromGroups();
  };

  const isGroupSelected = (groupId) => {
    return selectedGroups.value.includes(groupId);
  };

  const clearAllGroupSelection = () => {
    selectedGroups.value = [];
    selectedTokens.value = [];
  };

  const addTokenToSelectedGroup = (groupId, tokenId) => {
    tokenStore.addTokenToGroup(groupId, tokenId);
    message.success("已将token添加到分组");
  };

  const removeTokenFromSelectedGroup = (groupId, tokenId) => {
    tokenStore.removeTokenFromGroup(groupId, tokenId);
    message.success("已将token从分组移除");
  };

  const getValidGroupTokenIds = (groupId) => {
    return tokenStore.getValidGroupTokenIds(groupId);
  };

  return {
    showGroupManageModal,
    selectedGroups,
    newGroupName,
    newGroupColor,
    newGroupSelectedTokens,
    editingGroupId,
    editingGroupName,
    editingGroupColor,
    groupColors: GROUP_COLORS,
    createNewGroup,
    selectAllNewGroup,
    deselectAllNewGroup,
    deleteGroup,
    saveEditGroup,
    startEditGroup,
    cancelEditGroup,
    toggleGroupSelection,
    isGroupSelected,
    updateSelectedTokensFromGroups,
    clearAllGroupSelection,
    addTokenToSelectedGroup,
    removeTokenFromSelectedGroup,
    getValidGroupTokenIds,
  };
}
