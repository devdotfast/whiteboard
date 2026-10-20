const REMOTE_URLS = [
  /^https:\/\/(?:[^@]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+?)(?:\.git)?\/?$/,
  /^https:\/\/([^.]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/]+?)(?:\.git)?\/?$/,
  /^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^[^@]+@vs-ssh\.visualstudio\.com:v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
];

/** org/project/repository, decoded; undefined for malformed escapes. */
export function slugOf(patterns: RegExp[], url: string) {
  const match = patterns.map((pattern) => pattern.exec(url)).find(Boolean);

  try {
    return match && match.slice(1, 4).map(decodeURIComponent).join("/");
  } catch {
    return undefined;
  }
}

export function azureRepositoryOf(remoteUrl: string) {
  return slugOf(REMOTE_URLS, remoteUrl.trim());
}
