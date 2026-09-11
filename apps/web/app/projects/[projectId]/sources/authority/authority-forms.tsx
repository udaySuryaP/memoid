"use client";

import type { AuthoritySourceOption } from "@memoid/application/source-authority";
import type { AuthorityAssignmentView } from "@memoid/domain/source-authority";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  revokeSourceAuthorityAction,
  setSourceAuthorityAction,
  type AuthorityFormState,
} from "./actions";

const initial: AuthorityFormState = {};

function Submit({
  children,
  danger = false,
}: {
  readonly children: string;
  readonly danger?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={danger ? "danger-action" : "primary-action"}
      disabled={pending}
      type="submit"
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

function IdempotencyField() {
  const [key, setKey] = useState("");
  useEffect(() => setKey(globalThis.crypto.randomUUID()), []);
  return <input name="idempotencyKey" type="hidden" value={key} />;
}

export function NewAuthorityForm(props: {
  readonly projectId: string;
  readonly sources: readonly AuthoritySourceOption[];
}) {
  const [state, action] = useActionState(setSourceAuthorityAction, initial);
  return (
    <form action={action} className="project-form authority-form">
      <IdempotencyField />
      <input name="projectId" type="hidden" value={props.projectId} />
      <input name="expectedVersion" type="hidden" value="0" />
      <input name="reasonKey" type="hidden" value="INITIAL_REVIEW" />
      <label>
        Source
        <select name="sourceId" required>
          {props.sources
            .filter((source) => source.available)
            .map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
        </select>
      </label>
      <label>
        Category and facet
        <select name="categoryFacet" required>
          <option value="IMPLEMENTATION_STATE:CODE">Implementation state · code</option>
          <option value="IMPLEMENTATION_STATE:CONFIGURATION">
            Implementation state · configuration
          </option>
          <option value="ARCHITECTURE_INTENT:DOCUMENTATION">
            Architecture intent · documentation
          </option>
          <option value="ARCHITECTURE_INTENT:DECISION">Architecture intent · decision</option>
          <option value="PROVIDER_STATE:ISSUE_STATE">Provider state · issues</option>
          <option value="PROVIDER_STATE:PULL_REQUEST_STATE">Provider state · pull requests</option>
        </select>
      </label>
      <label>
        Semantic scope
        <select name="scopeKind" defaultValue="PROJECT">
          <option value="PROJECT">Whole project</option>
          <option value="PATH_PREFIX">Repository path prefix</option>
        </select>
      </label>
      <label>
        Path prefix <span className="muted">Use only with path-prefix scope</span>
        <input name="scopeKey" placeholder="packages/domain" maxLength={1024} />
      </label>
      <label>
        Ref boundary
        <select name="refSelector" defaultValue="DEFAULT_BRANCH">
          <option value="DEFAULT_BRANCH">Current reviewed default branch</option>
          <option value="EXACT_REF">Exact branch ref</option>
          <option value="ANY_REF">Any ref</option>
        </select>
      </label>
      <label>
        Exact ref <span className="muted">Use only with exact-ref boundary</span>
        <input name="refKey" placeholder="refs/heads/release" maxLength={1024} />
      </label>
      <label>
        Review note <span className="muted">Optional, never evidence</span>
        <textarea name="reasonNote" maxLength={500} rows={3} />
      </label>
      <label className="authority-confirmation">
        <input name="confirmedImpact" required type="checkbox" value="yes" />
        <span>
          I reviewed the category, facet, scope, and ref boundary. This decision grants evidence
          authority only; it does not grant instruction or application authority.
        </span>
      </label>
      {state.message ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <Submit>Assign authority</Submit>
    </form>
  );
}

export function ReplaceAuthorityForm(props: {
  readonly projectId: string;
  readonly assignment: AuthorityAssignmentView;
  readonly sources: readonly AuthoritySourceOption[];
}) {
  const [state, action] = useActionState(setSourceAuthorityAction, initial);
  const a = props.assignment;
  return (
    <details className="authority-review">
      <summary>Change assigned Source</summary>
      <form action={action} className="project-form authority-form">
        <IdempotencyField />
        <input name="projectId" type="hidden" value={props.projectId} />
        <input name="categoryFacet" type="hidden" value={`${a.category}:${a.facet}`} />
        <input name="scopeKind" type="hidden" value={a.scopeKind} />
        <input name="scopeKey" type="hidden" value={a.scopeKey} />
        <input name="refSelector" type="hidden" value={a.refSelector} />
        <input name="refKey" type="hidden" value={a.refKey ?? ""} />
        <input name="expectedVersion" type="hidden" value={a.version} />
        <input name="reasonKey" type="hidden" value="SOURCE_REPLACEMENT" />
        <div className="authority-impact" role="note">
          <strong>Current</strong>
          <span>{a.sourceLabel}</span>
          <strong>Impact</strong>
          <span>
            Only {a.category.replaceAll("_", " ")} · {a.facet.replaceAll("_", " ")} at{" "}
            {a.scopeKind === "PROJECT" ? "the whole project" : a.scopeKey} and{" "}
            {a.refKey ?? a.refSelector.replaceAll("_", " ")} changes. Other assignments are
            unaffected.
          </span>
        </div>
        <label>
          Proposed Source
          <select defaultValue={a.sourceId} name="sourceId" required>
            {props.sources
              .filter((source) => source.available)
              .map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
          </select>
        </label>
        <label>
          Review note <span className="muted">Optional, never evidence</span>
          <textarea name="reasonNote" maxLength={500} rows={3} />
        </label>
        <label className="authority-confirmation">
          <input name="confirmedImpact" required type="checkbox" value="yes" />
          <span>I reviewed the current and proposed Source and the exact bounded impact.</span>
        </label>
        {state.message ? (
          <p className="form-error" role="alert">
            {state.message}
          </p>
        ) : null}
        <Submit>Replace Source</Submit>
      </form>
    </details>
  );
}

export function ReconfirmAuthorityForm(props: {
  readonly projectId: string;
  readonly assignment: AuthorityAssignmentView;
}) {
  const [state, action] = useActionState(setSourceAuthorityAction, initial);
  const a = props.assignment;
  return (
    <form action={action} className="authority-inline-form">
      <IdempotencyField />
      <input name="projectId" type="hidden" value={props.projectId} />
      <input name="sourceId" type="hidden" value={a.sourceId} />
      <input name="categoryFacet" type="hidden" value={`${a.category}:${a.facet}`} />
      <input name="scopeKind" type="hidden" value={a.scopeKind} />
      <input name="scopeKey" type="hidden" value={a.scopeKey} />
      <input name="refSelector" type="hidden" value={a.refSelector} />
      <input name="refKey" type="hidden" value={a.refKey ?? ""} />
      <input name="expectedVersion" type="hidden" value={a.version} />
      <input name="reasonKey" type="hidden" value="DEFAULT_BRANCH_REVALIDATION" />
      <input name="confirmedImpact" type="hidden" value="yes" />
      {state.message ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <Submit>Review and reconfirm</Submit>
    </form>
  );
}

export function RevokeAuthorityForm(props: {
  readonly projectId: string;
  readonly assignment: AuthorityAssignmentView;
}) {
  const [state, action] = useActionState(revokeSourceAuthorityAction, initial);
  return (
    <form action={action} className="authority-inline-form">
      <IdempotencyField />
      <input name="projectId" type="hidden" value={props.projectId} />
      <input name="scopeId" type="hidden" value={props.assignment.scopeId} />
      <input name="expectedVersion" type="hidden" value={props.assignment.version} />
      <input name="reasonKey" type="hidden" value="SCOPE_CORRECTION" />
      <label className="authority-confirmation">
        <input name="confirmedImpact" required type="checkbox" value="yes" />
        <span>
          I understand this revokes only the displayed scope and Memoid will fail closed where no
          other assignment applies.
        </span>
      </label>
      {state.message ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <Submit danger>Revoke</Submit>
    </form>
  );
}
