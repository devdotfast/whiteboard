import type { JsonObject } from "@dev.fast/json";

import { GitHubProvider } from "./github-provider.js";
import type { PullRequestDeps, PullRequestRecord } from "./pull-request.js";

export interface ParsedPullRequestAddress {
  provider: string;
  host: string;
  canonicalSlug: string;
  number: number;
  rawUrl: string;
  providerMetadata?: JsonObject;
}

export interface PullRequestRefMap {
  localHead: string;
  localBase: string;
  localFrozenBase: string;
  fetchRefspecs: string[];
}

export interface CredentialOptions {
  gitArgs: string[];
}

export interface PullRequestProvider {
  id: string;
  parseUrl(url: string): ParsedPullRequestAddress | null;
  readPullRequest(
    address: ParsedPullRequestAddress,
    deps: PullRequestDeps,
  ): Promise<PullRequestRecord>;
  pullRequestRefs(
    address: ParsedPullRequestAddress,
    pr: PullRequestRecord,
  ): PullRequestRefMap;
  matchesRemote(remoteUrl: string, address: ParsedPullRequestAddress): boolean;
  credentialOptions(
    address: ParsedPullRequestAddress,
    deps: PullRequestDeps,
  ): Promise<CredentialOptions>;
}

export interface ProviderResolution {
  provider: PullRequestProvider;
  address: ParsedPullRequestAddress;
}

export class PullRequestProviderRegistry {
  private readonly providers: PullRequestProvider[] = [];

  register(provider: PullRequestProvider): void {
    const index = this.providers.findIndex((p) => p.id === provider.id);

    if (index >= 0) {
      this.providers[index] = provider;
    } else {
      this.providers.push(provider);
    }
  }

  resolve(url: string): ProviderResolution | null {
    for (const provider of this.providers) {
      const address = provider.parseUrl(url);

      if (address) {
        return { provider, address };
      }
    }

    return null;
  }

  all(): readonly PullRequestProvider[] {
    return this.providers;
  }

  clear(): void {
    this.providers.length = 0;
  }
}

export const defaultProviderRegistry = new PullRequestProviderRegistry();

defaultProviderRegistry.register(new GitHubProvider());

export function registerPullRequestProvider(
  provider: PullRequestProvider,
): void {
  defaultProviderRegistry.register(provider);
}

export function resolvePullRequestProvider(
  url: string,
): ProviderResolution | null {
  return defaultProviderRegistry.resolve(url);
}

export function getRegisteredProviders(): readonly PullRequestProvider[] {
  return defaultProviderRegistry.all();
}
