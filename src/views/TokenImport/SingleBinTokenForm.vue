<template>
  <!-- 手动输入表单 -->
  <NForm
    :model="importForm"
    label-placement="top"
    size="large"
    :show-label="true"
  >
    <NFormItem label="游戏角色名称" :show-label="true">
      <NInput
        v-model:value="importForm.name"
        placeholder="例如：主号战士"
        clearable
      />
    </NFormItem>

    <NFormItem label="bin文件" :show-label="true">
      <n-upload
        multiple
        accept=".bin,.dmp"
        :show-file-list="false"
        @before-upload="handleBeforeUpload"
      >
        <n-upload-dragger>
          <div style="padding: 8px 0">
            <span>点击或拖拽 .bin / .dmp 文件到此处</span>
          </div>
        </n-upload-dragger>
      </n-upload>
    </NFormItem>
    <n-list bordered>
      <n-list-item v-for="(role, roleIndex) in roleList" :key="roleIndex">
        <div>
          <strong>角色名称:</strong> {{ role.name || "未命名角色" }}<br />
          <strong>Token:</strong>
          <span style="word-break: break-all">{{ role.token }}</span
          ><br />
          <strong>服务器:</strong> {{ role.server || "未指定" }}
        </div>
      </n-list-item>
    </n-list>

    <!-- 角色详情 -->
    <NCollapse>
      <NCollapseItem title="角色详情 (可选)" name="optional">
        <div class="optional-fields">
          <NFormItem label="服务器">
            <NInput
              v-model:value="importForm.server"
              placeholder="服务器名称"
            />
          </NFormItem>

          <NFormItem label="自定义连接地址">
            <NInput
              v-model:value="importForm.wsUrl"
              placeholder="留空使用默认连接"
            />
          </NFormItem>
        </div>
      </NCollapseItem>
    </NCollapse>

    <div class="form-actions">
      <NButton
        type="primary"
        size="large"
        block
        :loading="isImporting"
        :disabled="isImporting || pendingAddCount > 0"
        @click="handleImport"
      >
        <template #icon>
          <NIcon>
            <CloudUpload />
          </NIcon>
        </template>
        添加Token
      </NButton>

      <NButton v-if="tokenStore.hasTokens" size="large" block @click="cancel">
        取消
      </NButton>
    </div>
  </NForm>
</template>

<script lang="ts" setup>
import { CloudUpload } from "@vicons/ionicons5";
import {
  NButton,
  NCollapse,
  NCollapseItem,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  useMessage,
} from "naive-ui";
import PQueue from "p-queue";

import { reactive, ref } from "vue";

import useIndexedDB from "@/hooks/useIndexedDB";
import { useTokenStore } from "@/stores/tokenStore";
import { normalizeRoleId } from "@/utils/accountIdentity";
import { g_utils } from "@/utils/bonProtocol";
import { getServerList, getTokenId, transformToken } from "@/utils/token";
import {
  extractAuthenticatedRoleId,
  formatUpsertImportMessage,
  pruneSucceededImportRoles,
  upsertImportedRoleTokens,
} from "@/utils/tokenImportUpsert";

const $emit = defineEmits(["cancel", "ok"]);

const {
  storeArrayBuffer,
  storeArrayBufferIfMissing,
  storeArrayBufferIfUnchanged,
  getArrayBuffer,
  getArrayBufferRecord,
  deleteArrayBuffer,
  deleteArrayBufferIfUnchanged,
} = useIndexedDB();

const cancel = () => {
  roleList.value = [];
  $emit("cancel");
};

const tokenStore = useTokenStore();
const message = useMessage();
const isImporting = ref(false);
const pendingAddCount = ref(0);
const importForm = reactive({
  name: "",
  server: "",
  wsUrl: "",
  importMethod: "",
});
const roleList = ref<
  Array<{
    id: string;
    roleId?: string;
    name: string;
    token: string;
    server: string;
    wsUrl: string;
    importMethod: string;
  }>
>([]);

const tQueue = new PQueue({ concurrency: 1, interval: 1000 });

const initName = (fileName: string) => {
  if (!fileName) return;
  fileName = fileName.trim();
  const binRes = fileName.match(/^bin-(.*?)服-([0-2])-(\d{6,12})-(.*)\.bin$/);
  if (binRes) {
    importForm.name = `${binRes[1]}_${binRes[2]}_${binRes[4]}`;
    return {
      server: binRes[1],
      roleIndex: binRes[2],
      roleId: binRes[3],
      roleName: binRes[4],
    };
  }
  return {
    server: "",
    roleIndex: "",
    roleId: "",
    roleName: importForm.name || "",
  };
};

const handleBeforeUpload = (data: { file: { file?: File | null } }) => {
  if (isImporting.value) return false;
  if (data.file.file) {
    uploadBin(data.file.file);
  }
  return false;
};

const uploadBin = (binFile: File) => {
  pendingAddCount.value += 1;
  tQueue.add(async () => {
    try {
      const roleMeta = initName(binFile.name) as any;
      const userToken = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
        reader.onerror = () => reject(new Error("读取文件失败，请重试"));
        reader.readAsArrayBuffer(binFile);
      });
      if (!userToken || userToken.byteLength === 0) {
        throw new Error("文件内容为空，请检查 BIN 文件是否正确");
      }
      const tokenId = getTokenId(userToken);
      const roleToken = await transformToken(userToken);
      let authenticatedRoleId = extractAuthenticatedRoleId(roleToken);
      if (!authenticatedRoleId) {
        try {
          const binMsg = g_utils.parse(userToken);
          const binData = binMsg?.getData?.() || (binMsg as any)?._raw || null;
          const listStr = await getServerList(userToken);
          const serverRoles = listStr ? JSON.parse(listStr) : null;
          authenticatedRoleId = extractAuthenticatedRoleId(roleToken, {
            binData,
            serverRoles,
          });
        } catch {
          authenticatedRoleId = null;
        }
      }
      const roleName = roleMeta.roleName || binFile.name.split(".")?.[0] || "";
      // 刷新indexDB数据库token数据
      const saved = await storeArrayBuffer(tokenId, userToken);
      if (!saved) {
        message.error("保存BIN数据到IndexedDB失败");
        return;
      }

      // 上传列表中发现已存在的重复名称，提示消息
      if (roleList.value.some((role) => role.id === tokenId)) {
        message.error("上传列表中已存在同名角色! ");
        return;
      }
      const fileRoleId = normalizeRoleId(roleMeta.roleId);
      if (
        fileRoleId &&
        authenticatedRoleId &&
        fileRoleId !== authenticatedRoleId
      ) {
        message.warning(
          `文件名中的角色ID(${fileRoleId})与认证结果(${authenticatedRoleId})不一致，已按认证角色处理`,
        );
      }
      // 仅按内容哈希或认证确认的 roleId 匹配已有账号，绝不按未核验的文件名覆盖已有账号
      const existingToken = tokenStore.gameTokens.find(
        (t) =>
          t.id === tokenId ||
          (authenticatedRoleId &&
            normalizeRoleId(t.roleId) === authenticatedRoleId),
      );
      if (existingToken) {
        message.warning(
          `角色"${existingToken.name || roleName}"已存在，将更新该角色的Token`,
        );
      }
      message.success("Token读取成功，请检查角色名称等信息后提交");
      roleList.value.push({
        id: tokenId,
        ...(authenticatedRoleId ? { roleId: authenticatedRoleId } : {}),
        token: roleToken,
        name: roleName,
        server: `${roleMeta.server}${roleMeta.roleIndex}` || "",
        wsUrl: importForm.wsUrl || "",
        importMethod: "bin",
      });
    } catch (error: any) {
      console.error("读取单 BIN 文件失败", error);
      message.error(
        error?.message || "解析 BIN 文件或校验凭据失败，请重新导出后重试",
      );
    } finally {
      pendingAddCount.value = Math.max(0, pendingAddCount.value - 1);
    }
  });
  return false; // 阻止自动上传
};

const handleImport = async () => {
  if (isImporting.value) return;
  if (pendingAddCount.value > 0) {
    message.info("仍有角色正在准备中，请稍后再提交");
    return;
  }
  if (roleList.value.length === 0) {
    message.error("请先上传bin文件！");
    return;
  }
  const rolesToImport = [...roleList.value];
  isImporting.value = true;
  try {
    const result = await upsertImportedRoleTokens({
      roles: rolesToImport,
      tokenStore,
      getArrayBuffer,
      getArrayBufferRecord,
      storeArrayBuffer,
      storeArrayBufferIfMissing,
      storeArrayBufferIfUnchanged,
      deleteArrayBuffer,
      deleteArrayBufferIfUnchanged,
      allowPartial: true,
    });
    roleList.value = pruneSucceededImportRoles(
      roleList.value,
      rolesToImport,
      result.succeededIndices,
    );
    if (result.failedRoles.length > 0) {
      const firstError =
        result.failedRoles[0]?.error?.message || "导入失败，请重试";
      const succeededTotal = result.addedCount + result.updatedCount;
      message.error(
        succeededTotal > 0
          ? `已导入 ${succeededTotal} 个角色，仍有 ${result.failedRoles.length} 个失败：${firstError}`
          : firstError,
      );
      return;
    }
    if (roleList.value.length > 0) {
      message.success(
        `${formatUpsertImportMessage(result)}，待添加列表中仍有 ${roleList.value.length} 个角色未导入`,
      );
      return;
    }
    message.success(formatUpsertImportMessage(result));
    $emit("ok");
  } catch (error: any) {
    console.error("导入单 BIN 角色失败", error);
    message.error(error?.message || "导入失败，请重试");
  } finally {
    isImporting.value = false;
  }
};
</script>

<style scoped lang="scss">
.optional-fields {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;

  n-form-item {
    flex: 1;
    min-width: 200px;
  }
}

.form-actions {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dropzone-content {
  width: 100%;
  border: 1px dashed #fcc;
  border-radius: 8px;
  text-align: center;
  color: #888;
  padding: 40px 20px;
  font-size: 12px;
}
</style>

<route lang="json">
{
  "name": "/TokenImport/singlebin",
  "path": "/TokenImport/singlebin"
}
</route>
