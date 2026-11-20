// Jig's own documentation: the right part for a question in English or in
// Spanish, every slash command and built-in topology read from the code, the
// version, and an answer marked as written documentation, not measured.

import { describe, it, expect } from "vitest";
import { listRecipes } from "jig-core";
import { COMMANDS } from "../session/commands.js";
import { JigHelpTool, aboutJig, helpSections, offerJigHelp, searchHelp, versions } from "./jig-help.js";

const first = (q: string) => searchHelp(q)[0]?.title;

describe("jig_help", () => {
  it("answers what Jig is, in English and in Spanish", () => {
    expect(first("what is jig?")).toBe("What Jig is");
    expect(first("¿qué es jig?")).toBe("What Jig is");
  });

  it("answers how to switch the topology and change a role's model", () => {
    expect(first("how do I switch topology?")).toBe("Switching the topology, a role's model or its brain");
    expect(first("how do I change the model of Check?")).toBe("Switching the topology, a role's model or its brain");
    expect(first("¿cómo cambio el modelo de Check?")).toBe("Switching the topology, a role's model or its brain");
    expect(first("where are my sessions kept")).toBe("Where files live: sessions, runs, settings");
    expect(first("what does accept edits mode do")).toBe("Permissions and modes");
  });

  it("reads every slash command and every built-in topology from the code, and the versions", () => {
    const sections = helpSections();
    const commands = sections.find((s) => s.title === "Slash commands")!.body;
    for (const c of COMMANDS) expect(commands).toContain(c.usage);
    const topologies = sections.find((s) => s.title.startsWith("Built-in topologies"))!.body;
    for (const r of listRecipes()) expect(topologies).toContain(`\`${r.id}\``);
    expect(topologies).toMatch(/Check \(id eval, brain strong\)/);
    // What each is meant for, and the research behind it, come from the topology files.
    expect(topologies).toContain("Meant for: Changes you can check with a command or a test");
    expect(topologies).toContain("Reflexion: Language Agents with Verbal Reinforcement Learning (Shinn et al., 2023) https://arxiv.org/abs/2303.11366");
    expect(versions().console).toMatch(/^\d+\.\d+\.\d+$/);
    expect(versions().core).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("returns the best part whole, marked as Jig's written documentation, never as measured", async () => {
    const out = await new JigHelpTool().execute({ query: "switch topology" });
    expect(out).toMatch(/^❝ From Jig's own documentation \(written, not measured\), jig-console \d+\.\d+\.\d+, "Switching the topology/);
    expect(out).toContain("/topology deep-reasoning");
    expect(await new JigHelpTool().execute({ query: "zzzz" })).toMatch(/Nothing matched; its parts are: What Jig is;/);
  });

  it("puts what Jig is and where to look in every role's environment, and offers the tool to every role", () => {
    expect(aboutJig()).toMatch(/You are one role in Jig .* call jig_help/s);
    for (const r of listRecipes()) {
      for (const n of offerJigHelp(r).nodes) {
        const allow = n.config.toolPolicy?.allow ?? n.config.enabledTools;
        if (allow) expect(allow, `${r.id}/${n.id}`).toContain("jig_help");
      }
    }
  });
});
