// Topology definitions and run states drawn by the sheets. Roles, ways back and parameters
// come from packages/core/src/loops/recipes.ts; run values are illustrative.
(function (G) {
  const roleDR = [
    { id: "plan", icon: "☰", name: "Plan", engine: "planning", model: "llama3.1:8b" },
    { id: "do", icon: ">", name: "Do", engine: "execution", model: "llama3.1:8b" },
    { id: "check", icon: "⊢", name: "Check", engine: "evaluation", model: "llama3.1:8b" },
    { id: "critic", icon: "◉", name: "Critique", engine: "critic", model: "llama3.1:8b" },
    { id: "decide", icon: "◆", name: "Decide", engine: "refinement", model: "rule, then model" },
  ];
  const sightToday = { rows: [
    { mark: "›", label: "your task", cells: ["· !2", 1, 0, 0, 0] },
    { mark: "“", label: "the plan", cells: ["own", 1, 0, 0, 0] },
    { mark: "“", label: "Do's account", cells: [0, "own", "● !6", 0, "· unread"] },
    { mark: "■", label: "tool calls", cells: [0, "own", "● count", "· unwired", 0] },
    { mark: "■", label: "files, shell, git", cells: [1, 1, 1, 0, 0] },
    { mark: "■", label: "check exit code", cells: [0, 0, "● if given", 0, 0] },
    { mark: "“", label: "Check's verdict", cells: [1, 0, "own", 1, "● pass rate"] },
    { mark: "“", label: "corrections", cells: [0, "· !3", "own", 0, "own"] },
    { mark: "“", label: "critic's notes", cells: [0, 0, 0, "own", "● !4 late"] },
    { mark: "■", label: "tokens spent", cells: [0, 0, 0, 1, 0] },
    { mark: "■", label: "rounds, decisions", cells: [0, 0, 0, "● cycles", 1] },
  ] };
  const sightFixed = { rows: [
    { mark: "›", label: "your task", cells: [1, 1, 0, 0, 0] },
    { mark: "“", label: "the plan", cells: ["own", 1, 0, 0, 0] },
    { mark: "“", label: "Do's account", cells: [0, "own", 1, 0, 0] },
    { mark: "■", label: "tool calls", cells: [0, "own", "● count", 1, 0] },
    { mark: "■", label: "files, shell, git", cells: [1, 1, 1, 0, 0] },
    { mark: "■", label: "check exit code", cells: [0, 0, 1, 0, "● in verdict"] },
    { mark: "“", label: "Check's verdict", cells: [1, 0, "own", 1, "● pass rate"] },
    { mark: "“", label: "corrections", cells: [0, 1, "own", 0, "own"] },
    { mark: "“", label: "critic's notes", cells: [0, 0, 0, "own", 1] },
    { mark: "■", label: "tokens spent", cells: [0, 0, 0, 1, 0] },
    { mark: "■", label: "rounds, decisions", cells: [0, 0, 0, 1, 1] },
  ] };
  const sightPhase0 = { rows: sightFixed.rows.map((r) => r.label === "check exit code" ? { ...r, cells: [0, 0, 1, 0, "· not read"] } : r) };
  const DR = (sight, lints) => ({
    title: "Deep Reasoning", gutter: 20,
    summary: ["built in · v1.0.0", "5 roles", "2 ways back", "3 rounds at most"],
    restLine: "at rest · drawn from recipes.ts · no tokens spent",
    roles: roleDR.map((r) => ({ ...r, lint: lints && r.id === "plan" ? "" : undefined })),
    back: [
      { from: "decide", to: "do", label: "not passing: back to Do", rounds: 3, max: "at most 3" },
      { from: "decide", to: "plan", label: "same checks fail twice: back to Plan" },
    ],
    also: [
      { from: "check", to: "do", label: "also: corrections" },
      { from: "check", to: "plan", label: "also: verdicts to Plan" },
    ],
    exit: { label: "done", when: ["at 70% passing", "with no notes,", "or at round 3"] },
    sight,
  });

  const drRunning = {
    running: true, active: "critic", done: ["plan", "do", "check"], token: "check", spin: "⠹", doing: "reading",
    results: { check: { txt: "✗ 99/100 lines", k: "fail" } },
    perRole: { plan: "1.1k", do: "3.4k", check: "2.0k" },
    rounds: [{ state: "fail", flag: true }, { state: "now" }],
    status: { lead: "⠹ running", text: "round 2 of 3 · 00:41 · 9.8k tokens · $0 local · values illustrative", short: "round 2 of 3 · 9.8k tok" },
  };

  const ralph = {
    title: "Ralph Loop", gutter: 20, summary: ["built in · v1.0.0", "1 role", "1 way back", "20 turns at most"],
    restLine: "at rest · the baseline every experiment includes",
    roles: [{ id: "do", icon: ">", name: "Do", engine: "execution", model: "llama3.1:8b" }],
    back: [{ from: "do", to: "do", label: "plan not done: again", counter: true, max: "at most 20" }],
    exit: { label: "done", when: ["PLAN.md done,", "or turn 20"] },
    sight: { rows: [
      { mark: "›", label: "your task", cells: [1] },
      { mark: "“", label: "PLAN.md", cells: ["● own file"] },
      { mark: "■", label: "files, shell, git", cells: [1] },
      { mark: "“", label: "its last turn", cells: [0] },
    ] },
  };
  const ralphRunning = {
    running: true, active: "do", spin: "⠼", doing: "npm test", counter: "turn 4",
    status: { lead: "⠼ running", text: "turn 4 of 20 · 01:12 · 6.1k tokens · $0 local · values illustrative", short: "turn 4 of 20" },
  };

  const custom = {
    title: "Cheap hands", gutter: 20,
    summary: ["yours · v3", "3 roles + advisor", "1 way back", "decided by rule"],
    restLine: "at rest · a small model does the work and asks a large one when it wants",
    roles: [
      { id: "do", icon: ">", name: "Do", engine: "execution", model: "llama3.1:8b" },
      { id: "check", icon: "⊢", name: "Check", engine: "tests only", model: "no model" },
      { id: "decide", icon: "◆", name: "Decide", engine: "rule only", model: "no model" },
    ],
    back: [{ from: "decide", to: "do", label: "tests fail: back to Do", rounds: 3, max: "at most 3" }],
    consult: [{ from: "do", label: "asks when it wants · 3 a turn", liveLabel: "consulting: before done",
      role: { icon: "✦", name: "Advisor", note: "qwen2.5-coder:32b · sees ■ tests ■ diff, not “ Do's words" } }],
    exit: { label: "done", when: ["tests pass,", "or round 3"] },
    sight: { rows: [
      { mark: "›", label: "your task", cells: [1, 0, 0] },
      { mark: "■", label: "files, shell, git", cells: [1, 1, 0] },
      { mark: "■", label: "test exit code", cells: [0, 1, "● as pass/fail"] },
      { mark: "“", label: "advice", cells: [1, 0, 0] },
      { mark: "■", label: "rounds", cells: [0, 0, 1] },
    ] },
  };
  const customRunning = {
    running: true, active: "do", spin: "⠧", doing: "asking", consultLive: true,
    rounds: [{ state: "fail" }, { state: "now" }], results: {},
    status: { lead: "⠧ running", text: "round 2 of 3 · 2 consults · 00:58 · 7.4k tokens · values illustrative", short: "round 2 · 2 consults" },
  };

  const drReplay = {
    replay: true, focus: "decide", focusText: "▸ step 9", done: ["plan", "do", "check", "critic"],
    results: { check: { txt: "✗ exit 1", k: "fail" } },
    rounds: [{ state: "fail" }, { state: "fail" }],
    status: { lead: "▸ replay r-0398", text: "stopped at round 2 of 3 · the check still failed · 14.2k tokens · 01:36" },
    timeline: { left: "round 1     round 2", at: 9, atK: "b", caption: "step 9 of 9 · Decide, round 2 · drag to move · ⚑ critic notes · ✗ failed checks",
      steps: [{ ch: "☰" }, { ch: ">" }, { ch: "✗", k: "fail" }, { ch: "◉" }, { ch: "◆" }, "|", { ch: ">" }, { ch: "✗", k: "fail" }, { ch: "◉" }, { ch: "◆" }] },
  };
  const execEval = {
    title: "Execute & Evaluate", gutter: 20, summary: ["built in · v1.0.0", "2 roles", "1 way back", "no round limit"],
    restLine: "proposed for your task · drawn from recipes.ts",
    roles: [
      { id: "do", icon: ">", name: "Do", engine: "execution", model: "llama3.1:8b" },
      { id: "check", icon: "⊢", name: "Check", engine: "evaluation", model: "llama3.1:8b" },
    ],
    back: [{ from: "check", to: "do", label: "check fails: back to Do", max: "" }],
    exit: { label: "done", when: ["nothing left to", "send, or cycle 30"] },
  };
  const S = (r) => ({ roles: roleDR.filter((x) => !r || !r.includes(x.id)), back: [1] });
  const strips = {
    R: { rounds: " 20" }, D: { rounds: " 3" }, E: { rounds: " 3", changed: ["critic"], notes: { critic: "+ “ output" } },
    F: { rounds: " 3" }, A: { rounds: " 3" }, B: { rounds: " 3", changed: ["do"], notes: { do: "+ › task" } },
  };
  const arms = { full: S(), noCritic: S(["critic"]), noPlan: S(["plan"]),
    ralph: { roles: [{ icon: ">", name: "Do" }], back: [1] },
    bon: { roles: [{ icon: "▦", name: "N answers" }, { icon: "⊢", name: "best by check" }] } };
  G.TOPO = { sightPhase0, drReplay, execEval, strips, arms, DR, sightToday, sightFixed, drRunning, ralph, ralphRunning, custom, customRunning };
})(globalThis);
