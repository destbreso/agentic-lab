// ============================================
// Public datasets as task sets: HumanEval and GSM8K, from their original repositories
// ============================================
// A dataset is fetched from where its authors publish it, never from a copy,
// and becomes an ordinary task set: the files each task starts from, a check
// the lab runs, and a check file only the checks can see. A hidden check
// says whether the work passed and never prints what it compares against, so
// a role that hears the checks on a way back learns that it failed, not the
// answer.

export type DatasetId = "humaneval" | "gsm8k";

export interface Dataset {
  id: DatasetId;
  name: string;
  /** The raw file, at its authors' repository. */
  url: string;
  /** Where the licence is stated. */
  licenseUrl: string;
  license: string;
  gzip: boolean;
  /** The task set's description. */
  describe: (selection: string) => string;
  /** One record of the file, at its 0-based line, as a task of a task set file (snake_case keys). */
  toTask: (record: Record<string, unknown>, index: number) => Record<string, unknown>;
}

const py = (lines: string[]) => `${lines.join("\n")}\n`;

/**
 * HumanEval's check. The solution runs with its output sent nowhere, so nothing
 * it prints (a test file it read, an expected value its __eq__ saw) reaches a
 * role; any exception, SystemExit included, is a failure, reported by its type
 * and its line in solution.py only. The harness's own names start with an
 * underscore, so the solution's names, copied in as `from solution import *`
 * would, never replace them. Left open: a solution calling os._exit(0) itself.
 */
function humanevalCheck(entry: string, test: string): string {
  return py([
    "import importlib.util as _ilu, os as _os, sys as _sys, traceback as _tb",
    "_verdict = _os.fdopen(_os.dup(1), 'w')",
    "_null = _os.open(_os.devnull, _os.O_WRONLY)",
    "_os.dup2(_null, 1)",
    "_os.dup2(_null, 2)",
    "",
    "def _fail(line):",
    "    _verdict.write(line + '\\n')",
    "    _verdict.flush()",
    "    _os._exit(1)",
    "",
    "def _where(e):",
    "    for frame in reversed(_tb.extract_tb(e.__traceback__)):",
    "        if _os.path.basename(frame.filename) == 'solution.py':",
    "            return ' at solution.py line ' + str(frame.lineno)",
    "    return ''",
    "",
    "try:",
    "    _spec = _ilu.spec_from_file_location('solution', _os.path.join(_os.getcwd(), 'solution.py'))",
    "    _solution = _ilu.module_from_spec(_spec)",
    "    _sys.modules['solution'] = _solution",
    "    _spec.loader.exec_module(_solution)",
    "except BaseException as e:",
    // A syntax error the parser found says where and what; one the code raised itself says only its type.
    "    if isinstance(e, SyntaxError) and not _where(e):",
    "        _fail('solution.py could not be imported: SyntaxError at line ' + str(e.lineno) + ': ' + str(e.msg))",
    "    _fail('solution.py could not be imported: ' + type(e).__name__ + _where(e))",
    "",
    // A test may call the file's other functions (HumanEval/32 calls poly).
    "_names = getattr(_solution, '__all__', None) or [k for k in vars(_solution) if not k.startswith('_')]",
    "globals().update({k: getattr(_solution, k) for k in _names if hasattr(_solution, k)})",
    `if not callable(getattr(_solution, ${JSON.stringify(entry)}, None)):`,
    `    _fail(${JSON.stringify(`solution.py has no function ${entry}`)})`,
    "",
    test.trimEnd(),
    "",
    "try:",
    `    check(getattr(_solution, ${JSON.stringify(entry)}))`,
    "except AssertionError:",
    `    _fail(${JSON.stringify(`a test of ${entry} did not pass`)})`,
    "except BaseException as e:",
    `    _fail(${JSON.stringify(`${entry} raised `)} + type(e).__name__ + _where(e))`,
    "_verdict.write('the tests passed\\n')",
    "_verdict.flush()",
    "_os._exit(0)",
  ]);
}

const humaneval: Dataset = {
  id: "humaneval",
  name: "HumanEval",
  url: "https://raw.githubusercontent.com/openai/human-eval/master/data/HumanEval.jsonl.gz",
  licenseUrl: "https://github.com/openai/human-eval/blob/master/LICENSE",
  license: "MIT",
  gzip: true,
  describe: (selection) => `HumanEval (OpenAI, MIT): Python functions to complete from their signature and docstring, each checked by the dataset's own hidden tests. ${selection}.`,
  toTask: (r) => {
    const id = String(r.task_id);
    const entry = String(r.entry_point);
    const prompt = String(r.prompt);
    const test = String(r.test);
    return {
      id: `humaneval-${id.split("/").pop()}`,
      task: `Complete the function \`${entry}\` in solution.py so that it does what its docstring says. Keep its name and signature, and keep the rest of the file.`,
      files: { "solution.py": `${prompt}    raise NotImplementedError\n` },
      // -I: the workspace's own modules never shadow the standard library inside the check.
      checks: [{ name: "the dataset's tests", command: "python3 -I check_solution.py" }],
      check_files: [{ path: "check_solution.py", content: humanevalCheck(entry, test) }],
      direct: { file: "solution.py" },
      tags: ["code", "python", "humaneval"],
    };
  },
};

/** GSM8K's answer is the number after its last "####". */
export function gsm8kAnswer(answer: string): string {
  const tail = answer.split("####").pop()!.trim();
  return tail.replace(/,/g, "");
}

const gsm8k: Dataset = {
  id: "gsm8k",
  name: "GSM8K",
  url: "https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl",
  licenseUrl: "https://github.com/openai/grade-school-math/blob/master/LICENSE",
  license: "MIT",
  gzip: false,
  describe: (selection) => `GSM8K (OpenAI, MIT): grade-school math word problems, each with one numeric answer, checked exactly against the dataset's answer, which no role sees. ${selection}.`,
  toTask: (r, index) => {
    const expected = gsm8kAnswer(String(r.answer));
    return {
      id: `gsm8k-${index}`,
      task: `${String(r.question).trim()}\n\nWork it out step by step. Then write your final answer to answer.txt: the number alone.`,
      // -I: an answer folder's own decimal.py or re.py is never imported by the check.
      checks: [{ name: "the answer", command: "python3 -I check_answer.py" }],
      check_files: [
        {
          path: "check_answer.py",
          content: py([
            "import re, sys",
            "from decimal import Decimal, InvalidOperation",
            `EXPECTED = Decimal("${expected}")`,
            "try:",
            '    text = open("answer.txt").read()',
            "except FileNotFoundError:",
            '    print("answer.txt was not written")',
            "    sys.exit(1)",
            // Thousands separators only in groups of three, and a decimal may start at its point (.5).
            'numbers = re.findall(r"-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?|-?\\.\\d+", text)',
            "if not numbers:",
            '    print("answer.txt holds no number")',
            "    sys.exit(1)",
            "try:",
            '    found = Decimal(numbers[-1].replace(",", ""))',
            "except InvalidOperation:",
            '    print("answer.txt\'s last number could not be read")',
            "    sys.exit(1)",
            "if found == EXPECTED:",
            '    print("the answer is right")',
            "    sys.exit(0)",
            'print("answer.txt\'s last number, " + str(found) + ", is not the expected answer")',
            "sys.exit(1)",
          ]),
        },
      ],
      direct: { answer_file: "answer.txt" },
      tags: ["reasoning", "math", "gsm8k"],
    };
  },
};

export const DATASETS: Record<DatasetId, Dataset> = { humaneval, gsm8k };
