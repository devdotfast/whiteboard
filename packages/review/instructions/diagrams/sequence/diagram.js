const browser = wb.node({
  id: "browser",
  kind: "container",
  label: "Browser",
  tag: "Container · React",
  code: "login-form",
});

const api = wb.node({
  id: "api",
  kind: "container",
  label: "API",
  tag: "Container · Go",
  code: "login-handler",
});

const auth = wb.node({
  id: "auth",
  kind: "container",
  label: "Auth service",
  tag: "Container · Go",
  code: "verify",
});

const sessions = wb.node({
  id: "sessions",
  kind: "database",
  label: "Sessions",
  tag: "Database · Redis",
  code: "session-store",
});

const events = wb.node({
  id: "events",
  kind: "queue",
  label: "Audit events",
  tag: "Queue · Kafka",
  code: "audit-topic",
});

wb.edge({ from: browser, to: api, label: "POST /login", code: "submit" });

wb.edge({ from: api, to: auth, label: "gRPC", code: "call-verify" });

wb.edge({ from: api, to: sessions, label: "SET", code: "save-session" });

wb.edge({
  from: api,
  to: events,
  dashed: true,
  label: "publish",
  code: "publish-login",
});

await wb.layout({ direction: "right" });
