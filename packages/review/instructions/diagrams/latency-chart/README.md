# Latency chart

Two weeks of checkout latency around a bad deploy, as a line chart and a bar chart that each step redraws to point at what it is about.

## Use when

The evidence is a number over time or across categories: a regression, a capacity limit, an error rate by endpoint. The chart makes the case and the code link shows where the data comes from.

## Shows

- A line chart of p50 and p95 by day, labelled at the line ends, with a tip on hover.
- A bar chart of p95 by endpoint on the worst day.
- A summary under the charts: p95, how it stands against the SLO, and the error rate, for each step.
- Steps: the two weeks, the regression window, the endpoint that caused it, the revert.

## Technique

`wb.chart({ plot })` returns ordinary Observable Plot options and redraws on every step, so `plot` reads `frame.key` to add a wash, a rule or an emphasis. The stage supplies the palette in fixed order; the script colours text with `colors.ink` and `colors.muted`, never with a series colour. Each chart's Plot `title` is the heading the reader sees; its `label` only names it. The charts give no position, so the stage stacks them at the column's width. `diagram.html` is the page: the `data-wb-drawing` element the charts draw in, then a summary strip under it, as wide as the page; a `wb.onFrame` listener writes each step's numbers into it from the frame's `data`.

## Adapt

- One axis per chart: two measures of different scale get two charts.
- Label series directly and keep the legend; never a number on every point.
- A note at the top of the frame needs headroom: end the y domain well above the highest value, or anchor the note at the bottom. The stage reports a note that sits on a line or dot.
- Two charts side by side: give each `x`, `y` and `width`, such as `width: 340` at `x: 0` and `x: 356`, and no `wb.layout`.
- Name the query or code that produces the data in `code`.
