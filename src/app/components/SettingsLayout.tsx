import { Outlet, NavLink } from "react-router";
import { Cpu, Users, Puzzle, Lightbulb, Plug } from "lucide-react";

const settingsTabs = [
  { to: "/settings/models", label: "模型配置", icon: Cpu },
  { to: "/settings/mcp", label: "MCP 服务", icon: Plug },
  { to: "/settings/skills", label: "Skill 管理", icon: Puzzle },
  { to: "/settings/roles", label: "角色模板", icon: Users },
  { to: "/settings/methodologies", label: "方法论", icon: Lightbulb },
];

export function SettingsLayout() {
  return (
    <div className="flex flex-col h-full font-['Inter',sans-serif]">
      {/* Settings sub-nav */}
      <div className="h-[40px] border-b border-[#ebebeb] flex items-center px-6 bg-white shrink-0 gap-1">
        {settingsTabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-3 py-[6px] rounded-[7px] text-[12.5px] transition-colors ${
                isActive
                  ? "bg-[#f3f3f5] text-[#0a0a0a]"
                  : "text-[#717182] hover:text-[#0a0a0a] hover:bg-[#f8fafb]"
              }`
            }
            style={{ fontWeight: 500 }}
          >
            <tab.icon className="w-[14px] h-[14px]" />
            {tab.label}
          </NavLink>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
