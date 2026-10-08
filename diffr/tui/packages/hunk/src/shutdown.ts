/** Tie the interactive frontend's lifetime to its terminal and launching parent. */
export function installShutdownHandlers(input: NodeJS.ReadStream, quit: () => void) {
  let quitting = false;
  const shutdown = () => {
    if (quitting) return;
    quitting = true;
    quit();
  };
  // Own these signals instead of only letting OpenTUI destroy its renderer.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "SIGPIPE"] as const) {
    process.once(signal, shutdown);
  }
  input.once("end", shutdown);
  input.once("close", shutdown);
  input.once("error", shutdown);
  process.stdout.once("error", shutdown);

  // A launcher can disappear without delivering a terminal hangup (e.g. SIGKILL).
  const parent = process.ppid;
  const watchdog = setInterval(() => {
    if (process.ppid !== parent || process.ppid === 1) shutdown();
  }, 1000);
  watchdog.unref();
  if (input.destroyed || input.readableEnded) shutdown();
}
