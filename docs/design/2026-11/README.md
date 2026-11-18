# The redesign, November 2026

The concept, the build plan and the mockup sheets the rebuild on `feat/topology-lab` follows, made before anything was built. The audit it starts from is [../../AUDIT-2026-11.md](../../AUDIT-2026-11.md), and the hypotheses it tests are [../../FOUNDATIONS.md](../../FOUNDATIONS.md).

- [CONCEPT.md](CONCEPT.md): the idea, the views, the definition format and Agent Spec, the visual system, the build plan in phases, and the choices left to the author.
- `sheets/`: twelve sheets at 1440 by 900 (2x). Every run value in them is illustrative and stamped as such; the roles, ways back, parameters and what each role sees come from the code.
- `html/`: the sheets' sources. `html/topogrid.js` is a working prototype of the layout engine: a topology definition and a run state in, a character grid out, rendered as HTML and as ANSI. `render.mjs` renders them again (see its header).
- `fonts/`: Geist Mono, by Vercel, under the SIL Open Font License (`fonts/OFL.txt`).
