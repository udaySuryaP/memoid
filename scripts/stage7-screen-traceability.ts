import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format } from "prettier";

export const FOUNDATION_ONLY_STATUS = "NOT IMPLEMENTED — FOUNDATION ONLY";

export const TRACEABILITY_FIELDS = [
  "id",
  "canonicalName",
  "purpose",
  "stage8aPattern",
  "futureSurface",
  "stage8bPrimitive",
  "transitionClass",
  "desktop",
  "tablet",
  "mobile",
  "status",
] as const;

export type TraceabilityField = (typeof TRACEABILITY_FIELDS)[number];

export interface TraceabilityRecord {
  id: string;
  canonicalName: string;
  purpose: string;
  stage8aPattern: string;
  futureSurface: string;
  stage8bPrimitive: string;
  transitionClass: string;
  desktop: string;
  tablet: string;
  mobile: string;
  status: string;
}

const HEADERS: ReadonlyArray<readonly [TraceabilityField, string]> = [
  ["id", "Screen ID"],
  ["canonicalName", "Canonical Stage 7 screen name"],
  ["purpose", "Canonical purpose / user intent"],
  ["stage8aPattern", "Stage 8A shared design pattern / surface"],
  ["futureSurface", "Future route / surface class"],
  ["stage8bPrimitive", "Reused Stage 8B component / primitive pattern"],
  ["transitionClass", "First-party / provider-hosted / external transition"],
  ["desktop", "Desktop treatment"],
  ["tablet", "Tablet treatment"],
  ["mobile", "Mobile treatment"],
  ["status", "Stage 8B implementation status"],
];

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
export const TRACEABILITY_DATA_PATH = resolve(
  scriptDirectory,
  "../docs/design/stage7-screen-traceability.json",
);
export const TRACEABILITY_MARKDOWN_PATH = resolve(
  scriptDirectory,
  "../docs/design/stage7-screen-traceability.md",
);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateTraceabilityRecords(
  input: unknown,
  contract?: {
    expectedIds?: readonly string[];
    expectedNames?: Readonly<Record<string, string>>;
  },
): TraceabilityRecord[] {
  if (!Array.isArray(input)) {
    throw new Error("Traceability manifest must be an array.");
  }

  const records = input.map((candidate, index) => {
    if (!isObject(candidate)) {
      throw new Error(`Traceability row ${index + 1} must be an object.`);
    }

    const unexpectedFields = Object.keys(candidate).filter(
      (field) => !TRACEABILITY_FIELDS.includes(field as TraceabilityField),
    );
    if (unexpectedFields.length > 0) {
      throw new Error(
        `Traceability row ${index + 1} has unexpected fields: ${unexpectedFields.join(", ")}.`,
      );
    }

    for (const field of TRACEABILITY_FIELDS) {
      const value = candidate[field];
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Traceability row ${index + 1} requires non-empty field ${field}.`);
      }
    }

    const record = candidate as unknown as TraceabilityRecord;
    if (!/^[A-Z]+-\d{2}$/.test(record.id)) {
      throw new Error(`Traceability row ${index + 1} has invalid screen ID ${record.id}.`);
    }
    if (record.status !== FOUNDATION_ONLY_STATUS) {
      throw new Error(`${record.id} must use the exact Stage 8B status ${FOUNDATION_ONLY_STATUS}.`);
    }
    return record;
  });

  const ids = records.map(({ id }) => id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new Error(`Duplicate screen IDs: ${[...new Set(duplicateIds)].join(", ")}.`);
  }

  if (contract?.expectedIds) {
    const expectedSet = new Set(contract.expectedIds);
    const actualSet = new Set(ids);
    const missing = contract.expectedIds.filter((id) => !actualSet.has(id));
    const extra = ids.filter((id) => !expectedSet.has(id));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `Screen ID contract mismatch. Missing: ${missing.join(", ") || "none"}. Extra: ${extra.join(", ") || "none"}.`,
      );
    }
    if (ids.some((id, index) => id !== contract.expectedIds?.[index])) {
      throw new Error("Screen IDs do not follow the canonical Stage 7 order.");
    }
  }

  if (contract?.expectedNames) {
    for (const record of records) {
      const expectedName = contract.expectedNames[record.id];
      if (expectedName === undefined) {
        throw new Error(`No canonical screen name contract exists for ${record.id}.`);
      }
      if (record.canonicalName !== expectedName) {
        throw new Error(
          `${record.id} must map to canonical screen name ${expectedName}; received ${record.canonicalName}.`,
        );
      }
    }
  }

  return records;
}

export async function loadTraceabilityRecords(): Promise<TraceabilityRecord[]> {
  const text = await readFile(TRACEABILITY_DATA_PATH, "utf8");
  return validateTraceabilityRecords(JSON.parse(text) as unknown);
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll(/\r?\n/g, "<br>");
}

export async function renderTraceabilityMarkdown(
  records: readonly TraceabilityRecord[],
): Promise<string> {
  const heading = [
    "# Exact Stage 7 screen traceability",
    "",
    "This document is generated from `stage7-screen-traceability.json`. Edit the JSON manifest and run `pnpm traceability:generate`; do not hand-edit this table.",
    "",
    "This is a design and implementation-readiness contract, not evidence that any Memoid product screen or workflow exists. Stage 8B provides only reusable foundation primitives and specimens.",
    "",
  ];
  const header = `| ${HEADERS.map(([, label]) => label).join(" | ")} |`;
  const divider = `| ${HEADERS.map(() => "---").join(" | ")} |`;
  const rows = records.map(
    (record) => `| ${HEADERS.map(([field]) => escapeTableCell(record[field])).join(" | ")} |`,
  );
  return format([...heading, header, divider, ...rows, ""].join("\n"), {
    parser: "markdown",
  });
}

async function run(): Promise<void> {
  const records = await loadTraceabilityRecords();
  const rendered = await renderTraceabilityMarkdown(records);
  if (process.argv.includes("--check")) {
    const current = await readFile(TRACEABILITY_MARKDOWN_PATH, "utf8");
    if (current !== rendered) {
      throw new Error(
        "Stage 7 traceability Markdown is stale. Run pnpm traceability:generate and commit the result.",
      );
    }
    console.log(`Stage 7 traceability is synchronized (${records.length} canonical rows).`);
    return;
  }
  await writeFile(TRACEABILITY_MARKDOWN_PATH, rendered, "utf8");
  console.log(`Generated Stage 7 traceability Markdown (${records.length} canonical rows).`);
}

const directRun =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (directRun) {
  await run();
}
