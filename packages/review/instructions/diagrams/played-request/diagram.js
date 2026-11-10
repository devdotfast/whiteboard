const client = wb.node({
  id: "client",
  kind: "container",
  label: "Client",
  tag: "Container · Go",
  code: "client-call",
});

const service = wb.node({
  id: "service",
  kind: "container",
  label: "Pricing",
  tag: "Container · Java",
  code: "pricing",
});

const call = wb.edge({ from: client, to: service, label: "GET /price" });

await wb.layout({ direction: "right", layerSpacing: 200 });

const request = wb.token({ label: "GET" });

const reply = wb.token({ label: "200", tone: "reply" });

// Places a token at a fraction of the way along the wire.
const place = (token, fraction, reverse = false) => {
  const length = call.getTotalLength();

  const point = call.getPointAtLength(
    (reverse ? 1 - fraction : fraction) * length,
  );

  token.hidden = false;
  token.style.left = `${point.x}px`;
  token.style.top = `${point.y}px`;
};

wb.onTime((time, { chapter, chapterTime }) => {
  const progress = chapter ? chapterTime / chapter.duration : 0;
  request.hidden = true;
  reply.hidden = true;
  client.dataset.state = "default";
  service.dataset.state = "default";

  switch (chapter?.key) {
    case "call":
      place(request, progress);
      break;
    case "wait":
      service.dataset.state = "active";
      break;
    case "timeout":
      client.dataset.state = "dimmed";
      service.dataset.state = "active";
      break;
    case "late":
      client.dataset.state = "dimmed";
      place(reply, progress, true);
      break;
  }
});
