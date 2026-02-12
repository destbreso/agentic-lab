"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Network,
  BookOpen,
  History,
  Settings,
  Cpu,
  ChevronLeft,
  ChevronRight,
  Bot,
  MessageSquare,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { useState } from "react";
import { useInfraStatus } from "@/lib/use-infra-status";

const NAV_ITEMS = [
  {
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    description: "Overview & quick stats",
  },
  {
    label: "Chat",
    href: "/chat",
    icon: MessageSquare,
    description: "Interactive agent chat & execution",
  },
  {
    label: "Pipelines",
    href: "/pipelines",
    icon: Network,
    description: "Visual pipeline builder",
  },
  {
    label: "Recipes",
    href: "/recipes",
    icon: BookOpen,
    description: "Pre-built loop configurations",
  },
  {
    label: "Runs",
    href: "/runs",
    icon: History,
    description: "Execution history & analytics",
  },
  {
    label: "Providers",
    href: "/providers",
    icon: Cpu,
    description: "LLM provider management",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    description: "Configuration & preferences",
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const infra = useInfraStatus();

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "flex flex-col border-r border-zinc-800 bg-zinc-950 transition-all duration-200",
          collapsed ? "w-16" : "w-60",
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            "flex h-14 items-center border-b border-zinc-800 px-4",
            collapsed ? "justify-center" : "gap-3",
          )}
        >
          <Bot className="h-6 w-6 shrink-0 text-blue-500" />
          {!collapsed && (
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="text-sm font-bold text-zinc-50 truncate">
                Agentic Lab
              </span>
              <span className="shrink-0 rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">
                v0.1
              </span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-2">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            const linkContent = (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-500/10 text-blue-400"
                    : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200",
                  collapsed && "justify-center px-2",
                )}
              >
                <item.icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isActive ? "text-blue-400" : "text-zinc-500",
                  )}
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right">
                    <p className="font-medium">{item.label}</p>
                    <p className="text-zinc-400">{item.description}</p>
                  </TooltipContent>
                </Tooltip>
              );
            }
            return linkContent;
          })}
        </nav>

        {/* Infra status */}
        {!infra.loading && (
          <div className={cn(
            "border-t border-zinc-800 px-3 py-2",
            collapsed && "px-2",
          )}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex justify-center">
                    <Circle
                      className={cn(
                        "h-2.5 w-2.5",
                        infra.isFullyHealthy
                          ? "fill-emerald-400 text-emerald-400"
                          : infra.isFullyDown
                            ? "fill-red-400 text-red-400"
                            : "fill-amber-400 text-amber-400",
                      )}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p className="font-medium">
                    Infra: {infra.isFullyHealthy ? "All healthy" : infra.isFullyDown ? "All down" : "Degraded"}
                  </p>
                  <div className="mt-1 space-y-0.5">
                    {infra.services.map((s) => (
                      <p key={s.name} className="text-xs">
                        <span className="capitalize">{s.name}</span>:{" "}
                        <span className={
                          s.status === "healthy"
                            ? "text-emerald-400"
                            : "text-red-400"
                        }>
                          {s.status}
                        </span>
                      </p>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Circle
                    className={cn(
                      "h-2 w-2 shrink-0",
                      infra.isFullyHealthy
                        ? "fill-emerald-400 text-emerald-400"
                        : infra.isFullyDown
                          ? "fill-red-400 text-red-400"
                          : "fill-amber-400 text-amber-400",
                    )}
                  />
                  <span className="text-[10px] font-medium text-zinc-500">
                    {infra.isFullyHealthy
                      ? "All services healthy"
                      : infra.isFullyDown
                        ? "Infrastructure offline"
                        : "Degraded mode"}
                  </span>
                </div>
                {!infra.isFullyHealthy && (
                  <div className="flex gap-1 flex-wrap">
                    {infra.services.map((s) => (
                      <span
                        key={s.name}
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[9px] font-medium capitalize",
                          s.status === "healthy"
                            ? "bg-emerald-500/10 text-emerald-500"
                            : "bg-zinc-800 text-zinc-600",
                        )}
                      >
                        {s.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Collapse toggle */}
        <div className="border-t border-zinc-800 p-2">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex w-full items-center justify-center rounded-lg py-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
