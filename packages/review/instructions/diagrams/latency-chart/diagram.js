// Checkout latency around a bad deploy: a line chart of two weeks of p50
// and p95, and a bar chart of p95 by endpoint. Each step re-draws both to
// point at what it is about. The charts give no position: the stage stacks
// them at the column's width, and the summary in diagram.html goes under
// them.
const day = (n) => new Date(Date.UTC(2026, 9, 19 + n));

const DEPLOY = day(7);

const REVERT = day(11);

// Daily latency in ms. The deploy slows the tax call; the revert undoes it.
const p50 = [
  118, 121, 117, 123, 120, 119, 122, 171, 176, 182, 174, 124, 119, 121,
];

const p95 = [
  342, 351, 338, 356, 347, 344, 352, 698, 731, 744, 712, 361, 346, 349,
];

// One row per day too, so a tip can show both percentiles at once.
const days = p50.map((value, n) => ({ day: day(n), p50: value, p95: p95[n] }));

const date = (d) =>
  d.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const latency = p50.flatMap((value, n) => [
  { day: day(n), percentile: "p50", ms: value },
  { day: day(n), percentile: "p95", ms: p95[n] },
]);

// p95 by endpoint on the worst day, before and after the deploy.
const endpoints = [
  { endpoint: "/checkout/tax", before: 210, after: 590 },
  { endpoint: "/checkout/cart", before: 160, after: 168 },
  { endpoint: "/checkout/pay", before: 240, after: 246 },
  { endpoint: "/checkout/ship", before: 130, after: 134 },
];

const at = (frame) => frame?.key ?? "overview";

wb.chart({
  id: "latency",
  label: "Checkout latency, p50 and p95",
  code: "latency-query",
  height: 200,
  plot: ({ Plot, colors, frame }) => {
    const step = at(frame);
    const marks = [];

    // The regression window, as a faint wash behind the lines.
    if (step === "regression" || step === "cause")
      marks.push(
        Plot.rectX([{ from: DEPLOY, to: REVERT }], {
          x1: "from",
          x2: "to",
          fill: colors.accent,
          fillOpacity: 0.08,
        }),
      );

    marks.push(
      Plot.ruleY([0], { stroke: colors.line }),
      // Straight segments: there is one value a day and nothing between.
      Plot.lineY(latency, {
        x: "day",
        y: "ms",
        stroke: "percentile",
        strokeWidth: 2,
      }),
      Plot.dot(
        latency,
        Plot.selectLast({
          x: "day",
          y: "ms",
          fill: "percentile",
          r: 4,
          stroke: colors.surface,
          strokeWidth: 2,
        }),
      ),
      // Direct labels at the line ends, in text colour, beside their dot.
      Plot.text(
        latency,
        Plot.selectLast({
          x: "day",
          y: "ms",
          z: "percentile",
          text: "percentile",
          dx: 10,
          textAnchor: "start",
          fill: colors.ink,
          fontWeight: 600,
        }),
      ),
      // Hover: a hairline at the nearest day and a tip with both values.
      Plot.ruleX(days, Plot.pointerX({ x: "day", stroke: colors.faint })),
      Plot.tip(
        days,
        Plot.pointerX({
          x: "day",
          y: "p95",
          title: (d) => `${date(d.day)}\np95  ${d.p95} ms\np50  ${d.p50} ms`,
        }),
      ),
    );

    if (step !== "overview")
      marks.push(
        Plot.ruleX([DEPLOY], { stroke: colors.ink, strokeDasharray: "3 3" }),
        Plot.text([DEPLOY], {
          x: (d) => d,
          frameAnchor: "top",
          text: () => "deploy #482",
          dx: 6,
          textAnchor: "start",
          fill: colors.ink,
          fontWeight: 600,
        }),
      );

    if (step === "fix")
      marks.push(
        Plot.ruleX([REVERT], { stroke: colors.ink, strokeDasharray: "3 3" }),
        Plot.text([REVERT], {
          x: (d) => d,
          frameAnchor: "top",
          text: () => "revert",
          dx: 6,
          textAnchor: "start",
          fill: colors.ink,
          fontWeight: 600,
        }),
      );

    return {
      title: "Checkout latency, p50 and p95",
      marginTop: 28,
      marginRight: 48,
      marginLeft: 48,
      x: { type: "utc", label: null, tickFormat: date },
      // Headroom over the highest value keeps the notes at the top of the
      // frame clear of the lines.
      y: { grid: true, label: "ms", domain: [0, 1000] },
      color: { legend: true, domain: ["p50", "p95"] },
      marks,
    };
  },
});

wb.chart({
  id: "endpoints",
  label: "p95 by endpoint, before and after the deploy",
  code: "latency-query",
  height: 200,
  plot: ({ Plot, colors, frame }) => {
    const step = at(frame);
    // After the revert each endpoint is back to its value before the deploy.
    const shown = step === "fix" ? "before" : "after";

    // On the cause step the tax call keeps its colour and the rest recede.
    const fill = (d) =>
      step === "cause" && d.endpoint !== "/checkout/tax"
        ? colors.line
        : colors.series[0];

    return {
      title: "p95 by endpoint, before and after the deploy",
      marginLeft: 120,
      marginRight: 56,
      x: {
        grid: true,
        label:
          shown === "after"
            ? "p95 after the deploy (ms)"
            : "p95 after the revert (ms)",
        labelAnchor: "left",
        domain: [0, 650],
      },
      y: {
        label: null,
        domain: endpoints.map((d) => d.endpoint),
        padding: 0.45,
      },
      marks: [
        Plot.ruleX([0], { stroke: colors.line }),
        Plot.barX(endpoints, {
          x: shown,
          y: "endpoint",
          fill,
          rx2y1: 4,
          rx2y2: 4,
          tip: { format: { x: (v) => `${v} ms`, fill: false } },
        }),
        // Value at each bar's tip, in text colour.
        Plot.text(endpoints, {
          x: shown,
          y: "endpoint",
          text: (d) => `${d[shown]} ms`,
          dx: 8,
          textAnchor: "start",
          fill: colors.muted,
        }),
      ],
    };
  },
});

// The summary under the charts: each step's numbers come from its data.
const summary = (name) => document.querySelector(`[data-summary="${name}"]`);

wb.onFrame((frame) => {
  const { p95, slo, errors } = frame?.data ?? {};

  summary("p95").textContent = p95 ?? "";
  summary("slo").textContent = slo ?? "";
  summary("errors").textContent = errors ?? "";
});
