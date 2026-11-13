<template>
  <div class="wx-qrcode-import">
    <!-- 微信登录流程说明 -->
    <div class="login-flow-info">
      <h3>微信扫码登录流程</h3>
      <ol class="flow-steps">
        <li>点击下方按钮获取微信登录二维码</li>
        <li>使用微信扫码并确认登录</li>
        <li>
          系统将获取<strong color="red">该微信下所有角色</strong
          >的Token信息，并保存可用于刷新Token的登录凭据
        </li>
      </ol>
      <NCheckbox v-model:checked="saveCombUser">强制下线账号请勾选</NCheckbox>
    </div>

    <!-- 二维码显示区域 -->
    <div class="qrcode-container">
      <div
        v-if="!qrcodeUrl"
        id="qr-placeholder"
        class="qr-placeholder"
        @click="generateQRCode"
      >
        <NIcon size="48" color="var(--text-tertiary)">
          <Scan />
          <!-- 使用扫码图标 -->
        </NIcon>
        <p>点击获取微信登录二维码</p>
      </div>
      <img
        v-else
        id="qr-image"
        :src="qrcodeUrl"
        alt="微信登录二维码"
        class="qr-image"
      />

      <!-- 状态信息 -->
      <div id="qr-status" class="qr-status" :class="statusType">
        {{ statusMessage }}
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="form-actions">
      <NButton
        type="primary"
        block
        @click="generateQRCode"
        :loading="isProcessing"
      >
        <template #icon>
          <NIcon>
            <Refresh />
          </NIcon>
        </template>
        {{ qrcodeUrl ? "刷新二维码" : "获取二维码" }}
      </NButton>
    </div>

    <!-- 角色命名格式配置 -->
    <NForm
      :model="importForm"
      label-placement="top"
      :show-label="true"
      style="margin-top: 16px"
    >
      <NFormItem label="角色命名格式" :show-label="true">
        <NInput
          v-model:value="importForm.nameTemplate"
          placeholder="{name}-{index}-{id}"
        />
        <template #feedback>
          支持变量: {name}角色名, {id}角色ID, {index}角色序号, {server}区服
        </template>
      </NFormItem>
    </NForm>

    <!-- 服务器角色列表 -->
    <ServerRoleList
      :data="serverListData"
      server-column-title="区服ID"
      max-height="50vh"
      @add="addSelectedRole"
      @download="handleDownload"
    />

    <n-list bordered>
      <n-list-item v-for="(role, roleIndex) in roleList" :key="roleIndex">
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
          "
        >
          <div>
            <strong>角色名称:</strong> {{ role.name || "未命名角色" }}<br />
            <strong>Token:</strong>
            <span style="word-break: break-all">{{ role.token }}</span
            ><br />
            <strong>服务器:</strong> {{ role.server || "未指定" }}<br />
            <strong>角色序号:</strong> {{ role.roleIndex }}
          </div>
          <NButton type="error" size="small" @click="removeRole(roleIndex)">
            删除
          </NButton>
        </div>
      </n-list-item>
    </n-list>

    <!-- 操作按钮 -->
    <div class="form-actions">
      <NButton
        type="primary"
        size="large"
        block
        :loading="isImporting"
        @click="handleImport"
      >
        <template #icon>
          <NIcon>
            <CloudUpload />
          </NIcon>
        </template>
        添加Token
      </NButton>

      <NButton block @click="$emit('cancel')" :disabled="isProcessing">
        <template #icon>
          <NIcon>
            <Close />
          </NIcon>
        </template>
        取消
      </NButton>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Close, CloudUpload, Refresh, Scan } from "@vicons/ionicons5";
import {
  NButton,
  NCheckbox,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  useMessage,
} from "naive-ui";
import { onMounted, onUnmounted, reactive, ref } from "vue";
import useIndexedDB from "@/hooks/useIndexedDB";
import { useTokenStore } from "@/stores/tokenStore";
import {
  buildRoleBin,
  downloadBinFile,
  getRoleBinFileName,
} from "@/utils/binFile";
import { g_utils } from "@/utils/bonProtocol";
import { encodeHortorLoginPayload } from "@/utils/hortorMobileLogin";
import { getServerList, getTokenId, transformToken } from "@/utils/token";
import { encodeCombUserBin } from "@/utils/xyzwRuntime";
// 定义事件
const emit = defineEmits(["cancel", "ok"]);
const tokenStore = useTokenStore();
const { storeArrayBuffer } = useIndexedDB();

const message = useMessage();
const isImporting = ref(false);
const importForm = reactive({
  name: "",
  server: "",
  wsUrl: "",
  nameTemplate: "{name}-{index}-{id}",
});

const removeRole = (index: number) => {
  roleList.value.splice(index, 1);
};

// 响应式数据
const qrcodeUrl = ref<string | null>(null);
const qrcodeUUID = ref<string | null>(null);
const isProcessing = ref(false);
const statusMessage = ref("点击获取微信登录二维码");
const statusType = ref("info");
const isScanning = ref(false);
const scanInterval = ref<any>(null);
const timeout = 120000; // 120秒超时
const startTime = ref<number | null>(null);

const serverListData = ref<any[]>([]);
const currentBinData = ref<ArrayBuffer | null>(null);
const binDecodedResult = ref("");
const originalBinData = ref<any>(null);
const roleList = ref<
  Array<{
    id: string;
    name: string;
    roleId: string;
    token: string;
    server: string;
    roleIndex?: number;
    wsUrl: string;
    importMethod: string;
    serverId?: string | number;
    combUser?: any;
  }>
>([]);
const currentCombUser = ref<any>(null);
const saveCombUser = ref(false);

const handleDownload = (roleInfo: any) => {
  if (!originalBinData.value) {
    message.error("Bin数据丢失，请重新扫码");
    return;
  }
  try {
    const newBinBuffer = buildRoleBin(originalBinData.value, roleInfo.serverId);
    const fileName = getRoleBinFileName(roleInfo);
    downloadBinFile(fileName, newBinBuffer);
    message.success(`已开始下载: ${fileName}`);
  } catch (e: any) {
    console.error("下载失败", e);
    message.error(`下载失败: ${e.message}`);
  }
};

const addSelectedRole = async (roleInfo: any) => {
  if (!originalBinData.value) {
    message.error("Bin数据丢失，请重新上传");
    return;
  }

  try {
    const newBinBuffer = buildRoleBin(originalBinData.value, roleInfo.serverId);
    const tokenId = getTokenId(newBinBuffer);
    const roleToken = await transformToken(newBinBuffer);
    const roleName = roleInfo.name || `角色_${roleInfo.roleId}`;

    // 刷新indexDB数据库token数据 (保存原始bin)
    if (!saveCombUser.value) {
      await storeArrayBuffer(tokenId, newBinBuffer);
    }

    let sid = Number(roleInfo.serverId);
    let roleIndex = 0;
    if (sid >= 2000000) {
      roleIndex = 2;
      sid -= 2000000;
    } else if (sid >= 1000000) {
      roleIndex = 1;
      sid -= 1000000;
    }
    const serverNum = sid - 27;

    const template = importForm.nameTemplate || "{name}-{index}-{id}";
    const finalName = template
      .replace(/\{name\}/g, () => roleName)
      .replace(/\{index\}/g, () => String(roleIndex))
      .replace(/\{id\}/g, () => String(roleInfo.roleId))
      .replace(/\{server\}/g, () => `${String(serverNum)}服`);

    // 检查是否已存在相同配置 (根据角色名称和roleId)
    const exists = roleList.value.some(
      (r) => r.roleId === roleInfo.roleId && r.name === finalName,
    );

    if (exists) {
      message.warning(`角色 ${finalName} 已在待添加列表中`);
      return;
    }

    roleList.value.push({
      id: tokenId,
      roleId: roleInfo.roleId,
      token: roleToken,
      name: finalName,
      server: `${String(serverNum)}服`,
      roleIndex,
      wsUrl: importForm.wsUrl || "",
      importMethod: "wxQrcode",
      serverId: roleInfo.serverId,
      ...(saveCombUser.value ? { combUser: currentCombUser.value } : {}),
    });

    message.success(`已添加角色: ${finalName}`);
  } catch (e: any) {
    console.error("添加角色失败", e);
    message.error(`添加角色失败: ${e.message}`);
  }
};

/**
 * 生成微信登录二维码
 */
const generateQRCode = async () => {
  try {
    isProcessing.value = true;
    updateStatus("正在获取二维码...", "info");

    // 重置状态
    resetQRCode();

    // 调用获取二维码接口
    const success = await tryGetWeixinQR();

    if (!success) {
      throw new Error("二维码获取失败");
    }
  } catch (error) {
    updateStatus(`二维码获取失败：${error.message}`, "error");
    console.error("获取二维码失败:", error);
  } finally {
    isProcessing.value = false;
  }
};

/**
 * 尝试获取微信二维码
 */
const tryGetWeixinQR = async () => {
  try {
    const qrPageUrl =
      "/api/weixin/connect/app/qrconnect" +
      "?appid=wxfb0d5667e5cb1c44" +
      "&bundleid=com.hortor.games.xyzw" +
      "&scope=snsapi_base,snsapi_userinfo,snsapi_friend,snsapi_message" +
      "&state=weixin";

    const response = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", qrPageUrl, true);
      xhr.timeout = 15000;
      xhr.setRequestHeader("Accept", "text/html");
      xhr.onload = () => resolve(xhr);
      xhr.onerror = () => reject(new Error("网络错误"));
      xhr.ontimeout = () => reject(new Error("请求超时"));
      xhr.send();
    });

    if (response.status !== 200) {
      throw new Error(`HTTP 状态码：${response.status}`);
    }

    const html = response.responseText;
    const doc = new DOMParser().parseFromString(html, "text/html");

    let qrUrl = doc.querySelector("img.auth_qrcode")?.src;

    if (!qrUrl) {
      const m = html.match(/https:\/\/[^"']*qrcode[^"']*/i);
      if (m) qrUrl = m[0];
    }

    if (!qrUrl) {
      throw new Error("未找到二维码图片地址");
    }

    // 解析 uuid
    qrcodeUUID.value = qrUrl.split("/").pop().split("?")[0];
    qrcodeUrl.value = qrUrl;

    // 更新状态
    updateStatus("请使用微信扫码登录", "success");

    // 开始轮询扫码状态
    startScanMonitoring();
    return true;
  } catch (err) {
    console.error("二维码解析失败:", err);
    updateStatus(`二维码获取失败：${err.message}`, "error");
    return false;
  }
};

/**
 * 开始轮询扫码状态
 */
const startScanMonitoring = () => {
  if (isScanning.value) return;

  isScanning.value = true;
  startTime.value = Date.now();

  scanInterval.value = setInterval(() => {
    checkScanStatus();
  }, 1000);
};

/**
 * 检查扫码状态
 */
const checkScanStatus = async () => {
  try {
    if (!qrcodeUUID.value) return;

    const elapsed = Date.now() - startTime.value;
    if (elapsed > timeout) {
      updateStatus("二维码已超时，请重新获取", "error");
      stopScanMonitoring();
      resetQRCode();
      return;
    }

    // 使用微信官方推荐的扫码状态轮询路径
    const url = `/api/weixin/connect/l/qrconnect?uuid=${
      qrcodeUUID.value
    }&f=url&_=${Date.now()}`;

    const res = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.timeout = 5000;
      xhr.setRequestHeader("Accept", "*/*");
      xhr.onload = () => resolve(xhr);
      xhr.onerror = () => resolve({ status: 0 });
      xhr.ontimeout = () => resolve({ status: 0 });
      xhr.send();
    });

    if (res.status === 200) {
      const text = res.responseText;

      // 405 → 扫码确认
      if (text.includes("window.wx_errcode=405")) {
        // 提取code
        const codeMatch = text.match(
          /wx_redirecturl='[^']*code=([a-zA-Z0-9]+)/,
        );
        // 提取nickname
        const nicknameMatch = text.match(
          /window\.wx_nickname\s*=\s*['"]([^'"]+)['"]/,
        );

        if (codeMatch) {
          const code = codeMatch[1];
          const nickname = nicknameMatch ? nicknameMatch[1] : "";

          stopScanMonitoring();
          updateStatus(
            `扫码成功，正在登录... 用户：${nickname || "未知用户"}`,
            "success",
          );
          await handleScanSuccess(code, nickname);
          return;
        }
      }

      // 408 → 已过期
      if (text.includes("window.wx_errcode=408")) {
        updateStatus("二维码已过期，请重新生成", "error");
        stopScanMonitoring();
        resetQRCode();
        return;
      }
    }

    // 每30秒提醒一次
    const remain = Math.ceil((timeout - elapsed) / 1000);
    if (remain % 30 === 0) {
      updateStatus(`请扫码，剩余 ${remain} 秒`, "info");
    }
  } catch (err) {
    console.error("扫码状态检查失败:", err);
  }
};

/**
 * 停止扫码监控
 */
const stopScanMonitoring = () => {
  isScanning.value = false;
  if (scanInterval.value) {
    clearInterval(scanInterval.value);
    scanInterval.value = null;
  }
};

/**
 * 处理扫码成功
 */
const handleScanSuccess = async (code: string, nickname = "") => {
  try {
    isProcessing.value = true;

    // 获取加密数据
    const encrypted = await getEncryptedData(code);
    if (encrypted) {
      await saveAccount(encrypted.buffer, nickname);
    }
  } catch (err: any) {
    updateStatus(`处理失败：${err.message}`, "error");
    console.error("扫码处理失败:", err);
  } finally {
    isProcessing.value = false;
  }
};

/**
 * 请求Hortor登录接口，并用encodePayload加密
 */
const getEncryptedData = async (code) => {
  const payload = {
    gameId: "xyzwapp",
    code,
    gameTp: "app",
    sysInfo:
      '{"system":"Android","hortorSDKVersion":"4.0.6-cn","model":"22081212C","brand":"Redmi"}',
    channel: "android",
    appFrom: "com.tencent.mm",
    noLogin: "2",
    distinctId: "DID-a38175b7-14ce-4b36-aa89-3e092ea03ea6",
    state: "hortor",
    packageName: "com.hortor.games.xyzw",
    tp: "app-we",
    signPrint: "E6:F7:FE:A9:EC:8E:24:D0:4F:2A:32:50:28:78:E1:C5:5E:70:81:13",
  };

  // 调用encodeHortorLoginPayload加密
  const encoded = encodeHortorLoginPayload(payload);

  const loginUrl =
    `/api/hortor/comb-login-server/api/v1/login` +
    `?gameId=xyzwapp` +
    `&timestamp=${Date.now()}&version=android-4.2.1-cn-release` +
    `&cryptVersion=1.1.0` +
    `&gameTp=app&system=android` +
    `&deviceUniqueId=DID-0e782e88-2f3b-4f5b-9020-47f5e5a5a026` +
    `&packageName=com.hortorgames.xyzw`;

  const res = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", loginUrl, true);
    xhr.timeout = 15000;
    xhr.setRequestHeader("Accept", "*/*");
    xhr.setRequestHeader("Content-Type", "text/plain; charset=utf-8");
    xhr.onload = () => resolve(xhr);
    xhr.onerror = () => reject(new Error("登录失败"));
    xhr.ontimeout = () => reject(new Error("登录超时"));
    xhr.send(encoded);
  });

  if (res.status !== 200) {
    throw new Error(`HTTP 状态码：${res.status}`);
  }

  const json = JSON.parse(res.responseText);
  if (json.meta?.errCode !== 0) {
    throw new Error(`登录失败：${json.meta?.errMsg}`);
  }

  const combUser = json.data?.combUser;
  if (!combUser) {
    throw new Error("登录响应结构异常");
  }
  currentCombUser.value = combUser;

  // 懒加载游戏加密模块并生成登录 bin
  return new Uint8Array(await encodeCombUserBin(combUser));
};

/**
 * 保存账号
 */
const saveAccount = async (arrBuf: ArrayBuffer) => {
  const bin = new Uint8Array(arrBuf);
  // console.log("bin:", bin);
  currentBinData.value = bin.buffer;

  try {
    const listStr = await getServerList(bin.buffer);
    const parsedList = JSON.parse(listStr);
    // 转换为数组并排序
    if (parsedList && typeof parsedList === "object") {
      serverListData.value = Object.values(parsedList).sort(
        (a: any, b: any) => b.power - a.power,
      );
    } else {
      serverListData.value = [];
    }
    message.success("获取服务器角色列表成功，请选择角色添加");
  } catch (err) {
    console.error("Failed to get server list", err);
    message.warning("获取服务器角色列表失败");
    serverListData.value = [];
  }
  // 尝试解析 bin 文件内容
  try {
    const binMsg = g_utils.parse(bin.buffer);
    let binData = binMsg.getData();
    if (!binData && (binMsg as any)._raw) {
      console.log("Bin文件 getData() 为空，尝试使用 _raw");
      binData = { ...(binMsg as any)._raw };
    }

    binDecodedResult.value = JSON.stringify(binData, null, 2);
    originalBinData.value = binData;
  } catch (err: any) {
    console.error("Bin文件解析失败", err);
    binDecodedResult.value = `Bin文件解析失败: ${err.message || err}`;
  }
};

const handleImport = async () => {
  if (roleList.value.length === 0) {
    message.error("请先上传bin文件！");
    return;
  }
  roleList.value.forEach((role) => {
    // tokenStore.gameTokens中发现已存在的重复名称，则移出token后重新添加
    const gameToken = tokenStore.gameTokens.find((t) => t.id === role.id);
    if (gameToken) {
      // tokenStore.removeToken(gameToken.id);
      tokenStore.updateToken(gameToken.id, {
        ...role,
      });
    } else {
      tokenStore.addToken({
        ...role,
      });
    }
  });
  message.success("Token添加成功");
  roleList.value = [];
  emit("ok");
};

/**
 * 更新状态信息
 */
const updateStatus = (message, type = "info") => {
  statusMessage.value = message;
  statusType.value = type;
};

/**
 * 重置二维码状态
 */
const resetQRCode = () => {
  stopScanMonitoring();
  qrcodeUUID.value = null;
  qrcodeUrl.value = null;
  updateStatus("点击获取微信登录二维码", "info");
};

// 生命周期
onMounted(() => {
  // 组件挂载时的初始化逻辑
});

onUnmounted(() => {
  // 组件卸载时清理资源
  stopScanMonitoring();
});
</script>

<style scoped lang="scss">
.wx-qrcode-import {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  padding: var(--spacing-lg) 0;
}

.login-flow-info {
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-medium);
  padding: var(--spacing-md);

  h3 {
    margin: 0 0 var(--spacing-sm) 0;
    color: var(--text-primary);
    font-size: var(--font-size-md);
  }

  .flow-steps {
    margin: 0;
    padding-left: var(--spacing-lg);
    color: var(--text-secondary);

    li {
      margin-bottom: var(--spacing-xs);
      font-size: var(--font-size-sm);
    }
  }
}

.qrcode-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-xl) 0;
}

.qr-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 200px;
  height: 200px;
  border: 2px dashed var(--border-light);
  border-radius: var(--border-radius-medium);
  cursor: pointer;
  transition: all var(--transition-normal);
  background: var(--bg-tertiary);

  &:hover {
    border-color: var(--primary-color);
    background: rgba(102, 126, 234, 0.05);
  }

  p {
    margin: var(--spacing-sm) 0 0 0;
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }
}

.qr-image {
  width: 200px;
  height: 200px;
  border: 2px solid var(--border-light);
  border-radius: var(--border-radius-medium);
  cursor: pointer;
  transition: all var(--transition-normal);

  &:hover {
    border-color: var(--primary-color);
    box-shadow: var(--shadow-small);
  }
}

.qr-status {
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  text-align: center;
  padding: var(--spacing-xs) var(--spacing-md);
  border-radius: var(--border-radius-small);

  &.info {
    color: var(--text-secondary);
    background: var(--bg-tertiary);
  }

  &.success {
    color: var(--success-color);
    background: rgba(16, 185, 129, 0.1);
  }

  &.error {
    color: var(--error-color);
    background: rgba(239, 68, 68, 0.1);
  }
}

.account-name-input {
  margin-top: var(--spacing-md);
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  margin-top: var(--spacing-xl);
}
</style>

<route lang="json">
{
  "name": "/TokenImport/wxqrcode",
  "path": "/TokenImport/wxqrcode"
}
</route>
