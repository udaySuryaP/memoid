import {
  Badge,
  Banner,
  Button,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  OperationState,
  SemanticDiff,
  Tabs,
} from "@memoid/ui";
export default function Foundation() {
  return (
    <main>
      <header>
        <p className="eyebrow">Stage 8B · non-product specimen</p>
        <h1>Quiet Technical Workbench foundation</h1>
        <p>Accessible primitives, normalized tokens, typography, and deterministic states.</p>
      </header>
      <section>
        <h2>Actions and status</h2>
        <div className="row">
          <Button variant="primary">Primary action</Button>
          <Button>Secondary action</Button>
          <IconButton label="Open specimen menu">⋯</IconButton>
          <Badge tone="success" symbol="●">
            Fresh
          </Badge>
          <Badge tone="warning" symbol="◷">
            Stale
          </Badge>
          <Badge tone="conflict" symbol="⇄">
            Open conflict
          </Badge>
        </div>
        <Banner title="Independent integrity dimensions">
          Current does not imply fresh; conflict does not imply uncertainty.
        </Banner>
      </section>
      <section>
        <h2>Overlays and forms</h2>
        <div className="row">
          <Dialog
            trigger={<Button>Open dialog</Button>}
            title="Accessible dialog"
            description="Focus is trapped, Escape closes, and focus returns to the trigger."
          >
            <p>Foundation-only interaction specimen.</p>
          </Dialog>
          <Drawer trigger={<Button>Open drawer</Button>} title="Accessible drawer">
            <p>Responsive overlay specimen.</p>
          </Drawer>
        </div>
        <Field label="Synthetic label" placeholder="No credentials" />
        <Field label="Invalid field" error="A clear error is associated with this field." />
      </section>
      <section>
        <h2>Semantic diff</h2>
        <SemanticDiff
          existing={<p>Existing foundation assertion</p>}
          proposed={<p>Proposed foundation assertion</p>}
        />
      </section>
      <section>
        <h2>Lists and states</h2>
        <DataTable
          caption="Synthetic foundation status"
          headers={["Boundary", "State"]}
          rows={[
            ["Web", "Ready"],
            ["API", "Ready"],
            ["Worker", "Ready"],
          ]}
        />
        <div className="grid">
          <EmptyState title="No synthetic items">
            <p>Nothing has been added.</p>
          </EmptyState>
          <ErrorState title="Synthetic failure">
            <p>A recovery path would appear here.</p>
          </ErrorState>
          <OperationState state="RUNNING">
            <p>Persistent status is announced.</p>
          </OperationState>
        </div>
      </section>
      <section>
        <h2>Tabs</h2>
        <Tabs
          items={[
            { id: "tokens", label: "Tokens", content: <p>Primitive → semantic → component.</p> },
            {
              id: "a11y",
              label: "Accessibility",
              content: <p>Keyboard, names, focus, live regions, and reduced motion.</p>,
            },
          ]}
        />
      </section>
    </main>
  );
}
