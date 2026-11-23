import { shallowReactive } from "vue";

// 已发出的助威可能在离开逐鹿页面后才回包，重新进入时仍须等待该账号的请求结束。
export const inFlightVoteOps = shallowReactive(new Map());
