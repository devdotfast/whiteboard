// Two workers share a lock service and a store. A diamond placed by hand:
// the lock above, the store below and a worker on each side, so each wire
// has a path of its own.
const node = (id, kind, label, tag, x, y, code) =>
  wb.node({ id, kind, label, tag, x, y, width: 112, height: 52, code });

const a = node("a", "container", "Worker A", "Worker", 0, 132);

const lock = node(
  "lock",
  "container",
  "Lock service",
  "Leases",
  192,
  0,
  "acquire",
);

const b = node("b", "container", "Worker B", "Worker", 384, 132);

const store = node(
  "store",
  "database",
  "Store",
  "Database",
  192,
  264,
  "check-token",
);

wb.edge({ id: "a-lock", from: a, to: lock, label: "acquire", code: "acquire" });

wb.edge({ id: "b-lock", from: b, to: lock, label: "acquire", code: "acquire" });

wb.edge({
  id: "a-store",
  from: a,
  to: store,
  label: "write",
  code: "check-token",
});

wb.edge({
  id: "b-store",
  from: b,
  to: store,
  label: "write",
  code: "check-token",
});

await wb.layout({ mode: "manual" });

// The panel is diagram.html's; each frame's data says what it shows.
const field = (name) => document.querySelector(`[data-lock="${name}"]`);

wb.onFrame((frame) => {
  const state = frame?.data ?? {};

  for (const name of ["holder", "lease", "token", "highest"])
    field(name).textContent = state[name] ?? "";
});
