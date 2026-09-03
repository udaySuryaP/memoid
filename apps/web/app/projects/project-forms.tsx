"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { createProjectAction, updateProjectAction, type ProjectFormState } from "./actions";

const initialState: ProjectFormState = {};

function SubmitButton({ children }: { readonly children: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-action" disabled={pending} type="submit">
      {pending ? "Saving…" : children}
    </button>
  );
}

export function CreateProjectForm() {
  const [state, action] = useActionState(createProjectAction, initialState);
  const [key, setKey] = useState("");
  useEffect(() => setKey(globalThis.crypto.randomUUID()), []);
  return (
    <form action={action} className="project-form">
      <input name="idempotencyKey" type="hidden" value={key} />
      <label>
        Project name
        <input autoFocus maxLength={120} name="displayName" required />
      </label>
      <label>
        Description <span className="muted">Optional</span>
        <textarea maxLength={2000} name="description" rows={4} />
      </label>
      <fieldset>
        <legend>Review policy</legend>
        <label className="choice">
          <input defaultChecked name="reviewPolicy" type="radio" value="MANUAL" /> Manual review
        </label>
        <label className="choice">
          <input name="reviewPolicy" type="radio" value="AUTOMATIC" /> Automatic review
        </label>
      </fieldset>
      {state.message ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {key ? <SubmitButton>Create project</SubmitButton> : null}
    </form>
  );
}

export function UpdateProjectForm(props: {
  readonly projectId: string;
  readonly version: number;
  readonly displayName: string;
  readonly description: string | null;
}) {
  const [state, action] = useActionState(updateProjectAction, initialState);
  return (
    <form action={action} className="project-form">
      <input name="projectId" type="hidden" value={props.projectId} />
      <input name="expectedVersion" type="hidden" value={props.version} />
      <label>
        Project name
        <input defaultValue={props.displayName} maxLength={120} name="displayName" required />
      </label>
      <label>
        Description <span className="muted">Optional</span>
        <textarea
          defaultValue={props.description ?? ""}
          maxLength={2000}
          name="description"
          rows={4}
        />
      </label>
      {state.message ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}
