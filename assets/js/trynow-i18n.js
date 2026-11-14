// Interface text for the RoboBrain "Try now" demo, in the page's language (<html lang>).
// The on-video status overlay stays in English on purpose: it mirrors RoboBrain's real overlay.
import { CLIPS, REPLAY_NOTES, progressText } from "./rb-core.js";

export const ZH = (document.documentElement.lang || "").toLowerCase().startsWith("zh");

const EN = {
  chars: (n, max) => `${n} / ${max} characters`,
  clipChanged: "The clip changed, so generate a new monitor for it.",
  demoOff: "Not switched on yet. Use your own key for now.",
  demoLimits: (n) => `${n} runs per visitor per day, on Yuxin's key`,
  demoDown: "Unavailable right now. Use your own key, or try later.",
  demoLeft: (n) => `${n} demo run${n === 1 ? "" : "s"} left today`,
  needTask: "Describe the task first.",
  needKey: "Paste an OpenAI API key that starts with sk-.",
  serverHttp: (s) => `The demo server returned HTTP ${s}.`,
  generating: "Generating the monitor. This usually takes 20–60 seconds.",
  needMore: (t) => "The builder needs more detail: " + t,
  genFailed: "Generation failed. Try again.",
  runNote: (n, clip) => `Runs ${n} keyframes of the ${CLIPS[clip].title.toLowerCase()} clip.`,
  phWorkingTitle: "Writing your specialists…",
  phTitle: "Your specialists will appear here",
  phWorking: "The builder is reading your description and the first frame of the clip.",
  ph: "Explain what success looks like and which failures matter, then generate a monitor.",
  draft: "Draft",
  badge: (n, progress) => `${n} specialist${n === 1 ? "" : "s"}${progress ? " + progress" : ""}`,
  success: "Success",
  prompt: "Prompt",
  progressObserver: "Progress observer",
  nodes: (n) => `${n} nodes`,
  node: "Node",
  label: "Label",
  promptCriteria: "Prompt and node criteria",
  draftJson: "Draft JSON",
  waiting: "Waiting",
  keyframeAria: (k, t) => `Keyframe ${k} at ${t} seconds`,
  failureType: (v) => "Failure type: " + v,
  noDecision: "No confirmed success or failure in this keyframe.",
  waitFirst: "Waiting for the first keyframe",
  evaluating: (k, n) => `Evaluating keyframe ${k} of ${n}…`,
  framesFailed: "Couldn't load the replay frames. Reload the page and try again.",
  stopped: " The replay stopped; the keyframes evaluated so far are kept.",
  answers: (a, k, n) => `${a} answers from ${k} of ${n} keyframes`,
  taskProgress: "Task progress",
  noProgress: "This monitor has no progress observer. Ask for progress stages in the description to add one.",
  evidence: (q, reason) => `Evidence: ${q}. ${reason || ""}`,
  waitingProgress: "Waiting for progress evidence.",
  transitions: "Confirmed transitions",
  quality: (q) => q,
  progress: progressText,
  notes: REPLAY_NOTES,
  defaultTask: (clip) => CLIPS[clip].default_task,
  original: (clip) => CLIPS[clip].original,
};

const ZH_TEXT = {
  chars: (n, max) => `${n} / ${max} 字符`,
  clipChanged: "视频已更换，请为它重新生成监控方案。",
  demoOff: "尚未开通，请先使用自己的密钥。",
  demoLimits: (n) => `每位访客每天 ${n} 次，使用 Yuxin 的密钥`,
  demoDown: "暂时不可用，请使用自己的密钥，或稍后再试。",
  demoLeft: (n) => `今天还剩 ${n} 次演示机会`,
  needTask: "请先描述任务。",
  needKey: "请粘贴以 sk- 开头的 OpenAI API 密钥。",
  serverHttp: (s) => `演示服务器返回 HTTP ${s}。`,
  generating: "正在生成监控方案，通常需要 20–60 秒。",
  needMore: (t) => "构建器需要更多信息：" + t,
  genFailed: "生成失败，请重试。",
  runNote: (n, clip) => `将对“${{ plug: "插头插入", sort: "砖块和线缆分拣" }[clip]}”视频的 ${n} 个关键帧进行判断。`,
  phWorkingTitle: "正在编写各个“专家”……",
  phTitle: "生成的“专家”会显示在这里",
  phWorking: "构建器正在阅读你的描述和视频的第一帧。",
  ph: "说明成功是什么样子、哪些失败需要关注，然后生成监控方案。",
  draft: "草稿",
  badge: (n, progress) => `${n} 个“专家”${progress ? " + 进度" : ""}`,
  success: "成功",
  prompt: "提示词",
  progressObserver: "进度观察器",
  nodes: (n) => `${n} 个阶段`,
  node: "阶段",
  label: "名称",
  promptCriteria: "提示词与阶段判定标准",
  draftJson: "草稿 JSON",
  waiting: "等待中",
  keyframeAria: (k, t) => `第 ${k} 个关键帧，${t} 秒`,
  failureType: (v) => "失败类型：" + v,
  noDecision: "该关键帧没有确认的成功或失败。",
  waitFirst: "等待第一个关键帧",
  evaluating: (k, n) => `正在判断第 ${k} / ${n} 个关键帧……`,
  framesFailed: "无法加载回放画面，请刷新页面后重试。",
  stopped: "回放已停止，已判断的关键帧会保留。",
  answers: (a, k, n) => `已完成 ${n} 个关键帧中的 ${k} 个，共 ${a} 条回答`,
  taskProgress: "任务进度",
  noProgress: "这个监控方案没有进度观察器。在描述中要求划分进度阶段即可添加。",
  evidence: (q, reason) => `证据：${q}。${reason || ""}`,
  waitingProgress: "等待进度证据。",
  transitions: "已确认的阶段变化",
  quality: (q) => ({ confirmed: "已确认", pending: "待确认", unknown: "未知" }[q] || q),
  progress: (p) => {
    if (!p || !p.confirmed) return p && p.quality === "pending" ? "等待首次确认" : "尚未观察到";
    const count = p.total !== null ? `（${p.completed}/${p.total} ${p.unit}）` : "";
    return (p.quality === "confirmed" ? "" : "上次已知：") + p.label + count;
  },
  notes: [
    "模型：任务生成和监控都使用 GPT-6.1 Terra。RoboBrain 本身默认用 Kimi K3 生成任务，用 Gemma 4 26B A4B 进行监控。",
    "采样：使用一组固定的关键帧，而不是 10–15 Hz 的实时视频流。",
    "验证轮次已关闭（RoboBrain 的 evidence horizon 为 0 的模式）：每个关键帧直接判定 SUCCESS、FAIL 或 ON_GOING。进度仍需两个一致的关键帧才能确认。",
    "灰色矩形遮住了原始运行中烧录在画面上的状态文字，以免模型直接读到答案。",
  ],
  defaultTask: (clip) => ({
    plug: "监控一台机械臂：它从白色支架上取下小型白色 USB 电源适配器，并插入排插最右侧的插座。成功：适配器已插入插座，且夹爪已经松开。需检测两种失败：适配器掉落到桌面上；插入过程中适配器仍在夹爪中时发生旋转或滑动。两次尝试之间，可能会有人把适配器放回支架。",
    sort: "监控一个人分拣物品。两块棕色砖块都应放进透明塑料盒；两组黑色线缆（一根散放的 USB 线，以及一个带连接线的电源适配器）都应放到蓝色泡沫垫上，连接头或一小段线露出垫子边缘也可以。如果有物品被放错位置，例如线缆放进盒子或砖块放到垫子上，则判定为失败。按两组（砖块、线缆）跟踪进度：都未分拣、砖块已分拣、线缆已分拣、全部分拣完成。",
  }[clip]),
  original: (clip) => ({
    plug: "原始叠加信息来自 RoboBrain 自己的运行，使用 Gemma 4 26B A4B 和人工调校的“专家”（成功/旋转检测器的较早版本）。",
    sort: "原始叠加信息来自 RoboBrain 自己的运行，使用 Gemma 4 26B A4B，包括其进度跟踪。",
  }[clip]),
};

export const L = ZH ? ZH_TEXT : EN;

// Error messages from rb-core.js and the demo Worker are written in English; translate the known ones.
const ZH_ERRORS = [
  [/^Describe the task first\.$/, "请先描述任务。"],
  [/^Keep the description under (\d+) characters\.$/, "描述请控制在 $1 个字符以内。"],
  [/^This OpenAI account has reached its spending limit or has run out of credit\.$/, "该 OpenAI 账户已达到消费上限或余额不足。"],
  [/^OpenAI rejected the API key\. Check the key and try again\.$/, "OpenAI 拒绝了该 API 密钥，请检查后重试。"],
  [/^OpenAI is rate-limiting requests right now\. Wait a minute and try again\.$/, "OpenAI 当前限制了请求频率，请等一分钟后重试。"],
  [/^This OpenAI account can't use the selected model\.$/, "该 OpenAI 账户无法使用所选模型。"],
  [/^OpenAI returned HTTP /, "OpenAI 返回 HTTP "],
  [/^The model reached its output limit before finishing the draft\. Shorten the description and retry\.$/, "模型在完成草稿前达到了输出上限，请缩短描述后重试。"],
  [/^The builder response was incomplete\. Retry the request\.$/, "构建器的回复不完整，请重试。"],
  [/^The generated draft is invalid: /, "生成的草稿未通过校验："],
  [/^OpenAI rejected the request parameters\.$/, "OpenAI 拒绝了请求参数。"],
  [/^Choose one of the demo clips\.$/, "请选择一个演示视频。"],
  [/^Complete the bot check and try again\.$/, "请完成人机验证后重试。"],
  [/^You've used today's (\d+) demo runs\. Come back tomorrow, or use your own OpenAI key\.$/, "你今天的 $1 次演示机会已用完，请明天再来，或使用自己的 OpenAI 密钥。"],
  [/^The demo has reached today's run limit\. Come back tomorrow, or use your own OpenAI key\.$/, "演示今天的总次数已用完，请明天再来，或使用自己的 OpenAI 密钥。"],
  [/^This replay session isn't valid\. Generate the monitor again\.$/, "本次回放会话无效，请重新生成监控方案。"],
  [/^This replay session expired\. Generate the monitor again\.$/, "本次回放会话已过期，请重新生成监控方案。"],
  [/^The monitor was changed after it was generated\. Generate it again\.$/, "监控方案在生成后被修改，请重新生成。"],
  [/^Unknown keyframe\.$/, "未知的关键帧。"],
  [/^The demo isn't configured yet\.$/, "演示尚未配置。"],
  [/^This origin isn't allowed to use the demo\.$/, "该网址无权使用演示。"],
  [/^The demo's OpenAI key isn't working\. Use your own key for now\.$/, "演示用的 OpenAI 密钥暂时无法使用，请先使用自己的密钥。"],
  [/^Request too large\.$/, "请求过大。"],
  [/^Failed to fetch$/, "网络请求失败，请检查网络后重试。"],
];

export function tr(message) {
  if (!ZH || !message) return message;
  for (const [pattern, replacement] of ZH_ERRORS) if (pattern.test(message)) return message.replace(pattern, replacement);
  return message;
}
