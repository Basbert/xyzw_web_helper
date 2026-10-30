import { parseTenHallBattleResult } from "./tenHallBattleResult.js";

const FREE_ROOM = 0;
const TEN_HALL_ROOM = 201;
const REQUEST_TIMEOUT = 15000;
const QUEUE_TIMEOUT = 180000;
const FIGHT_TIMEOUT = 45000;

function abortError() {
  const error = new Error("模拟已取消");
  error.name = "AbortError";
  return error;
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

/** Match the game's normal free-room settings for a single hall. */
export function makeTenHallRoomRequest(roleName, hall, notifyCreate = false) {
  if (typeof roleName !== "string" || !roleName.trim()) {
    throw new Error("无法读取角色名称");
  }
  if (!Number.isInteger(hall) || hall < 1 || hall > 8) {
    throw new Error("请选择第一至第八殿");
  }
  return {
    roomName: `${roleName}的队伍`,
    roomType: FREE_ROOM,
    notifyCreate,
    password: "",
    roomRule: {
      roleNum: TEN_HALL_ROOM,
      teamRoleCnt: 0,
      battleRound: 0,
      clientRoleNum: 0,
      bagStrength: 0,
      cMModel: 0,
      heroNum: 5,
      heroCountry: [1, 2, 3, 4],
      powerMinLimit: 0,
      powerMaxLimit: -1,
      inningsNum: 1,
      needWinInnings: 0,
      quenchMinLimit: 0,
      quenchMaxLimit: 0,
      chatVipLevel: 0,
      groupType: 0,
      nM: hall,
      requiredHeroIds: [],
      forbiddenHeroIds: [],
      forbiddenPearlSkillIds: [],
      vipMinLimit: 0,
      vipMaxLimit: 0,
      hiddenBattleTeam: false,
      needPassword: false,
      allowWatch: false,
      seatLocked: false,
    },
  };
}

/** Take a snapshot of the current main-line formation for the room. */
export function makeTenHallTeam(role, roomId) {
  const battleTeam = new Map();
  const heroLevel = new Map();
  const newHeroArtifact = new Map();
  const heroIds = new Set();
  for (const [key, member] of Object.entries(role?.battleTeam || {})) {
    const slot = Number(key);
    const id = Number(member?.heroId ?? member);
    const hero = role?.heroes?.[id];
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot > 4 ||
      !Number.isInteger(id) ||
      id <= 0 ||
      heroIds.has(id) ||
      !Number.isFinite(Number(hero?.level)) ||
      Number(hero.level) <= 0
    ) {
      throw new Error("当前阵容信息不完整，请刷新角色后重试");
    }
    heroIds.add(id);
    battleTeam.set(slot, id);
    heroLevel.set(slot, Number(hero.level));
    newHeroArtifact.set(slot, {
      artifactId: Number(hero.artifactId) || 0,
      pearlId: Number(hero.pearlId) || 0,
    });
  }
  if (!battleTeam.size) throw new Error("当前阵容为空，请先在游戏中布阵");
  return {
    roomId,
    lordWeaponId: Number(role.lordWeaponId) || 0,
    petUId: role.pet?.petUId || "",
    battleTeam,
    heroLevel,
    newHeroArtifact,
  };
}

function isOwnedSimulationRoom(room, roleId, hall) {
  return (
    !!room?.roomId &&
    (room.roomType ?? FREE_ROOM) === FREE_ROOM &&
    String(room.leaderId) === String(roleId) &&
    room.rule?.clientRoleNum === TEN_HALL_ROOM &&
    room.rule?.nM === hall &&
    room.rule?.roleNum === 2
  );
}

/** Capture pushes before a request is sent, including pushes arriving before its response. */
function createMailbox(client, onQueue) {
  const events = [];
  const waiters = new Set();
  const unsubscribe = client.subscribeMessages((packet) => {
    const command = packet?.cmd?.toLowerCase();
    if (
      ![
        "pkroom_queuenotify",
        "pkroom_queuecreatenotify",
        "pkroom_fightnotify",
      ].includes(command) ||
      packet.code
    ) {
      return;
    }
    const body = packet.rawData ?? packet.decodedBody ?? packet.body;
    const event = { command, body };
    if (command === "pkroom_queuenotify" && (body?.roomType ?? 0) === 0) {
      onQueue(body);
    }
    const waiter = [...waiters].find((item) => item.predicate(event));
    if (waiter) waiter.resolve(event);
    else {
      events.push(event);
      if (events.length > 100) events.shift();
    }
  });

  const take = (predicate) => {
    const index = events.findIndex(predicate);
    return index < 0 ? null : events.splice(index, 1)[0];
  };
  const wait = (predicate, timeout, signal) => {
    checkAbort(signal);
    const existing = take(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      let timer;
      const waiter = {
        predicate,
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
      };
      const onAbort = () => {
        cleanup();
        reject(abortError());
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        waiters.delete(waiter);
      };
      timer = setTimeout(() => {
        cleanup();
        reject(new Error("等待游戏服务器响应超时"));
      }, timeout);
      waiters.add(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  };
  return {
    take,
    wait,
    clear: (command) => {
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].command === command) events.splice(i, 1);
      }
    },
    close: unsubscribe,
  };
}

/** Run one actual game simulation in a normal free room. */
export async function runTenHallSimulation({
  tokenStore,
  tokenId,
  hall,
  signal,
  onProgress = () => {},
}) {
  const client = tokenStore.getWebSocketClient(tokenId);
  const assertConnection = () => {
    checkAbort(signal);
    if (
      !client ||
      tokenStore.selectedToken?.id !== tokenId ||
      tokenStore.getWebSocketClient(tokenId) !== client ||
      tokenStore.getWebSocketStatus(tokenId) !== "connected"
    ) {
      throw new Error("角色已切换或连接已断开，请重新连接后重试");
    }
  };
  assertConnection();
  if (typeof client.subscribeMessages !== "function") {
    throw new TypeError("当前连接不支持模拟，请重新连接后重试");
  }
  let roomId = "";
  let roleId = null;
  let queued = false;
  let completed = false;
  const mailbox = createMailbox(client, (info) => {
    queued = true;
    onProgress(
      `免费房间排队中（${info.queueIndex ?? "?"}/${info.queueNum ?? "?"}）`,
    );
  });
  const send = async (cmd, params = {}) => {
    assertConnection();
    return tokenStore.sendMessageWithPromise(
      tokenId,
      cmd,
      params,
      REQUEST_TIMEOUT,
    );
  };
  try {
    onProgress("正在读取当前阵容");
    const response = await send("role_getroleinfo");
    const role = response?.role;
    roleId = role?.roleId;
    if (!roleId) throw new Error("无法读取当前角色信息");
    // Validate the team before creating any room.
    makeTenHallTeam(role, "");
    const roomRequest = makeTenHallRoomRequest(role.name, hall);
    onProgress("正在创建免费模拟房");
    let created;
    let createError;
    try {
      created = await send("pkroom_create", roomRequest);
    } catch (error) {
      createError = error;
    }
    roomId = created?.roomInfo?.roomId || "";
    checkAbort(signal);
    if (!created?.roomInfo?.roomId) {
      const queueEvent = mailbox.take(
        (event) =>
          event.command === "pkroom_queuenotify" &&
          (event.body?.roomType ?? 0) === 0,
      );
      if (!queued && !queueEvent) {
        if (createError?.message?.includes("7300008")) {
          throw new Error(
            "游戏未能创建免费房间（错误 7300008），请检查免费房间的开放时间后重试",
          );
        }
        throw createError || new Error("游戏未返回模拟房间信息");
      }
      queued = true;
      onProgress("免费房间排队中");
      await mailbox.wait(
        (event) =>
          event.command === "pkroom_queuecreatenotify" &&
          (event.body?.roomType ?? 0) === 0,
        QUEUE_TIMEOUT,
        signal,
      );
      created = await send("pkroom_create", {
        ...roomRequest,
        notifyCreate: true,
      });
      queued = false;
    }
    roomId = created?.roomInfo?.roomId || "";
    if (roomId) queued = false;
    if (!isOwnedSimulationRoom(created?.roomInfo, roleId, hall)) {
      throw new Error("服务器返回的房间与免费模拟设置不一致");
    }
    checkAbort(signal);
    const team = makeTenHallTeam(role, roomId);
    onProgress("正在设置当前阵容");
    await send("pkroom_calcteam", team);
    const afterCalc = (await send("pkroom_getroominfo", { roomId }))?.roomInfo;
    if (!isOwnedSimulationRoom(afterCalc, roleId, hall)) {
      throw new Error("无法确认模拟房间状态");
    }
    await send("pkroom_setpkteam", team);
    let current = (await send("pkroom_getroominfo", { roomId }))?.roomInfo;
    if (!isOwnedSimulationRoom(current, roleId, hall)) {
      throw new Error("无法确认模拟房间状态");
    }
    let ownFighter = current.fightRoleBase?.find(
      (fighter) => String(fighter.roleId) === String(roleId),
    );
    if (!ownFighter) throw new Error("角色未进入模拟房间");
    if ((ownFighter.state ?? 0) === 0) {
      await send("pkroom_setready", { roomId });
      current = (await send("pkroom_getroominfo", { roomId }))?.roomInfo;
      if (!isOwnedSimulationRoom(current, roleId, hall)) {
        throw new Error("无法确认模拟房间状态");
      }
      ownFighter = current.fightRoleBase?.find(
        (fighter) => String(fighter.roleId) === String(roleId),
      );
    }
    if (
      !ownFighter ||
      current.fightRoleBase?.length !== 2 ||
      current.fightRoleBase.some((fighter) => (fighter.state ?? 0) !== 1)
    ) {
      throw new Error("模拟房间尚未准备好，请稍后重试");
    }
    const version = tokenStore.gameData?.battleVersion;
    if (!version) throw new Error("战斗版本未加载，请重新连接后重试");
    mailbox.clear("pkroom_fightnotify");
    onProgress("正在模拟战斗");
    await send("pkroom_startbattle", { roomId, battleVersion: version });
    const fight = await mailbox.wait(
      (event) => {
        const data = event.body?.battleData;
        const returnedRoomId = event.body?.roomInfo?.roomId;
        const sponsorId =
          data?.result?.sponsor?.roleId || data?.leftTeam?.roleId;
        const acceptId =
          data?.result?.accept?.roleId || data?.rightTeam?.roleId;
        return (
          event.command === "pkroom_fightnotify" &&
          (!returnedRoomId || String(returnedRoomId) === String(roomId)) &&
          (String(sponsorId) === String(roleId) ||
            String(acceptId) === String(roleId)) &&
          !!data?.result
        );
      },
      FIGHT_TIMEOUT,
      signal,
    );
    const result = parseTenHallBattleResult(
      fight.body.battleData,
      roleId,
      fight.body.winRid,
    );
    if (result.ownSide === null) {
      throw new Error("已收到战报，但无法识别当前角色的阵营");
    }
    completed = true;
    return { hall, ...result };
  } finally {
    mailbox.close();
    const canClean =
      client &&
      tokenStore.getWebSocketClient(tokenId) === client &&
      tokenStore.getWebSocketStatus(tokenId) === "connected";
    if (canClean && queued) {
      try {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "pkroom_cancelqueue",
          { roomType: FREE_ROOM },
          REQUEST_TIMEOUT,
        );
      } catch {
        // The queue may have ended or expired while the connection was closing.
      }
    }
    if (canClean && roomId && !completed) {
      try {
        const current = await tokenStore.sendMessageWithPromise(
          tokenId,
          "pkroom_getroominfo",
          { roomId },
          REQUEST_TIMEOUT,
        );
        if (isOwnedSimulationRoom(current?.roomInfo, roleId, hall)) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "pkroom_dismiss",
            { roomId },
            REQUEST_TIMEOUT,
          );
        }
      } catch {
        // Normal rooms can already be closed by the game after the battle.
      }
    }
  }
}
