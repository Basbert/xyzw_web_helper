<template>
  <div class="default-layout">
    <!-- 顶部导航 -->
    <nav class="dashboard-nav">
      <div class="nav-container">
        <div class="nav-brand">
          <img src="/icons/xiaoyugan.png" alt="XYZW" class="brand-logo" />
          <button
            type="button"
            class="brand-toggle"
            aria-label="打开导航菜单"
            @click="isMobileMenuOpen = true"
          >
            <n-icon>
              <Menu />
            </n-icon>
            <span class="brand-text">XYZW 控制台</span>
          </button>
        </div>

        <div class="nav-menu">
          <router-link
            v-for="item in primaryNavigation"
            :key="item.to"
            :to="item.to"
            class="nav-item"
            active-class="active"
          >
            <n-icon><component :is="item.icon" /></n-icon>
            <span>{{ item.label }}</span>
          </router-link>
          <n-dropdown
            trigger="click"
            :options="getSecondaryNavigation().map((item) => ({ label: item.label, key: item.to }))"
            @select="router.push"
          >
            <button type="button" class="nav-item nav-more">更多功能</button>
          </n-dropdown>
        </div>

        <div class="nav-user">
          <!-- 主题切换按钮 -->
          <ThemeToggle />

          <n-dropdown :options="userMenuOptions" @select="handleUserAction">
            <div
              class="user-info"
              role="button"
              tabindex="0"
              aria-label="打开账号菜单"
              @keydown.enter.prevent="$event.currentTarget.click()"
              @keydown.space.prevent="$event.currentTarget.click()"
            >
              <n-avatar
                :src="selectedToken?.avatar || '/icons/xiaoyugan.png'"
                size="medium"
                fallback-src="/icons/xiaoyugan.png"
              />
              <span class="username">{{
                selectedToken?.name || "未选择Token"
              }}</span>
              <n-icon>
                <ChevronDown />
              </n-icon>
            </div>
          </n-dropdown>
        </div>
      </div>
    </nav>
    <n-drawer
      v-model:show="isMobileMenuOpen"
      placement="left"
      style="width: 260px"
    >
      <div class="drawer-menu">
        <router-link
          v-for="item in [...primaryNavigation, ...getSecondaryNavigation()]"
          :key="item.to"
          :to="item.to"
          class="drawer-item"
          @click="isMobileMenuOpen = false"
        >
          <n-icon><component :is="item.icon" /></n-icon>
          <span>{{ item.label }}</span>
        </router-link>
      </div>
    </n-drawer>
    <div class="main">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import {
  ArrowUpCircle,
  ChatbubbleEllipsesSharp,
  ChevronDown,
  Cube,
  Home,
  Layers,
  LockOpen,
  Menu,
  PersonCircle,
  Settings,
} from "@vicons/ionicons5";
import { useDialog, useMessage } from "naive-ui";
import { ref } from "vue";

import { useRouter } from "vue-router";
import ThemeToggle from "@/components/Common/ThemeToggle.vue";
import { selectedToken, useTokenStore } from "@/stores/tokenStore";
import { isNowInLegionWarTime } from "@/utils/clubBattleUtils";

const tokenStore = useTokenStore();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();

const isMobileMenuOpen = ref(false);

const primaryNavigation = [
  { to: "/admin/dashboard", label: "首页", icon: Home },
  { to: "/admin/game-features", label: "游戏功能", icon: Cube },
  { to: "/admin/batch-daily-tasks", label: "批量日常", icon: Layers },
  { to: "/tokens", label: "账号管理", icon: PersonCircle },
  { to: "/admin/PushingLevels", label: "主线推关", icon: ArrowUpCircle },
];
const secondaryNavigation = [
  { to: "/admin/message-test", label: "消息测试", icon: ChatbubbleEllipsesSharp },
  { to: "/admin/legion-war", label: "实时盐场", icon: LockOpen, warOnly: true },
  { to: "/admin/profile", label: "个人设置", icon: Settings },
];
const getSecondaryNavigation = () =>
  secondaryNavigation.filter((item) => !item.warOnly || isNowInLegionWarTime());

const userMenuOptions = [
  {
    label: "清除所有Token并退出",
    key: "logout",
  },
];

// 方法
const handleUserAction = (key) => {
  switch (key) {
    case "logout":
      dialog.warning({
        title: "清除所有Token并退出",
        content:
          "这会清除当前浏览器中保存的所有账号和BIN数据，之后需要重新导入。确定继续吗？",
        positiveText: "确定清除",
        negativeText: "取消",
        onPositiveClick: async () => {
          await tokenStore.clearAllTokens();
          message.success("已清除所有Token");
          router.push("/tokens");
        },
      });
      break;
  }
};
</script>

<style scoped lang="scss">
// 导航栏
.dashboard-nav {
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-light);
  padding: 0 var(--spacing-lg);
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
}

.nav-container {
  display: flex;
  align-items: center;
  height: 64px;
  max-width: 1400px;
  margin: 0 auto;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin-right: var(--spacing-xl);
}

.brand-logo {
  width: 40px;
  height: 40px;
  border-radius: var(--border-radius-small);
}

.brand-text {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.brand-toggle {
  display: none;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  cursor: pointer;
  font-size: var(--font-size-lg);
}

.brand-toggle .n-icon {
  font-size: inherit;
}

.nav-menu {
  display: flex;
  gap: var(--spacing-md);
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--border-radius-medium);
  color: var(--text-secondary);
  text-decoration: none;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  &.active {
    background: var(--primary-color-light);
    color: var(--primary-color);
  }
}

.nav-more {
  border: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

:global(html[data-theme="dark"] .dashboard-nav .nav-item.active),
:global(html[data-theme="dark"] .drawer-menu .drawer-item.router-link-active) {
  background: #3c466b;
  color: #ffffff;
}

.brand-toggle:focus-visible,
.nav-more:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 3px;
}

.nav-user {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  min-width: 0;
}

.user-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border-radius: var(--border-radius-medium);
  cursor: pointer;
  transition: background var(--transition-fast);
  min-width: 0;

  &:hover {
    background: var(--bg-tertiary);
  }
}

.username {
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1100px) {
  .nav-user {
    gap: 4px;
  }
  .username {
    max-width: 24vw;
  }
  .nav-item span {
    display: none;
  }

  .nav-menu {
    display: none;
  }

  .nav-item {
    padding: var(--spacing-sm);
    flex: 0 0 auto;
  }

  .nav-container {
    height: 56px;
  }

  .brand-logo {
    display: none;
  }

  .brand-toggle {
    display: inline-flex;
  }
}

.drawer-menu {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
}

.drawer-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--border-radius-medium);
  color: var(--text-secondary);
  text-decoration: none;
}

.drawer-item.router-link-active {
  background: var(--primary-color-light);
  color: var(--primary-color);
}

/* 禁用样式：灰化、鼠标禁止、无hover效果 */
.nav-item.disabled {
  background: #cccccc;
  color: #999999;
  cursor: not-allowed; /* 鼠标样式：禁止 */
  pointer-events: none; /* 可选：直接禁用所有鼠标事件（比阻止click更彻底） */
}
</style>
