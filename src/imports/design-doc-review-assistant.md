# ReThink — Web 应用设计文档

> **版本**：v1.1  
> **日期**：2026-04-01  
> **基础研究**：[research-report-ai-design-critique.md](research-report-ai-design-critique.md)  
> **目标**：将调研报告中的 8 种方法论落地为可部署的 Web 应用

---

## 一、产品概述

### 1.1 定位

一个面向策划/产品经理/方案设计者的 **AI 辅助方案审查工具**，将苏格拉底提问、Self-Refine、多智能体辩论、Pre-Mortem 等方法论封装为可交互的结构化审查流程。

### 1.2 核心价值

| 痛点 | 产品方案 |
|:---|:---|
| AI 谄媚偏差，不敢批评 | 角色系统 + 强制结构化输出，内置"严苛审查者"模板 |
| 单模型视角局限 | 多模型并排对比，同一问题获取多元视角 |
| 缺乏对抗性审查 | 多智能体辩论，自动生成角色冲突 |
| 审查停留在表面 | 三层渐进式审查（L1→L2→L3），逐步深入 |
| 方法论难以落地 | 预置方法论模板 + 可视化工作流编排 |

### 1.3 目标用户

- 游戏策划（审查玩法设计/系统设计文档）
- 产品经理（审查 PRD/需求文档）
- 技术负责人（审查架构方案）
- 创业团队（验证商业计划）

---

## 二、功能需求

### 2.1 功能清单与优先级

| 编号 | 功能 | 优先级 | 所属阶段 |
|:---|:---|:---|:---|
| F1 | 模型切换与 API 配置 | P0 | MVP |
| F2 | 基础对话（单模型 Chat） | P0 | MVP |
| F3 | 对话历史管理 | P0 | MVP |
| F4 | 多模型并排对比 | P0 | V1 |
| F5 | 审查方法论模板 | P1 | V1 |
| F6 | L1/L2/L3 三层审查报告 | P1 | V1 |
| F7 | 多智能体辩论 | P1 | V2 |
| F8 | 角色配置与模板管理 | P1 | V2 |
| F9 | 可视化工作流编排 | P2 | V2 |
| F10 | 审查报告导出（PDF/Markdown） | P2 | V2 |

### 2.2 各功能详述

#### F1 – 模型切换与 API 配置

**用户故事**：用户可以配置多个 LLM 供应商（OpenAI / Anthropic / 本地模型等），为每个供应商设置 API Key、Base URL、可用模型列表及默认参数（temperature / max_tokens）。

**核心交互**：
- 设置页面 → Provider 管理面板
- 每个 Provider 展开后显示：名称、API Key（密文）、Base URL、模型列表
- 每个模型可配置：温度、最大 token、是否设为默认
- 模型切换：对话页面顶部下拉选择器，支持快速切换

**约束**：
- API Key 加密存储，前端仅显示掩码
- 支持连接测试（点击"测试连接"按钮验证 API 可达性）

#### F2 – 基础对话

**用户故事**：用户与选定的单个模型进行自由对话，支持流式响应。

**核心交互**：
- 左侧：对话历史列表
- 中央：聊天消息流（用户气泡 + AI 气泡）
- 底部：输入框 + 发送按钮
- 消息支持 Markdown 渲染、代码高亮
- 流式响应（SSE），逐字显示

#### F3 – 对话历史管理

**用户故事**：自动保存所有对话，支持搜索、重命名、删除、归档。

**核心交互**：
- 左侧面板按时间分组（今天 / 昨天 / 更早）
- 支持全文搜索对话内容
- 右键菜单：重命名、删除、导出
- 对话自动生成摘要标题

#### F4 – 多模型并排对比

**用户故事**：用户选择 2-4 个模型，输入同一问题后同时获取所有模型的响应，并排展示以供对比。

**核心交互**：
- 模型选择器：多选（2-4 个），从已配置模型中选取
- 发送后进入**列式布局**：每个模型占一列，等宽，独立垂直滚动
- 每列顶部：模型名称 / Logo、实时 Token 计数、响应耗时
- 工具栏：
  - **同步滚动开关**：开启后滚动任一列其余同步
  - **差异高亮**：调用后端分析文本差异，颜色标注
  - **折叠/展开**：单列可折叠为摘要
- 每列底部："标记更优"按钮（👍），点击后该列高亮

**技术方案**：
```
POST /api/conversation/parallel
  body: { prompt, model_ids: [m1, m2, m3] }
  response: { task_group_id }

GET /api/stream/results?task_group_id=xxx  (SSE)
  events: { model_id, chunk, done, token_count, latency_ms }
```
后端为每个模型创建独立 Celery 任务，通过 Redis Pub/Sub 汇聚到 SSE endpoint。

#### F5 – 审查方法论模板

**用户故事**：用户从预置方法论模板中选择一种，系统自动注入相应的 System Prompt 和结构化流程来引导审查对话。

**支持的方法论**（来自调研报告）：

| 方法论 | 类型 | 核心机制 |
|:---|:---|:---|
| 苏格拉底提问 | 引导式对话 | 递进式追问，不给答案，引导自省 |
| Self-Refine | 迭代精炼 | 生成→评估→精炼，三轮迭代 |
| Pre-Mortem | 风险预演 | 假设已失败，逆向拆解原因 |
| 认知镜像 | 思维映射 | 提取假设、绘制论证链、标注盲区 |
| 关键假设检查 | SAT | 逐一审查核心假设的成立条件 |
| 竞争性假设分析 (ACH) | SAT | 多假设并排，用证据排除 |
| 红队分析 | 对抗测试 | AI 扮演对手攻击方案弱点 |
| 六顶思考帽 | 多维审视 | 事实/感性/批判/乐观/创造/管理 |

**核心交互**：
- **快速入口（卡片式）**：主页展示大卡片按钮，每张对应一种方法论，一键启动
- **高级编排**：拖拽式工作流画布（V2），将多个方法论串联或并行组合
- 方法论间衔接：前一轮输出自动作为下一轮的上下文输入

#### F6 – L1/L2/L3 三层审查报告

**用户故事**：用户提交方案文档后，系统按三层渐进式审查生成结构化报告。

**流程设计**：

```
┌─────────────────────────────────────────────────┐
│  L1：基础合规与一致性检查（自动）                    │
│  方法：自动化清单 + Pre-Mortem 简化版               │
│  产出：问题清单 + 严重度评级                        │
├─────────────────────────────────────────────────┤
│  L2：逻辑与假设挑战（人机对话）                      │
│  方法：假设提取 → 苏格拉底提问 → ACH               │
│  产出：假设验证矩阵 + 决策理据记录                   │
├─────────────────────────────────────────────────┤
│  L3：创造性拓展与压力测试（多智能体）                 │
│  方法：多角色辩论 + 红队 + 六顶思考帽               │
│  产出：辩论记录 + 风险地图 + 替代方案清单             │
└─────────────────────────────────────────────────┘
         ↕ 层间反馈回路 ↕
```

**界面设计**：
- 右侧固定**垂直进程管道图**，三层从上到下
- 当前活跃层高亮，流动光点表示进度
- 层间双向箭头：发生反馈回溯时箭头闪烁 + 文字通知
- 点击任一层切换到该层的详细工作视图
- 底部"反馈日志"折叠面板记录所有层间事件

**报告结构**：
```json
{
  "l1_summary": { "issues": [...], "severity_counts": {...} },
  "l2_summary": { "assumptions": [...], "questioning_log": [...] },
  "l3_summary": { "debate_log": [...], "risk_map": [...], "alternatives": [...] },
  "overall_score": 72,
  "top_risks": [...],
  "action_items": [...]
}
```

#### F7 – 多智能体辩论

**用户故事**：用户设定 2-5 个角色，围绕方案展开多轮结构化辩论，用户可实时观看并在任意时刻介入。

**核心交互**：

- **辩论配置面板**：
  - 选择/创建角色（从模板库或自建）
  - 设定辩论轮数（建议 3-5 轮）
  - 选择辩论模式：自由辩论 / 正方-反方 / 圆桌
  - 可选：指定辩论焦点

- **辩论展示区（增强型时间线群聊）**：
  - 居中时间线，气泡式消息展示
  - 左侧时间线标记轮次（Round 1, 2, 3...）
  - 每个角色有固定颜色 + 头像 + 名称标签
  - 当前发言角色头像呼吸闪烁

- **用户介入**：
  - **全局暂停/继续**：控制栏始终可见
  - **定点追问**：点击任意历史气泡旁的"追问"按钮，向特定角色提问
  - **角色静音/激活**：侧边角色列表可临时禁用某角色

- **辩论总结**：
  - 辩论结束后自动生成：共识点、分歧点、Top 风险、建议行动
  - 可导出为 Markdown / PDF

**技术方案**：
- 后端 Orchestrator 使用**状态机**管理辩论流程
- 状态：`IDLE → ROUND_START → SPEAKER_THINKING → SPEAKER_DONE → ROUND_END → SUMMARY`
- 每轮：选择发言者 → 构建上下文（历史发言 + 角色 System Prompt）→ 调用 LLM → 存储 → SSE 推送
- 用户介入时状态切换为 `USER_INTERVENTION`，完成后恢复

```
State Machine:
  IDLE ──[start]──→ ROUND_START
  ROUND_START ──[select_speaker]──→ SPEAKER_THINKING
  SPEAKER_THINKING ──[llm_complete]──→ SPEAKER_DONE
  SPEAKER_DONE ──[more_speakers]──→ SPEAKER_THINKING
  SPEAKER_DONE ──[round_complete]──→ ROUND_END
  ROUND_END ──[more_rounds]──→ ROUND_START
  ROUND_END ──[all_done]──→ SUMMARY
  ANY_STATE ──[user_pause]──→ PAUSED
  ANY_STATE ──[user_question]──→ USER_INTERVENTION
  USER_INTERVENTION ──[answered]──→ (previous_state)
```

#### F8 – 角色配置与模板管理

**用户故事**：用户可以创建、编辑、复用角色模板，每个角色定义了其立场、审查风格和 System Prompt。

**核心交互（三栏式编辑器）**：

| 区域 | 内容 |
|:---|:---|
| **左栏 – 属性面板** | 角色名称、头像、颜色、立场滑块（激进批判 ↔ 中立 ↔ 积极支持）、审查风格标签（严谨逻辑 / 创意发散 / 务实落地） |
| **中栏 – Prompt 编辑区** | System Prompt 编辑器（语法高亮 + 变量插入 `{{user_problem}}` `{{current_context}}`） |
| **右栏 – 实时测试** | 简易聊天窗，输入测试消息即时预览角色反应 |

**模板体系**：

- **系统预置模板**：
  - 激进用户代表（用户体验优先）
  - 保守 CFO（ROI 优先）
  - 务实 Tech Lead（技术可行性）
  - 魔鬼代言人（专门挑刺）
  - 苏格拉底导师（只提问不给答案）
  - 认知镜像者（映射思维模式）

- **用户自建模板**：基于预置模板 fork 或从零创建
- **模板分享**：导出/导入 JSON 格式

#### F9 – 可视化工作流编排

**用户故事**：高级用户可以在画布上拖拽组合方法论节点，自定义审查流程。

**核心交互**：
- 左侧方法库：可拖拽的方法论节点（提问 / 反思 / 辩论 / 评分 / 生成报告）
- 画布区：拖入节点，连线定义执行顺序
- 节点可点击配置（如：为"辩论"指定角色）
- 保存为自定义"配方"，一键运行
- 支持串行和并行分支

#### F10 – 审查报告导出

支持将审查结果导出为：
- **Markdown**：保留完整结构，可粘贴到文档系统
- **PDF**：带格式排版，适合正式分发
- **JSON**：结构化数据，供下游系统消费

---

## 三、系统架构

### 3.1 整体架构图

```
┌────────────────────────────────────────────────────────────┐
│                      Frontend (Next.js 14)                 │
│  ┌──────┐ ┌──────────┐ ┌──────────┐ ┌───────────────────┐ │
│  │ Chat │ │ Parallel │ │ Debate   │ │ Workflow Canvas   │ │
│  │ Page │ │ Compare  │ │ Arena    │ │ (React Flow)      │ │
│  └──┬───┘ └────┬─────┘ └────┬─────┘ └────────┬──────────┘ │
│     │          │            │                 │            │
│     └──────────┴────────────┴─────────────────┘            │
│                         │ SSE + REST                       │
└─────────────────────────┼──────────────────────────────────┘
                          │
┌─────────────────────────┼──────────────────────────────────┐
│                    API Gateway (FastAPI)                    │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────┐│
│  │ Chat API    │ │ Parallel API │ │ Debate Orchestrator  ││
│  │ /api/chat/* │ │ /api/compare │ │ /api/debate/*        ││
│  └──────┬──────┘ └──────┬───────┘ └──────────┬───────────┘│
│         │               │                    │             │
│  ┌──────┴───────────────┴────────────────────┴───────────┐ │
│  │              LLM Router Service                       │ │
│  │  (Provider 抽象层: OpenAI / Anthropic / Local / ...)  │ │
│  └───────────────────────┬───────────────────────────────┘ │
└──────────────────────────┼─────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────┴──────┐  ┌─────┴─────┐  ┌───────┴──────┐
   │ PostgreSQL  │  │   Redis   │  │    Celery     │
   │ (持久存储)   │  │ (Pub/Sub  │  │  (异步任务)   │
   │             │  │  + 缓存)  │  │              │
   └─────────────┘  └───────────┘  └──────────────┘
```

### 3.2 技术栈选型

| 层 | 技术 | 选型理由 |
|:---|:---|:---|
| **前端** | Next.js 14 (App Router) | RSC、SSR、现代路由 |
| **UI 组件** | shadcn/ui + Tailwind CSS | 高度可定制、轻量、一致性好 |
| **前端状态** | Zustand | 简洁、无 boilerplate、适合中等复杂度 |
| **SSE 客户端** | @microsoft/fetch-event-source | 支持 POST SSE、自动重连 |
| **工作流画布** | React Flow | 成熟的节点编辑器库 |
| **后端** | Python FastAPI | 异步原生、OpenAPI 自动文档、AI 生态最佳 |
| **任务队列（MVP）** | FastAPI BackgroundTasks + asyncio | 轻量启动，零额外依赖 |
| **任务队列（V1+）** | Celery + Redis | 多模型并行调用、高并发任务管理 |
| **数据库** | PostgreSQL | JSONB 支持、成熟可靠 |
| **缓存/Pub-Sub（V1+）** | Redis | SSE 事件分发、会话缓存 |
| **ORM** | SQLAlchemy 2.0 + Alembic | 异步支持、迁移管理 |
| **表单验证** | React Hook Form + Zod | 类型安全的表单处理 |

### 3.3 目录结构

```
review-assistant/
├── frontend/                    # Next.js 前端
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx             # 首页/仪表盘
│   │   ├── chat/
│   │   │   └── [id]/page.tsx    # 单对话页
│   │   ├── compare/
│   │   │   └── page.tsx         # 多模型对比页
│   │   ├── debate/
│   │   │   └── [id]/page.tsx    # 辩论页
│   │   ├── review/
│   │   │   └── [id]/page.tsx    # 三层审查页
│   │   └── settings/
│   │       ├── models/page.tsx  # 模型配置
│   │       └── roles/page.tsx   # 角色管理
│   ├── components/
│   │   ├── ui/                  # shadcn 基础组件
│   │   ├── chat/                # 聊天相关组件
│   │   ├── compare/             # 对比相关组件
│   │   ├── debate/              # 辩论相关组件
│   │   └── workflow/            # 工作流画布组件
│   ├── lib/
│   │   ├── api.ts               # API 客户端
│   │   ├── sse.ts               # SSE 连接管理
│   │   └── stores/              # Zustand stores
│   └── types/
│       └── index.ts             # TypeScript 类型定义
│
├── backend/                     # FastAPI 后端
│   ├── app/
│   │   ├── main.py              # FastAPI 入口
│   │   ├── config.py            # 配置管理
│   │   ├── api/
│   │   │   ├── chat.py          # 对话 API
│   │   │   ├── compare.py       # 并行对比 API
│   │   │   ├── debate.py        # 辩论 API
│   │   │   ├── review.py        # 审查报告 API
│   │   │   ├── models.py        # 模型配置 API
│   │   │   └── roles.py         # 角色管理 API
│   │   ├── core/
│   │   │   ├── llm_router.py    # LLM 供应商路由
│   │   │   ├── orchestrator.py  # 辩论/审查编排器
│   │   │   └── sse_manager.py   # SSE 事件管理
│   │   ├── models/              # SQLAlchemy 模型
│   │   ├── schemas/             # Pydantic 请求/响应模型
│   │   └── tasks/               # Celery 异步任务
│   ├── alembic/                 # 数据库迁移
│   └── tests/
│
├── docker-compose.yml
└── README.md
```

---

## 四、数据模型

### 4.1 ER 图（核心表）

```
┌──────────────────┐     ┌──────────────────────┐
│      users       │     │  llm_provider_config  │
├──────────────────┤     ├──────────────────────┤
│ id (PK)          │     │ id (PK)              │
│ username         │     │ user_id (FK)         │
│ email            │     │ provider_name        │
│ hashed_password  │     │ api_key_encrypted    │
│ created_at       │     │ base_url             │
│ updated_at       │     │ is_active            │
└────────┬─────────┘     └──────────┬───────────┘
         │                          │
         │                  ┌───────┴──────────────┐
         │                  │  llm_model_config    │
         │                  ├──────────────────────┤
         │                  │ id (PK)              │
         │                  │ provider_id (FK)     │
         │                  │ model_name           │
         │                  │ display_name         │
         │                  │ temperature          │
         │                  │ max_tokens           │
         │                  │ is_default           │
         │                  └──────────────────────┘
         │
    ┌────┴──────────────────┐
    │     conversation      │
    ├───────────────────────┤
    │ id (PK)               │
    │ user_id (FK)          │
    │ title                 │
    │ workflow_type (enum)  │  ← chat | parallel_compare | debate
    │ methodology (enum)    │  ← socratic | self_refine | premortem | ...
    │ current_stage         │
    │ metadata (JSONB)      │
    │ created_at            │
    │ updated_at            │
    └────────┬──────────────┘
             │
    ┌────────┴──────────────┐
    │       message         │
    ├───────────────────────┤
    │ id (PK)               │
    │ conversation_id (FK)  │
    │ role (enum)           │  ← user | assistant | system | critic | devil_advocate
    │ content               │
    │ model_id (FK, null)   │
    │ turn_index            │
    │ parent_message_id     │  ← 树状结构，支持追问分支
    │ root_message_id (FK)  │  ← 快速定位会话线程根节点
    │ depth (int)           │  ← 树深度，便于限制递归和快速查询
    │ annotations (JSONB)   │  ← { confidence, citations, token_count, latency_ms }
    │ created_at            │
    └───────────────────────┘

┌───────────────────────────┐     ┌───────────────────────────┐
│ review_methodology_template│     │   debate_agent_template   │
├───────────────────────────┤     ├───────────────────────────┤
│ id (PK)                   │     │ id (PK)                   │
│ user_id (FK, null)        │     │ user_id (FK, null)        │
│ name                      │     │ name                      │
│ type (enum)               │     │ role_description          │
│ system_prompt_template    │     │ system_prompt             │
│ config (JSONB)            │     │ stance (float -1~1)       │
│ is_builtin                │     │ style_tags (text[])       │
│ created_at                │     │ avatar_url                │
│ updated_at                │     │ color                     │
└───────────────────────────┘     │ is_builtin               │
                                  │ created_at                │
┌───────────────────────────┐     │ updated_at                │
│     review_report         │     └───────────────────────────┘
├───────────────────────────┤
│ id (PK)                   │
│ conversation_id (FK)      │
│ l1_summary (JSONB)        │
│ l2_summary (JSONB)        │
│ l3_summary (JSONB)        │
│ overall_score (int)       │
│ top_risks (JSONB)         │
│ action_items (JSONB)      │
│ report_data (JSONB)       │
│ report_version (int)      │  ← 支持报告迭代
│ created_at                │
│ generated_at              │
└───────────────────────────┘

┌───────────────────────────┐
│    review_feedback        │  ← 评估闭环
├───────────────────────────┤
│ id (PK)                   │
│ report_id (FK)            │
│ user_id (FK)              │
│ helpfulness_score (1-5)   │
│ actionable (bool)         │  ← 建议是否可操作
│ novel_insight (bool)      │  ← 是否提供新颖视角
│ comment (text)            │
│ created_at                │
└───────────────────────────┘
```

### 4.2 关键枚举定义

```python
class WorkflowType(str, Enum):
    CHAT = "chat"
    PARALLEL_COMPARE = "parallel_compare"
    DEBATE = "debate"
    STRUCTURED_REVIEW = "structured_review"

class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    CRITIC = "critic"
    DEVIL_ADVOCATE = "devil_advocate"
    MODERATOR = "moderator"

# methodology 字段改为 VARCHAR 而非 Enum，支持灵活扩展
# 预置值：socratic, self_refine, premortem, cognitive_mirror,
#         key_assumptions, ach, red_team, six_hats
# 新增方法论只需在模板表中添加记录，无需 schema 变更
```

---

## 五、API 设计

### 5.1 核心端点

#### 模型配置

```
GET    /api/providers                      # 列出所有 Provider
POST   /api/providers                      # 创建 Provider
PUT    /api/providers/{id}                  # 更新 Provider
DELETE /api/providers/{id}                  # 删除 Provider
POST   /api/providers/{id}/test             # 测试连接
GET    /api/providers/{id}/models           # 列出 Provider 下的模型
POST   /api/providers/{id}/models           # 添加模型配置
```

#### 对话

```
GET    /api/conversations                   # 列出对话（分页 + 搜索）
POST   /api/conversations                   # 创建新对话
GET    /api/conversations/{id}              # 获取对话详情（含消息）
DELETE /api/conversations/{id}              # 删除对话
PATCH  /api/conversations/{id}              # 更新标题等

POST   /api/conversations/{id}/messages     # 发送消息（SSE 响应流）
```

#### 多模型并行对比

```
POST   /api/compare                         # 创建并行对比任务
  Request:  { conversation_id, prompt, model_ids: [...] }
  Response: { task_group_id }

GET    /api/compare/stream?task_group_id=xxx # SSE 流
  Events: { event: "chunk", data: { model_id, text, done, token_count } }
          { event: "complete", data: { model_id, latency_ms, total_tokens } }
          { event: "error", data: { model_id, error_message } }
```

#### 多智能体辩论

```
POST   /api/debates                         # 创建辩论会话
  Request: {
    conversation_id,
    topic,
    agent_ids: [...],
    rounds: 3,
    mode: "free" | "structured" | "roundtable"
  }

GET    /api/debates/{id}/stream             # SSE 辩论实时流
  Events: { event: "speaking", data: { agent_id, round, text } }
          { event: "round_end", data: { round, summary } }
          { event: "debate_end", data: { consensus, disputes, risks } }

POST   /api/debates/{id}/pause              # 暂停辩论
POST   /api/debates/{id}/resume             # 恢复辩论
POST   /api/debates/{id}/intervene          # 用户介入
  Request: { target_agent_id, question }
```

#### 审查报告

```
POST   /api/reviews                         # 启动三层审查
  Request: { conversation_id, document_text, methodology_ids: [...] }

GET    /api/reviews/{id}/stream             # SSE 审查进度流
  Events: { event: "layer_start", data: { layer: "L1" } }
          { event: "finding", data: { layer, issue, severity } }
          { event: "layer_complete", data: { layer, summary } }
          { event: "feedback_loop", data: { from: "L3", to: "L1", reason } }

GET    /api/reviews/{id}/report             # 获取完整报告
GET    /api/reviews/{id}/export?format=pdf  # 导出报告
```

#### 角色模板

```
GET    /api/roles                           # 列出所有角色模板
POST   /api/roles                           # 创建角色
PUT    /api/roles/{id}                      # 更新角色
DELETE /api/roles/{id}                      # 删除角色
POST   /api/roles/{id}/test                 # 测试角色反应
  Request: { test_message }
  Response (SSE): { text chunks }
```

---

## 六、页面设计

### 6.1 页面清单

| 页面 | 路由 | 核心组件 | 阶段 |
|:---|:---|:---|:---|
| 首页/仪表盘 | `/` | 快速启动卡片、最近对话 | MVP |
| 对话页 | `/chat/[id]` | 消息流、模型选择器 | MVP |
| 模型设置 | `/settings/models` | Provider 列表、模型表单 | MVP |
| 多模型对比 | `/compare` | 列式响应面板、对比工具栏 | V1 |
| 审查报告 | `/review/[id]` | 进程管道图、层级详情 | V1 |
| 辩论场 | `/debate/[id]` | 时间线群聊、角色侧栏 | V2 |
| 角色管理 | `/settings/roles` | 三栏编辑器、模板列表 | V2 |
| 工作流编排 | `/workflow` | React Flow 画布 | V2 |

### 6.2 关键页面布局

#### 对话页（MVP）

```
┌─────────────────────────────────────────────────────────┐
│  [Logo]  Review Assistant         [Model ▾]  [⚙ Settings]│
├──────────┬──────────────────────────────────────────────┤
│          │                                              │
│ 今天      │    ┌─────────────────────────────────────┐   │
│  对话 1   │    │ 👤 请审查我的游戏系统设计...            │   │
│  对话 2   │    └─────────────────────────────────────┘   │
│          │    ┌─────────────────────────────────────┐   │
│ 昨天      │    │ 🤖 我注意到以下几个需要关注的点：       │   │
│  对话 3   │    │    1. 核心循环的反馈延迟...             │   │
│  对话 4   │    │    2. 经济系统缺少...                  │   │
│          │    └─────────────────────────────────────┘   │
│ 更早      │                                              │
│  ...     │                                              │
│          │                                              │
│          ├──────────────────────────────────────────────┤
│ [🔍搜索]  │  [📎] [输入消息...                   ] [发送] │
└──────────┴──────────────────────────────────────────────┘
```

#### 多模型对比页（V1）

```
┌─────────────────────────────────────────────────────────────────┐
│  [← 返回]  多模型对比     [模型: ☑GPT-4o ☑Claude ☑Gemini]       │
├─────────────────────────────────────────────────────────────────┤
│  工具栏: [🔄同步滚动] [🔍差异高亮] [📋导出对比]                     │
├────────────────────┬───────────────────┬────────────────────────┤
│   GPT-4o           │   Claude 3.5      │   Gemini Pro           │
│   ⏱ 2.3s │ 847 tok │   ⏱ 1.8s │ 923 tok│   ⏱ 3.1s │ 756 tok   │
├────────────────────┼───────────────────┼────────────────────────┤
│                    │                   │                        │
│  该方案在核心循环   │  从用户体验角度    │  技术层面来看，该        │
│  设计上存在以下     │  分析，这个系统    │  架构方案需要考虑        │
│  几个值得关注的     │  设计的主要问题    │  以下技术债务风险        │
│  风险点...         │  集中在...        │  ...                   │
│                    │                   │                        │
│                    │                   │                        │
│  [👍 标记更优]      │  [👍 标记更优]     │  [👍 标记更优]          │
├────────────────────┴───────────────────┴────────────────────────┤
│  [📎] [输入下一个对比问题...                            ] [发送]  │
└─────────────────────────────────────────────────────────────────┘
```

#### 辩论场页面（V2）

```
┌─────────────────────────────────────────────────────────────────┐
│  [← 返回]  辩论场: "电商推荐算法方案"    [⏸暂停] [⏹结束] [📊总结]  │
├──────────┬──────────────────────────────────────────┬───────────┤
│ 参与角色  │                                          │ 辩论进度   │
│          │   ── Round 1 ────────────────────────     │           │
│ 🔴 批判者 │   🔴 批判者                                │ Round 1 ✓ │
│   活跃    │   ┌────────────────────────────────┐     │ Round 2 ✓ │
│          │   │ 这个推荐算法方案最大的隐患在     │     │ Round 3 ● │
│ 🟢 支持者 │   │ 于特征工程的维护成本...          │     │           │
│   活跃    │   └────────────────────────────────┘     │ ── 进度 ──│
│          │                                          │ ████░░ 60%│
│ 🔵 专家   │   🟢 支持者                                │           │
│   活跃    │   ┌────────────────────────────────┐     │           │
│          │   │ 我不同意批判者的观点。方案中     │     │           │
│ ⚫ 魔鬼   │   │ 已经考虑了特征漂移的问题...      │     │           │
│   静音    │   └────────────────────────────────┘     │           │
│          │                  ...                     │           │
│ ─────── │                                          │           │
│ [+追问]  │   🔵 专家 💭 正在思考...                    │           │
│ [静音/激活]│                                          │           │
├──────────┼──────────────────────────────────────────┤           │
│          │  [追问特定角色 ▾] [输入...        ] [发送] │           │
└──────────┴──────────────────────────────────────────┴───────────┘
```

#### 三层审查页面（V1）

```
┌──────────────────────────────────────────────────────────────────┐
│  [← 返回]  方案审查: "新手引导系统 V2"       [📥导出报告]          │
├──────────────────────────────────────┬───────────────────────────┤
│                                      │   审查进程                 │
│  ┌── L1: 基础合规检查（已完成）─────┐   │   ┌─────────────┐       │
│  │ ✅ 发现 12 个问题                 │   │   │  L1 ████ ✓  │       │
│  │    🔴 严重 2  🟡 中等 5  🟢 低 5  │   │   │  基础合规    │       │
│  │ 展开查看详情 ▾                   │   │   └──────┬──────┘       │
│  └──────────────────────────────────┘   │          ↕ 反馈         │
│                                        │   ┌──────┴──────┐       │
│  ┌── L2: 逻辑与假设挑战（进行中）────┐   │   │  L2 ██░░ ●  │       │
│  │ 📋 已提取 7 个核心假设             │   │   │  假设挑战    │       │
│  │ ❓ 假设 #3 "用户会完成引导流程"    │   │   └──────┬──────┘       │
│  │    → 苏格拉底提问进行中...         │   │          ↕ 反馈         │
│  │                                   │   │   ┌──────┴──────┐       │
│  │ 👤: 因为我们有引导奖励机制        │   │   │  L3 ░░░░    │       │
│  │ 🤖: 奖励机制在第几步生效？        │   │   │  待启动      │       │
│  │     如果用户在奖励触发前就流       │   │   └─────────────┘       │
│  │     失了呢？                      │   │                         │
│  │                                   │   │   ── 反馈日志 ──        │
│  └──────────────────────────────────┘   │   L2→L1: 补充检查        │
│                                        │   发现引导流程缺少        │
│  ┌── L3: 压力测试（待启动）──────────┐   │   退出路径定义           │
│  │ ⏳ 等待 L2 完成                    │   │                        │
│  └──────────────────────────────────┘   │                         │
├──────────────────────────────────────┴───────────────────────────┤
│  [输入补充说明或回答追问...                              ] [发送]  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 七、LLM 路由器设计

### 7.1 Provider 抽象层

```python
class LLMProvider(ABC):
    """所有 LLM 供应商的基类"""

    @abstractmethod
    async def stream_chat(
        self,
        messages: list[dict],
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> AsyncGenerator[str, None]:
        """流式对话，yield 文本片段"""
        ...

    @abstractmethod
    async def test_connection(self) -> bool:
        """测试 API 连接是否正常"""
        ...


class OpenAIProvider(LLMProvider):
    """OpenAI / 兼容 API (Azure, 本地 vLLM 等)"""
    ...

class AnthropicProvider(LLMProvider):
    """Anthropic Claude"""
    ...

class LLMRouter:
    """根据 model_config 路由到正确的 Provider"""

    def get_provider(self, model_config: LLMModelConfig) -> LLMProvider:
        provider_map = {
            "openai": OpenAIProvider,
            "anthropic": AnthropicProvider,
            # 可扩展更多 Provider
        }
        return provider_map[model_config.provider.provider_name](
            api_key=decrypt(model_config.provider.api_key_encrypted),
            base_url=model_config.provider.base_url,
        )
```

### 7.2 安全要求

- API Key 使用 AES-256-GCM 加密存储，环境变量管理加密密钥
- 前端永远不传输/显示明文 API Key
- 所有 LLM 请求通过后端代理，前端不直接调用外部 API
- 请求限速（per-user rate limiting）防止滥用

---

## 八、分阶段实施计划

### 8.1 MVP — 核心对话能力验证

**目标**：验证端到端 pipeline 可工作  
**交付内容**：

| 功能 | 详情 |
|:---|:---|
| 模型配置 | 支持 1 种 Provider（OpenAI 兼容 API），可配置 API Key 和模型 |
| 基础对话 | 单模型 SSE 流式对话 |
| 对话历史 | 列表展示、自动命名、删除 |
| 方法论（轻量）| 内置 1-2 个 System Prompt 模板（Pre-Mortem + 苏格拉底提问），通过对话页顶部切换 |

**技术验证点**：
- Next.js ↔ FastAPI 全链路 SSE 流式响应
- PostgreSQL 对话持久化
- 基础部署流程（Docker Compose）

**页面**：对话页 + 模型设置页

**MVP 技术栈简化**：
- 不引入 Redis / Celery，使用 FastAPI `BackgroundTasks` + `asyncio` 管理异步调用
- 单进程部署即可运行（PostgreSQL + FastAPI + Next.js）
- 当并发需求增长时，平滑迁移到 Celery + Redis

**预估工作量**：2-3 周

---

### 8.2 V1 — 多模型 + 结构化审查

**目标**：多模型对比和三层审查系统上线  
**交付内容**：

| 功能 | 详情 |
|:---|:---|
| 多 Provider 支持 | OpenAI + Anthropic + 自定义 API |
| 多模型并排对比 | 列式布局、SSE 并行流、同步滚动、标记更优 |
| 审查方法论扩展 | 全部 8 种方法论模板 |
| L1/L2/L3 审查 | 三层渐进审查 + 进程管道可视化 |
| 报告生成 | 结构化审查报告 + Markdown 导出 |

**技术要求**：
- Celery 并行任务（多模型同时调用）
- Redis Pub/Sub → SSE 事件分发
- 审查流程状态管理

**页面新增**：多模型对比页 + 审查报告页

**预估工作量**：4-6 周

---

### 8.3 V2 — 辩论引擎 + 高级功能

**目标**：多智能体辩论、角色系统、工作流编排  
**交付内容**：

| 功能 | 详情 |
|:---|:---|
| 多智能体辩论 | 状态机编排、时间线群聊 UI、用户介入控制 |
| 角色系统 | 三栏编辑器、预置模板 + 自建、实时测试 |
| 工作流编排 | React Flow 画布、方法论节点拖拽组合 |
| 报告导出增强 | PDF 导出、差异高亮对比 |
| 搜索增强 | 全文搜索对话和报告内容 |

**技术要求**：
- Orchestrator 状态机（辩论流程管理）
- React Flow 集成（工作流画布）
- PDF 生成（WeasyPrint / Puppeteer）

**页面新增**：辩论场 + 角色管理 + 工作流编排

**预估工作量**：6-8 周

---

## 九、非功能需求

### 9.1 性能

| 指标 | 目标 |
|:---|:---|
| SSE 首字延迟 | < 2s（取决于 LLM 供应商） |
| 页面加载 | < 1.5s（首屏） |
| 并行对比 | 支持 4 模型同时流式响应 |
| 辩论场 | 支持 5 角色 × 5 轮辩论 |

### 9.2 安全

- API Key 加密存储（AES-256-GCM），支持用户自带密钥（BYOK）
- 用户认证（JWT）
- HTTPS 强制
- CORS 仅允许前端域名
- **速率限制**：per-user API 调用限频 + 模型调用预算上限
- **Prompt Injection 防护**：
  - 架构层沙箱化提示词组装：系统指令、用户输入、方案文本严格分隔
  - 使用特殊标记隔离（`<!-- system -->` / `<!-- user_solution -->`）
  - 输出结构化验证，防止 JSON 注入
- **审计日志**：记录所有 LLM 调用（输入摘要、模型、token 消耗、输出摘要），支持事后分析和 Prompt 优化
- **输入净化**：方案文本长度限制 + 恶意内容检测

### 9.3 部署

- Docker Compose（开发/小规模部署）
- 支持单机部署（PostgreSQL + Redis + FastAPI + Next.js 全在一台 VPS）
- 环境变量管理所有密钥

### 9.4 可扩展性

- LLM Provider 接口设计（新增供应商只需实现 `LLMProvider` 基类）
- 方法论模板可扩展（数据库驱动，无需改代码）
- 角色模板可扩展（用户自建 + 导入导出）

---

## 十、技术风险与应对

| 风险 | 影响 | 应对策略 |
|:---|:---|:---|
| LLM API 不稳定/超时 | 对话中断、用户体验差 | 重试机制 + 超时策略 + 错误状态 UI |
| 多模型并行时资源消耗大 | 服务器负载高 | Celery worker 数量限制 + 队列排队 |
| 辩论状态机复杂度 | Bug 难排查 | 状态机日志 + 可视化调试面板 |
| SSE 连接断开 | 流式响应中断 | 自动重连 + 断点续传（消息 ID 标记）|
| 前端多列同步渲染性能 | 页面卡顿 | React 虚拟化列表 + 节流渲染 |

---

## 十一、评估与质量闭环

### 11.1 审查质量评估

每次审查完成后，系统提供轻量级反馈入口（`review_feedback` 表）：

| 评估项 | 类型 | 说明 |
|:---|:---|:---|
| helpfulness_score | 1-5 | 审查报告的整体有用程度 |
| actionable | bool | 建议是否具体到可执行 |
| novel_insight | bool | 是否提供了超出用户已知范围的视角 |
| comment | text | 自由文字反馈 |

### 11.2 自动化评估管道（V2+）

定义 3-5 个二元评估标准，定期抽样自动评估：
- 报告是否包含风险评估？
- 建议是否指向方案中的具体位置？
- 假设提取是否覆盖了核心决策点？
- 是否存在事实性幻觉？

### 11.3 Prompt 版本化与优化循环

- 每个方法论模板的 System Prompt 记录版本号
- 基于用户反馈数据，识别低分模板 → 修改 Prompt → 用历史案例回归测试 → 保留改进版本
- 长期目标：建立 Design CriticBench 评估基准

---

## 十二、后续演进方向

以下功能不在 V2 范围内，但作为长期方向记录：

1. **团队协作**：多人共享对话和审查报告，评论批注
2. **RAG 知识库**：接入团队内部文档、设计规范、历史案例作为审查上下文
3. **认知流感知**：根据用户交互节奏动态调节 AI 介入时机
4. **评估基准**：建立 Design CriticBench，量化评估 AI 审查质量
5. **飞书/Notion 集成**：直接在文档编辑器中触发审查
6. **语音辩论**：TTS 朗读辩论发言，模拟真人会议体验
7. **fine-tune 审查模型**：基于用户反馈数据训练专用审查模型
