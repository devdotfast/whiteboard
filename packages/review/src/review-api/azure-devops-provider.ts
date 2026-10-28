import { errorMessage } from "@dev.fast/trace-core";
import { ReviewInputError } from "@dev.fast/whiteboard-document";
import { z } from "zod";

import { azureRepositoryOf, slugOf } from "./azure-remote.js";
import type { PullRequestProvider } from "./provider.js";
import { firstLine } from "./pull-request.js";

const AZ_TIMEOUT_MS = 30_000;

const PULL_REQUEST_URLS = [
  /^https:\/\/dev\.azure\.com\/([A-Za-z0-9-]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/([1-9]\d*)$/,
  /^https:\/\/([A-Za-z0-9-]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/]+)\/pullrequest\/([1-9]\d*)$/,
];

const metadataSchema = z.object({
  title: z.string(),
  sourceRefName: z.string().min(1),
  targetRefName: z.string().min(1),
  lastMergeTargetCommit: z.object({ commitId: z.string().min(1) }).optional(),
  forkSource: z.object({}).optional(),
  repository: z.object({
    name: z.string(),
    project: z.object({ name: z.string() }),
  }),
});

function azFailure(url: string, failure: string) {
  const unreadable = (hint: string) =>
    new ReviewInputError(
      `Could not read ${url}: az failed (${failure}). ${hint}`,
      409,
    );

  if (
    /not recognized as an internal or external command|command not found|enoent/i.test(
      failure,
    )
  )
    return unreadable(
      "Install the Azure CLI and the azure-devops extension, then retry.",
    );

  if (
    /extension|unknown command ['"]repos['"]|'repos' is not in the 'az' command group/i.test(
      failure,
    )
  )
    return unreadable(
      "Run `az extension add --name azure-devops`, then retry.",
    );

  if (/az login|aadsts/i.test(failure))
    return unreadable("Run `az login` to sign in, then retry.");

  if (/tf401027|not found|does not exist/i.test(failure))
    return new ReviewInputError(
      `${url} was not found: it does not exist, or it is private and az is not signed in to an account that can read it. az said: ${failure}`,
      404,
    );

  return unreadable(
    "Check your Azure DevOps connection and credentials, then retry.",
  );
}

export const azureDevOpsProvider: PullRequestProvider = {
  id: "azure-devops",

  parseUrl(url) {
    const slug = slugOf(PULL_REQUEST_URLS, url);
    const number = Number(url.split("/").at(-1));

    if (!slug || !Number.isSafeInteger(number)) return undefined;

    return { host: "dev.azure.com", slug, number };
  },

  async readPullRequest({ host, slug, number }, deps) {
    const [org, project, repo] = slug.split("/");
    const url = `https://dev.azure.com/${org}/${project}/_git/${repo}/pullrequest/${number}`;

    const args = [
      "repos",
      "pr",
      "show",
      "--id",
      String(number),
      "--detect",
      "false",
      "--organization",
      `https://dev.azure.com/${org}`,
      "--output",
      "json",
      "--only-show-errors",
    ];

    let stdout: string;

    try {
      // Windows installs az as az.cmd, which execFile cannot start directly.
      stdout =
        process.platform === "win32"
          ? await deps.run("cmd.exe", ["/d", "/s", "/c", "az", ...args], {
              timeoutMs: AZ_TIMEOUT_MS,
            })
          : await deps.run("az", args, { timeoutMs: AZ_TIMEOUT_MS });
    } catch (error) {
      throw azFailure(url, firstLine(errorMessage(error)));
    }

    let pr: z.infer<typeof metadataSchema>;

    try {
      pr = metadataSchema.parse(JSON.parse(stdout));
    } catch {
      throw new ReviewInputError(
        `Could not read ${url}: the Azure DevOps response was malformed.`,
        409,
      );
    }

    // PR numbers are unique per organization, so az ignores project and repository.
    const actual = `${pr.repository.project.name}/${pr.repository.name}`;

    if (actual.toLowerCase() !== `${project}/${repo}`.toLowerCase())
      throw new ReviewInputError(
        `${url} was not found: PR ${number} belongs to ${actual}.`,
        404,
      );

    return {
      host,
      slug,
      number,
      title: pr.title,
      headRef: pr.sourceRefName,
      baseRefName: pr.targetRefName.replace(/^refs\/heads\//, ""),
      baseRefOid: pr.lastMergeTargetCommit?.commitId,
      headBranch: pr.forkSource
        ? undefined
        : pr.sourceRefName.replace(/^refs\/heads\//, ""),
    };
  },

  matchesRemote(remoteUrl, address) {
    return (
      azureRepositoryOf(remoteUrl)?.toLowerCase() === address.slug.toLowerCase()
    );
  },
};
