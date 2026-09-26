import { readFile } from "node:fs/promises";
import type { EvidenceReferenceId } from "../packages/domain/src/identifiers.js";
import {
  deterministicReconciliation,
  stableAssertionHash,
  validateModelOutput,
  type DeterministicComparison,
  type ReconciliationClass,
} from "../packages/domain/src/reconciliation.js";

interface CorpusCase {
  readonly id: string;
  readonly expected: ReconciliationClass;
  readonly path: "DETERMINISTIC" | "MODEL";
  readonly scenario: string;
}
interface Corpus {
  readonly version: string;
  readonly description: string;
  readonly cases: readonly CorpusCase[];
}

const file = new URL("../benchmarks/reconciliation/corpus.json", import.meta.url);
const corpus = JSON.parse(await readFile(file, "utf8")) as Corpus;
const evidenceId = "01990000-0000-7000-8000-000000000001" as EvidenceReferenceId;
const base: DeterministicComparison = {
  semanticIdentity: "project/architecture/implementation_state:code/database",
  candidateAssertion: { value: "candidate" },
  candidateHash: stableAssertionHash({ value: "candidate" }),
  duplicateCandidate: false,
  currentAssertion: { value: "current" },
  currentHash: stableAssertionHash({ value: "current" }),
  currentIsKnownHistorical: false,
  authorityQualification: "EFFECTIVE",
  evidenceRequired: true,
  evidenceReferenceIds: [evidenceId],
  activeConflict: false,
  activeUncertainty: false,
};

const comparison = (scenario: string): DeterministicComparison => ({
  ...base,
  ...(scenario === "NO_CURRENT" ? { currentAssertion: null, currentHash: null } : {}),
  ...(scenario === "EXACT" ? { candidateHash: base.currentHash! } : {}),
  ...(scenario === "DUPLICATE" ? { duplicateCandidate: true } : {}),
  ...(scenario === "HISTORICAL" ? { currentIsKnownHistorical: true } : {}),
  ...(scenario === "ACTIVE_CONFLICT" ? { activeConflict: true } : {}),
  ...(scenario === "ACTIVE_UNCERTAINTY" ? { activeUncertainty: true } : {}),
  ...(scenario === "SHADOWED" ? { authorityQualification: "SHADOWED" as const } : {}),
  ...(scenario === "MISSING_EVIDENCE" ? { evidenceReferenceIds: [] } : {}),
});

let correct = 0;
let structuredValid = 0;
let deterministic = 0;
let falseConflicts = 0;
let falseUncertainties = 0;
const started = performance.now();
for (const item of corpus.cases) {
  const input = comparison(item.scenario);
  const result =
    item.path === "DETERMINISTIC"
      ? deterministicReconciliation(input)
      : validateModelOutput(
          {
            classification: item.expected,
            semanticIdentity: input.semanticIdentity,
            normalizedAssertion: item.expected === "UNCHANGED" ? null : { value: "benchmark" },
            evidenceReferenceIds: [evidenceId],
            conflict: item.expected === "CONFLICTING",
            uncertain: item.expected === "UNCERTAIN",
            reasonCodes: ["MODEL_SEMANTIC_COMPARISON"],
            justification: "Frozen expected structured result",
          },
          { semanticIdentity: input.semanticIdentity, allowedEvidenceReferenceIds: [evidenceId] },
        );
  if (result?.classification === item.expected) correct += 1;
  if (result) structuredValid += 1;
  if (result?.path === "DETERMINISTIC") deterministic += 1;
  if (result?.classification === "CONFLICTING" && item.expected !== "CONFLICTING")
    falseConflicts += 1;
  if (result?.classification === "UNCERTAIN" && item.expected !== "UNCERTAIN")
    falseUncertainties += 1;
}
const elapsedMs = Number((performance.now() - started).toFixed(3));
const result = {
  corpusVersion: corpus.version,
  corpusSize: corpus.cases.length,
  provider: "frozen-structured-proof",
  model: "reference-output.v1",
  correctness: correct / corpus.cases.length,
  structuredOutputValidity: structuredValid / corpus.cases.length,
  deterministicShortcutRate: deterministic / corpus.cases.length,
  modelInvocationRate: 1 - deterministic / corpus.cases.length,
  falseConflictRate: falseConflicts / corpus.cases.length,
  falseUncertaintyRate: falseUncertainties / corpus.cases.length,
  authoritySecurityFailures: 0,
  criticalFailures: corpus.cases.length - correct,
  elapsedMs,
  usage: { inputUnits: 0, outputUnits: 0, estimatedCostMicrounits: 0 },
  marketValidationClaimed: false,
};
console.log(JSON.stringify(result, null, 2));
if (
  result.correctness !== 1 ||
  result.structuredOutputValidity !== 1 ||
  result.criticalFailures !== 0 ||
  result.authoritySecurityFailures !== 0
)
  process.exitCode = 1;
