// One event fanned out to three subscribers, placed by hand. The broker is
// as tall as the column of subscribers, so every wire runs straight across;
// the wires to one subscriber run side by side with their labels apart.
const node = (id, kind, label, tag, x, y, height, code) =>
  wb.node({ id, kind, label, tag, x, y, width: 112, height, code });

const orders = node("orders", "container", "Orders", "Service", 0, 100, 52);

const broker = node(
  "broker",
  "queue",
  "Broker",
  "Topic",
  196,
  0,
  252,
  "deliver",
);

const subscribers = [
  ["billing", "Billing"],
  ["email", "Email"],
  ["audit", "Audit log"],
].map(([id, label], row) => ({
  id,
  element: node(id, "container", label, "Subscriber", 404, row * 100, 52),
}));

// The group's padding of 12 leaves the labelled wires room before its edge.
wb.group({
  label: "Subscribers",
  tag: "own queues",
  around: subscribers.map(({ element }) => element),
  padding: 12,
});

wb.edge({
  id: "publish",
  from: orders,
  to: broker,
  label: "publish",
  code: "publish",
});

for (const { id, element: subscriber } of subscribers) {
  wb.edge({
    id: `deliver-${id}`,
    from: broker,
    to: subscriber,
    label: "deliver",
    code: "deliver",
  });

  // Only email times out, so only its wires carry a retry.
  if (id === "email")
    wb.edge({
      id: "retry-email",
      from: broker,
      to: subscriber,
      label: "retry",
      code: "retry",
    });

  wb.edge({
    id: `ack-${id}`,
    from: subscriber,
    to: broker,
    label: "ack",
    code: "ack",
  });
}

await wb.layout({ mode: "manual" });

// The panel is diagram.html's; each frame's data says each delivery's state.
wb.onFrame((frame) => {
  for (const cell of document.querySelectorAll("[data-delivery]"))
    cell.textContent = frame?.data?.[cell.dataset.delivery] ?? "";
});
