import type { EVM, XyzwSession } from ".";
import { useLocalStorage } from "@vueuse/core";
import { gameLogger } from "@/utils/logger";

export const chatMsgList = useLocalStorage<Array<any>>(
  "xyzw_chat_msg_list",
  [],
  {
    flush: "sync",
  },
);

export const clearChatMessages = () => {
  chatMsgList.value.splice(0);
  chatMsgList.value = [];
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem?.("xyzw_chat_msg_list");
  }
};

// 处理聊天消息事件，保存最新的聊天记录
export const ChatPlugin = ({ onSome, $emit }: EVM) => {
  $emit?.on?.("chat:clear", clearChatMessages);
  onSome(
    ["system_newchatmessagenotify", "system_newchatmessagenotifyresp"],
    (data: XyzwSession) => {
      if (!data.isSelectedAccount) return;
      gameLogger.info(`收到新聊天消息事件: ${data.tokenId}`, data);
      const { body } = data;
      if (!body || !body.chatMessage) {
        gameLogger.debug("聊天消息响应为空或格式不正确");
        return;
      }
      chatMsgList.value.push(body.chatMessage);
      while (chatMsgList.value.length > 100) {
        chatMsgList.value.shift();
      }
    },
  );
};
