import { useState, useRef, useEffect } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router";
import {
  LayoutDashboard, MessageSquare, GitCompare, Shield, Swords,
  Settings, User, LogOut, Menu, X
} from "lucide-react";
import { useIsMobile } from "./ui/use-mobile";
import { Sheet, SheetContent } from "./ui/sheet";

const LAST_VISITED_KEY = "ai-review-last-visited-routes";

type ConversationSection = "chat" | "compare" | "debate";

function loadLastVisitedRoutes(): Partial<Record<ConversationSection, string>> {
  try {
    const raw = localStorage.getItem(LAST_VISITED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function saveLastVisitedRoute(section: ConversationSection, path: string) {
  const current = loadLastVisitedRoutes();
  current[section] = path;
  localStorage.setItem(LAST_VISITED_KEY, JSON.stringify(current));
}

function getLastVisitedRoute(section: ConversationSection, fallback: string) {
  const current = loadLastVisitedRoutes();
  return current[section] || fallback;
}

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, matchPrefix: "/" },
  { to: "/chat/new", label: "对话", icon: MessageSquare, end: false, matchPrefix: "/chat", section: "chat" as const },
  { to: "/compare/new", label: "对比", icon: GitCompare, end: false, matchPrefix: "/compare", section: "compare" as const },
  // 分析页暂时隐藏，功能尚未完善（路由保留，直接访问 /review/new 仍可到达）
  // { to: "/review/new", label: "分析", icon: Shield, end: false, matchPrefix: "/review" },
  { to: "/debate/new", label: "辩论", icon: Swords, end: false, matchPrefix: "/debate", section: "debate" as const },
];

export function RootLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isSettingsPage = location.pathname.startsWith("/settings");

  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { pathname, search } = location;
    if (pathname.startsWith("/chat/") && pathname !== "/chat/new") {
      saveLastVisitedRoute("chat", `${pathname}${search}`);
    }
    if (pathname.startsWith("/compare/") && pathname !== "/compare/new") {
      saveLastVisitedRoute("compare", `${pathname}${search}`);
    }
    if (pathname.startsWith("/debate/") && pathname !== "/debate/new") {
      saveLastVisitedRoute("debate", `${pathname}${search}`);
    }
  }, [location]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="flex flex-col h-full bg-white font-['Inter',sans-serif]">
      {/* Top Nav */}
      <header className="h-[56px] border-b border-[#ebebeb] flex items-center px-4 md:px-8 shrink-0">
        {/* Mobile hamburger */}
        {isMobile && (
          <button
            onClick={() => setMobileNavOpen(true)}
            className="w-[33px] h-[33px] rounded-full flex items-center justify-center hover:bg-[#f3f3f5] transition-colors mr-2"
          >
            <Menu className="w-[18px] h-[18px] text-[#667085]" />
          </button>
        )}

        {/* Logo */}
        <div className="flex items-center gap-2.5 mr-4 md:mr-10">
          <div className="w-[30px] h-[30px] rounded-full bg-[#030213] flex items-center justify-center">
            <img src="/app-256.png" alt="ReThink" className="w-[30px] h-[30px] rounded-full" />
          </div>
          {!isMobile && (
            <span className="text-[16px] text-[#0a0a0a] tracking-[-0.01em]" style={{ fontWeight: 500 }}>
              ReThink
            </span>
          )}
        </div>

        {/* Desktop Nav Items */}
        {!isMobile && (
          <nav className="flex items-center h-full">
            {navItems.map((item) => {
              const active = item.end
                ? location.pathname === item.matchPrefix
                : location.pathname.startsWith(item.matchPrefix);
              const target = item.section
                ? getLastVisitedRoute(item.section, item.to)
                : item.to;
              return (
                <button
                  key={item.to}
                  type="button"
                  onClick={() => navigate(target)}
                  className={
                    `flex items-center gap-1.5 px-3 h-full text-[14px] border-b-2 transition-colors ${
                      active
                        ? "border-[#030213] text-[#0a0a0a]"
                        : "border-transparent text-[#667085] hover:text-[#0a0a0a]"
                    }`
                  }
                  style={{ fontWeight: active ? 500 : 400 }}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        )}

        {/* Mobile Sheet Nav */}
        {isMobile && (
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetContent side="left" className="w-[260px] p-0">
              <div className="flex items-center gap-2.5 px-5 h-[56px] border-b border-[#ebebeb]">
                <div className="w-[30px] h-[30px] rounded-full bg-[#030213] flex items-center justify-center">
                  <img src="/app-256.png" alt="ReThink" className="w-[30px] h-[30px] rounded-full" />
                </div>
                <span className="text-[16px] text-[#0a0a0a] tracking-[-0.01em]" style={{ fontWeight: 500 }}>
                  ReThink
                </span>
              </div>
              <nav className="flex flex-col py-2">
                {navItems.map((item) => {
                  const active = item.end
                    ? location.pathname === item.matchPrefix
                    : location.pathname.startsWith(item.matchPrefix);
                  const target = item.section
                    ? getLastVisitedRoute(item.section, item.to)
                    : item.to;
                  return (
                    <button
                      key={item.to}
                      type="button"
                      onClick={() => { navigate(target); setMobileNavOpen(false); }}
                      className={
                        `flex items-center gap-3 px-5 py-3 text-[14px] transition-colors ${
                          active
                            ? "bg-[#f3f3f5] text-[#0a0a0a]"
                            : "text-[#667085] hover:bg-[#f8fafb] hover:text-[#0a0a0a]"
                        }`
                      }
                      style={{ fontWeight: active ? 500 : 400 }}
                    >
                      <item.icon className="w-[16px] h-[16px]" />
                      {item.label}
                    </button>
                  );
                })}
              </nav>
              <div className="border-t border-[#ebebeb] py-2">
                <button
                  onClick={() => { navigate("/settings/models"); setMobileNavOpen(false); }}
                  className={`flex items-center gap-3 px-5 py-3 text-[14px] transition-colors w-full ${
                    isSettingsPage ? "bg-[#f3f3f5] text-[#0a0a0a]" : "text-[#667085] hover:bg-[#f8fafb]"
                  }`}
                  style={{ fontWeight: isSettingsPage ? 500 : 400 }}
                >
                  <Settings className="w-[16px] h-[16px]" />
                  设置
                </button>
              </div>
            </SheetContent>
          </Sheet>
        )}

        {/* Right side */}
        <div className="ml-auto flex items-center gap-3">
          {/* Settings */}
          <NavLink
            to="/settings/models"
            className={() =>
              `w-[33px] h-[33px] rounded-full flex items-center justify-center transition-colors ${
                isSettingsPage ? "bg-[#f3f3f5]" : "bg-[#f8fafb] hover:bg-[#f3f3f5]"
              }`
            }
          >
            <Settings className="w-[15px] h-[15px] text-[#7c8385]" />
          </NavLink>

          {/* Profile */}
          <div ref={profileRef} className="relative">
            <button
              onClick={() => setProfileOpen(!profileOpen)}
              className="w-[33px] h-[33px] rounded-full bg-[#f6f8f9] hover:bg-[#f3f3f5] flex items-center justify-center transition-colors"
            >
              <User className="w-[15px] h-[15px] text-[#7c8385]" />
            </button>
            {profileOpen && (
              <div className="absolute top-full right-0 mt-1 w-[160px] bg-white border border-[rgba(0,0,0,0.1)] rounded-[8px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] py-1 z-50">
                <div className="px-3 py-2 border-b border-[rgba(0,0,0,0.06)]">
                  <p className="text-[12px] text-[#0a0a0a]" style={{ fontWeight: 500 }}>Review User</p>
                  <p className="text-[10px] text-[#8a9193]" style={{ fontWeight: 400 }}>user@example.com</p>
                </div>
                <button
                  onClick={() => {
                    navigate("/settings/models");
                    setProfileOpen(false);
                  }}
                  className="w-full text-left px-3 py-[6px] text-[12px] text-[#0a0a0a] hover:bg-[#f3f3f5] transition-colors flex items-center gap-2"
                  style={{ fontWeight: 400 }}
                >
                  <Settings className="w-[12px] h-[12px] text-[#717182]" />
                  个人设置
                </button>
                <button
                  className="w-full text-left px-3 py-[6px] text-[12px] text-[#667085] hover:bg-[#f3f3f5] transition-colors flex items-center gap-2"
                  style={{ fontWeight: 400 }}
                >
                  <LogOut className="w-[12px] h-[12px] text-[#667085]" />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}