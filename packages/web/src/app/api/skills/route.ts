// ============================================
// GET /api/skills
// ============================================
// Lists the skills available to attach to pipeline nodes.

import { NextResponse } from "next/server";
import { getSkills } from "@/lib/skills-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const skills = await getSkills();
  return NextResponse.json({
    skills: skills.map((s) => ({
      name: s.name,
      description: s.description,
      version: s.version,
      activation: s.activation,
      allowedTools: s.allowedTools ?? [],
      keywords: s.keywords ?? [],
    })),
  });
}
