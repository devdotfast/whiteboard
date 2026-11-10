const node = (id, kind, label, tag, code) =>
  wb.node({ id, kind, label, tag, code });

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

wb.edge({ from: web, to: gateway, label: "HTTPS", code: "web-search" });

wb.edge({ from: tv, to: gateway, label: "HTTPS", code: "tv-play" });

wb.edge({
  from: gateway,
  to: playback,
  label: "gRPC",
  code: "gateway-manifest",
});

wb.edge({
  from: gateway,
  to: catalog,
  label: "gRPC",
  code: ["gateway-title", "gateway-search"],
});

wb.edge({ from: playback, to: accounts, label: "SQL", code: "playback-plan" });

wb.group({
  id: "clients",
  label: "Client apps",
  around: [web, tv],
  color: "sky",
});

wb.group({
  id: "platform",
  label: "Platform",
  around: [gateway, playback, catalog, accounts],
  color: "violet",
});

await wb.layout({ direction: "right" });
