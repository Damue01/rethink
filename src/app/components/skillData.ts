export interface Skill {
  id: string;
  name: string;
  emoji: string;
  description: string;
  category: string;
  content: string;
  isBuiltin: boolean;
  updatedAt: string;
}

export interface SkillCategory {
  id: string;
  label: string;
  emoji: string;
  isBuiltin?: boolean;
}

export const builtinCategories: SkillCategory[] = [
  { id: "project", label: "项目背景", emoji: "📋", isBuiltin: true },
  { id: "domain", label: "领域知识", emoji: "🧬", isBuiltin: true },
  { id: "methodology", label: "方法论", emoji: "📐", isBuiltin: true },
  { id: "custom", label: "自定义", emoji: "⚡", isBuiltin: true },
];

const CATEGORIES_STORAGE_KEY = "ai-review-skill-categories";

/** Module-level caches — avoids repeated JSON.parse on every call */
let _categoriesCache: SkillCategory[] | null = null;
let _skillsCache: Skill[] | null = null;

export function loadCategories(): SkillCategory[] {
  if (_categoriesCache) return _categoriesCache;
  try {
    const raw = localStorage.getItem(CATEGORIES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        _categoriesCache = parsed;
        return parsed;
      }
    }
  } catch { /* ignore */ }
  _categoriesCache = builtinCategories;
  return builtinCategories;
}

export function saveCategories(categories: SkillCategory[]) {
  _categoriesCache = categories;
  localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(categories));
}

/** Backward-compatible alias */
export const skillCategories = builtinCategories;

const SKILLS_STORAGE_KEY = "ai-review-skills";

export function loadSkills(): Skill[] {
  if (_skillsCache) return _skillsCache;
  try {
    const raw = localStorage.getItem(SKILLS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Migrate old format (documents[] + checklistItems[]) to new format (content)
        if (parsed[0].documents && !("content" in parsed[0])) {
          const migrated = parsed.map(migrateOldSkill);
          saveSkills(migrated);
          return migrated;
        }
        _skillsCache = parsed;
        return parsed;
      }
    }
  } catch { /* ignore */ }
  _skillsCache = defaultSkills;
  return defaultSkills;
}

/** Convert old-format skill (documents[] + checklistItems[]) to new content-based format */
function migrateOldSkill(old: any): Skill {
  let content = "";
  if (Array.isArray(old.documents)) {
    content = old.documents.map((doc: any) => doc.content || "").join("\n\n---\n\n");
  }
  if (Array.isArray(old.checklistItems) && old.checklistItems.length > 0) {
    content += "\n\n---\n\n# 审查清单\n\n" + old.checklistItems.map((item: string) => `- [ ] ${item}`).join("\n");
  }
  return {
    id: old.id,
    name: old.name,
    emoji: old.emoji,
    description: old.description,
    category: old.category,
    content: content.trim(),
    isBuiltin: old.isBuiltin,
    updatedAt: old.updatedAt,
  };
}

export function saveSkills(skills: Skill[]) {
  _skillsCache = skills;
  localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skills));
}

/** Parse frontmatter (---\nname: ...\ndescription: ...\ncategory: ...\n---) from markdown */
export function parseFrontmatter(markdown: string): { name?: string; description?: string; category?: string; body: string } {
  const trimmed = markdown.trimStart();
  if (!trimmed.startsWith("---")) return { body: markdown };
  const endIdx = trimmed.indexOf("---", 3);
  if (endIdx === -1) return { body: markdown };
  const fm = trimmed.slice(3, endIdx);
  const body = trimmed.slice(endIdx + 3).replace(/^\r?\n/, "");
  let name: string | undefined;
  let description: string | undefined;
  let category: string | undefined;
  for (const line of fm.split("\n")) {
    const m = line.match(/^(\w+)\s*:\s*(.+)/);
    if (m) {
      if (m[1] === "name") name = m[2].trim();
      if (m[1] === "description") description = m[2].trim();
      if (m[1] === "category") category = m[2].trim();
    }
  }
  return { name, description, category, body };
}

/** Compose frontmatter + body into full markdown */
export function composeFrontmatter(name: string, description: string, body: string, category?: string): string {
  let fm = `---\nname: ${name}\ndescription: ${description}`;
  if (category) fm += `\ncategory: ${category}`;
  fm += `\n---\n${body}`;
  return fm;
}

export const defaultSkills: Skill[] = [
  {
    id: "sk-1",
    name: "游戏设计分析 Skill",
    emoji: "🎮",
    description: "针对游戏设计文档的专业分析，包含核心循环、留存机制、变现模型等分析标准",
    category: "domain",
    content: `# 游戏设计评估框架 v2.1

## 核心循环评估
- 核心循环是否能在30秒内体验到？
- 循环是否具备内在驱动力（非外在奖励依赖）？
- 循环复杂度是否适合目标用户群？

## 新手体验标准
- 首次核心循环触发应在 120 秒内
- 引导步骤不超过 7±2 步（Miller's Law）
- 每完成一个阶段必须有即时正反馈
- 强制引导必须提供跳过机制（平台合规要求）

## 留存机制检查
- D1/D7/D30 留存目标是否明确？
- 是否有短期/中期/长期目标分层？
- 社交粘性机制是否设计？

## 变现模型审查
- 付费点是否影响核心循环公平性？
- 是否有"付费即赢"风险？
- 免费用户体验是否完整？

---

# 手游行业 Benchmark 2025

## 新手引导数据
- 强制引导平均完成率：42-58%
- 每增加一步引导，流失率上升 8-12%
- 最佳引导步数：5-7步
- 首次奖励触发时机：第2-3步

## 留存基准
- 休闲游戏 D1: 35-45%, D7: 15-20%, D30: 5-8%
- 中核游戏 D1: 30-40%, D7: 12-18%, D30: 4-7%
- 重核游戏 D1: 25-35%, D7: 10-15%, D30: 3-6%

## 变现指标
- ARPU 中位数: ¥2.5-4.0/月
- 付费率基准: 2-5%
- LTV/CAC 健康比值: > 3:1

---

# 审查清单

- [ ] 核心循环是否在 30 秒内可体验
- [ ] 引导步骤是否超过 7±2 步
- [ ] 是否有即时正反馈机制
- [ ] 是否提供跳过/退出机制
- [ ] D1/D7/D30 留存目标是否明确
- [ ] 付费模型是否影响公平性
- [ ] 社交系统是否与核心循环关联
- [ ] 数据埋点方案是否完整`,
    isBuiltin: true,
    updatedAt: "2026-03-28",
  },
  {
    id: "sk-2",
    name: "PRD 质量分析 Skill",
    emoji: "📄",
    description: "产品需求文档的结构化分析，检查完整性、可行性、边界条件等",
    category: "methodology",
    content: `# PRD 审查标准清单

## 结构完整性
- [ ] 背景与目标是否清晰
- [ ] 用户故事是否覆盖主要场景
- [ ] 是否包含非功能性需求
- [ ] 数据需求是否定义
- [ ] 异常流程是否描述

## 逻辑严谨性
- [ ] 需求间是否存在矛盾
- [ ] 优先级排序是否合理
- [ ] 依赖关系是否标注
- [ ] 假设条件是否显式声明

## 可行性评估
- [ ] 技术可行性是否确认
- [ ] 资源评估是否合理
- [ ] 时间线是否可行
- [ ] 风险清单是否完整

---

# 审查清单

- [ ] 背景与目标是否清晰定义
- [ ] 用户故事是否覆盖核心场景
- [ ] 非功能性需求是否包含
- [ ] 异常流程是否有描述
- [ ] 需求间是否存在逻辑矛盾
- [ ] 技术可行性是否确认`,
    isBuiltin: true,
    updatedAt: "2026-03-25",
  },
  {
    id: "sk-3",
    name: "技术方案分析 Skill",
    emoji: "⚙️",
    description: "系统设计和技术方案的分析，涵盖架构、性能、安全、可维护性等维度",
    category: "domain",
    content: `# 技术方案审查框架

## 架构设计
- 是否遵循单一职责原则
- 模块间耦合度评估
- 扩展性预留是否合理
- 技术选型是否有对比论证

## 性能指标
- P99 延迟目标
- QPS 预估与容量规划
- 资源消耗评估
- 降级策略

## 安全性
- 身份认证与授权
- 数据加密方案
- SQL注入/XSS防护
- 敏感数据处理

## 可维护性
- 监控与告警方案
- 日志规范
- 文档完备性
- 灰度发布方案

---

# 审查清单

- [ ] 架构是否遵循单一职责
- [ ] 模块耦合度是否合理
- [ ] P99 延迟目标是否明确
- [ ] 降级策略是否设计
- [ ] 安全防护是否覆盖
- [ ] 监控告警方案是否完整`,
    isBuiltin: true,
    updatedAt: "2026-03-20",
  },
  {
    id: "sk-4",
    name: "战斗系统设计",
    emoji: "⚔️",
    description: "ARPG 战斗系统技术方案的专属分析上下文，包含引擎约束和性能目标",
    category: "project",
    content: `# 战斗系统设计项目背景

## 业务目标
- 核心战斗手感达到 4.5/5 评分
- 支持 PvE 和 PvP 双模式
- 首月 D7 留存率 > 25%

## 技术约束
- 引擎：Unity 6 / URP 管线
- 目标帧率：移动端 60fps，战斗场景不低于 45fps
- 单场景同屏实体上限：50 个（含特效、AI 单位）
- 网络同步：帧同步 + 状态回滚，RTT < 80ms

## 团队构成
- 战斗策划 2 人
- 客户端程序 3 人
- 服务端程序 2 人
- 技术美术 1 人

## 已知风险
- 帧同步在弱网下可能出现回滚抖动
- 技能特效层数过多导致 GPU overdraw
- AI 寻路在复杂地形下 CPU 开销不可控
- PvP 外挂检测方案尚未确定

---

# 审查清单

- [ ] 战斗帧率是否满足 60fps / 45fps 底线
- [ ] 同屏实体数是否控制在 50 以内
- [ ] 帧同步回滚方案是否覆盖弱网场景
- [ ] 技能特效 overdraw 是否有预算限制
- [ ] AI 寻路 CPU 开销是否有降级策略
- [ ] PvP 反外挂方案是否设计`,
    isBuiltin: false,
    updatedAt: "2026-03-30",
  },
];
