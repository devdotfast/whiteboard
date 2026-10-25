import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { codexConfigFolders, recentFolders } from "./recent-folders";

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(path.join(tmpdir(), "recent-folders-"));
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

async function write(file: string, text: string) {
  await mkdir(path.dirname(path.join(homeDir, file)), { recursive: true });
  await writeFile(path.join(homeDir, file), text);
}

describe("recentFolders", () => {
  it("gathers the folders Claude Code, Codex, Cursor and VS Code worked in", async () => {
    await write(
      ".claude.json",
      JSON.stringify({ projects: { "/code/api": {}, "/code/web": {} } }),
    );
    await write(
      ".codex/config.toml",
      'model = "gpt"\n\n[projects."/code/api"]\ntrust_level = "trusted"\n\n[projects."/code/billing"]\n',
    );
    await write(
      "Library/Application Support/Cursor/User/globalStorage/storage.json",
      JSON.stringify({
        profileAssociations: {
          workspaces: {
            "file:///code/cursor%20app": "__default__profile__",
            "vscode-remote://ssh-remote%2Bbox/srv/app": "__default__profile__",
          },
        },
        backupWorkspaces: { folders: [{ folderUri: "file:///code/unsaved" }] },
      }),
    );
    // Linux keeps VS Code's data elsewhere; this one must not be read on macOS.
    await write(
      ".config/Code/User/globalStorage/storage.json",
      JSON.stringify({
        profileAssociations: { workspaces: { "file:///code/linux": "" } },
      }),
    );

    const folders = await recentFolders({
      homeDir,
      env: {},
      platform: "darwin",
    });

    expect(folders.sort()).toEqual([
      "/code/api",
      "/code/billing",
      "/code/cursor app",
      "/code/unsaved",
      "/code/web",
    ]);
  });

  it("finds nothing, without failing, on a machine with none of them", async () => {
    await write(".claude.json", "{ not json");

    expect(
      await recentFolders({ homeDir, env: {}, platform: "linux" }),
    ).toEqual([]);
  });
});

describe("codexConfigFolders", () => {
  it("reads basic and literal project keys, Windows paths included", () => {
    expect(
      codexConfigFolders(
        [
          '[projects."C:\\\\Users\\\\me\\\\api"]',
          "[projects.'C:\\Users\\me\\web']",
          '[projects."/code/a \\"quoted\\" name"]',
          "[profiles.fast]",
        ].join("\n"),
      ),
    ).toEqual([
      "C:\\Users\\me\\api",
      "C:\\Users\\me\\web",
      '/code/a "quoted" name',
    ]);
  });
});
