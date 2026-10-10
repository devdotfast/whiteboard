import { describe, expect, it } from "vitest";

import { GitHubProvider } from "./github-provider.js";
import {
  type ParsedPullRequestAddress,
  type PullRequestProvider,
  PullRequestProviderRegistry,
  defaultProviderRegistry,
  getRegisteredProviders,
  registerPullRequestProvider,
  resolvePullRequestProvider,
} from "./provider.js";

describe("GitHubProvider", () => {
  const provider = new GitHubProvider();

  describe("parseUrl", () => {
    it("parses canonical github.com PR URLs", () => {
      const parsed = provider.parseUrl(
        "https://github.com/facebook/react/pull/12345",
      );

      expect(parsed).toEqual({
        provider: "github",
        host: "github.com",
        canonicalSlug: "facebook/react",
        number: 12345,
        rawUrl: "https://github.com/facebook/react/pull/12345",
      });
    });

    it("parses GitHub Enterprise PR URLs", () => {
      const parsed = provider.parseUrl(
        "https://ghe.mycompany.internal/core/auth/pull/42",
      );

      expect(parsed).toEqual({
        provider: "github",
        host: "ghe.mycompany.internal",
        canonicalSlug: "core/auth",
        number: 42,
        rawUrl: "https://ghe.mycompany.internal/core/auth/pull/42",
      });
    });

    it("rejects non-PR URLs or invalid paths", () => {
      expect(provider.parseUrl("https://github.com/facebook/react")).toBeNull();
      expect(
        provider.parseUrl("https://github.com/facebook/react/pull/0"),
      ).toBeNull();
      expect(
        provider.parseUrl("https://github.com/facebook/react/pull/abc"),
      ).toBeNull();
      expect(
        provider.parseUrl("http://github.com/facebook/react/pull/123"),
      ).toBeNull();
      expect(provider.parseUrl("not-a-url")).toBeNull();
    });

    it("rejects integers larger than Number.MAX_SAFE_INTEGER", () => {
      expect(
        provider.parseUrl(
          "https://github.com/facebook/react/pull/999999999999999999999999999999",
        ),
      ).toBeNull();
    });
  });

  describe("pullRequestRefs", () => {
    it("generates local review refs and fetch refspecs for github.com", () => {
      const address: ParsedPullRequestAddress = {
        provider: "github",
        host: "github.com",
        canonicalSlug: "facebook/react",
        number: 12345,
        rawUrl: "https://github.com/facebook/react/pull/12345",
      };

      const refs = provider.pullRequestRefs(address, {
        host: "github.com",
        slug: "facebook/react",
        number: 12345,
        title: "Test PR",
        baseRefName: "main",
      });

      expect(refs.localHead).toBe(
        "refs/review/github/facebook/react/pull/12345/head",
      );
      expect(refs.localBase).toBe(
        "refs/review/github/facebook/react/pull/12345/base",
      );
      expect(refs.localFrozenBase).toBe(
        "refs/review/github/facebook/react/pull/12345/frozen-base",
      );
      expect(refs.fetchRefspecs).toEqual([
        "+refs/pull/12345/head:refs/review/github/facebook/react/pull/12345/head",
        "+refs/heads/main:refs/review/github/facebook/react/pull/12345/base",
      ]);
    });

    it("includes the host in the ref prefix for GitHub Enterprise hosts", () => {
      const address: ParsedPullRequestAddress = {
        provider: "github",
        host: "ghe.mycompany.internal",
        canonicalSlug: "core/auth",
        number: 42,
        rawUrl: "https://ghe.mycompany.internal/core/auth/pull/42",
      };

      const refs = provider.pullRequestRefs(address, {
        host: "ghe.mycompany.internal",
        slug: "core/auth",
        number: 42,
        title: "Enterprise PR",
        baseRefName: "develop",
      });

      expect(refs.localHead).toBe(
        "refs/review/github/ghe.mycompany.internal/core/auth/pull/42/head",
      );
    });
  });

  describe("matchesRemote", () => {
    const address: ParsedPullRequestAddress = {
      provider: "github",
      host: "github.com",
      canonicalSlug: "acme/widget",
      number: 7,
      rawUrl: "https://github.com/acme/widget/pull/7",
    };

    it("matches HTTPS and SSH remotes case-insensitively", () => {
      expect(
        provider.matchesRemote("https://github.com/acme/widget.git", address),
      ).toBe(true);
      expect(
        provider.matchesRemote("git@github.com:Acme/Widget.git", address),
      ).toBe(true);
      expect(
        provider.matchesRemote("https://github.com/ACME/WIDGET", address),
      ).toBe(true);
    });

    it("rejects mismatched repos or hosts", () => {
      expect(
        provider.matchesRemote("https://github.com/acme/other.git", address),
      ).toBe(false);
      expect(
        provider.matchesRemote("https://gitlab.com/acme/widget.git", address),
      ).toBe(false);
      expect(provider.matchesRemote("invalid-remote", address)).toBe(false);
    });
  });

  describe("credentialOptions", () => {
    it("returns empty gitArgs for standard GitHub operations", async () => {
      const address: ParsedPullRequestAddress = {
        provider: "github",
        host: "github.com",
        canonicalSlug: "acme/widget",
        number: 7,
        rawUrl: "https://github.com/acme/widget/pull/7",
      };

      const options = await provider.credentialOptions(address, {
        run: async () => "",
        fetch: async () => new Response(),
      });

      expect(options).toEqual({ gitArgs: [] });
    });
  });
});

describe("PullRequestProviderRegistry", () => {
  it("resolves GitHub URLs via default provider registry", () => {
    const resolution = resolvePullRequestProvider(
      "https://github.com/acme/widget/pull/7",
    );

    expect(resolution).not.toBeNull();
    expect(resolution?.provider.id).toBe("github");
    expect(resolution?.address.canonicalSlug).toBe("acme/widget");
  });

  it("returns null for unrecognized URLs", () => {
    expect(
      resolvePullRequestProvider("https://example.com/unknown/123"),
    ).toBeNull();
  });

  it("supports custom provider registration and resolution", () => {
    const registry = new PullRequestProviderRegistry();

    const mockProvider: PullRequestProvider = {
      id: "mock-forge",
      parseUrl: (url: string) => {
        if (url.startsWith("https://mockforge.com/pr/")) {
          return {
            provider: "mock-forge",
            host: "mockforge.com",
            canonicalSlug: "test/repo",
            number: 99,
            rawUrl: url,
          };
        }

        return null;
      },
      readPullRequest: async () => ({
        host: "mockforge.com",
        slug: "test/repo",
        number: 99,
        title: "Mock PR",
        baseRefName: "main",
      }),
      pullRequestRefs: () => ({
        localHead: "refs/test/head",
        localBase: "refs/test/base",
        localFrozenBase: "refs/test/frozen",
        fetchRefspecs: [],
      }),
      matchesRemote: () => true,
      credentialOptions: async () => ({ gitArgs: [] }),
    };

    registry.register(mockProvider);

    const resolution = registry.resolve("https://mockforge.com/pr/99");
    expect(resolution).not.toBeNull();
    expect(resolution?.provider.id).toBe("mock-forge");
    expect(resolution?.address.number).toBe(99);
  });
});
