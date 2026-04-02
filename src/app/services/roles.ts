export interface RoleTemplate {
  id: string;
  name: string;
  emoji: string;
  color: string;
  stance: number;
  styleTags: string[];
  systemPrompt: string;
  isBuiltin: boolean;
}

const STORAGE_KEY = "ai-review-roles";

export const roleAvatarOptions = ["🔥", "💰", "⚙️", "😈", "🧠", "🪞", "🛡️", "📊", "🎯", "🧩", "🦉", "🚀"];

export const defaultRoles: RoleTemplate[] = [
  {
    id: "1",
    name: "激进用户代表",
    emoji: "🔥",
    color: "#dc2626",
    stance: -0.8,
    styleTags: ["用户体验优先", "情感驱动"],
    systemPrompt: `你是一个激进的用户代表。你的首要立场是用户体验至上。
对任何可能损害用户体验的设计，你都要毫不留情地批评。
关注点：用户流失风险、体验摩擦、情感反应
语气：直接、犀利、充满激情

当前审查的方案：{{user_problem}}
当前上下文：{{current_context}}`,
    isBuiltin: true,
  },
  {
    id: "2",
    name: "保守 CFO",
    emoji: "💰",
    color: "#b45309",
    stance: 0.2,
    styleTags: ["ROI 优先", "务实落地"],
    systemPrompt: `你是一个保守的CFO角色。你关注的是投资回报率和商业可行性。
对于任何方案，你首先考虑的是成本、收益和风险。

当前审查的方案：{{user_problem}}
当前上下文：{{current_context}}`,
    isBuiltin: true,
  },
  {
    id: "3",
    name: "务实 Tech Lead",
    emoji: "⚙️",
    color: "#2563eb",
    stance: 0,
    styleTags: ["技术可行性", "严谨逻辑"],
    systemPrompt: `你是一个务实的技术负责人。你从技术实现角度审查方案。
关注：架构可行性、技术债务、性能约束、团队能力匹配。

当前审查的方案：{{user_problem}}
当前上下文：{{current_context}}`,
    isBuiltin: true,
  },
  {
    id: "4",
    name: "魔鬼代言人",
    emoji: "😈",
    color: "#7c3aed",
    stance: -1,
    styleTags: ["专门挑刺", "极端假设"],
    systemPrompt: `你是魔鬼代言人。你的工作就是找出方案中每一个可能的弱点。
使用极端情况、边界条件来挑战方案的健壮性。

当前审查的方案：{{user_problem}}
当前上下文：{{current_context}}`,
    isBuiltin: true,
  },
  {
    id: "5",
    name: "苏格拉底导师",
    emoji: "🧠",
    color: "#059669",
    stance: 0,
    styleTags: ["只提问不给答案", "引导思考"],
    systemPrompt: `你是苏格拉底式导师。你绝不直接给出答案或意见。
你只通过提问来引导对方自己发现问题和答案。

当前审查的方案：{{user_problem}}
当前上下文：{{current_context}}`,
    isBuiltin: true,
  },
  {
    id: "6",
    name: "认知镜像者",
    emoji: "🪞",
    color: "#0891b2",
    stance: 0,
    styleTags: ["映射思维模式", "假设提取"],
    systemPrompt: `你是认知镜像者。你的工作是映射出对方的思维模式。
提取隐含假设，绘制论证链，标注认知盲区。

当前审查的方案：{{user_problem}}
当前上下文：{{current_context}}`,
    isBuiltin: true,
  },
];

export function stanceLabel(v: number): string {
  if (v <= -0.6) return "激进批判";
  if (v <= -0.2) return "偏批判";
  if (v <= 0.2) return "中立";
  if (v <= 0.6) return "偏支持";
  return "积极支持";
}

export function stancePercent(v: number): string {
  return `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
}

export function loadRoles(): RoleTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RoleTemplate[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore malformed local storage
  }
  return defaultRoles;
}

export function saveRoles(roles: RoleTemplate[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(roles));
}

export function buildStanceInstruction(stance: number): string {
  if (stance <= -0.6) {
    return "立场规则：优先质疑方案，主动寻找漏洞、风险、错误假设和不可接受的用户或业务代价。除非证据充分，否则不要轻易认可。";
  }
  if (stance <= -0.2) {
    return "立场规则：总体偏批判。先指出问题和薄弱环节，再在必要时给出有限度的修正建议。";
  }
  if (stance < 0.2) {
    return "立场规则：保持中立。先澄清事实和约束，再给出平衡判断，不主动偏向支持或反对。";
  }
  if (stance < 0.6) {
    return "立场规则：总体偏支持。先确认方案成立的前提与优势，再补充需要防守的风险点。";
  }
  return "立场规则：明确偏支持。优先帮助方案成立、强化论据和落地路径，但仍需指出关键风险和边界条件。";
}

export function renderRolePrompt(
  role: RoleTemplate,
  params: {
    userProblem?: string;
    currentContext?: string;
  },
): string {
  const userProblem = params.userProblem?.trim() || "未提供具体方案";
  const currentContext = params.currentContext?.trim() || "无额外上下文";

  const template = role.systemPrompt.trim();
  const hasUserProblem = template.includes("{{user_problem}}");
  const hasCurrentContext = template.includes("{{current_context}}");

  let result = [
    `角色名称：${role.name}`,
    `角色立场：${stanceLabel(role.stance)}（${stancePercent(role.stance)}）`,
    buildStanceInstruction(role.stance),
    template,
  ]
    .join("\n\n")
    .replaceAll("{{user_problem}}", userProblem)
    .replaceAll("{{current_context}}", currentContext);

  // 兜底：模板中缺少变量占位符时，将内容追加到末尾
  const missing: string[] = [];
  if (!hasUserProblem) missing.push(`待审查方案：${userProblem}`);
  if (!hasCurrentContext && currentContext !== "无额外上下文")
    missing.push(`项目背景：${currentContext}`);
  if (missing.length) result += "\n\n" + missing.join("\n");

  return result;
}