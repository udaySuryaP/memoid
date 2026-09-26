import { authorize } from "@memoid/domain/authorization";
import type { ProjectId } from "@memoid/domain/identifiers";
import {
  buildReasoningPacket,
  deterministicReconciliation,
  estimateCostMicrounits,
  validateModelOutput,
  type DeterministicComparison,
  type ModelConfiguration,
  type ModelInvocationAccounting,
  type ModelUsage,
  type ReasoningPacket,
  type ReasoningPacketBudget,
  type ReconciliationBasis,
  type ReconciliationProviderFailureCode,
  type ReconciliationResult,
  type UntrustedEvidenceInput,
  type WorkingContextResult,
} from "@memoid/domain/reconciliation";
import type { ProjectLifecycleState } from "@memoid/domain/workspace-project";
import type { WorkspaceProjectContext } from "./workspace-project.js";

export class ReconciliationProviderError extends Error {
  public constructor(
    public readonly code: ReconciliationProviderFailureCode,
    public readonly retryable: boolean,
    message: string = code,
  ) {
    super(message);
  }
}

export interface StructuredModelRequest {
  readonly modelId: string;
  readonly configurationVersion: string;
  readonly packet: ReasoningPacket;
  readonly outputSchemaVersion: string;
}

export interface StructuredModelResponse {
  readonly output: unknown;
  readonly usage: ModelUsage;
  readonly latencyMs: number;
  readonly refusal: boolean;
}

export interface ReconciliationModelProvider {
  readonly providerId: string;
  invoke(request: StructuredModelRequest): Promise<StructuredModelResponse>;
}

export interface ReconciliationMaterial {
  readonly comparison: DeterministicComparison;
  readonly basis: ReconciliationBasis;
  readonly workingContext: readonly Readonly<Record<string, unknown>>[];
  readonly evidence: readonly UntrustedEvidenceInput[];
}

export interface ReconciliationRepository {
  findProjectState(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
  ): Promise<ProjectLifecycleState | null>;
  loadMaterial(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    candidateAssertionId: string,
  ): Promise<ReconciliationMaterial>;
  recordInvocation(
    context: WorkspaceProjectContext,
    projectId: ProjectId,
    basis: ReconciliationBasis,
    accounting: ModelInvocationAccounting,
  ): Promise<void>;
  commit(
    context: WorkspaceProjectContext,
    material: ReconciliationMaterial,
    result: ReconciliationResult,
  ): Promise<WorkingContextResult>;
  close(): Promise<void>;
}

export interface ReconcileCandidateCommand {
  readonly projectId: ProjectId;
  readonly candidateAssertionId: string;
  readonly model: ModelConfiguration;
  readonly packetBudget: ReasoningPacketBudget;
  readonly maxAttempts: number;
}

export interface ReconciliationTelemetry {
  emit(
    event: Readonly<{
      name:
        | "RECONCILIATION_STARTED"
        | "RECONCILIATION_COMPLETED"
        | "RECONCILIATION_FAILED"
        | "RECONCILIATION_COMPACTION"
        | "RECONCILIATION_MODEL_ATTEMPT";
      projectId: ProjectId;
      path?: "DETERMINISTIC" | "MODEL";
      providerId?: string;
      modelId?: string;
      attempt?: number;
      failureCode?: string;
      omittedCount?: number;
    }>,
  ): void;
}

const silentTelemetry: ReconciliationTelemetry = { emit: () => undefined };

function checkedUsage(value: ModelUsage): ModelUsage {
  if (
    ![value.inputUnits, value.outputUnits, value.totalUnits].every(
      (item) => Number.isSafeInteger(item) && item >= 0,
    )
  )
    throw new ReconciliationProviderError("MALFORMED_OUTPUT", false, "Provider usage is invalid");
  if (value.totalUnits < value.inputUnits + value.outputUnits)
    throw new ReconciliationProviderError(
      "MALFORMED_OUTPUT",
      false,
      "Provider total usage is inconsistent",
    );
  return value;
}

export class ReconciliationService {
  public constructor(
    private readonly repository: ReconciliationRepository,
    private readonly providers: ReadonlyMap<string, ReconciliationModelProvider>,
    private readonly telemetry: ReconciliationTelemetry = silentTelemetry,
  ) {}

  private async require(context: WorkspaceProjectContext, projectId: ProjectId): Promise<void> {
    const state = await this.repository.findProjectState(context, projectId);
    if (!state) throw new Error("RECONCILIATION_PROJECT_NOT_FOUND");
    const decision = authorize({
      principal: context.principal,
      actor: context.actor,
      capability: "PROJECT_MANAGE_CONTEXT",
      workspaceId: context.workspaceId,
      projectId,
      resourceState: state,
      grants: [],
    });
    if (!decision.allowed)
      throw new Error(
        decision.reason === "RESOURCE_UNAVAILABLE"
          ? "RECONCILIATION_PROJECT_UNAVAILABLE"
          : "RECONCILIATION_DENIED",
      );
  }

  public async reconcile(
    context: WorkspaceProjectContext,
    command: ReconcileCandidateCommand,
  ): Promise<WorkingContextResult> {
    this.telemetry.emit({ name: "RECONCILIATION_STARTED", projectId: command.projectId });
    await this.require(context, command.projectId);
    if (
      !Number.isSafeInteger(command.maxAttempts) ||
      command.maxAttempts < 1 ||
      command.maxAttempts > 5
    )
      throw new Error("Invalid model attempt limit");
    const material = await this.repository.loadMaterial(
      context,
      command.projectId,
      command.candidateAssertionId,
    );
    const deterministic = deterministicReconciliation(material.comparison);
    if (deterministic) {
      const committed = await this.repository.commit(context, material, deterministic);
      this.telemetry.emit({
        name: "RECONCILIATION_COMPLETED",
        projectId: command.projectId,
        path: "DETERMINISTIC",
      });
      return committed;
    }
    const packet = buildReasoningPacket({
      comparison: material.comparison,
      basis: material.basis,
      workingContext: material.workingContext,
      evidence: material.evidence,
      budget: command.packetBudget,
    });
    if (packet.omitted.length > 0)
      this.telemetry.emit({
        name: "RECONCILIATION_COMPACTION",
        projectId: command.projectId,
        path: "MODEL",
        omittedCount: packet.omitted.length,
      });
    const route = [
      {
        providerId: command.model.providerId,
        modelId: command.model.modelId,
        privacyClass: command.model.privacyClass,
      },
      ...command.model.fallbackAllowlist,
    ];
    let lastError: unknown = new ReconciliationProviderError("PROVIDER_UNAVAILABLE", true);
    let attempt = 0;
    for (const target of route) {
      if (target.privacyClass !== command.model.privacyClass)
        throw new ReconciliationProviderError(
          "CONFIGURATION_INVALID",
          false,
          "Fallback privacy class mismatch",
        );
      const provider = this.providers.get(target.providerId);
      if (!provider)
        throw new ReconciliationProviderError(
          "CONFIGURATION_INVALID",
          false,
          `Provider is not configured: ${target.providerId}`,
        );
      for (let localAttempt = 0; localAttempt < command.maxAttempts; localAttempt += 1) {
        attempt += 1;
        let observed: Omit<ModelInvocationAccounting, "succeeded" | "failureCode"> | null = null;
        this.telemetry.emit({
          name: "RECONCILIATION_MODEL_ATTEMPT",
          projectId: command.projectId,
          path: "MODEL",
          providerId: target.providerId,
          modelId: target.modelId,
          attempt,
        });
        try {
          const response = await provider.invoke({
            modelId: target.modelId,
            configurationVersion: command.model.configurationVersion,
            packet,
            outputSchemaVersion: "reconciliation-output.v1",
          });
          if (response.refusal) throw new ReconciliationProviderError("REFUSAL", false);
          const usage = checkedUsage(response.usage);
          const cost =
            command.model.inputPerMillionMicrounits === null ||
            command.model.outputPerMillionMicrounits === null
              ? null
              : estimateCostMicrounits(usage, {
                  inputPerMillionMicrounits: command.model.inputPerMillionMicrounits,
                  outputPerMillionMicrounits: command.model.outputPerMillionMicrounits,
                });
          observed = {
            providerId: target.providerId,
            modelId: target.modelId,
            configurationVersion: command.model.configurationVersion,
            pricingVersion: command.model.pricingVersion,
            estimatedCostMicrounits: cost,
            latencyMs: response.latencyMs,
            attempt,
            ...usage,
          };
          let result: ReconciliationResult;
          try {
            result = validateModelOutput(response.output, {
              semanticIdentity: material.comparison.semanticIdentity,
              allowedEvidenceReferenceIds: material.comparison.evidenceReferenceIds,
            });
          } catch (error) {
            throw new ReconciliationProviderError(
              "SCHEMA_VALIDATION",
              false,
              error instanceof Error ? error.message : String(error),
            );
          }
          await this.repository.recordInvocation(context, command.projectId, material.basis, {
            ...observed,
            succeeded: true,
            failureCode: null,
          });
          const committed = await this.repository.commit(context, material, result);
          this.telemetry.emit({
            name: "RECONCILIATION_COMPLETED",
            projectId: command.projectId,
            path: "MODEL",
            providerId: target.providerId,
            modelId: target.modelId,
            attempt,
          });
          return committed;
        } catch (error) {
          const failure =
            error instanceof ReconciliationProviderError
              ? error
              : new ReconciliationProviderError(
                  "TRANSPORT",
                  true,
                  error instanceof Error ? error.message : String(error),
                );
          lastError = failure;
          this.telemetry.emit({
            name: "RECONCILIATION_FAILED",
            projectId: command.projectId,
            path: "MODEL",
            providerId: target.providerId,
            modelId: target.modelId,
            attempt,
            failureCode: failure.code,
          });
          const emptyAttempt = {
            providerId: target.providerId,
            modelId: target.modelId,
            configurationVersion: command.model.configurationVersion,
            pricingVersion: command.model.pricingVersion,
            estimatedCostMicrounits: null,
            latencyMs: 0,
            attempt,
            inputUnits: 0,
            outputUnits: 0,
            totalUnits: 0,
          } satisfies Omit<ModelInvocationAccounting, "succeeded" | "failureCode">;
          await this.repository.recordInvocation(context, command.projectId, material.basis, {
            ...(observed ?? emptyAttempt),
            succeeded: false,
            failureCode: failure.code,
          });
          if (!failure.retryable) throw failure;
        }
      }
    }
    throw lastError;
  }
}
