import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import {
  ArrowLeft, Download, CheckCircle2, Clock, ChevronDown,
  ChevronUp, Sparkles, User, Loader2
} from "lucide-react";
import { SkillPanel, SkillBadges } from "./SkillPanel";
import { getDefaultModel } from "../services/llmConfig";
import { chatCompletionStream } from "../services/llm";
import { defaultSkills } from "./skillData";
import { ConversationComposer } from "./ui/conversation-composer";

type Layer = "L1" | "L2" | "L3";

const l1Issues = [
  { id: 1, text: "引导流程缺少退出路径定义", severity: "high" },
  { id: 2, text: "奖励数值未标注来源依据", severity: "high" },
  { id: 3, text: "跳过机制的'老玩家'定义模糊", severity: "medium" },
  { id: 4, text: "教学步骤缺少容错设计", severity: "medium" },
  { id: 5, text: "多语言适配未提及", severity: "medium" },
  { id: 6, text: "引导时长预估缺失", severity: "medium" },
  { id: 7, text: "无障碍访问未考虑", severity: "medium" },
  { id: 8, text: "文档版本号缺失", severity: "low" },
  { id: 9, text: "截图示例不完整", severity: "low" },
  { id: 10, text: "术语表未提供", severity: "low" },
  { id: 11, text: "引用数据源过时", severity: "low" },
  { id: 12, text: "格式不符合模板规范", severity: "low" },
];

const l2Assumptions = [
  { id: 1, text: "用户会完成全部12步引导", status: "questioning" },
  { id: 2, text: "钻石奖励足以激励用户", status: "pending" },
  { id: 3, text: "老玩家不需要引导", status: "pending" },
  { id: 4, text: "线性引导优于自由探索", status: "pending" },
  { id: 5, text: "所有新用户游戏经验相似", status: "pending" },
  { id: 6, text: "引导内容不需要个性化", status: "pending" },
  { id: 7, text: "12步足以覆盖核心机制", status: "pending" },
];

interface DialogueMsg {
  role: "assistant" | "user";
  text: string;
}

const initialDialogue: DialogueMsg[] = [
  { role: "assistant", text: "让我们来检验假设 #1：\"用户会完成全部12步引导\"。\n\n请问，您对用户完成引导流程的信心来源于什么数据或经验？" },
  { role: "user", text: "因为我们有引导奖励机制，完成后发放钻石 ×100" },
  { role: "assistant", text: "奖励机制在第几步生效？如果用户在奖励触发前就流失了呢？\n\n行业数据显示：\n- 手游新手引导平均完成率约 40-60%\n- 超过 5 步的强制引导，每多一步流失率增加 8-12%\n\n您的12步设计是否有相似产品的对比数据支撑？" },
];

const feedbackLogs = [
  { from: "L2", to: "L1", text: "补充检查：发现引导流程缺少退出路径定义", time: "14:32" },
  { from: "L2", to: "L1", text: "老玩家判定标准需补充到合规检查项", time: "14:28" },
];

export function ReviewPage() {
  const navigate = useNavigate();
  const [activeLayer, setActiveLayer] = useState<Layer>("L2");
  const [l1Expanded, setL1Expanded] = useState(false);
  const [input, setInput] = useState("");
  const [activeAssumptionId, setActiveAssumptionId] = useState(1);
  const [dialogueMap, setDialogueMap] = useState<Record<number, DialogueMsg[]>>({
    1: initialDialogue,
  });
  const dialogue = dialogueMap[activeAssumptionId] ?? [];
  const setDialogue = (updater: DialogueMsg[] | ((prev: DialogueMsg[]) => DialogueMsg[])) => {
    setDialogueMap((prev) => ({
      ...prev,
      [activeAssumptionId]: typeof updater === "function" ? updater(prev[activeAssumptionId] ?? []) : updater,
    }));
  };
  const [isTyping, setIsTyping] = useState(false);
  const [skillPanelOpen, setSkillPanelOpen] = useState(false);
  const [activeSkillIds, setActiveSkillIds] = useState<string[]>([]);
  const dialogueEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogueEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dialogue]);

  const severityColor = (s: string) =>
    s === "high" ? "bg-[#fef2f2] text-[#dc2626]" : s === "medium" ? "bg-[#fffbeb] text-[#b45309]" : "bg-[#f0fdf4] text-[#16a34a]";
  const severityLabel = (s: string) => (s === "high" ? "严重" : s === "medium" ? "中等" : "低");

  const buildSystemPrompt = useCallback(() => {
    let prompt = `你是一位资深的苏格拉底式方案评审专家。你的任务是通过提问帮助方案作者发现自己方案中的隐含假设和潜在风险。

规则：
1. 每次只针对一个具体假设进行追问
2. 引用行业数据或最佳实践来支撑你的提问
3. 不要直接给出答案，而是引导作者自己思考
4. 当作者充分回答后，总结该假设的审查结论，然后转向下一个假设
5. 语气专业但友好

当前正在审查的假设列表：
${l2Assumptions.map((a) => `#${a.id}: ${a.text}`).join("\n")}`;

    if (activeSkillIds.length > 0) {
      const skills = defaultSkills.filter((s) => activeSkillIds.includes(s.id));
      if (skills.length > 0) {
        prompt += "\n\n## 已加载的 Skill 知识库（用于引用行业标准和数据）：\n";
        for (const skill of skills) {
          prompt += `\n### ${skill.name}\n`;
          for (const doc of skill.documents) {
            prompt += `**${doc.name}**:\n${doc.content}\n\n`;
          }
        }
      }
    }
    return prompt;
  }, [activeSkillIds]);

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg: DialogueMsg = { role: "user", text: input };
    setDialogue((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    const defaultModel = getDefaultModel();
    if (!defaultModel) {
      setDialogue((prev) => [
        ...prev,
        { role: "assistant", text: "**错误**: 未配置 LLM 模型。请先在设置中配置模型和 API Key。" },
      ]);
      setIsTyping(false);
      return;
    }

    const { provider, model } = defaultModel;
    const systemPrompt = buildSystemPrompt();
    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...dialogue.map((d) => ({ role: d.role as "user" | "assistant", content: d.text })),
      { role: "user" as const, content: input },
    ];

    // Add streaming assistant message
    setDialogue((prev) => [...prev, { role: "assistant", text: "" }]);

    chatCompletionStream(
      {
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        model: model.name,
        messages,
        temperature: model.temperature,
        maxTokens: model.maxTokens,
      },
      {
        onToken(token) {
          setDialogue((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = { ...last, text: last.text + token };
            }
            return updated;
          });
        },
        onDone() {
          setIsTyping(false);
        },
        onError(err) {
          setDialogue((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = { ...last, text: `**错误**: ${err.message}` };
            }
            return updated;
          });
          setIsTyping(false);
        },
      },
    );
  };

  const toggleSkill = (skillId: string) => {
    setActiveSkillIds((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
    );
  };

  const layerConfig = [
    {
      key: "L1" as Layer,
      label: "L1: 基础合规检查",
      sublabel: "12 个问题",
      status: "done",
      progress: 100,
    },
    {
      key: "L2" as Layer,
      label: "L2: 逻辑与假设挑战",
      sublabel: "7 个假设 · 分析中",
      status: "active",
      progress: 30,
    },
    {
      key: "L3" as Layer,
      label: "L3: 创造性拓展",
      sublabel: "等待 L2 完成",
      status: "pending",
      progress: 0,
    },
  ];

  return (
    <div className="flex flex-col h-full bg-white font-['Inter',sans-serif]">
      {/* Header */}
      <div className="h-[44px] border-b border-[#ebebeb] flex items-center px-4 gap-3 bg-white shrink-0">
        <button onClick={() => navigate("/")} className="text-[#667085] hover:text-[#0a0a0a] transition-colors">
          <ArrowLeft className="w-[15px] h-[15px]" />
        </button>
        <span className="text-[13px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>方案深度分析</span>
        <span className="text-[12px] text-[#717182]" style={{ fontWeight: 400 }}>"新手引导系统 V2"</span>

        <div className="w-px h-[20px] bg-[#ebebeb] ml-2" />

        {/* Skill badges */}
        <SkillBadges activeSkillIds={activeSkillIds} onOpenPanel={() => setSkillPanelOpen(true)} />

        <div className="ml-auto">
          <button className="flex items-center gap-1.5 px-3 py-[5px] bg-[#030213] text-white rounded-[7px] text-[12px] hover:bg-[#1a1a2e] transition-colors" style={{ fontWeight: 500 }}>
            <Download className="w-[12px] h-[12px]" />
            导出报告
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left - Layer Progress */}
        <div className="w-[200px] bg-white border-r border-[#ebebeb] flex flex-col shrink-0">
          <div className="p-4 flex-1">
            <p className="text-[11px] text-[#8a9193] mb-3" style={{ fontWeight: 500 }}>分析层级</p>
            <div className="space-y-1">
              {layerConfig.map((layer) => (
                <button
                  key={layer.key}
                  onClick={() => setActiveLayer(layer.key)}
                  className={`w-full rounded-[8px] p-3 text-left transition-colors ${
                    activeLayer === layer.key ? "bg-[#f3f3f5]" : "hover:bg-[#f8fafb]"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {layer.status === "done" && <CheckCircle2 className="w-[13px] h-[13px] text-[#10b981]" />}
                    {layer.status === "active" && (
                      <div className="w-[13px] h-[13px] rounded-full border-[1.5px] border-[#030213] flex items-center justify-center">
                        <div className="w-[5px] h-[5px] rounded-full bg-[#030213] animate-pulse" />
                      </div>
                    )}
                    {layer.status === "pending" && <Clock className="w-[13px] h-[13px] text-[#d0d5dd]" />}
                    <span className="text-[11.5px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>{layer.key}</span>
                  </div>
                  <p className="text-[10.5px] text-[#717182] ml-[21px]" style={{ fontWeight: 400 }}>
                    {layer.sublabel}
                  </p>
                  {layer.progress > 0 && (
                    <div className="ml-[21px] mt-1.5 h-[2.5px] bg-[#f3f3f5] rounded-full overflow-hidden">
                      <div className="h-full bg-[#030213] rounded-full transition-all" style={{ width: `${layer.progress}%` }} />
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Feedback Logs */}
            <div className="mt-6">
              <p className="text-[10px] text-[#8a9193] mb-2" style={{ fontWeight: 500 }}>反馈日志</p>
              <div className="space-y-2">
                {feedbackLogs.map((log, i) => (
                  <div key={i} className="text-[10px] px-2 py-1.5 rounded-[6px] bg-[#f8fafb]">
                    <div className="flex items-center gap-1 text-[#0a0a0a]" style={{ fontWeight: 500 }}>
                      {log.from} → {log.to}
                      <span className="text-[#8a9193] ml-auto" style={{ fontWeight: 400 }}>{log.time}</span>
                    </div>
                    <p className="text-[#717182] mt-0.5" style={{ fontWeight: 400 }}>{log.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Center - Main Content */}
        <div className="flex-1 flex flex-col bg-[#f8fafb] min-w-0 overflow-hidden">
          {activeLayer === "L1" && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-[640px] mx-auto">
                <div className="bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)]">
                  <div className="px-5 py-4 flex items-center justify-between border-b border-[rgba(0,0,0,0.06)]">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-[16px] h-[16px] text-[#10b981]" />
                      <span className="text-[13px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>基础合规检查 · 已完成</span>
                    </div>
                    <div className="flex gap-1.5">
                      <span className="text-[10px] px-[5px] py-[1px] rounded-[3px] bg-[#fef2f2] text-[#dc2626]" style={{ fontWeight: 500 }}>严重 2</span>
                      <span className="text-[10px] px-[5px] py-[1px] rounded-[3px] bg-[#fffbeb] text-[#b45309]" style={{ fontWeight: 500 }}>中等 5</span>
                      <span className="text-[10px] px-[5px] py-[1px] rounded-[3px] bg-[#f0fdf4] text-[#16a34a]" style={{ fontWeight: 500 }}>低 5</span>
                    </div>
                  </div>
                  <div className="divide-y divide-[rgba(0,0,0,0.04)]">
                    {l1Issues.map((issue) => (
                      <div key={issue.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-[#fafafa] transition-colors">
                        <span className={`text-[10px] px-[6px] py-[2px] rounded-[3px] shrink-0 ${severityColor(issue.severity)}`} style={{ fontWeight: 500 }}>
                          {severityLabel(issue.severity)}
                        </span>
                        <span className="text-[12.5px] text-[#0a0a0a]" style={{ fontWeight: 400 }}>{issue.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeLayer === "L2" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Assumptions bar */}
              <div className="px-5 py-3 bg-white border-b border-[#ebebeb] shrink-0">
                <p className="text-[11px] text-[#8a9193] mb-2" style={{ fontWeight: 500 }}>核心假设列表</p>
                <div className="flex flex-wrap gap-1.5">
                  {l2Assumptions.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        setActiveAssumptionId(a.id);
                        if (!dialogueMap[a.id]) {
                          setDialogueMap((prev) => ({
                            ...prev,
                            [a.id]: [
                              {
                                role: "assistant",
                                text: `让我们来检验假设 #${a.id}："${a.text}"。\n\n请问，您对这个假设的信心来源于什么数据或经验？`,
                              },
                            ],
                          }));
                        }
                      }}
                      className={`px-2.5 py-[4px] rounded-[6px] text-[11px] transition-colors ${
                        a.id === activeAssumptionId
                          ? "bg-[#030213] text-white"
                          : "bg-[#f3f3f5] text-[#717182] hover:bg-[#ebebeb]"
                      }`}
                      style={{ fontWeight: 500 }}
                    >
                      #{a.id} {a.text.length > 10 ? a.text.slice(0, 10) + "..." : a.text}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dialogue */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="max-w-[600px] mx-auto">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-px flex-1 bg-[rgba(0,0,0,0.06)]" />
                    <span className="text-[10px] text-[#8a9193] px-2" style={{ fontWeight: 500 }}>苏格拉底提问 · 假设 #{activeAssumptionId}</span>
                    <div className="h-px flex-1 bg-[rgba(0,0,0,0.06)]" />
                  </div>

                  <div className="space-y-3">
                    {dialogue.map((msg, i) => (
                      <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : ""}`}>
                        {msg.role === "assistant" && (
                          <div className="w-[28px] h-[28px] rounded-full bg-[#030213] flex items-center justify-center shrink-0 mt-0.5">
                            <Sparkles className="w-[12px] h-[12px] text-white" />
                          </div>
                        )}
                        <div
                          className={`max-w-[440px] rounded-[10px] px-3.5 py-2.5 text-[12.5px] leading-[1.7] whitespace-pre-wrap ${
                            msg.role === "user" ? "bg-[#030213] text-white" : "bg-white border border-[rgba(0,0,0,0.08)] text-[#0a0a0a]"
                          }`}
                          style={{ fontWeight: 400 }}
                        >
                          {msg.text}
                        </div>
                        {msg.role === "user" && (
                          <div className="w-[28px] h-[28px] rounded-full bg-[#f3f3f5] flex items-center justify-center shrink-0 mt-0.5">
                            <User className="w-[12px] h-[12px] text-[#717182]" />
                          </div>
                        )}
                      </div>
                    ))}
                    {isTyping && (
                      <div className="flex gap-2.5">
                        <div className="w-[28px] h-[28px] rounded-full bg-[#030213] flex items-center justify-center shrink-0">
                          <Sparkles className="w-[12px] h-[12px] text-white" />
                        </div>
                        <div className="bg-white border border-[rgba(0,0,0,0.08)] rounded-[10px] px-3.5 py-2.5">
                          <span className="inline-flex gap-1 items-center">
                            <span className="w-[5px] h-[5px] bg-[#717182] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                            <span className="w-[5px] h-[5px] bg-[#717182] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                            <span className="w-[5px] h-[5px] bg-[#717182] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                          </span>
                        </div>
                      </div>
                    )}
                    <div ref={dialogueEndRef} />
                  </div>
                </div>
              </div>

              {/* Input */}
              <ConversationComposer
                contentClassName="max-w-[600px]"
                value={input}
                onChange={setInput}
                onSend={handleSend}
                placeholder="回答追问或补充说明..."
                sending={isTyping}
                disabled={isTyping}
                hint="Enter 发送，Shift+Enter 换行"
              />
            </div>
          )}

          {activeLayer === "L3" && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Clock className="w-[32px] h-[32px] text-[#d0d5dd] mx-auto mb-3" />
                <p className="text-[14px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>L3: 创造性拓展与压力测试</p>
                <p className="text-[12px] text-[#717182] mt-1" style={{ fontWeight: 400 }}>等待 L2 层级完成后自动启动</p>
              </div>
            </div>
          )}
        </div>

        {/* Skill Panel */}
        <SkillPanel
          isOpen={skillPanelOpen}
          onClose={() => setSkillPanelOpen(false)}
          activeSkillIds={activeSkillIds}
          onToggleSkill={toggleSkill}
        />
      </div>
    </div>
  );
}
