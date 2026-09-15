export const NEXUS_WEBVIEW_PARTITION = 'persist:nexus';

export interface NexusWebSessionProbe {
  state: 'browse' | 'login-page' | 'error';
  loggedIn: boolean;
  error?: string;
}

export function isNexusAuthUrl(url: string): boolean {
  if (!url) {
    return false;
  }
  const normalized = String(url).trim().toLowerCase();
  return normalized.indexOf('users.nexusmods.com/auth/') >= 0 ||
    normalized.indexOf('users.nexusmods.com/oauth') >= 0;
}

export function isNexusBrowseModsUrl(url: string): boolean {
  if (!url) {
    return false;
  }
  const normalized = String(url).trim().toLowerCase();
  return normalized.indexOf('nexusmods.com') >= 0 && normalized.indexOf('/mods') >= 0;
}

export function buildNexusWebLoginUrl(returnUrl: string): string {
  const target = returnUrl && returnUrl.indexOf('nexusmods.com') >= 0
    ? returnUrl
    : 'https://www.nexusmods.com/';
  return 'https://users.nexusmods.com/auth/sign_in?redirect_url=' + encodeURIComponent(target);
}

export function buildNexusWebSessionProbeScript(): string {
  return [
    '(function(){',
    'try {',
    'var href = String(window.location.href || "").toLowerCase();',
    'if (href.indexOf("users.nexusmods.com/auth/") >= 0 || href.indexOf("users.nexusmods.com/oauth") >= 0) {',
    'return { state: "login-page", loggedIn: false };',
    '}',
    'var doc = document;',
    'var logoutHints = doc.querySelector("a[href*=\\"sign_out\\"], a[href*=\\"logout\\"], [data-e2eid=\\"user-menu\\"]");',
    'var userHints = doc.querySelector("[class*=\\"UserMenu\\"], [class*=\\"AccountMenu\\"], [class*=\\"ProfileMenu\\"]");',
    'if (logoutHints || userHints) {',
    'return { state: "browse", loggedIn: true };',
    '}',
    'var loginLinks = doc.querySelectorAll("a[href*=\\"sign_in\\"], a[href*=\\"auth/sign_in\\"]");',
    'for (var i = 0; i < loginLinks.length; i++) {',
    'var txt = (loginLinks[i].textContent || "").replace(/\\s+/g, " ").trim().toLowerCase();',
    'if (txt === "log in" || txt.indexOf("log in") >= 0) {',
    'return { state: "browse", loggedIn: false };',
    '}',
    '}',
    'return { state: "browse", loggedIn: true };',
    '} catch (errProbe) {',
    'return { state: "error", loggedIn: false, error: String(errProbe && errProbe.message || errProbe) };',
    '}',
    '})();',
  ].join('');
}

export function buildNexusWebSessionReleaseScript(): string {
  return [
    '(function(){',
    'try {',
    'document.documentElement.classList.remove(',
    '"vortex-enhanced-hide-chrome", "vortex-enhanced-browse-wide", "vortex-enhanced-translation-dismissed"',
    ');',
    'document.documentElement.classList.add("vortex-enhanced-auth-page");',
    'document.querySelectorAll(".vortex-enhanced-chrome-hidden, .vortex-enhanced-browse-trim-hidden").forEach(function (node) {',
    'node.classList.remove("vortex-enhanced-chrome-hidden", "vortex-enhanced-browse-trim-hidden");',
    '});',
    'if (window.__vortexBrowseEnhancer && window.__vortexBrowseEnhancer.releaseAuthPage) {',
    'return window.__vortexBrowseEnhancer.releaseAuthPage();',
    '}',
    'return { released: true };',
    '} catch (errRelease) {',
    'return { released: false, error: String(errRelease && errRelease.message || errRelease) };',
    '}',
    '})();',
  ].join('');
}
