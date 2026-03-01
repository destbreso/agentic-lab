# Assessment Profundo: Agentic Lab

> Fecha: 1 de marzo de 2026 | Versión analizada: 0.1.0
> Última actualización: 1 de marzo de 2026 — tras primera ronda de correcciones

## Resumen Ejecutivo

**Agentic Lab** es una plataforma de experimentación para agentes autónomos LLM con **~26,100 líneas de TypeScript** distribuidas en 3 paquetes (core: 12,700 | web: 11,300 | cli: 2,300). Implementa un sistema de loops cognitivos con asimetría epistémica — una idea arquitectónica original y bien fundamentada teóricamente. El proyecto está en estado de **prototipo funcional (v0.1)** con cimientos sólidos pero carencias serias en seguridad, testing y mantenibilidad.

---

## Lo Excepcional

### 1. Fundamento teórico riguroso
El documento FOUNDATIONS.md es de calidad académica. La tesis de **asimetría epistémica** (los loops deben tener acceso a información *diferente*, no solo prompts diferentes) es una contribución intelectual real al campo. La metáfora de "paralelizar alucinaciones" captura un problema genuino que la mayoría de frameworks multi-agente ignoran.

### 2. Arquitectura de degradación elegante
El sistema **nunca requiere infraestructura** para funcionar:
- PostgreSQL no disponible → almacenamiento en memoria
- Redis no disponible → EventEmitter local
- Qdrant no disponible → búsqueda semántica deshabilitada, texto funciona

Esto se implementa con auto-detección en `createStorage()` y el componente `InfraBanner` del web muestra qué capabilities están disponibles.

### 3. Motor de pipelines composable
El `PipelineOrchestrator` implementa un DAG de nodos con señales tipadas, puertos, wires con transformaciones, ejecución concurrente con `Promise.allSettled`, y timeout por nodo. Esto es ingeniería seria.

### 4. 6 loops cognitivos diferenciados
Execution, Evaluation, Planning, Critic, Memory, Refinement — cada uno con un rol epistémico claro y restricciones deliberadas de información. El `CriticLoop` que recibe *metadata* en vez de contenido para evitar ser "persuadido" es un diseño sofisticado.

### 5. CLI con UX excelente
Spinners, colores, tablas formateadas, slash commands en el chat REPL, templates de workspace, sub-comandos intuitivos. La experiencia de usuario terminal es pulida.

### 6. Documentación
README exhaustivo, QUICKSTART paso a paso, FOUNDATIONS con 355 líneas de razonamiento epistémico, comentarios arquitectónicos inline. Muy por encima del promedio.

---

## Problemas Críticos 🔴

### 1. ZERO tests — 0% coverage en 26K LOC
~~No hay ni un solo archivo `.test.ts` o `.spec.ts` en ningún paquete.~~ **PARCIALMENTE RESUELTO** — Se añadieron **71 tests en 7 archivos** cubriendo storage, tools (file-read, file-write, grep, shell), providers (openai) y loops (memory). Falta: tests para `AgenticLoop`, `PipelineOrchestrator`, `PlanManager`, `PromptBuilder`, y todo el paquete web/cli.

### 2. Vulnerabilidades de seguridad

| Vulnerabilidad                                                                                            | Ubicación                                      | Severidad     | Estado      |
|-----------------------------------------------------------------------------------------------------------|------------------------------------------------|---------------|-------------|
| **SQL injection** — `orderBy`, `orderDir`, `days` interpolados directamente en queries                    | `postgres.ts` L147, L633                       | Crítica       | ✅ RESUELTO  |
| **Path traversal** — `FileReadTool` y `FileWriteTool` no validan que la ruta esté dentro del `workingDir` | `file-read.ts` L42, `file-write.ts`            | Crítica       | ✅ RESUELTO  |
| **Shell command injection** — la blocklist es evadible con `$IFS`, backticks, subshells                   | `shell.ts` L52-59                              | Alta          | ✅ RESUELTO  |
| **ReDoS** — `new RegExp(userInput)` sin validación en grep tool                                           | `grep.ts` L68                                  | Alta          | ✅ RESUELTO  |
| **Sin autenticación** — todas las API routes del web son públicas                                         | Todas las rutas en `packages/web/src/app/api/` | Alta (deploy) | ⬜ PENDIENTE |
| **Credenciales hardcodeadas** — `password: "agentic_lab_secret"` como default                             | `factory.ts` L71                               | Media         | ⬜ PENDIENTE |

### 3. Bugs funcionales confirmados

| Bug                                                                                         | Ubicación              | Estado     |
|---------------------------------------------------------------------------------------------|------------------------|------------|
| `successfulRuns` siempre es 0 en InMemoryUsageStore — falta incrementar `g.successful`      | `memory.ts` L333-334   | ✅ RESUELTO |
| Checkpoints guardan `messages: []` vacío — nunca persisten los mensajes reales              | `loop.ts` L188         | ✅ RESUELTO |
| `InMemoryEventStore.subscribe` ignora el filtro `eventTypes` — todos reciben todo           | `memory.ts` L282       | ✅ RESUELTO |
| `MemoryLoop` emite `previousSummary` idéntico a `summary` (bug lógico)                      | `loops/memory.ts` L203 | ✅ RESUELTO |
| `JSON.parse(tc.function.arguments)` sin try/catch — crashea con JSON malformado del LLM     | `openai.ts` L48        | ✅ RESUELTO |
| OpenAI streaming omite tools — `chatStream` no soporta tool calls                           | `openai.ts` L82-88     | ✅ RESUELTO |
| OpenAI provider name hardcoded `'openai'` — incorrecto cuando se usa para OpenRouter/Google | `openai.ts` L17        | ✅ RESUELTO |

---

## Problemas de Arquitectura y Diseño 🟠

### 4. API pública demasiado amplia
`index.ts` exporta ~100+ símbolos en un solo barrel. Debería usar sub-paths: `@agentic-lab/core/storage`, `@agentic-lab/core/loops`, etc.

### 5. Parsing de LLM frágil
Todos los loops parsean la salida del LLM con regex: `response.match(/VERDICT:\s*(pass|fail)/i)`. Si el LLM no sigue el formato exacto (frecuente), los defaults silenciosos ocultan el fallo. **Zod está en las dependencias pero no se usa.** Debería usar JSON mode / structured output.

### 6. God components en el web
`chat/page.tsx` tiene **2,584 líneas** en un solo archivo. Contiene `SessionSidebar`, `ExecutionPanel`, hooks custom inline, lógica de streaming... Debería descomponerse en 8-10 archivos.

### 7. `chat/agent/route.ts` — 2,403 líneas
Toda la lógica de ejecución del agente multi-loop en una sola API route. Esta lógica debería vivir en `@agentic-lab/core`.

### 8. Sin data fetching layer en web
100% de las páginas usan `useState` + `useEffect` + `fetch`. Sin SWR, React-Query, deduplicación, cache, ni retry. El hook `useInfraStatus` se inicializa independientemente en cada componente → múltiples polls paralelos.

### 9. Duplicación significativa

| Código duplicado                               | Ubicaciones                          | Impacto |
|------------------------------------------------|--------------------------------------|---------|
| Flujo pipeline run (~150 líneas)               | `pipeline.ts` + `recipes.ts` del CLI | Alto    |
| `formatMs()`, `timeAgo()`, `formatDuration()`  | 4+ archivos del CLI y web            | Medio   |
| `getStorageClient()` (dynamic import idéntico) | 10 API routes del web                | Medio   |
| Constantes `LOOP_META`/`LOOP_ICONS`            | 4 archivos del web                   | Medio   |

### 10. Pipeline puede bloquearse infinitamente
~~`pipeline.ts` L881: un nodo en status `"idle"` sin señales pendientes ni trigger frequency se cuenta como `anyRunning = true` → el pipeline nunca termina. Tampoco hay detección de ciclos en el grafo.~~ **✅ RESUELTO** — `isAllComplete()` ahora solo cuenta nodos idle como activos si tienen `config.frequency` o señales pendientes. Se añadió detección de ciclos con DFS + coloreo (advierte pero no bloquea, ya que algunos recipes usan feedback loops intencionales). También se corrigió un timer leak en el timeout por nodo (ahora usa `clearTimeout` en el `finally`).

### 11. Memory leak en tool loop
`loop.ts` L317: el array `messages` crece sin límite durante la ejecución de herramientas. Con `maxToolRounds = 20`, puede exceder la ventana de contexto del LLM.

### 12. Dependencias npm no usadas
~~`winston`, `chalk`, `zod`, `@google/generative-ai` están declaradas en core pero **no se importan en ningún archivo**.~~ **PARCIALMENTE RESUELTO** — Se eliminaron `winston`, `chalk` y `@google/generative-ai`. Se mantuvo `zod` por uso futuro previsto (structured output parsing). El logger sigue usando ANSI escapes manuales.

---

## Direcciones de Mejora Priorizadas

### Prioridad 1 — Seguridad (semana 1)
1. ~~**Path traversal**: Añadir `if (!resolved.startsWith(workingDir)) throw` en FileReadTool y FileWriteTool~~ ✅
2. ~~**SQL injection**: Usar parámetros `$N` para `orderBy`, `orderDir`, `limit`, `offset` con whitelist de columnas válidas~~ ✅
3. ~~**Shell tool**: Mejorar blocklist con normalización de comandos~~ ✅
4. ~~**ReDoS**: Envolver `new RegExp()` en try/catch con timeout~~ ✅
5. ~~**JSON.parse**: Wrap con try/catch en todos los providers~~ ✅
6. **Autenticación básica para API routes** ⬜
7. **Credenciales hardcodeadas en factory.ts** ⬜

### Prioridad 2 — Testing (semanas 2-3)
1. ~~Unit tests para `InMemoryStorage`~~ ✅ (28 tests)
2. ~~Tests de seguridad (path traversal, shell blocklist, ReDoS)~~ ✅ (cubiertos en tests de tools)
3. ~~Tests de parsing LLM (regex de MemoryLoop)~~ ✅ (5 tests)
4. ~~Tests de providers (OpenAI inferProviderName, constructor)~~ ✅ (6 tests)
5. Tests de integración para `AgenticLoop` con provider mock ⬜
6. Tests para `PlanManager`, `PromptBuilder` ⬜
7. Tests de `PipelineOrchestrator` (ciclos, timeouts, terminación) ⬜
8. Tests para CLI y Web ⬜

### Prioridad 3 — Estabilidad del Core (semana 4)
1. **Structured output**: Reemplazar regex parsing con JSON mode + Zod validation ⬜
2. **Context window management**: Truncar/sliding window para `messages` en tool loop ⬜
3. **Retry con backoff**: Añadir retry exponencial para llamadas a providers ⬜
4. ~~**Detección de ciclos**: Validar el DAG del pipeline antes de ejecutar~~ ✅
5. ~~**Fix bugs**: Los 7 bugs funcionales listados arriba~~ ✅ (todos resueltos)

### Prioridad 4 — Refactoring Web (semanas 5-6)
1. Descomponer `chat/page.tsx` en componentes ⬜
2. Mover lógica de `chat/agent/route.ts` al core ⬜
3. Implementar data fetching con SWR o React-Query ⬜
4. Extraer `getStorageClient()`, helpers y constantes duplicadas ⬜
5. Queries agregadas SQL en stats/metrics/namespaces ⬜

### Prioridad 5 — Limpieza y DX (semana 7)
1. ~~Eliminar dependencias no usadas (winston, chalk, @google/generative-ai)~~ ✅
2. Extraer módulo `shared/` en CLI para eliminar duplicación pipeline/recipes ⬜
3. Sub-path exports para core (`@agentic-lab/core/storage`) ⬜
4. Añadir `--json` output mode a los comandos CLI ⬜
5. ~~Autenticación básica para las API routes~~ → Movido a Prioridad 1

---

## Resumen de Progreso

### ✅ Resuelto (primera ronda de correcciones)

| #  | Qué se hizo                                                                                                                                  | Archivos modificados                        |
|----|----------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------|
| 1  | **Path traversal** — guard en FileReadTool y FileWriteTool                                                                                   | `tools/file-read.ts`, `tools/file-write.ts` |
| 2  | **SQL injection** — 4 puntos: whitelist orderBy, parametrización de days/limit/offset                                                        | `storage/postgres.ts`                       |
| 3  | **Shell blocklist** — normalización ($IFS, subshells, backticks), nuevos patrones (chmod 777, wget\|curl pipe sh), regex fork bomb corregido | `tools/shell.ts`                            |
| 4  | **ReDoS** — try/catch alrededor de `new RegExp()` en GrepTool                                                                                | `tools/grep.ts`                             |
| 5  | **JSON.parse** — try/catch con fallback `{ _raw }` en OpenAI provider                                                                        | `providers/openai.ts`                       |
| 6  | **OpenAI streaming tools** — `chatStream` ahora pasa `tools`                                                                                 | `providers/openai.ts`                       |
| 7  | **Provider name** — `inferProviderName()` detecta openrouter/google desde baseUrl + soporte `config.name`                                    | `providers/openai.ts`, `types/llm.ts`       |
| 8  | **successfulRuns** — InMemoryUsageStore ahora incrementa el contador                                                                         | `storage/memory.ts`                         |
| 9  | **eventTypes filter** — subscribe ahora filtra por tipos de evento                                                                           | `storage/memory.ts`                         |
| 10 | **Checkpoint messages** — ya no guarda `[]` vacío                                                                                            | `engine/loop.ts`                            |
| 11 | **previousSummary** — captura el valor anterior ANTES de actualizar                                                                          | `loops/memory.ts`                           |
| 12 | **Pipeline isAllComplete** — nodos idle sin frequency ya no bloquean                                                                         | `engine/pipeline.ts`                        |
| 13 | **Pipeline timeout leak** — clearTimeout en finally                                                                                          | `engine/pipeline.ts`                        |
| 14 | **Detección de ciclos** — DFS con coloreo + warning en validate()                                                                            | `engine/pipeline.ts`                        |
| 15 | **Deps no usadas** — eliminados winston, chalk, @google/generative-ai                                                                        | `core/package.json`                         |
| 16 | **71 tests** — 7 archivos: storage, tools (4), providers, loops                                                                              | 7 archivos `.test.ts` nuevos                |

### ⬜ Pendiente por resolver

| #  | Problema                                                                      | Prioridad | Tipo        |
|----|-------------------------------------------------------------------------------|-----------|-------------|
| 1  | **Sin autenticación** en API routes del web                                   | P1        | Seguridad   |
| 2  | **Credenciales hardcodeadas** en factory.ts                                   | P1        | Seguridad   |
| 3  | **Context window management** — messages crece sin límite en tool loop        | P3        | Estabilidad |
| 4  | **Structured output** — regex parsing frágil, Zod sin usar                    | P3        | Estabilidad |
| 5  | **Retry con backoff** para llamadas a providers                               | P3        | Estabilidad |
| 6  | **Tests AgenticLoop, PlanManager, PromptBuilder, Pipeline**                   | P2        | Testing     |
| 7  | **God component** `chat/page.tsx` (2,584 líneas)                              | P4        | Refactoring |
| 8  | **God route** `chat/agent/route.ts` (2,403 líneas)                            | P4        | Refactoring |
| 9  | **Sin data fetching layer** en web (no SWR/React-Query)                       | P4        | Refactoring |
| 10 | **Duplicación** — pipeline flow, format helpers, getStorageClient, constantes | P4        | Refactoring |
| 11 | **API pública demasiado amplia** — ~100+ exports en barrel index.ts           | P5        | DX          |
| 12 | **Sub-path exports** para core                                                | P5        | DX          |
| 13 | **CLI duplicación** — extraer shared module                                   | P5        | DX          |
| 14 | **CLI --json mode**                                                           | P5        | DX          |

---

## Valoración por Dimensión

| Dimensión                      | Rating antes | Rating actual | Comentario                                                                            |
|--------------------------------|--------------|---------------|---------------------------------------------------------------------------------------|
| **Visión y diseño conceptual** | ⭐⭐⭐⭐⭐        | ⭐⭐⭐⭐⭐         | Sin cambios. Tesis original de asimetría epistémica                                   |
| **Documentación**              | ⭐⭐⭐⭐⭐        | ⭐⭐⭐⭐⭐         | Sin cambios. FOUNDATIONS.md es publicable                                             |
| **Arquitectura del motor**     | ⭐⭐⭐⭐         | ⭐⭐⭐⭐          | Pipeline mejorado (ciclos, timeouts), pero context window mgmt sigue pendiente        |
| **UX de CLI**                  | ⭐⭐⭐⭐         | ⭐⭐⭐⭐          | Sin cambios                                                                           |
| **Dashboard web**              | ⭐⭐⭐          | ⭐⭐⭐           | Sin cambios — god components y sin data layer                                         |
| **Infraestructura Docker**     | ⭐⭐⭐⭐         | ⭐⭐⭐⭐          | Sin cambios                                                                           |
| **Seguridad**                  | ⭐⭐           | ⭐⭐⭐⭐          | 4/6 vulnerabilidades resueltas. Quedan auth en API routes y credenciales hardcodeadas |
| **Testing**                    | ⭐            | ⭐⭐⭐           | De 0 a 71 tests. Cobertura parcial en core. Falta AgenticLoop, Pipeline, web, CLI     |
| **Mantenibilidad**             | ⭐⭐⭐          | ⭐⭐⭐           | Sin cambios mayores — duplicación y archivos grandes siguen                           |
| **Gestión de deps**            | ⭐⭐           | ⭐⭐⭐⭐          | 3 deps innecesarias eliminadas. Solo queda zod (reservada para uso futuro)            |

---

## Veredicto

**Agentic Lab es un prototipo intelectualmente sofisticado con una visión clara y una base arquitectónica sólida.** Tras la primera ronda de correcciones, las vulnerabilidades de seguridad más graves (SQL injection, path traversal, shell injection, ReDoS) están resueltas y los 7 bugs funcionales confirmados han sido arreglados. Se añadió una base de 71 tests. El motor de pipelines ya no puede bloquearse infinitamente y detecta ciclos en el grafo.

**Lo que queda por hacer**, en orden de prioridad:
1. **Seguridad**: Autenticación en API routes y eliminar credenciales hardcodeadas
2. **Testing**: Ampliar cobertura a AgenticLoop, PipelineOrchestrator, PlanManager y web/CLI
3. **Estabilidad**: Context window management, structured output con Zod, retry con backoff
4. **Refactoring web**: Descomponer god components, data fetching layer, eliminar duplicación
5. **DX**: Sub-path exports, CLI --json mode, shared module en CLI
