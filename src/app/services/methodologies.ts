/** Persistent methodology configuration stored in localStorage */

export interface Methodology {
  id: string;
  name: string;
  emoji: string;
  description: string;
  prompt: string;
  isBuiltin: boolean;
}

const STORAGE_KEY = "ai-review-methodologies";

export const defaultMethodologies: Methodology[] = [
  {
    id: "none",
    name: "无方法论",
    emoji: "💬",
    description: "不使用特定方法论，直接进行对话",
    prompt: "",
    isBuiltin: true,
  },
  {
    id: "socratic",
    name: "苏格拉底提问",
    emoji: "🧠",
    description: "通过连续追问帮助用户发现方案中的隐含假设和逻辑漏洞",
    prompt: "请使用苏格拉底提问法进行审查：通过连续追问帮助用户发现方案中的隐含假设和逻辑漏洞。不要直接给出答案，而是引导用户自行思考。",
    isBuiltin: true,
  },
  {
    id: "pre-mortem",
    name: "Pre-Mortem",
    emoji: "💀",
    description: "假设方案已经失败，倒推分析可能的失败原因和被忽略的风险",
    prompt: "请使用 Pre-Mortem（事前验尸）方法：假设方案已经失败了，请从失败的视角倒推分析可能导致失败的原因、被忽略的风险和盲点。",
    isBuiltin: true,
  },
  {
    id: "self-refine",
    name: "Self-Refine",
    emoji: "🔄",
    description: "先分析再自我批评，展示完整的思考-批评-改进过程",
    prompt: "请使用 Self-Refine 方法：先给出初始分析，然后自我批评找出不足，再给出改进后的分析。展示完整的思考-批评-改进过程。",
    isBuiltin: true,
  },
  {
    id: "red-team",
    name: "红队分析",
    emoji: "🔴",
    description: "以对抗性审查者角色主动寻找方案中的漏洞和弱点",
    prompt: "请以红队（对抗性审查者）的角色进行分析：主动寻找方案中的漏洞、弱点和可攻击面。假设你是方案的反对者，尽可能找出问题。",
    isBuiltin: true,
  },
  {
    id: "cognitive-mirror",
    name: "认知镜像",
    emoji: "👁",
    description: "提取方案中的隐含假设，标注认知盲区和思维偏差",
    prompt: "请使用认知镜像方法进行审查：\n1. **提取隐含假设** — 逐条列出方案中未被明确说明但实际依赖的假设（技术假设、用户行为假设、市场假设、资源假设等）。\n2. **标注认知盲区** — 识别方案作者可能存在的认知偏差（确认偏误、锚定效应、可得性偏差、乐观偏差等），指出哪些判断可能受到偏差影响。\n3. **镜像反馈** — 将方案的核心逻辑用不同视角重新表述，帮助作者从「局外人」角度审视自己的思路。\n对每个发现，说明其潜在风险和建议的验证方式。",
    isBuiltin: true,
  },
  {
    id: "key-assumptions-check",
    name: "关键假设检查",
    emoji: "🔑",
    description: "逐一识别和审查方案依赖的核心假设",
    prompt: "请使用关键假设检查（Key Assumptions Check）方法进行审查：\n1. **假设识别** — 列出方案成功所依赖的所有关键假设，包括技术可行性、用户需求、资源可用性、时间线、外部依赖等。\n2. **假设评级** — 对每个假设从两个维度评估：(a) 确定性：该假设被验证的程度（已验证 / 有部分证据 / 纯粹推测）；(b) 影响度：如果该假设不成立，对方案的影响程度（低 / 中 / 高 / 致命）。\n3. **脆弱性分析** — 重点关注「确定性低 + 影响度高」的假设，这些是方案最脆弱的环节。\n4. **建议** — 为高风险假设提出具体的验证方法或降低风险的备选方案。",
    isBuiltin: true,
  },
  {
    id: "ach",
    name: "竞争性假设分析",
    emoji: "⚖️",
    description: "列出多个竞争性假设，用证据矩阵逐一排除",
    prompt: "请使用竞争性假设分析（Analysis of Competing Hypotheses, ACH）方法进行审查：\n1. **生成假设** — 针对方案要解决的问题，列出所有可能的方案方向或解释（不仅仅是当前方案，还包括替代方案和\"不做\"选项）。\n2. **收集证据** — 列出所有支持或反对各假设的证据、数据和论据。\n3. **构建矩阵** — 用表格形式，对每条证据评估它与每个假设的一致性（一致 / 不一致 / 不相关）。\n4. **排除分析** — 重点关注能区分假设的诊断性证据，尝试排除不一致证据最多的假设。\n5. **敏感性检验** — 如果关键证据是错误的或有不同解读，结论会如何变化？\n6. **结论** — 给出哪个假设（方案方向）最经得起检验，以及当前方案的相对优劣。",
    isBuiltin: true,
  },
  {
    id: "six-hats",
    name: "六顶思考帽",
    emoji: "💡",
    description: "从六个不同维度系统化审视方案",
    prompt: "请使用六顶思考帽（Six Thinking Hats）方法，从六个维度系统审视方案：\n\n🔵 **蓝帽 — 全局管理**：概述审查目标和方案核心内容。\n⚪ **白帽 — 客观事实**：列出方案中已知的事实、数据、现有信息，以及信息缺口（还需要了解什么？）。\n🔴 **红帽 — 直觉感受**：凭直觉和第一印象，方案给人什么感觉？有哪些让人不安或兴奋的地方？\n⚫ **黑帽 — 风险批判**：方案的风险、缺陷、可能失败的原因，逻辑上的漏洞。\n🟡 **黄帽 — 积极价值**：方案的优势、机会、最好情况下能达到的效果。\n🟢 **绿帽 — 创新替代**：有没有其他创意或替代方案？如何改进现有方案？\n\n最后用蓝帽总结：综合六个维度的分析，给出整体评估和建议。",
    isBuiltin: true,
  },
];

export function loadMethodologies(): Methodology[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Methodology[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return defaultMethodologies;
}

export function saveMethodologies(methodologies: Methodology[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(methodologies));
}
