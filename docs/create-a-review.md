# Create a review

Once you [connect an agent](connect-your-agent.md), ask it to review your
changes. Keep Whiteboard open and run your agent in the repository. For example:

```text
Review changes from my current branch against main and open the result in Whiteboard.
```

## Read the review

The review appears in Whiteboard as your agent writes it. Select a diagram step
or code link to open its source.

![A sequence diagram beside the source code for its selected step](assets/diagram-to-code.webp)

## Plan and review a stack

When your agent plans work in Whiteboard, it keeps the plan and its changes
together automatically. For example:

```text
Plan this work in Whiteboard.
```

As the agent implements the plan, it adds a child board for each PR and puts the
children in dependency order. When reviewing an existing stack, ask:

```text
Review this PR stack in Whiteboard.
```

The agent creates an overview with one child per PR, each showing that PR's
changes. You do not need to specify the board structure or links.

Open a stack in the sidebar to see its children. Hover over a row, or move
keyboard focus to it, to reveal its controls. The chevron expands the children;
the title opens the board. The plus button creates and opens an empty child of
a top-level board.
