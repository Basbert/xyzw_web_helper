import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import { initTheme } from "./composables/useTheme";
import router from "./router";
import "virtual:uno.css";
import "./assets/styles/variables.scss";
import "./assets/styles/global.scss";

// 创建应用实例
const app = createApp(App);

// 使用插件
app.use(createPinia());
app.use(router);

initTheme();

// 挂载应用
app.mount("#app");
