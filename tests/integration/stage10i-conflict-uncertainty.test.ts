import {
  PostgresConflictUncertaintyRepository,
  PostgresContextRecordRepository,
  PostgresSourceAuthorityRepository,
  PostgresWorkspaceProjectRepository,
} from "../../packages/adapters/src/index.js";
import {
  ConflictUncertaintyService,
  ContextRecordService,
  SourceAuthorityService,
  WorkspaceProjectService,
} from "../../packages/application/src/index.js";
import {
  completeStepUpIntent,
  createDatabase,
  createDatabaseUuidV7,
  createLocalAuthSession,
  createStepUpIntent,
  migrateToLatest,
  resolveAccountIdentity,
  type MemoidDatabase,
} from "../../packages/db/src/index.js";
import type {
  AccountId,
  ContextIdentityId,
  ContextRecordId,
  EvidenceReferenceId,
  ProjectId,
  SourceAuthorityAssignmentId,
  SourceId,
  WorkingContextItemId,
  WorkspaceId,
} from "../../packages/domain/src/index.js";
import {
  fingerprintLifecycleRequest,
  hashIdempotencyKey,
  hashSessionCredential,
} from "../../packages/security/src/index.js";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./stage10a-test-database.js";

const adminUrl = process.env.INTEGRATION_DATABASE_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

interface Fixture {
  accountId: AccountId;
  workspaceId: WorkspaceId;
  projectId: ProjectId;
  context: Parameters<ConflictUncertaintyService["list"]>[0];
  integrity: ConflictUncertaintyService;
  contextRecords: ContextRecordService;
  authority: SourceAuthorityService;
  repositories: Array<{ close(): Promise<void> }>;
}

suite("Stage 10I Conflict and Uncertainty PostgreSQL", () => {
  let isolated: IsolatedTestDatabase;
  let auth: Kysely<MemoidDatabase>;
  let owner: Fixture;
  let foreign: Fixture;
  let sequence = 0;
  const candidateSequences = new Map<ProjectId, number>();
  const closables: Array<{ close(): Promise<void> }> = [];

  beforeAll(async () => {
    isolated = await createIsolatedTestDatabase(adminUrl!, "10i_integrity");
    await migrateToLatest(isolated.db);
    auth = createDatabase(
      isolated.connectionString.replace("postgres:postgres", "memoid_auth:synthetic-auth-password"),
      8,
    );
  });

  beforeEach(async () => {
    await sql`truncate table memoid.accounts cascade`.execute(isolated.db);
    sequence = 0;
    candidateSequences.clear();
    owner = await fixture("owner");
    foreign = await fixture("foreign");
  });

  afterAll(async () => {
    await Promise.all(closables.map((repository) => repository.close()));
    await auth.destroy();
    await isolated.destroy();
  }, 60_000);

  async function fixture(label: string): Promise<Fixture> {
    const subject = `stage10i_${label}`;
    const identity = await resolveAccountIdentity(auth, {
      providerKey: "workos",
      providerSubject: subject,
      email: `${subject}@example.test`,
      emailVerified: true,
    });
    const accountId = identity.accountId as AccountId;
    const originalToken = hashSessionCredential(`${subject}-original-token`.padEnd(48, "x"));
    await createLocalAuthSession(auth, {
      accountId,
      bindingId: identity.bindingId,
      tokenHash: originalToken,
      providerSessionId: `session_${subject}`,
      freshAuthenticatedAt: new Date(),
      providerExpiresAt: new Date(Date.now() + 3_600_000),
      correlationId: await createDatabaseUuidV7(auth),
    });
    const appUrl = isolated.connectionString.replace(
      "postgres:postgres",
      "memoid_app:synthetic-app-password",
    );
    const projectRepository = new PostgresWorkspaceProjectRepository(appUrl);
    const workspace = await projectRepository.findPersonalWorkspace(accountId);
    if (!workspace) throw new Error("Workspace missing");
    const actor = await projectRepository.ensureHumanActor(accountId, workspace.id);
    const principal = {
      kind: "HUMAN" as const,
      id: subject,
      accountId,
      active: true as const,
      sessionRevoked: false as const,
      roleAssignments: [
        { role: "PERSONAL_WORKSPACE_OWNER" as const, workspaceId: workspace.id },
      ] as const,
    };
    const project = (
      await new WorkspaceProjectService(projectRepository).createProject(
        {
          accountId,
          workspaceId: workspace.id,
          sessionCredentialHash: originalToken,
          actor,
          principal,
        },
        {
          displayName: `Integrity ${label}`,
          reviewPolicy: "MANUAL",
          idempotencyKeyHash: hashIdempotencyKey(`${subject}-project`.padEnd(40, "p")),
          requestFingerprint: fingerprintLifecycleRequest({ label }),
        },
      )
    ).project;
    const nonce = Buffer.alloc(32, label === "owner" ? 51 : 52);
    const intentId = await createStepUpIntent(auth, {
      tokenHash: originalToken,
      nonceHash: nonce,
      actionKey: "MANAGE_SOURCE_AUTHORITY",
      workspaceId: workspace.id,
      projectId: project.id,
      returnPath: `/projects/${project.id}`,
      correlationId: await createDatabaseUuidV7(auth),
    });
    const token = hashSessionCredential(`${subject}-rotated-token`.padEnd(48, "y"));
    await completeStepUpIntent(auth, {
      oldTokenHash: originalToken,
      nonceHash: nonce,
      intentId,
      newTokenHash: token,
      providerSubject: subject,
      providerSessionId: `session_${subject}`,
      freshAuthenticatedAt: new Date(),
      providerExpiresAt: new Date(Date.now() + 3_600_000),
    });
    const context = {
      accountId,
      workspaceId: workspace.id,
      sessionCredentialHash: token,
      actor,
      principal,
      freshAuthenticationSatisfied: true,
    };
    const integrityRepository = new PostgresConflictUncertaintyRepository(appUrl);
    const contextRepository = new PostgresContextRecordRepository(appUrl);
    const authorityRepository = new PostgresSourceAuthorityRepository(appUrl);
    closables.push(projectRepository, integrityRepository, contextRepository, authorityRepository);
    return {
      accountId,
      workspaceId: workspace.id,
      projectId: project.id,
      context,
      integrity: new ConflictUncertaintyService(integrityRepository),
      contextRecords: new ContextRecordService(contextRepository),
      authority: new SourceAuthorityService(authorityRepository),
      repositories: [
        projectRepository,
        integrityRepository,
        contextRepository,
        authorityRepository,
      ],
    };
  }

  async function reviewed(f: Fixture, value: string) {
    sequence += 1;
    const base = {
      projectId: f.projectId,
      identity: {
        subject: "project",
        scope: "architecture",
        facet: "implementation_state:code",
        predicate: "database",
      },
      expectedIdentityVersion: 0,
      expectedCurrentRecordId: null,
      payload: { value },
      originKind: "USER_NATIVE" as const,
    };
    return f.contextRecords.put(f.context, {
      ...base,
      idempotencyKeyHash: hashIdempotencyKey(`reviewed-${sequence}`.padEnd(40, "r")),
      requestFingerprint: fingerprintLifecycleRequest(base),
    });
  }

  async function working(
    f: Fixture,
    contextIdentityId: ContextIdentityId,
    value: string,
  ): Promise<WorkingContextItemId> {
    const submissionSequence = (candidateSequences.get(f.projectId) ?? 0) + 1;
    candidateSequences.set(f.projectId, submissionSequence);
    const submission = (
      await sql<{ id: string }>`insert into memoid.candidate_submissions(workspace_id,project_id,
        submission_sequence,submitted_at,payload_hash,source_frontier_basis)
        values(${f.workspaceId}::uuid,${f.projectId}::uuid,${submissionSequence},clock_timestamp(),
        sha256(convert_to(${value},'UTF8')),'[]'::jsonb) returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    const assertion = (
      await sql<{ id: string }>`insert into memoid.candidate_assertions(workspace_id,project_id,
        candidate_submission_id,assertion_ordinal,origin_kind,confirmation_kind,assertion_payload,assertion_hash)
        values(${f.workspaceId}::uuid,${f.projectId}::uuid,${submission}::uuid,1,'AI_INFERRED','NONE',
        ${JSON.stringify({ value })}::jsonb,sha256(convert_to(${value},'UTF8'))) returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id;
    return (
      await sql<{ id: string }>`insert into memoid.working_context_items(workspace_id,project_id,
        context_identity_id,candidate_assertion_id,trust_qualification,assertion_payload,assertion_hash)
        values(${f.workspaceId}::uuid,${f.projectId}::uuid,${contextIdentityId}::uuid,${assertion}::uuid,
        'PENDING_UNRECONCILED',${JSON.stringify({ value })}::jsonb,sha256(convert_to(${value},'UTF8')))
        returning id::text`.execute(isolated.db)
    ).rows[0]!.id as WorkingContextItemId;
  }

  async function evidence(
    f: Fixture,
    sourceKey: string,
    defaultBranch: string,
    refKey: string,
    contentByte: number,
  ) {
    sequence += 1;
    const sourceId = (
      await sql<{ id: string }>`insert into memoid.sources(workspace_id,project_id,source_kind)
        values(${f.workspaceId}::uuid,${f.projectId}::uuid,'GITHUB_REPOSITORY') returning id::text`.execute(
        isolated.db,
      )
    ).rows[0]!.id as SourceId;
    await sql`insert into memoid.github_source_connections(workspace_id,project_id,source_id,app_id,
      installation_id,account_id,repository_id,owner_login,repository_name,full_name,html_url,visibility,
      default_branch,connection_state,verified_at) values(${f.workspaceId}::uuid,${f.projectId}::uuid,
      ${sourceId}::uuid,'1',${String(sequence)},'3',${String(Date.now() + sequence)},'owner',${sourceKey},
      ${`owner/${sourceKey}`},${`https://github.com/owner/${sourceKey}`},'PRIVATE',${defaultBranch},'ACTIVE',clock_timestamp())`.execute(
      isolated.db,
    );
    const unit = (
      await sql<{
        id: string;
      }>`insert into memoid.source_frontier_units(workspace_id,project_id,source_id,
        scope_key,ref_key) values(${f.workspaceId}::uuid,${f.projectId}::uuid,${sourceId}::uuid,
        'repository',${refKey}) returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    const observation = (
      await sql<{ id: string }>`insert into memoid.source_observations(workspace_id,project_id,
        frontier_unit_id,observation_sequence,external_revision,observed_at)
        values(${f.workspaceId}::uuid,${f.projectId}::uuid,${unit}::uuid,1,${String(sequence).padStart(40, "a")},
        clock_timestamp()) returning id::text`.execute(isolated.db)
    ).rows[0]!.id;
    await sql`insert into memoid.source_frontier_states(workspace_id,project_id,frontier_unit_id,
      observed_sequence,desired_sequence,ingested_sequence) values(${f.workspaceId}::uuid,${f.projectId}::uuid,
      ${unit}::uuid,1,1,1)`.execute(isolated.db);
    const evidenceReferenceId = (
      await sql<{
        id: string;
      }>`insert into memoid.evidence_references(workspace_id,project_id,source_id,
        frontier_unit_id,source_observation_id,observation_sequence,evidence_kind,repository_revision,
        repository_path,provider_object_id,byte_size,content_sha256) values(${f.workspaceId}::uuid,
        ${f.projectId}::uuid,${sourceId}::uuid,${unit}::uuid,${observation}::uuid,1,'FILE',
        ${String(sequence).padStart(40, "b")},'packages/domain/src/index.ts',${sequence.toString(16).padStart(40, "c").slice(-40)},42,
        ${Buffer.alloc(32, contentByte)}::bytea) returning id::text`.execute(isolated.db)
    ).rows[0]!.id as EvidenceReferenceId;
    return { sourceId, evidenceReferenceId };
  }

  async function authority(f: Fixture, sourceId: SourceId): Promise<SourceAuthorityAssignmentId> {
    sequence += 1;
    const base = {
      projectId: f.projectId,
      sourceId,
      categoryFacet: "IMPLEMENTATION_STATE:CODE",
      scopeKind: "PROJECT" as const,
      scopeKey: null,
      refSelector: "ANY_REF" as const,
      refKey: null,
      expectedVersion: 0,
      reasonKey: "INITIAL_REVIEW" as const,
      reasonNote: "Reviewed",
    };
    return (
      await f.authority.set(f.context, {
        ...base,
        idempotencyKeyHash: hashIdempotencyKey(`authority-${sequence}`.padEnd(40, "a")),
        requestFingerprint: fingerprintLifecycleRequest(base),
      })
    ).assignmentId as SourceAuthorityAssignmentId;
  }

  const proof = <T extends Record<string, unknown>>(key: string, base: T) => ({
    idempotencyKeyHash: hashIdempotencyKey(key.padEnd(40, "i")),
    requestFingerprint: fingerprintLifecycleRequest(base),
  });

  it("represents CURRENT + UNCERTAIN without inventing a Conflict and preserves ending history", async () => {
    const current = await reviewed(owner, "PostgreSQL");
    const base = {
      projectId: owner.projectId,
      contextIdentityId: current.contextIdentityId,
      expectedVersion: 0,
      target: { kind: "REVIEWED_CONTEXT" as const, contextRecordId: current.contextRecordId },
      reason: "INCOMPLETE_EVIDENCE" as const,
    };
    const active = await owner.integrity.establishUncertainty(owner.context, {
      ...base,
      ...proof("uncertain-active", base),
    });
    expect(
      await owner.integrity.establishUncertainty(owner.context, {
        ...base,
        ...proof("uncertain-active", base),
      }),
    ).toEqual({
      ...active,
      replayed: true,
    });
    const listed = await owner.integrity.list(owner.context, owner.projectId);
    expect(listed.conflicts).toEqual([]);
    expect(listed.uncertainties[0]).toMatchObject({
      lifecycleState: "ACTIVE",
      reason: "INCOMPLETE_EVIDENCE",
      target: { kind: "REVIEWED_CONTEXT", contextRecordId: current.contextRecordId },
    });
    const endBase = {
      projectId: owner.projectId,
      uncertaintyId: active.uncertaintyId,
      expectedVersion: 1,
      reason: "EVIDENCE_STRENGTHENED" as const,
    };
    await owner.integrity.endUncertainty(owner.context, {
      ...endBase,
      ...proof("uncertain-end", endBase),
    });
    expect((await owner.integrity.list(owner.context, owner.projectId)).uncertainties).toEqual([]);
    expect(
      (await owner.integrity.list(owner.context, owner.projectId, false)).uncertainties[0],
    ).toMatchObject({
      lifecycleState: "ENDED",
      reason: "INCOMPLETE_EVIDENCE",
      endingReason: "EVIDENCE_STRENGTHENED",
      version: 2,
    });
    expect(
      (
        await sql<{ count: string }>`select count(*)::text count from memoid.uncertainty_occurrences
          where uncertainty_id=${active.uncertaintyId}::uuid`.execute(isolated.db)
      ).rows[0]?.count,
    ).toBe("2");
  });

  it("records Working ↔ Reviewed Conflict, changed participants, and no lost concurrent update", async () => {
    const current = await reviewed(owner, "PostgreSQL");
    const firstWorking = await working(owner, current.contextIdentityId, "SQLite");
    const base = {
      projectId: owner.projectId,
      contextIdentityId: current.contextIdentityId,
      expectedVersion: 0,
      classification: "MATERIAL_CONTRADICTION" as const,
      participants: [
        { kind: "WORKING_CONTEXT" as const, workingContextItemId: firstWorking },
        { kind: "REVIEWED_CONTEXT" as const, contextRecordId: current.contextRecordId },
      ],
    };
    const created = await owner.integrity.establishConflict(owner.context, {
      ...base,
      ...proof("working-reviewed", base),
    });
    const secondWorking = await working(owner, current.contextIdentityId, "MySQL");
    const changed = {
      ...base,
      expectedVersion: 1,
      participants: [
        { kind: "WORKING_CONTEXT" as const, workingContextItemId: secondWorking },
        { kind: "REVIEWED_CONTEXT" as const, contextRecordId: current.contextRecordId },
      ],
    };
    const [left, right] = await Promise.allSettled([
      owner.integrity.establishConflict(owner.context, {
        ...changed,
        ...proof("race-left", changed),
      }),
      owner.integrity.establishConflict(owner.context, {
        ...changed,
        ...proof("race-right", changed),
      }),
    ]);
    expect([left.status, right.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect((await owner.integrity.list(owner.context, owner.projectId)).conflicts[0]).toMatchObject(
      {
        conflictId: created.conflictId,
        version: 2,
        lifecycleState: "ACTIVE",
      },
    );
    expect(
      (
        await sql<{ count: string }>`select count(*)::text count from memoid.conflict_occurrences
          where conflict_id=${created.conflictId}::uuid`.execute(isolated.db)
      ).rows[0]?.count,
    ).toBe("2");
  });

  it("qualifies authoritative and shadowed Sources explicitly in a multi-party Conflict", async () => {
    const current = await reviewed(owner, "PostgreSQL");
    const sourceA = await evidence(owner, "source-a", "main", "refs/heads/main", 61);
    const sourceB = await evidence(owner, "source-b", "develop", "refs/heads/develop", 62);
    await authority(owner, sourceA.sourceId);
    const base = {
      projectId: owner.projectId,
      contextIdentityId: current.contextIdentityId,
      expectedVersion: 0,
      classification: "MATERIAL_CONTRADICTION" as const,
      participants: [
        { kind: "SOURCE_EVIDENCE" as const, evidenceReferenceId: sourceA.evidenceReferenceId },
        { kind: "SOURCE_EVIDENCE" as const, evidenceReferenceId: sourceB.evidenceReferenceId },
        { kind: "REVIEWED_CONTEXT" as const, contextRecordId: current.contextRecordId },
      ],
    };
    await owner.integrity.establishConflict(owner.context, {
      ...base,
      ...proof("multi-source", base),
    });
    const sourceParticipants = (
      await owner.integrity.list(owner.context, owner.projectId)
    ).conflicts[0]!.participants.filter((participant) => participant.kind === "SOURCE_EVIDENCE");
    expect(sourceParticipants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceReferenceId: sourceA.evidenceReferenceId,
          sourceId: sourceA.sourceId,
          sourceQualification: "AUTHORITATIVE_CURRENT",
        }),
        expect.objectContaining({
          evidenceReferenceId: sourceB.evidenceReferenceId,
          sourceId: sourceB.sourceId,
          sourceQualification: "SHADOWED",
        }),
      ]),
    );
  });

  it("supports Source ↔ Working without downgrading Source authority and fences ending races", async () => {
    const current = await reviewed(owner, "PostgreSQL");
    const source = await evidence(owner, "source-working", "main", "refs/heads/main", 81);
    await authority(owner, source.sourceId);
    const workingItem = await working(owner, current.contextIdentityId, "SQLite");
    const base = {
      projectId: owner.projectId,
      contextIdentityId: current.contextIdentityId,
      expectedVersion: 0,
      classification: "MATERIAL_CONTRADICTION" as const,
      participants: [
        { kind: "SOURCE_EVIDENCE" as const, evidenceReferenceId: source.evidenceReferenceId },
        { kind: "WORKING_CONTEXT" as const, workingContextItemId: workingItem },
      ],
    };
    const active = await owner.integrity.establishConflict(owner.context, {
      ...base,
      ...proof("source-working", base),
    });
    expect((await owner.integrity.list(owner.context, owner.projectId)).conflicts[0]).toMatchObject(
      {
        participants: expect.arrayContaining([
          expect.objectContaining({
            kind: "SOURCE_EVIDENCE",
            sourceQualification: "AUTHORITATIVE_CURRENT",
          }),
          expect.objectContaining({ kind: "WORKING_CONTEXT" }),
        ]),
      },
    );
    const replacement = await working(owner, current.contextIdentityId, "MySQL");
    const changed = {
      ...base,
      expectedVersion: 1,
      participants: [
        { kind: "SOURCE_EVIDENCE" as const, evidenceReferenceId: source.evidenceReferenceId },
        { kind: "WORKING_CONTEXT" as const, workingContextItemId: replacement },
      ],
    };
    const ending = {
      projectId: owner.projectId,
      conflictId: active.conflictId,
      expectedVersion: 1,
      reason: "INPUTS_NO_LONGER_CONFLICT" as const,
    };
    const outcomes = await Promise.allSettled([
      owner.integrity.establishConflict(owner.context, {
        ...changed,
        ...proof("conflict-new-observation", changed),
      }),
      owner.integrity.endConflict(owner.context, {
        ...ending,
        ...proof("conflict-ending", ending),
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(
      (await owner.integrity.list(owner.context, owner.projectId, false)).conflicts[0]?.version,
    ).toBe(2);
  });

  it("fences Uncertainty clearing against new evidence with the same monotonic CAS", async () => {
    const current = await reviewed(owner, "PostgreSQL");
    const base = {
      projectId: owner.projectId,
      contextIdentityId: current.contextIdentityId,
      expectedVersion: 0,
      target: { kind: "SEMANTIC_IDENTITY" as const, contextIdentityId: current.contextIdentityId },
      reason: "AMBIGUOUS_INTERPRETATION" as const,
    };
    const active = await owner.integrity.establishUncertainty(owner.context, {
      ...base,
      ...proof("uncertainty-race-base", base),
    });
    const changed = { ...base, expectedVersion: 1, reason: "WEAK_SUPPORT" as const };
    const ending = {
      projectId: owner.projectId,
      uncertaintyId: active.uncertaintyId,
      expectedVersion: 1,
      reason: "INTERPRETATION_CLARIFIED" as const,
    };
    const outcomes = await Promise.allSettled([
      owner.integrity.establishUncertainty(owner.context, {
        ...changed,
        ...proof("uncertainty-new-evidence", changed),
      }),
      owner.integrity.endUncertainty(owner.context, {
        ...ending,
        ...proof("uncertainty-clearing", ending),
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(
      (await owner.integrity.list(owner.context, owner.projectId, false)).uncertainties[0]?.version,
    ).toBe(2);
  });

  it("rejects semantically identical claims and known foreign IDs", async () => {
    const current = await reviewed(owner, "PostgreSQL");
    const sourceA = await evidence(owner, "same-a", "main", "refs/heads/main", 70);
    const sourceB = await evidence(owner, "same-b", "develop", "refs/heads/develop", 70);
    await authority(owner, sourceA.sourceId);
    const identicalBase = {
      projectId: owner.projectId,
      contextIdentityId: current.contextIdentityId,
      expectedVersion: 0,
      classification: "MATERIAL_CONTRADICTION" as const,
      participants: [
        { kind: "SOURCE_EVIDENCE" as const, evidenceReferenceId: sourceA.evidenceReferenceId },
        { kind: "SOURCE_EVIDENCE" as const, evidenceReferenceId: sourceB.evidenceReferenceId },
      ],
    };
    await expect(
      owner.integrity.establishConflict(owner.context, {
        ...identicalBase,
        ...proof("identical-claims", identicalBase),
      }),
    ).rejects.toThrow("COMPATIBLE_CONFLICT_PARTICIPANTS");
    const foreignCurrent = await reviewed(foreign, "SQLite");
    const foreignBase = {
      ...identicalBase,
      participants: [
        { kind: "REVIEWED_CONTEXT" as const, contextRecordId: current.contextRecordId },
        { kind: "REVIEWED_CONTEXT" as const, contextRecordId: foreignCurrent.contextRecordId },
      ],
    };
    await expect(
      owner.integrity.establishConflict(owner.context, {
        ...foreignBase,
        ...proof("foreign-known-id", foreignBase),
      }),
    ).rejects.toThrow("INVALID_CONFLICT_REVIEWED_CONTEXT");
    await expect(
      owner.integrity.establishUncertainty(owner.context, {
        projectId: owner.projectId,
        contextIdentityId: current.contextIdentityId,
        expectedVersion: 0,
        target: {
          kind: "REVIEWED_CONTEXT",
          contextRecordId: foreignCurrent.contextRecordId as ContextRecordId,
        },
        reason: "AMBIGUOUS_INTERPRETATION",
        ...proof("foreign-uncertainty", { foreign: foreignCurrent.contextRecordId }),
      }),
    ).rejects.toThrow("INVALID_UNCERTAINTY_TARGET");
  });

  it("fails closed when a Reviewed participant is no longer the current Context Record", async () => {
    const first = await reviewed(owner, "PostgreSQL");
    const revisionBase = {
      projectId: owner.projectId,
      identity: {
        subject: "project",
        scope: "architecture",
        facet: "implementation_state:code",
        predicate: "database",
      },
      expectedIdentityVersion: 1,
      expectedCurrentRecordId: first.contextRecordId,
      payload: { value: "PostgreSQL 18" },
      originKind: "USER_NATIVE" as const,
    };
    await owner.contextRecords.put(owner.context, {
      ...revisionBase,
      idempotencyKeyHash: hashIdempotencyKey("context-race-revision".padEnd(40, "r")),
      requestFingerprint: fingerprintLifecycleRequest(revisionBase),
    });
    const workingItem = await working(owner, first.contextIdentityId, "SQLite");
    const conflictBase = {
      projectId: owner.projectId,
      contextIdentityId: first.contextIdentityId,
      expectedVersion: 0,
      classification: "MATERIAL_CONTRADICTION" as const,
      participants: [
        { kind: "WORKING_CONTEXT" as const, workingContextItemId: workingItem },
        { kind: "REVIEWED_CONTEXT" as const, contextRecordId: first.contextRecordId },
      ],
    };
    await expect(
      owner.integrity.establishConflict(owner.context, {
        ...conflictBase,
        ...proof("stale-reviewed-context", conflictBase),
      }),
    ).rejects.toThrow("INVALID_CONFLICT_REVIEWED_CONTEXT");
  });
});
