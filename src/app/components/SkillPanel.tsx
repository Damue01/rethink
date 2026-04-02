import { useState } from "react";
import { useNavigate } from "react-router";
import {
  X, ChevronDown, ChevronRight,
  Search, Plus, Check
} from "lucide-react";
import { defaultSkills, type Skill, loadSkills, loadCategories } from "./skillData";
import { Input } from "./ui/input";

interface SkillPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeSkillIds: string[];
  onToggleSkill: (skillId: string) => void;
}

export function SkillPanel({ isOpen, onClose, activeSkillIds, onToggleSkill }: SkillPanelProps) {
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "active">("all");

  if (!isOpen) return null;

  const allSkills = loadSkills();
  const filtered = allSkills.filter((s) => {
    const matchSearch = !searchQuery || s.name.includes(searchQuery) || s.description.includes(searchQuery);
    const matchTab = activeTab === "all" || activeSkillIds.includes(s.id);
    return matchSearch && matchTab;
  });

  const grouped = loadCategories().map((cat) => ({
    ...cat,
    skills: filtered.filter((s) => s.category === cat.id),
  })).filter((g) => g.skills.length > 0);

  return (
    <div className="w-[360px] border-l border-[#ebebeb] bg-white flex flex-col shrink-0 h-full font-['Inter',sans-serif]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#ebebeb] shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[16px]">🧩</span>
            <span className="text-[14px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>分析 Skill</span>
            {activeSkillIds.length > 0 && (
              <span className="text-[10px] px-[6px] py-[2px] rounded-full bg-[#030213] text-white" style={{ fontWeight: 500 }}>
                {activeSkillIds.length} 已加载
              </span>
            )}
          </div>
          <button onClick={onClose} className="w-[26px] h-[26px] rounded-[6px] hover:bg-[#f3f3f5] flex items-center justify-center transition-colors">
            <X className="w-[14px] h-[14px] text-[#717182]" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 mb-3 bg-[#f3f3f5] rounded-[7px] p-[3px]">
          {([["all", "全部"], ["active", "已加载"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 py-[5px] rounded-[5px] text-[12px] transition-colors ${
                activeTab === key ? "bg-white text-[#0a0a0a] shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-[#717182]"
              }`}
              style={{ fontWeight: 500 }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[13px] w-[13px] -translate-y-1/2 text-[#8a9193]" />
          <Input
            className="pl-8"
            placeholder="搜索 Skill..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Skill List */}
      <div className="flex-1 overflow-y-auto">
        {grouped.map((group) => (
          <div key={group.id} className="border-b border-[rgba(0,0,0,0.04)]">
            <div className="px-5 pt-4 pb-1">
              <span className="text-[11px] text-[#8a9193]" style={{ fontWeight: 500 }}>
                {group.emoji} {group.label}
              </span>
            </div>
            <div className="px-3 pb-2 space-y-1">
              {group.skills.map((skill) => {
                const isActive = activeSkillIds.includes(skill.id);
                const isExpanded = expandedSkill === skill.id;

                return (
                  <div key={skill.id} className="rounded-[8px] overflow-hidden">
                    {/* Skill header */}
                    <div
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] transition-colors cursor-pointer ${
                        isActive ? "bg-[#f0f4ff]" : "hover:bg-[#f8fafb]"
                      }`}
                    >
                      <button
                        onClick={() => setExpandedSkill(isExpanded ? null : skill.id)}
                        className="shrink-0"
                      >
                        {isExpanded
                          ? <ChevronDown className="w-[13px] h-[13px] text-[#8a9193]" />
                          : <ChevronRight className="w-[13px] h-[13px] text-[#8a9193]" />
                        }
                      </button>

                      <button
                        onClick={() => setExpandedSkill(isExpanded ? null : skill.id)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[14px]">{skill.emoji}</span>
                          <span className="text-[12.5px] text-[#0a0a0a] truncate" style={{ fontWeight: 500 }}>
                            {skill.name}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#717182] mt-0.5 line-clamp-1" style={{ fontWeight: 400 }}>
                          {skill.description}
                        </p>
                      </button>

                      {/* Toggle */}
                      <button
                        onClick={() => onToggleSkill(skill.id)}
                        className={`shrink-0 w-[28px] h-[28px] rounded-[6px] flex items-center justify-center transition-all ${
                          isActive
                            ? "bg-[#030213] text-white"
                            : "border border-[rgba(0,0,0,0.12)] text-[#d0d5dd] hover:border-[rgba(0,0,0,0.25)]"
                        }`}
                      >
                        {isActive ? <Check className="w-[14px] h-[14px]" /> : <Plus className="w-[14px] h-[14px]" />}
                      </button>
                    </div>

                    {/* Expanded Detail */}
                    {isExpanded && (
                      <div className="ml-[22px] mr-2 mb-2 mt-1">
                        <div className="p-3 bg-[#f8fafb] rounded-[7px] text-[11px] text-[#0a0a0a] leading-[1.65] whitespace-pre-wrap font-mono max-h-[200px] overflow-y-auto" style={{ fontWeight: 400 }}>
                          {skill.content.split("\n").slice(0, 20).join("\n")}
                          {skill.content.split("\n").length > 20 && "\n..."}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="text-[28px] mb-2">🔍</span>
            <p className="text-[12.5px] text-[#717182]" style={{ fontWeight: 400 }}>
              {activeTab === "active" ? "尚未加载任何 Skill" : "未找到匹配的 Skill"}
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[#ebebeb] shrink-0">
        <button onClick={() => { window.location.href = '/settings/skills'; }} className="w-full flex items-center justify-center gap-2 px-4 py-[8px] border border-[rgba(0,0,0,0.1)] rounded-[7px] text-[12px] text-[#0a0a0a] hover:bg-[#f8fafb] transition-colors" style={{ fontWeight: 500 }}>
          <Plus className="w-[13px] h-[13px]" />
          创建新 Skill
        </button>
      </div>
    </div>
  );
}

/* Compact inline skill badge for toolbar use */
export function SkillBadges({
  activeSkillIds,
  onOpenPanel,
}: {
  activeSkillIds: string[];
  onOpenPanel: () => void;
}) {
  const activeSkills = loadSkills().filter((s) => activeSkillIds.includes(s.id));

  return (
    <div className="flex items-center gap-1.5">
      {activeSkills.map((skill) => (
        <span
          key={skill.id}
          className="inline-flex items-center gap-1 px-2 py-[4px] rounded-[6px] bg-[#f0f4ff] text-[11px] text-[#415a9b] border border-[#d4dff7]"
          style={{ fontWeight: 500 }}
        >
          {skill.emoji} {skill.name.length > 8 ? skill.name.slice(0, 8) + "..." : skill.name}
        </span>
      ))}
      <button
        onClick={onOpenPanel}
        className="inline-flex items-center gap-1 px-2 py-[4px] rounded-[6px] border border-dashed border-[rgba(0,0,0,0.15)] text-[11px] text-[#717182] hover:border-[rgba(0,0,0,0.3)] hover:text-[#0a0a0a] transition-colors"
        style={{ fontWeight: 500 }}
      >
        <span className="text-[12px]">🧩</span>
        {activeSkills.length === 0 ? "加载 Skill" : "+"}
      </button>
    </div>
  );
}
