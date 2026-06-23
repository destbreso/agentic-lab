# Roadmap Arquitectónico: Agentic Lab → Plataforma de Loops Componibles con Skills

> Fecha: 22 de junio de 2026 · Versión base analizada: 0.1.0
> Objetivo: convertir Agentic Lab en un sistema **model-agnostic** de **loops avanzados** (topología estilo Claude) construido sobre **componentes reutilizables**, donde cada loop especializado se compone de un **brain (modelo)**, **skills**, **tools** y **memoria**, con **availability y feedback rules por nodo**, capacidad de **crear loops nuevos** y **memoria contextual + compartida**.

Este documento es para **revisión previa a implementación**. No introduce cambios de código; define la brecha, la arquitectura objetivo y un plan de ejecución por fases con criterios de aceptación.

---

## 0. TL;DR

Agentic Lab ya tiene los cimientos correctos: un motor de pipeline DAG con señales tipadas, 6 loops cognitivos diferenciados, abstracción de providers, storage degradable y memoria semántica. **Pero la visión objetivo (brain + skills + tools + memoria, configurables por nodo) no es expresable hoy** porque:

1. **No existe el concepto de Skill** (0 referencias en todo el repo).
2. La **capability por nodo no se cablea**: `enabledTools`, `provider`/`model` y memoria están en los tipos pero todos los nodos comparten el mismo `ToolRegistry` y el mismo provider global.
3. El **`NodeContext` es demasiado delgado**: no expone tools, brain, memoria ni escritura a estado compartido.
4. La **memoria semántica no se inyecta** en el runtime de loops (vive en la web).
5. La **orquestación avanzada vive en la web** (`chat/agent/route.ts`, 2.659 líneas), no en el core → no reutilizable desde CLI/SDK.
6. El **parsing de salida del LLM es por regex** (frágil) → señales poco fiables entre loops.

El roadmap resuelve esto en **7 fases** (Fase 0 a Fase 6). Las Fases 0–3 entregan el núcleo de la visión; las 4–6 lo hacen autoría declarativa, unificación y producto.

---

## Estado de implementación

> Actualizado: 23 de junio de 2026 · rama `feat/loop-architecture-v2`

| Fase | Estado | Qué se entregó |
|------|--------|----------------|
| **0 — Fundaciones** | ✅ Completa | structured output (Zod) en los 5 loops cognitivos · context-window pruning · retry/backoff en providers · tests de motor |
| **1 — Capability por nodo** | ✅ Completa | brain por nodo · tools por nodo (allow/deny) · blackboard compartido escribible · resolución en instanciación de recipes |
| **2 — Skills** | ✅ Completa | `SKILL.md`+frontmatter · `SkillRegistry` · loader FS · activación (embeddings+heurística) · composición · **tool-granting + prompt-injection end-to-end** |
| **3 — Memoria contextual** | ✅ Completa | `MemoryGateway` (recall semántico + fallback texto, remember scoped) · auto-recall en ExecutionLoop · MemoryLoop persiste al store |
| **4 — Autoría declarativa + feedback rules** | ✅ Completa | `ConfigurableLoop` + `LoopBlueprint` + `registerBlueprint` · `applyFeedbackRules` (where/asSignal/transform/maxFires) |
| **5 — `AgentSession` + auto-skills en vivo** | 🟡 Core completo | `AgentSession.run(task)`: activa skills por tarea (semántico/heurístico), siembra la tarea, corre la recipe. **Falta**: adoptar `AgentSession` en la ruta web (adaptador fino) |
| **Builder visual (web)** | 🟢 Funcional | Editor drag-and-drop ahora ejecuta (`Run` SSE con estado en vivo por nodo), guarda (`Save`→recipe persistida y recargable) y configura **capabilities por nodo** (brain, tools, skills, memoria, loop config). APIs: `/api/pipelines/run`, `/api/skills`, `/api/providers`. **Falta**: editor visual de feedback rules a nivel de wire |
| **6 — Hardening / seguridad / DX** | ⬜ Pendiente | auth API · descomponer god components · data-fetching · sub-path exports |

**Visión COMPLETA en el core (Fases 0–5).** El sistema tiene loops reutilizables que se especializan por configuración — cada nodo con su modelo (brain), su subconjunto de tools, skills adjuntas o **auto-activadas por la tarea** (embeddings) que conceden capacidades e inyectan instrucciones, memoria contextual + compartida, autoría declarativa de loops, feedback rules, y un `AgentSession` como punto de entrada único.

Métricas: **201 tests** (de 71 iniciales) · core+cli+web compilan · API pública solo aditiva · cero breaking changes (recipes y API v1 intactas).

Notas de alcance: (a) el `AgentSession` es la fuente única de orquestación en el core; la ruta web `chat/agent/route.ts` aún tiene su lógica propia y debería reducirse a un adaptador SSE sobre `AgentSession` (Fase 5, parte web). (b) El `PlanningLoop` aún parsea por regex (los otros 4 loops ya usan Zod) — pendiente menor.

---

## 1. Qué hace hoy (arquitectura real)

| Capa | Implementación actual | Estado |
|------|----------------------|--------|
| **Brain (modelo)** | `providers/` — Ollama, OpenAI, Anthropic, OpenRouter (vía OpenAI), Google. `createProvider()` factory + `registerProvider()`. | ✅ Sólido, model-agnostic a nivel de provider |
| **Muscle (tools)** | 6 tools (`file_read/write`, `shell`, `glob`, `grep`, `git`). `ToolRegistry` + `createDefaultToolkit(enabledTools?)`. | ✅ Funciona, pero scoping solo global |
| **Loop simple** | `AgenticLoop` (Ralph Loop): iteraciones stateless, plan/prompt/specs, tool-loop, mid-loop steering (nudges), persistencia. | ✅ Pulido |
| **Motor componible** | `LoopNode` + `BaseLoopNode` + 6 loops (execution/evaluation/planning/critic/memory/refinement). `PipelineOrchestrator` (DAG, señales, puertos, wires, frequency, concurrencia, timeout, detección de ciclos). Registry + recipes. | ✅ Ingeniería seria |
| **Memoria** | `storage/` (postgres/in-memory), `VectorMemoryStore` (Qdrant), `MemoryLoop` (resumen). Bancos de memoria en la web. | 🟡 Existe pero desconectada de los loops |
| **Web** | Dashboard Next.js (chat dual, pipelines, recipes, runs, memorias, benchmarks, providers). | 🟡 God components + orquestación en rutas |
| **CLI** | `run`, `pipeline`, `recipes`, `chat`, `config`, `init`, `status`, `providers`, `history`. | ✅ UX excelente |

**Modelo de ejecución del pipeline (hoy):** cada ciclo el orquestador decide qué nodos disparan (por `frequency`/señales), construye un `NodeContext` (delgado), ejecuta `node.execute()`, recoge señales emitidas vía `context.emit()`, las rutea por wires (con filter/transform) a puertos destino, y repite. Los nodos **no comparten** más que señales tipadas.

---

## 2. Diagnóstico de problemas

### 2.A — Brecha con la visión (lo que falta para el objetivo)

| # | Brecha | Evidencia en código | Impacto |
|---|--------|--------------------|---------|
| A1 | **No hay Skills.** No existe abstracción de capacidad empaquetada (instrucciones + tools permitidas + recursos + activación). | `grep -rni skill` → 0 resultados. | 🔴 Bloquea el núcleo de la visión |
| A2 | **Capability por nodo no se resuelve.** `enabledTools` (NodeRunConfig) nunca filtra; `provider`/`model` por nodo no se cablea. | `registry.ts` factories usan `metadata?.tools`/`metadata?.provider` globales; `recipes.ts:129` aplica los mismos `resolvedParams` a todos los nodos. | 🔴 No puedes especializar nodos |
| A3 | **`NodeContext` no entrega capabilities.** No hay tools, brain, memoria ni escritura compartida en el contexto. | `buildNodeContext()` (`pipeline.ts:733`) no incluye tools/brain/memory; `pipelineState` es copia read-only. | 🔴 Los loops no son verdaderamente reutilizables |
| A4 | **Memoria contextual no inyectada.** Ningún loop hace recall semántico antes de razonar. | Sin referencias a `semanticSearch`/`MemoryStore` en `loops/` ni `engine/`. | 🟠 Loops "amnésicos" entre ciclos |
| A5 | **Sin memoria compartida escribible (blackboard).** Solo `pipelineState.shared`, comentado "only orchestrator writes", y pasado como copia. | `types/pipeline.ts:364`. | 🟠 Coordinación limitada a señales |
| A6 | **Feedback rules ad-hoc.** La retroalimentación es solo wires + filter/transform + frequency; no hay reglas declarativas "cuando X → enruta a nodo Y con skill Z". | `Wire.filter/transform` en `types/pipeline.ts:81`. | 🟠 Difícil de configurar/razonar |
| A7 | **Crear loops requiere TS.** Solo vía clase `BaseLoopNode` + factory en registry. No hay definición declarativa de loop. | `loops/*.ts` + `registry.ts`. | 🟠 Fricción para nuevos loops |
| A8 | **Orquestación avanzada fuera del core.** El agente conversacional multi-loop vive en la web. | `chat/agent/route.ts` (2.659 líneas). | 🔴 No reutilizable en CLI/SDK |

### 2.B — Deuda técnica que bloquea la visión (prerrequisitos)

| # | Problema | Ubicación | Por qué bloquea |
|---|----------|-----------|-----------------|
| B1 | **Parsing por regex** de la salida del LLM (`VERDICT:\s*(pass\|fail)`, etc.). Zod está en deps pero sin usar. | `loops/evaluation.ts`, `critic.ts`, `refinement.ts`, `memory.ts`. | Señales entre loops poco fiables → el sistema multi-loop es frágil de base. |
| B2 | **Sin gestión de ventana de contexto.** `messages` crece sin límite en el tool-loop (`maxToolRounds=20`). | `loop.ts:578`, `execution.ts:103`. | Loops largos revientan el contexto; impide loops "deep". |
| B3 | **Sin retry/backoff** en providers. | `providers/*.ts`. | Inestabilidad en runs largos multi-nodo. |
| B4 | **Brain por nodo no cableado** (ver A2). | `registry.ts`, `recipes.ts`. | Sin esto no hay "Opus en planning, Haiku en execution". |
| B5 | **Tests del motor ausentes** (AgenticLoop, PipelineOrchestrator, PlanManager). | — | Refactor arriesgado sin red de seguridad. |

### 2.C — Deuda heredada (del `ASSESSMENT.md`, aún pendiente)

Seguridad: **sin auth en API routes**, **credenciales hardcodeadas** (`factory.ts`). Mantenibilidad: **god components** (`chat/page.tsx` ~2.584 líneas, `chat/agent/route.ts`), **sin data-fetching layer** en web, **duplicación** (helpers, `getStorageClient`, flujo pipeline/recipes en CLI), **barrel index** con ~100+ exports. DX: sub-path exports, `--json` en CLI.

> Las vulnerabilidades críticas (SQLi, path traversal, shell injection, ReDoS) y 7 bugs funcionales **ya se resolvieron** en la ronda previa. Esta deuda C es "hardening de producto", no bloqueante para la visión, y se aborda en la Fase 6.

---

## 3. Arquitectura objetivo (North Star)

### 3.1 Capas

```
┌───────────────────────────────────────────────────────────────────────┐
│ ORCHESTRATION                                                         │
│   PipelineOrchestrator (DAG) · AgentSession (conversacional)          │
│   FeedbackRules engine (declarativo) → compila a wires + triggers     │
├───────────────────────────────────────────────────────────────────────┤
│ LOOP / NODE  (componentes reutilizables)                             │
│   LoopNode = brain + tools + skills + memory-policy + parsing-schema  │
│   ConfigurableLoop (declarativo)   +   custom LoopNode (código)       │
├───────────────────────────────────────────────────────────────────────┤
│ CAPABILITY RESOLUTION  (por nodo)                                    │
│   CapabilityResolver(nodeConfig, registries) → NodeRuntime           │
│   { brain, tools⊆, skills⊆, memory{read,write}, feedbackRules }      │
├──────────────┬───────────────┬───────────────┬───────────────────────┤
│ BRAIN        │ TOOLS         │ SKILLS (nuevo)│ MEMORY                │
│ providers/   │ ToolRegistry  │ SkillRegistry │ Working (contextual)  │
│ per-node     │ scoped subset │ + loader (FS) │ Shared (blackboard)   │
│ model        │ availability  │ progressive   │ Episodic/Semantic     │
│              │               │ disclosure    │ (Qdrant) · policies   │
└──────────────┴───────────────┴───────────────┴───────────────────────┘
```

### 3.2 El modelo de capability por nodo (corazón del rediseño)

Cada nodo, al entrar al loop, recibe un **`NodeRuntime`** resuelto a partir de su config declarativa:

```ts
// Resuelto por CapabilityResolver, inyectado en NodeContext.runtime
interface NodeRuntime {
  brain: LLMProvider;              // provider+model PROPIOS del nodo (A2/B4)
  tools: ToolRegistry;             // subconjunto permitido (availability) (A2)
  skills: ActiveSkill[];           // skills adjuntas, activables (A1)
  memory: MemoryGateway;           // recall/remember con scopes (A4)
  shared: SharedStore;             // blackboard read+write (A5)
  feedbackRules: FeedbackRule[];   // reglas declarativas del nodo (A6)
}
```

Y el `NodeRunConfig` se extiende para declararlo (todo opcional, con defaults heredados del pipeline):

```ts
interface NodeRunConfig {
  // ...existente (maxIterations, delayMs, timeoutMs, frequency, concurrent)
  brain?: { provider?: string; model?: string; temperature?: number; maxTokens?: number };
  tools?: { allow?: string[]; deny?: string[] };        // availability declarativa
  skills?: string[];                                    // skills adjuntas por nombre
  memory?: {
    contextual?: boolean;                               // auto-recall antes de razonar
    readScopes?: string[];                              // namespaces/bancos legibles
    writeScope?: string | null;                         // dónde persiste hechos
    topK?: number;
  };
  feedbackRules?: FeedbackRuleDef[];                    // ver 3.5
}
```

### 3.3 Skills (subsistema nuevo) — inspirado en Agent Skills de Claude

Una **Skill** es una unidad de capacidad empaquetada y reutilizable. Definición declarativa (paquete en filesystem, `progressive disclosure`):

```
.agentic-lab/skills/<skill-name>/
  SKILL.md          # frontmatter (name, description, version, activation, allowedTools) + cuerpo (instrucciones)
  resources/        # archivos cargables bajo demanda (snippets, ejemplos, schemas)
  scripts/          # (opcional) ejecutables auxiliares
```

```ts
interface Skill {
  name: string;
  description: string;                 // "cuándo usarla" → para auto-activación/routing
  version: string;
  instructions: string;                // fragmento de system-prompt que se inyecta al activarse
  allowedTools?: string[];             // tools que la skill habilita/necesita
  resources?: SkillResource[];         // cargables bajo demanda (no entran al prompt hasta usarse)
  activation: 'always' | 'auto' | 'manual';  // siempre / por relevancia / explícita
  parameters?: SkillParameter[];
}
```

- **Progressive disclosure**: solo el `name`+`description` están siempre visibles; el `instructions` se inyecta cuando la skill se activa (always, o auto por relevancia/heurística/embeddings, o manual). Los `resources` se cargan vía una tool `skill_load`.
- **Composición**: al resolver un nodo, sus skills aportan (a) instrucciones al system prompt y (b) tools al subconjunto disponible.
- **Reutilización**: una skill se adjunta a cualquier loop/nodo por nombre.

### 3.4 Memoria: tres planos + políticas

| Plano | Qué es | Alcance | API en `NodeContext` |
|-------|--------|---------|----------------------|
| **Working / contextual** | Recall semántico inyectado antes de razonar (RAG sobre el banco activo) | Run / banco | `runtime.memory.recall(query, {topK, scopes})` |
| **Shared (blackboard)** | KV/documento escribible por todos los nodos del run, más allá de señales | Pipeline run | `runtime.shared.get/set/append` |
| **Episodic / semantic** | Hechos duraderos cross-run en Qdrant (bancos actuales) | Global / banco | `runtime.memory.remember(fact, {scope})` |

Cada nodo declara su **política**: si auto-inyecta contextual, qué scopes lee, dónde escribe. El `MemoryLoop` evoluciona de "solo resume" a "gestor de memoria" que consolida y **persiste** al store semántico.

### 3.5 Feedback rules declarativas

Capa sobre los wires actuales. Una regla compila a wire(s) + trigger(s) + transform:

```ts
interface FeedbackRuleDef {
  when: { signal: string; where?: string };   // p.ej. signal:"evaluation", where:"verdict == 'fail'"
  route: { toNode: string; asSignal: string };
  attachSkill?: string;                        // activa una skill en el nodo destino
  priority?: 'low'|'normal'|'high'|'critical';
  maxFires?: number;                           // anti-bucle
}
```

Esto hace explícito y configurable el "según qué nodo entra al loop, con qué retroalimentación" sin escribir wires a mano.

### 3.6 Crear loops nuevos (dos caminos)

1. **Declarativo (`ConfigurableLoop`)** — sin TS. Un `LoopBlueprint` describe categoría, system prompt, puertos, brain por defecto, tools/skills por defecto, **schema de parsing (Zod)** de su salida y feedback rules. Un intérprete genérico lo ejecuta. Cubre el 80% de casos.
2. **Código (`BaseLoopNode`)** — para lógica especial (como hoy), pero ahora consumiendo `runtime` del contexto en vez de dependencias bakeadas en el constructor.

---

## 4. Roadmap por fases

> Convención: cada fase lista **objetivo · entregables · archivos · criterios de aceptación (CA) · esfuerzo**. Esfuerzo en días-persona aproximados. Las fases 0–3 son el camino crítico de la visión.

### Fase 0 — Fundaciones y hardening (prerrequisitos) · ~5–7 d
**Objetivo:** base fiable para construir la visión encima.
**Entregables:**
- **Structured output**: util `parseStructured(schema, text, { provider })` que usa JSON-mode/tool-call cuando el provider lo soporta y Zod para validar; fallback tolerante. Migrar evaluation/critic/refinement/memory del regex a schemas Zod. (B1)
- **Context window manager**: estrategia de sliding-window + compactación de mensajes `tool` en el tool-loop, con presupuesto de tokens configurable. (B2)
- **Retry/backoff** exponencial con jitter en `providers/` (respetando `AbortSignal`). (B3)
- **Tests del motor**: `AgenticLoop` y `PipelineOrchestrator` con provider mock (terminación, ciclos, timeouts, frequency). (B5)

**Archivos:** `core/src/utils/structured.ts` (nuevo), `loops/{evaluation,critic,refinement,memory}.ts`, `core/src/utils/context-window.ts` (nuevo), `engine/loop.ts`, `loops/execution.ts`, `providers/*.ts`, `engine/loop.test.ts`, `engine/pipeline.test.ts` (nuevo).
**CA:** evaluation/critic/refinement devuelven objetos validados por Zod (no regex); un run de 50 mensajes no excede el presupuesto de contexto; un provider que falla 2× se recupera; suite verde.

### Fase 1 — Modelo de capability + `NodeContext` v2 · ~6–8 d
**Objetivo:** que cada nodo tenga su propio brain y su subconjunto de tools, inyectados por contexto.
**Entregables:**
- `CapabilityResolver`: dado `NodeRunConfig` + registries (providers, tools), produce `NodeRuntime` (brain por nodo, tools scoped por allow/deny). (A2/A3/B4)
- `NodeContext.runtime` añadido; refactor de los 6 loops para **consumir `context.runtime`** en vez de dependencias bakeadas en constructor.
- `recipes.ts` deja de aplicar `provider`/`tools` globales a todos los nodos: pasa a metadata **por nodo**, con herencia desde defaults del pipeline.
- **Shared blackboard** escribible (`runtime.shared`) mediado por el orquestador (escrituras aplicadas tras `execute`, sin condiciones de carrera). (A5)

**Archivos:** `core/src/engine/capability-resolver.ts` (nuevo), `types/pipeline.ts` (extender `NodeRunConfig`, `NodeContext`), `engine/pipeline.ts` (`buildNodeContext`, aplicar shared writes), `loops/*.ts`, `loops/registry.ts`, `loops/recipes.ts`.
**CA:** una recipe puede declarar planning→Opus y execution→Haiku y se respeta; un nodo con `tools.allow:["file_read"]` no ve `shell`; dos nodos coordinan vía `shared`; recipes existentes siguen funcionando (compat).

### Fase 2 — Subsistema de Skills · ~7–10 d
**Objetivo:** skills de primera clase, adjuntables por nodo.
**Entregables:**
- Tipos `Skill`/`ActiveSkill` + `SkillRegistry`.
- **Loader de filesystem** (`.agentic-lab/skills/<name>/SKILL.md` con frontmatter) + skills built-in de ejemplo.
- **Activación**: `always`/`auto` (por relevancia: heurística keyword o embeddings sobre `description`)/`manual`.
- **Composición** en `CapabilityResolver`: skills → instrucciones al system prompt + tools al subconjunto. Tool `skill_load` para `resources` bajo demanda (progressive disclosure). (A1)
- CLI: `agentic-lab skills list|inspect|add`. Web: página de Skills (listar, ver, adjuntar a nodo/recipe).

**Archivos:** `core/src/skills/{types,registry,loader,activation}.ts` (nuevos), `core/src/skills/builtin/*` (nuevos), `engine/capability-resolver.ts`, `cli/src/commands/skills.ts` (nuevo), `web/src/app/skills/*` (nuevo).
**CA:** adjuntar una skill "code-reviewer" a un nodo evaluation cambia su comportamiento sin tocar código; una skill con `allowedTools` habilita esas tools solo en ese nodo; `skill_load` trae un recurso solo cuando se pide.

### Fase 3 — Memoria contextual + compartida en el runtime · ~5–7 d
**Objetivo:** loops con memoria (recall antes de razonar, remember de hechos, blackboard).
**Entregables:**
- `MemoryGateway` en `NodeContext.runtime`: `recall(query, {topK, scopes})` (semántico vía `VectorMemoryStore`, con degradación a texto), `remember(fact, {scope})`. (A4)
- **Auto-recall contextual**: nodos con `memory.contextual` reciben top-K relevante inyectado en su prompt automáticamente.
- `MemoryLoop` → gestor: consolida y **persiste** al store semántico (no solo resume en señal).
- Políticas de scope por nodo aplicadas (read/write).

**Archivos:** `core/src/engine/memory-gateway.ts` (nuevo), `engine/capability-resolver.ts`, `engine/pipeline.ts`, `loops/memory.ts`, `loops/{execution,planning}.ts` (consumir recall).
**CA:** un nodo recuerda un hecho en el ciclo 2 y lo recupera por recall en el ciclo 7; con Qdrant caído, recall degrada a texto sin romper; el banco activo se respeta.

### Fase 4 — Autoría declarativa de loops + feedback rules · ~6–8 d
**Objetivo:** crear loops y reglas de retroalimentación sin escribir TS.
**Entregables:**
- `LoopBlueprint` + `ConfigurableLoop` (intérprete genérico que usa runtime + schema Zod de salida). (A7)
- `FeedbackRules` engine: compila `FeedbackRuleDef[]` a wires+triggers+transforms, con anti-bucle (`maxFires`). (A6)
- **Recipe format v2**: nodos referencian blueprint/skills/capabilities/memory-policy; loader con compat hacia v1.
- CLI/Web para crear blueprint y recipe v2.

**Archivos:** `core/src/loops/configurable-loop.ts` (nuevo), `core/src/loops/blueprint.ts` (nuevo), `core/src/engine/feedback-rules.ts` (nuevo), `loops/recipes.ts` (v2 + migración), `cli/src/commands/{recipes,pipeline}.ts`, `web/src/app/pipelines/*`.
**CA:** definir un loop "doc-writer" 100% por config y usarlo en una recipe; una feedback rule "eval fail → execution con skill fixer" funciona y no entra en bucle infinito.

### Fase 5 — Unificar orquestación en el core (`AgentSession`) · ~6–9 d
**Objetivo:** una sola fuente de verdad de orquestación, reutilizable en web y CLI.
**Entregables:**
- `AgentSession` en core: encapsula la lógica hoy en `chat/agent/route.ts` (selección de recipe, ejecución multi-loop, streaming de pasos, nudges, costos). (A8)
- Web `chat/agent/route.ts` se reduce a un adaptador SSE sobre `AgentSession`.
- CLI gana `agentic-lab agent` usando el mismo `AgentSession`.
- Eventos/stream estandarizados (un solo `EventMap`).

**Archivos:** `core/src/engine/agent-session.ts` (nuevo), `web/src/app/api/chat/agent/route.ts` (adelgazar), `cli/src/commands/agent.ts` (nuevo).
**CA:** el mismo prompt produce el mismo comportamiento en CLI y web; `route.ts` < ~300 líneas; cobertura de tests sobre `AgentSession`.

### Fase 6 — Hardening de producto, seguridad, DX · ~6–8 d
**Objetivo:** dejarlo listo para uso real.
**Entregables (deuda C):** auth en API routes + quitar credenciales hardcodeadas; data-fetching layer (SWR/React-Query) en web; descomponer `chat/page.tsx`; sub-path exports del core; deduplicar helpers/`getStorageClient`/flujo pipeline-recipes del CLI; `--json` en comandos; docs (`EXTENDING.md` con Skills/Blueprints, actualizar `FOUNDATIONS.md`).
**CA:** API protegida; `chat/page.tsx` en ≤10 componentes; `@agentic-lab/core/skills` importable; lint/test verde; docs alineadas.

---

## 5. Plan de ejecución

### 5.1 Secuenciación y dependencias

```
Fase 0 ──► Fase 1 ──► Fase 2 ──► Fase 3 ──► Fase 4 ──► Fase 5 ──► Fase 6
 (hard)    (caps)     (skills)   (memory)   (autoría)  (unif.)    (prod)
   │          │
   └─ B1 structured output es prerrequisito real de Fase 4 (schemas de loop)
```

- **Camino crítico de la visión:** Fases 0 → 1 → 2 → 3. Al terminar la Fase 3 ya existe: brain por nodo, tools/skills por nodo, memoria contextual + compartida. Eso **es** el sistema descrito en el objetivo.
- **Fase 4** lo vuelve configurable sin código; **Fase 5** lo unifica; **Fase 6** lo endurece.
- Fase 6 (seguridad/DX) puede adelantarse parcialmente en paralelo si hay segundo desarrollador.

### 5.2 Hitos

| Hito | Tras fase | Demo verificable |
|------|-----------|------------------|
| **M1 — Núcleo fiable** | 0 | Loops con salida validada por Zod; run largo sin reventar contexto; suite del motor verde. |
| **M2 — Nodos especializados** | 1 | Recipe con brains y toolsets distintos por nodo; blackboard compartido. |
| **M3 — Skills** | 2 | Adjuntar skill a un nodo cambia su conducta; tools por skill; CLI/web de skills. |
| **M4 — Memoria viva** | 3 | Recall cross-ciclo; remember persistente; degradación sin Qdrant. |
| **M5 — Autoría declarativa** | 4 | Loop nuevo 100% por config + feedback rule sin bucle. |
| **M6 — Unificado + producto** | 5–6 | Mismo agente en CLI y web; API con auth; web descompuesta. |

### 5.3 Quick wins (primera semana, alto valor / bajo riesgo)
1. `parseStructured` + migrar **un** loop (evaluation) a Zod → prueba de concepto de fiabilidad. (B1)
2. Cablear **brain por nodo** en `registry.ts`/`recipes.ts` (cambio acotado, desbloquea demos potentes). (B4)
3. Tests de `PipelineOrchestrator` (terminación/ciclos) → red de seguridad para todo lo demás. (B5)

### 5.4 Primer PR sugerido (Fase 0, vertical slice)
- `core/src/utils/structured.ts` + `evaluation.ts` migrado + sus tests.
- `core/src/utils/context-window.ts` + integración en `loop.ts`.
- `engine/pipeline.test.ts` (terminación, ciclo, timeout).
- Sin cambios de API pública → mergeable sin romper nada.

### 5.5 Principios transversales
- **Compatibilidad hacia atrás:** recipes v1 y la API pública actual siguen funcionando en cada fase (todo lo nuevo es opcional con defaults heredados).
- **Degradación elegante:** mantener el principio "nunca requiere infraestructura" (skills/memoria degradan sin Qdrant/Postgres).
- **Model-agnostic de verdad:** ninguna fase asume un provider concreto; las features funcionan con Ollama local.
- **Cada fase entrega valor demostrable** (un hito con demo), no solo refactor interno.

### 5.6 Métricas de éxito
- **Fiabilidad de señales:** % de salidas de loop parseadas sin fallback (objetivo > 95% con providers cloud).
- **Reutilización:** nº de loops/skills compuestos sin escribir TS.
- **Especialización:** una recipe usa ≥2 brains y ≥2 toolsets distintos.
- **Memoria:** tasa de recall útil cross-ciclo en un benchmark con memoria vs sin memoria.
- **Unificación:** líneas movidas de `web` → `core` (objetivo: `chat/agent/route.ts` de 2.659 → <300).
- **Cobertura:** tests del motor (loop+pipeline+session) de 0 → suite significativa.

---

## 6. Decisiones abiertas para revisar

1. **Formato de Skill:** ¿`SKILL.md` con frontmatter (estilo Claude/Anthropic, mejor DX y portabilidad) o JSON/YAML puro (más fácil de validar)? *Recomendado: `SKILL.md` con frontmatter + Zod del frontmatter.*
2. **Activación `auto` de skills:** ¿heurística por keywords (simple, sin coste) o embeddings sobre `description` (mejor, requiere store)? *Recomendado: empezar heurística, evolucionar a embeddings reusando Qdrant.*
3. **Alcance de la Fase 5:** ¿mover toda la orquestación de la web al core ahora, o solo extraer un `AgentSession` mínimo y migrar incrementalmente? *Recomendado: extracción incremental.*
4. **Paralelización:** ¿un solo desarrollador secuencial (0→6) o dos pistas (visión 0–4 / hardening 6)? Afecta el calendario, no el diseño.
5. **¿Dónde implementar?** Sugiero rama `feat/loop-architecture-v2` con un PR por fase (o por vertical slice) para revisión incremental.

---

*Documento de planificación. Próximo paso: revisar §3 (arquitectura objetivo) y §6 (decisiones), y dar luz verde a la Fase 0 / primer PR (§5.4).*
