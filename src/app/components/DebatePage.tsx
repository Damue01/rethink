import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft, Pause, BarChart3, Play, Sparkles, Loader2, ChevronDown,
  Plus, PanelLeftClose, PanelLeft, X, MessageCircleQuestion, User, Settings, Eye,
  Upload, FileText,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SkillPanel, SkillBadges } from "./SkillPanel";
import { getDefaultModel, getAllModels } from "../services/llmConfig";
import { agentLoop } from "../services/toolLoop";
import { loadSkills } from "./skillData";
import { loadRoles, renderRolePrompt } from "../services/roles";
import { ConversationComposer } from "./ui/conversation-composer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
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
import { executeBuiltinTool } from "../services/builtinTools";
import { createStorageHelper, groupByRecency } from "../services/storage";
import { HistorySidebar } from "./HistorySidebar";
import { useIsMobile } from "./ui/use-mobile";

interface Agent {
  id: string;
  name: string;
  color: string;
  emoji: string;
  systemPrompt: string;
  stance: number;
  active: boolean;
}

interface DebateMessage {
  id: string;
  agentId: string;
  round: number;
  text: string;
  systemPrompt?: string;
}

function loadAgentsFromRoles(): Agent[] {
  const roles = loadRoles();
  return roles.map((r, i) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    emoji: r.emoji,
    systemPrompt: r.systemPrompt,
    stance: r.stance,
    active: i < 4,
  }));
}

const debateMessages: DebateMessage[] = [];

/* ── Debate persistence ── */

interface StoredDebate {
  id: string;
  title: string;
  topic: string;
  projectBackground: string;
  backgroundAttachments?: ChatAttachment[];
  messages: DebateMessage[];
  summaryContent: string;
  currentRound: number;
  totalRounds: number;
  activeSkillIds?: string[];
  isDebating?: boolean;
  updatedAt: number;
}

const debateStorage = createStorageHelper<StoredDebate>("ai-review-debate-conversations");

function loadDebates(): StoredDebate[] {
  return debateStorage.load();
}

function saveDebates(items: StoredDebate[]) {
  debateStorage.save(items);
}

function upsertStoredDebate(item: StoredDebate): StoredDebate[] {
  return debateStorage.upsert(item, (e) => e.id);
}

/* ── Module-level loop control (survives component unmount) ── */
interface DebateLoopCtrl {
  cancelled: boolean;
  isPaused: boolean;
  componentMounted: boolean;
  abort: AbortController | null;
  userInputResolve: ((v: string) => void) | null;
}
const debateLoops = new Map<string, DebateLoopCtrl>();

function groupDebates(items: StoredDebate[]) {
  return groupByRecency(items, (c) => c.updatedAt, (c) => ({ id: c.id, title: c.title }));
}

export function DebatePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [agentState, setAgentState] = useState(() => loadAgentsFromRoles());
  const [isPaused, setIsPaused] = useState(false);
  const [messages, setMessages] = useState<DebateMessage[]>(debateMessages);
  const messagesRef = useRef<DebateMessage[]>(debateMessages);
  const [input, setInput] = useState("");
  const [targetAgent, setTargetAgent] = useState("all");
  const [skillPanelOpen, setSkillPanelOpen] = useState(false);
  const [activeSkillIds, setActiveSkillIds] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [projectBackground, setProjectBackground] = useState("");
  const [isDebating, setIsDebating] = useState(false);
  const [agentModels, setAgentModels] = useState<Record<string, string>>(() => {
    const models = getAllModels();
    const defaultId = models.length > 0 ? models[0].model.id : "";
    const initialAgents = loadAgentsFromRoles();
    return Object.fromEntries(initialAgents.map((a) => [a.id, defaultId]));
  });
  const [openModelDropdown, setOpenModelDropdown] = useState<string | null>(null);
  const modelDropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [currentRound, setCurrentRound] = useState(0);
  const [summaryContent, setSummaryContent] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [totalRounds, setTotalRounds] = useState(5);
  const [userParticipant, setUserParticipant] = useState(false);
  const userInputResolveRef = useRef<((value: string) => void) | null>(null);
  const [waitingForUser, setWaitingForUser] = useState(false);

  /* ── Attachment state ── */
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [isComposerDragActive, setIsComposerDragActive] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Background attachments (project background section) ── */
  const [backgroundAttachments, setBackgroundAttachments] = useState<ChatAttachment[]>([]);
  const [bgAttachmentError, setBgAttachmentError] = useState<string | null>(null);
  const [fetchedUrlContents, setFetchedUrlContents] = useState<Record<string, string>>({});
  const [isFetchingUrls, setIsFetchingUrls] = useState(false);
  const bgFileInputRef = useRef<HTMLInputElement>(null);

  const [showAtTip, setShowAtTip] = useState(false);
  const [viewingPrompt, setViewingPrompt] = useState<string | null>(null);

  /* ── History sidebar state ── */
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [debates, setDebates] = useState<StoredDebate[]>(loadDebates);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isPausedRef = useRef(isPaused);
  const lastSyncedUpdatedAtRef = useRef(0);
  const hasPendingAgentMessage = messages.some((msg) => msg.agentId !== "user" && !msg.text.trim());
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const stateSnapshotRef = useRef({ topic, projectBackground, backgroundAttachments, summaryContent, currentRound, totalRounds, activeSkillIds, isDebating });
  useEffect(() => { stateSnapshotRef.current = { topic, projectBackground, backgroundAttachments, summaryContent, currentRound, totalRounds, activeSkillIds, isDebating }; }, [topic, projectBackground, backgroundAttachments, summaryContent, currentRound, totalRounds, activeSkillIds, isDebating]);

  const historyGroups = groupDebates(debates);

  // Auto-close sidebar on mobile
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const applyStoredDebate = useCallback((stored: StoredDebate) => {
    setMessages(stored.messages);
    setTopic(stored.topic);
    setProjectBackground(stored.projectBackground || "");
    setBackgroundAttachments(stored.backgroundAttachments || []);
    setSummaryContent(stored.summaryContent);
    setCurrentRound(stored.currentRound);
    if (stored.totalRounds) setTotalRounds(stored.totalRounds);
    setActiveSkillIds(stored.activeSkillIds ?? []);
    setIsDebating(Boolean(stored.isDebating));
    setIsPaused(stored.currentRound > 0 && !stored.isDebating);
    lastSyncedUpdatedAtRef.current = stored.updatedAt;
  }, []);

  // Redirect /debate/new to a fresh ID
  useEffect(() => {
    if (id === "new") {
      navigate(`/debate/${Date.now().toString()}`, { replace: true });
    }
  }, [id, navigate]);

  // Load debate by route id
  useEffect(() => {
    if (id && id !== "new") {
      const ctrl = debateLoops.get(id);
      if (ctrl) ctrl.componentMounted = true;
      const stored = loadDebates().find(c => c.id === id);
      if (stored) {
        applyStoredDebate(stored);
        // If a background loop is still running, reflect that
        if (ctrl && !ctrl.cancelled) setIsDebating(true);
      } else {
        setMessages([]);
        setTopic("");
        setProjectBackground("");
        setBackgroundAttachments([]);
        setSummaryContent("");
        setCurrentRound(0);
        setActiveSkillIds([]);
        setIsDebating(false);
        setIsPaused(false);
        lastSyncedUpdatedAtRef.current = 0;
      }
    }
  }, [id, applyStoredDebate]);

  // Same-tab background updates won't trigger a storage event, so poll the latest snapshot.
  useEffect(() => {
    if (!id || id === "new") return;

    const syncFromStorage = () => {
      const stored = loadDebates().find((entry) => entry.id === id);
      if (!stored) return;
      if (stored.updatedAt > lastSyncedUpdatedAtRef.current) {
        applyStoredDebate(stored);
      }
    };

    syncFromStorage();
    // Poll more frequently (200ms) to keep UI in sync with background loops
    const timer = window.setInterval(syncFromStorage, 200);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") syncFromStorage();
    };
    window.addEventListener("focus", syncFromStorage);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", syncFromStorage);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [id, applyStoredDebate]);

  // Save progress when unmounting; let background debate loop keep running
  useEffect(() => {
    return () => {
      const ctrl = id ? debateLoops.get(id) : undefined;
      const isLoopRunning = !!(ctrl && !ctrl.cancelled && !ctrl.isPaused);
      if (ctrl) {
        ctrl.componentMounted = false;
        // Resolve pending user-input so the loop doesn't hang on UI
        if (ctrl.userInputResolve) {
          ctrl.userInputResolve("");
          ctrl.userInputResolve = null;
        }
      }
      const currentId = id;
      if (!currentId || currentId === "new") return;
      const snap = stateSnapshotRef.current;
      const currentMsgs = messagesRef.current.filter((m) => m.text.trim());
      if (currentMsgs.length === 0 && !snap.topic) return;
      const title = (snap.topic || "").slice(0, 30) || "新辩论";
      upsertStoredDebate({
        id: currentId, title, topic: snap.topic, projectBackground: snap.projectBackground,
        backgroundAttachments: snap.backgroundAttachments, messages: currentMsgs,
        summaryContent: snap.summaryContent, currentRound: snap.currentRound,
        totalRounds: snap.totalRounds, activeSkillIds: snap.activeSkillIds,
        isDebating: isLoopRunning, updatedAt: Date.now(),
      });
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save debate after streaming completes (debating stopped or message added)
  const saveCurrentDebate = useCallback(() => {
    if (!id || id === "new" || messages.length === 0) return;
    const title = topic.slice(0, 30) || "新辩论";
    const item: StoredDebate = { id, title, topic, projectBackground, backgroundAttachments, messages, summaryContent, currentRound, totalRounds, activeSkillIds, isDebating, updatedAt: Date.now() };
    const items = upsertStoredDebate(item);
    lastSyncedUpdatedAtRef.current = item.updatedAt;
    setDebates(items);
  }, [id, messages, topic, projectBackground, backgroundAttachments, summaryContent, currentRound, totalRounds, activeSkillIds, isDebating]);

  const persistDebateMessage = useCallback((message: DebateMessage, overrides?: Partial<StoredDebate>, debounce = true) => {
    if (!id || id === "new") return;

    const existing = debateStorage.find((entry) => entry.id === id);
    const nextMessages = existing ? [...existing.messages] : [];
    const msgIdx = nextMessages.findIndex((entry) => entry.id === message.id);
    if (msgIdx >= 0) nextMessages[msgIdx] = message;
    else nextMessages.push(message);

    const nextTopic = overrides?.topic ?? existing?.topic ?? topic;
    const nextProjectBackground = overrides?.projectBackground ?? existing?.projectBackground ?? projectBackground;
    const nextBackgroundAttachments = overrides?.backgroundAttachments ?? existing?.backgroundAttachments ?? backgroundAttachments;
    const nextSummaryContent = overrides?.summaryContent ?? existing?.summaryContent ?? summaryContent;
    const nextCurrentRound = overrides?.currentRound ?? existing?.currentRound ?? currentRound;
    const nextTotalRounds = overrides?.totalRounds ?? existing?.totalRounds ?? totalRounds;
    const nextSkillIds = overrides?.activeSkillIds ?? existing?.activeSkillIds ?? activeSkillIds;

    const entry: StoredDebate = {
      id,
      title: nextTopic.slice(0, 30) || "新辩论",
      topic: nextTopic,
      projectBackground: nextProjectBackground,
      backgroundAttachments: nextBackgroundAttachments,
      messages: nextMessages,
      summaryContent: nextSummaryContent,
      currentRound: nextCurrentRound,
      totalRounds: nextTotalRounds,
      activeSkillIds: nextSkillIds,
      isDebating: overrides?.isDebating ?? existing?.isDebating ?? isDebating,
      updatedAt: Date.now(),
    };

    if (debounce) {
      // During streaming: update in-memory cache immediately, debounce localStorage write
      const items = debateStorage.load();
      const idx = items.findIndex((e) => e.id === id);
      if (idx >= 0) items[idx] = entry; else items.unshift(entry);
      debateStorage.debouncedSave(items, 500);
      lastSyncedUpdatedAtRef.current = entry.updatedAt;
      setDebates([...items]);
    } else {
      // Final save: immediate write
      const items = upsertStoredDebate(entry);
      const saved = items.find((e) => e.id === id);
      lastSyncedUpdatedAtRef.current = saved?.updatedAt ?? Date.now();
      setDebates(items);
    }
  }, [id, topic, projectBackground, backgroundAttachments, summaryContent, currentRound, totalRounds, activeSkillIds, isDebating]);

  // Save when skill config changes (even without sending a message)
  const configSaveSkipRef = useRef(true);
  useEffect(() => { configSaveSkipRef.current = true; }, [id]);
  useEffect(() => {
    if (configSaveSkipRef.current) { configSaveSkipRef.current = false; return; }
    if (!id || id === "new" || messages.length === 0) return;
    saveCurrentDebate();
  }, [activeSkillIds]);

  const wasDebatingRef = useRef(false);
  useEffect(() => {
    if (wasDebatingRef.current && !isDebating) {
      saveCurrentDebate();
    }
    wasDebatingRef.current = isDebating;
  }, [isDebating, saveCurrentDebate]);

  // Also save after user messages (non-debating interactions)
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    if (!isDebating && messages.length > 0 && messages.length !== prevMsgCountRef.current) {
      const allDone = messages.every((m) => m.agentId === "user" || m.text.trim());
      if (allDone) saveCurrentDebate();
    }
    prevMsgCountRef.current = messages.length;
  }, [messages, isDebating, saveCurrentDebate]);

  // Save summary when done
  useEffect(() => {
    if (!isSummarizing && summaryContent) saveCurrentDebate();
  }, [isSummarizing, summaryContent, saveCurrentDebate]);

  const handleDeleteDebate = (deleteId: string) => {
    const items = loadDebates().filter(c => c.id !== deleteId);
    saveDebates(items);
    setDebates(items);
    setContextMenuId(null);
    if (deleteId === id) navigate("/debate/new");
  };

  const handleRenameDebate = (renameId: string, newTitle: string) => {
    if (!newTitle.trim()) { setRenamingId(null); return; }
    const items = loadDebates();
    const idx = items.findIndex(c => c.id === renameId);
    if (idx >= 0) { items[idx] = { ...items[idx], title: newTitle.trim() }; saveDebates(items); setDebates(items); }
    setRenamingId(null);
  };

  /* ── Available models ── */
  const configuredModels = getAllModels();
  const hasConfiguredModels = configuredModels.length > 0;
  const ALL_MODELS = configuredModels.map((m) => ({ id: m.model.id, name: m.model.displayName }));

  /* ── Click-outside to close model dropdown ── */
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!openModelDropdown) return;
      const ref = modelDropdownRefs.current[openModelDropdown];
      if (ref && !ref.contains(e.target as Node)) setOpenModelDropdown(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openModelDropdown]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const toggleAgent = (id: string) => {
    setAgentState((prev) => prev.map((a) => (a.id === id ? { ...a, active: !a.active } : a)));
  };

  const toggleSkill = (skillId: string) => {
    setActiveSkillIds((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
    );
  };

  const buildContext = useCallback(() => {
    let ctx = "";
    if (projectBackground.trim()) {
      ctx += `项目背景：${projectBackground.trim()}\n`;
    }
    // Include background file attachments
    if (backgroundAttachments.length > 0) {
      ctx += `\n## 项目背景附件\n`;
      for (const att of backgroundAttachments) {
        const suffix = att.truncated ? "\n[内容已截断]" : "";
        ctx += `\n### ${att.name}\n\`\`\`${att.language}\n${att.text}\n\`\`\`${suffix}\n`;
      }
    }
    // Include fetched URL contents
    const urlEntries = Object.entries(fetchedUrlContents);
    if (urlEntries.length > 0) {
      ctx += `\n## 链接内容\n`;
      for (const [url, content] of urlEntries) {
        ctx += `\n### ${url}\n${content}\n`;
      }
    }
    if (activeSkillIds.length > 0) {
      const skills = loadSkills().filter((s) => activeSkillIds.includes(s.id));
      for (const skill of skills) {
        ctx += `\n### ${skill.name}\n`;
        for (const doc of skill.documents) ctx += `${doc.name}: ${doc.content}\n`;
      }
    }
    return ctx;
  }, [activeSkillIds, projectBackground, backgroundAttachments, fetchedUrlContents]);

  const getAgentModelConfig = useCallback((agentId: string) => {
    const selectedModelId = agentModels[agentId];
    if (selectedModelId) {
      const found = configuredModels.find((m) => m.model.id === selectedModelId);
      if (found) return { provider: { apiKey: found.apiKey, baseUrl: found.baseUrl }, model: found.model.name };
    }
    const def = getDefaultModel();
    if (def) return { provider: { apiKey: def.provider.apiKey, baseUrl: def.provider.baseUrl }, model: def.model.name };
    return null;
  }, [agentModels, configuredModels]);

  const hasUsableActiveAgent = agentState.some((agent) => agent.active && getAgentModelConfig(agent.id));

  const runAgentTurn = useCallback(
    async (agent: Agent, round: number, priorMessages: DebateMessage[], userTopic: string, ctrl: DebateLoopCtrl) => {
      const modelCfg = getAgentModelConfig(agent.id);
      if (!modelCfg) return;

      const ctx = buildContext();
      const systemPrompt =
        renderRolePrompt(
          { id: agent.id, name: agent.name, emoji: agent.emoji, color: agent.color, stance: agent.stance, styleTags: [], systemPrompt: agent.systemPrompt, isBuiltin: false },
          { userProblem: userTopic, currentContext: ctx },
        ) +
        `\n\n发言简洁有力，控制在150字以内。\n你现在是第 ${round} 轮发言。先前的辩论内容如下：`;

      const historyMsgs = priorMessages.map((m) => {
        const a = agentState.find((ag) => ag.id === m.agentId);
        return { role: "user" as const, content: `[${a?.name || m.agentId}]: ${m.text}` };
      });

      // Build full prompt for display: system prompt + history + final instruction
      const fullPrompt = systemPrompt
        + (historyMsgs.length > 0 ? "\n\n" + historyMsgs.map((m) => m.content).join("\n\n") : "")
        + `\n\n请以${agent.name}的身份发表你的观点。`;

      const msgId = `${Date.now()}-${agent.id}`;
      const newMsg: DebateMessage = { id: msgId, agentId: agent.id, round, text: "", systemPrompt: fullPrompt };

      setMessages((prev) => [...prev, newMsg]);
      persistDebateMessage(newMsg, { currentRound: round, topic: userTopic, isDebating: true });

      return new Promise<DebateMessage>((resolve) => {
        const abort = new AbortController();
        ctrl.abort = abort;
        // Ensure abort always resolves the promise so runDebate loop doesn't hang
        const onAbort = () => resolve(newMsg);
        abort.signal.addEventListener("abort", onAbort);
        agentLoop(
          {
            apiKey: modelCfg.provider.apiKey,
            baseUrl: modelCfg.provider.baseUrl,
            model: modelCfg.model,
            messages: [
              { role: "system", content: systemPrompt },
              ...historyMsgs,
              { role: "user", content: `请以${agent.name}的身份发表你的观点。` },
            ],
            temperature: 0.8,
            maxTokens: 800,
            signal: abort.signal,
          },
          {
            onToken(token) {
              if (ctrl.cancelled) return;
              newMsg.text += token;
              persistDebateMessage({ ...newMsg }, { currentRound: round, topic: userTopic, isDebating: true }, true);
              setMessages((prev) =>
                prev.map((m) => (m.id === msgId ? { ...m, text: newMsg.text } : m)),
              );
            },
            onDone() {
              if (ctrl.cancelled) { resolve(newMsg); return; }
              debateStorage.flush();
              persistDebateMessage({ ...newMsg }, { currentRound: round, topic: userTopic, isDebating: true }, false);
              resolve(newMsg);
            },
            onError(err) {
              if (ctrl.cancelled) { resolve(newMsg); return; }
              newMsg.text = newMsg.text || `**错误**: ${err.message}`;
              debateStorage.flush();
              persistDebateMessage({ ...newMsg }, { currentRound: round, topic: userTopic, isDebating: true }, false);
              setMessages((prev) =>
                prev.map((m) => (m.id === msgId ? { ...m, text: newMsg.text } : m)),
              );
              resolve(newMsg);
            },
          },
        );
      });
    },
    [buildContext, getAgentModelConfig, persistDebateMessage, agentState],
  );

  const runDebate = useCallback(
    async (userTopic: string, startRound = 1) => {
      // Cancel any existing background loop for this debate
      const oldCtrl = id ? debateLoops.get(id) : undefined;
      if (oldCtrl) { oldCtrl.cancelled = true; oldCtrl.abort?.abort(); }
      const ctrl: DebateLoopCtrl = { cancelled: false, isPaused: false, componentMounted: true, abort: null, userInputResolve: null };
      if (id) debateLoops.set(id, ctrl);

      setIsDebating(true);
      setIsPaused(false);
      isPausedRef.current = false;

      const existing = loadDebates().find((entry) => entry.id === id);
      if (existing) {
        const items = upsertStoredDebate({ ...existing, isDebating: true, updatedAt: Date.now() });
        const saved = items.find((entry) => entry.id === id);
        lastSyncedUpdatedAtRef.current = saved?.updatedAt ?? Date.now();
        setDebates(items);
      }

      if (startRound <= 1) {
        setCurrentRound(0);
      }

      // When resuming, seed context with existing messages
      const allMsgs: DebateMessage[] = startRound > 1
        ? messagesRef.current.filter((m) => m.agentId !== "summary")
        : [];

      for (let round = startRound; round <= totalRounds; round++) {
        if (ctrl.cancelled) { if (id) debateLoops.delete(id); return; }
        setCurrentRound(round);

        // Determine which agents already spoke in this round (for mid-round resume)
        const spokenInRound = new Set(
          allMsgs
            .filter((m) => m.round === round && m.agentId !== "user" && m.agentId !== "summary" && m.text.trim())
            .map((m) => m.agentId),
        );

        // If user participant is enabled, wait for user input (skip if user already spoke in this round)
        if (userParticipant && round > 1) {
          const userAlreadySpoke = allMsgs.some((m) => m.round === round && m.agentId === "user");
          if (!userAlreadySpoke && ctrl.componentMounted) {
            setWaitingForUser(true);
            const userText = await new Promise<string>((resolve) => {
              ctrl.userInputResolve = resolve;
              // If component unmounts between now and resolution, cleanup resolves ""
              if (!ctrl.componentMounted) { resolve(""); ctrl.userInputResolve = null; }
            });
            setWaitingForUser(false);
            ctrl.userInputResolve = null;
            if (ctrl.cancelled) { if (id) debateLoops.delete(id); return; }
            if (userText.trim()) {
              const userMsg: DebateMessage = {
                id: `${Date.now()}-user-r${round}`,
                agentId: "user",
                round,
                text: userText,
              };
              setMessages((prev) => [...prev, userMsg]);
              persistDebateMessage(userMsg, { currentRound: round, topic: userTopic });
              allMsgs.push(userMsg);
            }
          }
        }

        const activeAgents = agentState.filter((a) => a.active);
        for (const agent of activeAgents) {
          if (ctrl.isPaused || ctrl.cancelled) {
            if (ctrl.cancelled) { if (id) debateLoops.delete(id); return; } // stale loop, exit silently
            setIsDebating(false);
            const storedPause = loadDebates().find((entry) => entry.id === id);
            const cleanedMsgs = (storedPause?.messages ?? messagesRef.current).filter((m) => m.text.trim());
            messagesRef.current = cleanedMsgs;
            setMessages(cleanedMsgs);
            const items = upsertStoredDebate({
              ...(storedPause ?? {
                id: id!,
                title: userTopic.slice(0, 30) || "新辩论",
                topic: userTopic,
                projectBackground,
                backgroundAttachments,
                messages: cleanedMsgs,
                summaryContent,
                currentRound: round,
                totalRounds,
                activeSkillIds,
              }),
              messages: cleanedMsgs,
              currentRound: round,
              isDebating: false,
              updatedAt: Date.now(),
            } as StoredDebate);
            const saved = items.find((entry) => entry.id === id);
            lastSyncedUpdatedAtRef.current = saved?.updatedAt ?? Date.now();
            setDebates(items);
            if (id) debateLoops.delete(id);
            return;
          }
          if (spokenInRound.has(agent.id)) continue; // already spoke (resume skip)
          const msg = await runAgentTurn(agent, round, allMsgs, userTopic, ctrl);
          if (msg) allMsgs.push(msg);
        }
      }
      if (ctrl.cancelled) { if (id) debateLoops.delete(id); return; }
      setIsDebating(false);
      setIsPaused(true); // back to idle so "继续" button shows correctly
      const storedEnd = loadDebates().find((entry) => entry.id === id);
      const finalMsgs = (storedEnd?.messages ?? messagesRef.current).filter((m) => m.text.trim());
      const items = upsertStoredDebate({
        ...(storedEnd ?? {
          id: id!,
          title: userTopic.slice(0, 30) || "新辩论",
          topic: userTopic,
          projectBackground,
          backgroundAttachments,
          messages: finalMsgs,
          summaryContent,
          currentRound: totalRounds,
          totalRounds,
          activeSkillIds,
        }),
        messages: finalMsgs,
        currentRound: totalRounds,
        isDebating: false,
        updatedAt: Date.now(),
      } as StoredDebate);
      const saved = items.find((entry) => entry.id === id);
      lastSyncedUpdatedAtRef.current = saved?.updatedAt ?? Date.now();
      setDebates(items);
      if (id) debateLoops.delete(id);
    },
    [agentState, runAgentTurn, totalRounds, userParticipant, id, projectBackground, backgroundAttachments, summaryContent, activeSkillIds],
  );

  /* ── Attachment handlers ── */
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
    if (!isComposerDragActive) setIsComposerDragActive(true);
  }, [isComposerDragActive]);

  const handleComposerDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsComposerDragActive(false);
  }, []);

  const handleComposerDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsComposerDragActive(false);
    if (event.dataTransfer.files.length > 0) void handleSelectedFiles(event.dataTransfer.files);
  }, [handleSelectedFiles]);

  const removePendingAttachment = (attachmentId: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  };

  const clearAttachmentState = () => {
    setPendingAttachments([]);
    setComposerError(null);
    setIsComposerDragActive(false);
  };

  /* ── Background attachment handlers ── */
  const handleBgSelectedFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const remainingSlots = Math.max(0, MAX_CHAT_ATTACHMENT_COUNT - backgroundAttachments.length);
    const limitedFiles = remainingSlots > 0 ? files.slice(0, remainingSlots) : [];
    const overflowCount = files.length - limitedFiles.length;
    const result = await readChatAttachments(limitedFiles);
    if (result.attachments.length > 0) {
      setBackgroundAttachments((prev) => [...prev, ...result.attachments]);
    }
    const errorParts = [
      ...result.rejected.map(({ fileName, reason }) => `${fileName}: ${reason}`),
      ...(overflowCount > 0 ? [`最多只能附加 ${MAX_CHAT_ATTACHMENT_COUNT} 个文件`] : []),
    ];
    setBgAttachmentError(errorParts.length > 0 ? errorParts.join("；") : null);
  }, [backgroundAttachments.length]);

  const removeBgAttachment = (attachmentId: string) => {
    setBackgroundAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  };

  /* ── URL extraction & auto-fetch ── */
  const extractUrls = (text: string): string[] => {
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
    const matches = text.match(urlRegex);
    return matches ? [...new Set(matches)] : [];
  };

  const fetchBackgroundUrls = useCallback(async (text: string) => {
    const urls = extractUrls(text);
    if (urls.length === 0) return;
    setIsFetchingUrls(true);
    const newContents: Record<string, string> = {};
    await Promise.all(
      urls.map(async (url) => {
        try {
          const result = await executeBuiltinTool("fetch_url", { url });
          const content = result.content
            ?.filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n");
          if (content && !result.isError) {
            newContents[url] = content.slice(0, 8000); // cap per URL
          }
        } catch { /* skip failed URLs */ }
      }),
    );
    setFetchedUrlContents((prev) => ({ ...prev, ...newContents }));
    setIsFetchingUrls(false);
  }, []);

  const handleStart = async () => {
    const text = input.trim();
    if (!text && pendingAttachments.length === 0) return;

    if (!hasUsableActiveAgent) {
      setComposerError("未找到可用模型，请先在设置中为至少一个活跃角色配置模型。");
      return;
    }

    const attachments = pendingAttachments;
    const { displayContent, promptContent } = buildOutgoingUserMessage(input, attachments);
    setTopic(displayContent);
    setInput("");
    clearAttachmentState();
    setMessages([]);
    // Auto-fetch URLs from project background before starting debate
    await fetchBackgroundUrls(projectBackground);
    runDebate(promptContent, 1);
  };

  const handleUserMessage = () => {
    const text = input.trim();
    if ((!text && pendingAttachments.length === 0) || isDebating) return;

    const respondingAgents =
      targetAgent === "all"
        ? agentState.filter((a) => a.active)
        : agentState.filter((a) => a.id === targetAgent && a.active);
    const usableRespondingAgents = respondingAgents.filter((agent) => Boolean(getAgentModelConfig(agent.id)));

    if (usableRespondingAgents.length === 0) {
      setComposerError(targetAgent === "all"
        ? "当前没有可响应的角色模型，请先在设置中为活跃角色配置模型。"
        : "目标角色未配置可用模型，请先为该角色选择模型。");
      return;
    }

    const attachments = pendingAttachments;
    const { displayContent, promptContent } = buildOutgoingUserMessage(input, attachments);
    setInput("");
    clearAttachmentState();

    const userMsg: DebateMessage = {
      id: `${Date.now()}-user`,
      agentId: "user",
      round: currentRound,
      text: targetAgent === "all" ? displayContent : `@${agentState.find((a) => a.id === targetAgent)?.name}: ${displayContent}`,
    };
    setMessages((prev) => [...prev, userMsg]);
    persistDebateMessage(userMsg);

    // Next call target agent(s) to respond
    for (const agent of usableRespondingAgents) {
      const modelCfg = getAgentModelConfig(agent.id);
      if (!modelCfg) continue;
      const msgId = `${Date.now()}-${agent.id}-reply`;
      const ctx = buildContext();
      const systemPrompt =
        renderRolePrompt(
          { id: agent.id, name: agent.name, emoji: agent.emoji, color: agent.color, stance: agent.stance, styleTags: [], systemPrompt: agent.systemPrompt, isBuiltin: false },
          { userProblem: topic, currentContext: ctx },
        ) +
        `\n\n发言简洁有力，控制在150字以内。`;

      const historyMsgs = messages.slice(-10).map((m) => {
        if (m.agentId === "user") return { role: "user" as const, content: m.text };
        const a = agentState.find((ag) => ag.id === m.agentId);
        return { role: "user" as const, content: `[${a?.name || m.agentId}]: ${m.text}` };
      });

      const fullPrompt = systemPrompt
        + (historyMsgs.length > 0 ? "\n\n" + historyMsgs.map((m) => m.content).join("\n\n") : "")
        + `\n\n${promptContent}`;

      const newMsg: DebateMessage = { id: msgId, agentId: agent.id, round: currentRound, text: "", systemPrompt: fullPrompt };
      setMessages((prev) => [...prev, newMsg]);
      persistDebateMessage(newMsg);

      agentLoop(
        {
          apiKey: modelCfg.provider.apiKey,
          baseUrl: modelCfg.provider.baseUrl,
          model: modelCfg.model,
          messages: [
            { role: "system", content: systemPrompt },
            ...historyMsgs,
            { role: "user", content: promptContent },
          ],
          temperature: 0.8,
          maxTokens: 800,
        },
        {
          onToken(token) {
            newMsg.text += token;
            persistDebateMessage({ ...newMsg }, undefined, true);
            setMessages((prev) =>
              prev.map((m) => (m.id === msgId ? { ...m, text: newMsg.text } : m)),
            );
          },
          onDone() {
            debateStorage.flush();
            persistDebateMessage({ ...newMsg }, undefined, false);
          },
          onError(err) {
            newMsg.text = newMsg.text || `**错误**: ${err.message}`;
            debateStorage.flush();
            persistDebateMessage({ ...newMsg }, undefined, false);
            setMessages((prev) =>
              prev.map((m) => (m.id === msgId ? { ...m, text: newMsg.text } : m)),
            );
          },
        },
      );
    }
  };

  /** Handle user input when waiting for user participant during debate */
  const handleUserInputForDebate = () => {
    const text = input.trim();
    const loopCtrl = id ? debateLoops.get(id) : undefined;
    if ((!text && pendingAttachments.length === 0) || !loopCtrl?.userInputResolve) return;
    const attachments = pendingAttachments;
    const { promptContent } = buildOutgoingUserMessage(input, attachments);
    setInput("");
    clearAttachmentState();
    loopCtrl.userInputResolve(promptContent);
  };

  const handleGenerateSummary = () => {
    if (messages.length === 0) return;
    setIsSummarizing(true);
    setSummaryContent("");

    const summaryMsgId = `${Date.now()}-summary`;
    const summaryMsg: DebateMessage = {
      id: summaryMsgId,
      agentId: "summary",
      round: currentRound || 1,
      text: "",
    };
    setMessages((prev) => [...prev, summaryMsg]);
    persistDebateMessage(summaryMsg, { summaryContent: "" });

    const defaultModel = getDefaultModel();
    if (!defaultModel) {
      setMessages((prev) => prev.map((m) => m.id === summaryMsgId ? { ...m, text: "**错误**: 未配置模型" } : m));
      setIsSummarizing(false);
      return;
    }
    const { provider, model } = defaultModel;

    const debateContent = messages
      .filter((m) => m.agentId !== "summary")
      .map((m) => {
        const a = agentState.find((ag) => ag.id === m.agentId);
        return `[${a?.name || "用户"}] (Round ${m.round}): ${m.text}`;
      })
      .join("\n\n");

    let accumulated = "";
    agentLoop(
      {
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        model: model.name,
        messages: [
          {
            role: "system",
            content: "你是一位专业的辩论总结专家。请对以下辩论内容进行总结，包含：1. 共识点 2. 分歧点 3. Top 风险 4. 综合评分（满分100）。使用 Markdown 格式。",
          },
          { role: "user", content: `辩论主题：${topic}\n\n${debateContent}` },
        ],
        temperature: 0.5,
        maxTokens: 2048,
      },
      {
        onToken(token) {
          accumulated += token;
          persistDebateMessage({ ...summaryMsg, text: accumulated }, { summaryContent: accumulated }, true);
          setSummaryContent(accumulated);
          setMessages((prev) => prev.map((m) => m.id === summaryMsgId ? { ...m, text: accumulated } : m));
        },
        onDone() {
          debateStorage.flush();
          persistDebateMessage({ ...summaryMsg, text: accumulated }, { summaryContent: accumulated }, false);
          setIsSummarizing(false);
        },
        onError(err) {
          accumulated += `\n\n**错误**: ${err.message}`;
          debateStorage.flush();
          persistDebateMessage({ ...summaryMsg, text: accumulated }, { summaryContent: accumulated }, false);
          setMessages((prev) => prev.map((m) => m.id === summaryMsgId ? { ...m, text: accumulated } : m));
          setIsSummarizing(false);
        },
      },
    );
  };

  /* Show @-tip ONCE when debate rounds finish */
  useEffect(() => {
    if (!isDebating && messages.length > 0 && currentRound >= totalRounds) {
      const dismissed = localStorage.getItem("ai-review-at-tip-dismissed");
      if (!dismissed) {
        setShowAtTip(true);
      }
    }
  }, [isDebating, messages.length, currentRound]);

  return (
    <div className="flex h-full font-['Inter',sans-serif]">
      {/* ── History Sidebar ── */}
      {sidebarOpen && (
        <HistorySidebar
          routePrefix="/debate"
          activeId={id}
          newLabel="新建辩论"
          searchPlaceholder="搜索辩论..."
          groups={historyGroups}
          onClose={() => setSidebarOpen(false)}
          onRename={handleRenameDebate}
          onDelete={handleDeleteDebate}
          open={sidebarOpen}
        />
      )}

      {/* ── Main Area ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
      {/* Header */}
      <div className="h-[44px] border-b border-[#ebebeb] flex items-center px-3 md:px-4 gap-2 md:gap-3 bg-white shrink-0">
        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)} className="w-[28px] h-[28px] rounded-[6px] hover:bg-[#f3f3f5] flex items-center justify-center transition-colors">
            <PanelLeft className="w-[14px] h-[14px] text-[#717182]" />
          </button>
        )}
        <button onClick={() => navigate("/")} className="text-[#667085] hover:text-[#0a0a0a] transition-colors">
          <ArrowLeft className="w-[15px] h-[15px]" />
        </button>
        <span className="text-[13px] text-[#0a0a0a] shrink-0" style={{ fontWeight: 500 }}>辩论场</span>
        {!isMobile && topic && <span className="text-[12px] text-[#717182] truncate max-w-[200px]" style={{ fontWeight: 400 }}>"{topic}"</span>}

        {!isMobile && <div className="w-px h-[20px] bg-[#ebebeb] ml-1" />}
        {!isMobile && <SkillBadges activeSkillIds={activeSkillIds} onOpenPanel={() => setSkillPanelOpen(true)} />}

        <div className="ml-auto flex items-center gap-1.5">
          {isMobile && <SkillBadges activeSkillIds={activeSkillIds} onOpenPanel={() => setSkillPanelOpen(true)} />}
          {/* Editable round count */}
          <span className="text-[11px] text-[#717182] mr-2 flex items-center gap-1" style={{ fontWeight: 400 }}>
            Round {Math.min(currentRound, totalRounds)}/
            <input
              type="number"
              min={1}
              max={20}
              value={totalRounds}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (v >= 1 && v <= 20) setTotalRounds(v);
              }}
              disabled={isDebating}
              className="w-[32px] h-[20px] text-center text-[11px] text-[#717182] border border-[rgba(0,0,0,0.1)] rounded-[4px] bg-white disabled:opacity-50 focus:outline-none focus:border-[#030213] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              style={{ fontWeight: 400 }}
            />
          </span>

          <button
            onClick={() => {
              if (isDebating) {
                // Pause: abort current stream + set flag so loop exits
                const loopCtrl = id ? debateLoops.get(id) : undefined;
                setIsPaused(true);
                isPausedRef.current = true;
                setWaitingForUser(false);
                if (loopCtrl) {
                  loopCtrl.isPaused = true;
                  loopCtrl.abort?.abort();
                  if (loopCtrl.userInputResolve) {
                    loopCtrl.userInputResolve("");
                    loopCtrl.userInputResolve = null;
                  }
                }
                // Remove empty "thinking" bubbles and sync ref immediately
                const cleaned = messagesRef.current.filter((m) => m.text.trim());
                messagesRef.current = cleaned;
                setMessages(cleaned);
              } else if (topic && currentRound > 0) {
                // If a background loop is still running, no need to restart
                if (id && debateLoops.has(id) && !debateLoops.get(id)!.cancelled) return;
                // Resume / Continue: remove existing summary first
                setMessages((prev) => prev.filter((m) => m.agentId !== "summary"));
                setSummaryContent("");
                // Determine start round
                const activeIds = agentState.filter((a) => a.active).map((a) => a.id);
                const currentMsgs = messagesRef.current.filter((m) => m.agentId !== "summary");
                const spokenIds = new Set(
                  currentMsgs
                    .filter((m) => m.round === currentRound && activeIds.includes(m.agentId) && m.text.trim())
                    .map((m) => m.agentId),
                );
                const roundComplete = activeIds.every((id) => spokenIds.has(id));
                const startRound = roundComplete ? currentRound + 1 : currentRound;
                if (startRound <= totalRounds) {
                  runDebate(topic, startRound);
                }
              }
            }}
            disabled={!isDebating && (!topic || currentRound === 0)}
            className={`flex items-center gap-1.5 px-2.5 py-[4px] rounded-[6px] text-[11.5px] border transition-colors ${
              !isDebating && isPaused ? "bg-[#030213] border-[#030213] text-white" : "border-[rgba(0,0,0,0.1)] text-[#667085] hover:bg-[#f8fafb]"
            }`}
            style={{ fontWeight: 500 }}
          >
            {isDebating ? <Pause className="w-[12px] h-[12px]" /> : <Play className="w-[12px] h-[12px]" />}
            {!isMobile && (isDebating ? "暂停" : "继续")}
          </button>
          <button
            onClick={handleGenerateSummary}
            disabled={messages.length === 0 || isSummarizing}
            className="flex items-center gap-1.5 px-2.5 py-[4px] rounded-[6px] text-[11.5px] border border-[rgba(0,0,0,0.1)] text-[#667085] hover:bg-[#f8fafb] transition-colors disabled:opacity-30"
            style={{ fontWeight: 500 }}
          >
            <BarChart3 className="w-[12px] h-[12px]" />
            {!isMobile && "总结"}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Agent Sidebar — hidden on mobile */}
        {!isMobile && (
        <div className="w-[200px] bg-white border-r border-[#ebebeb] flex flex-col shrink-0">
          <div className="p-3 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-[10px] text-[#8a9193]" style={{ fontWeight: 500 }}>参与角色</p>
              <button
                onClick={() => navigate("/settings/roles")}
                className="text-[#8a9193] hover:text-[#030213] transition-colors"
                title="配置角色"
              >
                <Settings className="w-[12px] h-[12px]" />
              </button>
            </div>
            <div className="space-y-1">
              {agentState.map((agent) => (
                <div key={agent.id} className={`rounded-[7px] transition-all ${agent.active ? "" : "opacity-30 hover:opacity-50"}`}>
                  <button
                    onClick={() => toggleAgent(agent.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[7px] hover:bg-[#f8fafb] text-left"
                  >
                    <span className="text-[13px]">{agent.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11.5px] text-[#0a0a0a] truncate" style={{ fontWeight: 500 }}>{agent.name}</p>
                      <p className="text-[9px] text-[#8a9193]">{agent.active ? "活跃" : "已静音"}</p>
                    </div>
                  </button>
                  {agent.active && (
                    <div
                      ref={(el) => { modelDropdownRefs.current[agent.id] = el; }}
                      className="relative px-2.5 pb-2"
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!hasConfiguredModels) return;
                          setOpenModelDropdown(openModelDropdown === agent.id ? null : agent.id);
                        }}
                        disabled={!hasConfiguredModels}
                        className="w-full flex items-center gap-1 px-2 py-[3px] rounded-[6px] border border-[rgba(0,0,0,0.1)] text-[11px] text-[#717182] hover:bg-[#f8fafb] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ fontWeight: 400 }}
                      >
                        <Sparkles className="w-[10px] h-[10px] shrink-0" />
                        <span className="truncate flex-1 text-left">
                          {ALL_MODELS.find((m) => m.id === agentModels[agent.id])?.name ?? (hasConfiguredModels ? "选择模型" : "无已配置模型")}
                        </span>
                        <ChevronDown className="w-[10px] h-[10px] text-[#8a9193] shrink-0" />
                      </button>
                      {openModelDropdown === agent.id && (
                        <div className="absolute top-full left-2.5 right-2.5 mt-1 bg-white border border-[rgba(0,0,0,0.1)] rounded-[7px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] py-1 z-20 max-h-[200px] overflow-y-auto">
                          {ALL_MODELS.length > 0 ? ALL_MODELS.map((m) => (
                            <button
                              key={m.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setAgentModels((prev) => ({ ...prev, [agent.id]: m.id }));
                                setOpenModelDropdown(null);
                              }}
                              className={`w-full text-left px-3 py-[5px] text-[11px] hover:bg-[#f8fafb] flex items-center gap-2 ${m.id === agentModels[agent.id] ? "text-[#415a9b]" : "text-[#0a0a0a]"}`}
                              style={{ fontWeight: m.id === agentModels[agent.id] ? 500 : 400 }}
                            >
                              <span className="truncate">{m.name}</span>
                            </button>
                          )) : (
                            <div className="px-3 py-[6px] text-[10px] text-[#8a9193]">暂无已配置模型，请前往设置添加</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* User participant toggle */}
            <div className="mt-3 pt-3 border-t border-[#ebebeb]">
              <button
                onClick={() => setUserParticipant(!userParticipant)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-[7px] hover:bg-[#f8fafb] text-left transition-all ${userParticipant ? "" : "opacity-30 hover:opacity-50"}`}
              >
                <div className="w-[20px] h-[20px] rounded-full bg-[#f3f3f5] flex items-center justify-center shrink-0">
                  <User className="w-[11px] h-[11px] text-[#667085]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] text-[#0a0a0a] truncate" style={{ fontWeight: 500 }}>用户</p>
                  <p className="text-[9px] text-[#8a9193]">{userParticipant ? "每轮等待输入" : "已关闭"}</p>
                </div>
              </button>
            </div>
          </div>

          {/* Round progress */}
          <div className="p-3 border-t border-[#ebebeb]">
            <p className="text-[10px] text-[#8a9193] mb-2 px-1" style={{ fontWeight: 500 }}>回合进度</p>
            <div className="flex items-center gap-1 px-1">
              {Array.from({ length: totalRounds }, (_, i) => i + 1).map((r) => (
                <div
                  key={r}
                  className={`flex-1 h-[4px] rounded-full transition-all ${
                    r < currentRound ? "bg-[#030213]" : r === currentRound ? "bg-[#030213]/40" : "bg-[#f3f3f5]"
                  }`}
                />
              ))}
            </div>
            <p className="text-[9px] text-[#8a9193] mt-1.5 px-1" style={{ fontWeight: 400 }}>
              {Math.max(0, Math.round(((currentRound - 1) / totalRounds) * 100))}% 完成
            </p>
          </div>
        </div>
        )}

        {/* Debate Content */}
        <div className="flex-1 flex flex-col bg-[#f8fafb] min-w-0">
          <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <div className="text-center max-w-[420px] w-full">
                <Sparkles className="w-[32px] h-[32px] text-[#d0d5dd] mx-auto mb-3" />
                <p className="text-[14px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>输入辩论主题开始</p>
                <p className="text-[12px] text-[#717182] mt-1 mb-4" style={{ fontWeight: 400 }}>在下方输入框中输入方案描述或主题，AI 角色将自动展开辩论</p>
                <div className="text-left bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)] p-3">
                  <label className="text-[11.5px] text-[#717182] mb-1.5 block" style={{ fontWeight: 500 }}>项目背景 <span className="text-[#b0b0b0]">（可选）</span></label>
                  <textarea
                    className="w-full text-[12.5px] text-[#0a0a0a] bg-transparent border-0 resize-none outline-none placeholder:text-[#b0b0b0] leading-[1.6]"
                    rows={3}
                    placeholder="项目类型、目标用户、已知约束等补充信息…可粘贴链接，AI 会自动抓取内容"
                    value={projectBackground}
                    onChange={(e) => setProjectBackground(e.target.value)}
                  />
                  {/* Background attachments */}
                  {backgroundAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-[rgba(0,0,0,0.06)]">
                      {backgroundAttachments.map((att) => (
                        <div
                          key={att.id}
                          className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#d9e1f2] bg-[#f7faff] px-2 py-1 text-[11px] text-[#21427f]"
                          style={{ fontWeight: 500 }}
                        >
                          <FileText className="w-[11px] h-[11px] shrink-0" />
                          <span className="max-w-[140px] truncate">{att.name}</span>
                          <span className="text-[#6b7ba5]" style={{ fontWeight: 400 }}>{formatAttachmentSize(att.size)}</span>
                          <button
                            type="button"
                            onClick={() => removeBgAttachment(att.id)}
                            className="rounded-full p-0.5 text-[#6b7ba5] transition-colors hover:bg-[#e6eefc] hover:text-[#21427f]"
                            aria-label={`移除 ${att.name}`}
                          >
                            <X className="w-[10px] h-[10px]" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {bgAttachmentError && (
                    <p className="text-[11px] text-[#dc2626] mt-1">{bgAttachmentError}</p>
                  )}
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-[rgba(0,0,0,0.06)]">
                    <span className="text-[10px] text-[#b0b0b0]">粘贴链接会在开始时自动解析</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        ref={bgFileInputRef}
                        type="file"
                        multiple
                        accept={CHAT_ATTACHMENT_ACCEPT}
                        className="hidden"
                        onChange={(event) => {
                          if (event.target.files?.length) void handleBgSelectedFiles(event.target.files);
                          event.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => bgFileInputRef.current?.click()}
                        className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] text-[#717182] hover:bg-[#f3f3f5] transition-colors"
                        style={{ fontWeight: 500 }}
                      >
                        <Upload className="w-[11px] h-[11px]" />
                        添加文件
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-[600px] mx-auto px-6 py-5 space-y-5">
              {Array.from(new Set(messages.filter((m) => m.agentId !== "summary").map((m) => m.round)))
                .sort((a, b) => a - b)
                .map((round) => (
                <div key={round}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-px flex-1 bg-[rgba(0,0,0,0.06)]" />
                    <span className="text-[10px] text-[#8a9193] px-2" style={{ fontWeight: 500 }}>Round {round}</span>
                    <div className="h-px flex-1 bg-[rgba(0,0,0,0.06)]" />
                  </div>
                  <div className="space-y-3">
                    {messages
                      .filter((m) => m.round === round && m.agentId !== "summary")
                      .map((msg) => {
                        const agent = agentState.find((a) => a.id === msg.agentId);
                        const isUser = msg.agentId === "user";
                        return (
                          <div key={msg.id} className="flex gap-2.5">
                            <span className="text-[16px] shrink-0 mt-0.5">{isUser ? "👤" : agent?.emoji || "❓"}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[11.5px]" style={{ fontWeight: 500, color: isUser ? "#717182" : agent?.color }}>{isUser ? "用户" : agent?.name}</span>
                                {!isUser && msg.systemPrompt && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button onClick={() => setViewingPrompt(msg.systemPrompt!)} className="text-[#b0b0b0] hover:text-[#555] transition-colors">
                                        <Eye className="w-[12px] h-[12px]" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-[11px]">查看模型输入详情</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                              <div className="bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)] px-3.5 py-2.5 text-[12.5px] text-[#0a0a0a] leading-[1.7]" style={{ fontWeight: 400 }}>
                                {msg.text ? (
                                  isUser ? (
                                    <div className="whitespace-pre-wrap">{msg.text}</div>
                                  ) : (
                                    <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-h1:text-[18px] prose-h2:text-[16px] prose-h3:text-[14px] prose-headings:mt-3 prose-headings:mb-2 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-pre:bg-[#1e1e2e] prose-pre:text-[#e0e0e0] prose-pre:rounded-lg prose-pre:p-4 prose-code:text-[12px] prose-code:before:content-none prose-code:after:content-none prose-code:bg-[#e8eaed] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[#c7254e] prose-strong:font-semibold prose-blockquote:border-l-[#415a9b] prose-blockquote:bg-[#f8f9ff] prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-md prose-a:text-[#415a9b] prose-a:no-underline hover:prose-a:underline">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                                    </div>
                                  )
                                ) : (
                                  <span className="text-[#717182] inline-flex items-center gap-1"><Loader2 className="w-[12px] h-[12px] animate-spin" /> 思考中...</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}

              {/* Summary message rendered inline */}
              {messages.filter((m) => m.agentId === "summary").map((msg) => (
                <div key={msg.id}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-px flex-1 bg-[rgba(0,0,0,0.06)]" />
                    <span className="text-[10px] text-[#415a9b] px-2" style={{ fontWeight: 500 }}>📊 辩论总结</span>
                    <div className="h-px flex-1 bg-[rgba(0,0,0,0.06)]" />
                  </div>
                  <div className="bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)] px-4 py-3">
                    {msg.text ? (
                      <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-h1:text-[18px] prose-h2:text-[16px] prose-h3:text-[14px] prose-headings:mt-3 prose-headings:mb-2 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-pre:bg-[#1e1e2e] prose-pre:text-[#e0e0e0] prose-pre:rounded-lg prose-pre:p-4 prose-code:text-[12px] prose-code:before:content-none prose-code:after:content-none prose-code:bg-[#e8eaed] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[#c7254e] prose-strong:font-semibold prose-blockquote:border-l-[#415a9b] prose-blockquote:bg-[#f8f9ff] prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-md prose-a:text-[#415a9b] prose-a:no-underline hover:prose-a:underline">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-[12px] text-[#717182]">
                        <Loader2 className="w-[14px] h-[14px] animate-spin" /> 生成总结中...
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isDebating && !hasPendingAgentMessage && !waitingForUser && (
                <div className="flex gap-2.5 items-center">
                  <Loader2 className="w-[16px] h-[16px] animate-spin text-[#030213]" />
                  <span className="text-[10.5px] text-[#717182]">辩论进行中...</span>
                </div>
              )}

              {waitingForUser && (
                <div className="flex items-center gap-2 py-2 px-3 bg-[#fffbeb] border border-[#fcd34d] rounded-[8px]">
                  <User className="w-[14px] h-[14px] text-[#b45309]" />
                  <span className="text-[12px] text-[#92400e]" style={{ fontWeight: 500 }}>等待你的输入… 请在下方发送你的观点后继续</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
          </div>

          {/* Input — inside content area */}
          <ConversationComposer
            containerClassName="px-3 md:px-5 py-2.5"
            contentClassName="max-w-[600px]"
            value={input}
            onChange={setInput}
            onSend={waitingForUser ? handleUserInputForDebate : (messages.length === 0 ? handleStart : handleUserMessage)}
            placeholder={waitingForUser ? "输入你的观点，辩论将继续..." : (messages.length === 0 ? "输入辩论主题或方案描述..." : "输入追问或评论...")}
            actionLabel={waitingForUser ? "继续辩论" : (isFetchingUrls ? "解析链接中…" : (messages.length === 0 ? "开始" : "发送"))}
            sending={(isDebating && !waitingForUser) || isFetchingUrls}
            disabled={(isDebating && !waitingForUser) || isFetchingUrls}
            canSend={waitingForUser
              ? Boolean(input.trim() || pendingAttachments.length > 0)
              : Boolean(input.trim() || pendingAttachments.length > 0) && (messages.length > 0 || hasUsableActiveAgent)}
            onDragOver={handleComposerDragOver}
            onDragLeave={handleComposerDragLeave}
            onDrop={handleComposerDrop}
            topSlot={(pendingAttachments.length > 0 || composerError || isComposerDragActive) ? (
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
            ) : undefined}
            leftSlot={
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={CHAT_ATTACHMENT_ACCEPT}
                  className="hidden"
                  onChange={(event) => {
                    setIsAttachmentMenuOpen(false);
                    if (event.target.files?.length) void handleSelectedFiles(event.target.files);
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
                {!isDebating && messages.length > 0 && currentRound >= totalRounds && (
                  <div className="relative">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>
                          <Select value={targetAgent} onValueChange={setTargetAgent}>
                            <SelectTrigger size="sm" className="w-auto shrink-0 rounded-full bg-transparent border-0 h-[28px] px-2 text-[13px] text-[#555] hover:bg-[#f3f3f5] focus-visible:ring-0 focus-visible:border-transparent">
                              <SelectValue placeholder="@ 全体" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">@ 全体</SelectItem>
                              {agentState.filter((a) => a.active).map((a) => (
                                <SelectItem key={a.id} value={a.id}>{a.emoji} {a.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-[11px] max-w-[200px]">
                        选择 @ 某个角色，可单独向该角色追问；选 @ 全体则所有角色回应
                      </TooltipContent>
                    </Tooltip>
                    {showAtTip && (
                      <div className="absolute bottom-full left-0 mb-2 w-[240px] bg-[#030213] text-white rounded-[8px] px-3 py-2 shadow-lg z-40 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="flex items-start gap-2">
                          <MessageCircleQuestion className="w-[14px] h-[14px] shrink-0 mt-0.5 text-[#a0a0ff]" />
                          <p className="text-[11px] leading-[1.6]" style={{ fontWeight: 400 }}>辩论结束！你可以用 <strong className="text-white">@</strong> 指定某个角色，单独向 TA 追问</p>
                        </div>
                        <button onClick={() => { setShowAtTip(false); localStorage.setItem("ai-review-at-tip-dismissed", "1"); }} className="absolute top-1.5 right-1.5 text-white/50 hover:text-white transition-colors">
                          <X className="w-[10px] h-[10px]" />
                        </button>
                        <div className="absolute bottom-0 left-4 translate-y-full w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-[#030213]" />
                      </div>
                    )}
                  </div>
                )}
              </>
            }
          />
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

      {/* System Prompt Viewer Dialog */}
      <Dialog open={viewingPrompt !== null} onOpenChange={(open) => { if (!open) setViewingPrompt(null); }}>
        <DialogContent className="max-w-[640px] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-[14px]">模型输入详情</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 -mx-6 px-6">
            <pre className="text-[12px] leading-[1.7] text-[#333] whitespace-pre-wrap break-words font-mono bg-[#f8f8fa] rounded-[8px] p-4 border border-[rgba(0,0,0,0.06)]">{viewingPrompt}</pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
