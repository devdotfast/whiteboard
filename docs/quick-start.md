# Quick start

1. [Download Whiteboard](https://dev.fast/install) for macOS, Windows, or Linux
   and open it. [Preview builds](https://dev.fast/install/preview) install
   alongside the stable app.
2. On the **Install Whiteboard** screen, check the coding agents you use and
   select **Install**. Whiteboard installs the `whiteboard` command and connects
   each agent. See [Connect your agent](connect-your-agent.md) to do this later
   or by hand.
3. Restart your agent. Then, in your repository, ask it:

   ```text
   Review changes from my current branch against main and open the result in Whiteboard.
   ```

See [Create a review](create-a-review.md) for what happens next.

## Install the `whiteboard` command

If you skipped the **Install Whiteboard** screen, open Settings and select
**Install** under Command line. Open a new terminal and run:

```sh
whiteboard --version
```

On macOS and Linux, make sure that `~/.local/bin` is on your shell's PATH.
