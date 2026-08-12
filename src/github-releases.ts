export const GITHUB_REPO = 'darrenjrobinson/graph-atlas-mcp';

// Data releases are calendar-tagged (v2026.08.11); server releases on npm use semver
// (v0.3.0). Only the former carry a snapshot database.
const DATA_RELEASE_TAG = /^v\d{4}\.\d{2}\.\d{2}$/;

const PAGE_SIZE = 30;

// Paging backstop. The newest data release is normally on page 1, so the common case costs
// one request; paging only continues while a page is full of non-data releases, which takes
// a long run of server releases (or a quiet stretch with no detected changes) to reach.
const MAX_PAGES = 10;

export type DataRelease = {
  tag: string;
  /** Tag normalised to a snapshot date (2026-08-11) for comparison against snapshot_date. */
  date: string;
  published_at: string;
  assets: Array<{ name: string; browser_download_url: string }>;
};

type ReleaseListEntry = {
  tag_name?: string;
  published_at?: string;
  draft?: boolean;
  assets?: Array<{ name: string; browser_download_url: string }>;
};

/** One page of the release list, newest-first. Throws on any non-OK response. */
async function fetchReleasePage(page: number, timeoutMs: number | null): Promise<ReleaseListEntry[]> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=${PAGE_SIZE}&page=${page}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'graph-atlas-mcp',
    },
    ...(timeoutMs === null ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
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
  const releases = (await res.json()) as ReleaseListEntry[];
  if (!Array.isArray(releases)) throw new Error('GitHub releases API returned an unexpected payload');
  return releases;
}

/**
 * Newest calendar-tagged database release, or null when the repo genuinely has no data
 * release. Throws when GitHub is unreachable — callers decide whether that is fatal.
 *
 * Deliberately not /releases/latest: that endpoint returns whichever release published most
 * recently, which is a semver server release whenever the npm publish lands after that day's
 * data release. Selecting it left the auto-downloader with no database asset (breaking fresh
 * installs outright) and made the currency check compare snapshot dates against a nonsense
 * "0-3-0". The list endpoint is ordered newest-first, so the first calendar-tagged entry is
 * the newest data release.
 *
 * timeoutMs, when given, budgets the whole search rather than each request, so paging can
 * never stretch a caller's deadline by a factor of MAX_PAGES.
 */
export async function fetchLatestDataRelease(timeoutMs?: number): Promise<DataRelease | null> {
  const deadline = timeoutMs === undefined ? null : Date.now() + timeoutMs;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let remaining: number | null = null;
    if (deadline !== null) {
      remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out searching for the newest data release');
    }

    const releases = await fetchReleasePage(page, remaining);
    const release = releases.find((r) => !r.draft && r.tag_name && DATA_RELEASE_TAG.test(r.tag_name));
    if (release?.tag_name) {
      return {
        tag: release.tag_name,
        date: release.tag_name.replace(/^v/, '').replaceAll('.', '-'),
        published_at: release.published_at ?? '',
        assets: release.assets ?? [],
      };
    }
    // A short page is the last page — nothing older left to search.
    if (releases.length < PAGE_SIZE) return null;
  }

  return null;
}
