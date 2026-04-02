import { useNavigate } from "react-router";
import {
  MessageSquare, GitCompare, Shield, Swords, Brain, RefreshCw,
  Skull, Eye, KeyRound, Scale, Target, Lightbulb, ArrowRight, Sparkles,
  Clock, Puzzle
} from "lucide-react";
import { defaultSkills, loadSkills } from "./skillData";
import { loadMethodologies } from "../services/methodologies";

const CONVERSATIONS_KEY = "ai-review-conversations";
const COMPARE_KEY = "ai-review-compare-conversations";
const DEBATE_KEY = "ai-review-debate-conversations";

function formatTimeAgo(ts: number) {
  const ago = Date.now() - ts;
  if (ago < 3600000) return `${Math.max(1, Math.round(ago / 60000))} 分钟前`;
  if (ago < 86400000) return `${Math.round(ago / 3600000)} 小时前`;
  if (ago < 172800000) return "昨天";
  return `${Math.round(ago / 86400000)} 天前`;
}

function getRecentChats() {
  const items: { id: string; title: string; updatedAt: number; type: string; path: string }[] = [];
  try {
    const chatRaw = localStorage.getItem(CONVERSATIONS_KEY);
    if (chatRaw) {
      const convs = JSON.parse(chatRaw);
      if (Array.isArray(convs)) {
        for (const c of convs) {
          if (c.id && c.updatedAt) items.push({ id: c.id, title: c.title || "未命名对话", updatedAt: c.updatedAt, type: "对话", path: `/chat/${c.id}` });
        }
      }
    }
  } catch { /* ignore */ }
  try {
    const compareRaw = localStorage.getItem(COMPARE_KEY);
    if (compareRaw) {
      const convs = JSON.parse(compareRaw);
      if (Array.isArray(convs)) {
        for (const c of convs) {
          if (c.id && c.updatedAt) items.push({ id: c.id, title: c.title || "未命名对比", updatedAt: c.updatedAt, type: "对比", path: `/compare/${c.id}` });
        }
      }
    }
  } catch { /* ignore */ }
  try {
    const debateRaw = localStorage.getItem(DEBATE_KEY);
    if (debateRaw) {
      const convs = JSON.parse(debateRaw);
      if (Array.isArray(convs)) {
        for (const c of convs) {
          if (c.id && c.updatedAt) items.push({ id: c.id, title: c.title || c.topic || "未命名辩论", updatedAt: c.updatedAt, type: "辩论", path: `/debate/${c.id}` });
        }
      }
    }
  } catch { /* ignore */ }
  return items
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8)
    .map((item) => ({ ...item, time: formatTimeAgo(item.updatedAt) }));
}

function getMethodologyCards() {
  const all = loadMethodologies().filter((m) => m.id !== "none");
  return all.map((m) => ({
    id: m.id,
    name: m.name,
    desc: m.description,
    emoji: m.emoji,
  }));
}

const quickActions = [
  { icon: MessageSquare, label: "新建对话", desc: "与AI进行自由对话", to: "/chat/new" },
  { icon: GitCompare, label: "多模型对比", desc: "并排对比多个模型", to: "/compare/new" },
  { icon: Swords, label: "多智能体辩论", desc: "多角色结构化辩论", to: "/debate/new" },
];

const typeColors: Record<string, string> = {
  分析: "bg-[#fef2f2] text-[#dc2626]",
  对话: "bg-[#f0f4ff] text-[#415a9b]",
  辩论: "bg-[#fffbeb] text-[#b45309]",
  对比: "bg-[#f0fdf4] text-[#16a34a]",
};

export function Dashboard() {
  const navigate = useNavigate();

  return (
    <div className="h-full overflow-y-auto bg-[#f8fafb]">
      <div className="max-w-[1060px] mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-[#0a0a0a] text-[22px] tracking-[-0.02em]" style={{ fontWeight: 500 }}>
            ReThink
          </h1>
          <p className="text-[#717182] text-[13px] mt-0.5">
            Think 小助手 发现一些新想法~
          </p>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-2.5 mb-8">
          {quickActions.map((action) => (
            <button
              key={action.label}
              onClick={() => navigate(action.to)}
              className="bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)] p-4 text-left hover:border-[rgba(0,0,0,0.18)] hover:shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all group"
            >
              <div className="w-[32px] h-[32px] rounded-[8px] bg-[#f3f3f5] flex items-center justify-center mb-2.5 group-hover:bg-[#030213] transition-colors">
                <action.icon className="w-[15px] h-[15px] text-[#717182] group-hover:text-white transition-colors" />
              </div>
              <p className="text-[13px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>{action.label}</p>
              <p className="text-[11px] text-[#717182] mt-0.5">{action.desc}</p>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_300px] gap-5">
          <div className="space-y-6">
            {/* Skills Section */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <p className="text-[12px] text-[#8a9193]" style={{ fontWeight: 500 }}>🧩 分析 Skill</p>
                <button
                  onClick={() => navigate("/settings/skills")}
                  className="text-[11px] px-2 py-[3px] rounded-[6px] border border-[rgba(0,0,0,0.1)] text-[#667085] hover:bg-[#f8fafb] transition-colors"
                  style={{ fontWeight: 500 }}
                >
                  管理全部
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {loadSkills().slice(0, 4).map((skill) => (
                  <button
                    key={skill.id}
                    onClick={() => navigate(`/chat/new?skill=${skill.id}`)}
                    className="bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)] px-3.5 py-3 flex items-center gap-2.5 hover:border-[rgba(0,0,0,0.18)] transition-all text-left"
                  >
                    <span className="text-[20px] shrink-0">{skill.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] text-[#0a0a0a] truncate" style={{ fontWeight: 500 }}>{skill.name}</p>
                      <p className="text-[10px] text-[#717182] mt-0.5 truncate" style={{ fontWeight: 400 }}>
                        {skill.description}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Methodologies */}
            <div>
              <p className="text-[12px] text-[#8a9193] mb-2.5" style={{ fontWeight: 500 }}>分析方法论</p>
              <div className="grid grid-cols-2 gap-2">
                {getMethodologyCards().map((m) => (
                  <button
                    key={m.id}
                    onClick={() => navigate(`/chat/new?methodology=${m.id}`)}
                    className="bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)] px-3.5 py-3 flex items-center gap-2.5 hover:border-[rgba(0,0,0,0.18)] transition-all text-left"
                  >
                    <span className="text-[18px] shrink-0">{m.emoji}</span>
                    <div className="min-w-0">
                      <p className="text-[12px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>{m.name}</p>
                      <p className="text-[10px] text-[#717182] mt-px">{m.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Recent */}
          <div>
            <p className="text-[12px] text-[#8a9193] mb-2.5" style={{ fontWeight: 500 }}>最近记录</p>
            <div className="bg-white rounded-[10px] border border-[rgba(0,0,0,0.08)] overflow-hidden">
              {getRecentChats().length === 0 ? (
                <div className="px-3.5 py-6 text-center">
                  <p className="text-[12px] text-[#8a9193]">还没有对话记录</p>
                </div>
              ) : getRecentChats().map((chat, i) => (
                <button
                  key={`${chat.type}-${chat.id}`}
                  onClick={() => navigate(chat.path)}
                  className={`w-full px-3.5 py-2.5 flex items-center gap-2.5 hover:bg-[#f8fafb] transition-colors text-left ${
                    i > 0 ? "border-t border-[rgba(0,0,0,0.05)]" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-[#0a0a0a] truncate" style={{ fontWeight: 400 }}>{chat.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Clock className="w-[10px] h-[10px] text-[#8a9193]" />
                      <span className="text-[10px] text-[#8a9193]">{chat.time}</span>
                      <span className={`text-[9px] px-[5px] py-[1px] rounded-[3px] ${typeColors[chat.type] || "bg-[#f3f3f5] text-[#717182]"}`} style={{ fontWeight: 500 }}>
                        {chat.type}
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="w-[12px] h-[12px] text-[#d0d5dd] shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
