const client = wb.node({ id: "client", kind: "external", label: "Client" });

const gateway = wb.node({
  id: "gateway",
  kind: "container",
  label: "API gateway",
  tag: "Container · Go",
  code: "gateway",
});

const api = wb.node({ id: "api", kind: "container", label: "API service" });

const redis = wb.node({
  id: "redis",
  kind: "database",
  label: "Buckets",
  tag: "Database · Redis",
});

wb.edge({ from: client, to: gateway, label: "HTTPS" });

wb.edge({ from: gateway, to: api, label: "HTTP" });

wb.edge({ from: gateway, to: redis, label: "EVAL", code: "take-token" });

await wb.layout({ direction: "down" });

// The panel is diagram.html's; each frame's data says what it shows.
const left = document.querySelector("[data-tokens]");

const pips = [...document.querySelectorAll("[data-pip]")];

const decision = document.querySelector("[data-decision]");

wb.onFrame((frame) => {
  const { tokens, decision: said } = frame?.data ?? { tokens: 3, decision: "" };

  left.textContent = `${tokens} of 5`;
  pips.forEach((pip, index) =>
    pip.toggleAttribute("data-full", index < tokens),
  );
  decision.textContent = said;
});
