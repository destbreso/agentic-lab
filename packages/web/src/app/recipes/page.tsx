"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Zap,
  Eye,
  Brain,
  Shield,
  Database,
  ArrowRight,
  Layers,
  Star,
  Clock,
  Users,
  Search,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ─── Types ──────────────────────────────────────── */

interface RecipeNode {
  type: string;
  name: string;
}

interface Recipe {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  category: string;
  nodeCount: number;
  wireCount: number;
  nodes: RecipeNode[];
}

/* ─── Constants ──────────────────────────────────── */

const LOOP_ICONS: Record<string, React.ElementType> = {
  execution: Zap,
  evaluation: Eye,
  planning: Brain,
  critic: Shield,
  memory: Database,
};

const LOOP_COLORS: Record<string, string> = {
  execution: "text-blue-400 bg-blue-500/10",
  evaluation: "text-emerald-400 bg-emerald-500/10",
  planning: "text-violet-400 bg-violet-500/10",
  critic: "text-amber-400 bg-amber-500/10",
  memory: "text-pink-400 bg-pink-500/10",
};

const CATEGORY_BADGE: Record<
  string,
  { variant: "default" | "success" | "warning" | "error"; label: string }
> = {
  basic: { variant: "default", label: "Beginner" },
  intermediate: { variant: "warning", label: "Intermediate" },
  advanced: { variant: "error", label: "Advanced" },
};

/* ─── Sub-components ─────────────────────────────── */

function NodeChip({ node }: { node: RecipeNode }) {
  const Icon = LOOP_ICONS[node.type] || Zap;
  const colors = LOOP_COLORS[node.type] || LOOP_COLORS.execution;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium",
        colors,
      )}
    >
      <Icon className="h-3 w-3" />
      <span>{node.name}</span>
    </div>
  );
}

function RecipeCard({ recipe }: { recipe: Recipe }) {
  const categoryInfo = CATEGORY_BADGE[recipe.category] || CATEGORY_BADGE.basic;

  return (
    <Card className="group flex flex-col transition-all hover:border-zinc-600 hover:shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-violet-500/10 p-2 text-violet-400">
              <BookOpen className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm">{recipe.name}</CardTitle>
              <span className="text-[10px] text-zinc-600">
                v{recipe.version}
              </span>
            </div>
          </div>
          <Badge variant={categoryInfo.variant} className="text-[10px]">
            {categoryInfo.label}
          </Badge>
        </div>
        <CardDescription className="mt-2 text-xs leading-relaxed">
          {recipe.description}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 space-y-3 pb-3">
        {/* Node chips */}
        <div className="flex flex-wrap gap-1.5">
          {recipe.nodes.map((node, i) => (
            <NodeChip key={i} node={node} />
          ))}
        </div>

        {/* Meta */}
        <div className="flex items-center gap-4 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1">
            <Layers className="h-3 w-3" />
            {recipe.nodeCount} node{recipe.nodeCount !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1">
            <ArrowRight className="h-3 w-3" />
            {recipe.wireCount} wire{recipe.wireCount !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {recipe.author}
          </span>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          {recipe.tags.map((tag) => (
            <Badge key={tag} variant="muted" className="text-[9px]">
              {tag}
            </Badge>
          ))}
        </div>
      </CardContent>

      <CardFooter className="border-t border-zinc-800/50 pt-3">
        <Link
          href={`/pipelines?recipe=${recipe.id}`}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-violet-500/10 hover:text-violet-300 group-hover:bg-violet-500/10 group-hover:text-violet-300"
        >
          Use this recipe
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
        </Link>
      </CardFooter>
    </Card>
  );
}

/* ─── Main Page ──────────────────────────────────── */

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  useEffect(() => {
    fetch("/api/pipelines/recipes")
      .then((r) => r.json())
      .then((d) => setRecipes(d.recipes || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = recipes.filter((r) => {
    const matchesSearch =
      search === "" ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase()) ||
      r.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory =
      categoryFilter === "all" || r.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const categories = ["all", ...new Set(recipes.map((r) => r.category))];

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          <span className="text-sm text-zinc-500">Loading recipes…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 animate-in fade-in">
      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search recipes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 py-2 pl-10 pr-4 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
          />
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 rounded-xl bg-zinc-800/50 p-1">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                categoryFilter === cat
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Recipe Grid */}
      {filtered.length === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-center">
            <BookOpen className="h-8 w-8 text-zinc-600" />
            <p className="text-sm text-zinc-400">No recipes found</p>
            <p className="text-xs text-zinc-600">
              Try a different search or category filter
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}
    </div>
  );
}
