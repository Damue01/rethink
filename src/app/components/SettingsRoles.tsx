import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Send, Pencil, Save, Trash2, Sparkles, Loader2, Search, X, ChevronDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatCompletionStream } from "../services/llm";
import { getAllModels, getDefaultModel, type ModelConfig } from "../services/llmConfig";
import { EmojiPicker } from "./EmojiPicker";
import {
  loadRoles,
  renderRolePrompt,
  saveRoles,
  stanceLabel,
  stancePercent,
  type RoleTemplate as Role,
} from "../services/roles";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

interface TestMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export function SettingsRoles() {
  const [roleList, setRoleList] = useState<Role[]>(() => loadRoles());
  const [selectedRoleId, setSelectedRoleId] = useState<string>(() => loadRoles()[0]?.id ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testMessages, setTestMessages] = useState<TestMessage[]>([]);
  const [testInput, setTestInput] = useState("");
  const [testUserProblem, setTestUserProblem] = useState("");
  const [testContext, setTestContext] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [newStyleTag, setNewStyleTag] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const newTagRef = useRef<HTMLInputElement>(null);
  const [showTestModelDropdown, setShowTestModelDropdown] = useState(false);
  const testModelDropdownRef = useRef<HTMLDivElement>(null);

  const selectedRole = useMemo(
    () => roleList.find((role) => role.id === selectedRoleId) ?? roleList[0],
    [roleList, selectedRoleId],
  );

  const historyContext = useMemo(() => {
    return testMessages
      .slice(-6)
      .filter((msg) => msg.text.trim())
      .map((msg) => `${msg.role === "user" ? "用户" : selectedRole?.name || "角色"}: ${msg.text}`)
      .join("\n");
  }, [selectedRole, testMessages]);

  const resolvedCurrentContext = useMemo(() => {
    return [
      testContext.trim(),
      historyContext ? `最近测试对话：\n${historyContext}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }, [historyContext, testContext]);

  const resolvedPromptPreview = useMemo(() => {
    if (!selectedRole) return "";
    return renderRolePrompt(selectedRole, {
      userProblem: testUserProblem,
      currentContext: resolvedCurrentContext,
    });
  }, [resolvedCurrentContext, selectedRole, testUserProblem]);

  const allModels = getAllModels();
  const defaultModel = getDefaultModel();
  const [selectedModelId, setSelectedModelId] = useState<string>(() => defaultModel?.model.id ?? "");
  const selectedTestModel = useMemo(() => {
    return allModels.find((m) => m.model.id === selectedModelId) ?? (defaultModel ? { providerId: "", providerName: defaultModel.provider.name, model: defaultModel.model, apiKey: defaultModel.provider.apiKey, baseUrl: defaultModel.provider.baseUrl } : null);
  }, [allModels, defaultModel, selectedModelId]);

  useEffect(() => {
    saveRoles(roleList);
  }, [roleList]);

  useEffect(() => {
    if (!selectedRole && roleList.length > 0) {
      setSelectedRoleId(roleList[0].id);
    }
  }, [roleList, selectedRole]);

  useEffect(() => {
    abortRef.current?.abort();
    setIsTesting(false);
    setTestMessages([]);
  }, [selectedRoleId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
      if (testModelDropdownRef.current && !testModelDropdownRef.current.contains(e.target as Node)) {
        setShowTestModelDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const updateRole = (updated: Role) => {
    setRoleList((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const handleStartEdit = () => {
    setEditingId(selectedRole.id);
  };

  const handleSaveEdit = () => {
    setEditingId(null);
    setShowEmojiPicker(false);
  };

  const handleCreate = () => {
    const newRole: Role = {
      id: String(Date.now()),
      name: "自定义角色",
      emoji: "✨",
      color: "#6366f1",
      stance: 0,
      styleTags: ["自定义"],
      systemPrompt: "你的角色设定...",
      isBuiltin: false,
    };
    setRoleList((prev) => [...prev, newRole]);
    setSelectedRoleId(newRole.id);
    setEditingId(newRole.id);
    setTestMessages([]);
  };

  const handleDelete = () => {
    const next = roleList.filter((r) => r.id !== selectedRole.id);
    setRoleList(next);
    setSelectedRoleId(next[0]?.id ?? "");
    setEditingId(null);
    setTestMessages([]);
  };

  const handleTest = () => {
    const text = testInput.trim();
    if (!text || isTesting || !selectedRole) return;

    const userMessage: TestMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
    };
    const assistantMessageId = `assistant-${Date.now()}`;

    setTestMessages((prev) => [...prev, userMessage, { id: assistantMessageId, role: "assistant", text: "" }]);
    setTestInput("");

    if (!selectedTestModel) {
      setTestMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, text: "⚠️ 未配置可用模型，请先前往模型配置页设置。" }
            : msg,
        ),
      );
      return;
    }

    const { model, apiKey, baseUrl } = selectedTestModel;
    const recentMessages = [...testMessages, userMessage]
      .filter((msg) => msg.text.trim())
      .slice(-6)
      .map((msg) => ({ role: msg.role, content: msg.text }));
    const renderedPrompt = renderRolePrompt(selectedRole, {
      userProblem: testUserProblem || text,
      currentContext: resolvedCurrentContext,
    });

    setIsTesting(true);
    const abortController = new AbortController();
    abortRef.current = abortController;

    chatCompletionStream(
      {
        apiKey: apiKey,
        baseUrl: baseUrl,
        model: model.name,
        messages: [
          { role: "system", content: renderedPrompt },
          ...recentMessages,
          { role: "user", content: text },
        ],
        temperature: model.temperature,
        maxTokens: model.maxTokens,
        signal: abortController.signal,
      },
      {
        onToken: (token) => {
          setTestMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId ? { ...msg, text: msg.text + token } : msg,
            ),
          );
        },
        onDone: () => {
          setIsTesting(false);
        },
        onError: (err) => {
          setTestMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, text: msg.text || `⚠️ 实时测试失败：${err.message}` }
                : msg,
            ),
          );
          setIsTesting(false);
        },
      },
    );
  };

  if (!selectedRole) return null;

  return (
    <div className="h-full flex font-['Inter',sans-serif]">
      {/* Left - Role List */}
      <div className="w-[280px] bg-white border-r border-[#ebebeb] flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-[#ebebeb]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[16px]">👥</span>
              <p className="text-[14px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>角色模板</p>
            </div>
            <button onClick={handleCreate} className="w-[28px] h-[28px] bg-[#030213] text-white rounded-[7px] flex items-center justify-center hover:bg-[#1a1a2e] transition-colors">
              <Plus className="w-[14px] h-[14px]" />
            </button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-[13px] w-[13px] -translate-y-1/2 text-[#8a9193]" />
            <Input
              className="pl-8"
              placeholder="搜索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {roleList.filter((r) => !searchQuery || r.name.includes(searchQuery) || r.styleTags.some((t) => t.includes(searchQuery))).map((role) => (
            <button
              key={role.id}
              onClick={() => setSelectedRoleId(role.id)}
              className={`w-full text-left px-3 py-2.5 rounded-[8px] transition-colors flex items-center gap-2.5 ${
                selectedRole.id === role.id ? "bg-[#f3f3f5]" : "hover:bg-[#f8fafb]"
              }`}
            >
              <span className="text-[16px] shrink-0">{role.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] text-[#0a0a0a] truncate" style={{ fontWeight: 500 }}>{role.name}</p>
                <p className="text-[10px] text-[#717182] mt-0.5 truncate" style={{ fontWeight: 400 }}>
                  {role.styleTags.join(" · ")}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Center - Config & Prompt */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#f8fafb]">
        <div className="px-4 md:px-6 py-4 md:py-5 bg-white border-b border-[#ebebeb] shrink-0">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div ref={emojiRef} className="relative">
                <button
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="text-[32px] hover:bg-[#f3f3f5] rounded-[8px] w-[48px] h-[48px] flex items-center justify-center transition-colors"
                  title="更换图标"
                >
                  {selectedRole.emoji}
                </button>
                {showEmojiPicker && (
                  <EmojiPicker
                    onSelect={(emoji) => updateRole({ ...selectedRole, emoji })}
                    onClose={() => setShowEmojiPicker(false)}
                  />
                )}
              </div>
              <div>
                {editingId === selectedRole.id ? (
                  <Input
                    surface="white"
                    className="h-[32px] w-[240px] text-[17px]"
                    style={{ fontWeight: 500 }}
                    value={selectedRole.name}
                    onChange={(e) => updateRole({ ...selectedRole, name: e.target.value })}
                  />
                ) : (
                  <p className="text-[17px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>{selectedRole.name}</p>
                )}
                <p className="text-[12.5px] text-[#717182] mt-0.5" style={{ fontWeight: 400 }}>
                  {stanceLabel(selectedRole.stance)} · {selectedRole.styleTags.join("、")}
                </p>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {selectedRole.styleTags.map((tag) => (
                    <span key={tag} className="text-[10px] px-[6px] py-[2px] rounded-[4px] bg-[#f3f3f5] text-[#717182] inline-flex items-center gap-1" style={{ fontWeight: 500 }}>
                      {tag}
                      {editingId === selectedRole.id && (
                        <button
                          onClick={() => updateRole({ ...selectedRole, styleTags: selectedRole.styleTags.filter((t) => t !== tag) })}
                          className="hover:text-[#dc2626] transition-colors"
                        >
                          <X className="w-[10px] h-[10px]" />
                        </button>
                      )}
                    </span>
                  ))}
                  {editingId === selectedRole.id && (
                    <span className="inline-flex items-center gap-0.5">
                      <input
                        ref={newTagRef}
                        value={newStyleTag}
                        onChange={(e) => setNewStyleTag(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newStyleTag.trim()) {
                            updateRole({ ...selectedRole, styleTags: [...selectedRole.styleTags, newStyleTag.trim()] });
                            setNewStyleTag("");
                          }
                        }}
                        placeholder="添加标签…"
                        className="text-[10px] w-[72px] px-[5px] py-[2px] rounded-[4px] border border-dashed border-[rgba(0,0,0,0.15)] outline-none focus:border-[#415a9b] bg-transparent text-[#717182]"
                      />
                    </span>
                  )}
                  {selectedRole.isBuiltin && (
                    <span className="text-[10px] px-[6px] py-[2px] rounded-[4px] bg-[#f0f4ff] text-[#415a9b]" style={{ fontWeight: 500 }}>
                      内置
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-1.5">
              {editingId === selectedRole.id ? (
                <button
                  onClick={handleSaveEdit}
                  title="保存"
                  className="w-[30px] h-[30px] rounded-[7px] border border-[rgba(0,0,0,0.1)] text-[#415a9b] bg-[#f0f4ff] hover:bg-[#e0e8ff] flex items-center justify-center transition-colors"
                >
                  <Save className="w-[14px] h-[14px]" />
                </button>
              ) : (
                <button
                  onClick={handleStartEdit}
                  title="编辑"
                  className="w-[30px] h-[30px] rounded-[7px] border border-[rgba(0,0,0,0.1)] text-[#717182] hover:bg-[#f8fafb] flex items-center justify-center transition-colors"
                >
                  <Pencil className="w-[14px] h-[14px]" />
                </button>
              )}
              {!selectedRole.isBuiltin && (
                <button onClick={handleDelete} className="w-[30px] h-[30px] rounded-[7px] border border-[rgba(0,0,0,0.1)] text-[#dc2626] hover:bg-[#fef2f2] flex items-center justify-center transition-colors">
                  <Trash2 className="w-[14px] h-[14px]" />
                </button>
              )}
            </div>
          </div>

          {/* Stance */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-[#717182]" style={{ fontWeight: 500 }}>立场: {stanceLabel(selectedRole.stance)}</span>
              <span className="text-[10px] px-[7px] py-[2px] rounded-full bg-[#f3f3f5] text-[#0a0a0a]" style={{ fontWeight: 600 }}>
                {stancePercent(selectedRole.stance)}
              </span>
            </div>
            <div className="relative h-[16px] flex items-center">
              <div className="absolute inset-0 bg-gradient-to-r from-[#dc2626]/20 via-[#f3f3f5] to-[#10b981]/20 rounded-full" />
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#d0d5dd]" />
              <div
                className="absolute top-1/2 w-[14px] h-[14px] bg-white border-2 rounded-full shadow-sm"
                style={{
                  left: `${((selectedRole.stance + 1) / 2) * 100}%`,
                  borderColor: selectedRole.color,
                  transform: "translate(-50%, -50%)",
                }}
              />
              {editingId === selectedRole.id && (
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={5}
                  value={Math.round(selectedRole.stance * 100)}
                  onChange={(e) => updateRole({
                    ...selectedRole,
                    stance: Number(e.target.value) / 100,
                  })}
                  className="absolute inset-0 w-full opacity-0 cursor-pointer"
                  aria-label="调整角色立场"
                />
              )}
            </div>
            <div className="flex justify-between text-[9px] text-[#717182] mt-1" style={{ fontWeight: 400 }}>
              <span>激进批判</span>
              <span>中立</span>
              <span>积极支持</span>
            </div>
            <p className="text-[10px] text-[#8a9193] mt-2" style={{ fontWeight: 400 }}>
              {editingId === selectedRole.id ? "拖动状态栏可调整角色在批判与支持之间的倾向。" : "开启编辑后可调整角色立场。"}
            </p>
          </div>
        </div>

        {/* Prompt */}
        <div className="flex-1 p-6 overflow-y-auto">
          <label className="text-[12px] text-[#0a0a0a] mb-2 block" style={{ fontWeight: 500 }}>System Prompt</label>
          <Textarea
            surface="white"
            className={`h-[260px] w-full font-mono text-[12.5px] leading-[1.65] ${editingId === selectedRole.id ? "border-[#2563eb] focus-visible:border-[#2563eb] focus-visible:ring-[rgba(37,99,235,0.12)]" : "border-[rgba(0,0,0,0.08)]"}`}
            value={selectedRole.systemPrompt}
            readOnly={editingId !== selectedRole.id}
            onChange={(e) => updateRole({ ...selectedRole, systemPrompt: e.target.value })}
            style={{ fontWeight: 400 }}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["{{user_problem}}", "{{current_context}}"].map((v) => {
              const present = selectedRole.systemPrompt.includes(v);
              return (
                <span
                  key={v}
                  className={`text-[10px] px-[7px] py-[3px] rounded-[5px] border cursor-pointer ${
                    present
                      ? "bg-white border-[rgba(0,0,0,0.1)] text-[#415a9b] hover:bg-[#f8fafb]"
                      : "bg-[#fffbeb] border-[#f59e0b] text-[#92400e]"
                  }`}
                  style={{ fontWeight: 500 }}
                >
                  {v}{!present && " ⚠ 缺失"}
                </span>
              );
            })}
          </div>
          {(!selectedRole.systemPrompt.includes("{{user_problem}}") ||
            !selectedRole.systemPrompt.includes("{{current_context}}")) && (
            <p className="text-[10px] text-[#b45309] mt-1.5" style={{ fontWeight: 400 }}>
              缺失的变量内容将在运行时自动追加到提示词末尾，但可能影响语义连贯性。
            </p>
          )}
        </div>
      </div>

      {/* Right - Test */}
      <div className="w-[300px] bg-white border-l border-[#ebebeb] flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-[#ebebeb]">
          <p className="text-[13px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>实时测试</p>
          {allModels.length > 0 ? (
            <div ref={testModelDropdownRef} className="relative mt-1.5">
              <button
                onClick={() => setShowTestModelDropdown(!showTestModelDropdown)}
                className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-[7px] border border-[rgba(0,0,0,0.1)] text-[12px] text-[#717182] hover:bg-[#f8fafb] transition-colors w-full"
                style={{ fontWeight: 400 }}
              >
                <Sparkles className="w-[11px] h-[11px] shrink-0" />
                <span className="flex-1 text-left truncate">{allModels.find((m) => m.model.id === selectedModelId)?.model.displayName ?? "选择模型"}{allModels.find((m) => m.model.id === selectedModelId)?.model.isDefault ? " (默认)" : ""}</span>
                <ChevronDown className="w-[11px] h-[11px] text-[#8a9193] shrink-0" />
              </button>
              {showTestModelDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-[rgba(0,0,0,0.1)] rounded-[7px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] py-1 z-20 w-full max-h-[240px] overflow-y-auto">
                  {allModels.map((m) => (
                    <button
                      key={m.model.id}
                      onClick={() => {
                        setSelectedModelId(m.model.id);
                        setShowTestModelDropdown(false);
                      }}
                      className={`w-full text-left px-3 py-[5px] text-[12px] hover:bg-[#f8fafb] flex items-center gap-2 ${m.model.id === selectedModelId ? "text-[#415a9b]" : "text-[#0a0a0a]"}`}
                      style={{ fontWeight: m.model.id === selectedModelId ? 500 : 400 }}
                    >
                      <Sparkles className="w-[10px] h-[10px] shrink-0" />
                      {m.model.displayName}{m.model.isDefault ? " (默认)" : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-[#717182] mt-0.5" style={{ fontWeight: 400 }}>未配置模型，当前无法进行真实测试</p>
          )}
        </div>
        <div className="px-4 py-3 border-b border-[#ebebeb] space-y-2.5 overflow-y-auto max-h-[45vh]">
          <p className="text-[10px] text-[#8a9193] leading-[1.5]" style={{ fontWeight: 400 }}>
            以下变量会注入到角色的 System Prompt 中，模拟实际对话/辩论时的输入。
          </p>
          <div>
            <label className="text-[10px] text-[#717182] block mb-1" style={{ fontWeight: 500 }}>审查主题 <code className="text-[9px] text-[#8a9193] bg-[#f3f3f5] px-1 rounded">{'{{user_problem}}'}</code></label>
            <Input
              size="sm"
              value={testUserProblem}
              onChange={(e) => setTestUserProblem(e.target.value)}
              placeholder="待审查的方案或议题"
              style={{ fontWeight: 400 }}
            />
          </div>
          <div>
            <label className="text-[10px] text-[#717182] block mb-1" style={{ fontWeight: 500 }}>项目背景 <code className="text-[9px] text-[#8a9193] bg-[#f3f3f5] px-1 rounded">{'{{current_context}}'}</code></label>
            <Textarea
              size="sm"
              className="h-[68px]"
              value={testContext}
              onChange={(e) => setTestContext(e.target.value)}
              placeholder="项目类型、目标用户、已知约束等"
              style={{ fontWeight: 400 }}
            />
          </div>
          <details className="rounded-[8px] border border-[#ebebeb] bg-[#fafbfc] overflow-hidden">
            <summary className="px-3 py-2 text-[11px] text-[#415a9b] cursor-pointer select-none" style={{ fontWeight: 500 }}>
              预览注入后的完整提示词
            </summary>
            <pre className="px-3 py-2.5 text-[10.5px] leading-[1.6] text-[#334155] whitespace-pre-wrap border-t border-[#ebebeb] overflow-x-auto max-h-[200px] overflow-y-auto">{resolvedPromptPreview}</pre>
          </details>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {testMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-[36px] h-[36px] rounded-full bg-[#f3f3f5] flex items-center justify-center mb-2">
                <Sparkles className="w-[16px] h-[16px] text-[#717182]" />
              </div>
              <p className="text-[12px] text-[#717182]" style={{ fontWeight: 400 }}>发送消息开始测试</p>
            </div>
          )}
          {testMessages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
              {msg.role === "assistant" && (
                <span className="text-[16px] shrink-0 mt-0.5">{selectedRole.emoji}</span>
              )}
              <div className={`max-w-[220px] rounded-[8px] px-3 py-2 text-[12px] leading-[1.6] ${
                msg.role === "user" ? "bg-[#030213] text-white" : "bg-[#f3f3f5] text-[#0a0a0a]"
              }`} style={{ fontWeight: 400 }}>
                {msg.role === "assistant" ? (
                  msg.text ? (
                    <div className="prose prose-sm max-w-none prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-pre:bg-[#1e1e2e] prose-pre:text-[#e0e0e0] prose-pre:rounded-lg prose-pre:p-3 prose-code:text-[11px] prose-code:before:content-none prose-code:after:content-none prose-code:bg-[#e8eaed] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[#c7254e]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[#717182]">
                      <Loader2 className="w-[12px] h-[12px] animate-spin" /> 正在调用模型...
                    </span>
                  )
                ) : (
                  msg.text
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-[#ebebeb]">
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              className="flex-1"
              placeholder="输入测试消息..."
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleTest()}
              disabled={!selectedTestModel || isTesting}
              style={{ fontWeight: 400 }}
            />
            <button
              onClick={handleTest}
              disabled={!selectedTestModel || isTesting || !testInput.trim()}
              className="w-[32px] h-[32px] bg-[#030213] text-white rounded-[7px] flex items-center justify-center hover:bg-[#1a1a2e] transition-colors shrink-0 disabled:opacity-30"
            >
              {isTesting ? <Loader2 className="w-[13px] h-[13px] animate-spin" /> : <Send className="w-[13px] h-[13px]" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
