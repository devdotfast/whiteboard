import { errorMessage } from "@dev.fast/trace-core";
import { z } from "zod";

import { ReviewInputError } from "./document.js";
import type { PullRequestAddress, PullRequestProvider } from "./provider.js";
import { firstLine } from "./pull-request.js";

const AZ_TIMEOUT_MS = 30_000;

const MODERN_ADO_PR_REGEX =
  /^https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/([1-9]\d*)$/;

const LEGACY_ADO_PR_REGEX =
  /^https:\/\/([^.]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/]+)\/pullrequest\/([1-9]\d*)$/;

const metadataSchema = z.object({
  title: z.string(),
  sourceRefName: z.string().min(1),
  targetRefName: z.string().min(1),
  lastMergeTargetCommit: z
    .object({
      commitId: z.string().min(1),
    })
    .optional(),
});

function parseAdoRemote(
  url: string,
): { org: string; project: string; repo: string } | undefined {
  const trimmed = url.trim();

  const modernHttps =
    /^https:\/\/(?:[^@]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+?)(?:\.git)?\/?$/.exec(
      trimmed,
    );

  if (modernHttps) {
    return {
      org: decodeURIComponent(modernHttps[1]!),
      project: decodeURIComponent(modernHttps[2]!),
      repo: decodeURIComponent(modernHttps[3]!),
    };
  }

  const legacyHttps =
    /^https:\/\/([^.]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/]+?)(?:\.git)?\/?$/.exec(
      trimmed,
    );

  if (legacyHttps) {
    return {
      org: decodeURIComponent(legacyHttps[1]!),
      project: decodeURIComponent(legacyHttps[2]!),
      repo: decodeURIComponent(legacyHttps[3]!),
    };
  }

  const modernSsh =
    /^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
      trimmed,
    );

  if (modernSsh) {
    return {
      org: decodeURIComponent(modernSsh[1]!),
      project: decodeURIComponent(modernSsh[2]!),
      repo: decodeURIComponent(modernSsh[3]!),
    };
  }

  const legacySsh =
    /^[^@]+@vs-ssh\.visualstudio\.com:v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
      trimmed,
    );

  if (legacySsh) {
    return {
      org: decodeURIComponent(legacySsh[1]!),
      project: decodeURIComponent(legacySsh[2]!),
      repo: decodeURIComponent(legacySsh[3]!),
    };
  }

  return undefined;
}

export const azureDevOpsProvider: PullRequestProvider = {
  id: "azure-devops",

  parseUrl(url) {
    const match =
      MODERN_ADO_PR_REGEX.exec(url) ?? LEGACY_ADO_PR_REGEX.exec(url);

    if (!match) return undefined;

    const number = Number(match[4]);

    if (!Number.isSafeInteger(number)) return undefined;

    try {
      const org = decodeURIComponent(match[1]!);
      const project = decodeURIComponent(match[2]!);
      const repo = decodeURIComponent(match[3]!);

      return {
        host: "dev.azure.com",
        slug: `${org}/${project}/${repo}`,
        number,
      };
    } catch {
      return undefined;
    }
  },

  async readPullRequest({ host, slug, number }, deps) {
    const [org, project, repo] = slug.split("/");
    const url = `https://dev.azure.com/${org}/${project}/_git/${repo}/pullrequest/${number}`;

    let stdout: string;

    try {
      stdout = await deps.run(
        "az",
        [
          "repos",
          "pr",
          "show",
          "--id",
          String(number),
          "--detect",
          "false",
          "--organization",
          `https://dev.azure.com/${org}`,
          "--project",
          project!,
          "--output",
          "json",
        ],
        { timeoutMs: AZ_TIMEOUT_MS },
      );
    } catch (error) {
      const failure = firstLine(errorMessage(error));
      const lower = failure.toLowerCase();

      if (
        lower.includes("not recognized as an internal or external command") ||
        lower.includes("command not found") ||
        lower.includes("enoent")
      ) {
        throw new ReviewInputError(
          `Could not read ${url}: az failed (${failure}). Install the Azure CLI and the azure-devops extension, then retry.`,
          409,
        );
      }

      if (
        lower.includes("extension") ||
        lower.includes("unknown command 'repos'") ||
        lower.includes('unknown command "repos"') ||
        lower.includes("'repos' is not in the 'az' command group")
      ) {
        throw new ReviewInputError(
          `Could not read ${url}: az failed (${failure}). Run \`az extension add --name azure-devops\`, then retry.`,
          409,
        );
      }

      if (
        lower.includes("az login") ||
        lower.includes("aadsts") ||
        lower.includes("please run 'az login'") ||
        lower.includes('please run "az login"')
      ) {
        throw new ReviewInputError(
          `Could not read ${url}: az failed (${failure}). Run \`az login\` to sign in, then retry.`,
          409,
        );
      }

      if (
        lower.includes("tf401027") ||
        lower.includes("not found") ||
        lower.includes("does not exist")
      ) {
        throw new ReviewInputError(
          `${url} was not found: it does not exist, or it is private and az is not signed in to an account that can read it. az said: ${failure}`,
          404,
        );
      }

      throw new ReviewInputError(
        `Could not read ${url}: az failed (${failure}). Check your Azure DevOps connection and credentials, then retry.`,
        409,
      );
    }

    const json = await Promise.resolve()
      .then(() => JSON.parse(stdout))
      .catch(() => undefined);

    const parsed = metadataSchema.safeParse(json);

    if (!parsed.success) {
      throw new ReviewInputError(
        `Could not read ${url}: the Azure DevOps response was malformed.`,
        409,
      );
    }

    return {
      host,
      slug,
      number,
      title: parsed.data.title,
      headRef: parsed.data.sourceRefName,
      baseRefName: parsed.data.targetRefName.replace(/^refs\/heads\//, ""),
      baseRefOid: parsed.data.lastMergeTargetCommit?.commitId,
    };
  },

  matchesRemote(remoteUrl, address) {
    const remote = parseAdoRemote(remoteUrl);

    if (!remote) return false;

    const [expectedOrg, expectedProject, expectedRepo] =
      address.slug.split("/");

    return (
      remote.org.toLowerCase() === expectedOrg?.toLowerCase() &&
      remote.project.toLowerCase() === expectedProject?.toLowerCase() &&
      remote.repo.toLowerCase() === expectedRepo?.toLowerCase()
    );
  },
};
