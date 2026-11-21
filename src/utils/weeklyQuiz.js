import {
  getAccountClient,
  trackAccountConnection,
} from "./accountConnection.js";

// QuizModule uses the standard activity (actId 1) and weekly reward tiers.
const STANDARD_QUIZ_ID = 1;
const WEEKLY_PERIOD = 2;
const CHINA_OFFSET_SECONDS = 8 * 3600;
const DAY_SECONDS = 86400;

const shanghaiDay = (seconds) =>
  Math.floor((seconds + CHINA_OFFSET_SECONDS) / DAY_SECONDS);
const weekStart = (day) => day - ((day + 3) % 7); // 1970-01-01 was Thursday.

export function readWeeklyQuizConfig(config) {
  const activity = config?.StudyActConf?.[STANDARD_QUIZ_ID];
  const rewards = Object.values(config?.StudyRewardConf ?? {}).filter(
    (reward) =>
      reward?.actId === STANDARD_QUIZ_ID && reward.periodType === WEEKLY_PERIOD,
  );
  const answers = new Map(
    Object.values(config?.StudyConf ?? {})
      .filter(
        (question) =>
          Number.isSafeInteger(question?.id) &&
          question.id > 0 &&
          [1, 2].includes(question.correctOption),
      )
      .map(({ id, correctOption }) => [id, correctOption]),
  );
  const { studyQuestionNum, studyDailyChance, studyEnergyCost } =
    config?.ConstantConf ?? {};
  if (
    activity?.id !== STANDARD_QUIZ_ID ||
    activity.actType !== 1 ||
    !Number.isSafeInteger(activity.startTime) ||
    !Number.isSafeInteger(activity.endTime) ||
    activity.startTime >= activity.endTime ||
    ![studyQuestionNum, studyDailyChance, studyEnergyCost].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    !rewards.length ||
    rewards.some(
      ({ id, correctNum }) =>
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !Number.isSafeInteger(correctNum) ||
        correctNum <= 0 ||
        correctNum > studyQuestionNum,
    ) ||
    new Set(rewards.map(({ id }) => id)).size !== rewards.length ||
    answers.size < studyQuestionNum
  )
    return null;

  return {
    startsAt: activity.startTime,
    endsAt: activity.endTime,
    questionCount: studyQuestionNum,
    dailyLimit: studyDailyChance,
    energyCost: studyEnergyCost,
    target: Math.max(...rewards.map(({ correctNum }) => correctNum)),
    rewardIds: rewards.map(({ id }) => id).sort((a, b) => a - b),
    answers,
  };
}

export function getWeeklyQuizProgress(role, config) {
  const taskDay = role?.dailyTask?.dailyTime;
  const study = role?.study;
  if (
    !Number.isSafeInteger(taskDay) ||
    taskDay <= 0 ||
    !Number.isSafeInteger(study?.beginTime) ||
    study.beginTime < 0 ||
    study.beginTime >= taskDay + DAY_SECONDS
  )
    return null;

  const today = shanghaiDay(taskDay);
  const started = study.beginTime > 0 ? shanghaiDay(study.beginTime) : -1;
  const currentWeek = started >= weekStart(today);
  const correct = currentWeek ? (study.maxCorrectNum ?? 0) : 0;
  // EMStudyTaskState uses string values; BON decodes maps to objects.
  const taskComplete = currentWeek ? (study.taskComplete ?? {}) : {};
  const rewardState = (id) =>
    taskComplete instanceof Map ? taskComplete.get(id) : taskComplete[id];
  if (
    !Number.isSafeInteger(correct) ||
    correct < 0 ||
    !taskComplete ||
    typeof taskComplete !== "object" ||
    Array.isArray(taskComplete) ||
    config.rewardIds.some(
      (id) => ![undefined, "not", "yes", "claimed"].includes(rewardState(id)),
    )
  )
    return null;

  const claimable = config.rewardIds.filter((id) => rewardState(id) === "yes");
  return {
    taskDay,
    correct,
    attemptedToday: started === today,
    claimable,
    complete:
      correct >= config.target &&
      config.rewardIds.every((id) => rewardState(id) === "claimed"),
  };
}

const result = (status, message) => ({ status, message });

/** Run at most one round, using the connection that supplied the role snapshot. */
export async function runWeeklyQuiz({
  tokenStore,
  tokenId,
  loadConfig,
  readRole,
  check = () => {},
  daily = false,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const account = tokenStore.getAccountGameData(tokenId);
  if (account.value.weeklyQuizPhase)
    return result("pending", "咸鱼大冲关正在执行");

  const client = getAccountClient(tokenStore, tokenId);
  const connection = trackAccountConnection(tokenStore, tokenId, client);
  const checkConnection = () => {
    check();
    if (!client || !connection.isIntact()) {
      const error = new Error("咸鱼大冲关已停止，原连接发生变化");
      error.interrupted = true;
      throw error;
    }
  };
  const request = async (cmd, params = {}) => {
    checkConnection();
    const response = await tokenStore.sendMessageWithPromise(
      tokenId,
      cmd,
      params,
    );
    checkConnection();
    return response;
  };

  account.value.weeklyQuizPhase = "checking";
  try {
    checkConnection();
    const config = await loadConfig();
    checkConnection();
    if (!config) return result("pending", "当前版本缺少可用的咸鱼大冲关配置");
    const fetchRole =
      readRole ??
      (async () => (await tokenStore.sendGetRoleInfo(tokenId, {}, 2))?.role);
    let taskDay;
    let role;
    const readProgress = async () => {
      checkConnection();
      role = await fetchRole();
      checkConnection();
      const progress = getWeeklyQuizProgress(role, config);
      if (!progress) throw new Error("服务器未提供可核对的答题进度");
      if (taskDay !== undefined && taskDay !== progress.taskDay)
        throw new Error("游戏日期已变化，下次运行将重新检查答题进度");
      taskDay = progress.taskDay;
      return progress;
    };

    let progress = await readProgress();
    if (progress.complete)
      return result("skipped", "本周咸鱼大冲关已答满并领奖，跳过");
    const now = Math.floor((client.serverTime ?? Date.now()) / 1000);
    if (now < config.startsAt || now > config.endsAt)
      return result("skipped", "咸鱼大冲关当前未开放");

    let skipReason = "";
    if (progress.correct < config.target) {
      if (daily && progress.attemptedToday) skipReason = "今日已有答题记录";
      else if (role.studyTime >= config.dailyLimit)
        skipReason = "今日答题次数已用完";
      else if (
        Number.isFinite(role.hallEnergy) &&
        role.hallEnergy < config.energyCost
      )
        skipReason = "客厅电量不足";
      else {
        account.value.weeklyQuizPhase = "answering";
        const started = await request("study_startgame");
        const studyId = started?.role?.study?.id;
        const pool = started?.questionList;
        const questions = started?.role?.study?.question ?? pool;
        const poolIds = new Set(
          Array.isArray(pool) ? pool.map((question) => question?.id) : [],
        );
        if (
          !Number.isSafeInteger(studyId) ||
          studyId <= 0 ||
          !Array.isArray(questions) ||
          questions.length !== config.questionCount ||
          new Set(questions.map((question) => question?.id)).size !==
            questions.length ||
          questions.some(
            (question) =>
              !poolIds.has(question?.id) || !config.answers.has(question.id),
          )
        )
          throw new Error("开局后无法核对题目或答案，已停止本局");

        for (const { id } of questions) {
          await request("study_answer", {
            id: studyId,
            questionId: [id],
            option: [config.answers.get(id)],
          });
          await sleep(300);
        }
        // Give the server time to finalize the round before reading rewards.
        await sleep(1200);
        progress = await readProgress();
      }
    }

    if (progress.claimable.length) {
      account.value.weeklyQuizPhase = "claiming";
      for (const rewardId of progress.claimable) {
        await request("study_claimreward", { rewardId });
        await sleep(200);
      }
      await sleep(1000);
      progress = await readProgress();
    }

    if (progress.complete)
      return result("completed", "服务器确认本周咸鱼大冲关已答满并领奖");
    return result(
      "pending",
      [
        skipReason,
        `本周答对 ${progress.correct}/${config.target} 题，尚未确认全部奖励到账`,
      ]
        .filter(Boolean)
        .join("，"),
    );
  } catch (error) {
    if (error.interrupted) throw error;
    return result("pending", `咸鱼大冲关待核对：${error.message}`);
  } finally {
    connection.stop();
    account.value.weeklyQuizPhase = "";
  }
}
