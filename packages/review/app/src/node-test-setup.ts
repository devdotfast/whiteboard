import { beforeAll } from "vitest";

import { preloadBoardEditor } from "./whiteboard";

// Desktop loads the board editor at startup; a board that mounts before it
// arrives renders nothing until the lazy import settles.
beforeAll(preloadBoardEditor);
