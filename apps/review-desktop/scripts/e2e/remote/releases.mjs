/** This checkout's remote tarballs and install.sh over plain HTTP, as install.dev.fast serves a release's; any path resolves by file name. */
import { createReadStream } from "node:fs";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDevRemoteTarball } from "../../build-remote-tarball.mjs";

/** An address both the laptop and its containers reach: host.docker.internal does not resolve on a macOS laptop. */
function laptopAddress() {
  const address = Object.values(networkInterfaces())
    .flat()
    .find(
      (entry) =>
        entry.family === "IPv4" &&
        !entry.internal &&
        !entry.address.startsWith("169.254."),
    )?.address;

  if (!address)
    throw new Error("no network address the containers can reach this laptop at");

  return address;
}

const INSTALL_SCRIPT = fileURLToPath(
  new URL("../../../../../packages/review/remote/install.sh", import.meta.url),
);

export async function serveReleases() {
  const dir = await mkdtemp(path.join(tmpdir(), "wb-releases-"));
  await copyFile(INSTALL_SCRIPT, path.join(dir, "install.sh"));

  const server = createServer(async (request, response) => {
    let name;

    try {
      name = decodeURIComponent(new URL(request.url, "http://x").pathname.slice(1));
    } catch {
      return response.writeHead(400).end();
    }

    const file = path.join(dir, path.basename(name));

    const found =
      name === "" ||
      (await stat(file).then((s) => s.isFile(), () => false));

    response.writeHead(found ? 200 : 404);

    if (!found || name === "" || request.method === "HEAD") return response.end();

    createReadStream(file).pipe(response);
  });

  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));

  return {
    url: `http://${laptopAddress()}:${server.address().port}/`,
    async stage(target, version) {
      const built = await buildDevRemoteTarball({
        target,
        version,
        stdio: ["ignore", process.stderr, process.stderr],
      });

      for (const suffix of ["", ".sha256"])
        await copyFile(
          `${built.file}${suffix}`,
          path.join(dir, `${path.basename(built.file)}${suffix}`),
        );
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    },
  };
}
