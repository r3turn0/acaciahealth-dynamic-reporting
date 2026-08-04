/**
 * lib/ai/apcs/PromptCompactor.ts
 *
 * Advanced Prompt Compaction System — Core Engine (Layers 1–5)
 *
 * Layer 1  — Prompt Normalization     (remove duplicates, normalize SQL/whitespace)
 * Layer 2  — Dictionary Substitution  (reusable prompt block references)
 * Layer 3  — Semantic Macros          (expand @MACRO tags to structured instructions)
 * Layer 4  — Prompt AST               (structured intent object → minimal string)
 * Layer 5  — SQL Template Compression (parameterize boilerplate SQL patterns)
 *
 * Design contract:
 *   compact(prompt)  → CompactResult  (tokens reduced, references inserted)
 *   expand(compact)  → string          (lossless original reconstruction)
 *
 * IMPORTANT: This module is server-side only. It holds no secrets or PII.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CompactResult {
  /** The compacted prompt string with [REF:*] and @MACRO placeholders */
  compactedPrompt: string;
  /** References resolved during this compaction (REF_KEY → full text) */
  resolvedRefs: Record<string, string>;
  /** Macros resolved during this compaction (MACRO_KEY → expanded text) */
  resolvedMacros: Record<string, string>;
  /** SQL templates resolved during this compaction */
  sqlTemplates: Record<string, string>;
  /** Structured AST extracted from intent detection */
  promptAst: PromptAst | null;
  /** Original token count estimate */
  originalTokens: number;
  /** Compacted token count estimate */
  compactedTokens: number;
  /** Reduction percentage 0–100 */
  reductionPct: number;
  /** Schema hash used for cache keying (Layer 8) */
  schemaHash: string | null;
}

export interface PromptAst {
  goal: string;
  schema: boolean;
  metadata: boolean;
  retries: boolean;
  historicalLearning: boolean;
  dateRange: { start?: string; end?: string } | null;
  branchCode: string | null;
  kpiDomains: string[];
  tables: string[];
  intent: "query_generation" | "kpi_analysis" | "correction" | "explanation" | "unknown";
}

export interface DictionaryEntry {
  key: string;           // e.g. "SCHEMA_DISCOVERY_BLOCK"
  tokens: number;        // token cost of the full block
  content: string;       // full text this key expands to
  version: number;       // increment on change — used for cache invalidation
  category: "schema" | "retry" | "validation" | "generation" | "identity" | "glossary";
}

export interface MacroEntry {
  key: string;           // e.g. "DB_ANALYSIS"
  expandedSteps: string[];
  shorthand: string;     // e.g. "@DB_ANALYSIS"
}

export interface SqlTemplate {
  key: string;           // e.g. "SELECT_TEMPLATE"
  template: string;      // with {{PARAM}} placeholders
  example: string;       // filled-in example for documentation
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 — Built-in Dictionary
// ─────────────────────────────────────────────────────────────────────────────

const BUILT_IN_DICTIONARY: DictionaryEntry[] = [
  {
    key: "AGENT_IDENTITY_BLOCK",
    category: "identity",
    version: 1,
    tokens: 120,
    content: `You are the Insight for Healthcare Agent for AcaciaHealth Dynamic Reporting. Answer only using supplied datasets, metadata, KPI definitions, and security context. Never fabricate values.`,
  },
  {
    key: "SCHEMA_DISCOVERY_BLOCK",
    category: "schema",
    version: 1,
    tokens: 180,
    content: `Inspect the schema, metadata.json, and infer table relationships. Resolve table aliases using the semantic layer. Validate all join paths before generating SQL. Use WITH (NOLOCK) on large tables.`,
  },
  {
    key: "RETRY_ANALYSIS_BLOCK",
    category: "retry",
    version: 1,
    tokens: 150,
    content: `Classify the SQL failure. Build a remediation strategy. Never retry the same SQL hash. Apply the minimum structural change that resolves the error. Record learned term→table mappings.`,
  },
  {
    key: "QUERY_VALIDATION_BLOCK",
    category: "validation",
    version: 1,
    tokens: 130,
    content: `Validate: SELECT TOP 10000, no SELECT *, @StartDate and @EndDate in WHERE, RTRIM() on branch code comparisons, no disallowed statements (DROP/TRUNCATE/INSERT/UPDATE/DELETE/EXEC).`,
  },
  {
    key: "SQL_GENERATION_BLOCK",
    category: "generation",
    version: 1,
    tokens: 200,
    content: `Generate T-SQL SELECT query. Use resolved tables from the Knowledge Graph. Apply date parameterization (@StartDate, @EndDate). Apply branch filter if provided. Return JSON { sql, explanation, confidence }.`,
  },
  {
    key: "HEALTHCARE_GLOSSARY_BLOCK",
    category: "glossary",
    version: 1,
    tokens: 110,
    content: `ADC=Average Daily Census, HCE=Hospice Census Equivalent, LOS=Length of Stay, LUPA=Low Utilization Payment Adjustment, NOE=Notice of Election, NOA=Notice of Admission, HIS=Hospice Item Set, DSO=Days Sales Outstanding, PDGM=Patient-Driven Groupings Model.`,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Layer 3 — Built-in Macros
// ─────────────────────────────────────────────────────────────────────────────

const BUILT_IN_MACROS: MacroEntry[] = [
  {
    key: "DB_ANALYSIS",
    shorthand: "@DB_ANALYSIS",
    expandedSteps: [
      "Inspect schema and metadata.json",
      "Infer table relationships and FK paths",
      "Validate all join paths",
      "Score tables by relevance to the user query",
    ],
  },
  {
    key: "QUERY_GENERATION",
    shorthand: "@QUERY_GENERATION",
    expandedSteps: [
      "Resolve tables using Knowledge Graph",
      "Apply date parameterization",
      "Apply branch filter if provided",
      "Generate T-SQL SELECT with TOP 10000",
      "Return JSON { sql, explanation, confidence }",
    ],
  },
  {
    key: "RETRY_LOOP",
    shorthand: "@RETRY_LOOP",
    expandedSteps: [
      "Classify the failure type",
      "Select remediation strategy for that class",
      "Verify new SQL hash differs from all prior attempts",
      "Generate corrected SQL",
      "Validate corrected SQL",
      "Record outcome in history",
    ],
  },
  {
    key: "KPI_ANALYSIS",
    shorthand: "@KPI_ANALYSIS",
    expandedSteps: [
      "Identify KPI name and domain",
      "Retrieve KPI definition (formula, numerator, denominator)",
      "Apply benchmark if available",
      "Compute variance and trend",
      "Identify root cause drivers",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Layer 5 — SQL Templates
// ─────────────────────────────────────────────────────────────────────────────

export const SQL_TEMPLATES: SqlTemplate[] = [
  {
    key: "SELECT_TEMPLATE",
    template: `SELECT TOP {{TOP_N}}\n  {{COLUMNS}}\nFROM {{TABLE}} WITH (NOLOCK)\nWHERE {{DATE_COL}} BETWEEN @StartDate AND @EndDate{{BRANCH_FILTER}}{{EXTRA_WHERE}}\nORDER BY {{ORDER_BY}}`,
    example: `SELECT TOP 10000\n  patient_id, admit_date, discharge_date\nFROM dbo.hospice_census WITH (NOLOCK)\nWHERE admit_date BETWEEN @StartDate AND @EndDate\n  AND RTRIM(branch_code) = RTRIM(@BranchCode)\nORDER BY admit_date DESC`,
  },
  {
    key: "JOIN_TEMPLATE",
    template: `{{LEFT_TABLE}} AS {{LEFT_ALIAS}}\n{{JOIN_TYPE}} JOIN {{RIGHT_TABLE}} AS {{RIGHT_ALIAS}}\n  ON {{LEFT_ALIAS}}.{{LEFT_KEY}} = {{RIGHT_ALIAS}}.{{RIGHT_KEY}}`,
    example: `dbo.hospice_census AS hc\nINNER JOIN dbo.patient_master AS pm\n  ON hc.patient_id = pm.patient_id`,
  },
  {
    key: "AGG_TEMPLATE",
    template: `SELECT\n  {{GROUP_COLS}},\n  {{AGG_FUNC}}({{AGG_COL}}) AS {{ALIAS}}\nFROM {{TABLE}} WITH (NOLOCK)\nWHERE {{DATE_COL}} BETWEEN @StartDate AND @EndDate\nGROUP BY {{GROUP_COLS}}\nHAVING {{HAVING_CLAUSE}}`,
    example: `SELECT\n  branch_code, service_line,\n  COUNT(*) AS patient_count,\n  AVG(DATEDIFF(day, admit_date, discharge_date)) AS avg_los\nFROM dbo.hospice_census WITH (NOLOCK)\nWHERE admit_date BETWEEN @StartDate AND @EndDate\nGROUP BY branch_code, service_line\nHAVING COUNT(*) > 0`,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — Normalization helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Estimate tokens: ~1 token per 4 chars (GPT tokenizer approximation) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeDuplicateInstructions(text: string): string {
  const lines = text.split("\n");
  const seen = new Set<string>();
  const deduplicated: string[] = [];
  for (const line of lines) {
    const key = line.trim().toLowerCase();
    if (!key || !seen.has(key)) {
      if (key) seen.add(key);
      deduplicated.push(line);
    }
  }
  return deduplicated.join("\n");
}

function normalizeSql(text: string): string {
  // Normalize common SQL keyword casing for dedup
  return text
    .replace(/\bselect\b/gi, "SELECT")
    .replace(/\bfrom\b/gi, "FROM")
    .replace(/\bwhere\b/gi, "WHERE")
    .replace(/\bjoin\b/gi, "JOIN")
    .replace(/\binner join\b/gi, "INNER JOIN")
    .replace(/\bleft join\b/gi, "LEFT JOIN")
    .replace(/\border by\b/gi, "ORDER BY")
    .replace(/\bgroup by\b/gi, "GROUP BY")
    .replace(/\bhaving\b/gi, "HAVING")
    .replace(/\bwith\s*\(nolock\)/gi, "WITH (NOLOCK)");
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 4 — Prompt AST extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractAst(prompt: string): PromptAst {
  const lower = prompt.toLowerCase();

  const intent: PromptAst["intent"] =
    /correct|fix|retry|error|failed/.test(lower)    ? "correction"
    : /kpi|metric|census|lupa|dso|adc/.test(lower) ? "kpi_analysis"
    : /explain|what is|describe/.test(lower)        ? "explanation"
    : /generate.*sql|select|query/.test(lower)      ? "query_generation"
    : "unknown";

  const dateRange: PromptAst["dateRange"] = (() => {
    const startMatch = prompt.match(/startdate[=:\s]+([0-9\-/]+)/i);
    const endMatch   = prompt.match(/enddate[=:\s]+([0-9\-/]+)/i);
    if (startMatch || endMatch) return { start: startMatch?.[1], end: endMatch?.[1] };
    return null;
  })();

  const branchMatch = prompt.match(/branch[_\s]?code[=:\s]+(['\w]+)/i);

  const kpiDomains: string[] = [];
  for (const domain of ["hospice", "home health", "palliative", "revenue cycle", "workforce", "quality"]) {
    if (lower.includes(domain)) kpiDomains.push(domain);
  }

  const tableMatches = [...prompt.matchAll(/(?:FROM|JOIN)\s+([\w.[\]]+)/gi)].map((m) => m[1]);

  return {
    goal: intent,
    schema: /schema|table|column|metadata/.test(lower),
    metadata: /metadata|kpi|measure|definition/.test(lower),
    retries: /retry|correct|fix|attempt/.test(lower),
    historicalLearning: /learned|mapping|history|prior/.test(lower),
    dateRange,
    branchCode: branchMatch?.[1]?.replace(/'/g, "") ?? null,
    kpiDomains,
    tables: [...new Set(tableMatches)],
    intent,
  };
}

function astToMinimalString(ast: PromptAst): string {
  const parts: string[] = [
    `task:${ast.intent}`,
    ast.schema          ? "schema:true"   : "",
    ast.metadata        ? "metadata:true" : "",
    ast.retries         ? "retries:true"  : "",
    ast.historicalLearning ? "history:true" : "",
    ast.dateRange ? `dateRange:${ast.dateRange.start ?? "?"}-${ast.dateRange.end ?? "?"}` : "",
    ast.branchCode ? `branch:${ast.branchCode}` : "",
    ast.kpiDomains.length ? `domains:[${ast.kpiDomains.join(",")}]` : "",
    ast.tables.length   ? `tables:[${ast.tables.join(",")}]` : "",
  ].filter(Boolean);
  return `{ ${parts.join(", ")} }`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2+3 — Dictionary & macro replacement
// ─────────────────────────────────────────────────────────────────────────────

function applyDictionary(
  text: string,
  dictionary: DictionaryEntry[]
): { result: string; resolved: Record<string, string> } {
  const resolved: Record<string, string> = {};
  let result = text;

  for (const entry of dictionary) {
    if (result.includes(entry.content)) {
      resolved[entry.key] = entry.content;
      result = result.split(entry.content).join(`[REF:${entry.key}]`);
    }
  }
  return { result, resolved };
}

function applyMacros(
  text: string,
  macros: MacroEntry[]
): { result: string; resolved: Record<string, string> } {
  const resolved: Record<string, string> = {};
  let result = text;

  for (const macro of macros) {
    const expanded = macro.expandedSteps.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
    if (result.includes(expanded)) {
      resolved[macro.key] = expanded;
      result = result.split(expanded).join(macro.shorthand);
    }
  }
  return { result, resolved };
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 5 — SQL template detection
// ─────────────────────────────────────────────────────────────────────────────

function detectSqlTemplates(
  text: string
): { result: string; templates: Record<string, string> } {
  const templates: Record<string, string> = {};
  let result = text;

  // Detect SELECT TOP patterns
  const selectTopRegex = /SELECT\s+TOP\s+\d+\s+[\s\S]*?FROM\s+[\w.[\]]+\s+WITH\s+\(NOLOCK\)\s+WHERE\s+[\s\S]*?BETWEEN\s+@StartDate\s+AND\s+@EndDate/gi;
  const selectMatches = [...result.matchAll(selectTopRegex)];
  if (selectMatches.length > 1) {
    // Multiple identical-structure SELECT TOP blocks — template them
    const canonical = selectMatches[0][0];
    templates["SELECT_TEMPLATE_INSTANCE"] = canonical;
    // Replace all occurrences after first with a reference
    let first = true;
    result = result.replace(selectTopRegex, (match) => {
      if (first) { first = false; return match; }
      return `[SQL:SELECT_TEMPLATE_INSTANCE]`;
    });
  }

  return { result, templates };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export class PromptCompactor {
  private dictionary: DictionaryEntry[];
  private macros: MacroEntry[];

  constructor(
    extraDictionary: DictionaryEntry[] = [],
    extraMacros: MacroEntry[] = []
  ) {
    this.dictionary = [...BUILT_IN_DICTIONARY, ...extraDictionary];
    this.macros     = [...BUILT_IN_MACROS,    ...extraMacros];
  }

  /**
   * Compact a prompt string through all 5 layers.
   * Returns a CompactResult with the minimized prompt and all resolution maps.
   */
  compact(
    prompt: string,
    schemaHash: string | null = null
  ): CompactResult {
    const originalTokens = estimateTokens(prompt);

    // Layer 1 — Normalize
    let working = normalizeWhitespace(prompt);
    working = removeDuplicateInstructions(working);
    working = normalizeSql(working);

    // Layer 4 — Extract AST (before further compression loses structure)
    const promptAst = extractAst(working);

    // Layer 2 — Dictionary substitution
    const { result: afterDict, resolved: resolvedRefs } = applyDictionary(working, this.dictionary);
    working = afterDict;

    // Layer 3 — Semantic macros
    const { result: afterMacros, resolved: resolvedMacros } = applyMacros(working, this.macros);
    working = afterMacros;

    // Layer 5 — SQL template compression
    const { result: afterSql, templates: sqlTemplates } = detectSqlTemplates(working);
    working = afterSql;

    const compactedTokens = estimateTokens(working);
    const reductionPct = originalTokens > 0
      ? Math.round((1 - compactedTokens / originalTokens) * 100)
      : 0;

    return {
      compactedPrompt: working,
      resolvedRefs,
      resolvedMacros,
      sqlTemplates,
      promptAst,
      originalTokens,
      compactedTokens,
      reductionPct,
      schemaHash,
    };
  }

  /**
   * Expand a previously compacted prompt back to its full form.
   * Guarantees lossless reconstruction from the CompactResult maps.
   */
  expand(compact: CompactResult): string {
    let result = compact.compactedPrompt;

    // Reverse Layer 5 — SQL templates
    for (const [key, sql] of Object.entries(compact.sqlTemplates)) {
      result = result.split(`[SQL:${key}]`).join(sql);
    }

    // Reverse Layer 3 — Macros
    for (const [key, expanded] of Object.entries(compact.resolvedMacros)) {
      const macro = this.macros.find((m) => m.key === key);
      if (macro) result = result.split(macro.shorthand).join(expanded);
    }

    // Reverse Layer 2 — Dictionary refs
    for (const [key, content] of Object.entries(compact.resolvedRefs)) {
      result = result.split(`[REF:${key}]`).join(content);
    }

    return result;
  }

  /** Register a custom dictionary entry (for dynamic schema blocks) */
  registerBlock(entry: DictionaryEntry): void {
    const existing = this.dictionary.findIndex((d) => d.key === entry.key);
    if (existing >= 0) this.dictionary[existing] = entry;
    else this.dictionary.push(entry);
  }

  /** Retrieve all registered dictionary entries */
  getDictionary(): DictionaryEntry[] {
    return [...this.dictionary];
  }

  /** Retrieve all registered macros */
  getMacros(): MacroEntry[] {
    return [...this.macros];
  }

  /** Retrieve built-in SQL templates */
  getSqlTemplates(): SqlTemplate[] {
    return [...SQL_TEMPLATES];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton for server-wide reuse
// ─────────────────────────────────────────────────────────────────────────────

let _instance: PromptCompactor | null = null;

export function getPromptCompactor(): PromptCompactor {
  if (!_instance) _instance = new PromptCompactor();
  return _instance;
}
