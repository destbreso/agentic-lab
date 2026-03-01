# Assessment Profundo: Agentic Lab

> Fecha: 1 de marzo de 2026 | Versión analizada: 0.1.0

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
No hay ni un solo archivo `.test.ts` o `.spec.ts` en ningún paquete. `vitest` está configurado pero sin tests. Con lógica de state machines, parsing de LLM, SQL queries, y ejecución de comandos shell, esto es un riesgo inaceptable.

### 2. Vulnerabilidades de seguridad

| Vulnerabilidad                                                                                            | Ubicación                                      | Severidad     |
|-----------------------------------------------------------------------------------------------------------|------------------------------------------------|---------------|
| **SQL injection** — `orderBy`, `orderDir`, `days` interpolados directamente en queries                    | `postgres.ts` L147, L633                       | Crítica       |
| **Path traversal** — `FileReadTool` y `FileWriteTool` no validan que la ruta esté dentro del `workingDir` | `file-read.ts` L42, `file-write.ts`            | Crítica       |
| **Shell command injection** — la blocklist es evadible con `$IFS`, backticks, subshells                   | `shell.ts` L52-59                              | Alta          |
| **ReDoS** — `new RegExp(userInput)` sin validación en grep tool                                           | `grep.ts` L68                                  | Alta          |
| **Sin autenticación** — todas las API routes del web son públicas                                         | Todas las rutas en `packages/web/src/app/api/` | Alta (deploy) |
| **Credenciales hardcodeadas** — `password: "agentic_lab_secret"` como default                             | `factory.ts` L71                               | Media         |

### 3. Bugs funcionales confirmados

| Bug                                                                                         | Ubicación              |
|---------------------------------------------------------------------------------------------|------------------------|
| `successfulRuns` siempre es 0 en InMemoryUsageStore — falta incrementar `g.successful`      | `memory.ts` L333-334   |
| Checkpoints guardan `messages: []` vacío — nunca persisten los mensajes reales              | `loop.ts` L188         |
| `InMemoryEventStore.subscribe` ignora el filtro `eventTypes` — todos reciben todo           | `memory.ts` L282       |
| `MemoryLoop` emite `previousSummary` idéntico a `summary` (bug lógico)                      | `loops/memory.ts` L203 |
| `JSON.parse(tc.function.arguments)` sin try/catch — crashea con JSON malformado del LLM     | `openai.ts` L48        |
| OpenAI streaming omite tools — `chatStream` no soporta tool calls                           | `openai.ts` L82-88     |
| OpenAI provider name hardcoded `'openai'` — incorrecto cuando se usa para OpenRouter/Google | `openai.ts` L17        |

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
`pipeline.ts` L881: un nodo en status `"idle"` sin señales pendientes ni trigger frequency se cuenta como `anyRunning = true` → el pipeline nunca termina. Tampoco hay detección de ciclos en el grafo.

### 11. Memory leak en tool loop
`loop.ts` L317: el array `messages` crece sin límite durante la ejecución de herramientas. Con `maxToolRounds = 20`, puede exceder la ventana de contexto del LLM.

### 12. Dependencias npm no usadas
`winston`, `chalk`, `zod`, `@google/generative-ai` están declaradas en core pero **no se importan en ningún archivo**. El logger usa ANSI escapes manuales.

---

## Direcciones de Mejora Priorizadas

### Prioridad 1 — Seguridad (semana 1)
1. **Path traversal**: Añadir `if (!resolved.startsWith(workingDir)) throw` en FileReadTool y FileWriteTool
2. **SQL injection**: Usar parámetros `$N` para `orderBy`, `orderDir`, `limit`, `offset` con whitelist de columnas válidas
3. **Shell tool**: Mejorar blocklist con normalización de comandos
4. **ReDoS**: Envolver `new RegExp()` en try/catch con timeout
5. **JSON.parse**: Wrap con try/catch en todos los providers

### Prioridad 2 — Testing (semanas 2-3)
1. Unit tests para `PlanManager`, `PromptBuilder`, `InMemoryStorage`
2. Tests de integración para `AgenticLoop` con provider mock
3. Tests de seguridad (path traversal, SQL injection)
4. Tests de parsing LLM (regex de cada loop)
5. Tests de `PipelineOrchestrator` (ciclos, timeouts, terminación)

### Prioridad 3 — Estabilidad del Core (semana 4)
1. **Structured output**: Reemplazar regex parsing con JSON mode + Zod validation
2. **Context window management**: Truncar/sliding window para `messages` en tool loop
3. **Retry con backoff**: Añadir retry exponencial para llamadas a providers
4. **Detección de ciclos**: Validar el DAG del pipeline antes de ejecutar
5. **Fix bugs**: Los 7 bugs funcionales listados arriba

### Prioridad 4 — Refactoring Web (semanas 5-6)
1. Descomponer `chat/page.tsx` en componentes
2. Mover lógica de `chat/agent/route.ts` al core
3. Implementar data fetching con SWR o React-Query
4. Extraer `getStorageClient()`, helpers y constantes duplicadas
5. Queries agregadas SQL en stats/metrics/namespaces

### Prioridad 5 — Limpieza y DX (semana 7)
1. Eliminar dependencias no usadas (winston, chalk, zod sin usar, @google/generative-ai)
2. Extraer módulo `shared/` en CLI para eliminar duplicación pipeline/recipes
3. Sub-path exports para core (`@agentic-lab/core/storage`)
4. Añadir `--json` output mode a los comandos CLI
5. Autenticación básica para las API routes

---

## Valoración por Dimensión

| Dimensión                      | Rating | Comentario                                                               |
|--------------------------------|--------|--------------------------------------------------------------------------|
| **Visión y diseño conceptual** | ⭐⭐⭐⭐⭐  | Tesis original de asimetría epistémica. Arquitectura con propósito claro |
| **Documentación**              | ⭐⭐⭐⭐⭐  | FOUNDATIONS.md es publicable. README exhaustivo. Comentarios excelentes  |
| **Arquitectura del motor**     | ⭐⭐⭐⭐   | Pipeline DAG composable, señales tipadas, degradación elegante           |
| **UX de CLI**                  | ⭐⭐⭐⭐   | Pulida, intuitiva, con feedback visual rico                              |
| **Dashboard web**              | ⭐⭐⭐    | Funcional pero con god components y sin data layer                       |
| **Infraestructura Docker**     | ⭐⭐⭐⭐   | Bien diseñada con perfiles dev/full/minimal, health checks               |
| **Seguridad**                  | ⭐⭐     | Path traversal, SQL injection, shell injection, sin auth                 |
| **Testing**                    | ⭐      | 0 tests en 26K LOC                                                       |
| **Mantenibilidad**             | ⭐⭐⭐    | Duplicación significativa, archivos de 2K+ líneas                        |
| **Gestión de deps**            | ⭐⭐     | 4 dependencias declaradas pero sin usar                                  |

---

## Veredicto

**Agentic Lab es un prototipo intelectualmente sofisticado con una visión clara y una base arquitectónica sólida, pero con carencias serias en las disciplinas de ingeniería que separan un prototipo de software confiable.** El fundamento teórico (FOUNDATIONS.md) y el diseño del motor composable son de calidad excepcional. Los problemas de seguridad y la ausencia total de tests son los bloqueadores más urgentes. Con 2-3 semanas de hardening enfocado en las prioridades 1-3, el proyecto estaría en posición de aceptar contribuciones externas o usarse como herramienta de investigación confiable.
