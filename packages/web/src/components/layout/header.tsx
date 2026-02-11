"use client";

import { usePathname } from "next/navigation";
import { Bell, Search, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const PAGE_TITLES: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Dashboard",
    description: "Overview of your agentic loops and system health",
  },
  "/chat": {
    title: "Agent Chat",
    description: "Interactive conversation with execution tracking",
  },
  "/pipelines": {
    title: "Pipeline Builder",
    description: "Design and connect loop nodes visually",
  },
  "/recipes": {
    title: "Recipes",
    description: "Pre-built pipeline configurations ready to run",
  },
  "/runs": {
    title: "Runs",
    description: "Execution history, logs, and performance analytics",
  },
  "/providers": {
    title: "Providers",
    description: "Manage LLM providers and model configurations",
  },
  "/settings": {
    title: "Settings",
    description: "System configuration and preferences",
  },
};

export function Header() {
  const pathname = usePathname();
  const pageInfo = PAGE_TITLES[pathname] || PAGE_TITLES["/"];

  return (
    <header className="flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-6 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-sm font-semibold text-zinc-50">
            {pageInfo.title}
          </h1>
          <p className="text-xs text-zinc-500">{pageInfo.description}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="text-zinc-400">
          <Search className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="relative text-zinc-400">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-blue-500" />
        </Button>
        <div className="mx-2 h-6 w-px bg-zinc-800" />
        <Badge variant="outline" className="gap-1.5">
          <Terminal className="h-3 w-3" />
          <span>Ollama</span>
        </Badge>
      </div>
    </header>
  );
}
