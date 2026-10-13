import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "release-scripts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, "apps/review-desktop/scripts");
  const bin = path.join(root, "bin");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bin);

  const copy = (name) =>
    cpSync(new URL(name, import.meta.url), path.join(scripts, name));

  const mock = (names, source) => {
    const executable = path.join(bin, names[0]);
    writeFileSync(executable, `#!${process.execPath}\n${source}`, {
      mode: 0o755,
    });

    for (const name of names.slice(1))
      symlinkSync(executable, path.join(bin, name));
  };

  const run = (script, args = [], env = {}) =>
    spawnSync("bash", [path.join(scripts, script), ...args], {
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TEST_ROOT: root,
        ...env,
      },
    });

  return { root, scripts, copy, mock, run };
}

for (const failed of ["", "43", "44", "ubuntu", "arch"]) {
  test(`Linux repository validation collects every result (failure: ${failed || "none"})`, (t) => {
    const f = fixture(t);
    mkdirSync(path.join(f.scripts, "linux"));
    f.copy("linux/verify-repository.sh");
    const publication = path.join(f.root, "publication");
    mkdirSync(path.join(publication, "repos"), { recursive: true });
    writeFileSync(
      path.join(publication, "repos/current.json"),
      JSON.stringify({
        format: "rpm",
        generation: "test",
        keyFingerprint: "test",
      }),
    );
    f.mock(
      ["docker"],
      `
      const fs = require('node:fs');
      const root = process.env.TEST_ROOT;
      const image = process.argv.find(arg => /^(fedora|ubuntu|archlinux):/.test(arg));
      const target = image.startsWith('fedora:') ? image.split(':')[1].split('@')[0] : image.split(':')[0].replace('archlinux', 'arch');
      fs.writeFileSync(root + '/finished-' + target, '');
      process.exit(target === process.env.FAIL_TARGET ? 1 : 0);
    `,
    );

    const result = f.run("linux/verify-repository.sh", [publication], {
      FAIL_TARGET: failed,
    });

    assert.equal(result.status, failed ? 1 : 0, result.stderr);
    assert.equal(
      readdirSync(f.root).filter((name) => name.startsWith("finished-")).length,
      4,
    );
  });
}

for (const quality of ["stable", "preview"]) {
  for (const failure of [
    "",
    "dmg",
    "Review",
    "upload",
    "wait",
    ...(quality === "preview"
      ? [
          "submit-network-retry",
          "submit-tempfail-retry",
          "wait-http-retry",
          "staple-network-retry",
          "validate-network-retry",
          "network-exhausted",
          "auth",
          "ticket-invalid",
        ]
      : []),
  ]) {
    test(
      `notarization gates final ZIPs on acceptance and tickets (${quality}, ${failure || "accepted"})`,
      { skip: process.platform !== "darwin" },
      (t) => {
        const f = fixture(t);

        for (const name of [
          "notarize-macos.sh",
          "darwin-arch.sh",
          "release-channel.mjs",
        ])
          f.copy(name);
        const appDir = path.dirname(f.scripts);

        const product =
          quality === "stable" ? "Whiteboard" : "Whiteboard Preview";

        const target = `darwin-${process.arch}`;
        const bundle = path.join(appDir, `VSCode-${target}`, `${product}.app`);
        mkdirSync(path.join(bundle, "Contents/MacOS"), { recursive: true });
        writeFileSync(
          path.join(bundle, "Contents/MacOS", product),
          "executable",
        );
        writeFileSync(
          path.join(bundle, "Contents/Info.plist"),
          `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>${product}</string></dict></plist>`,
        );
        mkdirSync(path.join(appDir, "code-oss/build/darwin"), {
          recursive: true,
        });
        writeFileSync(path.join(appDir, "code-oss/build/darwin/sign.ts"), "");
        writeFileSync(
          path.join(appDir, "code-oss/product.json"),
          JSON.stringify({ nameShort: product, quality }),
        );
        writeFileSync(path.join(appDir, "package.json"), '{"version":"1.2.3"}');
        f.mock(
          ["xcrun", "codesign", "spctl", "ditto", "hdiutil", "sleep"],
          `
        const fs = require('node:fs');
        const path = require('node:path');
        const args = process.argv.slice(2);
        const tool = path.basename(process.argv[1]);
        const root = process.env.TEST_ROOT;
        const fail = process.env.FAIL_NOTARY;
        if (tool === 'sleep') {
          fs.appendFileSync(root + '/sleeps', args[0] + '\\n');
          process.exit(0);
        }
        if (tool === 'ditto') {
          const [src, dest] = args.slice(-2);
          if (args.includes('-c')) {
            if (!dest.endsWith('-notarize.zip') && !fs.existsSync(src + '/ticket')) process.exit(20);
            fs.writeFileSync(dest, 'archive');
          } else fs.cpSync(src, dest, { recursive: true });
        } else if (tool === 'hdiutil') fs.writeFileSync(args.at(-1), 'dmg');
        else if (tool === 'xcrun') {
          const network = 'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."';
          const faults = {
            'submit-network-retry': ['notarytool submit', 1, network, 1],
            'submit-tempfail-retry': ['notarytool submit', 75, 'Temporary service failure', 1],
            'wait-http-retry': ['notarytool wait', 1, 'Error: internalError(statusCode: Optional(503))', 1],
            'staple-network-retry': ['stapler staple', 68, network, 1],
            'validate-network-retry': ['stapler validate', 68, network, 1],
            'network-exhausted': ['stapler validate', 68, network, Infinity],
            'auth': ['notarytool submit', 1, 'HTTP status code: 401. Unauthorized.', Infinity],
            'ticket-invalid': ['stapler staple', 68, 'The path has not been previously notarized.', Infinity],
          };
          const fault = faults[fail];
          if (fault && args.slice(0, 2).join(' ') === fault[0]) {
            const counter = root + '/fault-attempts';
            const attempts = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
            fs.writeFileSync(counter, String(attempts + 1));
            if (attempts < fault[3]) {
              console.log('Incomplete Apple response');
              console.error(fault[2]);
              process.exit(fault[1]);
            }
          }
          if (args[0] === 'notarytool' && args[1] === 'submit') {
            if (fail === 'upload') process.exit(1);
            const id = args[2].endsWith('.dmg') ? 'dmg' : 'Review';
            console.log(JSON.stringify({ id }));
          } else if (args[0] === 'notarytool' && args[1] === 'wait') {
            if (fail === 'wait') process.exit(1);
            console.log(JSON.stringify({ id: args[2], status: fail === args[2] ? 'Invalid' : 'Accepted' }));
          } else if (args[0] === 'stapler' && args[1] === 'staple') {
            if (args[2].endsWith('.app')) fs.writeFileSync(args[2] + '/ticket', '');
          }
        }
      `,
        );

        const result = f.run("notarize-macos.sh", [], {
          CODESIGN_IDENTITY: "test",
          NOTARY_KEYCHAIN_PROFILE: "test",
          SKIP_NOTARIZE: "0",
          DEV_FAST_REVIEW_ARTIFACT_DIR: path.join(appDir, "dist"),
          FAIL_NOTARY: failure,
        });

        const zips = readdirSync(path.join(appDir, "dist")).filter((name) =>
          name.endsWith(".zip"),
        );

        if (failure && !failure.endsWith("-retry")) {
          assert.notEqual(result.status, 0, result.stdout);
          assert.deepEqual(zips, []);
        } else {
          assert.equal(result.status, 0, result.stderr);
          assert.deepEqual(zips.sort(), [
            `Review-${target}-1.2.3.zip`,
            `Whiteboard-${target}-1.2.3.zip`,
          ]);
          assert.equal(readFileSync(path.join(bundle, "ticket"), "utf8"), "");
        }

        if (failure.endsWith("-retry") || failure === "network-exhausted") {
          const delays = readFileSync(path.join(f.root, "sleeps"), "utf8")
            .trim()
            .split("\n")
            .map(Number);

          assert.equal(delays.length, failure === "network-exhausted" ? 4 : 1);
          assert.ok(delays.every((delay) => delay > 0));
          assert.equal(result.status, failure === "network-exhausted" ? 68 : 0);
        } else {
          assert.ok(!readdirSync(f.root).includes("sleeps"));
        }
      },
    );
  }
}
