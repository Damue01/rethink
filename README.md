# ReThink

一个基于多 LLM 的方案思辨工具，支持自由对话、多模型并行对比、苏格拉底式追问分析和多角色辩论，帮助用户从多维度发现方案中的盲点和风险。集成 MCP (Model Context Protocol) 工具调用能力，可外接知识检索等扩展服务。

## 功能特性

### 核心模式

| 模式 | 路由 | 说明 |
|------|------|------|
| **自由对话** | `/chat/:id` | 流式对话，支持方法论与 Skill 注入 |
| **多模型对比** | `/compare/:id` | 同一问题并排发送给多个模型，对比输出 |
| **苏格拉底分析** | `/review/:id` | 连续追问式分析，发现隐含假设与逻辑漏洞（开发中，导航暂隐藏） |
| **多智能体辩论** | `/debate/:id` | 多角色结构化辩论（批判者 / 支持者 / 技术专家 / 魔鬼代言人等） |

### 内置方法论

- **苏格拉底提问** 🧠 — 通过连续追问引导用户自行发现问题
- **Pre-Mortem** 💀 — 假设方案已失败，倒推失败原因和被忽略的风险
- **Self-Refine** 🔄 — 思考→自我批评→改进的完整迭代过程
- **红队分析** 🔴 — 以对抗性角色主动寻找漏洞和攻击面
- **认知镜像** 👁 — 提取隐含假设，标注认知偏差和思维盲区
- **关键假设检查** 🔑 — 逐一识别和审查方案依赖的核心假设，按确定性×影响度评级
- **竞争性假设分析 (ACH)** ⚖️ — 列出多个竞争性假设，用证据矩阵逐一排除
- **六顶思考帽** 💡 — 从六个不同维度（事实/直觉/风险/价值/创新/全局）系统化审视方案

方法论可在 `设置 > 方法论` 中自定义增删。

### Skill 知识注入

- 在对话、对比、辩论页面中可随时加载预定义的知识片段（Skill）
- 支持分类管理、关键词搜索、实时编辑
- Skill 内容使用 Markdown + Frontmatter 格式（name / description / category）
- 内置默认 Skill：游戏设计分析、PRD 质量分析

### MCP 工具集成

支持 [Model Context Protocol](https://modelcontextprotocol.io/) 的 HTTP Streamable transport，可连接外部 MCP 服务器扩展 AI 能力：

- JSON-RPC 2.0 协议，支持 `initialize` / `tools/list` / `tools/call`
- 在 `设置 > MCP` 中用 JSONC 格式配置服务器（支持注释）
- 内置连接测试和工具发现
- 支持自定义请求头（如认证 Token）

### 设置管理

| 页面 | 路由 | 说明 |
|------|------|------|
| **模型管理** | `/settings/models` | 添加多个 OpenAI 兼容 Provider，配置 API Key / Base URL / 模型名，支持动态获取模型列表和连接测试 |
| **角色模板** | `/settings/roles` | 配置辩论角色的 system prompt，支持 `{{user_problem}}` / `{{current_context}}` 变量注入 |
| **Skill 管理** | `/settings/skills` | 管理可注入对话的知识片段，支持分类和实时编辑 |
| **方法论管理** | `/settings/methodologies` | 管理审查方法论模板 |
| **MCP 配置** | `/settings/mcp` | 配置 MCP 服务器连接、测试工具发现 |

## 技术栈

- **前端框架**: React 18.3 + TypeScript
- **构建工具**: Vite 6.3
- **样式**: TailwindCSS 4.x + Radix UI + shadcn/ui 组件库
- **路由**: React Router 7.x
- **Markdown 渲染**: react-markdown + remark-gfm
- **代码编辑器**: CodeMirror 6（用于 MCP JSON 配置编辑）
- **LLM 集成**: OpenAI 兼容 API（流式响应 + reasoning token），通过 Vite 代理中间件解决 CORS
- **MCP 集成**: JSON-RPC 2.0 over HTTP Streamable transport，通过 Vite 代理转发
- **生产运行层**: Node.js 内嵌 HTTP 服务（用于 `/llm-proxy`、`/mcp-proxy`、`/builtin-tools/execute`）
- **桌面打包**: Electron + electron-builder（Windows 绿色版）
- **数据持久化**: localStorage

> 开发模式下仍然是 Vite SPA；生产环境不再是纯静态站点，而是通过内嵌 Node.js 服务提供代理与内置工具能力。

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

访问 `http://localhost:5133/`

### 开发环境说明

- 开发态地址为 `http://localhost:5133/`
- 桌面版运行时地址为 `http://localhost:5133/`
- 开发环境与桌面版统一使用 `http://localhost:5133/`，localStorage 配置可直接复用

### 首次使用

1. 进入 **设置 > 模型管理**，添加至少一个 LLM Provider（任何 OpenAI 兼容 API 均可）
2. 填入 Base URL、API Key、选择模型
3. 点击「测试连接」确认可用
4. （可选）进入 **设置 > MCP**，配置外部 MCP 工具服务器
5. 返回首页，开始使用各审查模式

## 构建与打包

### Web 构建

```bash
npm run build
```

输出到 `dist/` 目录。

### 本地启动生产服务

```bash
npm run build
npm start
```

- 默认启动地址：`http://localhost:5133/`
- 该模式会提供生产环境所需的 3 个服务端端点：`/llm-proxy`、`/mcp-proxy`、`/builtin-tools/execute`

### 打包 Windows 绿色版

```bash
npm run electron:build
```

打包流程会自动执行：

1. 生成统一图标资源（`build/icons/generated/`）
2. 构建前端静态资源（`dist/`）
3. 打包 Electron 绿色版

输出目录：`release/win-unpacked/`

直接分发整个 `release/win-unpacked/` 文件夹即可，入口文件为：`release/win-unpacked/ReThink.exe`

当前打包策略：

- 不生成 `setup` 安装包
- 不额外生成 zip
- Electron 使用固定端口 `5133`
- 启用单实例保护，重复双击只会唤起已有窗口，不会重复抢占端口
- 窗口图标、favicon、exe 图标统一来自 `app-256` / `app.ico`

## 项目结构

```
src/
├── main.tsx                    # 入口
├── app/
│   ├── App.tsx                 # 根组件
│   ├── routes.tsx              # 路由定义
│   ├── components/
│   │   ├── Dashboard.tsx       # 首页仪表盘
│   │   ├── ChatPage.tsx        # 自由对话
│   │   ├── ComparePage.tsx     # 多模型对比
│   │   ├── ReviewPage.tsx      # 苏格拉底审查（开发中）
│   │   ├── DebatePage.tsx      # 多角色辩论
│   │   ├── SkillPanel.tsx      # Skill 侧边栏（加载/搜索/分类）
│   │   ├── skillData.ts        # Skill 数据管理与迁移
│   │   ├── EmojiPicker.tsx     # Emoji 选择器
│   │   ├── SettingsModels.tsx  # 模型管理
│   │   ├── SettingsRoles.tsx   # 角色模板
│   │   ├── SettingsSkills.tsx  # Skill 管理
│   │   ├── SettingsMethodologies.tsx  # 方法论管理
│   │   ├── SettingsMCP.tsx     # MCP 服务器配置
│   │   └── ui/                 # shadcn/ui 基础组件
│   └── services/
│       ├── llm.ts              # LLM API 调用（流式 + reasoning token）
│       ├── llmConfig.ts        # Provider 配置管理
│       ├── mcp.ts              # MCP JSON-RPC 客户端
│       ├── mcpConfig.ts        # MCP 服务器配置管理
│       ├── methodologies.ts    # 方法论数据
│       └── roles.ts            # 角色模板数据
└── styles/                     # 全局样式
```

## 代理机制

开发模式下，LLM 和 MCP 请求分别通过 Vite 中间件代理转发：

### LLM 代理 (`/llm-proxy`)

- 前端通过 `X-LLM-Target` 请求头指定目标 API 的 origin
- 代理插件读取该 header，将请求转发到对应的上游服务
- 支持同时配置多个不同厂商的 API（OpenAI、Anthropic、本地模型等）

### MCP 代理 (`/mcp-proxy`)

- 前端通过 `X-MCP-Target` 请求头指定目标 MCP 服务器
- 代理插件转发 JSON-RPC 请求并处理 CORS

桌面版打包时不需要额外配置 Nginx；Electron 内嵌服务会直接提供这些端点。

## 数据存储

所有数据存储在浏览器 localStorage 中：

| Key | 内容 |
|-----|------|
| `ai-review-llm-config` | Provider / Model 配置 |
| `ai-review-conversations` | 对话历史 |
| `ai-review-compare-conversations` | 对比会话历史 |
| `ai-review-debate-conversations` | 辩论会话历史 |
| `ai-review-skills` | Skill 数据 |
| `ai-review-skill-categories` | Skill 分类 |
| `ai-review-roles` | 角色模板 |
| `ai-review-methodologies` | 方法论配置 |
| `ai-review-mcp-config` | MCP 服务器配置 |

## License

Private project.