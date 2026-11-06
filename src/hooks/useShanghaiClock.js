import { onMounted, onUnmounted, ref } from "vue";

/** Use the same clock for the dashboard date and activity reminders. */
export function useShanghaiClock() {
  const now = ref(Date.now());
  let timer;
  const update = () => {
    now.value = Date.now();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") update();
  };
  onMounted(() => {
    update();
    document.addEventListener("visibilitychange", onVisible);
    timer = window.setInterval(update, 60000);
  });
  onUnmounted(() => {
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  });
  return now;
}

export function formatShanghaiDate(nowMs) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(nowMs));
}
