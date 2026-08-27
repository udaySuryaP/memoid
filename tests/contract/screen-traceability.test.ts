import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  FOUNDATION_ONLY_STATUS,
  TRACEABILITY_DATA_PATH,
  TRACEABILITY_FIELDS,
  TRACEABILITY_MARKDOWN_PATH,
  renderTraceabilityMarkdown,
  validateTraceabilityRecords,
  type TraceabilityRecord,
} from "../../scripts/stage7-screen-traceability.js";

const EXPECTED_IDS = [
  "AUTH-01",
  "AUTH-02",
  "AUTH-03",
  "AUTH-04",
  "ONB-01",
  "PRJ-01",
  "PRJ-02",
  "GH-01",
  "GH-02",
  "PRJ-03",
  "PRJ-04",
  "PO-01",
  "CTX-01",
  "CTX-02",
  "CTX-03",
  "CF-01",
  "SRC-01",
  "SRC-02",
  "AUTHZ-01",
  "AUTHZ-02",
  "PROP-01",
  "PROP-02",
  "PROP-03",
  "PROP-04",
  "HIST-01",
  "HIST-02",
  "HIST-03",
  "COR-01",
  "SRCH-01",
  "PACK-01",
  "INT-01",
  "INT-02",
  "INT-03",
  "INT-04",
  "INT-05",
  "INT-06",
  "DEV-01",
  "DEV-02",
  "DEV-03",
  "DEV-04",
  "ACT-01",
  "ACT-02",
  "PSET-01",
  "PSET-02",
  "PSET-03",
  "EXP-01",
  "ARC-01",
  "ARC-02",
  "DEL-01",
  "DEL-02",
  "ACC-01",
  "ACC-02",
  "ACC-03",
  "ACC-04",
  "ACC-05",
  "STEP-01",
  "ATT-01",
  "OPS-01",
  "ERR-01",
] as const;

const EXPECTED_NAMES: Readonly<Record<(typeof EXPECTED_IDS)[number], string>> = {
  "AUTH-01": "Account Access",
  "AUTH-02": "Verify Email",
  "AUTH-03": "Security Enrollment",
  "AUTH-04": "Recovery / Security Reset",
  "ONB-01": "First-run Checkpoint",
  "PRJ-01": "Projects",
  "PRJ-02": "Create Project",
  "GH-01": "GitHub Connection",
  "GH-02": "Repository Selection",
  "PRJ-03": "Initial Authority Review",
  "PRJ-04": "Initialization Status",
  "PO-01": "Project Overview",
  "CTX-01": "Current Context",
  "CTX-02": "Context Record Detail",
  "CTX-03": "Conflicts View",
  "CF-01": "Conflict Detail & Resolution",
  "SRC-01": "Sources",
  "SRC-02": "Source Detail",
  "AUTHZ-01": "Source Authority",
  "AUTHZ-02": "Authority Change",
  "PROP-01": "Proposal Queue",
  "PROP-02": "Proposal Review",
  "PROP-03": "Evidence/Provenance Panel",
  "PROP-04": "Revalidation",
  "HIST-01": "History",
  "HIST-02": "Context Revision Detail",
  "HIST-03": "Historical Record",
  "COR-01": "Correction/Restoration",
  "SRCH-01": "Search",
  "PACK-01": "Context Delivery Detail",
  "INT-01": "Integrations",
  "INT-02": "Add Integration",
  "INT-03": "MCP Authorization Consent",
  "INT-04": "Connection Instructions/Status",
  "INT-05": "Integration Detail",
  "INT-06": "Edit Project Grants",
  "DEV-01": "Developer Access",
  "DEV-02": "Create Credential",
  "DEV-03": "Secret Reveal",
  "DEV-04": "Credential Detail",
  "ACT-01": "Activity/Audit",
  "ACT-02": "Audit Event Detail",
  "PSET-01": "Project Settings",
  "PSET-02": "Repository Replacement",
  "PSET-03": "Data Management",
  "EXP-01": "Export",
  "ARC-01": "Archive Project",
  "ARC-02": "Restore Project",
  "DEL-01": "Delete Project",
  "DEL-02": "Deletion Pending",
  "ACC-01": "Profile",
  "ACC-02": "Security",
  "ACC-03": "Sessions",
  "ACC-04": "Data & Account",
  "ACC-05": "Delete Account",
  "STEP-01": "Step-up Authentication",
  "ATT-01": "Attention Tray",
  "OPS-01": "Operation Status",
  "ERR-01": "Protected Error State",
};

async function loadSource(): Promise<unknown> {
  return JSON.parse(await readFile(TRACEABILITY_DATA_PATH, "utf8")) as unknown;
}

const contract = { expectedIds: EXPECTED_IDS, expectedNames: EXPECTED_NAMES } as const;

describe("Stage 7 traceability contract", () => {
  it("contains the exact canonical 59-ID set once and in order", async () => {
    const records = validateTraceabilityRecords(await loadSource(), contract);
    const ids = records.map(({ id }) => id);

    expect(records).toHaveLength(59);
    expect(ids).toEqual(EXPECTED_IDS);
    expect(new Set(ids)).toHaveLength(59);
  });

  it("maps every ID to its exact canonical Stage 7 screen name", async () => {
    const records = validateTraceabilityRecords(await loadSource(), contract);

    for (const id of EXPECTED_IDS) {
      expect(records.find((record) => record.id === id)?.canonicalName).toBe(EXPECTED_NAMES[id]);
    }
  });

  it("requires every traceability field and the exact foundation-only status", async () => {
    const records = validateTraceabilityRecords(await loadSource(), contract);

    for (const record of records) {
      for (const field of TRACEABILITY_FIELDS) {
        expect(record[field].trim(), `${record.id}.${field}`).not.toBe("");
      }
      expect(record.status).toBe(FOUNDATION_ONLY_STATUS);
    }
  });

  it("keeps the Markdown generated from the machine-readable source", async () => {
    const records = validateTraceabilityRecords(await loadSource(), contract);
    const markdown = await readFile(TRACEABILITY_MARKDOWN_PATH, "utf8");

    expect(markdown).toBe(await renderTraceabilityMarkdown(records));
    expect(markdown.match(/^\|\s+[A-Z]+-\d{2}\s+\|/gm)).toHaveLength(59);
  });

  it("rejects duplicate, missing, and extra IDs", async () => {
    const records = validateTraceabilityRecords(await loadSource(), contract);
    const duplicate = structuredClone(records);
    duplicate[58] = { ...duplicate[58]!, id: duplicate[57]!.id };
    const missing = records.slice(0, -1);
    const extra = [...records, { ...records[0]!, id: "EXTRA-01", canonicalName: "Extra Screen" }];

    expect(() => validateTraceabilityRecords(duplicate, contract)).toThrow(
      /Duplicate screen IDs: OPS-01/,
    );
    expect(() => validateTraceabilityRecords(missing, contract)).toThrow(/Missing: ERR-01/);
    expect(() => validateTraceabilityRecords(extra, contract)).toThrow(/Extra: EXTRA-01/);
  });

  it("rejects semantically swapped ID/name mappings", async () => {
    const records = validateTraceabilityRecords(await loadSource(), contract);
    const swapped = structuredClone(records) as TraceabilityRecord[];
    const authority = swapped.find((record) => record.id === "PRJ-03")!;
    const initialization = swapped.find((record) => record.id === "PRJ-04")!;
    [authority.canonicalName, initialization.canonicalName] = [
      initialization.canonicalName,
      authority.canonicalName,
    ];

    expect(() => validateTraceabilityRecords(swapped, contract)).toThrow(
      "PRJ-03 must map to canonical screen name Initial Authority Review; received Initialization Status.",
    );
  });

  it("rejects missing fields and any status that implies product implementation", async () => {
    const records = validateTraceabilityRecords(await loadSource(), contract);
    const missingPurpose = structuredClone(records) as TraceabilityRecord[];
    missingPurpose[0]!.purpose = "";
    const implemented = structuredClone(records) as TraceabilityRecord[];
    implemented[0]!.status = "IMPLEMENTED";

    expect(() => validateTraceabilityRecords(missingPurpose, contract)).toThrow(
      /requires non-empty field purpose/,
    );
    expect(() => validateTraceabilityRecords(implemented, contract)).toThrow(
      /must use the exact Stage 8B status NOT IMPLEMENTED — FOUNDATION ONLY/,
    );
  });
});
