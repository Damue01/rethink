import { useState } from "react";

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "常用",
    emojis: ["⚡", "🎯", "🔍", "📋", "📄", "📝", "📊", "📈", "💡", "🔧", "⚙️", "🛠️", "🎮", "🛒", "🏗️", "🧩"],
  },
  {
    label: "对象",
    emojis: ["💻", "📱", "🖥️", "🗂️", "📦", "🗃️", "📁", "🔒", "🔑", "🧪", "🔬", "🧬", "🏷️", "📌", "🔗", "📎"],
  },
  {
    label: "符号",
    emojis: ["✅", "❌", "⚠️", "💬", "🗨️", "💭", "❓", "❗", "✨", "🔥", "💎", "🏆", "🎖️", "🥇", "⭐", "🌟"],
  },
  {
    label: "表情",
    emojis: ["🤖", "👤", "👥", "😎", "🧐", "🤓", "🦊", "🐱", "🐶", "🦁", "🐸", "🦉", "🐧", "🐼", "🦄", "🐲"],
  },
  {
    label: "自然",
    emojis: ["🌍", "🌱", "🌳", "🍀", "🌈", "☀️", "🌙", "⚡", "💧", "🔮", "🎨", "🎭", "🎪", "🎲", "♟️", "🧭"],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [activeGroup, setActiveGroup] = useState(0);

  return (
    <div
      className="absolute top-full left-0 mt-1 z-50 bg-white rounded-[10px] border border-[rgba(0,0,0,0.12)] shadow-lg w-[280px] overflow-hidden"
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Group tabs */}
      <div className="flex border-b border-[rgba(0,0,0,0.06)] px-2 pt-2 gap-0.5">
        {EMOJI_GROUPS.map((g, i) => (
          <button
            key={g.label}
            onClick={() => setActiveGroup(i)}
            className={`px-2 py-1.5 text-[10px] rounded-t-[5px] transition-colors ${
              activeGroup === i ? "bg-[#f3f3f5] text-[#0a0a0a]" : "text-[#8a9193] hover:text-[#0a0a0a]"
            }`}
            style={{ fontWeight: 500 }}
          >
            {g.label}
          </button>
        ))}
      </div>
      {/* Emoji grid */}
      <div className="p-2 grid grid-cols-8 gap-0.5 max-h-[160px] overflow-y-auto">
        {EMOJI_GROUPS[activeGroup].emojis.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            onClick={() => { onSelect(emoji); onClose(); }}
            className="w-[30px] h-[30px] flex items-center justify-center rounded-[6px] hover:bg-[#f3f3f5] transition-colors text-[18px]"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
