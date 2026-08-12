export const GITHUB_REPO = 'darrenjrobinson/graph-atlas-mcp';

// Data releases are calendar-tagged (v2026.08.11); server releases on npm use semver
// (v0.3.0). Only the former carry a snapshot database.
const DATA_RELEASE_TAG = /^v\d{4}\.\d{2}\.\d{2}$/;

// A month of headroom: data releases only happen on days changes are detected, so a run of
// server releases (or a quiet stretch) must not push the newest data release off the page.
const PAGE_SIZE = 30;

export type DataRelease = {
  tag: string;
  /** Tag normalised to a snapshot date (2026-08-11) for comparison against snapshot_date. */
  date: string;
  published_at: string;
  assets: Array<{ name: string; browser_download_url: string }>;
};

/**
 * Newest calendar-tagged database release, or null when GitHub is unreachable or no data
 * release is on the first page.
 *
 * Deliberately not /releases/latest: that endpoint returns whichever release published most
 * recently, which is a semver server release whenever the npm publish lands after that day's
 * data release. Selecting it left the auto-downloader with no database asset (breaking fresh
 * installs outright) and made the currency check compare snapshot dates against a nonsense
 * "0-3-0". The list endpoint is ordered newest-first, so the first calendar-tagged entry is
 * the newest data release.
 */
export async function fetchLatestDataRelease(timeoutMs?: number): Promise<DataRelease | null> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=${PAGE_SIZE}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'graph-atlas-mcp',
    },
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  // 404 means the repo itself is unreachable — the list endpoint returns [] for a repo with
  // no releases, so it is never the "no releases yet" case.
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `GitHub repository ${GITHUB_REPO} not found (HTTP 404)`
        : `GitHub releases API HTTP ${res.status}`,
    );
  }

  const releases = (await res.json()) as Array<{
    tag_name?: string;
    published_at?: string;
    draft?: boolean;
    assets?: Array<{ name: string; browser_download_url: string }>;
  }>;
  if (!Array.isArray(releases)) throw new Error('GitHub releases API returned an unexpected payload');

  const release = releases.find((r) => !r.draft && r.tag_name && DATA_RELEASE_TAG.test(r.tag_name));
  if (!release?.tag_name) return null;

  return {
    tag: release.tag_name,
    date: release.tag_name.replace(/^v/, '').replaceAll('.', '-'),
    published_at: release.published_at ?? '',
    assets: release.assets ?? [],
  };
}
