import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import {
  ChevronDown,
  Search,
  Plus,
  User,
  Sparkles,
  PanelLeft,
  GitCompare,
  X,
  Check,
  Clock,
  Hash,
  ThumbsUp,
  ArrowLeft,
  Copy,
  Settings,
  Upload,
  FileText,
} from "lucide-react";
import { SkillPanel, SkillBadges } from "./SkillPanel";
import { getAllModels } from "../services/llmConfig";
import { type ChatMessage as LLMMessage } from "../services/llm";
import { agentLoop, type ToolCallEvent } from "../services/toolLoop";
import { defaultSkills, loadSkills } from "./skillData";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ConversationComposer } from "./ui/conversation-composer";
import { Input } from "./ui/input";
import { loadMethodologies, type Methodology } from "../services/methodologies";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  CHAT_ATTACHMENT_ACCEPT,
  MAX_CHAT_ATTACHMENT_COUNT,
  buildOutgoingUserMessage,
  formatAttachmentSize,
  readChatAttachments,
  type ChatAttachment,
} from "../services/chatAttachments";
import { createStorageHelper, groupByRecency } from "../services/storage";
import { HistorySidebar } from "./HistorySidebar";
import { useIsMobile } from "./ui/use-mobile";
/* ── Conversation persistence ── */

interface StoredConversation {
  id: string;
  title: string;
  messages: Message[];
  activeSkillIds?: string[];
  selectedMethodId?: string;
  updatedAt: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  reasoning?: string;
  adopted?: boolean;
  toolCalls?: ToolCallEvent[];
  attachments?: ChatAttachment[];
}

type CompareState = "off" | "active" | "confirming-exit";

interface CompareResponse {
  modelId: string;
  modelName: string;
  content: string;
  latency: string;
  tokens: number;
  done: boolean;
}

interface CompareRound {
  id: string;
  userMessage: string;
  attachments?: ChatAttachment[];
  responses: CompareResponse[];
  adoptedModelId: string | null;
}

const chatStorage = createStorageHelper<StoredConversation>("ai-review-conversations");

function loadConversations(): StoredConversation[] {
  return chatStorage.load();
}

function saveConversations(convs: StoredConversation[]) {
  chatStorage.save(convs);
}

function groupConversations(convs: StoredConversation[]) {
  return groupByRecency(convs, (c) => c.updatedAt, (c) => ({ id: c.id, title: c.title }));
}

function getMessagePromptContent(message: Message) {
  if (message.role !== "user") return message.content;
  return buildOutgoingUserMessage(message.content, message.attachments ?? []).promptContent;
}

/* ───────────────────── Component ───────────────────── */

export function ChatPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();

  /* ── Methodology from config ── */
  const configuredMethodologies = loadMethodologies();

  /* ── Core chat state ── */
  const [messages, setMessages] =
    useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [isComposerDragActive, setIsComposerDragActive] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => {
    const models = getAllModels();
    return models.length > 0 ? models[0].model.id : "";
  });
  const [selectedMethodId, setSelectedMethodId] = useState(() => {
    const fromUrl = searchParams.get("methodology");
    if (fromUrl && configuredMethodologies.some((m) => m.id === fromUrl)) {
      return fromUrl;
    }
    return configuredMethodologies[0]?.id ?? "none";
  });
  const [showModelDropdown, setShowModelDropdown] =
    useState(false);
  const [showMethodDropdown, setShowMethodDropdown] =
    useState(false);
  const methodDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Auto-close sidebar on mobile
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  /* ── Compare mode state ── */
  const [compareState, setCompareState] =
    useState<CompareState>("off");
  const [compareModels, setCompareModels] = useState<string[]>(() => {
    const models = getAllModels();
    return models.map(m => m.model.id);
  });
  const [compareRounds, setCompareRounds] = useState<
    CompareRound[]
  >([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [adoptedToast, setAdoptedToast] = useState<
    string | null
  >(null);

  /* ── Skill state ── */
  const [skillPanelOpen, setSkillPanelOpen] = useState(false);
  const [activeSkillIds, setActiveSkillIds] = useState<
    string[]
  >(() => {
    const fromUrl = searchParams.get("skill");
    return fromUrl ? [fromUrl] : [];
  });

  /* ── Capture initial URL params before effects clean them ── */
  const initialSkillRef = useRef(searchParams.get("skill"));
  const initialMethodRef = useRef(searchParams.get("methodology"));

  /* (sidebar state moved to HistorySidebar component) */

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const compareEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const activeSkillIdsRef = useRef<string[]>(activeSkillIds);
  useEffect(() => { activeSkillIdsRef.current = activeSkillIds; }, [activeSkillIds]);
  const selectedMethodIdRef = useRef<string>(selectedMethodId);
  useEffect(() => { selectedMethodIdRef.current = selectedMethodId; }, [selectedMethodId]);

  /* ── Streaming message overlay ── */
  // During streaming, the in-progress assistant message lives here instead
  // of inside the `messages` array. This avoids .map() over the full array
  // on every token and prevents re-rendering completed messages.
  const streamingMsgRef = useRef<Message | null>(null);
  const [streamingMsgVersion, setStreamingMsgVersion] = useState(0);
  const streamingMsg = streamingMsgRef.current; // read on render via version bump

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, streamingMsgVersion]);

  useEffect(() => {
    compareEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [compareRounds]);

  // Clear methodology/skill query params after consuming them
  useEffect(() => {
    if (searchParams.has("methodology") || searchParams.has("skill")) {
      searchParams.delete("methodology");
      searchParams.delete("skill");
      setSearchParams(searchParams, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (showMethodDropdown && methodDropdownRef.current && !methodDropdownRef.current.contains(e.target as Node)) {
        setShowMethodDropdown(false);
      }
      if (showModelDropdown && modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMethodDropdown, showModelDropdown]);

  // Auto-hide adopted toast
  useEffect(() => {
    if (adoptedToast) {
      const t = setTimeout(() => setAdoptedToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [adoptedToast]);

  /* ── Conversation persistence ── */
  const [conversations, setConversations] = useState<StoredConversation[]>(loadConversations);
  const historyGroups = groupConversations(conversations);

  // Redirect /chat/new to a fresh conversation ID (preserve query params)
  useEffect(() => {
    if (id === "new") {
      const params = searchParams.toString();
      const suffix = params ? `?${params}` : "";
      navigate(`/chat/${Date.now().toString()}${suffix}`, { replace: true });
    }
  }, [id, navigate, searchParams]);

  // Load conversation by route id
  useEffect(() => {
    if (id && id !== "new") {
      setInput("");
      setPendingAttachments([]);
      setComposerError(null);
      setIsComposerDragActive(false);
      setIsAttachmentMenuOpen(false);
      const conv = loadConversations().find(c => c.id === id);
      if (conv) {
        setMessages(conv.messages);
        setActiveSkillIds(conv.activeSkillIds ?? []);
        if (conv.selectedMethodId && configuredMethodologies.some((m) => m.id === conv.selectedMethodId)) {
          setSelectedMethodId(conv.selectedMethodId);
        } else {
          setSelectedMethodId(configuredMethodologies[0]?.id ?? "none");
        }
      } else {
        setMessages([]);
        // Use initial URL params captured in refs (query params are already cleaned by now)
        const methodFromUrl = initialMethodRef.current;
        if (methodFromUrl && configuredMethodologies.some((m) => m.id === methodFromUrl)) {
          setSelectedMethodId(methodFromUrl);
        } else {
          setSelectedMethodId(configuredMethodologies[0]?.id ?? "none");
        }
        const skillFromUrl = initialSkillRef.current;
        setActiveSkillIds(skillFromUrl ? [skillFromUrl] : []);
        // Clear refs after consuming so subsequent in-page navigations start fresh
        initialMethodRef.current = null;
        initialSkillRef.current = null;
      }
    }
  }, [id]);

  // Save conversation when streaming completes
  const wasTypingRef = useRef(false);
  useEffect(() => {
    if (wasTypingRef.current && !isTyping && id && id !== "new" && messages.length > 0) {
      const convs = loadConversations();
      const title = messages.find(m => m.role === "user")?.content.slice(0, 30) || "新对话";
      const idx = convs.findIndex(c => c.id === id);
      const conv: StoredConversation = { id: id!, title, messages, activeSkillIds, selectedMethodId, updatedAt: Date.now() };
      if (idx >= 0) { convs[idx] = conv; } else { convs.unshift(conv); }
      saveConversations(convs);
      setConversations(convs);
    }
    wasTypingRef.current = isTyping;
  }, [isTyping, id, messages, activeSkillIds, selectedMethodId]);

  // Save progress when unmounting (navigating away); stream continues in background
  useEffect(() => {
    return () => {
      // Save whatever has been streamed so far (read refs for latest values)
      const currentId = id;
      const currentMsgs = messagesRef.current;
      if (!currentId || currentId === "new" || currentMsgs.length === 0) return;
      const convs = loadConversations();
      const title = currentMsgs.find(m => m.role === "user")?.content.slice(0, 30) || "新对话";
      const idx = convs.findIndex(c => c.id === currentId);
      const conv: StoredConversation = { id: currentId, title, messages: currentMsgs, activeSkillIds: activeSkillIdsRef.current, selectedMethodId: selectedMethodIdRef.current, updatedAt: Date.now() };
      if (idx >= 0) { convs[idx] = conv; } else { convs.unshift(conv); }
      saveConversations(convs);
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save when skill or methodology config changes (even without sending a message)
  const configSaveSkipRef = useRef(true);
  // Reset skip flag when id changes so we don't save loaded config back as a "change"
  useEffect(() => { configSaveSkipRef.current = true; }, [id]);
  useEffect(() => {
    // Skip the run right after mount or id change to avoid overwriting stored data
    if (configSaveSkipRef.current) { configSaveSkipRef.current = false; return; }
    if (!id || id === "new" || messages.length === 0) return;
    const convs = loadConversations();
    const idx = convs.findIndex(c => c.id === id);
    if (idx >= 0) {
      convs[idx] = { ...convs[idx], activeSkillIds, selectedMethodId, updatedAt: Date.now() };
      saveConversations(convs);
      setConversations(convs);
    }
  }, [activeSkillIds, selectedMethodId]);

  /* ── Handlers ── */

  const handleRenameConversation = (convId: string, newTitle: string) => {
    const convs = loadConversations();
    const idx = convs.findIndex((c) => c.id === convId);
    if (idx >= 0) {
      convs[idx].title = newTitle || convs[idx].title;
      saveConversations(convs);
      setConversations(convs);
    }
    setRenamingId(null);
  };

  const handleDeleteConversation = (convId: string) => {
    const convs = loadConversations().filter((c) => c.id !== convId);
    saveConversations(convs);
    setConversations(convs);
    setContextMenuId(null);
    if (id === convId) {
      navigate("/chat/new");
    }
  };

  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const handleCopyMessage = (content: string, idx: number) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  };

  const handleSelectedFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const remainingSlots = Math.max(0, MAX_CHAT_ATTACHMENT_COUNT - pendingAttachments.length);
    const limitedFiles = remainingSlots > 0 ? files.slice(0, remainingSlots) : [];
    const overflowCount = files.length - limitedFiles.length;

    const result = await readChatAttachments(limitedFiles);
    if (result.attachments.length > 0) {
      setPendingAttachments((prev) => [...prev, ...result.attachments]);
    }

    const errorParts = [
      ...result.rejected.map(({ fileName, reason }) => `${fileName}: ${reason}`),
      ...(overflowCount > 0 ? [`最多只能附加 ${MAX_CHAT_ATTACHMENT_COUNT} 个文件`] : []),
    ];
    setComposerError(errorParts.length > 0 ? errorParts.join("；") : null);
  }, [pendingAttachments.length]);

  const handleComposerDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isComposerDragActive) {
      setIsComposerDragActive(true);
    }
  }, [isComposerDragActive]);

  const handleComposerDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setIsComposerDragActive(false);
  }, []);

  const handleComposerDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsComposerDragActive(false);
    if (event.dataTransfer.files.length > 0) {
      void handleSelectedFiles(event.dataTransfer.files);
    }
  }, [handleSelectedFiles]);

  const removePendingAttachment = (attachmentId: string) => {
    setPendingAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
  };

  /* ── Build system prompt from active skills + methodology ── */
  const buildSystemPrompt = useCallback(() => {
    let prompt = "你是一个专业的 AI 方案思辨助手，擅长从多个角度审视方案设计、提出建设性意见。请使用 Markdown 格式回复。";
    const currentMethod = configuredMethodologies.find((m) => m.id === selectedMethodId);
    if (currentMethod?.prompt) prompt += "\n\n" + currentMethod.prompt;
    if (activeSkillIds.length > 0) {
      const skills = loadSkills().filter((s) => activeSkillIds.includes(s.id));
      if (skills.length > 0) {
        prompt += "\n\n## 已加载的 Skill 知识库：\n";
        for (const skill of skills) {
          prompt += `\n### ${skill.name}\n${skill.content}\n`;
        }
        prompt += "\n请基于以上知识库内容进行分析，引用其中的标准和数据。";
      }
    }
    return prompt;
  }, [selectedMethodId, activeSkillIds, configuredMethodologies]);

  /* ── Get available models from config ── */
  const configuredModels = getAllModels();
  const hasConfiguredModels = configuredModels.length > 0;
  const ALL_MODELS = configuredModels.map((m) => ({ id: m.model.id, name: m.model.displayName }));

  const handleSendNormal = () => {
    if ((!input.trim() && pendingAttachments.length === 0) || isTyping) return;
    const attachments = pendingAttachments;
    const { displayContent, promptContent } = buildOutgoingUserMessage(input, attachments);
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: displayContent,
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setPendingAttachments([]);
    setComposerError(null);
    setIsComposerDragActive(false);
    setIsTyping(true);

    // Immediately save so the conversation appears in history even if user navigates away
    {
      const convs = loadConversations();
      const title = displayContent.slice(0, 30) || "新对话";
      const idx = convs.findIndex(c => c.id === id);
      const conv: StoredConversation = { id: id!, title, messages: [...messages, userMsg], activeSkillIds, selectedMethodId, updatedAt: Date.now() };
      if (idx >= 0) { convs[idx] = conv; } else { convs.unshift(conv); }
      saveConversations(convs);
      setConversations(convs);
    }

    const modelInfo = configuredModels.find((m) => m.model.id === selectedModel);
    if (!modelInfo) {
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(), role: "assistant",
        content: "⚠️ 未找到已配置的模型，请前往 设置 → 模型配置 添加 API Key 和模型。",
      }]);
      setIsTyping(false);
      return;
    }

    const modelName = modelInfo.model.displayName;
    const assistantMsgId = (Date.now() + 1).toString();

    const llmMessages: LLMMessage[] = [
      { role: "system", content: buildSystemPrompt() },
      // Include last few messages for context
      ...messages.slice(-10).map((m) => ({ role: m.role as "user" | "assistant", content: getMessagePromptContent(m) })),
      { role: "user" as const, content: promptContent },
    ];

    // Closure tracker: accumulates content even after component unmount.
    // Instead of calling setMessages(prev => prev.map(...)) on every token,
    // we update only a lightweight streaming state. The full messages array
    // is only updated once on completion.
    const streaming = { content: "", reasoning: "", toolCalls: [] as ToolCallEvent[] };
    const messagesWithUser = [...messages, userMsg];
    const convId = id!;
    const capturedSkillIds = [...activeSkillIds];
    const capturedMethodId = selectedMethodId;

    // Set up the streaming overlay message (rendered separately from the messages array)
    streamingMsgRef.current = { id: assistantMsgId, role: "assistant", model: modelName, content: "", reasoning: "", toolCalls: [] };
    setStreamingMsgVersion((v) => v + 1);

    const saveStreamToStorage = () => {
      const assistantMsg: Message = {
        id: assistantMsgId, role: "assistant", model: modelName,
        content: streaming.content,
        reasoning: streaming.reasoning || undefined,
        toolCalls: streaming.toolCalls.length > 0 ? [...streaming.toolCalls] : undefined,
      };
      const finalMsgs = [...messagesWithUser, assistantMsg];
      const convs = loadConversations();
      const title = messagesWithUser.find(m => m.role === "user")?.content.slice(0, 30) || "新对话";
      const ci = convs.findIndex(c => c.id === convId);
      const conv: StoredConversation = { id: convId, title, messages: finalMsgs, activeSkillIds: capturedSkillIds, selectedMethodId: capturedMethodId, updatedAt: Date.now() };
      if (ci >= 0) { convs[ci] = conv; } else { convs.unshift(conv); }
      saveConversations(convs);
    };

    const mergeStreamingToMessages = () => {
      const finalMsg: Message = {
        id: assistantMsgId, role: "assistant", model: modelName,
        content: streaming.content,
        reasoning: streaming.reasoning || undefined,
        toolCalls: streaming.toolCalls.length > 0 ? [...streaming.toolCalls] : undefined,
      };
      setMessages((prev) => [...prev, finalMsg]);
      streamingMsgRef.current = null;
      setStreamingMsgVersion((v) => v + 1);
    };

    const abort = new AbortController();
    abortRef.current = abort;

    agentLoop(
      {
        apiKey: modelInfo.apiKey,
        baseUrl: modelInfo.baseUrl,
        model: modelInfo.model.name,
        messages: llmMessages,
        temperature: modelInfo.model.temperature,
        maxTokens: modelInfo.model.maxTokens,
        signal: abort.signal,
      },
      {
        onReasoning: (token) => {
          streaming.reasoning += token;
          if (streamingMsgRef.current) {
            streamingMsgRef.current = { ...streamingMsgRef.current, reasoning: streaming.reasoning };
            setStreamingMsgVersion((v) => v + 1);
          }
        },
        onToken: (token) => {
          streaming.content += token;
          if (streamingMsgRef.current) {
            streamingMsgRef.current = { ...streamingMsgRef.current, content: streaming.content };
            setStreamingMsgVersion((v) => v + 1);
          }
        },
        onToolCallEvent: (event) => {
          const tcIdx = streaming.toolCalls.findIndex(tc => tc.id === event.id);
          if (tcIdx >= 0) streaming.toolCalls[tcIdx] = event; else streaming.toolCalls.push({ ...event });
          if (streamingMsgRef.current) {
            streamingMsgRef.current = { ...streamingMsgRef.current, toolCalls: [...streaming.toolCalls] };
            setStreamingMsgVersion((v) => v + 1);
          }
        },
        onContentReset: () => {
          streaming.content = "";
          if (streamingMsgRef.current) {
            streamingMsgRef.current = { ...streamingMsgRef.current, content: "" };
            setStreamingMsgVersion((v) => v + 1);
          }
        },
        onDone: () => {
          mergeStreamingToMessages();
          setIsTyping(false);
          saveStreamToStorage();
        },
        onError: (err) => {
          streaming.content = `⚠️ API 调用失败: ${err.message}`;
          mergeStreamingToMessages();
          setIsTyping(false);
          saveStreamToStorage();
        },
      }
    );
  };

  const handleSendCompare = () => {
    if ((!input.trim() && pendingAttachments.length === 0) || compareLoading) return;
    const attachments = pendingAttachments;
    const { displayContent, promptContent } = buildOutgoingUserMessage(input, attachments);
    setInput("");
    setPendingAttachments([]);
    setComposerError(null);
    setIsComposerDragActive(false);
    setCompareLoading(true);

    const roundId = Date.now().toString();
    const newRound: CompareRound = {
      id: roundId,
      userMessage: displayContent,
      attachments: attachments.length > 0 ? attachments : undefined,
      responses: compareModels.map((mId) => {
        const modelInfo = configuredModels.find((m) => m.model.id === mId);
        return {
          modelId: mId,
          modelName: modelInfo?.model.displayName ?? mId,
          content: "",
          latency: "",
          tokens: 0,
          done: false,
        };
      }),
      adoptedModelId: null,
    };
    setCompareRounds((prev) => [...prev, newRound]);

    const systemPrompt = buildSystemPrompt();
    const contextMessages: LLMMessage[] = [
      ...messages.slice(-6).map((m) => ({ role: m.role as "user" | "assistant", content: getMessagePromptContent(m) })),
      { role: "user" as const, content: promptContent },
    ];

    let doneCount = 0;
    const totalModels = compareModels.length;
    const compareAbort = new AbortController();
    abortRef.current = compareAbort;

    // Fire all model requests in parallel
    compareModels.forEach((mId) => {
      const modelInfo = configuredModels.find((m) => m.model.id === mId);
      if (!modelInfo) {
        // No config for this model
        setCompareRounds((prev) =>
          prev.map((r) =>
            r.id === roundId
              ? { ...r, responses: r.responses.map((resp) => resp.modelId === mId ? { ...resp, content: "⚠️ 模型未配置", done: true } : resp) }
              : r
          )
        );
        doneCount++;
        if (doneCount >= totalModels) setCompareLoading(false);
        return;
      }

      const startTime = performance.now();

      agentLoop(
        {
          apiKey: modelInfo.apiKey,
          baseUrl: modelInfo.baseUrl,
          model: modelInfo.model.name,
          messages: [{ role: "system", content: systemPrompt }, ...contextMessages],
          temperature: modelInfo.model.temperature,
          maxTokens: modelInfo.model.maxTokens,
          signal: compareAbort.signal,
        },
        {
          onToken: (token) => {
            setCompareRounds((prev) =>
              prev.map((r) =>
                r.id === roundId
                  ? { ...r, responses: r.responses.map((resp) => resp.modelId === mId ? { ...resp, content: resp.content + token } : resp) }
                  : r
              )
            );
          },
          onDone: (fullText) => {
            const latencyMs = performance.now() - startTime;
            setCompareRounds((prev) =>
              prev.map((r) =>
                r.id === roundId
                  ? { ...r, responses: r.responses.map((resp) =>
                      resp.modelId === mId ? { ...resp, done: true, latency: `${(latencyMs / 1000).toFixed(1)}s`, tokens: Math.ceil(fullText.length / 3.5) } : resp
                    ) }
                  : r
              )
            );
            doneCount++;
            if (doneCount >= totalModels) setCompareLoading(false);
          },
          onError: (err) => {
            setCompareRounds((prev) =>
              prev.map((r) =>
                r.id === roundId
                  ? { ...r, responses: r.responses.map((resp) => resp.modelId === mId ? { ...resp, content: `⚠️ 错误: ${err.message}`, done: true } : resp) }
                  : r
              )
            );
            doneCount++;
            if (doneCount >= totalModels) setCompareLoading(false);
          },
        }
      );
    });
  };

  const handleSend =
    compareState === "active"
      ? handleSendCompare
      : handleSendNormal;

  const handleAdopt = (roundId: string, modelId: string) => {
    const round = compareRounds.find((r) => r.id === roundId);
    if (!round) return;
    const resp = round.responses.find(
      (r) => r.modelId === modelId,
    );
    if (!resp) return;

    // Mark as adopted in compare rounds
    setCompareRounds((prev) =>
      prev.map((r) =>
        r.id === roundId
          ? { ...r, adoptedModelId: modelId }
          : r,
      ),
    );

    // Add to main conversation and persist
    const newMessages = [
      ...messages,
      {
        id: `u-${roundId}`,
        role: "user" as const,
        content: round.userMessage,
        attachments: round.attachments,
      },
      {
        id: `a-${roundId}`,
        role: "assistant" as const,
        content: resp.content,
        model: resp.modelName,
        adopted: true,
      },
    ];
    setMessages(newMessages);
    if (id && id !== "new") {
      const convs = loadConversations();
      const title = newMessages.find(m => m.role === "user")?.content.slice(0, 30) || "新对话";
      const idx = convs.findIndex(c => c.id === id);
      const conv: StoredConversation = { id: id!, title, messages: newMessages, updatedAt: Date.now() };
      if (idx >= 0) { convs[idx] = conv; } else { convs.unshift(conv); }
      saveConversations(convs);
      setConversations(convs);
    }

    // Update selected model to the adopted one
    setSelectedModel(modelId);
    const modelName = resp.modelName;
    setAdoptedToast(modelName);

    // Auto-exit compare mode after adopt
    setTimeout(() => {
      setCompareState("off");
      setCompareRounds([]);
    }, 600);
  };

  const handleEnterCompare = () => {
    setCompareState("active");
    // Auto-collapse sidebar for more space
    setSidebarOpen(false);
  };

  const handleExitCompare = () => {
    const hasUnadopted = compareRounds.some(
      (r) =>
        r.responses.some((resp) => resp.done) &&
        !r.adoptedModelId,
    );
    if (hasUnadopted) {
      setCompareState("confirming-exit");
    } else {
      setCompareState("off");
      setCompareRounds([]);
    }
  };

  const confirmExit = () => {
    setCompareState("off");
    setCompareRounds([]);
  };

  const toggleCompareModel = (modelId: string) => {
    setCompareModels((prev) => {
      if (prev.includes(modelId)) {
        return prev.filter((id) => id !== modelId);
      }
      return [...prev, modelId];
    });
  };

  const toggleSkill = (skillId: string) => {
    setActiveSkillIds((prev) =>
      prev.includes(skillId)
        ? prev.filter((id) => id !== skillId)
        : [...prev, skillId],
    );
  };

  const isCompare = compareState !== "off";
  const selectedModelName =
    ALL_MODELS.find((m) => m.id === selectedModel)?.name ??
    (selectedModel || "无已配置模型");
  const canSendMessage = Boolean(input.trim() || pendingAttachments.length > 0);
  const composerTopSlot = (pendingAttachments.length > 0 || composerError || isComposerDragActive) ? (
    <div className="space-y-2">
      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pendingAttachments.map((attachment) => (
            <div
              key={attachment.id}
              className="inline-flex items-center gap-2 rounded-[10px] border border-[#d9e1f2] bg-[#f7faff] px-2.5 py-1.5 text-[11.5px] text-[#21427f]"
              style={{ fontWeight: 500 }}
            >
              <FileText className="w-[12px] h-[12px] shrink-0" />
              <span className="max-w-[180px] truncate">{attachment.name}</span>
              <span className="text-[#6b7ba5]" style={{ fontWeight: 400 }}>{formatAttachmentSize(attachment.size)}</span>
              <button
                type="button"
                onClick={() => removePendingAttachment(attachment.id)}
                className="rounded-full p-0.5 text-[#6b7ba5] transition-colors hover:bg-[#e6eefc] hover:text-[#21427f]"
                aria-label={`移除 ${attachment.name}`}
              >
                <X className="w-[11px] h-[11px]" />
              </button>
            </div>
          ))}
        </div>
      )}
      {isComposerDragActive && (
        <div className="rounded-[10px] border border-dashed border-[#90a9de] bg-[#f5f8ff] px-3 py-2 text-[11.5px] text-[#415a9b]">
          松开即可上传，支持 Markdown、代码文件和常见文本文件。
        </div>
      )}
      {composerError && (
        <p className="text-[11.5px] text-[#dc2626]">{composerError}</p>
      )}
    </div>
  ) : undefined;
  const composerLeftSlot = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={CHAT_ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(event) => {
          setIsAttachmentMenuOpen(false);
          if (event.target.files?.length) {
            void handleSelectedFiles(event.target.files);
          }
          event.target.value = "";
        }}
      />
      <DropdownMenu open={isAttachmentMenuOpen} onOpenChange={setIsAttachmentMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full text-[#6b7280] transition-colors hover:bg-[#f3f4f6] hover:text-[#111827]"
            aria-label="添加附件"
          >
            <Plus className="h-[16px] w-[16px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="w-[180px] rounded-[10px] border-[#e5e7eb] p-1.5"
        >
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setIsAttachmentMenuOpen(false);
              fileInputRef.current?.click();
            }}
            className="gap-2 rounded-[8px] px-3 py-2 text-[12px] text-[#0a0a0a]"
          >
            <Upload className="w-[14px] h-[14px] text-[#415a9b]" />
            上传文件
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  /* ───────────────────── Render ───────────────────── */

  return (
    <div className="flex h-full font-['Inter',sans-serif]">
      {/* ── History Sidebar ── */}
      {sidebarOpen && (
        <HistorySidebar
          routePrefix="/chat"
          activeId={id}
          newLabel="新建对话"
          searchPlaceholder="搜索对话..."
          groups={historyGroups}
          onClose={() => setSidebarOpen(false)}
          onRename={handleRenameConversation}
          onDelete={handleDeleteConversation}
          open={sidebarOpen}
        />
      )}

      {/* ── Main Area ── */}
      <div className="flex-1 flex flex-col bg-[#f8fafb] min-w-0">
        {/* ── Toolbar ── */}
        <div className="min-h-[44px] border-b border-[#ebebeb] flex items-center px-4 gap-2 bg-white shrink-0 flex-wrap py-1.5">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="w-[28px] h-[28px] rounded-[6px] hover:bg-[#f3f3f5] flex items-center justify-center transition-colors"
            >
              <PanelLeft className="w-[14px] h-[14px] text-[#717182]" />
            </button>
          )}

          {!isCompare && (
            <>
              <div ref={methodDropdownRef} className="relative">
                <button
                  onClick={() => {
                    setShowMethodDropdown(!showMethodDropdown);
                    setShowModelDropdown(false);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-[4px] rounded-[6px] border border-[rgba(0,0,0,0.1)] text-[12px] text-[#717182] hover:bg-[#f8fafb] transition-colors"
                  style={{ fontWeight: 400 }}
                >
                  <span className="text-[11px]">{configuredMethodologies.find((m) => m.id === selectedMethodId)?.emoji ?? "✨"}</span>
                  {configuredMethodologies.find((m) => m.id === selectedMethodId)?.name ?? "无方法论"}
                  <ChevronDown className="w-[11px] h-[11px] text-[#8a9193]" />
                </button>
                {showMethodDropdown && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-[rgba(0,0,0,0.1)] rounded-[7px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] py-1 z-20 min-w-[170px]">
                    {configuredMethodologies.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setSelectedMethodId(m.id);
                          setShowMethodDropdown(false);
                        }}
                        className={`w-full text-left px-3 py-[5px] text-[12px] hover:bg-[#f8fafb] flex items-center gap-2 ${m.id === selectedMethodId ? "text-[#415a9b]" : "text-[#0a0a0a]"}`}
                        style={{ fontWeight: m.id === selectedMethodId ? 500 : 400 }}
                      >
                        <span className="w-[18px] text-[12px] text-center shrink-0">{m.emoji}</span>
                        {m.name}
                      </button>
                    ))}
                    <div className="border-t border-[rgba(0,0,0,0.06)] mt-1 pt-1">
                      <button
                        onClick={() => {
                          setShowMethodDropdown(false);
                          navigate("/settings/methodologies");
                        }}
                        className="w-full text-left px-3 py-[5px] text-[11px] text-[#8a9193] hover:bg-[#f8fafb] flex items-center gap-2"
                      >
                        <span className="w-[18px] flex items-center justify-center shrink-0"><Settings className="w-[11px] h-[11px]" /></span>
                        管理方法论…
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div ref={modelDropdownRef} className="relative">
                <button
                  onClick={() => {
                    if (!hasConfiguredModels) return;
                    setShowModelDropdown(!showModelDropdown);
                    setShowMethodDropdown(false);
                  }}
                  disabled={!hasConfiguredModels}
                  className="flex items-center gap-1.5 px-2.5 py-[4px] rounded-[6px] border border-[rgba(0,0,0,0.1)] text-[12px] text-[#717182] hover:bg-[#f8fafb] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ fontWeight: 400 }}
                >
                  <Sparkles className="w-[11px] h-[11px]" />
                  {ALL_MODELS.find((m) => m.id === selectedModel)?.name ?? (hasConfiguredModels ? "选择模型" : "无已配置模型")}
                  <ChevronDown className="w-[11px] h-[11px] text-[#8a9193]" />
                </button>
                {showModelDropdown && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-[rgba(0,0,0,0.1)] rounded-[7px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] py-1 z-20 min-w-[170px]">
                    {ALL_MODELS.length > 0 ? ALL_MODELS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setSelectedModel(m.id);
                          setShowModelDropdown(false);
                        }}
                        className={`w-full text-left px-3 py-[5px] text-[12px] hover:bg-[#f8fafb] flex items-center gap-2 ${m.id === selectedModel ? "text-[#415a9b]" : "text-[#0a0a0a]"}`}
                        style={{ fontWeight: m.id === selectedModel ? 500 : 400 }}
                      >
                        {m.name}
                      </button>
                    )) : (
                      <div className="px-3 py-[6px] text-[11px] text-[#8a9193]">暂无已配置模型，请前往设置添加</div>
                    )}
                  </div>
                )}
              </div>

              <div className="w-px h-[20px] bg-[#ebebeb]" />

              <button
                onClick={handleEnterCompare}
                className="flex items-center gap-1.5 px-2.5 py-[4px] rounded-[6px] border border-[rgba(0,0,0,0.1)] text-[12px] text-[#717182] hover:bg-[#f8fafb] hover:text-[#0a0a0a] transition-colors"
                style={{ fontWeight: 500 }}
              >
                <GitCompare className="w-[12px] h-[12px]" />
                对比模式
              </button>

              <div className="w-px h-[20px] bg-[#ebebeb]" />
              <SkillBadges
                activeSkillIds={activeSkillIds}
                onOpenPanel={() => setSkillPanelOpen(true)}
              />
            </>
          )}

          {/* ─ Compare mode toolbar ��� */}
          {isCompare && (
            <>
              <div
                className="flex items-center gap-1.5 px-2 py-[3px] rounded-[6px] bg-[#030213] text-white text-[11.5px] shrink-0"
                style={{ fontWeight: 500 }}
              >
                <GitCompare className="w-[12px] h-[12px]" />
                对比模式
              </div>

              <div className="w-px h-[20px] bg-[#ebebeb]" />

              {/* Model checkboxes */}
              <div className="flex items-center gap-1.5">
                {ALL_MODELS.length > 0 ? ALL_MODELS.map((m) => {
                  const isChecked = compareModels.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggleCompareModel(m.id)}
                      className={`flex items-center gap-1.5 px-2.5 py-[5px] rounded-[7px] text-[12px] border transition-colors ${
                        isChecked
                          ? "bg-[#030213] border-[#030213] text-white"
                          : "border-[rgba(0,0,0,0.1)] text-[#667085] hover:bg-[#f8fafb]"
                      }`}
                      style={{ fontWeight: 500 }}
                    >
                      {m.name}
                    </button>
                  );
                }) : (
                  <span className="text-[11px] text-[#8a9193]">暂无已配置模型</span>
                )}
              </div>

              <div className="w-px h-[20px] bg-[#ebebeb]" />
              <SkillBadges
                activeSkillIds={activeSkillIds}
                onOpenPanel={() => setSkillPanelOpen(true)}
              />

              <div className="ml-auto">
                <button
                  onClick={handleExitCompare}
                  className="flex items-center gap-1.5 px-2.5 py-[4px] rounded-[6px] border border-[rgba(0,0,0,0.1)] text-[12px] text-[#667085] hover:bg-[#fef2f2] hover:text-[#dc2626] hover:border-[#fca5a5] transition-colors"
                  style={{ fontWeight: 500 }}
                >
                  <X className="w-[12px] h-[12px]" />
                  退出对比
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── Content Area ── */}
        {!isCompare ? (
          <>
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[820px] space-y-4 px-4 py-5">
                {messages.map((msg, idx) => (
                  <div
                    key={msg.id}
                    className={`group/msg flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
                  >
                    {msg.role === "assistant" && (
                      <div className="w-[30px] h-[30px] rounded-full bg-[#030213] flex items-center justify-center shrink-0 mt-0.5">
                        <Sparkles className="w-[13px] h-[13px] text-white" />
                      </div>
                    )}
                    <div className="max-w-[70%] min-w-0">
                      {/* Model badge for adopted responses */}
                      {msg.role === "assistant" &&
                        msg.adopted && (
                          <div className="flex items-center gap-1.5 mb-1">
                            <span
                              className="text-[10px] px-[5px] py-[1px] rounded-[4px] bg-[#f0f4ff] text-[#415a9b] border border-[#d4dff7]"
                              style={{ fontWeight: 500 }}
                            >
                              ✓ 采用自 {msg.model}
                            </span>
                          </div>
                        )}
                      {msg.role === "assistant" &&
                        !msg.adopted &&
                        msg.model && (
                          <div className="flex items-center gap-1.5 mb-1">
                            <span
                              className="text-[10px] text-[#8a9193]"
                              style={{ fontWeight: 400 }}
                            >
                              {msg.model}
                            </span>
                          </div>
                        )}
                      {/* Reasoning / thinking content */}
                      {msg.role === "assistant" && msg.reasoning && (
                        <details className={`mb-2 rounded-[8px] border border-[#e8e5ff] bg-[#faf9ff] overflow-hidden ${!msg.content && isTyping ? "open" : ""}`} open={!msg.content && isTyping ? true : undefined}>
                          <summary className="px-3 py-2 text-[11.5px] text-[#7c6fbb] cursor-pointer hover:bg-[#f3f0ff] transition-colors flex items-center gap-1.5 select-none" style={{ fontWeight: 500 }}>
                            <svg className="w-[12px] h-[12px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/><line x1="10" y1="22" x2="14" y2="22"/></svg>
                            思考过程
                            {!msg.content && isTyping && (
                              <span className="inline-flex gap-0.5 items-center ml-1">
                                <span className="w-[3px] h-[3px] bg-[#7c6fbb] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                                <span className="w-[3px] h-[3px] bg-[#7c6fbb] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                                <span className="w-[3px] h-[3px] bg-[#7c6fbb] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                              </span>
                            )}
                          </summary>
                          <div className="px-3 pb-2.5 text-[12px] text-[#5a5078] leading-[1.7] whitespace-pre-wrap border-t border-[#e8e5ff]">
                            {msg.reasoning}
                          </div>
                        </details>
                      )}
                      {/* Tool call events */}
                      {msg.role === "assistant" && msg.toolCalls && (msg.toolCalls as ToolCallEvent[]).length > 0 && (
                        <div className="mb-2 space-y-1">
                          {(msg.toolCalls as ToolCallEvent[]).map((tc: ToolCallEvent) => (
                            <details key={tc.id} className="rounded-[7px] border border-[#e2e8f0] bg-[#f8fafb] overflow-hidden">
                              <summary className="px-3 py-1.5 text-[11px] cursor-pointer hover:bg-[#f0f4ff] transition-colors flex items-center gap-1.5 select-none" style={{ fontWeight: 500 }}>
                                {tc.status === "calling" ? (
                                  <Sparkles className="w-[11px] h-[11px] text-[#f59e0b] animate-pulse" />
                                ) : tc.status === "error" ? (
                                  <span className="text-[#ef4444]">✕</span>
                                ) : (
                                  <span className="text-[#10b981]">✓</span>
                                )}
                                <span className="text-[#415a9b]">{tc.name}</span>
                                <span className="text-[#9ca3af]">
                                  {tc.status === "calling" ? "调用中..." : tc.status === "error" ? "失败" : "完成"}
                                </span>
                              </summary>
                              <div className="px-3 pb-2 text-[10.5px] text-[#717182] border-t border-[#e2e8f0] space-y-1">
                                <div className="mt-1"><span style={{ fontWeight: 500 }}>参数:</span> <code className="text-[10px] bg-[#e8eaed] px-1 py-0.5 rounded break-all">{JSON.stringify(tc.arguments)}</code></div>
                                {tc.result && (
                                  <div><span style={{ fontWeight: 500 }}>结果:</span> <pre className="mt-0.5 text-[10px] bg-[#f3f3f5] rounded p-2 overflow-x-auto max-h-[150px] overflow-y-auto whitespace-pre-wrap">{tc.result.slice(0, 2000)}</pre></div>
                                )}
                              </div>
                            </details>
                          ))}
                        </div>
                      )}
                      {(msg.role === "user" || msg.content || !msg.reasoning) && (
                        <div
                          className={`rounded-[10px] px-4 py-3 text-[13px] leading-[1.7] ${
                            msg.role === "user"
                              ? "bg-[#030213] text-white whitespace-pre-wrap"
                              : msg.adopted
                                ? "bg-white border-2 border-[#d4dff7] text-[#0a0a0a]"
                                : "bg-white border border-[rgba(0,0,0,0.08)] text-[#0a0a0a]"
                          }`}
                          style={{ fontWeight: 400 }}
                        >
                          {msg.role === "user" && msg.attachments && msg.attachments.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {msg.attachments.map((attachment) => (
                                <span
                                  key={attachment.id}
                                  className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10.5px] text-white/90"
                                >
                                  <FileText className="w-[10px] h-[10px]" />
                                  <span className="max-w-[180px] truncate">{attachment.name}</span>
                                </span>
                              ))}
                            </div>
                          )}
                          {msg.role === "user" ? (
                            msg.content
                          ) : msg.content ? (
                            <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-h1:text-[20px] prose-h2:text-[17px] prose-h3:text-[15px] prose-h4:text-[14px] prose-headings:mt-4 prose-headings:mb-2 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-table:my-2 prose-pre:my-2 prose-pre:bg-[#1e1e2e] prose-pre:text-[#e0e0e0] prose-pre:rounded-lg prose-pre:p-4 prose-code:text-[12px] prose-code:before:content-none prose-code:after:content-none prose-code:bg-[#e8eaed] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[#c7254e] prose-strong:font-semibold prose-blockquote:border-l-[#415a9b] prose-blockquote:bg-[#f8f9ff] prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-md prose-a:text-[#415a9b] prose-a:no-underline hover:prose-a:underline prose-img:rounded-lg prose-img:border prose-img:border-[#e0e0e0]">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                            </div>
                          ) : (
                            <span className="inline-flex gap-1 items-center">
                              <span className="w-[5px] h-[5px] bg-[#717182] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                              <span className="w-[5px] h-[5px] bg-[#717182] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                              <span className="w-[5px] h-[5px] bg-[#717182] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                            </span>
                          )}
                        </div>
                      )}
                      {/* Hover actions */}
                      <div className="flex gap-1 mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleCopyMessage(msg.content, idx)}
                          disabled={!msg.content}
                          className={`flex items-center gap-1 px-1.5 py-[2px] rounded-[4px] text-[10px] transition-colors ${
                            copiedIdx === idx ? "text-green-600 bg-green-50" : "text-[#717182] hover:bg-[#f3f3f5]"
                          }`}
                          title="复制"
                        >
                          {copiedIdx === idx ? (
                            <><Check className="w-[11px] h-[11px]" />已复制</>
                          ) : (
                            <><Copy className="w-[11px] h-[11px]" />复制</>
                          )}
                        </button>
                      </div>
                    </div>
                    {msg.role === "user" && (
                      <div className="w-[30px] h-[30px] rounded-full bg-[#f3f3f5] flex items-center justify-center shrink-0 mt-0.5">
                        <User className="w-[13px] h-[13px] text-[#717182]" />
                      </div>
                    )}
                  </div>
                ))}
                {/* Streaming message overlay — rendered outside the messages array to avoid full-list re-render on each token */}
                {streamingMsg && (
                  <div className="group/msg flex gap-3">
                    <div className="w-[30px] h-[30px] rounded-full bg-[#030213] flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="w-[13px] h-[13px] text-white" />
                    </div>
                    <div className="max-w-[70%] min-w-0">
                      {streamingMsg.model && (
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[10px] text-[#8a9193]" style={{ fontWeight: 400 }}>{streamingMsg.model}</span>
                        </div>
                      )}
                      {streamingMsg.reasoning && (
                        <details className={`mb-2 rounded-[8px] border border-[#e8e5ff] bg-[#faf9ff] overflow-hidden ${!streamingMsg.content ? "open" : ""}`} open={!streamingMsg.content ? true : undefined}>
                          <summary className="px-3 py-2 text-[11.5px] text-[#7c6fbb] cursor-pointer hover:bg-[#f3f0ff] transition-colors flex items-center gap-1.5 select-none" style={{ fontWeight: 500 }}>
                            <svg className="w-[12px] h-[12px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/><line x1="10" y1="22" x2="14" y2="22"/></svg>
                            思考过程
                            {!streamingMsg.content && (
                              <span className="inline-flex gap-0.5 items-center ml-1">
                                <span className="w-[3px] h-[3px] bg-[#7c6fbb] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                                <span className="w-[3px] h-[3px] bg-[#7c6fbb] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                                <span className="w-[3px] h-[3px] bg-[#7c6fbb] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                              </span>
                            )}
                          </summary>
                          <div className="px-3 pb-2.5 text-[12px] text-[#5a5078] leading-[1.7] whitespace-pre-wrap border-t border-[#e8e5ff]">
                            {streamingMsg.reasoning}
                          </div>
                        </details>
                      )}
                      {streamingMsg.toolCalls && (streamingMsg.toolCalls as ToolCallEvent[]).length > 0 && (
                        <div className="mb-2 space-y-1">
                          {(streamingMsg.toolCalls as ToolCallEvent[]).map((tc: ToolCallEvent) => (
                            <details key={tc.id} className="rounded-[7px] border border-[#e2e8f0] bg-[#f8fafb] overflow-hidden">
                              <summary className="px-3 py-1.5 text-[11px] cursor-pointer hover:bg-[#f0f4ff] transition-colors flex items-center gap-1.5 select-none" style={{ fontWeight: 500 }}>
                                {tc.status === "calling" ? (
                                  <Sparkles className="w-[11px] h-[11px] text-[#f59e0b] animate-pulse" />
                                ) : tc.status === "error" ? (
                                  <span className="text-[#ef4444]">✕</span>
                                ) : (
                                  <span className="text-[#10b981]">✓</span>
                                )}
                                <span className="text-[#415a9b]">{tc.name}</span>
                                <span className="text-[#9ca3af]">{tc.status === "calling" ? "调用中..." : tc.status === "error" ? "失败" : "完成"}</span>
                              </summary>
                              <div className="px-3 pb-2 text-[10.5px] text-[#717182] border-t border-[#e2e8f0] space-y-1">
                                <div className="mt-1"><span style={{ fontWeight: 500 }}>参数:</span> <code className="text-[10px] bg-[#e8eaed] px-1 py-0.5 rounded break-all">{JSON.stringify(tc.arguments)}</code></div>
                                {tc.result && (
                                  <div><span style={{ fontWeight: 500 }}>结果:</span> <pre className="mt-0.5 text-[10px] bg-[#f3f3f5] rounded p-2 overflow-x-auto max-h-[150px] overflow-y-auto whitespace-pre-wrap">{tc.result.slice(0, 2000)}</pre></div>
                                )}
                              </div>
                            </details>
                          ))}
                        </div>
                      )}
                      <div className="rounded-[10px] px-4 py-3 text-[13px] leading-[1.7] bg-white border border-[rgba(0,0,0,0.08)] text-[#0a0a0a]" style={{ fontWeight: 400 }}>
                        {streamingMsg.content ? (
                          <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-h1:text-[20px] prose-h2:text-[17px] prose-h3:text-[15px] prose-h4:text-[14px] prose-headings:mt-4 prose-headings:mb-2 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-table:my-2 prose-pre:my-2 prose-pre:bg-[#1e1e2e] prose-pre:text-[#e0e0e0] prose-pre:rounded-lg prose-pre:p-4 prose-code:text-[12px] prose-code:before:content-none prose-code:after:content-none prose-code:bg-[#e8eaed] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[#c7254e] prose-strong:font-semibold prose-blockquote:border-l-[#415a9b] prose-blockquote:bg-[#f8f9ff] prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-md prose-a:text-[#415a9b] prose-a:no-underline hover:prose-a:underline prose-img:rounded-lg prose-img:border prose-img:border-[#e0e0e0]">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingMsg.content}</ReactMarkdown>
                          </div>
                        ) : !streamingMsg.reasoning ? (
                          <span className="inline-flex gap-1 items-center">
                            <span className="w-[5px] h-[5px] bg-[#717182] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                            <span className="w-[5px] h-[5px] bg-[#717182] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                            <span className="w-[5px] h-[5px] bg-[#717182] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}
                {isTyping && !streamingMsg && messages[messages.length - 1]?.role !== "assistant" && (
                  <div className="flex gap-3">
                    <div className="w-[30px] h-[30px] rounded-full bg-[#030213] flex items-center justify-center shrink-0">
                      <Sparkles className="w-[13px] h-[13px] text-white" />
                    </div>
                    <div className="bg-white border border-[rgba(0,0,0,0.08)] rounded-[10px] px-4 py-3">
                      <span className="inline-flex gap-1 items-center">
                        <span
                          className="w-[5px] h-[5px] bg-[#717182] rounded-full animate-bounce"
                          style={{ animationDelay: "0ms" }}
                        />
                        <span
                          className="w-[5px] h-[5px] bg-[#717182] rounded-full animate-bounce"
                          style={{ animationDelay: "150ms" }}
                        />
                        <span
                          className="w-[5px] h-[5px] bg-[#717182] rounded-full animate-bounce"
                          style={{ animationDelay: "300ms" }}
                        />
                      </span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </>
        ) : (
          /* ─── Compare View ─── */
          <div className="flex-1 overflow-y-auto">
            {/* Previous conversation context (collapsed) */}
            {messages.length > 0 && (
              <div className="mx-4 mt-4 mb-2">
                <details className="bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)] overflow-hidden">
                  <summary
                    className="px-4 py-2.5 text-[12px] text-[#717182] cursor-pointer hover:bg-[#fafafa] transition-colors flex items-center gap-2"
                    style={{ fontWeight: 500 }}
                  >
                    <ArrowLeft className="w-[12px] h-[12px]" />
                    之前的对话 ({messages.length} 条消息)
                  </summary>
                  <div className="px-4 pb-3 max-h-[200px] overflow-y-auto border-t border-[rgba(0,0,0,0.06)] space-y-2 pt-2">
                    {messages.slice(-4).map((msg) => (
                      <div
                        key={msg.id}
                        className="text-[11.5px] leading-[1.5]"
                        style={{ fontWeight: 400 }}
                      >
                        <span
                          className={
                            msg.role === "user"
                              ? "text-[#415a9b]"
                              : "text-[#717182]"
                          }
                          style={{ fontWeight: 500 }}
                        >
                          {msg.role === "user"
                            ? "你"
                            : msg.model || "AI"}
                          ：
                        </span>
                        <span className="text-[#0a0a0a] ml-1">
                          {msg.content.length > 100
                            ? msg.content.slice(0, 100) + "..."
                            : msg.content}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}

            {/* Compare rounds */}
            {compareRounds.length === 0 && (
              <div className="flex flex-col items-center justify-center h-[calc(100%-80px)] text-center">
                <GitCompare className="w-[36px] h-[36px] text-[#d0d5dd] mb-4" />
                <p
                  className="text-[14px] text-[#0a0a0a] mb-1"
                  style={{ fontWeight: 500 }}
                >
                  对比模式已开启
                </p>
                <p
                  className="text-[12px] text-[#717182] max-w-[320px]"
                  style={{ fontWeight: 400 }}
                >
                  发送消息后，{compareModels.length}{" "}
                  个模型将同时生成回复。
                  您可以对比后选择最佳回答采纳到对话中。
                </p>
                <div className="flex items-center gap-1.5 mt-4">
                  {compareModels.map((mId) => {
                    const model = ALL_MODELS.find(
                      (m) => m.id === mId,
                    )!;
                    return (
                      <span
                        key={mId}
                        className="text-[11px] px-2 py-[3px] rounded-[5px] bg-[#f3f3f5] text-[#717182]"
                        style={{ fontWeight: 500 }}
                      >
                        {model.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {compareRounds.map((round) => (
              <div key={round.id} className="mb-4">
                {/* User message */}
                <div className="flex justify-end px-5 py-3">
                  <div className="flex gap-2.5 items-start max-w-[560px]">
                    <div
                      className="bg-[#030213] text-white rounded-[10px] px-4 py-2.5 text-[12.5px] leading-[1.7] whitespace-pre-wrap"
                      style={{ fontWeight: 400 }}
                    >
                      {round.attachments && round.attachments.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {round.attachments.map((attachment) => (
                            <span
                              key={attachment.id}
                              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10.5px] text-white/90"
                            >
                              <FileText className="w-[10px] h-[10px]" />
                              <span className="max-w-[180px] truncate">{attachment.name}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {round.userMessage}
                    </div>
                    <div className="w-[28px] h-[28px] rounded-full bg-[#f3f3f5] flex items-center justify-center shrink-0 mt-0.5">
                      <User className="w-[12px] h-[12px] text-[#717182]" />
                    </div>
                  </div>
                </div>

                {/* Adopted banner */}
                {round.adoptedModelId && (
                  <div className="mx-5 mb-3 flex items-center gap-2 px-3 py-2 bg-[#f0fdf4] rounded-[8px] border border-[#bbf7d0]">
                    <Check className="w-[13px] h-[13px] text-[#16a34a]" />
                    <span
                      className="text-[11.5px] text-[#16a34a]"
                      style={{ fontWeight: 500 }}
                    >
                      已采用{" "}
                      {
                        round.responses.find(
                          (r) =>
                            r.modelId === round.adoptedModelId,
                        )?.modelName
                      }{" "}
                      的回答
                    </span>
                  </div>
                )}

                {/* Model columns */}
                {!round.adoptedModelId && (
                  <div className="px-3">
                    <div
                      className={`grid gap-2.5 ${compareModels.length === 4 ? "overflow-x-auto" : ""}`}
                      style={{
                        gridTemplateColumns:
                          compareModels.length <= 3
                            ? `repeat(${compareModels.length}, minmax(0, 1fr))`
                            : `repeat(4, minmax(260px, 1fr))`,
                      }}
                    >
                      {round.responses.map((resp) => (
                        <div
                          key={resp.modelId}
                          className="bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)] flex flex-col overflow-hidden"
                        >
                          {/* Column header */}
                          <div className="px-3.5 py-2.5 border-b border-[rgba(0,0,0,0.06)] flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-2">
                              <div className="w-[22px] h-[22px] rounded-full bg-[#030213] flex items-center justify-center">
                                <Sparkles className="w-[10px] h-[10px] text-white" />
                              </div>
                              <span
                                className="text-[12px] text-[#0a0a0a]"
                                style={{ fontWeight: 500 }}
                              >
                                {resp.modelName}
                              </span>
                            </div>
                            {resp.done && (
                              <div className="flex items-center gap-2">
                                <span className="flex items-center gap-0.5 text-[10px] text-[#8a9193]">
                                  <Clock className="w-[9px] h-[9px]" />{" "}
                                  {resp.latency}
                                </span>
                                <span className="flex items-center gap-0.5 text-[10px] text-[#8a9193]">
                                  <Hash className="w-[9px] h-[9px]" />{" "}
                                  {resp.tokens}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 px-3.5 py-3 overflow-y-auto max-h-[400px]">
                            {resp.done ? (
                              <div className="prose prose-sm max-w-none text-[12px] text-[#0a0a0a] leading-[1.7] prose-headings:font-semibold prose-h1:text-[18px] prose-h2:text-[16px] prose-h3:text-[14px] prose-headings:mt-3 prose-headings:mb-1.5 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-pre:bg-[#1e1e2e] prose-pre:text-[#e0e0e0] prose-pre:rounded-lg prose-pre:p-3 prose-code:text-[11px] prose-code:before:content-none prose-code:after:content-none prose-code:bg-[#e8eaed] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[#c7254e] prose-strong:font-semibold prose-blockquote:border-l-[#415a9b] prose-blockquote:bg-[#f8f9ff] prose-a:text-[#415a9b] prose-img:rounded-lg prose-img:border prose-img:border-[#e0e0e0]"
                                style={{ fontWeight: 400 }}
                              >
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{resp.content}</ReactMarkdown>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 py-6 justify-center">
                                <span className="inline-flex gap-1 items-center">
                                  <span
                                    className="w-[4px] h-[4px] bg-[#717182] rounded-full animate-bounce"
                                    style={{
                                      animationDelay: "0ms",
                                    }}
                                  />
                                  <span
                                    className="w-[4px] h-[4px] bg-[#717182] rounded-full animate-bounce"
                                    style={{
                                      animationDelay: "150ms",
                                    }}
                                  />
                                  <span
                                    className="w-[4px] h-[4px] bg-[#717182] rounded-full animate-bounce"
                                    style={{
                                      animationDelay: "300ms",
                                    }}
                                  />
                                </span>
                                <span className="text-[11px] text-[#8a9193]">
                                  生成中...
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Adopt button */}
                          {resp.done && (
                            <div className="px-3 pb-3 pt-1 shrink-0">
                              <button
                                onClick={() =>
                                  handleAdopt(
                                    round.id,
                                    resp.modelId,
                                  )
                                }
                                className="w-full flex items-center justify-center gap-1.5 py-[7px] rounded-[7px] border border-[rgba(0,0,0,0.1)] text-[11.5px] text-[#0a0a0a] hover:bg-[#030213] hover:text-white hover:border-[#030213] transition-all"
                                style={{ fontWeight: 500 }}
                              >
                                <ThumbsUp className="w-[12px] h-[12px]" />
                                采用此回答
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Horizontal scroll hint for 4 models */}
                    {compareModels.length > 3 && (
                      <div className="mt-2 text-center">
                        <span className="text-[10px] text-[#8a9193]">
                          ← 水平滚动查看更多模型 →
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={compareEndRef} />
          </div>
        )}

        {/* ── Input Area ── */}
        <ConversationComposer
          containerClassName="bg-white px-4 py-3 shrink-0"
          contentClassName={isCompare ? "max-w-full px-1" : "max-w-[680px]"}
          value={input}
          onChange={setInput}
          onSend={handleSend}
          placeholder={
            isCompare
              ? `输入消息，同时向 ${compareModels.length} 个模型发送...`
              : "输入消息..."
          }
          actionLabel={isCompare ? "发送对比" : "发送"}
          sending={isCompare ? compareLoading : isTyping}
          disabled={isCompare ? compareLoading : isTyping}
          canSend={canSendMessage}
          topSlot={composerTopSlot}
          leftSlot={composerLeftSlot}
          dragActive={isComposerDragActive}
          onDragOver={handleComposerDragOver}
          onDragLeave={handleComposerDragLeave}
          onDrop={handleComposerDrop}
        />
      </div>

      {/* ── Skill Panel ── */}
      <SkillPanel
        isOpen={skillPanelOpen}
        onClose={() => setSkillPanelOpen(false)}
        activeSkillIds={activeSkillIds}
        onToggleSkill={toggleSkill}
      />

      {/* ── Adopted Toast ── */}
      {adoptedToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 bg-[#030213] text-white rounded-[8px] shadow-[0_8px_24px_rgba(0,0,0,0.2)] animate-[slideUp_0.3s_ease-out]">
          <Check className="w-[14px] h-[14px] text-[#10b981]" />
          <span
            className="text-[12.5px]"
            style={{ fontWeight: 500 }}
          >
            已采用 {adoptedToast} 的回答，已返回对话模式
          </span>
        </div>
      )}

      {/* ── Confirm Exit Modal ── */}
      {compareState === "confirming-exit" && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center">
          <div className="bg-white rounded-[12px] border border-[rgba(0,0,0,0.1)] shadow-[0_8px_32px_rgba(0,0,0,0.12)] p-6 max-w-[360px] w-full mx-4">
            <p
              className="text-[14px] text-[#0a0a0a] mb-2"
              style={{ fontWeight: 500 }}
            >
              退出对比模式？
            </p>
            <p
              className="text-[12.5px] text-[#717182] mb-5"
              style={{ fontWeight: 400 }}
            >
              当前有未采用的对比回答。退出后这些回答将被丢弃，不会保留到对话历史中。
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setCompareState("active")}
                className="px-4 py-[7px] rounded-[7px] border border-[rgba(0,0,0,0.1)] text-[12.5px] text-[#717182] hover:bg-[#f8fafb] transition-colors"
                style={{ fontWeight: 500 }}
              >
                继续对比
              </button>
              <button
                onClick={confirmExit}
                className="px-4 py-[7px] rounded-[7px] bg-[#030213] text-white text-[12.5px] hover:bg-[#1a1a2e] transition-colors"
                style={{ fontWeight: 500 }}
              >
                确认退出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}