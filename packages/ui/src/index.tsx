"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as Label from "@radix-ui/react-label";
import { Slot } from "@radix-ui/react-slot";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import {
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

export function Button({
  variant = "default",
  asChild = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary";
  asChild?: boolean;
}) {
  const C = asChild ? Slot : "button";
  return <C className="m-button" data-variant={variant} {...props} />;
}
export function IconButton({
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button className="m-button m-icon-button" aria-label={label} {...props} />;
}
export function Badge({
  tone = "info",
  symbol,
  children,
}: {
  tone?: "success" | "warning" | "conflict" | "danger" | "info";
  symbol?: string;
  children: ReactNode;
}) {
  return (
    <span className="m-badge" data-tone={tone}>
      {symbol && <span aria-hidden="true">{symbol}</span>}
      {children}
    </span>
  );
}
export function Banner({
  title,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { title: string }) {
  return (
    <section className="m-banner" {...props}>
      <strong>{title}</strong>
      <div>{children}</div>
    </section>
  );
}
export function Dialog({
  trigger,
  title,
  description,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="m-dialog-overlay" />
        <DialogPrimitive.Content className="m-dialog">
          <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description>{description}</DialogPrimitive.Description>
          {children}
          <DialogPrimitive.Close asChild>
            <Button>Cancel</Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function Drawer({
  trigger,
  title,
  children,
}: {
  trigger: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="m-dialog-overlay" />
        <DialogPrimitive.Content className="m-dialog m-drawer">
          <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          {children}
          <DialogPrimitive.Close asChild>
            <Button>Close</Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function Tabs({
  items,
}: {
  items: ReadonlyArray<{ id: string; label: string; content: ReactNode }>;
}) {
  const first = items[0];
  if (!first) return null;
  return (
    <TabsPrimitive.Root defaultValue={first.id}>
      <TabsPrimitive.List className="m-tabs-list" aria-label="Foundation specimens">
        {items.map((i) => (
          <TabsPrimitive.Trigger className="m-tab" key={i.id} value={i.id}>
            {i.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((i) => (
        <TabsPrimitive.Content key={i.id} value={i.id}>
          {i.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
export function Field({
  label,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="m-field">
      <Label.Root htmlFor={id}>{label}</Label.Root>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        {...props}
      />
      {error && (
        <span className="m-error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}
export function DataTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: readonly string[];
  rows: ReadonlyArray<readonly ReactNode[]>;
}) {
  return (
    <table className="m-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {headers.map((h) => (
            <th scope="col" key={h}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export const EmptyState = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="m-state">
    <h3>{title}</h3>
    {children}
  </section>
);
export const ErrorState = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="m-state" role="alert">
    <h3>{title}</h3>
    {children}
  </section>
);
export const OperationState = ({ state, children }: { state: string; children: ReactNode }) => (
  <section className="m-state" role="status" aria-live="polite">
    <Badge tone={state === "FAILED" ? "danger" : "info"}>{state}</Badge>
    {children}
  </section>
);
export function SemanticDiff({ existing, proposed }: { existing: ReactNode; proposed: ReactNode }) {
  return (
    <div className="m-diff" aria-label="Semantic change">
      <section aria-labelledby="existing-heading">
        <h3 id="existing-heading">Existing</h3>
        {existing}
      </section>
      <section aria-labelledby="proposed-heading">
        <h3 id="proposed-heading">Proposed</h3>
        {proposed}
      </section>
    </div>
  );
}
