// Shared fetch-with-retry: handles Graph API rate limiting (429 + Retry-After), transient 5xx,
// and network timeouts, per PRD §14 risk mitigations.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(url, options = {}, { retries = 3, timeoutMs = 30_000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
        if (attempt < retries) {
          console.error(`  ${url} -> HTTP ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
          await sleep(delay);
          continue;
        }
      }
      return res;
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      if (attempt < retries) {
        const delay = 2 ** attempt * 1000;
        console.error(`  ${url} -> ${err.message}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(delay);
        continue;
      }
    }
  }
  throw lastErr ?? new Error(`${url} failed after ${retries} retries`);
}
