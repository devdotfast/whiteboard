// Containers are placed by wb.layout(); only their kinds, names and code
// are written here.
const node = (id, kind, label, tag, code) =>
  wb.node({ id, kind, label, tag, code });

const viewer = node("viewer", "person", "Viewer");

const web = node("web", "container", "Web app", "Container · React", "web-app");

const tv = node("tv", "container", "TV app", "Container · Kotlin", "tv-app");

const gateway = node(
  "gateway",
  "container",
  "API gateway",
  "Container · Go",
  "gateway",
);

const playback = node(
  "playback",
  "container",
  "Playback API",
  "Container · Go",
  "playback",
);

const catalog = node(
  "catalog",
  "container",
  "Catalog API",
  "Container · Node.js",
  "catalog",
);

const accounts = node(
  "accounts",
  "database",
  "Accounts",
  "Database · Postgres",
  "accounts",
);

const payments = node("payments", "external", "Payments", "External · Stripe");

wb.edge({ from: viewer, to: web });

wb.edge({ from: viewer, to: tv });

wb.edge({ from: web, to: gateway, label: "HTTPS", code: "web-calls-gateway" });

wb.edge({ from: tv, to: gateway, label: "HTTPS", code: "tv-calls-gateway" });

wb.edge({
  from: gateway,
  to: playback,
  label: "gRPC",
  code: "gateway-playback",
});

wb.edge({ from: gateway, to: catalog, label: "gRPC", code: "gateway-catalog" });

wb.edge({ from: playback, to: accounts, label: "SQL", code: "playback-plan" });

wb.edge({
  from: gateway,
  to: payments,
  dashed: true,
  code: "gateway-payments",
});

const clients = wb.group({
  id: "clients",
  label: "Client apps",
  around: [web, tv],
  color: "sky",
});

const streaming = wb.group({
  id: "streaming",
  label: "Playback",
  around: [playback, accounts],
  color: "violet",
});

const browse = wb.group({
  id: "browse",
  label: "Catalog",
  around: [catalog],
  color: "amber",
});

wb.group({
  id: "platform",
  label: "Streaming platform",
  tag: "Software system",
  around: [gateway, streaming, browse],
});

void clients;

await wb.layout({ direction: "right" });
