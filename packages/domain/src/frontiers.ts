import { nonNegativeSequence, type NonNegativeSequence, type PositiveSequence } from "./values.js";

export interface SourceFrontier {
  readonly observed: PositiveSequence | null;
  readonly desired: PositiveSequence | null;
  readonly ingested: PositiveSequence | null;
  readonly reconciled: PositiveSequence | null;
}

export function sourceFrontier(input: SourceFrontier): Readonly<SourceFrontier> {
  const values = [input.reconciled, input.ingested, input.desired, input.observed];
  let previous: number | null = null;
  for (const value of values) {
    if (value === null) {
      if (previous !== null) throw new Error("Source frontier stages cannot skip an earlier stage");
      continue;
    }
    if (previous !== null && value < previous)
      throw new Error("Source frontier must satisfy reconciled <= ingested <= desired <= observed");
    previous = value;
  }
  return Object.freeze({ ...input });
}

export interface CandidateFrontier {
  readonly lastAccepted: NonNegativeSequence;
  readonly reconciledThrough: NonNegativeSequence;
}

export function candidateFrontier(
  lastAccepted: number,
  reconciledThrough: number,
): Readonly<CandidateFrontier> {
  const accepted = nonNegativeSequence(lastAccepted);
  const reconciled = nonNegativeSequence(reconciledThrough);
  if (reconciled > accepted)
    throw new Error("Candidate reconciled frontier cannot exceed accepted frontier");
  return Object.freeze({ lastAccepted: accepted, reconciledThrough: reconciled });
}

export function contiguousStableDispositionWatermark(
  lastAccepted: number,
  stableSequences: ReadonlySet<number>,
): NonNegativeSequence {
  nonNegativeSequence(lastAccepted);
  let watermark = 0;
  for (let sequence = 1; sequence <= lastAccepted; sequence += 1) {
    if (!stableSequences.has(sequence)) break;
    watermark = sequence;
  }
  return nonNegativeSequence(watermark);
}
