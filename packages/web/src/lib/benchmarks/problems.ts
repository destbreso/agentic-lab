import type { BenchmarkProblem } from "./types";

/* ═══════════════════════════════════════════════════
   Problem Bank — Curated problems for LLM evaluation
   ═══════════════════════════════════════════════════
   Each problem has a known "trap" that a naive LLM tends to get wrong.
   A good agentic architecture should reason through the trap.
   ═══════════════════════════════════════════════════ */

export const PROBLEM_BANK: BenchmarkProblem[] = [
  /* ── Common Sense ───────────────────────────────── */
  {
    id: "cs-car-wash",
    title: "Ir al lavadero de coches",
    prompt:
      "Tengo que lavar mi coche y hay un lavadero a dos cuadras de mi casa. ¿Es mejor que vaya en coche o que vaya a pie?",
    trap: "El LLM puede sugerir ir a pie sin pensar que el coche es lo que hay que lavar — necesitas llevarlo al lavadero.",
    expectedInsight:
      "Debes ir en coche porque el objetivo es lavar el coche, así que necesitas llevarlo al lavadero.",
    category: "common-sense",
    difficulty: "easy",
    tags: ["sentido-común", "trampa-verbal", "español"],
  },
  {
    id: "cs-umbrella",
    title: "El paraguas y el autobús",
    prompt:
      "Está lloviendo mucho. Tengo un paraguas pero también puedo tomar el autobús que para justo al lado de mi casa y me deja justo en la puerta de la oficina. ¿Debería usar el paraguas o el autobús?",
    trap: "El LLM puede comparar ambas sin darse cuenta de que no son excluyentes — puedes usar el paraguas para ir a la parada del autobús.",
    expectedInsight:
      "La mejor opción es tomar el autobús (te mantienes seco todo el trayecto) pero no necesitas elegir — puedes llevar el paraguas también por si acaso.",
    category: "common-sense",
    difficulty: "easy",
    tags: ["sentido-común", "falsa-dicotomía"],
  },
  {
    id: "cs-heavy-feather",
    title: "Kilo de plumas vs kilo de hierro",
    prompt: "¿Qué pesa más, un kilo de plumas o un kilo de hierro?",
    trap: "El LLM podría caer en la trampa clásica de decir que el hierro pesa más.",
    expectedInsight:
      "Pesan lo mismo — ambos son un kilogramo. La diferencia es el volumen, no el peso.",
    category: "logic",
    difficulty: "easy",
    tags: ["lógica", "trampa-clásica"],
  },

  /* ── Logic ──────────────────────────────────────── */
  {
    id: "logic-surgeon",
    title: "El cirujano y su hijo",
    prompt:
      "Un padre y su hijo tienen un accidente de coche. El padre muere. Llevan al hijo al hospital y el cirujano dice: 'No puedo operar, es mi hijo.' ¿Cómo es posible?",
    trap: "El LLM podría dar explicaciones rebuscadas sin pensar en la explicación más simple: el cirujano es la madre.",
    expectedInsight:
      "El cirujano es la madre del niño. El sesgo es asumir que un cirujano es siempre un hombre.",
    category: "logic",
    difficulty: "easy",
    tags: ["lógica", "sesgo", "género"],
  },
  {
    id: "logic-two-doors",
    title: "Dos puertas, dos guardianes",
    prompt:
      "Estás frente a dos puertas. Una lleva a la libertad y otra a la muerte. Hay dos guardianes: uno siempre dice la verdad y otro siempre miente. No sabes cuál es cuál. Solo puedes hacer UNA pregunta a UNO de los guardianes. ¿Qué preguntas?",
    trap: "El LLM puede dar respuestas incorrectas o directamente no encontrar la solución lógica.",
    expectedInsight:
      "Preguntas a cualquiera: '¿Qué puerta me diría el otro guardián que lleva a la libertad?' Y eliges la puerta CONTRARIA a la que señale.",
    category: "logic",
    difficulty: "hard",
    tags: ["lógica", "acertijo-clásico"],
  },
  {
    id: "logic-bat-ball",
    title: "El bate y la pelota",
    prompt:
      "Un bate y una pelota cuestan 1.10€ en total. El bate cuesta 1€ más que la pelota. ¿Cuánto cuesta la pelota?",
    trap: "La respuesta intuitiva (incorrecta) es 0.10€. La correcta es 0.05€.",
    expectedInsight:
      "La pelota cuesta 0.05€. Si la pelota cuesta X, el bate cuesta X + 1€. Entonces X + (X + 1) = 1.10, así que 2X = 0.10, X = 0.05.",
    category: "math",
    difficulty: "medium",
    tags: ["matemáticas", "trampa-cognitiva"],
  },

  /* ── Reasoning ──────────────────────────────────── */
  {
    id: "reason-monty-hall",
    title: "El problema de Monty Hall",
    prompt:
      "Estás en un concurso. Hay 3 puertas: detrás de una hay un coche y detrás de las otras dos hay cabras. Eliges la puerta 1. El presentador, que sabe lo que hay detrás de cada puerta, abre la puerta 3 y muestra una cabra. Te ofrece cambiar a la puerta 2. ¿Deberías cambiar?",
    trap: "La intuición dice que da igual (50/50). La probabilidad real favorece cambiar (2/3 vs 1/3).",
    expectedInsight:
      "Sí, deberías cambiar. Al cambiar tienes 2/3 de probabilidad de ganar. La clave es que el presentador siempre abre una puerta con cabra, lo que concentra la probabilidad.",
    category: "reasoning",
    difficulty: "hard",
    tags: ["probabilidad", "razonamiento", "contraintuitivo"],
  },
  {
    id: "reason-birthday-paradox",
    title: "La paradoja del cumpleaños",
    prompt:
      "En una habitación hay 23 personas. ¿Cuál es la probabilidad aproximada de que al menos dos personas compartan cumpleaños?",
    trap: "La intuición dice que debería ser muy baja (~6%). La realidad es que es ~50%.",
    expectedInsight:
      "Aproximadamente 50%. Se calcula considerando los pares posibles (253 pares en 23 personas), no las personas individuales vs 365 días.",
    category: "reasoning",
    difficulty: "medium",
    tags: ["probabilidad", "paradoja", "matemáticas"],
  },
  {
    id: "reason-survivorship",
    title: "Sesgo de supervivencia en aviones",
    prompt:
      "Durante la Segunda Guerra Mundial, analizaron los aviones que volvieron de misiones y vieron que tenían muchos impactos en las alas y la cola, pero pocos en el motor y la cabina. ¿Dónde deberían reforzar el blindaje?",
    trap: "La intuición dice reforzar donde hay más impactos (alas/cola). Pero esos aviones VOLVIERON — los que recibieron impactos en el motor NO volvieron.",
    expectedInsight:
      "Deben reforzar el motor y la cabina — donde NO hay impactos — porque los aviones con impactos ahí no sobrevivieron para ser analizados. Es el sesgo de supervivencia.",
    category: "reasoning",
    difficulty: "hard",
    tags: ["sesgo-supervivencia", "razonamiento", "historia"],
  },

  /* ── Ambiguity ──────────────────────────────────── */
  {
    id: "ambig-time-flies",
    title: "Time flies like an arrow",
    prompt:
      "Traduce y explica la frase 'Time flies like an arrow; fruit flies like a banana'. ¿Cuántas interpretaciones tiene?",
    trap: "El LLM puede no detectar el juego de palabras donde 'flies' cambia de verbo a sustantivo y 'like' de preposición a verbo.",
    expectedInsight:
      "La frase juega con la ambigüedad: 'Time flies like an arrow' = El tiempo vuela como una flecha. 'Fruit flies like a banana' = Las moscas de la fruta les gusta el plátano (no 'la fruta vuela como un plátano').",
    category: "ambiguity",
    difficulty: "medium",
    tags: ["ambigüedad", "lenguaje", "inglés"],
  },
  {
    id: "ambig-trolley",
    title: "El dilema del trolley modificado",
    prompt:
      "Un tren descontrolado va a atropellar a 5 personas. Puedes desviar el tren a otra vía donde hay 1 persona. PERO esa persona es un médico que mañana va a operar y salvar a 10 personas. ¿Qué haces?",
    trap: "El LLM puede responder mecánicamente con utilitarismo simple sin considerar la complejidad añadida del médico.",
    expectedInsight:
      "No hay respuesta 'correcta'. Lo importante es que el modelo reconozca la complejidad: utilitarismo a corto plazo (salvar 5) vs largo plazo (salvar 10 via el médico), incertidumbre de la operación futura, y el dilema moral de elegir activamente.",
    category: "ambiguity",
    difficulty: "hard",
    tags: ["ética", "dilema-moral", "complejidad"],
  },

  /* ── Coding ─────────────────────────────────────── */
  {
    id: "code-fizzbuzz-twist",
    title: "FizzBuzz con trampa",
    prompt:
      "Implementa FizzBuzz del 1 al 100 pero con un twist: si un número contiene el dígito 3 (como 13, 31, 33), trata ese número como si fuera divisible por 3 ADEMÁS de las reglas normales. Ejemplo: 13 no es divisible por 3, pero contiene un 3 así que imprime 'Fizz'. 15 sería 'FizzBuzz' normalmente, y 35 también debería ser 'FizzBuzz' (contiene 3 + divisible por 5).",
    trap: "El LLM puede simplemente modificar la condición de divisibilidad sin manejar correctamente la combinación de ambas reglas.",
    expectedInsight:
      "La solución debe combinar dos condiciones para Fizz: divisible por 3 OR contiene dígito 3. Buzz sigue siendo solo divisible por 5. FizzBuzz cuando ambas se cumplen.",
    category: "coding",
    difficulty: "medium",
    tags: ["programación", "lógica", "variación"],
  },
  {
    id: "code-off-by-one",
    title: "Error de cercas",
    prompt:
      "Tienes que construir una valla recta de 100 metros usando postes separados por 10 metros. ¿Cuántos postes necesitas?",
    trap: "La respuesta intuitiva es 10 postes (100/10). La correcta es 11 (error clásico off-by-one / error de postes de cercas).",
    expectedInsight:
      "Necesitas 11 postes. Con 10 secciones de 10m necesitas un poste al inicio y otro al final de cada sección, lo que da 10 + 1 = 11.",
    category: "math",
    difficulty: "easy",
    tags: ["off-by-one", "matemáticas", "programación"],
  },
];

/** Get all problems */
export function getProblems(): BenchmarkProblem[] {
  return PROBLEM_BANK;
}

/** Get problems by category */
export function getProblemsByCategory(
  category: BenchmarkProblem["category"],
): BenchmarkProblem[] {
  return PROBLEM_BANK.filter((p) => p.category === category);
}

/** Get a single problem by id */
export function getProblemById(id: string): BenchmarkProblem | undefined {
  return PROBLEM_BANK.find((p) => p.id === id);
}
