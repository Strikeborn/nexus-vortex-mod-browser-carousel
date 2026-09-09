let sessionBrowseUrl: string | null = null;
let sessionGameSlug: string | null = null;

export function getBrowseSessionKey(url: string): string {
  if (!url) {
    return '';
  }

  try {
    const parsed = new URL(url);
    parsed.hash = '';
    ['page', 'p', 'offset', 'count'].forEach((key) => parsed.searchParams.delete(key));
    return parsed.pathname + '?' + parsed.searchParams.toString();
  } catch (err) {
    return '';
  }
}

export function getSessionBrowseUrl(): string | null {
  return sessionBrowseUrl;
}

export function getSessionGameSlug(): string | null {
  return sessionGameSlug;
}

export function extractGameSlugFromBrowseUrl(url: string): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 3 && parts[0] === 'games' && parts[2] === 'mods') {
      return parts[1];
    }
    if (parts.length >= 2 && parts[1] === 'mods') {
      return parts[0];
    }
  } catch (err) {
    return null;
  }

  return null;
}

function normalizeGameSlug(gameSlug: string): string {
  return String(gameSlug || '').trim().toLowerCase();
}

export function urlsMatchGame(url: string, gameSlug: string): boolean {
  const slug = extractGameSlugFromBrowseUrl(url);
  if (!slug || !gameSlug) {
    return false;
  }
  return normalizeGameSlug(slug) === normalizeGameSlug(gameSlug);
}

export function rememberBrowseUrl(url: string): void {
  if (url && url.indexOf('nexusmods.com') >= 0) {
    sessionBrowseUrl = url;
    sessionGameSlug = extractGameSlugFromBrowseUrl(url);
  }
}

export function clearBrowseSession(): void {
  sessionBrowseUrl = null;
  sessionGameSlug = null;
}

export function clearBrowseSessionIfGameMismatch(gameSlug: string): void {
  if (sessionBrowseUrl && !urlsMatchGame(sessionBrowseUrl, gameSlug)) {
    clearBrowseSession();
  }
}

export function buildDefaultBrowseUrl(gameSlug: string): string {
  return `https://www.nexusmods.com/games/${gameSlug}/mods?count=80&excludedTag=Translation`;
}

export function resolveBrowseWebviewSrc(gameSlug: string): string {
  if (sessionBrowseUrl && urlsMatchGame(sessionBrowseUrl, gameSlug)) {
    return sessionBrowseUrl;
  }
  return buildDefaultBrowseUrl(gameSlug);
}

export function isDefaultBrowseLanding(gameSlug: string): boolean {
  return sessionBrowseUrl === null || !urlsMatchGame(sessionBrowseUrl, gameSlug);
}
