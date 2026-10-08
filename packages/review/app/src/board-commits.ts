import { createContext } from "react";

/** The commits a board reads its own code at: its pins' head and base.
 * Code quoted at any other commit names it. A plan has none. */
export const BoardCommitsContext = createContext<readonly string[] | null>(
  null,
);
