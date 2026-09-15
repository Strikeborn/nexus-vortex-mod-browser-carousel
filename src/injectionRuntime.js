(function () {
  if (window.__vortexBrowseEnhancer) {
    if (typeof window.__vortexBrowseEnhancer.reattachDocumentHooks === 'function') {
      try {
        window.__vortexBrowseEnhancer.reattachDocumentHooks();
      } catch (errReattachHooks) {
        // ignore
      }
    }
    return;
  }

  var STYLE_ID = 'vortex-browse-enhancer-styles';
  var MARK = 'data-vortex-enhanced';
  var BRIDGE_PREFIX = '__VORTEX_ENHANCE__:';
  var GRAPHQL_URL = 'https://api-router.nexusmods.com/graphql';
  var DOCUMENT_HOOK_PREFIX = 'data-vortex-doc-hook-';

  function vortexDocumentHookInstalled(name) {
    return !!(document.documentElement &&
      document.documentElement.getAttribute(DOCUMENT_HOOK_PREFIX + name) === '1');
  }

  function markVortexDocumentHook(name) {
    if (!document.documentElement || vortexDocumentHookInstalled(name)) {
      return false;
    }
    document.documentElement.setAttribute(DOCUMENT_HOOK_PREFIX + name, '1');
    return true;
  }

  var MOD_SUBPAGE_SUFFIXES = [
    '/files', '/images', '/videos', '/posts', '/bugs', '/logs', '/stats', '/news',
  ];

  function safeModSubpageTest(href) {
    if (!href || href.indexOf('/mods/') < 0) {
      return false;
    }
    var sample = String(href);
    if (sample.length > 512) {
      sample = sample.slice(0, 512);
    }
    try {
      var modsPos = sample.indexOf('/mods/');
      if (modsPos < 0) {
        return false;
      }
      var afterMods = sample.slice(modsPos + 6);
      var slashIdx = afterMods.indexOf('/');
      if (slashIdx < 0) {
        return false;
      }
      var rest = afterMods.slice(slashIdx);
      for (var i = 0; i < MOD_SUBPAGE_SUFFIXES.length; i++) {
        var suffix = MOD_SUBPAGE_SUFFIXES[i];
        if (rest.indexOf(suffix) === 0) {
          var next = rest.charAt(suffix.length);
          if (!next || next === '/' || next === '?' || next === '#') {
            return true;
          }
        }
      }
      return false;
    } catch (errModSubpage) {
      return false;
    }
  }

  function parseModIdFromPathname(pathname) {
    if (!pathname || pathname.indexOf('/mods/') < 0) {
      return null;
    }
    var sample = String(pathname);
    if (sample.length > 512) {
      sample = sample.slice(0, 512);
    }
    var modsPos = sample.indexOf('/mods/');
    var afterMods = sample.slice(modsPos + 6);
    var endIdx = afterMods.length;
    ['/', '?', '#'].forEach(function (marker) {
      var idx = afterMods.indexOf(marker);
      if (idx >= 0 && idx < endIdx) {
        endIdx = idx;
      }
    });
    var segment = afterMods.slice(0, endIdx);
    if (!segment) {
      return null;
    }
    if (/^\d+$/.test(segment)) {
      return parseInt(segment, 10);
    }
    var dashIdx = segment.lastIndexOf('-');
    if (dashIdx >= 0) {
      var tail = segment.slice(dashIdx + 1);
      if (/^\d+$/.test(tail)) {
        return parseInt(tail, 10);
      }
    }
    return null;
  }
  var BROWSE_MODS_LIST_PATH = /^\/games\/[^/]+\/mods\/?$/;
  var BROWSE_MODS_LIST_LEGACY = /^\/[^/]+\/mods\/?$/;

  function isBrowseModsListPathname(pathname) {
    if (!pathname) {
      return false;
    }
    return BROWSE_MODS_LIST_PATH.test(pathname) || BROWSE_MODS_LIST_LEGACY.test(pathname);
  }

  function isBrowseModDetailPathname(pathname) {
    if (!pathname || pathname.indexOf('/mods') < 0) {
      return false;
    }
    if (isBrowseModsListPathname(pathname)) {
      return false;
    }
    if (safeModSubpageTest(pathname)) {
      return true;
    }
    return !!parseModIdFromUrl(pathname);
  }

  function isNexusAuthPage() {
    try {
      var href = String(window.location.href || '').toLowerCase();
      return href.indexOf('users.nexusmods.com/auth/') >= 0 ||
        href.indexOf('users.nexusmods.com/oauth') >= 0;
    } catch (errAuthPage) {
      return false;
    }
  }

  function sendToHost(payload) {
    try {
      console.log(BRIDGE_PREFIX + JSON.stringify(payload));
    } catch (err) {
      console.error(BRIDGE_PREFIX + JSON.stringify({ type: 'error', message: 'bridge encode failed' }));
    }
  }

  function pushHostLog(message, detail, level) {
    if (typeof enhancer === 'undefined' || !enhancer) {
      return;
    }
    enhancer.hostLogBuffer = enhancer.hostLogBuffer || [];
    enhancer.hostLogBuffer.push({
      t: Date.now(),
      level: level || 'info',
      message: String(message || ''),
      detail: detail || {},
    });
    if (enhancer.hostLogBuffer.length > 100) {
      enhancer.hostLogBuffer.splice(0, enhancer.hostLogBuffer.length - 100);
    }
  }

  function drainHostLogBuffer() {
    var buf = enhancer.hostLogBuffer || [];
    enhancer.hostLogBuffer = [];
    return buf;
  }

  function attachHostLogs(stats, config) {
    stats = stats || emptyScanStats(config || enhancer.config || {});
    var logs = drainHostLogBuffer();
    if (logs.length) {
      stats.hostLogs = logs;
    }
    return stats;
  }

  function sanitizeHostDetail(detail) {
    if (!detail || typeof detail !== 'object') {
      return {};
    }
    var safe = {};
    Object.keys(detail).forEach(function (key) {
      var value = detail[key];
      if (value === null || value === undefined) {
        safe[key] = value;
        return;
      }
      var valueType = typeof value;
      if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
        safe[key] = value;
        return;
      }
      if (Array.isArray(value)) {
        safe[key] = value.slice(0, 12).map(function (entry) {
          if (entry === null || entry === undefined) {
            return entry;
          }
          var entryType = typeof entry;
          if (entryType === 'string' || entryType === 'number' || entryType === 'boolean') {
            return entry;
          }
          return String(entry);
        });
      }
    });
    return safe;
  }

  function traceStep(step, detail) {
    enhancer.minimalNumericScanStep = String(step || '');
    logToHost('trace:' + String(step || ''), sanitizeHostDetail(detail || {}));
  }

  function logToHost(message, detail) {
    pushHostLog(message, sanitizeHostDetail(detail), 'info');
    try {
      sendToHost({
        type: 'enhancer-log',
        level: 'info',
        message: String(message || ''),
        detail: sanitizeHostDetail(detail || {}),
      });
    } catch (errLogHost) {
      // ignore
    }
  }

  function logErrorToHost(message, detail) {
    var safeDetail = sanitizeHostDetail(detail || {});
    pushHostLog(message, safeDetail, 'error');
    try {
      sendToHost({
        type: 'enhancer-log',
        level: 'error',
        message: String(message || ''),
        detail: safeDetail,
      });
    } catch (errLogHostErr) {
      // ignore
    }
  }

  function summarizeFilteredBrowseState(config) {
    var grid = resolveNexusModGridElement() || findModGrid();
    var liveTiles = document.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').length;
    var visibleTiles = 0;
    var installButtons = 0;
    if (grid) {
      visibleTiles = grid.querySelectorAll(
        '[data-e2eid="mod-tile"]:not(.vortex-enhanced-carousel-hidden):not(.vortex-enhanced-hidden):not([data-vortex-pool-tile])'
      ).length;
    }
    installButtons = document.querySelectorAll('[data-e2eid="mod-tile"] .vortex-enhanced-install').length;
    var href = '';
    try {
      href = getActiveBrowseHref();
    } catch (errHref) {
      href = '';
    }
    return {
      href: href,
      activeFilters: isFilteredBrowseSession(config),
      filterBrowseActive: !!(config && config.filterBrowseActive),
      liveOnly: filteredBrowseUsesLiveCatalogOnly(),
      lightScan: shouldUseFilteredBrowseLightScan(config),
      liveTiles: liveTiles,
      visibleTiles: visibleTiles,
      installButtons: installButtons,
      needsDecoration: gridVisibleTilesNeedDecoration(config),
      filterApplyInFlight: !!enhancer.nexusFilterApplyInFlight,
      globalPageIndex: enhancer.globalPageIndex || 0,
      carouselAdvancePending: !!enhancer.carouselAdvancePending,
    };
  }

  function sendBrowseNavigateToHost(url) {
    return navigateBrowseUrlViaHost(url);
  }

  function stripInternalBrowseParams(href) {
    if (!href) {
      return href;
    }
    try {
      var url = new URL(href, window.location.origin);
      url.searchParams.delete('_vortex_reload');
      return url.href;
    } catch (errStrip) {
      return href;
    }
  }

  function navigateBrowseUrlViaHost(targetUrl, options) {
    options = options || {};
    if (!targetUrl || targetUrl.indexOf('nexusmods.com') < 0) {
      return false;
    }
    targetUrl = stripInternalBrowseParams(targetUrl);
    var syncOnly = !!options.syncOnly;
    if (!syncOnly && urlHasActiveNexusFilters(targetUrl)) {
      try {
        var currentNav = new URL(window.location.href);
        var targetNav = new URL(targetUrl, window.location.origin);
        if (currentNav.origin === targetNav.origin && currentNav.pathname === targetNav.pathname) {
          syncOnly = true;
        }
      } catch (errNavCompare) {
        syncOnly = true;
      }
    }
    try {
      sendToHost({ type: 'browse-navigate', url: targetUrl, syncOnly: syncOnly });
      return true;
    } catch (errHostNav) {
      if (syncOnly) {
        return true;
      }
      try {
        window.location.replace(targetUrl);
      } catch (errReplace) {
        window.location.href = targetUrl;
      }
      return true;
    }
  }

  function parseModIdFromUrl(url) {
    try {
      var pathname = new URL(url, window.location.origin).pathname;
      return parseModIdFromPathname(pathname);
    } catch (err) {
      return null;
    }
  }

  function extractModIdFromTile(tile) {
    var titleLink = tile.querySelector('a[data-e2eid="mod-tile-title"]');
    if (titleLink && titleLink.href) {
      var fromTitle = parseModIdFromUrl(titleLink.href);
      if (fromTitle) {
        return fromTitle;
      }
    }

    var links = tile.querySelectorAll('a[href*="/mods/"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].href;
      if (!href) {
        continue;
      }
      if (safeModSubpageTest(href)) {
        continue;
      }
      var parsed = parseModIdFromUrl(href);
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  function getPageSizeFromUrl() {
    try {
      var url = new URL(window.location.href);
      var count = url.searchParams.get('count');
      if (count) {
        return parseInt(count, 10);
      }
    } catch (err) {
      return null;
    }
    return null;
  }

  function getNexusItemsPerPage() {
    var fromUrl = getPageSizeFromUrl();
    if (fromUrl) {
      return fromUrl;
    }

    var buttons = document.querySelectorAll('button, [role="combobox"]');
    for (var i = 0; i < buttons.length; i++) {
      var text = (buttons[i].textContent || '').replace(/\s+/g, ' ').trim();
      var match = text.match(/^(\d+)\s*items$/i);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return null;
  }

  function pickItemsDropdownOption(targetSize) {
    var sizeText = String(targetSize);
    var selectors = [
      '[role="option"]',
      '[role="menuitem"]',
      '[role="menuitemradio"]',
      '[data-radix-collection-item]',
    ];
    var nodes = [];
    selectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (node) {
        nodes.push(node);
      });
    });

    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.closest('.vortex-enhanced-carousel-controls')) {
          continue;
        }
        var text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (pass === 0) {
          if (new RegExp('^' + sizeText + '\\s*items$', 'i').test(text)) {
            node.click();
            return true;
          }
        } else if (text.indexOf(sizeText) >= 0 && text.toLowerCase().indexOf('item') >= 0) {
          node.click();
          return true;
        }
      }
    }
    return false;
  }

  function closeOpenDropdowns() {
    if (isUserInteractingWithNexusFilters()) {
      return;
    }
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    } catch (err) {
      // ignore
    }
    document.querySelectorAll('body > div[style*="position"]').forEach(function (node) {
      var text = (node.textContent || '').toLowerCase();
      if (text.indexOf('items') >= 0 && (text.indexOf('20') >= 0 || text.indexOf('80') >= 0)) {
        node.classList.add('vortex-enhanced-browse-trim-hidden');
      }
    });
  }

  function hideNexusItemsPerPageUi(options) {
    options = options || {};
    var preservePopovers = isUserInteractingWithNexusFilters();
    var btn = findItemsPerPageButton();
    if (btn) {
      btn.classList.add('vortex-enhanced-browse-trim-hidden', 'vortex-enhanced-items-per-page-hide');
    }

    document.querySelectorAll('button[aria-label="Mods per page"], [role="combobox"]').forEach(function (node) {
      if (node.closest && node.closest('#filters-panel, aside')) {
        return;
      }
      var label = (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim();
      if (label === 'Mods per page' || /\b\d+\s*items\b/i.test(label)) {
        node.classList.add('vortex-enhanced-browse-trim-hidden', 'vortex-enhanced-items-per-page-hide');
      }
    });

    if (preservePopovers) {
      return;
    }

    if (options.closeDropdowns) {
      closeOpenDropdowns();
    }

    document.querySelectorAll('[role="listbox"], [data-radix-popper-content-wrapper]').forEach(function (node) {
      if (node.closest && node.closest('#filters-panel, aside')) {
        return;
      }
      var menuText = (node.textContent || '').toLowerCase();
      if (menuText.indexOf('items') >= 0 && /\b(20|40|60|80)\b/.test(menuText) &&
          menuText.indexOf('download') < 0 && menuText.indexOf('category') < 0 &&
          menuText.indexOf('sort') < 0) {
        node.classList.add('vortex-enhanced-browse-trim-hidden', 'vortex-enhanced-items-per-page-hide');
      }
    });
  }

  function sortParamFromOptionLabel(label) {
    var text = String(label || '').replace(/\s+/g, ' ').trim().toLowerCase();
    var map = {
      'date published': '',
      'endorsements': 'endorsements',
      'downloads': 'downloads',
      'unique downloads': 'uniqueDownloads',
      'last updated': 'updatedAt',
      'mod name': 'name',
      'file size': 'size',
      'last comment': 'lastComment',
      'surprise': 'random',
    };
    if (!Object.prototype.hasOwnProperty.call(map, text)) {
      return undefined;
    }
    return map[text];
  }

  function isNexusSortListboxOption(option) {
    if (!option || option.closest('[data-vortex-enhanced-filters="true"]')) {
      return false;
    }
    if (!option.closest('[role="listbox"]')) {
      return false;
    }
    return sortParamFromOptionLabel(option.textContent) !== undefined;
  }

  function buildBrowseUrlWithSort(sortParam) {
    var url = new URL(window.location.href);
    url.searchParams.delete('page');
    url.searchParams.set('count', String(enhancer.nexusPageSizeTarget || 80));
    url.searchParams.delete('excludedTag');
    if (shouldApplyTranslationFilter()) {
      url.searchParams.append('excludedTag', 'Translation');
    }

    if (!sortParam) {
      url.searchParams.delete('sort');
      url.searchParams.delete('sortDirection');
    } else {
      url.searchParams.set('sort', sortParam);
      if (!url.searchParams.get('sortDirection')) {
        url.searchParams.set('sortDirection', 'DESC');
      }
    }

    return url.pathname + url.search;
  }

  function isActiveLocalCatalogMode() {
    if (isLocalCatalogMode(enhancer.config)) {
      return true;
    }
    var optimistic = enhancer.optimisticFilters;
    return !!(optimistic && (optimistic.onlyTracked || optimistic.onlyInstalled));
  }

  function navigateBrowseSortOption(option) {
    var sortParam = sortParamFromOptionLabel(option.textContent);
    if (sortParam === undefined) {
      return false;
    }

    beginCarouselQuietPeriod();
    try {
      var nextPath = buildBrowseUrlWithSort(sortParam);
      if (window.history && window.history.pushState) {
        window.history.pushState(window.history.state, '', nextPath);
        window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
        enhancer.poolSessionKey = getBrowseSessionKey();
        enhancer.browsePathname = getBrowsePathname();
        if (isActiveLocalCatalogMode()) {
          enhancer.globalPageIndex = 0;
          enhancer.trackedCatalogLoadedPage = -1;
          enhancer.trackedCatalogPageCache = {};
          enhancer.lastAppliedSliceKey = '';
          clearLocalCatalogBootstrap();
          ensureLocalCatalogInitialized(enhancer.config || {});
          applyTrackedCatalogView(enhancer.config || {});
        } else if (window.__vortexBrowseEnhancer) {
          window.__vortexBrowseEnhancer.scheduleScan(false);
        }
        return true;
      }
      window.location.assign(nextPath);
      return true;
    } catch (errNav) {
      return false;
    }
  }

  function selectNexusDropdownOption(labelText, numericFallback) {
    if (pickItemsDropdownOption(numericFallback)) {
      enhancer.nexusPageSizeTarget = numericFallback;
      enhancer.nexusPageSizePending = false;
      enterLiveCarouselMode(5000);
      setTimeout(function () {
        hideNexusItemsPerPageUi({ closeDropdowns: true });
      }, 150);
      return true;
    }
    enhancer.nexusPageSizePending = false;
    closeOpenDropdowns();
    return false;
  }

  function trySetNexusPageSize(targetSize) {
    if (!isBrowseModsListPathname(getBrowsePathname())) {
      return false;
    }

    if (shouldPreserveNexusFiltersPanel()) {
      return false;
    }

    if (shouldDeferNexusUrlMutation()) {
      return false;
    }

    targetSize = targetSize || 80;
    enhancer.nexusPageSizeTarget = targetSize;
    if (enhancer.nexusPageSizePending || enhancer.translationUrlPending) {
      return false;
    }

    if (isCarouselQuietPeriod()) {
      return false;
    }

    var urlCount = getPageSizeFromUrl();
    var uiCount = getNexusItemsPerPage();
    var liveTiles = document.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').length;

    if (urlCount === targetSize && liveTiles >= 24) {
      enhancer.nexusPageSizeTarget = targetSize;
      enhancer.nexusPageSizeAttempts = 0;
      enhancer.nexusPageSizePending = false;
      hideNexusItemsPerPageUi();
      return false;
    }

    if (urlCount === targetSize && uiCount === targetSize && liveTiles >= targetSize - 4) {
      enhancer.nexusPageSizeTarget = targetSize;
      hideNexusItemsPerPageUi();
      return false;
    }

    if (urlCount === targetSize) {
      enhancer.nexusPageSizePending = false;
      if (liveTiles >= 8) {
        hideNexusItemsPerPageUi();
      }
      return false;
    }

    if (getPageSizeFromUrl() !== targetSize) {
      enhancer.nexusPageSizeAttempts = (enhancer.nexusPageSizeAttempts || 0) + 1;
      return ensureBrowseUrlParams();
    }

    if (enhancer.nexusPageSizeAttempts >= 3) {
      hideNexusItemsPerPageUi();
      return false;
    }

    var btn = findItemsPerPageButton();
    if (!btn) {
      return false;
    }

    enhancer.nexusPageSizePending = true;
    enhancer.nexusPageSizeAttempts = (enhancer.nexusPageSizeAttempts || 0) + 1;
    btn.click();
    setTimeout(function () {
      selectNexusDropdownOption(String(targetSize) + ' items', targetSize);
      if (getNexusItemsPerPage() !== targetSize) {
        enhancer.nexusPageSizePending = false;
        closeOpenDropdowns();
      }
    }, 450);
    return true;
  }

  function openNexusFiltersPanel() {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var text = (buttons[i].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.indexOf('show filters') === 0) {
        buttons[i].click();
        markNexusFiltersPanelOpen(true, { userIntent: true });
        return true;
      }
    }
    return false;
  }

  function ensureNexusFiltersPanelOpenOnLoad(config) {
    if (enhancer.filtersPanelOpenApplied) {
      return;
    }
    if (isNexusFiltersPanelOpen()) {
      markNexusFiltersPanelOpen(true);
    }
    enhancer.filtersPanelOpenApplied = true;
    collapseNativeNexusFilterSections(true);
    [100, 350, 800].forEach(function (delay) {
      setTimeout(function () {
        if (!enhancer.nexusFilterUserInteracted) {
          collapseNativeNexusFilterSections(true);
        }
      }, delay);
    });
  }

  function hideNexusRewardsPromo() {
    var roots = [];
    var aside = findNexusFilterAside();
    if (aside) {
      roots.push(aside);
    }
    var filtersPanel = document.getElementById('filters-panel');
    if (filtersPanel && roots.indexOf(filtersPanel) < 0) {
      roots.push(filtersPanel);
    }
    document.querySelectorAll('aside, #filters-panel').forEach(function (node) {
      if (roots.indexOf(node) < 0) {
        roots.push(node);
      }
    });
    roots.forEach(function (root) {
      root.querySelectorAll('div, section, aside, a, article, p, span, h1, h2, h3, h4, button').forEach(function (node) {
        if (node.closest('[data-vortex-enhanced-filters="true"]')) {
          return;
        }
        var text = (node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (text.indexOf('make mods') >= 0 && text.indexOf('earn rewards') >= 0) {
          var box = node.closest('div, section, aside, article, a') || node;
          box.classList.add('vortex-enhanced-nexus-rewards-hidden');
          box.setAttribute('aria-hidden', 'true');
        }
      });
    });
  }

  function isEnhancedPanelToggle(btn) {
    return !!(btn && btn.closest('[data-vortex-enhanced-filters="true"]'));
  }

  function nativeNexusToggleLabel(btn) {
    return (btn.textContent || btn.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isNativeContentOptionsToggle(btn) {
    var label = nativeNexusToggleLabel(btn);
    return label === 'content options' || label.indexOf('content options') === 0;
  }

  function findNativeContentOptionsRoot() {
    var aside = findNexusFilterAside() || document.getElementById('filters-panel');
    if (!aside) {
      return null;
    }

    var buttons = aside.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < buttons.length; i++) {
      if (isEnhancedPanelToggle(buttons[i])) {
        continue;
      }
      if (!isNativeContentOptionsToggle(buttons[i])) {
        continue;
      }
      return buttons[i].closest('[data-state], details, section, li, div[data-orientation]') ||
        buttons[i].parentElement;
    }
    return null;
  }

  function expandNativeNexusContentOptions() {
    var aside = findNexusFilterAside() || document.getElementById('filters-panel');
    if (!aside) {
      return;
    }
    var root = findNativeContentOptionsRoot();
    if (root) {
      root.querySelectorAll('[data-state="closed"]').forEach(function (el) {
        el.setAttribute('data-state', 'open');
        if (el.style) {
          el.style.display = '';
        }
      });
      root.querySelectorAll('details:not([open])').forEach(function (el) {
        el.setAttribute('open', 'open');
      });
    }

    var buttons = aside.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < buttons.length; i++) {
      if (isEnhancedPanelToggle(buttons[i])) {
        continue;
      }
      if (!isNativeContentOptionsToggle(buttons[i])) {
        continue;
      }
      if (buttons[i].getAttribute('aria-expanded') === 'false') {
        buttons[i].click();
      }
      return;
    }
  }

  function shouldSkipNativeNexusToggle(btn) {
    var label = nativeNexusToggleLabel(btn);
    if (!label) {
      return true;
    }
    if (label.indexOf('show filters') === 0 || label.indexOf('hide filters') === 0) {
      return true;
    }
    if (label === 'apply' || label.indexOf('clear all') === 0) {
      return true;
    }
    if (isNativeContentOptionsToggle(btn)) {
      return true;
    }
    return false;
  }

  function applyDefaultFilterSectionState() {
    var panel = document.querySelector('[data-vortex-enhanced-filters="true"]');
    if (!panel) {
      return;
    }
    var vortexToggle = panel.querySelector('.vortex-enhanced-filter-section-toggle');
    var vortexBody = panel.querySelector('.vortex-enhanced-filter-body');
    if (vortexToggle && vortexBody) {
      vortexToggle.setAttribute('aria-expanded', 'true');
      vortexBody.classList.remove('vortex-enhanced-filter-body-collapsed');
    }
  }

  function collapseNativeNexusFilterSections(force) {
    if (enhancer.nexusFilterUserInteracted ||
        (!force && (shouldPreserveNexusFiltersPanel() ||
          enhancer.userWantsNexusFiltersOpen))) {
      return;
    }
    var aside = findNexusFilterAside() || document.getElementById('filters-panel');
    if (!aside) {
      return;
    }
    traceStep('native-filter-collapse-pass', {
      force: !!force,
      openStates: aside.querySelectorAll('[data-state="open"]').length,
      openDetails: aside.querySelectorAll('details[open]').length,
      expandedButtons: aside.querySelectorAll('button[aria-expanded="true"], [role="button"][aria-expanded="true"]').length,
      expandedLabels: Array.prototype.map.call(
        aside.querySelectorAll('button[aria-expanded="true"], [role="button"][aria-expanded="true"]'),
        function (btn) { return nativeNexusToggleLabel(btn); }
      ),
    });

    var contentRoot = findNativeContentOptionsRoot();

    // Click toggles before changing their Radix state attributes so React
    // receives the transition and unmounts the expanded section content.
    aside.querySelectorAll('button[aria-expanded="true"], [role="button"][aria-expanded="true"]').forEach(function (btn) {
      if (isEnhancedPanelToggle(btn) || shouldSkipNativeNexusToggle(btn)) {
        return;
      }
      try {
        btn.click();
      } catch (errCollapseNativeToggle) {
        // The attribute cleanup below is the fallback.
      }
      if (btn.getAttribute('aria-expanded') === 'true') {
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    aside.querySelectorAll('[data-state="open"]').forEach(function (el) {
      if (el.closest('[data-vortex-enhanced-filters="true"]')) {
        return;
      }
      if (contentRoot && contentRoot.contains(el)) {
        return;
      }
      el.setAttribute('data-state', 'closed');
      if (el.style) {
        el.style.display = 'none';
      }
    });

    aside.querySelectorAll('details[open]').forEach(function (el) {
      if (el.closest('[data-vortex-enhanced-filters="true"]')) {
        return;
      }
      if (contentRoot && contentRoot.contains(el)) {
        return;
      }
      el.removeAttribute('open');
    });

    aside.querySelectorAll('button[aria-expanded="true"], [role="button"][aria-expanded="true"]').forEach(function (btn) {
      if (isEnhancedPanelToggle(btn) || shouldSkipNativeNexusToggle(btn)) {
        return;
      }
      btn.setAttribute('aria-expanded', 'false');
      var toggleRoot = btn.closest('[data-state], details, section, li, div[data-orientation]');
      if (toggleRoot && toggleRoot.getAttribute('data-state') === 'open') {
        toggleRoot.setAttribute('data-state', 'closed');
      }
    });

  }

  function scheduleCollapseNativeNexusFilterSections() {
    if (enhancer.nativeFilterCleanupScheduled) {
      return;
    }
    enhancer.nativeFilterCleanupScheduled = true;
    collapseNativeNexusFilterSections(true);
    setTimeout(function () {
      enhancer.nativeFilterCleanupScheduled = false;
    }, 500);
  }

  function findItemsPerPageButton() {
    var buttons = document.querySelectorAll('button, [role="combobox"]');
    for (var i = 0; i < buttons.length; i++) {
      if (/\d+\s*items/i.test((buttons[i].textContent || '').replace(/\s+/g, ' ').trim())) {
        return buttons[i];
      }
    }
    return null;
  }

  function isNexusFiltersPanelOpen() {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var text = (buttons[i].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.indexOf('hide filters') === 0) {
        return true;
      }
    }
    return false;
  }

  function isNexusFiltersPanelVisible() {
    if (isNexusFiltersPanelOpen()) {
      return true;
    }
    var filtersPanel = document.getElementById('filters-panel');
    if (filtersPanel && filtersPanel.classList.contains('vortex-enhanced-nexus-filters-open')) {
      return true;
    }
    var aside = findNexusFilterAside();
    if (aside && aside.classList.contains('vortex-enhanced-nexus-filters-open')) {
      return true;
    }
    return false;
  }

  function nativeFilterDropdownIsOpen() {
    var poppers = document.querySelectorAll(
      '[data-radix-popper-content-wrapper]:not(.vortex-enhanced-items-per-page-hide), ' +
      '[data-radix-select-content]:not(.vortex-enhanced-items-per-page-hide)'
    );
    for (var p = 0; p < poppers.length; p++) {
      if (!poppers[p].querySelector('[data-state="open"]')) {
        continue;
      }
      var menuText = (poppers[p].textContent || '').toLowerCase();
      if (menuText.indexOf('items') >= 0 && /\b(20|40|60|80)\b/.test(menuText) &&
          menuText.indexOf('download') < 0 && menuText.indexOf('category') < 0) {
        continue;
      }
      return true;
    }
    return false;
  }

  function isUserInteractingWithNexusFilters() {
    if (enhancer.nexusFilterApplyInFlight) {
      return true;
    }
    if (enhancer.nexusFilterInteractionUntil && Date.now() < enhancer.nexusFilterInteractionUntil) {
      return true;
    }
    if (nativeFilterDropdownIsOpen()) {
      return true;
    }
    var active = document.activeElement;
    if (active && active.closest &&
        active.closest('[data-radix-popper-content-wrapper], [role="listbox"], [role="dialog"]')) {
      var popperRoot = active.closest('[data-radix-popper-content-wrapper], [role="listbox"]');
      if (popperRoot && !popperRoot.classList.contains('vortex-enhanced-items-per-page-hide')) {
        return true;
      }
    }
    return false;
  }

  function shouldPreserveNexusFiltersPanel() {
    return isUserInteractingWithNexusFilters();
  }

  function noteNexusFilterPanelInteraction() {
    enhancer.nexusFilterInteractionUntil = Date.now() + 4000;
  }

  function prepareCarouselForNativeFilterChange() {
    var pageIndex = enhancer.globalPageIndex || 0;
    var pooledTiles = document.querySelectorAll('[data-vortex-pool-tile="true"]').length;
    if (pageIndex <= 0 && pooledTiles === 0) {
      return;
    }
    traceStep('native-filter-change-page-reset', {
      page: pageIndex + 1,
      pooledTiles: pooledTiles,
      href: window.location.href,
    });
    clearCarouselQuietPeriod();
    enhancer.carouselAdvancePending = false;
    enhancer.carouselAdvancePendingSince = 0;
    enhancer.filteredNexusPageNavInFlight = false;
    enhancer.pendingNativeCatalogFetch = false;
    enhancer.pendingPoolFetch = false;
    enhancer.lastAppliedSliceKey = '';
    restoreStashedLiveNexusTiles();
    document.querySelectorAll('[data-vortex-pool-tile="true"]').forEach(function (tile) {
      if (tile.parentElement) {
        tile.parentElement.removeChild(tile);
      }
    });
    resetGlobalPagingSoft();
    resetFilteredCarouselCatalog();
    unhideAllCarouselTiles();
  }

  function ensureNexusFilterInteractionCapture() {
    if (!markVortexDocumentHook('filter-interaction-capture')) {
      return;
    }
    document.addEventListener('pointerdown', function (event) {
      var target = event.target;
      if (!target || !target.closest) {
        return;
      }
      if (target.closest('#filters-panel, aside') &&
          !target.closest('[data-vortex-enhanced-filters="true"]')) {
        var filterControl = target.closest(
          'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], ' +
          '[role="option"], [role="menuitemcheckbox"], [role="menuitemradio"]'
        );
        if (filterControl) {
          prepareCarouselForNativeFilterChange();
        }
        enhancer.nexusFilterUserInteracted = true;
        noteNexusFilterPanelInteraction();
      }
    }, true);
    document.addEventListener('input', function (event) {
      var target = event.target;
      if (!target || !target.closest ||
          !target.closest('#filters-panel, aside') ||
          target.closest('[data-vortex-enhanced-filters="true"]')) {
        return;
      }
      noteNexusFilterPanelInteraction();
      enhancer.domFilterBrowseActive = true;
      enhancer.filteredBrowseEngaged = true;
      stashSidebarNumericFilters();
    }, true);
    document.addEventListener('change', function (event) {
      var target = event.target;
      if (!target || !target.closest ||
          !target.closest('#filters-panel, aside') ||
          target.closest('[data-vortex-enhanced-filters="true"]')) {
        return;
      }
      prepareCarouselForNativeFilterChange();
      noteNexusFilterPanelInteraction();
      enhancer.domFilterBrowseActive = true;
      enhancer.filteredBrowseEngaged = true;
      stashSidebarNumericFilters();
      if (hasSidebarDownloadsFilterApplied() || hasVisibleNexusFilterChipText()) {
        enhancer.nexusFilterApplyInFlight = true;
        enhancer.nexusFilterApplyStartUrl = window.location.href;
      }
    }, true);
  }

  function restoreNexusFilterPopovers() {
    document.querySelectorAll(
      '[data-radix-popper-content-wrapper].vortex-enhanced-browse-trim-hidden, ' +
      '[role="listbox"].vortex-enhanced-browse-trim-hidden'
    ).forEach(function (node) {
      var menuText = (node.textContent || '').toLowerCase();
      if (menuText.indexOf('download') >= 0 || menuText.indexOf('category') >= 0 ||
          menuText.indexOf('tag') >= 0 || menuText.indexOf('author') >= 0 ||
          menuText.indexOf('rating') >= 0 || menuText.indexOf('sort') >= 0) {
        node.classList.remove('vortex-enhanced-browse-trim-hidden', 'vortex-enhanced-items-per-page-hide');
        if (node.style) {
          node.style.removeProperty('display');
        }
      }
    });
  }

  function markNexusFiltersPanelOpen(open, options) {
    options = options || {};
    var aside = findNexusFilterAside();
    var filtersPanel = document.getElementById('filters-panel');
    if (open) {
      if (options.userIntent) {
        enhancer.userWantsNexusFiltersOpen = true;
        var cooldownMs = options.cooldownMs || 12000;
        enhancer.nexusFilterCooldownUntil = Math.max(enhancer.nexusFilterCooldownUntil || 0, Date.now() + cooldownMs);
      }
      if (aside) {
        aside.classList.add('vortex-enhanced-nexus-filters-open');
        aside.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
        aside.style.removeProperty('display');
      }
      if (filtersPanel) {
        filtersPanel.classList.add('vortex-enhanced-nexus-filters-open');
        filtersPanel.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
        filtersPanel.style.removeProperty('display');
      }
      if (options.userIntent || isUserInteractingWithNexusFilters()) {
        restoreNexusFilterPopovers();
      }
      return;
    }
    if (options.userIntent) {
      enhancer.userWantsNexusFiltersOpen = false;
    }
    if (aside) {
      aside.classList.remove('vortex-enhanced-nexus-filters-open');
    }
    if (filtersPanel) {
      filtersPanel.classList.remove('vortex-enhanced-nexus-filters-open');
    }
  }

  function ensureNexusFiltersPanelStayOpen() {
    if (!isNexusFiltersPanelVisible()) {
      return;
    }
    markNexusFiltersPanelOpen(true);
  }

  function safeApplyFilteredBrowseLiveOnlyPage(config, options) {
    options = options || {};
    if (enhancer.filteredBrowseLivePageInFlight) {
      if (options.forcePageApply) {
        setTimeout(function () {
          safeApplyFilteredBrowseLiveOnlyPage(config, options);
        }, 60);
      }
      return 0;
    }
    enhancer.filteredBrowseLivePageInFlight = true;
    try {
      return applyFilteredBrowseLiveOnlyPage(config, options);
    } catch (errFilteredPage) {
      try {
        decorateVisibleFilteredCarouselTiles(config);
      } catch (errDecorateFallback) {
        // ignore
      }
      return 0;
    } finally {
      enhancer.filteredBrowseLivePageInFlight = false;
    }
  }

  function startFilteredBrowseDecorationWatchdog(config) {
    if (!config || !isFilteredBrowseSession(config)) {
      return;
    }
    if (enhancer.filteredBrowseDecorateWatchdogTimer) {
      clearInterval(enhancer.filteredBrowseDecorateWatchdogTimer);
      enhancer.filteredBrowseDecorateWatchdogTimer = null;
    }
    var attempts = 0;
    enhancer.filteredBrowseDecorateWatchdogTimer = setInterval(function () {
      attempts++;
      if (attempts > 12 || !isFilteredBrowseSession(config)) {
        clearInterval(enhancer.filteredBrowseDecorateWatchdogTimer);
        enhancer.filteredBrowseDecorateWatchdogTimer = null;
        return;
      }
      var cfg = enhancer.config || config;
      if (!cfg) {
        return;
      }
      if (!gridVisibleTilesNeedDecoration(cfg)) {
        clearInterval(enhancer.filteredBrowseDecorateWatchdogTimer);
        enhancer.filteredBrowseDecorateWatchdogTimer = null;
        return;
      }
      applyFiltersToAllGridTiles(cfg);
      dedupeLiveGridModTiles(cfg);
      decorateVisibleFilteredCarouselTiles(cfg);
    }, 500);
  }

  function immediateFilteredBrowseEnhance(config, options) {
    options = options || {};
    if (!config || !urlHasActiveNexusFilters()) {
      return 0;
    }
    if (enhancer.filteredBrowseEnhanceInFlight) {
      return 0;
    }
    enhancer.filteredBrowseEnhanceInFlight = true;
    try {
      clearStaleFilteredBrowseFetchLocks();
      clearCarouselQuietPeriod();
      restoreMainBrowseContentVisibility();
      ensureCarouselLayout(config);
      applyFiltersToAllGridTiles(config);
      var decorated = decorateVisibleGridTiles(config, { forceAll: true });
      var liveCount = collectLiveGridCards(config).length;
      if (liveCount >= 4) {
        applyFilteredNexusDirectPage(config, { skipDecorationRetry: true });
      } else if (liveCount > 0) {
        decorated += decorateVisibleGridTiles(config, { forceAll: true });
        ensureCarouselControlsBar();
        protectBrowseControlsFromChromeHide();
        installCarouselWheelHandler();
        scheduleFilteredBrowseRescan(200);
      } else {
        ensureCarouselControlsBar();
        protectBrowseControlsFromChromeHide();
        installCarouselWheelHandler();
        scheduleFilteredBrowseRescan(200);
      }
      ensureNexusFiltersPanelStayOpen();
      if (!options.fromWatchdog) {
        startFilteredBrowseDecorationWatchdog(config);
      }
      decorated += decorateVisibleFilteredCarouselTiles(config);
      logToHost('immediateFilteredBrowseEnhance', {
        decorated: decorated,
        liveCount: liveCount,
        browseHref: getActiveBrowseHref(),
        state: summarizeFilteredBrowseState(config),
      });
      return decorated;
    } finally {
      enhancer.filteredBrowseEnhanceInFlight = false;
    }
  }

  function findNexusFilterAside() {
    var vortexPanel = document.querySelector('[data-vortex-enhanced-filters="true"]');
    if (vortexPanel) {
      var panelHost = vortexPanel.closest('aside, #filters-panel');
      if (panelHost) {
        return panelHost;
      }
    }

    var filtersPanel = document.getElementById('filters-panel');
    if (filtersPanel) {
      return filtersPanel;
    }

    var asides = document.querySelectorAll('aside');
    for (var i = 0; i < asides.length; i++) {
      var text = (asides[i].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.indexOf('categories') >= 0 ||
          text.indexOf('hide translations') >= 0 ||
          text.indexOf('language support') >= 0 ||
          text.indexOf('tags') >= 0 ||
          text.indexOf('vortex filters') >= 0) {
        return asides[i];
      }
    }
    return asides.length > 0 ? asides[0] : null;
  }

  function readNexusFilterFormUrl() {
    try {
      var panel = findNexusFilterAside();
      if (!panel) {
        return '';
      }

      var form = panel.querySelector('form');
      if (!form || !form.action || form.action.indexOf('nexusmods.com') < 0) {
        return '';
      }

      var url = new URL(form.action);
      url.searchParams.set('count', String(enhancer.nexusPageSizeTarget || 80));
      if (shouldApplyTranslationFilter()) {
        var tags = url.searchParams.getAll('excludedTag');
        if (!tags.some(function (tag) {
          return /translation/i.test(String(tag));
        })) {
          url.searchParams.append('excludedTag', 'Translation');
        }
      } else {
        var keptFormTags = url.searchParams.getAll('excludedTag').filter(function (tag) {
          return !/translation/i.test(String(tag));
        });
        url.searchParams.delete('excludedTag');
        keptFormTags.forEach(function (tag) {
          url.searchParams.append('excludedTag', tag);
        });
      }
      url.searchParams.delete('page');
      url.searchParams.delete('offset');
      url.searchParams.delete('_vortex_reload');
      return finalizeNexusFilterApplyUrl(url.href);
    } catch (errFormUrl) {
      return '';
    }
  }

  function stripNexusFilterCountSuffix(label) {
    return String(label || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\(\s*[\d,]+\s*\)\s*$/, '')
      .trim();
  }

  function isNexusFilterInputChecked(input) {
    return !!(input.checked ||
      input.getAttribute('aria-checked') === 'true' ||
      input.getAttribute('data-state') === 'checked');
  }

  function getNexusFilterInputLabel(input) {
    var label = input.closest('label');
    var text = (label ? label.textContent : (input.getAttribute('aria-label') || ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      var row = input.closest('li, div, fieldset') || input.parentElement;
      text = ((row && row.textContent) || '').replace(/\s+/g, ' ').trim();
    }
    return stripNexusFilterCountSuffix(text);
  }

  function findNexusFilterSectionRoot(input, panel) {
    var node = input.parentElement;
    while (node && node !== panel) {
      var heading = node.querySelector('h1, h2, h3, h4, legend, [role="heading"], button');
      if (heading) {
        var headingText = (heading.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (headingText && headingText !== 'apply' && headingText.indexOf('show tags') < 0) {
          return headingText;
        }
      }
      node = node.parentElement;
    }
    return '';
  }

  function syncNexusFiltersState(config) {
    var preserveDropdowns = shouldPreserveNexusFiltersPanel();
    var open = isNexusFiltersPanelVisible();
    var aside = findNexusFilterAside();
    var filtersPanel = document.getElementById('filters-panel');

    if (aside) {
      if (open) {
        aside.classList.add('vortex-enhanced-nexus-filters-open');
        aside.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
        if (aside.style) {
          aside.style.removeProperty('display');
        }
      } else {
        aside.classList.remove('vortex-enhanced-nexus-filters-open');
      }
    }
    if (filtersPanel) {
      if (open) {
        filtersPanel.classList.add('vortex-enhanced-nexus-filters-open');
        filtersPanel.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
        if (filtersPanel.style) {
          filtersPanel.style.removeProperty('display');
        }
      }
    }

    var panel = document.querySelector('[data-vortex-enhanced-filters="true"]');
    if (!panel) {
      return;
    }

    if (open && aside) {
      panel.classList.add('vortex-enhanced-filter-panel-aside');
      panel.classList.remove('vortex-enhanced-filter-panel-inline');
      if (panel.parentElement !== aside) {
        aside.insertBefore(panel, aside.firstChild);
      }
    } else {
      mountVortexFilterPanel(panel);
    }

    var host = document.querySelector('.vortex-enhanced-carousel-host');
    if (host) {
      host.classList.remove('vortex-enhanced-chrome-hidden');
    }

    applyDefaultFilterSectionState();
    if (config) {
      ensureVortexFilterPanel(config);
    }
    protectNexusActiveFiltersRow();
  }

  function formatResultsCount(value) {
    var num = Math.max(0, parseInt(String(value || 0), 10) || 0);
    return num.toLocaleString('en-US');
  }

  function countRawTrackedMods(config) {
    if (!config || !config.tracked) {
      return 0;
    }
    var tracked = config.tracked;
    var count = 0;
    Object.keys(tracked).forEach(function (key) {
      if (!tracked[key]) {
        return;
      }
      var modId = parseInt(key, 10);
      if (!modId || modId <= 0) {
        return;
      }
      count++;
    });
    return count;
  }

  function rememberTrackedResultsTotal(config) {
    if (!config || !isLocalCatalogMode(config)) {
      return;
    }
    getLocalCatalogHeadlineTotal(config);
  }

  function getLocalCatalogHeadlineTotal(config) {
    if (!config) {
      return 0;
    }

    var catalogKey = getTrackedCatalogKey(config);
    var catalogTotal = 0;
    if (config.onlyTracked) {
      catalogTotal = getOnlyTrackedCatalogTotal(config);
    } else if (config.onlyInstalled) {
      catalogTotal = getInstalledCatalogModIds(config).length;
    }

    if (catalogTotal > 0) {
      enhancer.lastKnownCatalogTotal = catalogTotal;
      enhancer.lastKnownCatalogKey = catalogKey;
      return catalogTotal;
    }

    if (enhancer.lastKnownCatalogKey === catalogKey &&
        typeof enhancer.lastKnownCatalogTotal === 'number' &&
        enhancer.lastKnownCatalogTotal > 0) {
      return enhancer.lastKnownCatalogTotal;
    }

    return 0;
  }

  function getOnlyTrackedCatalogTotal(config) {
    return getTrackedCatalogModIds(config).length;
  }

  function resetNexusResultsHeadlineCache() {
    document.querySelectorAll('[data-vortex-results-headline="true"]').forEach(function (node) {
      var original = node.getAttribute('data-vortex-results-original');
      if (original) {
        node.textContent = original;
      }
      node.removeAttribute('data-vortex-results-headline');
      node.removeAttribute('data-vortex-results-original');
    });
    enhancer.nexusCatalogTotal = 0;
    enhancer.nexusResultsHeadlineKey = '';
  }

  function syncNexusResultsHeadline(config) {
    if (!config) {
      return;
    }

    if (isNexusFilteredBrowse()) {
      return;
    }

    var shouldOverride = isLocalCatalogMode(config) || hasClientCarouselFilters(config);
    if (!shouldOverride) {
      resetNexusResultsHeadlineCache();
      return;
    }

    var headlineKey = getBrowseSessionKey() + '|' +
      (config.hideInstalled ? 'hi' : '') +
      (config.onlyInstalled ? 'oi' : '') +
      (config.hideTracked ? 'ht' : '') +
      (config.onlyTracked ? 'ot' : '');
    if (enhancer.nexusResultsHeadlineKey && enhancer.nexusResultsHeadlineKey !== headlineKey) {
      resetNexusResultsHeadlineCache();
    }
    enhancer.nexusResultsHeadlineKey = headlineKey;

    var nodes = document.querySelectorAll('span, div, p, strong');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.closest('.vortex-enhanced-carousel-controls, [data-vortex-enhanced-filters="true"]')) {
        continue;
      }
      var text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^[\d][\d,]*\s+results$/i.test(text) && !/^[\d][\d,]*\s+matching$/i.test(text)) {
        continue;
      }
      if (!node.hasAttribute('data-vortex-results-headline')) {
        node.setAttribute('data-vortex-results-headline', 'true');
        node.setAttribute('data-vortex-results-original', text);
      }

      if (isLocalCatalogMode(config)) {
        var displayTotal = getLocalCatalogHeadlineTotal(config);
        if (displayTotal > 0) {
          node.textContent = formatResultsCount(displayTotal) + ' results';
        }
        return;
      }

      var effective = getEffectiveResultsTotal(config, 0);
      if (effective > 0) {
        node.textContent = formatResultsCount(effective) + ' results';
      }
      return;
    }
  }

  function isResultsCountHeadlineNode(node) {
    if (!node || node.nodeType !== 1) {
      return false;
    }
    var text = normalizeCountScanText(node.textContent || '');
    if (!/^[\d][\d,]*\s+(?:results|matching)$/i.test(text)) {
      return false;
    }
    if (node.children && node.children.length > 0) {
      for (var c = 0; c < node.children.length; c++) {
        var childText = normalizeCountScanText(node.children[c].textContent || '');
        if (/^[\d][\d,]*\s+(?:results|matching)$/i.test(childText)) {
          return false;
        }
      }
    }
    return true;
  }

  function hasDomNexusMatchingHeadline() {
    var roots = [
      document.getElementById('mainContent'),
      document.querySelector('[class*="ResultsHeader"]'),
      document.querySelector('main'),
    ];
    var seenRoot = {};
    for (var r = 0; r < roots.length; r++) {
      var root = roots[r];
      if (!root || seenRoot[root]) {
        continue;
      }
      seenRoot[root] = true;
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var textNode;
      while ((textNode = walker.nextNode())) {
        if (textNode.parentElement &&
            textNode.parentElement.closest('.vortex-enhanced-carousel-controls, [data-vortex-enhanced-filters="true"]')) {
          continue;
        }
        var matchingChunk = normalizeCountScanText(textNode.textContent || '');
        if (matchingChunk && safeMatchCountLabel(matchingChunk, 'matching')) {
          return true;
        }
      }
    }
    return false;
  }

  function hasVisibleNexusFilterChipText() {
    var rows = document.querySelectorAll('[class*="ActiveFilter"], [class*="AppliedFilter"], [class*="ResultsHeader"]');
    for (var i = 0; i < rows.length; i++) {
      var text = normalizeUiText(rows[i].textContent || '');
      if (/max downloads:\s*[\d,]+/i.test(text) ||
          /min downloads:\s*[\d,]+/i.test(text) ||
          (/^excluded:/i.test(text) && !/^excluded:\s*translation$/i.test(text))) {
        return true;
      }
    }
    return false;
  }

  function hasSidebarDownloadsFilterApplied() {
    var panel = document.getElementById('filters-panel') || findNexusFilterAside();
    if (!panel) {
      return false;
    }
    var inputs = panel.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      if (!input || input.type === 'checkbox' || input.type === 'radio') {
        continue;
      }
      var rowText = '';
      var row = input.closest('section, fieldset, label, div');
      if (row) {
        rowText = normalizeUiText(row.textContent || '').slice(0, 120);
      }
      var name = normalizeUiText(input.getAttribute('name') || input.getAttribute('aria-label') || '');
      if (!/download/i.test(rowText) && !/download/i.test(name)) {
        continue;
      }
      var raw = normalizeUiText(input.value || '').replace(/,/g, '');
      if (!raw) {
        continue;
      }
      var parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return true;
      }
    }
    return false;
  }

  function findModsListingTotalInObject(obj, depth, best) {
    depth = depth || 0;
    best = best || { score: 0, total: null };
    if (!obj || depth > 22) {
      return best;
    }
    if (typeof obj.totalCount === 'number' && obj.totalCount > 0 && Array.isArray(obj.nodes)) {
      var nodeScore = 2 + (obj.nodes.length > 0 ? 2 : 0);
      if (nodeScore >= best.score) {
        best.score = nodeScore;
        best.total = obj.totalCount;
      }
    }
    if (obj.mods && typeof obj.mods.totalCount === 'number' && obj.mods.totalCount > 0) {
      if (3 >= best.score) {
        best.score = 3;
        best.total = obj.mods.totalCount;
      }
    }
    if (typeof obj.matchingCount === 'number' && obj.matchingCount > 0) {
      if (5 >= best.score) {
        best.score = 5;
        best.total = obj.matchingCount;
      }
    }
    if (typeof obj.filteredCount === 'number' && obj.filteredCount > 0) {
      if (4 >= best.score) {
        best.score = 4;
        best.total = obj.filteredCount;
      }
    }
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        findModsListingTotalInObject(obj[i], depth + 1, best);
      }
      return best;
    }
    if (typeof obj === 'object') {
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) {
        findModsListingTotalInObject(obj[keys[k]], depth + 1, best);
      }
    }
    return best;
  }

  function collectNexusListingTotalsInObject(obj, depth, totals) {
    depth = depth || 0;
    totals = totals || { resultsTotal: null, matchingTotal: null };
    if (!obj || depth > 22) {
      return totals;
    }
    if (typeof obj.totalCount === 'number' && obj.totalCount > 0) {
      if (Array.isArray(obj.nodes)) {
        if (!totals.resultsTotal || obj.totalCount < totals.resultsTotal) {
          totals.resultsTotal = obj.totalCount;
        }
      }
    }
    if (obj.mods && typeof obj.mods.totalCount === 'number' && obj.mods.totalCount > 0) {
      if (!totals.resultsTotal || obj.mods.totalCount < totals.resultsTotal) {
        totals.resultsTotal = obj.mods.totalCount;
      }
    }
    if (typeof obj.filteredCount === 'number' && obj.filteredCount > 0) {
      if (!totals.resultsTotal || obj.filteredCount < totals.resultsTotal) {
        totals.resultsTotal = obj.filteredCount;
      }
    }
    if (typeof obj.matchingCount === 'number' && obj.matchingCount > 0) {
      if (!totals.matchingTotal || obj.matchingCount > totals.matchingTotal) {
        totals.matchingTotal = obj.matchingCount;
      }
    }
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        collectNexusListingTotalsInObject(obj[i], depth + 1, totals);
      }
      return totals;
    }
    if (typeof obj === 'object') {
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) {
        collectNexusListingTotalsInObject(obj[keys[k]], depth + 1, totals);
      }
    }
    return totals;
  }

  function readNexusFilterTotalsFromNextData() {
    var root = readNextDataRoot();
    if (!root) {
      return { resultsTotal: null, matchingTotal: null };
    }
    return collectNexusListingTotalsInObject(root, 0, { resultsTotal: null, matchingTotal: null });
  }

  function readNexusFilteredTotalFromNextData() {
    var totals = readNexusFilterTotalsFromNextData();
    return resolveFilteredBrowseDisplayTotal(totals.resultsTotal || 0, totals.matchingTotal || 0) || null;
  }

  function hasNonDefaultNexusFilterChip() {
    var found = false;
    forEachActiveNexusFilterChip(function (chip) {
      var text = normalizeUiText(chip.textContent || '');
      var aria = normalizeUiText(chip.getAttribute && chip.getAttribute('aria-label'));
      [text, aria].forEach(function (label) {
        if (!label || found) {
          return;
        }
        if (/^excluded:\s*translation$/i.test(label)) {
          return;
        }
        if (/translation/i.test(label) && /exclud/i.test(label) &&
            !/download|endorse|category|tag|size|adult|included/i.test(label)) {
          return;
        }
        if (/max(?:imum)?\s+downloads?/i.test(label) ||
            /min(?:imum)?\s+downloads?/i.test(label) ||
            /max(?:imum)?\s+endorsements?/i.test(label) ||
            /min(?:imum)?\s+endorsements?/i.test(label) ||
            /^excluded:/i.test(label) ||
            /^included:/i.test(label) ||
            /^category:/i.test(label) ||
            /^tag:/i.test(label) ||
            /adult/i.test(label)) {
          found = true;
        }
      });
    });
    return found;
  }

  function hasDomActiveNexusFilters() {
    if (enhancer.resolvingDomActiveFilters) {
      return !!enhancer.domFilterBrowseActive ||
        !!(enhancer.config && enhancer.config.filterBrowseActive) ||
        hasSidebarDownloadsFilterApplied() ||
        hasNonDefaultNexusFilterChip();
    }
    enhancer.resolvingDomActiveFilters = true;
    try {
      return hasSidebarDownloadsFilterApplied() ||
        hasNonDefaultNexusFilterChip();
    } finally {
      enhancer.resolvingDomActiveFilters = false;
    }
  }

  function isNexusFilteredBrowse(href) {
    if (enhancer.domFilterBrowseActive) {
      return true;
    }
    if (enhancer.config && enhancer.config.filterBrowseActive) {
      return true;
    }
    if (href && urlHasActiveNexusFilters(href)) {
      return true;
    }
    if (!href && urlHasActiveNexusFilters(window.location.href)) {
      return true;
    }
    if (!href && urlHasActiveNexusFilters(getActiveBrowseHref())) {
      return true;
    }
    return hasDomActiveNexusFilters();
  }

  function refreshDomFilteredBrowseState() {
    if (enhancer.refreshingDomFilteredBrowseState) {
      return !!enhancer.domFilterBrowseActive;
    }
    enhancer.refreshingDomFilteredBrowseState = true;
    try {
    var domFilters = hasDomActiveNexusFilters() || hasVisibleNexusFilterChipText();
    var urlFilters = urlHasActiveNexusFilters(window.location.href);
    if (domFilters || urlFilters) {
      enhancer.filteredBrowseEngaged = true;
      if (hasNumericNexusBrowseFilters()) {
        if (!enhancer.hadNumericNexusBrowseFilters &&
            !enhancer.clientSideNumericFilterActive &&
            !enhancer.clientSideNumericFilterApplyInFlight) {
          resetFilteredBrowseTotalsState();
          resetFilteredBrowseCatalogState();
          enhancer.carouselAdvancePending = false;
          enhancer.carouselAdvancePendingSince = 0;
          enhancer.carouselPagingQuietUntil = 0;
          suppressMatchingCountLabelsImmediately();
        }
        enhancer.hadNumericNexusBrowseFilters = true;
        scheduleNumericMatchingLabelSuppress();
        scheduleFilteredBrowseTotalFetch(enhancer.config || null);
        try {
          var earlyNumericDom = scanNexusResultsTotalsFromDom();
          var earlyNumericTotal = resolveNumericFilteredResultsTotal(earlyNumericDom);
          if (earlyNumericTotal > 0) {
            lockNumericFilteredResultsTotal(earlyNumericTotal, earlyNumericDom);
            hideStaleMatchingCountLabels(earlyNumericTotal);
          } else {
            suppressMatchingCountLabelsImmediately();
          }
        } catch (errEarlyNumericDom) {
          // ignore
        }
        if (!enhancer.scanInProgress &&
            !enhancer.publishingNumericFilteredResultsTotal &&
            !enhancer.refreshingCarouselControlsFilteredTotal) {
          scheduleNumericFilteredHeadlineSync();
        }
      } else if (getLockedNexusFilteredDisplayTotal() <= 0) {
        var earlyResolved = absorbNexusFilteredTotalsFromSources();
        if (earlyResolved > 0) {
          lockNexusFilteredDisplayTotal(earlyResolved);
        }
      }
    } else {
      enhancer.filteredBrowseEngaged = false;
      enhancer.hadNumericNexusBrowseFilters = false;
      if (enhancer.numericMatchingSuppressTimer) {
        clearInterval(enhancer.numericMatchingSuppressTimer);
        enhancer.numericMatchingSuppressTimer = null;
      }
    }
    var active = domFilters || urlFilters;
    var prev = !!enhancer.domFilterBrowseActive;
    enhancer.domFilterBrowseActive = active;
    if (active !== prev) {
      try {
        sendToHost({ type: 'filter-browse-state', active: active });
      } catch (errDomFilterState) {
        // ignore
      }
    }
    return active;
    } finally {
      enhancer.refreshingDomFilteredBrowseState = false;
    }
  }

  function scheduleFilteredResultsHeadlineResync() {
    if (!isNexusFilteredBrowse()) {
      return;
    }
    if (enhancer.filteredHeadlineSyncTimer) {
      clearTimeout(enhancer.filteredHeadlineSyncTimer);
    }
    enhancer.filteredHeadlineSyncTimer = setTimeout(function () {
      enhancer.filteredHeadlineSyncTimer = null;
      syncNexusFilteredResultsHeadlines();
    }, 220);
  }

  function normalizeCountScanText(text) {
    if (!text) {
      return '';
    }
    var sample = String(text);
    if (sample.length > 512) {
      sample = sample.slice(0, 512);
    }
    var normalized = sample.replace(/\s+/g, ' ').trim();
    if (normalized.length > 240) {
      return normalized.slice(0, 240);
    }
    return normalized;
  }

  function resolveNumericFilteredResultsTotal(parsed) {
    parsed = parsed || scanNexusResultsTotalsFromDom();
    if (parsed.resultsTotal > 0) {
      return parsed.resultsTotal;
    }
    return 0;
  }

  function reconcileNumericFilteredResultsTotal(candidate, parsed) {
    parsed = parsed || scanNexusResultsTotalsFromDom();
    var domResults = parsed.resultsTotal || 0;
    var matching = parsed.matchingTotal || 0;
    if (domResults > 0) {
      if (candidate > 0 && candidate > domResults && matching > 0 && candidate >= matching) {
        return domResults;
      }
      if (candidate <= 0 || domResults <= candidate) {
        return domResults;
      }
    }
    if (candidate > 0) {
      if (matching > 0 && candidate >= matching && domResults <= 0) {
        return 0;
      }
      return candidate;
    }
    return 0;
  }

  function lockNumericFilteredResultsTotal(total, parsed) {
    var resolved = reconcileNumericFilteredResultsTotal(total, parsed);
    if (resolved > 0) {
      return lockNexusFilteredDisplayTotal(resolved);
    }
    return 0;
  }

  function hideMatchingCountLabelHost(host, text) {
    if (!host) {
      return;
    }
    if (!host.hasAttribute('data-vortex-results-original')) {
      host.setAttribute('data-vortex-results-original', text || normalizeCountScanText(host.textContent || ''));
    }
    host.classList.add('vortex-enhanced-hide-native-count');
    host.style.setProperty('display', 'none', 'important');
  }

  function walkResultsCountLabelHosts(visitor) {
    var roots = [
      document.querySelector('[class*="ResultsHeader"]'),
      document.getElementById('mainContent'),
      document.querySelector('main'),
    ];
    var seenRoot = {};
    for (var r = 0; r < roots.length; r++) {
      var root = roots[r];
      if (!root || seenRoot[root]) {
        continue;
      }
      seenRoot[root] = true;
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var textNode;
      while ((textNode = walker.nextNode())) {
        var host = textNode.parentElement;
        if (!host ||
            host.closest('.vortex-enhanced-carousel-controls, [data-vortex-enhanced-filters="true"]')) {
          continue;
        }
        var chunk = normalizeCountScanText(textNode.textContent || '');
        if (!chunk) {
          continue;
        }
        var label = null;
        if (/^[\d][\d,]*\s+results$/i.test(chunk)) {
          label = 'results';
        } else if (/^[\d][\d,]*\s+matching$/i.test(chunk)) {
          label = 'matching';
        } else {
          continue;
        }
        if (visitor(host, chunk, label, textNode) === false) {
          return;
        }
      }
    }
  }

  function safeMatchCountLabel(text, label) {
    var sample = normalizeCountScanText(text);
    if (!sample) {
      return null;
    }
    try {
      var pattern = label === 'matching'
        ? /([\d][\d,]*)\s+matching\b/i
        : /([\d][\d,]*)\s+results\b/i;
      var match = sample.match(pattern);
      if (!match) {
        return null;
      }
      var parsed = parseInt(match[1].replace(/,/g, ''), 10);
      return isNaN(parsed) ? null : parsed;
    } catch (errCountMatch) {
      return null;
    }
  }

  function readCountFromTextChunk(text, resultsTotal, matchingTotal) {
    if (!text) {
      return { resultsTotal: resultsTotal, matchingTotal: matchingTotal };
    }
    var matchingVal = safeMatchCountLabel(text, 'matching');
    if (matchingVal && (!matchingTotal || matchingVal > matchingTotal)) {
      matchingTotal = matchingVal;
    }
    var resultsVal = safeMatchCountLabel(text, 'results');
    if (resultsVal && (!resultsTotal || resultsVal < resultsTotal)) {
      resultsTotal = resultsVal;
    }
    return { resultsTotal: resultsTotal, matchingTotal: matchingTotal };
  }

  function scanNexusResultsTotalsFromDom() {
    var resultsTotal = null;
    var matchingTotal = null;
    var roots = [
      document.querySelector('[class*="ResultsHeader"]'),
      document.getElementById('mainContent'),
      document.querySelector('main'),
    ];
    var seenRoot = {};
    for (var r = 0; r < roots.length; r++) {
      var root = roots[r];
      if (!root || seenRoot[root]) {
        continue;
      }
      seenRoot[root] = true;
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var textNode;
      while ((textNode = walker.nextNode())) {
        if (!textNode.parentElement ||
            textNode.parentElement.closest('.vortex-enhanced-carousel-controls, [data-vortex-enhanced-filters="true"]')) {
          continue;
        }
        var chunk = normalizeCountScanText(textNode.textContent || '');
        if (!chunk || chunk.length > 240) {
          continue;
        }
        if (!/[\d][\d,]*\s+(?:results|matching)\b/i.test(chunk)) {
          continue;
        }
        var chunkParsed = readCountFromTextChunk(chunk, resultsTotal, matchingTotal);
        resultsTotal = chunkParsed.resultsTotal;
        matchingTotal = chunkParsed.matchingTotal;
      }
    }
    return { resultsTotal: resultsTotal, matchingTotal: matchingTotal };
  }

  function resolveFilteredBrowseDisplayTotal(resultsTotal, matchingTotal) {
    if (resultsTotal > 0) {
      if (matchingTotal > 0 && resultsTotal > matchingTotal) {
        return matchingTotal;
      }
      return resultsTotal;
    }
    return matchingTotal || 0;
  }

  function urlHasNumericNexusFilters(href) {
    try {
      var url = href || window.location.href;
      var params = new URLSearchParams(new URL(url).search);
      var found = false;
      params.forEach(function (_value, key) {
        if (resolveNumericFilterField(key)) {
          found = true;
        }
      });
      return found;
    } catch (errNumericUrlFilters) {
      return false;
    }
  }

  function hasNumericNexusBrowseFilters() {
    return hasNonDefaultNexusFilterChip() ||
      hasSidebarDownloadsFilterApplied() ||
      urlHasNumericNexusFilters();
  }

  function shouldUseNumericFilteredBrowseScan(config) {
    config = config || enhancer.config || {};
    if (config.onlyTracked || config.onlyInstalled || isLocalCatalogMode(config)) {
      return false;
    }
    if (!isBrowseModsListPathname(getBrowsePathname())) {
      return false;
    }
    if (enhancer.clientSideNumericFilterActive) {
      return true;
    }
    if (hasNumericNexusBrowseFilters()) {
      return true;
    }
    if (enhancer.stashedSidebarNumericFilters && enhancer.stashedSidebarNumericFilters.length) {
      return true;
    }
    if (enhancer.clientSideNumericFilterApplyInFlight) {
      return true;
    }
    if (enhancer.nexusFilterApplyInFlight && shouldUseClientSideNumericFilterApply()) {
      return true;
    }
    if (isUserInteractingWithNexusFilters() && hasSidebarDownloadsFilterApplied()) {
      return true;
    }
    return false;
  }

  function browseUsesFilteredCatalogPaging() {
    return urlHasActiveNexusFilters() ||
      hasNumericNexusBrowseFilters() ||
      hasVisibleNexusFilterChipText() ||
      !!(enhancer.config && enhancer.config.filterBrowseActive);
  }

  function getGraphqlFilteredBrowseResultsTotal() {
    if (!enhancer.nexusFilteredGraphqlTotal || enhancer.nexusFilteredGraphqlTotal <= 0) {
      return 0;
    }
    if (enhancer.nexusFilteredGraphqlTotalSessionKey !== getBrowseSessionKey()) {
      return 0;
    }
    return enhancer.nexusFilteredGraphqlTotal;
  }

  function mergeNexusFilteredResultsTotal(candidate) {
    if (!candidate || candidate <= 0) {
      return;
    }
    if (!enhancer.nexusFilteredResultsTotal || candidate < enhancer.nexusFilteredResultsTotal) {
      enhancer.nexusFilteredResultsTotal = candidate;
    }
  }

  function mergeNexusFilteredMatchingTotal(candidate) {
    if (!candidate || candidate <= 0) {
      return;
    }
    if (!enhancer.nexusFilteredMatchingTotal || candidate > enhancer.nexusFilteredMatchingTotal) {
      enhancer.nexusFilteredMatchingTotal = candidate;
    }
  }

  function lockNexusFilteredDisplayTotal(total) {
    if (!total || total <= 0) {
      return 0;
    }
    if (!enhancer.nexusFilteredDisplayTotalLocked ||
        total < enhancer.nexusFilteredDisplayTotalLocked) {
      enhancer.nexusFilteredDisplayTotalLocked = total;
      enhancer.nexusCatalogTotal = total;
    }
    return enhancer.nexusFilteredDisplayTotalLocked;
  }

  function getLockedNexusFilteredDisplayTotal() {
    return enhancer.nexusFilteredDisplayTotalLocked || 0;
  }

  function resetFilteredBrowseTotalsState() {
    enhancer.nexusFilteredTotalsCaptured = false;
    enhancer.nexusFilteredResultsTotal = 0;
    enhancer.nexusFilteredMatchingTotal = 0;
    enhancer.nexusFilteredDisplayTotalLocked = 0;
    enhancer.nexusFilteredGraphqlTotal = 0;
    enhancer.nexusFilteredGraphqlTotalSessionKey = '';
    if (enhancer.filteredBrowseTotalFetchTimer) {
      clearTimeout(enhancer.filteredBrowseTotalFetchTimer);
      enhancer.filteredBrowseTotalFetchTimer = null;
    }
    enhancer.filteredBrowseTotalFetchInFlight = false;
  }

  function absorbNexusFilteredTotalsFromSources() {
    if (!hasNumericNexusBrowseFilters()) {
      var nextTotals = readNexusFilterTotalsFromNextData();
      mergeNexusFilteredResultsTotal(nextTotals.resultsTotal);
      mergeNexusFilteredMatchingTotal(nextTotals.matchingTotal);
    }
    document.querySelectorAll('[data-vortex-results-original]').forEach(function (node) {
      var original = node.getAttribute('data-vortex-results-original') || '';
      var resultsMatch = original.match(/^([\d][\d,]*)\s+results$/i);
      var matchingMatch = original.match(/^([\d][\d,]*)\s+matching$/i);
      if (resultsMatch) {
        mergeNexusFilteredResultsTotal(parseInt(resultsMatch[1].replace(/,/g, ''), 10));
      }
      if (matchingMatch) {
        mergeNexusFilteredMatchingTotal(parseInt(matchingMatch[1].replace(/,/g, ''), 10));
      }
    });
    var parsed = scanNexusResultsTotalsFromDom();
    mergeNexusFilteredResultsTotal(parsed.resultsTotal);
    mergeNexusFilteredMatchingTotal(parsed.matchingTotal);
    if (enhancer.nexusFilteredResultsTotal || enhancer.nexusFilteredMatchingTotal ||
        parsed.resultsTotal || parsed.matchingTotal) {
      enhancer.nexusFilteredTotalsCaptured = true;
    }
    return resolveFilteredBrowseDisplayTotal(
      enhancer.nexusFilteredResultsTotal || 0,
      enhancer.nexusFilteredMatchingTotal || 0
    );
  }

  function captureNexusFilterTotalsFromDom(force) {
    if (hasNumericNexusBrowseFilters() && !force) {
      scheduleFilteredBrowseTotalFetch(enhancer.config || null);
      return;
    }
    if (getLockedNexusFilteredDisplayTotal() > 0 && !force) {
      return;
    }
    if (force) {
      resetFilteredBrowseTotalsState();
    }
    if (!force && enhancer.nexusFilteredTotalsCaptured) {
      return;
    }
    var resolved = absorbNexusFilteredTotalsFromSources();
    if (resolved > 0) {
      lockNexusFilteredDisplayTotal(resolved);
    }
  }

  function getFilteredBrowseDisplayTotal() {
    if (hasNumericNexusBrowseFilters()) {
      if (enhancer.resolvingNumericFilteredDisplayTotal) {
        return getLockedNexusFilteredDisplayTotal() || 0;
      }
      enhancer.resolvingNumericFilteredDisplayTotal = true;
      try {
        var graphqlTotal = getGraphqlFilteredBrowseResultsTotal();
        if (graphqlTotal > 0) {
          return graphqlTotal;
        }
        var numericLocked = getLockedNexusFilteredDisplayTotal();
        if (numericLocked > 0) {
          scheduleFilteredBrowseTotalFetch(enhancer.config || null);
          return numericLocked;
        }
        scheduleFilteredBrowseTotalFetch(enhancer.config || null);
        var numericDom = scanNexusResultsTotalsFromDom();
        var numericResults = resolveNumericFilteredResultsTotal(numericDom);
        if (numericResults > 0) {
          return lockNumericFilteredResultsTotal(numericResults, numericDom);
        }
        return getLockedNexusFilteredDisplayTotal() || 0;
      } finally {
        enhancer.resolvingNumericFilteredDisplayTotal = false;
      }
    }
    var locked = getLockedNexusFilteredDisplayTotal();
    if (locked > 0) {
      return locked;
    }
    captureNexusFilterTotalsFromDom(false);
    locked = getLockedNexusFilteredDisplayTotal();
    if (locked > 0) {
      return locked;
    }
    var resolved = resolveFilteredBrowseDisplayTotal(
      enhancer.nexusFilteredResultsTotal || 0,
      enhancer.nexusFilteredMatchingTotal || 0
    );
    if (resolved > 0) {
      return lockNexusFilteredDisplayTotal(resolved);
    }
    var parsed = scanNexusResultsTotalsFromDom();
    resolved = resolveFilteredBrowseDisplayTotal(parsed.resultsTotal || 0, parsed.matchingTotal || 0);
    if (resolved > 0) {
      return lockNexusFilteredDisplayTotal(resolved);
    }
    var nextTotal = readNexusFilteredTotalFromNextData();
    if (nextTotal && nextTotal > 0) {
      return lockNexusFilteredDisplayTotal(nextTotal);
    }
    return enhancer.nexusCatalogTotal || 0;
  }

  function readNexusResultsTotalFromDom() {
    var parsed = scanNexusResultsTotalsFromDom();
    if (hasNumericNexusBrowseFilters()) {
      return parsed.resultsTotal || null;
    }
    if (isNexusFilteredBrowse()) {
      return parsed.resultsTotal || parsed.matchingTotal || null;
    }
    return parsed.resultsTotal || parsed.matchingTotal || null;
  }

  function suppressMatchingCountLabelsImmediately() {
    walkResultsCountLabelHosts(function (host, text, label) {
      if (label !== 'matching' ||
          host.getAttribute('data-vortex-results-headline') === 'true') {
        return;
      }
      hideMatchingCountLabelHost(host, text);
    });
  }

  function scheduleNumericMatchingLabelSuppress() {
    if (!hasNumericNexusBrowseFilters()) {
      if (enhancer.numericMatchingSuppressTimer) {
        clearInterval(enhancer.numericMatchingSuppressTimer);
        enhancer.numericMatchingSuppressTimer = null;
      }
      return;
    }
    suppressMatchingCountLabelsImmediately();
    if (enhancer.numericMatchingSuppressTimer) {
      return;
    }
    var suppressTicks = 0;
    enhancer.numericMatchingSuppressTimer = setInterval(function () {
      suppressTicks += 1;
      if (!hasNumericNexusBrowseFilters() || suppressTicks > 6) {
        clearInterval(enhancer.numericMatchingSuppressTimer);
        enhancer.numericMatchingSuppressTimer = null;
        return;
      }
      suppressMatchingCountLabelsImmediately();
    }, 700);
  }

  function hideStaleMatchingCountLabels(total) {
    walkResultsCountLabelHosts(function (host, text, label) {
      if (label !== 'matching' ||
          host.getAttribute('data-vortex-results-headline') === 'true') {
        return;
      }
      if (hasNumericNexusBrowseFilters()) {
        hideMatchingCountLabelHost(host, text);
        return;
      }
      if (!total || total <= 0) {
        return;
      }
      var parsed = parseInt(text.replace(/[^\d]/g, ''), 10);
      if (!parsed || parsed <= total) {
        return;
      }
      hideMatchingCountLabelHost(host, text);
    });
  }

  function applyNumericFilteredResultsHeadline(total) {
    total = reconcileNumericFilteredResultsTotal(total);
    if (!total || total <= 0) {
      suppressMatchingCountLabelsImmediately();
      return;
    }
    var label = formatResultsCount(total) + ' results';
    var headline = document.querySelector('[data-vortex-results-headline="true"]');
    if (!headline) {
      headline = findResultsHeadlineElement();
    }
    if (headline) {
      if (!headline.hasAttribute('data-vortex-results-original')) {
        headline.setAttribute(
          'data-vortex-results-original',
          normalizeCountScanText(headline.textContent || '')
        );
      }
      headline.textContent = label;
      headline.setAttribute('data-vortex-results-headline', 'true');
      headline.classList.remove('vortex-enhanced-hide-native-count');
      headline.style.removeProperty('display');
    }
    hideStaleMatchingCountLabels(total);
  }

  function publishNumericFilteredResultsTotal(total, parsed) {
    if (!total || total <= 0) {
      return 0;
    }
    if (parsed) {
      total = reconcileNumericFilteredResultsTotal(total, parsed);
    }
    if (!total || total <= 0) {
      return 0;
    }
    if (enhancer.publishingNumericFilteredResultsTotal) {
      lockNumericFilteredResultsTotal(total, parsed);
      return total;
    }
    enhancer.publishingNumericFilteredResultsTotal = true;
    try {
      lockNumericFilteredResultsTotal(total, parsed);
      var config = enhancer.config || {};
      var catalogLen = (enhancer.filteredCarouselCatalog || []).length;
      if (shouldUseNumericFilteredBrowseScan(config)) {
        updateMinimalCarouselControlsInline(config, enhancer.filteredCarouselCatalog || [], total);
      } else {
        var pageSize = getCarouselPageSize(config);
        var controls = document.querySelector('.vortex-enhanced-carousel-controls');
        if (controls) {
          updateCarouselControls(total, Math.max(1, Math.ceil(total / pageSize)), pageSize,
            enhancer.globalPageIndex || 0, {
              skipCatalogResolve: true,
              loadedCatalogCount: catalogLen,
              displayTotal: total,
              catalogPages: Math.max(1, Math.ceil(total / pageSize)),
            });
        }
      }
      setTimeout(function () {
        try {
          suppressMatchingCountLabelsImmediately();
        } catch (errSuppressAsync) {
          // ignore
        }
      }, 0);
    } finally {
      enhancer.publishingNumericFilteredResultsTotal = false;
    }
    return total;
  }

  function rewriteFilteredCountTextNodes(total) {
    if (hasNumericNexusBrowseFilters()) {
      return;
    }
    var matchingLabel = formatResultsCount(total) + ' results';
    var roots = [
      document.getElementById('mainContent'),
      document.querySelector('[class*="ResultsHeader"]'),
      document.querySelector('main'),
    ];
    var seenRoot = {};
    enhancer.syncingFilteredHeadlines = true;
    try {
      for (var r = 0; r < roots.length; r++) {
        var root = roots[r];
        if (!root || seenRoot[root]) {
          continue;
        }
        seenRoot[root] = true;
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
          if (node.parentElement &&
              node.parentElement.closest('.vortex-enhanced-carousel-controls, [data-vortex-enhanced-filters="true"]')) {
            continue;
          }
          var text = normalizeCountScanText(node.textContent || '');
          if (!text) {
            continue;
          }
          if (!safeMatchCountLabel(text, 'results') && !safeMatchCountLabel(text, 'matching')) {
            continue;
          }
          node.textContent = matchingLabel;
        }
      }
    } finally {
      enhancer.syncingFilteredHeadlines = false;
    }
  }

  function applyCanonicalFilteredResultsHeadline(total) {
    if (!total || total <= 0) {
      return;
    }
    var label = formatResultsCount(total) + ' results';
    var canonicalHost = null;
    var headerShells = document.querySelectorAll('[class*="ResultsHeader"], [class*="ModsHeader"], [class*="ModsToolbar"]');
    if (!headerShells.length) {
      headerShells = document.querySelectorAll('#mainContent > div, main > div');
    }
    enhancer.syncingFilteredHeadlines = true;
    try {
      for (var s = 0; s < headerShells.length; s++) {
        var shell = headerShells[s];
        if (shell.closest('.vortex-enhanced-carousel-controls, [data-vortex-enhanced-filters="true"]')) {
          continue;
        }
        var walker = document.createTreeWalker(shell, NodeFilter.SHOW_TEXT, null);
        var textNode;
        while ((textNode = walker.nextNode())) {
          var text = normalizeCountScanText(textNode.textContent || '');
          if (!text || !/[\d][\d,]*\s+(?:results|matching)\b/i.test(text)) {
            continue;
          }
          var host = textNode.parentElement;
          if (!host || host.closest('.vortex-enhanced-carousel-controls, [data-vortex-enhanced-filters="true"]')) {
            continue;
          }
          if (!host.hasAttribute('data-vortex-results-original')) {
            host.setAttribute('data-vortex-results-original', text);
          }
          if (!canonicalHost) {
            textNode.textContent = label;
            host.setAttribute('data-vortex-results-headline', 'true');
            host.classList.remove('vortex-enhanced-hide-native-count');
            host.style.removeProperty('display');
            canonicalHost = host;
            continue;
          }
          if (host === canonicalHost || canonicalHost.contains(host) || host.contains(canonicalHost)) {
            textNode.textContent = label;
            continue;
          }
          host.classList.add('vortex-enhanced-hide-native-count');
          host.style.setProperty('display', 'none', 'important');
        }
      }
      if (!canonicalHost) {
        var fallback = findResultsHeadlineElement();
        if (fallback) {
          fallback.textContent = label;
          fallback.setAttribute('data-vortex-results-headline', 'true');
          fallback.classList.remove('vortex-enhanced-hide-native-count');
          fallback.style.removeProperty('display');
          canonicalHost = fallback;
        }
      }
      if (!hasNumericNexusBrowseFilters()) {
        rewriteFilteredCountTextNodes(total);
      }
    } finally {
      enhancer.syncingFilteredHeadlines = false;
    }
  }

  function syncFilteredBrowseDocumentState() {
    if (isNexusFilteredBrowse()) {
      document.documentElement.classList.add('vortex-enhanced-filtered-browse');
    } else {
      document.documentElement.classList.remove('vortex-enhanced-filtered-browse');
    }
  }

  function syncNexusFilteredResultsHeadlines() {
    if (enhancer.syncingFilteredHeadlinePass) {
      return;
    }
    enhancer.syncingFilteredHeadlinePass = true;
    try {
    syncFilteredBrowseDocumentState();
    if (!isNexusFilteredBrowse()) {
      return;
    }
    if (hasNumericNexusBrowseFilters() || shouldUseNumericFilteredBrowseScan()) {
      scheduleFilteredBrowseTotalFetch(enhancer.config || null);
      return;
    }
    if (getLockedNexusFilteredDisplayTotal() <= 0) {
      captureNexusFilterTotalsFromDom(false);
    }
    var total = pinNexusFilteredResultsTotal();
    if (!total || total <= 0) {
      return;
    }
    applyCanonicalFilteredResultsHeadline(total);
    refreshCarouselControlsFilteredTotal();
    } finally {
      enhancer.syncingFilteredHeadlinePass = false;
    }
  }

  function pinNexusFilteredResultsTotal() {
    if (!isNexusFilteredBrowse()) {
      return 0;
    }
    var total = getFilteredBrowseDisplayTotal();
    if (total > 0) {
      lockNexusFilteredDisplayTotal(total);
    }
    return total;
  }

  function parseNexusResultsTotal() {
    var config = enhancer.config;
    if (config && isLocalCatalogMode(config)) {
      var catalogTotal = getLocalCatalogHeadlineTotal(config);
      if (catalogTotal > 0) {
        return catalogTotal;
      }
    }

    if (isNexusFilteredBrowse()) {
      var lockedFilteredTotal = getLockedNexusFilteredDisplayTotal();
      if (lockedFilteredTotal > 0) {
        return lockedFilteredTotal;
      }
      if (enhancer.nexusCatalogTotal && enhancer.nexusCatalogTotal > 0) {
        return enhancer.nexusCatalogTotal;
      }
    }

    if (enhancer.nexusCatalogTotal && enhancer.nexusCatalogTotal > 0) {
      return enhancer.nexusCatalogTotal;
    }

    var domTotal = readNexusResultsTotalFromDom();
    if (domTotal && domTotal > 0) {
      if (isNexusFilteredBrowse()) {
        return lockNexusFilteredDisplayTotal(domTotal) || domTotal;
      }
      return domTotal;
    }

    var headline = document.querySelector('[data-vortex-results-headline="true"]');
    if (headline) {
      var original = headline.getAttribute('data-vortex-results-original');
      if (original) {
        var originalMatch = original.match(/^([\d][\d,]*)\s+(?:results|matching)$/i);
        if (originalMatch) {
          return parseInt(originalMatch[1].replace(/,/g, ''), 10);
        }
      }
      var headlineText = (headline.textContent || '').replace(/\s+/g, ' ').trim();
      var headlineMatch = headlineText.match(/^([\d][\d,]*)\s+(?:results|matching)$/i);
      if (headlineMatch) {
        return parseInt(headlineMatch[1].replace(/,/g, ''), 10);
      }
    }
    return null;
  }

  function parseGraphInt(value, depth) {
    depth = depth || 0;
    if (depth > 8) {
      return null;
    }
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'number' && isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
    if (typeof value === 'string') {
      var parsed = parseInt(value.replace(/,/g, ''), 10);
      return isNaN(parsed) ? null : Math.max(0, parsed);
    }
    if (typeof value === 'object') {
      if (value.value != null) {
        return parseGraphInt(value.value, depth + 1);
      }
      if (value.kb != null) {
        return parseGraphInt(value.kb, depth + 1);
      }
      if (value.bytes != null) {
        var bytes = parseGraphInt(value.bytes, depth + 1);
        return bytes == null ? null : Math.max(0, Math.round(bytes / 1024));
      }
    }
    return null;
  }

  function normalizeEnrichmentDetails(node, modId) {
    if (!node) {
      return null;
    }

    if (node.modId && modId && String(node.modId) !== String(modId)) {
      return null;
    }

    var summary = (node.summary || '').replace(/\s+/g, ' ').trim();
    var downloads = parseGraphInt(node.downloads);
    var endorsements = parseGraphInt(node.endorsements);
    var fileSize = parseGraphInt(node.fileSize);

    if (!summary && downloads == null && endorsements == null && fileSize == null) {
      return null;
    }

    return {
      summary: summary,
      downloads: downloads == null ? 0 : downloads,
      endorsements: endorsements == null ? 0 : endorsements,
      fileSize: fileSize == null ? 0 : fileSize,
      enriched: true,
    };
  }

  function formatCompactCount(value) {
    var n = parseGraphInt(value);
    if (n == null) {
      return '';
    }
    if (n >= 1000000) {
      return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (n >= 1000) {
      return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return String(n);
  }

  function formatFileSizeKb(kb) {
    var size = parseGraphInt(kb);
    if (size == null || size <= 0) {
      return '';
    }
    if (size >= 1024) {
      return (size / 1024).toFixed(1).replace(/\.0$/, '') + ' MB';
    }
    return size + ' KB';
  }

  function removeInjectedMetaStats(card) {
    if (!card) {
      return;
    }

    card.querySelectorAll('.vortex-enhanced-meta-stats').forEach(function (node) {
      if (node.parentElement) {
        node.parentElement.removeChild(node);
      }
    });
  }

  function restoreNativeTileStats(card) {
    if (!card) {
      return;
    }

    var selectors = [
      '[data-e2eid="mod-tile-stats"]',
      '[data-e2eid="mod-tile-endorses"]',
      '[data-e2eid="mod-tile-downloads"]',
      '[data-e2eid="mod-tile-file-size"]',
    ];

    selectors.forEach(function (selector) {
      card.querySelectorAll(selector).forEach(function (node) {
        node.classList.remove('vortex-enhanced-hide-nexus-badge');
      });
    });
  }

  function ensureTileImagesLoaded(card) {
    if (!card || card.classList.contains('vortex-enhanced-carousel-hidden')) {
      return;
    }

    card.querySelectorAll('img').forEach(function (img) {
      var src = img.currentSrc || img.getAttribute('src') || '';
      if (src && (src.indexOf('http') === 0 || src.indexOf('//') === 0)) {
        return;
      }

      var dataSrc = img.getAttribute('data-src') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('data-original');
      if (dataSrc && (dataSrc.indexOf('http') === 0 || dataSrc.indexOf('//') === 0)) {
        img.setAttribute('src', dataSrc);
      }
    });
  }

  function resolveGameNumericId(config) {
    if (config && config.gameNumericId) {
      enhancer.gameNumericId = config.gameNumericId;
      return config.gameNumericId;
    }
    if (enhancer.gameNumericId) {
      return enhancer.gameNumericId;
    }
    try {
      var nextData = document.getElementById('__NEXT_DATA__');
      if (nextData && nextData.textContent) {
        var parsed = JSON.parse(nextData.textContent);
        var gameId = parsed &&
          parsed.props &&
          parsed.props.pageProps &&
          parsed.props.pageProps.game &&
          parsed.props.pageProps.game.id;
        if (gameId) {
          enhancer.gameNumericId = Number(gameId);
          return enhancer.gameNumericId;
        }
      }
    } catch (err) {
      // ignore
    }
    return null;
  }

  function resolveModUid(config, modId) {
    if (!modId) {
      return null;
    }
    if (config.modUids && config.modUids[String(modId)]) {
      return config.modUids[String(modId)];
    }
    var gameId = resolveGameNumericId(config);
    if (!gameId) {
      return null;
    }
    try {
      return ((BigInt(gameId) << 32n) | BigInt(modId)).toString();
    } catch (err) {
      return null;
    }
  }

  function makeModUidForFetch(config, modId) {
    if (!modId) {
      return null;
    }
    var gameId = resolveGameNumericId(config);
    if (!gameId) {
      return resolveModUid(config, modId);
    }
    try {
      return ((BigInt(gameId) << 32n) | BigInt(modId)).toString();
    } catch (err) {
      return resolveModUid(config, modId);
    }
  }

  function ensureCardFlexShell(card) {
    if (!card) {
      return null;
    }

    card.style.setProperty('display', 'flex', 'important');
    card.style.setProperty('flex-direction', 'column', 'important');
    card.style.setProperty('height', '100%', 'important');
    card.style.setProperty('min-height', '100%', 'important');

    var shell = card.querySelector(':scope > div');
    if (!shell) {
      return null;
    }

    shell.classList.add('vortex-enhanced-card-shell');
    shell.style.setProperty('display', 'flex', 'important');
    shell.style.setProperty('flex-direction', 'column', 'important');
    shell.style.setProperty('flex', '1 1 auto', 'important');
    shell.style.setProperty('flex-grow', '1', 'important');
    shell.style.setProperty('min-height', '0', 'important');
    shell.style.setProperty('height', '100%', 'important');
    shell.style.setProperty('width', '100%', 'important');
    return shell;
  }

  function pinFooterToCardBottom(card) {
    if (!card) {
      return;
    }

    var shell = ensureCardFlexShell(card);
    var footer = findTileFooter(card);
    if (!footer) {
      return;
    }

    if (shell && footer.parentElement === shell && shell.lastElementChild !== footer) {
      shell.appendChild(footer);
    }

    footer.classList.add('vortex-enhanced-footer-row');
    footer.style.setProperty('margin-top', 'auto', 'important');
    footer.style.setProperty('padding-top', '0', 'important');
    footer.style.setProperty('flex-shrink', '0', 'important');
    footer.style.setProperty('flex-grow', '0', 'important');
    footer.style.setProperty('width', '100%', 'important');
    footer.style.setProperty('align-self', 'stretch', 'important');
  }

  function compactCardFlex(card) {
    if (!card) {
      return;
    }

    var shell = card.querySelector(':scope > div.vortex-enhanced-card-shell') || card.querySelector(':scope > div');

    card.querySelectorAll('[class*="flex-1"], [class*="grow"]').forEach(function (node) {
      if (node === card || node === shell) {
        return;
      }
      if (node.closest('.vortex-enhanced-footer-row')) {
        return;
      }
      node.style.setProperty('flex', '0 0 auto', 'important');
      node.style.setProperty('flex-grow', '0', 'important');
      node.style.setProperty('min-height', '0', 'important');
      node.style.setProperty('height', 'auto', 'important');
      node.style.setProperty('margin-bottom', '0', 'important');
      node.style.setProperty('padding-bottom', '0', 'important');
    });

    if (!shell) {
      return;
    }

    shell.querySelectorAll(':scope > div, :scope > a + div').forEach(function (node) {
      if (node.classList.contains('vortex-enhanced-footer-row') ||
          node.classList.contains('mt-auto') ||
          node.querySelector('.vortex-enhanced-footer-row, .mt-auto')) {
        return;
      }
      node.style.setProperty('flex', '0 0 auto', 'important');
      node.style.setProperty('flex-grow', '0', 'important');
      node.style.setProperty('min-height', '0', 'important');
      node.style.setProperty('padding-bottom', '0', 'important');
      node.style.setProperty('margin-bottom', '0', 'important');
    });
  }

  function closeNexusFiltersPanel() {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var text = (buttons[i].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.indexOf('hide filters') === 0) {
        buttons[i].click();
        return true;
      }
    }
    return false;
  }

  function translationFilterExcludedInUrl() {
    try {
      var url = new URL(window.location.href);
      return url.searchParams.getAll('excludedTag').some(function (tag) {
        return /translation/i.test(String(tag));
      });
    } catch (err) {
      return false;
    }
  }

  function shouldApplyTranslationFilter() {
    if (enhancer.userDismissedTranslationFilter) {
      return false;
    }
    return !!(enhancer.clientHideTranslations || enhancer.forceDefaultFilters);
  }

  function shouldFilterTranslationsClientSide() {
    if (enhancer.userDismissedTranslationFilter) {
      return false;
    }
    return !!(enhancer.hideTranslationsApplied || enhancer.clientHideTranslations);
  }

  function hrefHasTranslationExcludedTag(href) {
    try {
      var url = new URL(href || window.location.href, window.location.origin);
      return url.searchParams.getAll('excludedTag').some(function (tag) {
        return /translation/i.test(String(tag));
      });
    } catch (errHref) {
      return false;
    }
  }

  function translationFilterDroppedBetweenHrefs(prevHref, nextHref) {
    if (!prevHref || !nextHref || prevHref === nextHref) {
      return false;
    }
    try {
      var prev = new URL(prevHref, window.location.origin);
      var next = new URL(nextHref, window.location.origin);
      if (prev.pathname !== next.pathname) {
        return false;
      }
      return hrefHasTranslationExcludedTag(prevHref) && !hrefHasTranslationExcludedTag(nextHref);
    } catch (errDrop) {
      return false;
    }
  }

  function normalizeBrowseSessionKeyIgnoringTranslation(sessionKey) {
    if (!sessionKey) {
      return '';
    }
    try {
      var parts = String(sessionKey).split('?');
      var pathname = parts[0] || '';
      var params = new URLSearchParams(parts[1] || '');
      params.delete('excludedTag');
      var normalized = [];
      params.forEach(function (value, key) {
        normalized.push(key + '=' + value);
      });
      normalized.sort();
      return pathname + '?' + normalized.join('&');
    } catch (errKey) {
      return sessionKey;
    }
  }

  function sessionKeyChangeIsTranslationOnly(prevKey, nextKey) {
    if (!prevKey || !nextKey || prevKey === nextKey) {
      return false;
    }
    return normalizeBrowseSessionKeyIgnoringTranslation(prevKey) ===
      normalizeBrowseSessionKeyIgnoringTranslation(nextKey);
  }

  function translationFilterRemovedBetweenSessionKeys(prevKey, nextKey) {
    if (!prevKey || !nextKey || prevKey === nextKey) {
      return false;
    }
    try {
      var prevParams = new URLSearchParams(String(prevKey).split('?')[1] || '');
      var nextParams = new URLSearchParams(String(nextKey).split('?')[1] || '');
      var prevHad = prevParams.getAll('excludedTag').some(function (tag) {
        return /translation/i.test(String(tag));
      });
      var nextHas = nextParams.getAll('excludedTag').some(function (tag) {
        return /translation/i.test(String(tag));
      });
      return prevHad && !nextHas;
    } catch (errSession) {
      return false;
    }
  }

  function getBrowseGameSlugFromPathname(pathname) {
    if (!pathname) {
      return '';
    }
    var parts = String(pathname).split('/').filter(Boolean);
    if (parts.length >= 3 && parts[0] === 'games' && parts[2] === 'mods') {
      return parts[1];
    }
    if (parts.length >= 2 && parts[1] === 'mods') {
      return parts[0];
    }
    return '';
  }

  var TRANSLATION_DISMISS_STORAGE_PREFIX = 'vortex-enhanced-translation-dismiss:';

  function getTranslationDismissStorageKey(slug) {
    slug = slug || enhancer.lastBrowseGameSlug || getBrowseGameSlugFromPathname(getBrowsePathname()) || 'global';
    return TRANSLATION_DISMISS_STORAGE_PREFIX + slug;
  }

  function persistTranslationDismissState() {
    if (!enhancer.userDismissedTranslationFilter) {
      return;
    }
    try {
      sessionStorage.setItem(getTranslationDismissStorageKey(), '1');
    } catch (errPersist) {
      // ignore storage failures
    }
  }

  function clearTranslationDismissState(slug) {
    try {
      sessionStorage.removeItem(getTranslationDismissStorageKey(slug));
    } catch (errClear) {
      // ignore storage failures
    }
  }

  function restoreTranslationDismissState() {
    try {
      if (sessionStorage.getItem(getTranslationDismissStorageKey()) !== '1') {
        syncTranslationDismissedDocumentClass();
        return;
      }
    } catch (errRestore) {
      return;
    }

    enhancer.userDismissedTranslationFilter = true;
    enhancer.clientHideTranslations = false;
    enhancer.forceDefaultFilters = false;
    enhancer.hideTranslationsApplied = false;
    enhancer.preferHideTranslations = false;
    enhancer.defaultFiltersApplied = true;
    enhancer.translationUrlApplied = !translationFilterExcludedInUrl();
    enhancer.translationUrlPending = false;
    syncTranslationDismissedDocumentClass();
  }

  function syncTranslationDismissedDocumentClass() {
    if (enhancer.userDismissedTranslationFilter) {
      document.documentElement.classList.add('vortex-enhanced-translation-dismissed');
    } else {
      document.documentElement.classList.remove('vortex-enhanced-translation-dismissed');
    }
  }

  function ensureDismissedBrowseChromeSafe() {
    syncTranslationDismissedDocumentClass();
    restoreMainBrowseContentVisibility();
    hideNexusItemsPerPageUi();
    tagNexusPaginationNav();

    var toolbar = findResultsToolbarRow();
    if (toolbar && isInMainBrowseColumn(toolbar, { ignoreVisibility: true })) {
      toolbar.classList.add('vortex-enhanced-results-toolbar');
      toolbar.classList.remove(
        'vortex-enhanced-chrome-hidden',
        'vortex-enhanced-browse-trim-hidden',
        'vortex-enhanced-browse-gap-collapse',
        'vortex-enhanced-nexus-active-filters-empty'
      );
      unhideBrowseContentChain(toolbar);
    }

    document.querySelectorAll('.vortex-enhanced-nexus-active-filters').forEach(function (node) {
      if (!isInMainBrowseColumn(node, { ignoreVisibility: true })) {
        return;
      }
      node.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
      unhideBrowseContentChain(node);
    });
  }

  function applyTranslationDismissRuntimeState() {
    if (!enhancer.userDismissedTranslationFilter) {
      return;
    }
    enhancer.clientHideTranslations = false;
    enhancer.forceDefaultFilters = false;
    enhancer.hideTranslationsApplied = false;
    enhancer.preferHideTranslations = false;
    enhancer.defaultFiltersApplied = true;
  }

  function noteBrowseGameContext(pathname) {
    var slug = getBrowseGameSlugFromPathname(pathname);
    if (!slug) {
      return;
    }
    if (enhancer.lastBrowseGameSlug && slug !== enhancer.lastBrowseGameSlug) {
      clearTranslationDismissState(enhancer.lastBrowseGameSlug);
      enhancer.userDismissedTranslationFilter = false;
      syncTranslationDismissedDocumentClass();
    }
    enhancer.lastBrowseGameSlug = slug;
    restoreTranslationDismissState();
  }

  function isTranslationFilterChipNode(node) {
    if (!node) {
      return false;
    }
    var row = node.closest('.vortex-enhanced-nexus-active-filters');
    if (!row) {
      return false;
    }

    var chips = row.querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < chips.length; i++) {
      var chip = chips[i];
      if (isClearAllControl(chip)) {
        continue;
      }
      var text = normalizeUiText(chip.textContent);
      if (text.indexOf('excluded:') >= 0 && text.indexOf('translation') >= 0) {
        if (chip === node || chip.contains(node)) {
          return true;
        }
      }
    }

    var current = node;
    while (current && current !== row) {
      var blockText = normalizeUiText(current.textContent);
      if (blockText.indexOf('excluded:') >= 0 && blockText.indexOf('translation') >= 0) {
        return true;
      }
      current = current.parentElement;
    }

    return false;
  }

  function buildUrlWithoutTranslationExcludedTag(href) {
    try {
      var url = new URL(href || window.location.href, window.location.origin);
      var kept = url.searchParams.getAll('excludedTag').filter(function (tag) {
        return !/translation/i.test(String(tag));
      });
      url.searchParams.delete('excludedTag');
      kept.forEach(function (tag) {
        url.searchParams.append('excludedTag', tag);
      });
      url.searchParams.delete('page');
      url.searchParams.delete('p');
      url.searchParams.delete('_vortex_reload');
      return url.href;
    } catch (errStrip) {
      return href || window.location.href;
    }
  }

  function isHideTranslationsCheckboxChecked(input) {
    input = input || findHideTranslationsCheckbox();
    if (!input) {
      return false;
    }
    return !!(input.checked ||
      input.getAttribute('aria-checked') === 'true' ||
      input.getAttribute('data-state') === 'checked');
  }

  function syncHideTranslationsSidebar(enabled) {
    if (enabled && enhancer.userDismissedTranslationFilter) {
      return false;
    }
    var input = findHideTranslationsCheckbox();
    if (!input) {
      return false;
    }
    return setHideTranslationsControl(input, !!enabled);
  }

  // Do not click Nexus sidebar controls after chip/clear-all dismiss — that re-applies
  // filters and wipes the browse grid. URL + chip state are already correct.
  function syncHideTranslationsSidebarIfNeeded() {
    if (enhancer.userDismissedTranslationFilter) {
      return true;
    }
    return false;
  }

  function finalizeNexusFilterApplyUrl(href) {
    if (!href || !enhancer.userDismissedTranslationFilter) {
      return href;
    }
    return buildUrlWithoutTranslationExcludedTag(href);
  }

  function scheduleHideTranslationsSidebarOff(delayMs) {
    setTimeout(function () {
      if (!enhancer.userDismissedTranslationFilter) {
        return;
      }
      var input = findHideTranslationsCheckbox();
      if (!input || !isHideTranslationsCheckboxChecked(input)) {
        return;
      }
      enhancer.suppressFilterEvents = true;
      setHideTranslationsControl(input, false);
      setTimeout(function () {
        enhancer.suppressFilterEvents = false;
      }, 500);
    }, typeof delayMs === 'number' ? delayMs : 200);
  }

  function removeTranslationFromUrlViaNavigate() {
    if (!translationFilterExcludedInUrl()) {
      return false;
    }
    var next = buildUrlWithoutTranslationExcludedTag(window.location.href);
    if (!next || next === window.location.href) {
      return false;
    }
    enhancer.nexusFilterApplyInFlight = true;
    enhancer.nexusFilterApplyStartUrl = window.location.href;
    enhancer.pendingNexusFilterUrl = next;
    enhancer.nexusFilterCooldownUntil = Date.now() + 20000;
    try {
      window.location.replace(next);
    } catch (errReplace) {
      try {
        window.location.href = next;
      } catch (errHref) {
        enhancer.nexusFilterApplyInFlight = false;
        enhancer.pendingNexusFilterUrl = '';
        return false;
      }
    }
    setTimeout(function () {
      releaseNexusFilterApplyWhenStable(0);
    }, 600);
    return true;
  }

  function enforceTranslationDismissalState(options) {
    options = options || {};
    if (!enhancer.userDismissedTranslationFilter) {
      return;
    }
    syncHideTranslationsSidebarIfNeeded();
    var inGrace = enhancer.translationDismissGraceUntil &&
      Date.now() < enhancer.translationDismissGraceUntil;
    if (options.stripUrl !== false &&
        !inGrace &&
        !enhancer.translationDismissUserInitiated &&
        translationFilterExcludedInUrl()) {
      removeTranslationFromUrlViaNavigate();
    }
  }

  function isBrowseContentStableForLayout() {
    var host = document.querySelector('.vortex-enhanced-carousel-host') || findModGrid();
    if (!host) {
      return false;
    }
    var tiles = document.querySelectorAll(
      '[data-e2eid="mod-tile"]:not(.vortex-enhanced-carousel-hidden):not(.vortex-enhanced-nexus-live-hidden)'
    ).length;
    return tiles >= 4;
  }

  function isTranslationFilterDismissedBrowse() {
    return !!enhancer.userDismissedTranslationFilter;
  }

  function shouldDeferDismissLayoutCollapse() {
    if (isTranslationFilterDismissedBrowse() && !isBrowseContentStableForLayout()) {
      return true;
    }
    if (browseUrlHasRemovableActiveFilters()) {
      return true;
    }
    if (enhancer.nexusFilterApplyInFlight) {
      return true;
    }
    if (enhancer.translationDismissGraceUntil && Date.now() < enhancer.translationDismissGraceUntil) {
      return true;
    }
    return !isBrowseContentStableForLayout();
  }

  function syncDismissedFilterBrowseState() {
    if (!enhancer.userDismissedTranslationFilter) {
      return;
    }
    ensureDismissedBrowseChromeSafe();
    syncBrowseUrlFilterDocumentState();
    var toolbar = findResultsToolbarRow();
    if (toolbar) {
      toolbar.classList.remove('vortex-enhanced-has-active-filters');
    }
  }

  function isDismissedCarouselBrowseMode(config) {
    return !!(enhancer.userDismissedTranslationFilter && config &&
      !isLocalCatalogMode(config) && !config.onlyTracked && !config.onlyInstalled);
  }

  function isPooledNexusCarouselBrowseMode(config) {
    if (!config || isLocalCatalogMode(config) || config.onlyTracked || config.onlyInstalled) {
      return false;
    }
    return isDismissedCarouselBrowseMode(config) || isFilteredBrowseSession(config);
  }

  function prepareDismissedCarouselBrowse(config) {
    if (!isDismissedCarouselBrowseMode(config)) {
      return;
    }
    syncDismissedFilterBrowseState();
    ensureDismissedBrowseChromeSafe();
    document.querySelectorAll('aside, #filters-panel').forEach(function (node) {
      if (node.closest && node.closest('#vortex-enhanced-pool-host, #vortex-enhanced-live-stash')) {
        return;
      }
      node.classList.remove(
        'vortex-enhanced-browse-trim-hidden',
        'vortex-enhanced-chrome-hidden',
        'vortex-enhanced-browse-gap-collapse'
      );
      unhideBrowseContentChain(node);
    });
  }

  function getVisibleCarouselCatalogCount(config, cards) {
    // Do not call collectCards() here. Its filtered-mode branch asks
    // filteredBrowseUsesLiveCatalogOnly(), which eventually calls this
    // function again and overflows the stack.
    var source = cards && cards.length ? cards : null;
    if (!source) {
      source = collectLiveGridCards(config);
      if (enhancer.tilePool && enhancer.tilePool.length) {
        var combined = source.slice();
        var seen = {};
        for (var i = 0; i < combined.length; i++) {
          if (combined[i] && combined[i].modId) {
            seen[String(combined[i].modId)] = true;
          }
        }
        for (var p = 0; p < enhancer.tilePool.length; p++) {
          var entry = enhancer.tilePool[p];
          if (!entry) {
            continue;
          }
          if (entry.modId && seen[String(entry.modId)]) {
            continue;
          }
          if (entry.modId) {
            seen[String(entry.modId)] = true;
          }
          combined.push(entry);
        }
        source = combined;
      }
    }
    applyFilters(source, config);
    return getVisibleCarouselCards(source).length;
  }

  function carouselPageFullyLoaded(pageIndex, visibleCount, pageSize) {
    pageSize = pageSize || getCarouselPageSize(enhancer.config || {});
    var page = typeof pageIndex === 'number' && pageIndex >= 0 ? pageIndex : 0;
    return visibleCount >= (page + 1) * pageSize;
  }

  function getMaxFullCarouselPageIndex(pageSize, visibleCount) {
    if (!visibleCount || visibleCount <= 0) {
      return 0;
    }
    pageSize = pageSize || getCarouselPageSize(enhancer.config || {});
    var fullPages = Math.floor(visibleCount / pageSize);
    return Math.max(0, fullPages - 1);
  }

  function ensureDismissedLiveBatchMerged(config) {
    if (!isDismissedCarouselBrowseMode(config)) {
      return false;
    }
    var liveCount = collectLiveGridCards(config).length;
    if (liveCount < 8) {
      return false;
    }
    if (!usesMergedCarouselPool()) {
      mergeLiveGridIntoPool(config);
      return true;
    }
    return false;
  }

  function maybePrefetchDismissedLiveBatch(config) {
    if (!isPooledNexusCarouselBrowseMode(config)) {
      return;
    }
    if (urlHasActiveNexusFilters() && (enhancer.globalPageIndex || 0) < 2) {
      return;
    }
    if (isTranslationDismissHandsOff() || isTranslationDismissNavigationPending()) {
      return;
    }
    if (enhancer.pendingPoolFetch || enhancer.pendingNexusBatchAdvance ||
        enhancer.nativeNavFetchInFlight || enhancer.pendingNativeCatalogFetch ||
        enhancer.carouselAdvancePending || enhancer.dismissedBatchPrefetchInFlight) {
      return;
    }
    var pageSize = getCarouselPageSize(config);
    var catalogCount = getVisibleCarouselCatalogCount(config);
    var filteredBrowse = urlHasActiveNexusFilters();
    var prefetchLeadPages = filteredBrowse ? 2 : 2;
    var neededAhead = (enhancer.globalPageIndex + prefetchLeadPages) * pageSize;
    if (!filteredBrowse && catalogCount >= neededAhead) {
      return;
    }
    if (filteredBrowse && !filteredBrowseNeedsNativeBatch(pageSize, catalogCount)) {
      return;
    }

    var nextPage = getNextUnfetchedNexusPage();
    if (!nextPage) {
      return;
    }

    enhancer.dismissedBatchPrefetchInFlight = true;
    fetchNexusBatchPage(nextPage, config, {
      allowNavigation: filteredBrowse ? 'soft' : false,
    }).then(function (ok) {
      enhancer.dismissedBatchPrefetchInFlight = false;
      if (ok) {
        scheduleDebouncedDismissedPoolSnapshot(config);
        if (window.__vortexBrowseEnhancer && isPooledNexusCarouselBrowseMode(config)) {
          var currentPage = enhancer.globalPageIndex || 0;
          var refreshedCount = getVisibleCarouselCatalogCount(config);
          if (carouselPageFullyLoaded(currentPage, refreshedCount, pageSize)) {
            return;
          }
          applyDismissedCatalogCarouselPage(collectCards(config), config);
        } else if (window.__vortexBrowseEnhancer) {
          window.__vortexBrowseEnhancer.scheduleScan(true);
        }
      }
    });
  }

  function dismissedCatalogCoversCarouselPage(config, pageIndex) {
    if (!isDismissedCarouselBrowseMode(config)) {
      return false;
    }
    var pageSize = getCarouselPageSize(config);
    var page = typeof pageIndex === 'number' && pageIndex >= 0 ? pageIndex : (enhancer.globalPageIndex || 0);
    return carouselPageFullyLoaded(page, getVisibleCarouselCatalogCount(config), pageSize);
  }

  function dismissedLiveGridCoversCarouselPage(config, pageIndex) {
    return dismissedCatalogCoversCarouselPage(config, pageIndex);
  }

  function dismissedBrowseUsesLiveGridOnly(config, pageIndex) {
    if (!isDismissedCarouselBrowseMode(config)) {
      return false;
    }
    if (isTranslationDismissNavigationPending() || isTranslationDismissHandsOff()) {
      return true;
    }
    return dismissedCatalogCoversCarouselPage(config,
      typeof pageIndex === 'number' ? pageIndex : (enhancer.globalPageIndex || 0));
  }

  function shouldUseDismissedTransitionLivePage(config) {
    if (!isDismissedCarouselBrowseMode(config)) {
      return false;
    }
    if (enhancer.nativeNavFetchInFlight || enhancer.pendingNativeCatalogFetch ||
        enhancer.carouselAdvancePending) {
      return false;
    }
    return dismissedBrowseUsesLiveGridOnly(config, enhancer.globalPageIndex || 0);
  }

  function sliceCardsSatisfiedByLiveGrid(slice, grid) {
    if (!slice || !slice.length || !grid) {
      return false;
    }
    var matched = 0;
    for (var i = 0; i < slice.length; i++) {
      var card = slice[i].card;
      if (card && card.isConnected && grid.contains(card)) {
        matched++;
      }
    }
    return matched >= slice.length;
  }

  function applyDismissedCatalogCarouselPage(cards, config) {
    if (!config) {
      return;
    }
    ensureCarouselLayout(config);
    restoreMainBrowseContentVisibility();

    var useLiveOnly = isTranslationDismissNavigationPending() || isTranslationDismissHandsOff() ||
      filteredBrowseUsesLiveCatalogOnly();
    var catalogCards;
    if (cards && cards.length) {
      catalogCards = cards;
    } else if (useLiveOnly && isFilteredBrowseSession(config)) {
      catalogCards = getFilteredCarouselVisibleEntries(config);
    } else if (useLiveOnly) {
      catalogCards = collectLiveGridCards(config);
    } else {
      catalogCards = collectCards(config);
    }
    if (!catalogCards.length) {
      var liveFallback = collectLiveGridCards(config);
      if (liveFallback.length) {
        catalogCards = liveFallback;
      } else {
        scheduleFilteredBrowseRescan();
        return;
      }
    }

    applyFilters(catalogCards, config);
    var visible = sortCatalogEntries(getVisibleCarouselCards(catalogCards));
    var pageSize = getCarouselPageSize(config);
    var currentPage = Math.max(0, enhancer.globalPageIndex || 0);
    var catalogCount = visible.length;

    if (urlHasActiveNexusFilters() || useLiveOnly) {
      var clampedFilteredPage = clampFilteredBrowseLivePageIndex(pageSize, catalogCount, currentPage, {});
      if (clampedFilteredPage !== currentPage) {
        currentPage = clampedFilteredPage;
        enhancer.globalPageIndex = clampedFilteredPage;
        enhancer.batchPageIndex = clampedFilteredPage;
        saveCarouselPagingState();
      }
    } else if (!carouselPageFullyLoaded(currentPage, catalogCount, pageSize)) {
      var maxLoadedPage = getMaxFullCarouselPageIndex(pageSize, catalogCount);
      if (currentPage > maxLoadedPage) {
        currentPage = maxLoadedPage;
        enhancer.globalPageIndex = maxLoadedPage;
        enhancer.batchPageIndex = maxLoadedPage;
        saveCarouselPagingState();
      }
    }

    var localStart = currentPage * pageSize;
    var pageSlice = visible.slice(localStart, localStart + pageSize);
    if (pageSlice.length === 0 && visible.length > 0 && currentPage === 0) {
      pageSlice = visible.slice(0, pageSize);
      localStart = 0;
    }
    if (!(urlHasActiveNexusFilters() || useLiveOnly) &&
        pageSlice.length < pageSize &&
        localStart + pageSize > visible.length &&
        canFetchMoreCarouselBatches()) {
      var maxFullPage = getMaxFullCarouselPageIndex(pageSize, visible.length);
      if (currentPage > maxFullPage) {
        currentPage = maxFullPage;
        enhancer.globalPageIndex = maxFullPage;
        enhancer.batchPageIndex = maxFullPage;
        saveCarouselPagingState();
        localStart = currentPage * pageSize;
        pageSlice = visible.slice(localStart, localStart + pageSize);
      }
    }

    var pageModIds = [];
    for (var k = 0; k < pageSlice.length; k++) {
      if (pageSlice[k].modId) {
        pageModIds.push(pageSlice[k].modId);
      }
    }
    pageModIds.sort(function (a, b) { return a - b; });
    var sliceKey = getCarouselSliceKey(pageSize, pageModIds);
    var controlVisibleCount = getEffectiveResultsTotal(config, catalogCount);
    var batchPages = Math.max(1, Math.ceil(Math.max(controlVisibleCount, 1) / pageSize));

    if (sliceKey === enhancer.lastAppliedSliceKey && pageSlice.length > 0) {
      enhancer.batchPageIndex = currentPage;
      updateCarouselControls(controlVisibleCount, batchPages, pageSize, currentPage);
      if (urlHasActiveNexusFilters()) {
        decorateVisibleGridTiles(config);
      } else {
        for (var sd = 0; sd < pageSlice.length; sd++) {
          if (pageSlice[sd].card) {
            decorateCard(pageSlice[sd].card, pageSlice[sd].modId, pageSlice[sd].installed, config);
          }
        }
      }
      installCarouselWheelHandler();
      scheduleDebouncedDismissedPrefetch(config);
      if (urlHasActiveNexusFilters()) {
        scheduleFilteredBrowseDecorationRetry(config);
      }
      return;
    }
    enhancer.lastAppliedSliceKey = sliceKey;

    var grid = resolveNexusModGridElement();
    var poolHost = useLiveOnly ? null : ensurePoolHost();
    var stash = useLiveOnly ? null : ensureLiveStashHost();
    var sliceModIds = {};
    for (var ps = 0; ps < pageSlice.length; ps++) {
      if (pageSlice[ps].modId) {
        sliceModIds[String(pageSlice[ps].modId)] = true;
      }
    }

    for (var show = 0; show < pageSlice.length; show++) {
      var sliceCard = pageSlice[show].card;
      if (!sliceCard) {
        continue;
      }
      if (grid && sliceCard.isConnected && grid.contains(sliceCard)) {
        sliceCard.classList.remove(
          'vortex-enhanced-carousel-hidden',
          'vortex-enhanced-nexus-live-hidden',
          'vortex-enhanced-hidden'
        );
        sliceCard.style.removeProperty('display');
      } else if (!useLiveOnly && grid) {
        setCarouselTileVisibility(sliceCard, true, grid, poolHost, stash);
      }
      decorateCard(sliceCard, pageSlice[show].modId, pageSlice[show].installed, config);
    }

    if (grid) {
      grid.querySelectorAll('[data-e2eid="mod-tile"]').forEach(function (tile) {
        var tileModId = extractModIdFromTile(tile);
        var showTile = !!(tileModId && sliceModIds[String(tileModId)]);
        if (showTile) {
          tile.classList.remove(
            'vortex-enhanced-nexus-live-hidden',
            'vortex-enhanced-hidden',
            'vortex-enhanced-carousel-hidden'
          );
          tile.style.removeProperty('display');
        } else {
          tile.classList.add('vortex-enhanced-carousel-hidden');
          tile.style.setProperty('display', 'none', 'important');
        }
      });
    }

    enhancer.batchPageIndex = currentPage;
    updateCarouselControls(controlVisibleCount, batchPages, pageSize, currentPage);
    ensureCarouselControlsBar();
    protectBrowseControlsFromChromeHide();
    hideBrowsePageFooter();
    installCarouselWheelHandler();
    syncNexusResultsHeadline(config);

    var visibleKey = pageModIds.join(',');
    if (visibleKey !== enhancer.lastVisibleModsKey) {
      enhancer.lastVisibleModsKey = visibleKey;
      if (pageModIds.length > 0) {
        sendToHost({ type: 'visible-mods', modIds: pageModIds });
      }
    }

    if (!useLiveOnly) {
      scheduleDebouncedDismissedPoolSnapshot(config);
    }
    scheduleDebouncedDismissedPrefetch(config);
    if (urlHasActiveNexusFilters()) {
      decorateVisibleGridTiles(config);
      scheduleFilteredBrowseDecorationRetry(config);
    }
  }

  function applyDismissedTransitionLivePage(cards, config) {
    applyDismissedCatalogCarouselPage(cards, config);
  }

  function scheduleDebouncedDismissedPrefetch(config) {
    if (!isPooledNexusCarouselBrowseMode(config)) {
      return;
    }
    if (urlHasActiveNexusFilters() && (enhancer.globalPageIndex || 0) < 2) {
      return;
    }
    var pageSize = getCarouselPageSize(config);
    var catalogCount = getVisibleCarouselCatalogCount(config);
    var filteredBrowse = urlHasActiveNexusFilters();
    var prefetchLeadPages = 2;
    var neededAhead = (enhancer.globalPageIndex + prefetchLeadPages) * pageSize;
    var shouldPrefetch = (filteredBrowse && filteredBrowseNeedsNativeBatch(pageSize, catalogCount)) ||
      (!filteredBrowse && catalogCount < neededAhead);
    if (!shouldPrefetch) {
      return;
    }
    if (enhancer.dismissedPrefetchDebounceTimer) {
      return;
    }
    enhancer.dismissedPrefetchDebounceTimer = setTimeout(function () {
      enhancer.dismissedPrefetchDebounceTimer = null;
      maybePrefetchDismissedLiveBatch(config);
    }, 600);
  }

  function scheduleDebouncedDismissedPoolSnapshot(config) {
    if (!isDismissedCarouselBrowseMode(config)) {
      return;
    }
    if (enhancer.dismissedPoolSnapshotTimer) {
      clearTimeout(enhancer.dismissedPoolSnapshotTimer);
    }
    enhancer.dismissedPoolSnapshotTimer = setTimeout(function () {
      enhancer.dismissedPoolSnapshotTimer = null;
      saveDismissedBrowsePoolSnapshot(config);
    }, 2500);
  }

  function applyDismissedPoolCarouselPage(cards, config) {
    applyDismissedCatalogCarouselPage(cards, config);
  }

  function isTranslationDismissNavigationPending() {
    if (!enhancer.userDismissedTranslationFilter) {
      return false;
    }
    if (enhancer.translationDismissNavPending) {
      return true;
    }
    if (enhancer.nexusFilterApplyInFlight) {
      return true;
    }
    if (!enhancer.translationDismissUserInitiated || !enhancer.translationDismissedAt) {
      return false;
    }
    var elapsed = Date.now() - enhancer.translationDismissedAt;
    if (elapsed > 15000) {
      return false;
    }
    if (translationFilterExcludedInUrl()) {
      return true;
    }
    var liveTiles = document.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').length;
    return liveTiles < 8 && elapsed < 8000;
  }

  function clearTranslationDismissNavigationPendingIfReady() {
    if (!enhancer.translationDismissNavPending) {
      return;
    }
    if (translationFilterExcludedInUrl() || isBrowseOopsPage()) {
      return;
    }
    var liveTiles = document.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').length;
    if (liveTiles >= 4) {
      enhancer.translationDismissNavPending = false;
      enhancer.enhancementFullyPaused = false;
    }
  }

  function scheduleDismissSidebarSyncWhenStable(delayMs) {
    setTimeout(function () {
      if (!enhancer.userDismissedTranslationFilter) {
        return;
      }
      if (isTranslationDismissNavigationPending()) {
        scheduleDismissSidebarSyncWhenStable(Math.min(delayMs + 350, 2500));
        return;
      }
      syncHideTranslationsSidebarIfNeeded();
    }, delayMs);
  }

  function startTranslationDismissGuard() {
    if (enhancer.translationDismissGuardTimer) {
      clearInterval(enhancer.translationDismissGuardTimer);
    }
    enhancer.translationDismissGuardStartedAt = Date.now();
    var attempts = 0;
    scheduleDismissSidebarSyncWhenStable(500);
    scheduleDismissSidebarSyncWhenStable(1200);
    scheduleDismissSidebarSyncWhenStable(2500);
    enhancer.translationDismissGuardTimer = setInterval(function () {
      attempts += 1;
      if (!enhancer.userDismissedTranslationFilter ||
          attempts > 40 ||
          Date.now() - (enhancer.translationDismissGuardStartedAt || 0) > 8000) {
        clearInterval(enhancer.translationDismissGuardTimer);
        enhancer.translationDismissGuardTimer = null;
        return;
      }
      ensureDismissedBrowseChromeSafe();
    }, 250);
  }

  function acknowledgeUserTranslationFilterDismissal(reason) {
    if (enhancer.userDismissedTranslationFilter) {
      syncHideTranslationsSidebarIfNeeded();
      return;
    }
    traceStep('translation-filter-dismissed', {
      reason: reason || 'unknown',
      href: window.location.href,
      hadExcludedTag: translationFilterExcludedInUrl(),
    });

    var userInitiated = reason === 'chip' ||
      reason === 'clear-all' ||
      reason === 'chip-capture' ||
      reason === 'clear-all-capture';

    enhancer.userDismissedTranslationFilter = true;
    enhancer.translationDismissUserInitiated = userInitiated;
    enhancer.translationDismissGraceUntil = Date.now() + (userInitiated ? 6500 : 1500);
    enhancer.clientHideTranslations = false;
    enhancer.forceDefaultFilters = false;
    enhancer.hideTranslationsApplied = false;
    enhancer.preferHideTranslations = false;
    enhancer.defaultFiltersApplied = true;
    enhancer.translationUrlApplied = false;
    enhancer.translationUrlPending = false;
    enhancer.nexusFilterApplyInFlight = false;
    enhancer.pendingNexusFilterUrl = '';
    enhancer.nexusFilterCooldownUntil = Date.now() + (userInitiated ? 2500 : 20000);

    if (enhancer.translationFilterWatchdog) {
      clearInterval(enhancer.translationFilterWatchdog);
      enhancer.translationFilterWatchdog = null;
    }

    persistTranslationDismissState();
    resetNexusResultsHeadlineCache();
    startTranslationDismissGuard();
    enhancer.translationDismissedAt = Date.now();
    enhancer.translationDismissNavPending = userInitiated;
    enhancer.translationDismissHandsOffUntil = Date.now() + 4000;
    clearCarouselQuietPeriod();
    enhancer.lastAppliedSliceKey = '';
    enhancer.tilePool = [];
    enhancer.dismissedBatchPrefetchInFlight = false;
    enhancer.dismissedBatchPrefetchDone = false;
    enhancer.dismissedPoolRestorePromise = null;
    enhancer.dismissedPoolPagingQuietUntil = 0;
    if (enhancer.dismissedPrefetchDebounceTimer) {
      clearTimeout(enhancer.dismissedPrefetchDebounceTimer);
      enhancer.dismissedPrefetchDebounceTimer = null;
    }
    if (enhancer.dismissedPoolSnapshotTimer) {
      clearTimeout(enhancer.dismissedPoolSnapshotTimer);
      enhancer.dismissedPoolSnapshotTimer = null;
    }
    try {
      sessionStorage.removeItem(getDismissedPoolStorageKey());
    } catch (errClearDismissedPool) {
      // ignore
    }
    enhancer.catalogIndicesBootstrapped = false;
    enhancer.catalogModIdToIndex = {};
    document.querySelectorAll('[data-vortex-catalog-index]').forEach(function (node) {
      node.removeAttribute('data-vortex-catalog-index');
    });
    unhideAllCarouselTiles();
    restoreStashedLiveNexusTiles();
    syncTranslationDismissedDocumentClass();
    enhancer.enhancementFullyPaused = false;
    setTimeout(function () {
      enhancer.translationDismissUserInitiated = false;
    }, 8000);
    if (window.__vortexBrowseEnhancer) {
      window.__vortexBrowseEnhancer.scheduleScan(true);
    }
  }

  function noteNexusActiveFilterUserAction(event) {
    if (!event || !event.target) {
      return;
    }

    var clearEl = event.target.closest('.vortex-enhanced-nexus-clear-all');
    if (clearEl && isClearAllControl(clearEl)) {
      acknowledgeUserTranslationFilterDismissal('clear-all');
      return;
    }

    if (isTranslationFilterChipNode(event.target)) {
      acknowledgeUserTranslationFilterDismissal('chip');
    }
  }

  function isCarouselQuietPeriod() {
    return !!(enhancer.carouselQuietUntil && Date.now() < enhancer.carouselQuietUntil);
  }

  function hideAllCarouselTiles(grid, poolHost, stash) {
    if (grid) {
      grid.querySelectorAll('[data-e2eid="mod-tile"]').forEach(function (tile) {
        setCarouselTileVisibility(tile, false, grid, poolHost, stash);
      });
    }
    if (poolHost) {
      poolHost.querySelectorAll('[data-e2eid="mod-tile"]').forEach(function (tile) {
        setCarouselTileVisibility(tile, false, grid, poolHost, stash);
      });
    }
    if (stash) {
      stash.querySelectorAll('[data-e2eid="mod-tile"]').forEach(function (tile) {
        setCarouselTileVisibility(tile, false, grid, poolHost, stash);
      });
    }
  }

  function showCarouselSlice(slice, grid, poolHost, stash, config) {
    hideAllCarouselTiles(grid, poolHost, stash);
    for (var i = 0; i < slice.length; i++) {
      setCarouselTileVisibility(slice[i].card, true, grid, poolHost, stash);
      decorateCard(slice[i].card, slice[i].modId, slice[i].installed, config);
    }
  }

  function showTrackedCatalogPage(config) {
    if (!config || !isLocalCatalogMode(config) || !enhancer.trackedCatalogActive) {
      return false;
    }
    if (!isTrackedCatalogReady(config) || !enhancer.tilePool || enhancer.tilePool.length === 0) {
      return false;
    }

    var grid = ensureCatalogDisplayGrid(config);
    var poolHost = ensurePoolHost();
    var stash = ensureLiveStashHost();
    if (!grid) {
      return false;
    }

    setLocalCatalogDisplayActive(true);
    stashLiveNexusTilesForLocalCatalog(config);

    var slice = [];
    for (var i = 0; i < enhancer.tilePool.length; i++) {
      var entry = enhancer.tilePool[i];
      if (!entry || !entry.card) {
        continue;
      }
      entry.card.classList.remove('vortex-enhanced-hidden', 'vortex-enhanced-carousel-hidden');
      if (entry.modId) {
        entry.installed = config.installed[String(entry.modId)] || null;
        entry.tracked = !!(config.tracked && config.tracked[String(entry.modId)]);
      }
      slice.push(entry);
    }

    if (slice.length === 0) {
      return false;
    }

    var pageSize = getCarouselPageSize(config);
    var total = getEffectiveResultsTotal(config, slice.length);
    var batchPages = Math.max(1, Math.ceil(Math.max(total, 1) / pageSize));
    var pageModIds = [];
    for (var k = 0; k < slice.length; k++) {
      if (slice[k].modId) {
        pageModIds.push(slice[k].modId);
      }
    }
    pageModIds.sort(function (a, b) { return a - b; });
    enhancer.lastAppliedSliceKey = getCarouselSliceKey(pageSize, pageModIds);
    enhancer.batchPageIndex = enhancer.globalPageIndex || 0;

    showCarouselSlice(slice, grid, poolHost, stash, config);
    updateCarouselControls(total, batchPages, pageSize, enhancer.globalPageIndex || 0);

    var visibleKey = pageModIds.join(',');
    if (visibleKey !== enhancer.lastVisibleModsKey) {
      enhancer.lastVisibleModsKey = visibleKey;
      if (pageModIds.length > 0) {
        sendToHost({ type: 'visible-mods', modIds: pageModIds });
      }
    }
    return true;
  }

  function clearEnhancerLocks() {
    enhancer.enhancementFullyPaused = false;
    enhancer.nexusFilterApplyInFlight = false;
    enhancer.carouselQuietUntil = 0;
    enhancer.filterUiLockUntil = 0;
    enhancer.trackedCatalogFetchInFlight = false;
    enhancer.localCatalogNavLock = false;
    enhancer.applyingCarouselPage = false;
    enhancer.carouselAdvancePending = false;
    enhancer.pendingNexusFilterUrl = '';
    enhancer.nexusFilterApplyStartUrl = '';
    if (enhancer.nexusFilterRefreshTimer) {
      clearTimeout(enhancer.nexusFilterRefreshTimer);
      enhancer.nexusFilterRefreshTimer = null;
    }
    if (enhancer.carouselQuietTimer) {
      clearTimeout(enhancer.carouselQuietTimer);
      enhancer.carouselQuietTimer = null;
    }
    enhancer.pendingPoolCleanup = false;
  }

  function isNexusSortMenuOpen() {
    var listboxes = document.querySelectorAll('[role="listbox"]');
    for (var i = 0; i < listboxes.length; i++) {
      var listbox = listboxes[i];
      if (!listbox || listbox.offsetParent === null) {
        continue;
      }
      var options = listbox.querySelectorAll('[role="option"]');
      for (var j = 0; j < options.length; j++) {
        if (isNexusSortListboxOption(options[j])) {
          return true;
        }
      }
    }
    return false;
  }

  function isBrowseEnhancementPaused() {
    return isNexusSortMenuOpen() || !!enhancer.browseDetailHandsOff;
  }

  function shouldDeferHeavyNexusUi(config) {
    if (enhancer.nexusFilterApplyInFlight) {
      return true;
    }
    if (isCarouselQuietPeriod()) {
      return true;
    }
    if (isNexusFiltersPanelOpen()) {
      return true;
    }
    if (shouldDeferNexusUrlMutation()) {
      return true;
    }
    if (urlHasActiveNexusFilters()) {
      var liveTileCount = document.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').length;
      if (liveTileCount < 24) {
        return true;
      }
    }
    return false;
  }

  function releaseBrowseListEnhancements() {
    stopAutoAdvance();
    stopChromeHideWatchdog();
    document.documentElement.classList.remove('vortex-enhanced-browse-wide', 'vortex-enhanced-hide-chrome');

    document.querySelectorAll('.vortex-enhanced-chrome-hidden, .vortex-enhanced-browse-trim-hidden').forEach(function (node) {
      node.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
    });

    var grid = findModGrid();
    if (grid) {
      grid.classList.remove('vortex-enhanced-grid-layout', 'vortex-enhanced-compact-tile');
      grid.style.removeProperty('--vortex-grid-cols');
      grid.style.removeProperty('--vortex-grid-rows');
      grid.style.removeProperty('--vortex-card-height');
      grid.style.removeProperty('--vortex-thumb-height');
      var host = grid.parentElement;
      if (host && host.classList.contains('vortex-enhanced-carousel-host')) {
        host.classList.remove('vortex-enhanced-carousel-host');
      }
    }

    unhideAllCarouselTiles();

    ['vortex-enhanced-controls-bar', 'vortex-enhanced-controls-anchor', 'vortex-enhanced-carousel-controls'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node && node.parentElement) {
        node.parentElement.removeChild(node);
      }
    });

    document.querySelectorAll('[data-vortex-enhanced-filters="true"]').forEach(function (panel) {
      if (panel.parentElement) {
        panel.parentElement.removeChild(panel);
      }
    });
  }

  function enterBrowseDetailHandsOffMode() {
    if (enhancer.browseDetailHandsOff) {
      return;
    }
    enhancer.browseDetailHandsOff = true;
    releaseBrowseListEnhancements();
  }

  function exitBrowseDetailHandsOffMode() {
    if (!enhancer.browseDetailHandsOff) {
      return;
    }
    enhancer.browseDetailHandsOff = false;
    enhancer.pagingStateHydrated = false;
    enhancer.filteredFillAttempts = 0;
  }

  function detachPoolTilesOnly() {
    document.querySelectorAll('[data-vortex-pool-tile="true"]').forEach(function (tile) {
      if (tile.parentElement) {
        tile.parentElement.removeChild(tile);
      }
    });
    enhancer.tilePool = [];
  }

  function unhideAllCarouselTiles() {
    document.querySelectorAll(
      '.vortex-enhanced-carousel-hidden, .vortex-enhanced-nexus-live-hidden'
    ).forEach(function (node) {
      node.classList.remove('vortex-enhanced-carousel-hidden', 'vortex-enhanced-nexus-live-hidden');
      if (node.style) {
        node.style.removeProperty('display');
      }
    });
  }

  function scheduleQuietPeriodEnd(quietMs) {
    quietMs = typeof quietMs === 'number' && quietMs > 0 ? quietMs : 3500;
    if (enhancer.carouselQuietTimer) {
      clearTimeout(enhancer.carouselQuietTimer);
    }
    enhancer.carouselQuietEndDelayMs = quietMs;
    enhancer.carouselQuietTimer = setTimeout(function () {
      enhancer.carouselQuietTimer = null;
      if (window.__vortexBrowseEnhancer && window.__vortexBrowseEnhancer.finalizeBrowseContextTransition) {
        window.__vortexBrowseEnhancer.finalizeBrowseContextTransition();
        return;
      }
      enhancer.carouselQuietUntil = 0;
      if (enhancer.pendingPoolCleanup) {
        cleanupPoolArtifacts(true);
        enhancer.pendingPoolCleanup = false;
      }
      if (window.__vortexBrowseEnhancer) {
        window.__vortexBrowseEnhancer.scheduleScan(true);
      }
    }, quietMs);
  }

  function beginCarouselQuietPeriod(durationMs) {
    if (enhancer.userDismissedTranslationFilter) {
      return;
    }
    var quietMs = typeof durationMs === 'number' && durationMs > 0 ? durationMs : 3500;
    enhancer.scanGeneration = (enhancer.scanGeneration || 0) + 1;
    enhancer.carouselQuietUntil = Date.now() + quietMs;
    enhancer.pendingPoolCleanup = true;
    enhancer.pagingStateHydrated = false;
    enhancer.translationUrlApplied = false;
    enhancer.translationUrlPending = false;
    enhancer.nexusPageSizeAttempts = 0;
    enhancer.nexusPageSizePending = false;
    enhancer.lastAppliedSliceKey = '';
    enhancer.catalogIndicesBootstrapped = false;
    enhancer.catalogModIdToIndex = {};
    scheduleQuietPeriodEnd(quietMs);
  }

  function clearCarouselQuietPeriod() {
    enhancer.carouselQuietUntil = 0;
    enhancer.pendingPoolCleanup = false;
    if (enhancer.carouselQuietTimer) {
      clearTimeout(enhancer.carouselQuietTimer);
      enhancer.carouselQuietTimer = null;
    }
  }

  function handleTranslationOnlyBrowseSessionChange(nextSessionKey) {
    traceStep('translation-filter-session-change', {
      sessionKey: nextSessionKey,
      href: window.location.href,
    });
    enhancer.poolSessionKey = nextSessionKey;
    enhancer.filteredFillAttempts = 0;
    enhancer.lastAppliedSliceKey = '';
    enhancer.tilePool = [];
    clearCarouselQuietPeriod();
    resetNexusResultsHeadlineCache();
    unhideAllCarouselTiles();
    syncDismissedFilterBrowseState();
    if (enhancer.config && enhancer.config.hideSiteChrome) {
      applyDismissedBrowseHideChrome(enhancer.config);
    }
    prepareDismissedCarouselBrowse(enhancer.config || {});
    if (window.__vortexBrowseEnhancer) {
      window.__vortexBrowseEnhancer.scheduleScan(true);
      [500, 1200, 2500].forEach(function (delay) {
        setTimeout(function () {
          if (getBrowseSessionKey() !== nextSessionKey) {
            return;
          }
          if (isBrowseOopsPage()) {
            traceStep('translation-filter-session-oops-recovery', {
              delay: delay,
              href: window.location.href,
            });
            recoverFromBrowseOopsIfNeeded();
            return;
          }
          var grid = findModGrid();
          var liveTiles = grid ? grid.querySelectorAll('[data-e2eid="mod-tile"]').length : 0;
          traceStep('translation-filter-session-retry', {
            delay: delay,
            liveTiles: liveTiles,
          });
          clearBrowseLayoutCollapseMarks();
          unhideAllCarouselTiles();
          ensureDismissedBrowseChromeSafe();
          ensureCarouselControlsBar();
          protectBrowseControlsFromChromeHide();
          hideBrowsePageFooter();
          if (!liveTiles) {
            window.__vortexBrowseEnhancer.scheduleScan(true);
          }
        }, delay);
      });
    }
  }

  function scanLightDuringQuiet(config) {
    applyHideSiteChrome(config);
    tagNexusPaginationNav();
    applyFiltersToAllGridTiles(config);

    var grid = findModGrid();
    var tileCount = 0;
    if (grid) {
      var liveTiles = grid.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])');
      tileCount = liveTiles.length;
      liveTiles.forEach(function (tile) {
        tile.classList.remove('vortex-enhanced-nexus-live-hidden');
        tile.classList.remove('vortex-enhanced-carousel-hidden');
        if (tile.style) {
          tile.style.removeProperty('display');
        }
        var modId = extractModIdFromTile(tile);
        var installedEntry = modId ? (config.installed[String(modId)] || null) : null;
        decorateCard(tile, modId, installedEntry, config);
      });
    }

    ensureCarouselControlsBar();
    protectBrowseControlsFromChromeHide();
    hideBrowsePageFooter();

    return {
      tileCount: tileCount,
      installedMatches: 0,
      hideInstalled: !!config.hideInstalled,
      onlyInstalled: !!config.onlyInstalled,
      hideTracked: !!config.hideTracked,
      onlyTracked: !!config.onlyTracked,
      installedKeys: Object.keys(config.installed || {}).length,
      carouselQuiet: true,
    };
  }

  function syncBrowseUrlParamsSoft() {
    // replaceState races Nexus client routing during sort/filter SPA navigation.
    return false;
  }

  function isNexusPaginationOnlyHrefChange(prevHref, nextHref) {
    if (!prevHref || !nextHref || prevHref === nextHref) {
      return false;
    }
    try {
      var prev = new URL(prevHref, window.location.origin);
      var next = new URL(nextHref, window.location.origin);
      if (prev.origin !== next.origin || prev.pathname !== next.pathname) {
        return false;
      }
      var paginationKeys = { page: true, p: true, offset: true, count: true };
      var allKeys = {};
      prev.searchParams.forEach(function (_, key) {
        allKeys[key] = true;
      });
      next.searchParams.forEach(function (_, key) {
        allKeys[key] = true;
      });
      for (var key in allKeys) {
        if (paginationKeys[key]) {
          continue;
        }
        var prevVals = prev.searchParams.getAll(key).join('\u0001');
        var nextVals = next.searchParams.getAll(key).join('\u0001');
        if (prevVals !== nextVals) {
          return false;
        }
      }
      return prev.searchParams.get('page') !== next.searchParams.get('page') ||
        prev.searchParams.get('p') !== next.searchParams.get('p') ||
        prev.searchParams.get('offset') !== next.searchParams.get('offset') ||
        prev.searchParams.get('count') !== next.searchParams.get('count');
    } catch (errPagHref) {
      return false;
    }
  }

  function getActiveBrowseHref() {
    try {
      if (isBrowseModsListPathname(getBrowsePathname()) &&
          window.location.href.indexOf('nexusmods.com') >= 0) {
        return window.location.href;
      }
    } catch (errActiveHref) {
      // ignore
    }
    var config = enhancer.config || {};
    if (config.browseHref && String(config.browseHref).indexOf('nexusmods.com') >= 0) {
      return String(config.browseHref);
    }
    return window.location.href;
  }

  function isFilteredBrowseSession(config) {
    config = config || enhancer.config || {};
    if (enhancer.clientSideNumericFilterActive) {
      return true;
    }
    if (hasNumericNexusBrowseFilters() || hasVisibleNexusFilterChipText()) {
      return true;
    }
    if (enhancer.filteredBrowseEngaged || enhancer.domFilterBrowseActive) {
      return hasNumericNexusBrowseFilters() ||
        hasVisibleNexusFilterChipText() ||
        urlHasMeaningfulNexusFilters();
    }
    if (hasDomActiveNexusFilters()) {
      return true;
    }
    if (enhancer.nexusFilterApplyInFlight && enhancer.pendingNexusFilterUrl &&
        urlHasMeaningfulNexusFilters(enhancer.pendingNexusFilterUrl)) {
      return true;
    }
    if (urlHasMeaningfulNexusFilters(window.location.href)) {
      return true;
    }
    if (config.filterBrowseActive && urlHasMeaningfulNexusFilters()) {
      return true;
    }
    return urlHasMeaningfulNexusFilters(getActiveBrowseHref());
  }

  function shouldTakeFilteredBrowseFastPath(config) {
    if (!config || !isBrowseModsListPathname(getBrowsePathname())) {
      return false;
    }
    if (hasNumericNexusBrowseFilters()) {
      return false;
    }
    if (enhancer.nexusFilterApplyInFlight) {
      return true;
    }
    return isFilteredBrowseSession(config) && shouldUseFilteredBrowseLightScan(config);
  }

  function runFilteredBrowseFastScan(config) {
    ensureStyles();
    restoreMainBrowseContentVisibility();
    applyHideSiteChrome(config);
    hideNexusItemsPerPageUi();
    tagNexusPaginationNav();
    var stats = executeFilteredBrowseLightScan(config, { nested: true });
    logToHost('scanFilteredBrowseLight done', {
      stats: stats,
      state: summarizeFilteredBrowseState(config),
      filterApplyInFlight: !!enhancer.nexusFilterApplyInFlight,
    });
    return attachHostLogs(stats, config);
  }

  function shouldUseFilteredBrowseLightScanPath(config) {
    if (shouldUseNumericFilteredBrowseScan(config)) {
      return false;
    }
    if (enhancer.nexusFilterApplyInFlight && enhancer.pendingNexusFilterUrl) {
      return true;
    }
    if (urlHasActiveNexusFilters(window.location.href)) {
      return true;
    }
    return !!(config && isFilteredBrowseSession(config) && shouldUseFilteredBrowseLightScan(config));
  }

  function executeFilteredBrowseLightScan(config, options) {
    options = options || {};
    if (enhancer.filteredBrowseLightScanInFlight && !options.nested) {
      return enhancer.lastStats || emptyScanStats(config);
    }
    if (enhancer.scanInProgress && !options.nested) {
      return enhancer.lastStats || emptyScanStats(config);
    }
    var acquired = false;
    if (!enhancer.scanInProgress) {
      enhancer.scanInProgress = true;
      acquired = true;
    }
    enhancer.filteredBrowseLightScanInFlight = true;
    try {
      return scanFilteredBrowseLight(config);
    } finally {
      enhancer.filteredBrowseLightScanInFlight = false;
      if (acquired) {
        enhancer.scanInProgress = false;
      }
    }
  }

  function executeBrowseScan(config) {
    if (shouldUseNumericFilteredBrowseScan(config)) {
      return attachHostLogs(runNumericFilteredBrowseScanPath(config), config);
    }
    if (shouldUseFilteredBrowseLightScanPath(config)) {
      return attachHostLogs(executeFilteredBrowseLightScan(config), config);
    }
    return scan(config);
  }

  function urlParamCountsAsNexusFilter(key, url) {
    if (key === 'count' || key === 'page' || key === 'p' || key === 'offset') {
      return false;
    }
    if (/^sort/i.test(key) || key === 'direction' || key === 'order') {
      return false;
    }
    if (key === 'excludedTag') {
      var tags = url.searchParams.getAll('excludedTag');
      return !(tags.length === 1 && /^translation$/i.test(String(tags[0])));
    }
    return true;
  }

  function urlHasMeaningfulNexusFilters(href) {
    if (href === undefined || href === null || href === '') {
      href = getActiveBrowseHref();
    }
    try {
      var url = new URL(href || getActiveBrowseHref());
      var seen = {};
      var found = false;
      url.searchParams.forEach(function (_, key) {
        if (found || seen[key]) {
          return;
        }
        seen[key] = true;
        if (urlParamCountsAsNexusFilter(key, url)) {
          found = true;
        }
      });
      return found;
    } catch (errMeaningfulFilters) {
      return false;
    }
  }

  function urlHasActiveNexusFilters(href) {
    if (href === undefined || href === null || href === '') {
      if (enhancer.config && enhancer.config.filterBrowseActive) {
        return true;
      }
      href = getActiveBrowseHref();
    }
    try {
      var url = new URL(href || getActiveBrowseHref());
      var seen = {};
      var keys = [];
      url.searchParams.forEach(function (_, key) {
        if (!seen[key]) {
          seen[key] = true;
          keys.push(key);
        }
      });

      return keys.some(function (key) {
        return urlParamCountsAsNexusFilter(key, url);
      });
    } catch (errFilters) {
      return false;
    }
  }

  function isDefaultBrowseListingUrl() {
    try {
      var url = new URL(window.location.href);
      if (!isBrowseModsListPathname(url.pathname)) {
        return false;
      }
      var keys = [];
      url.searchParams.forEach(function (_, key) {
        if (keys.indexOf(key) < 0) {
          keys.push(key);
        }
      });
      if (keys.length === 0) {
        return true;
      }
      if (keys.length === 1 && (keys[0] === 'page' || keys[0] === 'count')) {
        return true;
      }
      if (keys.length === 2 && keys.indexOf('page') >= 0 && keys.indexOf('count') >= 0) {
        return true;
      }
      return false;
    } catch (errDefault) {
      return false;
    }
  }

  function shouldDeferNexusUrlMutation() {
    if (enhancer.nexusFilterApplyInFlight) {
      return true;
    }
    if (enhancer.config && enhancer.config.onlyTracked) {
      return true;
    }
    if (urlHasActiveNexusFilters()) {
      return true;
    }
    if (isNexusFiltersPanelOpen()) {
      return true;
    }
    if (enhancer.nexusFilterCooldownUntil && Date.now() < enhancer.nexusFilterCooldownUntil) {
      return true;
    }
    var liveTiles = document.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').length;
    if (liveTiles === 0) {
      return true;
    }
    return false;
  }

  function ensureBrowseUrlParams() {
    if (!isBrowseModsListPathname(getBrowsePathname())) {
      return false;
    }

    if (shouldDeferNexusUrlMutation()) {
      if (translationFilterExcludedInUrl()) {
        enhancer.translationUrlApplied = true;
        enhancer.translationUrlPending = false;
      }
      return false;
    }

    if (enhancer.translationUrlPending || enhancer.nexusPageSizePending) {
      return false;
    }

    if (isCarouselQuietPeriod()) {
      return false;
    }

    var needsTranslation = shouldApplyTranslationFilter();
    var hasTranslation = translationFilterExcludedInUrl();
    var urlCount = getPageSizeFromUrl();
    var targetSize = enhancer.nexusPageSizeTarget || 80;
    var needsCount = urlCount !== targetSize;
    var liveTiles = document.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').length;

    if ((!needsTranslation || hasTranslation) && !needsCount) {
      if (hasTranslation) {
        enhancer.translationUrlApplied = true;
      }
      return false;
    }

    if (liveTiles >= 8 && window.history && window.history.replaceState) {
      return syncBrowseUrlParamsSoft();
    }

    if (liveTiles > 0) {
      return false;
    }

    return false;
  }

  function ensureTranslationFilterUrl() {
    if (shouldDeferNexusUrlMutation()) {
      return false;
    }
    if (!shouldApplyTranslationFilter()) {
      return false;
    }
    if (translationFilterExcludedInUrl()) {
      enhancer.translationUrlApplied = true;
      enhancer.translationUrlPending = false;
      return false;
    }
    return ensureBrowseUrlParams();
  }

  function findHideTranslationsCheckbox() {
    var aside = findNexusFilterAside();
    var searchRoots = aside ? [aside, document] : [document];

    for (var rootIndex = 0; rootIndex < searchRoots.length; rootIndex++) {
      var searchRoot = searchRoots[rootIndex];
      var inputs = searchRoot.querySelectorAll(
        'input[type="checkbox"], button[role="checkbox"], [role="switch"], [role="checkbox"]'
      );
      for (var i = 0; i < inputs.length; i++) {
        var input = inputs[i];
        var row = input.closest('label') || input.closest('div, li, fieldset') || input.parentElement;
        var aria = (input.getAttribute('aria-label') || '').toLowerCase();
        var rowText = (row && row.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (aria.indexOf('hide translation') >= 0 ||
            aria.indexOf('no translation') >= 0 ||
            aria.indexOf('no translations') >= 0 ||
            aria.indexOf('exclude translation') >= 0 ||
            aria.indexOf('without translation') >= 0 ||
            rowText.indexOf('hide translation') >= 0 ||
            rowText.indexOf('hide translations') >= 0 ||
            rowText.indexOf('no translation') >= 0 ||
            rowText.indexOf('no translations') >= 0 ||
            rowText.indexOf('exclude translation') >= 0 ||
            rowText.indexOf('without translation') >= 0 ||
            rowText === 'translations' ||
            rowText.indexOf('hide translation mods') >= 0) {
          return input;
        }
      }

      var labels = searchRoot.querySelectorAll('label, span, div, button, p');
      for (var j = 0; j < labels.length; j++) {
        var text = (labels[j].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (text.indexOf('hide translation') < 0 &&
            text.indexOf('hide translations') < 0 &&
            text.indexOf('no translation') < 0 &&
            text.indexOf('no translations') < 0 &&
            text.indexOf('exclude translation') < 0 &&
            text.indexOf('without translation') < 0 &&
            text.indexOf('hide translation mods') < 0 &&
            text !== 'translations') {
          continue;
        }

        var labelRow = labels[j].closest('label') || labels[j].parentElement;
        var nested = labelRow && labelRow.querySelector(
          'input[type="checkbox"], button[role="checkbox"], [role="switch"], [role="checkbox"]'
        );
        if (nested) {
          return nested;
        }
      }
    }
    return null;
  }

  function isNexusHideTranslationsActive() {
    if (enhancer.userDismissedTranslationFilter) {
      return translationFilterExcludedInUrl();
    }
    if (translationFilterExcludedInUrl()) {
      return true;
    }

    var input = findHideTranslationsCheckbox();
    if (!input) {
      return false;
    }
    return !!(input.checked ||
      input.getAttribute('aria-checked') === 'true' ||
      input.getAttribute('data-state') === 'checked');
  }

  function hideNexusFilterAside() {
    if (isDismissedCarouselBrowseMode(enhancer.config)) {
      return;
    }
    if (isFilteredBrowseSession(enhancer.config)) {
      return;
    }
    if (enhancer.userWantsNexusFiltersOpen) {
      return;
    }
    if (isNexusFiltersPanelVisible()) {
      return;
    }
    if (enhancer.nexusFilterCooldownUntil && Date.now() < enhancer.nexusFilterCooldownUntil) {
      return;
    }

    var filtersPanel = document.getElementById('filters-panel');
    if (filtersPanel &&
        !filtersPanel.classList.contains('vortex-enhanced-nexus-filters-open')) {
      filtersPanel.classList.add('vortex-enhanced-browse-trim-hidden');
    }

    document.querySelectorAll('aside, #filters-panel').forEach(function (aside) {
      if (aside.querySelector('[data-vortex-enhanced-filters="true"]')) {
        return;
      }
      if (aside.classList.contains('vortex-enhanced-nexus-filters-open')) {
        return;
      }
      aside.classList.add('vortex-enhanced-browse-trim-hidden');
    });
  }

  function mergeNodeLists(first, second) {
    var merged = [];
    for (var i = 0; i < first.length; i++) {
      merged.push(first[i]);
    }
    for (var j = 0; j < second.length; j++) {
      merged.push(second[j]);
    }
    return merged;
  }

  function findModTiles() {
    var poolHost = document.getElementById('vortex-enhanced-pool-host');
    var tiles = document.querySelectorAll('[data-e2eid="mod-tile"]');
    if (tiles.length === 0) {
      return collectFallbackModTiles();
    }

    return Array.prototype.filter.call(tiles, function (tile) {
      if (poolHost && poolHost.contains(tile)) {
        return false;
      }
      if (tile.closest('#vortex-enhanced-catalog-grid')) {
        return false;
      }
      if (tile.closest('#vortex-enhanced-live-stash')) {
        return false;
      }
      if (tile.closest('.vortex-enhanced-carousel-controls')) {
        return false;
      }
      return true;
    });
  }

  function collectFallbackModTiles() {
    var fallback = [];
    var links = document.querySelectorAll('a[data-e2eid="mod-tile-title"], a[href*="/mods/"]');
    var seen = new Set();

    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var modId = parseModIdFromUrl(link.href || '');
      if (!modId) {
        continue;
      }
      var card = link.closest('[data-e2eid="mod-tile"]') ||
        link.closest('article') ||
        link.closest('li') ||
        link.parentElement;
      if (!card || seen.has(card)) {
        continue;
      }
      seen.add(card);
      fallback.push(card);
    }

    return fallback;
  }

  function ensureLiveStashHost() {
    var host = document.querySelector('.vortex-enhanced-carousel-host');
    if (!host) {
      return null;
    }

    var stash = document.getElementById('vortex-enhanced-live-stash');
    if (!stash) {
      stash = document.createElement('div');
      stash.id = 'vortex-enhanced-live-stash';
      stash.className = 'vortex-enhanced-pool-host';
      stash.setAttribute('aria-hidden', 'true');
      host.appendChild(stash);
    }

    return stash;
  }

  function stashLiveTilesFromGrid(grid) {
    var stash = ensureLiveStashHost();
    if (!grid || !stash) {
      return;
    }

    var liveTiles = grid.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])');
    for (var i = 0; i < liveTiles.length; i++) {
      liveTiles[i].classList.remove('vortex-enhanced-nexus-live-hidden', 'vortex-enhanced-carousel-hidden');
      stash.appendChild(liveTiles[i]);
    }
  }

  function restoreLiveTilesFromStash() {
    var stash = document.getElementById('vortex-enhanced-live-stash');
    var grid = findModGrid();
    if (!stash || !grid) {
      return;
    }

    while (stash.firstChild) {
      grid.appendChild(stash.firstChild);
    }
  }

  function ensurePoolHost() {
    var host = document.querySelector('.vortex-enhanced-carousel-host');
    if (!host) {
      return null;
    }

    var pool = document.getElementById('vortex-enhanced-pool-host');
    if (!pool) {
      pool = document.createElement('div');
      pool.id = 'vortex-enhanced-pool-host';
      pool.className = 'vortex-enhanced-pool-host';
      pool.setAttribute('aria-hidden', 'true');
      host.appendChild(pool);
    }

    return pool;
  }

  function releaseGridToPool() {
    var grid = findModGrid();
    var pool = ensurePoolHost();
    if (!grid || !pool) {
      return;
    }

    while (grid.firstChild) {
      pool.appendChild(grid.firstChild);
    }
  }

  function enterLiveCarouselMode(durationMs) {
    enhancer.liveCarouselMode = true;
    if (enhancer.liveCarouselTimer) {
      clearTimeout(enhancer.liveCarouselTimer);
    }
    enhancer.liveCarouselTimer = setTimeout(function () {
      enhancer.liveCarouselMode = false;
      enhancer.liveCarouselTimer = null;
    }, durationMs || 4000);
  }

  function isInsideCarouselControls(node) {
    return !!(node && node.closest && node.closest('.vortex-enhanced-carousel-controls'));
  }

  function isNexusResultsPagination(node) {
    if (!node || !node.closest) {
      return false;
    }
    if (isInsideCarouselControls(node)) {
      return false;
    }
    if (node.closest('.vortex-enhanced-carousel-host')) {
      return false;
    }
    if (node.closest('[role="combobox"], [role="listbox"], [role="option"], [data-radix-popper-content-wrapper]')) {
      return false;
    }

    if (!node.closest('.vortex-enhanced-nexus-pagination-hide')) {
      return false;
    }

    var nav = node.closest('nav, [role="navigation"]');
    if (!nav || !nav.querySelector('[aria-current="page"]')) {
      return false;
    }

    if (node.matches('a[rel="next"], a[rel="prev"], button[rel="next"], button[rel="prev"]')) {
      return true;
    }

    if (node.closest('[aria-current="page"]')) {
      return true;
    }

    var label = (node.getAttribute('aria-label') || '').toLowerCase();
    return label.indexOf('next') >= 0 ||
      label.indexOf('previous') >= 0 ||
      label.indexOf('prev') >= 0 ||
      label.indexOf('go to page') >= 0;
  }

  function getNexusResultsPageFromUrl() {
    try {
      var url = new URL(window.location.href);
      var page = parseInt(url.searchParams.get('page') || url.searchParams.get('p') || '1', 10);
      return isNaN(page) || page < 1 ? 1 : page;
    } catch (err) {
      return 1;
    }
  }

  function getNexusResultsPageFromDom() {
    var navs = document.querySelectorAll('.vortex-enhanced-nexus-pagination-hide, nav, [role="navigation"]');
    for (var n = 0; n < navs.length; n++) {
      var nav = navs[n];
      if (!nav.querySelector('[aria-current="page"]')) {
        continue;
      }
      var current = nav.querySelector('[aria-current="page"]');
      if (!current) {
        continue;
      }
      var text = (current.textContent || '').trim();
      var parsed = parseInt(text, 10);
      if (!isNaN(parsed) && parsed >= 1) {
        return parsed;
      }
    }
    return null;
  }

  function getActiveNexusResultsPage() {
    var domPage = getNexusResultsPageFromDom();
    if (domPage !== null && domPage >= 1) {
      return domPage;
    }
    return getNexusResultsPageFromUrl();
  }

  function filteredNexusTilesChangedSince(startModIds, config, minFresh) {
    minFresh = minFresh || 4;
    if (!startModIds || Object.keys(startModIds).length < minFresh) {
      return false;
    }
    var liveCards = collectLiveGridCards(config || enhancer.config || {});
    if (liveCards.length < minFresh) {
      return false;
    }
    var freshCount = 0;
    for (var i = 0; i < liveCards.length; i++) {
      var modId = liveCards[i].modId;
      if (modId && !startModIds[String(modId)]) {
        freshCount++;
        if (freshCount >= minFresh) {
          return true;
        }
      }
    }
    return false;
  }

  function filteredNexusPageReady(targetNexusPage, startModIds, config, minTiles) {
    minTiles = minTiles || 4;
    var cfg = config || enhancer.config || {};
    var liveCount = collectLiveGridCards(cfg).length;
    if (liveCount < minTiles) {
      return false;
    }
    if (getActiveNexusResultsPage() === targetNexusPage ||
        getNexusResultsPageFromUrl() === targetNexusPage) {
      return true;
    }
    return filteredNexusTilesChangedSince(startModIds, cfg, minTiles);
  }

  function navigateNexusResultsPageByUrl(direction) {
    try {
      var url = new URL(window.location.href);
      var page = getNexusResultsPageFromUrl();
      var next = page + (direction > 0 ? 1 : -1);
      if (next < 1) {
        return false;
      }
      url.searchParams.set('page', String(next));
      if (!url.searchParams.get('count')) {
        url.searchParams.set('count', '80');
      }
      enhancer.pendingPoolFetch = true;
      if (shouldPreferSoftNexusPagination()) {
        enhancer.nativeNavFetchTargetPage = next;
        saveNativePoolSnapshot(enhancer.config || {});
      }
      saveCarouselPagingState();
      window.location.assign(url.toString());
      return true;
    } catch (err) {
      return false;
    }
  }

  function canNavigateNexusResultsPage(direction) {
    if (findNexusPaginationButton(direction)) {
      return true;
    }
    if (direction > 0) {
      return true;
    }
    return getNexusResultsPageFromUrl() > 1;
  }

  function navigateNexusResultsPageSoft(direction, options) {
    options = options || {};
    var btn = findNexusPaginationButton(direction);
    if (!btn) {
      return false;
    }

    enhancer.pendingPoolFetch = true;
    saveCarouselPagingState();

    var forceSoft = !!(options.forceSoft || urlHasActiveNexusFilters());
    var preferSoft = forceSoft || shouldPreferSoftNexusPagination();
    var href = btn.getAttribute('href');
    if (!forceSoft && !preferSoft && href && href !== '#' && href.indexOf('javascript:') !== 0) {
      try {
        var url = new URL(href, window.location.href);
        window.location.assign(url.toString());
        return true;
      } catch (err) {
        // fall through to programmatic click
      }
    }

    enhancer.allowNexusPaginationClick = true;
    try {
      btn.click();
    } catch (clickErr) {
      enhancer.allowNexusPaginationClick = false;
      return false;
    }
    setTimeout(function () {
      enhancer.allowNexusPaginationClick = false;
    }, 0);
    return true;
  }

  function navigateNexusResultsPage(direction, options) {
    options = options || {};
    var btn = findNexusPaginationButton(direction);
    if (btn) {
      enhancer.pendingPoolFetch = true;
      saveCarouselPagingState();

      var forceSoft = !!(options.forceSoft || urlHasActiveNexusFilters());
      var preferSoft = forceSoft || shouldPreferSoftNexusPagination();
      var href = btn.getAttribute('href');
      if (!forceSoft && !preferSoft && href && href !== '#' && href.indexOf('javascript:') !== 0) {
        try {
          var url = new URL(href, window.location.href);
          window.location.assign(url.toString());
          return true;
        } catch (err) {
          // fall through to programmatic click
        }
      }

      enhancer.allowNexusPaginationClick = true;
      try {
        btn.click();
      } catch (clickErr) {
        enhancer.allowNexusPaginationClick = false;
        return navigateNexusResultsPageByUrl(direction);
      }
      setTimeout(function () {
        enhancer.allowNexusPaginationClick = false;
      }, 0);
      return true;
    }

    return navigateNexusResultsPageByUrl(direction);
  }

  function getCatalogPageStart(pageSize) {
    return enhancer.globalPageIndex * pageSize;
  }

  function getCatalogOffsetInBatch(pageSize) {
    return getCatalogPageStart(pageSize) - (enhancer.catalogModOffset || 0);
  }

  function usesMergedCarouselPool() {
    return !!(enhancer.tilePool && enhancer.tilePool.length > 0);
  }

  function getCatalogIndex(card) {
    if (!card) {
      return null;
    }
    var raw = card.getAttribute('data-vortex-catalog-index');
    if (raw === null || raw === '') {
      return null;
    }
    var parsed = parseInt(raw, 10);
    return isNaN(parsed) ? null : parsed;
  }

  function rememberCatalogIndex(modId, index) {
    if (!modId && modId !== 0) {
      return;
    }
    enhancer.catalogModIdToIndex = enhancer.catalogModIdToIndex || {};
    enhancer.catalogModIdToIndex[String(modId)] = index;
  }

  function resolveCatalogIndex(card, modId) {
    var idx = getCatalogIndex(card);
    if (idx !== null) {
      if (modId) {
        rememberCatalogIndex(modId, idx);
      }
      return idx;
    }
    if (modId && enhancer.catalogModIdToIndex && enhancer.catalogModIdToIndex[String(modId)] !== undefined) {
      idx = enhancer.catalogModIdToIndex[String(modId)];
      card.setAttribute('data-vortex-catalog-index', String(idx));
      return idx;
    }
    return null;
  }

  function getMaxCatalogIndex() {
    var max = -1;
    if (enhancer.catalogModIdToIndex) {
      Object.keys(enhancer.catalogModIdToIndex).forEach(function (key) {
        var val = enhancer.catalogModIdToIndex[key];
        if (typeof val === 'number' && val > max) {
          max = val;
        }
      });
    }
    document.querySelectorAll('[data-vortex-catalog-index]').forEach(function (node) {
      var idx = getCatalogIndex(node);
      if (idx !== null && idx > max) {
        max = idx;
      }
    });
    return max;
  }

  function compareCatalogEntries(a, b) {
    var ia = resolveCatalogIndex(a.card, a.modId);
    var ib = resolveCatalogIndex(b.card, b.modId);
    if (ia === null && ib === null) {
      return 0;
    }
    if (ia === null) {
      return 1;
    }
    if (ib === null) {
      return -1;
    }
    return ia - ib;
  }

  function sortCatalogEntries(entries) {
    entries.sort(compareCatalogEntries);
    return entries;
  }

  function bootstrapCatalogIndices(config) {
    var grid = findModGrid();
    if (!grid) {
      return;
    }

    var gridTiles = grid.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])');
    if (gridTiles.length === 0) {
      return;
    }

    var nextIndex = getMaxCatalogIndex() + 1;
    if (nextIndex === 0) {
      nextIndex = 0;
    }

    var assignedAny = false;
    for (var i = 0; i < gridTiles.length; i++) {
      var tile = gridTiles[i];
      if (getCatalogIndex(tile) !== null) {
        continue;
      }
      var modId = extractModIdFromTile(tile);
      tile.setAttribute('data-vortex-catalog-index', String(nextIndex));
      rememberCatalogIndex(modId, nextIndex);
      nextIndex++;
      assignedAny = true;
    }

    if (assignedAny) {
      enhancer.catalogIndicesBootstrapped = true;
    }
  }

  function isEnhancerInternalNode(node) {
    if (!node || node.nodeType !== 1) {
      return false;
    }
    if (node.id === 'vortex-enhanced-pool-host' ||
        node.id === 'vortex-enhanced-live-stash' ||
        node.id === 'vortex-enhanced-carousel-controls' ||
        node.id === 'vortex-enhanced-controls-bar' ||
        node.id === 'vortex-enhanced-controls-anchor') {
      return true;
    }
    if (node.closest && node.closest(
      '#vortex-enhanced-pool-host, #vortex-enhanced-live-stash, #vortex-enhanced-carousel-controls, [data-vortex-enhanced-ui="true"]'
    )) {
      return true;
    }
    return false;
  }

  function mutationAddsLiveModTiles(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (!mutation.addedNodes) {
        continue;
      }
      for (var a = 0; a < mutation.addedNodes.length; a++) {
        var added = mutation.addedNodes[a];
        if (added.nodeType !== 1) {
          continue;
        }
        if (added.matches && added.matches('[data-e2eid="mod-tile"]')) {
          return true;
        }
        if (added.querySelector && added.querySelector('[data-e2eid="mod-tile"]')) {
          return true;
        }
      }
    }
    return false;
  }

  function mutationTouchesOnlyEnhancerInternals(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (isEnhancerInternalNode(mutation.target)) {
        continue;
      }

      var touchedExternal = false;
      if (mutation.addedNodes) {
        for (var a = 0; a < mutation.addedNodes.length; a++) {
          var added = mutation.addedNodes[a];
          if (added.nodeType === 1 && !isEnhancerInternalNode(added)) {
            touchedExternal = true;
            break;
          }
        }
      }
      if (touchedExternal) {
        return false;
      }
      if (mutation.removedNodes) {
        for (var r = 0; r < mutation.removedNodes.length; r++) {
          var removed = mutation.removedNodes[r];
          if (removed.nodeType === 1 && !isEnhancerInternalNode(removed)) {
            return false;
          }
        }
      }
      if (mutation.type === 'attributes' && !isEnhancerInternalNode(mutation.target)) {
        return false;
      }
    }
    return true;
  }

  function getCatalogSliceStart(pageSize) {
    return enhancer.globalPageIndex * pageSize;
  }

  function getCarouselSliceKey(pageSize, pageModIds) {
    return String(enhancer.globalPageIndex) + '|' + String(pageSize) + '|' + pageModIds.join(',');
  }

  function getMaxLoadedCarouselPage(pageSize, visibleCount) {
    if (!visibleCount || visibleCount <= 0) {
      return 0;
    }
    return Math.max(0, Math.ceil(visibleCount / pageSize) - 1);
  }

  function isFilteredBrowsePagingLocked(options) {
    options = options || {};
    return !!options.forcePageApply ||
      !!(enhancer.carouselPagingQuietUntil && Date.now() < enhancer.carouselPagingQuietUntil);
  }

  function clampFilteredBrowseLivePageIndex(pageSize, visibleCount, currentPage, options) {
    if (isFilteredBrowsePagingLocked(options)) {
      return currentPage;
    }
    if (enhancer.carouselAdvancePending || enhancer.pendingNativeCatalogFetch ||
        enhancer.pendingTargetPage != null) {
      return currentPage;
    }
    var config = enhancer.config;
    var liveCount = config ? collectLiveGridCards(config).length : 0;
    var loadedCount = Math.max(visibleCount || 0, liveCount);
    var maxAccessiblePage = getMaxLoadedCarouselPage(pageSize, loadedCount);
    if (currentPage <= maxAccessiblePage) {
      return currentPage;
    }
    if (currentPage * pageSize < loadedCount) {
      return currentPage;
    }
    return maxAccessiblePage;
  }

  function clampGlobalPageIndex(pageSize, visibleCount) {
    var maxPage = getMaxLoadedCarouselPage(pageSize, visibleCount);
    if (enhancer.globalPageIndex > maxPage) {
      enhancer.globalPageIndex = maxPage;
      saveCarouselPagingState();
    }
    if (enhancer.globalPageIndex < 0) {
      enhancer.globalPageIndex = 0;
      saveCarouselPagingState();
    }
  }

  function setCarouselTileVisibility(card, show, grid, poolHost, stash) {
    if (!card) {
      return;
    }

    if (show) {
      card.classList.remove('vortex-enhanced-carousel-hidden', 'vortex-enhanced-nexus-live-hidden');
      card.style.removeProperty('display');
      if (grid && card.parentElement !== grid) {
        grid.appendChild(card);
      }
      return;
    }

    card.classList.add('vortex-enhanced-carousel-hidden');
    card.style.setProperty('display', 'none', 'important');

    var isPool = card.getAttribute('data-vortex-pool-tile') === 'true';
    var host = isPool ? poolHost : stash;
    if (host && card.parentElement !== host) {
      host.appendChild(card);
    }
  }

  function getCatalogAvailableCount(visibleCount) {
    if (usesMergedCarouselPool()) {
      return visibleCount;
    }
    return (enhancer.catalogModOffset || 0) + visibleCount;
  }

  function buildNexusResultsPageUrl(pageNum) {
    var url = new URL(stripInternalBrowseParams(window.location.href));
    if (!enhancer.stashedSidebarNumericFilters ||
        !enhancer.stashedSidebarNumericFilters.length) {
      stashSidebarNumericFilters();
    }
    url.searchParams.set('page', String(pageNum));
    if (!url.searchParams.get('count')) {
      url.searchParams.set('count', '80');
    }
    // Numeric sidebar filters are client-side in the carousel, but Nexus
    // still needs the same query parameters when requesting another page.
    var numericFilters = enhancer.stashedSidebarNumericFilters || [];
    for (var nf = 0; nf < numericFilters.length; nf++) {
      var numericEntry = numericFilters[nf];
      if (!numericEntry || !numericEntry.value) {
        continue;
      }
      var numericLabel = String(numericEntry.name || '') + ' ' +
        String(numericEntry.rowText || '');
      if (/max(?:imum)?\s+downloads?/i.test(numericLabel)) {
        url.searchParams.set('maxDownloads', String(numericEntry.value));
      } else if (/min(?:imum)?\s+downloads?/i.test(numericLabel)) {
        url.searchParams.set('minDownloads', String(numericEntry.value));
      } else if (/max(?:imum)?\s+endorsements?/i.test(numericLabel)) {
        url.searchParams.set('maxEndorsements', String(numericEntry.value));
      } else if (/min(?:imum)?\s+endorsements?/i.test(numericLabel)) {
        url.searchParams.set('minEndorsements', String(numericEntry.value));
      }
    }
    return url.toString();
  }

  function markCurrentNexusPageFetched() {
    var page = getNexusResultsPageFromUrl();
    var ctx = loadNexusListingContext();
    if (urlHasActiveNexusFilters() && page > 1 && !filteredBrowseHasEnoughCatalog()) {
      if (!(enhancer.nativeMergedPages && enhancer.nativeMergedPages[page])) {
        return;
      }
    }
    if (!isGraphqlSupportedBrowseSort(ctx)) {
      if (page > 1 && !(enhancer.nativeMergedPages && enhancer.nativeMergedPages[page])) {
        return;
      }
      if (page === 1) {
        var liveCount = document.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').length;
        if (liveCount < 8) {
          return;
        }
      }
    }
    enhancer.fetchedNexusPages = enhancer.fetchedNexusPages || {};
    enhancer.fetchedNexusPages[page] = true;
  }

  function getNextNexusPageToFetch() {
    markCurrentNexusPageFetched();
    var page = 1;
    while (enhancer.fetchedNexusPages[page]) {
      page++;
    }
    return page;
  }

  function fixTileResourceUrls(tile, baseUrl) {
    if (!tile) {
      return;
    }
    tile.querySelectorAll('[href], [src]').forEach(function (node) {
      ['href', 'src'].forEach(function (attr) {
        var val = node.getAttribute(attr);
        if (!val || val.indexOf('http') === 0 || val.indexOf('data:') === 0) {
          return;
        }
        try {
          node.setAttribute(attr, new URL(val, baseUrl).toString());
        } catch (err) {
          // ignore bad urls
        }
      });
    });
  }

  function isGraphqlModNodeShape(node) {
    return !!(node && node.modId != null && node.name);
  }

  function findGraphqlModNodesInObject(obj, depth) {
    depth = depth || 0;
    if (!obj || depth > 14) {
      return [];
    }
    if (Array.isArray(obj)) {
      if (obj.length >= 4 && isGraphqlModNodeShape(obj[0])) {
        return obj;
      }
      var merged = [];
      for (var i = 0; i < obj.length; i++) {
        var inner = findGraphqlModNodesInObject(obj[i], depth + 1);
        if (inner.length > merged.length) {
          merged = inner;
        }
      }
      return merged;
    }
    if (typeof obj === 'object') {
      if (Array.isArray(obj.nodes) && obj.nodes.length >= 4 && isGraphqlModNodeShape(obj.nodes[0])) {
        return obj.nodes;
      }
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) {
        var found = findGraphqlModNodesInObject(obj[keys[k]], depth + 1);
        if (found.length >= 8) {
          return found;
        }
      }
    }
    return [];
  }

  function parseGraphqlModNodesFromNextHtml(html) {
    if (!html) {
      return [];
    }
    var match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!match || !match[1]) {
      return [];
    }
    try {
      return findGraphqlModNodesInObject(JSON.parse(match[1]));
    } catch (errNextData) {
      return [];
    }
  }

  function readNextDataRoot() {
    try {
      var nextData = document.getElementById('__NEXT_DATA__');
      if (!nextData || !nextData.textContent) {
        return null;
      }
      return JSON.parse(nextData.textContent);
    } catch (errNextRoot) {
      return null;
    }
  }

  function looksLikeModsListingVariables(obj) {
    if (!obj || typeof obj !== 'object') {
      return false;
    }
    if (obj.count == null && obj.offset == null) {
      return false;
    }
    if (!obj.filter && !obj.postFilter) {
      return false;
    }
    var filter = obj.filter || {};
    return !!(filter.gameDomainName || filter.downloads || filter.endorsements ||
      filter.fileSize || filter.name || filter.filter || obj.postFilter);
  }

  function findModsListingVariablesInObject(obj, depth, best) {
    depth = depth || 0;
    best = best || { score: 0, value: null };
    if (!obj || depth > 18) {
      return best;
    }
    if (looksLikeModsListingVariables(obj)) {
      var score = 1;
      if (obj.filter && obj.filter.downloads) {
        score += 4;
      }
      if (obj.postFilter && obj.postFilter.downloads) {
        score += 3;
      }
      if (obj.filter && obj.filter.gameDomainName) {
        score += 2;
      }
      if (obj.sort) {
        score += 1;
      }
      if (score >= best.score) {
        best.score = score;
        best.value = obj;
      }
    }
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        findModsListingVariablesInObject(obj[i], depth + 1, best);
      }
      return best;
    }
    if (typeof obj === 'object') {
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) {
        findModsListingVariablesInObject(obj[keys[k]], depth + 1, best);
      }
    }
    return best;
  }

  function cloneJson(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (errClone) {
      return null;
    }
  }

  function extractNexusPageModsListingVariables() {
    var root = readNextDataRoot();
    if (!root) {
      return null;
    }
    var found = findModsListingVariablesInObject(root, 0, { score: 0, value: null });
    return found && found.value ? cloneJson(found.value) : null;
  }

  function filteredBrowseNeedsNativeBatch(pageSize, catalogCount) {
    if (!urlHasActiveNexusFilters()) {
      return false;
    }
    if (filteredBrowseHasEnoughCatalog()) {
      return false;
    }
    if (!getNextUnfetchedNexusPage()) {
      return false;
    }
    var currentPage = enhancer.globalPageIndex || 0;
    if (currentPage < 2) {
      return false;
    }
    var neededForNextPage = (currentPage + 2) * pageSize;
    return catalogCount < neededForNextPage;
  }

  function filteredBrowseBatchCatalogThreshold() {
    return 81;
  }

  function filteredBrowseHasEnoughCatalog(config) {
    config = config || enhancer.config || {};
    if (getVisibleCarouselCatalogCount(config) >= filteredBrowseBatchCatalogThreshold()) {
      return true;
    }
    return !!(enhancer.tilePool && enhancer.tilePool.length >= filteredBrowseBatchCatalogThreshold());
  }

  function appendLiveGridClonesToPool(config) {
    var live = collectLiveGridCards(config);
    if (!live.length) {
      return 0;
    }
    var seen = {};
    for (var p = 0; p < enhancer.tilePool.length; p++) {
      if (enhancer.tilePool[p].modId) {
        seen[String(enhancer.tilePool[p].modId)] = true;
      }
    }
    var freshTiles = [];
    for (var i = 0; i < live.length; i++) {
      var modId = live[i].modId;
      if (!modId || seen[String(modId)]) {
        continue;
      }
      seen[String(modId)] = true;
      var clone = live[i].card.cloneNode(true);
      clone.setAttribute('data-vortex-pool-tile', 'true');
      freshTiles.push(clone);
    }
    if (!freshTiles.length) {
      return 0;
    }
    return appendFetchedTilesToPool(freshTiles, config);
  }

  function ensureFilteredBrowsePageOnePooled(config) {
    if (!browseUsesFilteredCatalogPaging()) {
      return Promise.resolve(false);
    }
    return ensureFilteredBrowseOnPageOne().then(function (onPageOne) {
      if (!onPageOne) {
        return false;
      }
      if (enhancer.filteredBrowsePageOnePooled) {
        return true;
      }
      var live = collectLiveGridCards(config);
      if (live.length < 4) {
        return live.length >= Math.min(12, getCarouselPageSize(config));
      }
      appendLiveGridClonesToPool(config);
      enhancer.filteredBrowsePageOnePooled = true;
      saveNativePoolSnapshot(config);
      return true;
    });
  }

  function finishFilteredBrowseHostBatch(ok) {
    var resolve = enhancer.filteredBrowseHostBatchResolver;
    if (enhancer.filteredBrowseHostBatchTimeoutId) {
      clearTimeout(enhancer.filteredBrowseHostBatchTimeoutId);
      enhancer.filteredBrowseHostBatchTimeoutId = null;
    }
    enhancer.filteredBrowseHostBatchResolver = null;
    enhancer.filteredBrowseHostBatchInFlight = false;
    enhancer.filteredBrowseHostBatchPhase = '';
    enhancer.filteredBrowseHostBatchReturnUrl = '';
    enhancer.pendingNativeCatalogFetch = false;
    enhancer.pendingPoolFetch = false;
    enhancer.nativeNavFetchInFlight = false;
    enhancer.nativeNavFetchTargetPage = null;
    enhancer.fetchInFlightPage = null;
    enhancer.dismissedBatchPrefetchInFlight = false;
    if (resolve) {
      resolve(!!ok);
    }
    if (window.__vortexBrowseEnhancer) {
      setTimeout(function () {
        if (window.__vortexBrowseEnhancer) {
          window.__vortexBrowseEnhancer.scheduleScan(true);
        }
      }, 0);
    }
  }

  function handleFilteredBrowseHostBatchScan(config) {
    if (!enhancer.filteredBrowseHostBatchInFlight) {
      return;
    }
    var pageNum = enhancer.nativeNavFetchTargetPage || 2;
    var urlPage = getNexusResultsPageFromUrl();
    var phase = enhancer.filteredBrowseHostBatchPhase;
    var minFreshTiles = 4;

    if (phase === 'forward') {
      var liveCards = collectLiveGridCards(config);
      if (liveCards.length < minFreshTiles && urlPage < pageNum) {
        if (enhancer.filteredBrowseHostBatchDeadline &&
            Date.now() > enhancer.filteredBrowseHostBatchDeadline) {
          finishFilteredBrowseHostBatch(false);
          navigateBrowseUrlViaHost(enhancer.filteredBrowseHostBatchReturnUrl || buildNexusResultsPageUrl(1));
        }
        return;
      }
      var added = mergeLiveGridIntoPool(config);
      if (added < minFreshTiles && urlPage < pageNum) {
        return;
      }
      markNativeMergedPage(pageNum);
      enhancer.fetchedNexusPages = enhancer.fetchedNexusPages || {};
      enhancer.fetchedNexusPages[pageNum] = true;
      enhancer.lastAppliedSliceKey = '';
      saveNativePoolSnapshot(config);
      enhancer.filteredBrowseHostBatchPhase = 'back';
      navigateBrowseUrlViaHost(enhancer.filteredBrowseHostBatchReturnUrl || buildNexusResultsPageUrl(1));
      return;
    }

    if (phase === 'back' && urlPage <= 1) {
      var liveOnReturn = collectLiveGridCards(config).length;
      if (liveOnReturn < minFreshTiles &&
          enhancer.filteredBrowseHostBatchDeadline &&
          Date.now() < enhancer.filteredBrowseHostBatchDeadline) {
        return;
      }
      finishFilteredBrowseHostBatch(filteredBrowseHasEnoughCatalog(config));
    }
  }

  function fetchFilteredBrowseBatchViaHostNav(pageNum, config) {
    if (pageNum !== 2 || !browseUsesFilteredCatalogPaging()) {
      return Promise.resolve(false);
    }
    if (enhancer.filteredBrowseHostBatchInFlight || enhancer.nativeNavFetchInFlight) {
      return Promise.resolve(false);
    }

    return ensureFilteredBrowsePageOnePooled(config).then(function (seeded) {
      if (!seeded) {
        return false;
      }

      saveNativePoolSnapshot(config);
      enhancer.filteredBrowseHostBatchInFlight = true;
      enhancer.filteredBrowseHostBatchPhase = 'forward';
      enhancer.filteredBrowseHostBatchReturnUrl = stripInternalBrowseParams(window.location.href);
      enhancer.filteredBrowseHostBatchDeadline = Date.now() + 35000;
      enhancer.pendingNativeCatalogFetch = true;
      enhancer.nativeNavFetchInFlight = true;
      enhancer.nativeNavFetchTargetPage = pageNum;
      enhancer.pendingPoolFetch = true;

      return new Promise(function (resolve) {
        enhancer.filteredBrowseHostBatchResolver = resolve;
        enhancer.filteredBrowseHostBatchTimeoutId = setTimeout(function () {
          if (enhancer.filteredBrowseHostBatchResolver) {
            finishFilteredBrowseHostBatch(false);
            navigateBrowseUrlViaHost(enhancer.filteredBrowseHostBatchReturnUrl || buildNexusResultsPageUrl(1));
          }
        }, 36000);

        if (!navigateBrowseUrlViaHost(buildNexusResultsPageUrl(pageNum))) {
          finishFilteredBrowseHostBatch(false);
        }
      });
    });
  }

  function clearStaleFilteredBatchFetchFlags() {
    if (!urlHasActiveNexusFilters() || filteredBrowseHasEnoughCatalog()) {
      return;
    }
    if (enhancer.fetchedNexusPages && enhancer.fetchedNexusPages[2]) {
      delete enhancer.fetchedNexusPages[2];
    }
    if (enhancer.nativeMergedPages && enhancer.nativeMergedPages[2]) {
      delete enhancer.nativeMergedPages[2];
    }
  }

  function hasFilteredBrowseBatchLoaded() {
    if (!isFilteredBrowseSession()) {
      return false;
    }
    return filteredBrowseHasEnoughCatalog();
  }

  function filteredBrowseUsesLiveCatalogOnly() {
    return isFilteredBrowseSession() && !hasFilteredBrowseBatchLoaded();
  }

  function resetFilteredCarouselCatalog() {
    enhancer.filteredCarouselCatalog = [];
    enhancer.filteredCarouselCatalogSessionKey = '';
  }

  function getFilteredCarouselCatalogSessionKey(config) {
    return getBrowseSessionKey() + '|' + getFilterCarouselConfigKey(config);
  }

  function mergeFilteredPoolIntoCarouselCatalog(config) {
    if (hasNumericNexusBrowseFilters() && filteredBrowseUsesLiveCatalogOnly()) {
      return 0;
    }
    if (!config || !isFilteredBrowseSession(config) || !enhancer.tilePool || !enhancer.tilePool.length) {
      return 0;
    }
    var sessionKey = getBrowseSessionKey();
    if (enhancer.filteredBrowsePoolSessionKey && enhancer.filteredBrowsePoolSessionKey !== sessionKey) {
      return 0;
    }
    return mergeIntoFilteredCarouselCatalog(enhancer.tilePool, config);
  }

  function mergeIntoFilteredCarouselCatalog(cards, config) {
    if (!config || !cards || !cards.length) {
      return 0;
    }
    if (!isFilteredBrowseSession(config) &&
        !config.filterBrowseActive &&
        !enhancer.domFilterBrowseActive &&
        !hasSidebarDownloadsFilterApplied()) {
      return 0;
    }
    var sessionKey = getFilteredCarouselCatalogSessionKey(config);
    if (enhancer.filteredCarouselCatalogSessionKey !== sessionKey) {
      enhancer.filteredCarouselCatalog = [];
      enhancer.filteredCarouselCatalogSessionKey = sessionKey;
    }
    applyFilters(cards, config);
    var visible = sortCatalogEntries(getVisibleCarouselCards(cards));
    var seen = {};
    var catalog = enhancer.filteredCarouselCatalog || [];
    for (var i = 0; i < catalog.length; i++) {
      if (catalog[i].modId) {
        seen[String(catalog[i].modId)] = true;
      }
    }
    var added = 0;
    for (var j = 0; j < visible.length; j++) {
      var entry = visible[j];
      if (!entry.modId || seen[String(entry.modId)]) {
        continue;
      }
      seen[String(entry.modId)] = true;
      catalog.push(entry);
      added++;
    }
    enhancer.filteredCarouselCatalog = catalog;
    return added;
  }

  function ensureFilteredCarouselCatalogFromLive(config) {
    if (!config) {
      return 0;
    }
    if (!isFilteredBrowseSession(config) &&
        !config.filterBrowseActive &&
        !enhancer.domFilterBrowseActive &&
        !hasSidebarDownloadsFilterApplied()) {
      return (enhancer.filteredCarouselCatalog || []).length;
    }
    var live = collectLiveGridCards(config);
    if (!live.length) {
      return (enhancer.filteredCarouselCatalog || []).length;
    }
    var sessionKey = getFilteredCarouselCatalogSessionKey(config);
    var catalog = enhancer.filteredCarouselCatalog || [];
    if (enhancer.filteredCarouselCatalogSessionKey !== sessionKey) {
      catalog = [];
      enhancer.filteredCarouselCatalog = catalog;
      enhancer.filteredCarouselCatalogSessionKey = sessionKey;
    }
    if (catalog.length < live.length) {
      mergeIntoFilteredCarouselCatalog(live, config);
    }
    return (enhancer.filteredCarouselCatalog || []).length;
  }

  function getFilteredCarouselVisibleEntries(config) {
    if (enhancer.resolvingFilteredCarouselVisibleEntries) {
      return enhancer.filteredCarouselCatalog || [];
    }
    enhancer.resolvingFilteredCarouselVisibleEntries = true;
    try {
      config = config || enhancer.config;
      if (hasNumericNexusBrowseFilters()) {
        return buildNumericFilteredLiveCatalog(config);
      }
      ensureFilteredCarouselCatalogFromLive(config);
      mergeIntoFilteredCarouselCatalog(collectLiveGridCards(config), config);
      mergeFilteredPoolIntoCarouselCatalog(config);
      if (!filteredBrowseUsesLiveCatalogOnly()) {
        mergeIntoFilteredCarouselCatalog(collectCards(config), config);
      }
      return enhancer.filteredCarouselCatalog || [];
    } finally {
      enhancer.resolvingFilteredCarouselVisibleEntries = false;
    }
  }

  function appendFilteredGraphqlBatchToCatalog(result, config, pageNum) {
    if (!result || !result.nodes || !result.nodes.length) {
      return false;
    }
    var nodes = filterFreshGraphqlNodes(result.nodes, config, { minFresh: 1, allowFallback: true });
    if (!nodes.length) {
      return false;
    }
    var tiles = [];
    for (var i = 0; i < nodes.length; i++) {
      tiles.push(buildGraphQLModTile(nodes[i]));
    }
    var cards = [];
    for (var t = 0; t < tiles.length; t++) {
      var modId = extractModIdFromTile(tiles[t]);
      cards.push({ card: tiles[t], modId: modId });
    }
    mergeIntoFilteredCarouselCatalog(cards, config);
    appendFetchedTilesToPool(tiles, config);
    enhancer.fetchedNexusPages = enhancer.fetchedNexusPages || {};
    enhancer.fetchedNexusPages[pageNum] = true;
    if (typeof result.totalCount === 'number' && result.totalCount > 0) {
      enhancer.nexusFilteredGraphqlTotal = result.totalCount;
      enhancer.nexusFilteredGraphqlTotalSessionKey = getBrowseSessionKey();
      lockNexusFilteredDisplayTotal(result.totalCount);
    }
    return cards.length > 0;
  }

  function fetchMoreFilteredCarouselMods(config, targetPage) {
    if (enhancer.clientSideNumericFilterActive) {
      return fetchMoreClientSideNumericCarouselMods(config, targetPage);
    }
    if (hasNumericNexusBrowseFilters()) {
      var numericNextPage = getNextUnfetchedNexusPage() || 2;
      return fetchFilteredBrowseBatchViaSoftNav(numericNextPage, config).then(function (ok) {
        if (ok) {
          mergeFilteredPoolIntoCarouselCatalog(config);
        }
        return !!ok;
      });
    }
    if (isUserInteractingWithNexusFilters() || enhancer.nexusFilterApplyInFlight) {
      return Promise.resolve(false);
    }
    var pageSize = getCarouselPageSize(config);
    var needCount = (targetPage + 1) * pageSize;
    var loadedCount = hasNumericNexusBrowseFilters()
      ? Math.max(
        (enhancer.filteredCarouselCatalog || []).length,
        document.querySelectorAll(
          'main [data-e2eid="mod-tile"]:not([data-vortex-pool-tile]), ' +
          '#mainContent [data-e2eid="mod-tile"]:not([data-vortex-pool-tile])'
        ).length
      )
      : getFilteredCarouselVisibleEntries(config).length;
    if (loadedCount >= needCount) {
      return Promise.resolve(true);
    }
    var nextNexusPage = getNextUnfetchedNexusPage() || 2;
    var offset = (nextNexusPage - 1) * 80;

    function finishFilteredFetch(ok) {
      if (ok) {
        mergeIntoFilteredCarouselCatalog(collectLiveGridCards(config), config);
        mergeFilteredPoolIntoCarouselCatalog(config);
      }
      return ok;
    }

    if (browseUsesFilteredCatalogPaging()) {
      return fetchFilteredBrowseBatchPage(
        nextNexusPage,
        config,
        offset,
        'soft',
        finishFilteredFetch,
        function (result) {
          return appendFilteredGraphqlBatchToCatalog(result, config, nextNexusPage);
        }
      );
    }

    return fetchFilteredBrowseBatchViaSoftNav(nextNexusPage, config).then(finishFilteredFetch);
  }

  function resetFilteredBrowseCatalogState() {
    enhancer.tilePool = [];
    enhancer.fetchedNexusPages = {};
    enhancer.nativeMergedPages = {};
    enhancer.catalogModIdToIndex = {};
    enhancer.catalogIndicesBootstrapped = false;
    enhancer.filteredBrowsePoolSessionKey = '';
    enhancer.filteredBrowseStableSessionKey = '';
    enhancer.filteredBrowsePageOnePooled = false;
    enhancer.filteredBrowseHostBatchInFlight = false;
    enhancer.filteredBrowseHostBatchPhase = '';
    enhancer.pendingNativeCatalogFetch = false;
    enhancer.nativeNavFetchInFlight = false;
    enhancer.pendingPoolFetch = false;
    enhancer.fetchInFlightPage = null;
    enhancer.carouselAdvancePending = false;
    enhancer.dismissedBatchPrefetchInFlight = false;
    enhancer.globalPageIndex = 0;
    enhancer.batchPageIndex = 0;
    enhancer.lastAppliedSliceKey = '';
    enhancer.nativePoolRestorePromise = null;
    enhancer.dismissedPoolRestorePromise = null;
    resetFilteredCarouselCatalog();
    unhideAllCarouselTiles();
    try {
      document.querySelectorAll(
        '#vortex-enhanced-pool-host [data-vortex-catalog-index], #vortex-enhanced-live-stash [data-vortex-catalog-index]'
      ).forEach(function (node) {
        node.removeAttribute('data-vortex-catalog-index');
      });
    } catch (errClearCatalogIdx) {
      // ignore
    }
    clearFilteredBrowsePoolSnapshot();
    try {
      sessionStorage.removeItem(getDismissedPoolStorageKey());
    } catch (errClearDismissedPool) {
      // ignore
    }
    saveCarouselPagingState();
  }

  function clearFilteredBrowsePoolSnapshot() {
    try {
      sessionStorage.removeItem(getNativePoolStorageKey());
    } catch (errClearPool) {
      // ignore
    }
  }

  function ensureFilteredBrowsePoolSeeded(config) {
    if (!browseUsesFilteredCatalogPaging()) {
      return;
    }
    var sessionKey = getBrowseSessionKey();
    if (enhancer.filteredBrowsePoolSessionKey === sessionKey) {
      return;
    }
    var liveCount = collectLiveGridCards(config).length;
    if (liveCount < 12) {
      return;
    }
    enhancer.filteredBrowsePoolSessionKey = sessionKey;
    enhancer.filteredBrowseStableSessionKey = '';
    enhancer.filteredBrowsePageOnePooled = false;
    clearFilteredBrowsePoolSnapshot();
    markCurrentNexusPageFetched();
  }

  function collectLiveModIdSet(config) {
    var ids = {};
    collectLiveGridCards(config).forEach(function (entry) {
      if (entry && entry.modId) {
        ids[String(entry.modId)] = true;
      }
    });
    return ids;
  }

  function buildFilteredBatchGraphqlVariables(offset, count, config) {
    var pageVars = extractNexusPageModsListingVariables();
    var ctx = loadNexusListingContext();
    var activeVars = buildModsListingVariables(offset, count || 80, ctx, config);
    var variables;
    if (pageVars) {
      variables = cloneJson(pageVars);
    } else {
      variables = activeVars;
    }
    variables.offset = offset;
    variables.count = count || 80;
    if (!variables.filter) {
      variables.filter = {};
    }
    if (!variables.postFilter) {
      variables.postFilter = {};
    }
    // __NEXT_DATA__ can still contain the previous listing variables while
    // Nexus is applying a sidebar change. Always overlay the current URL
    // constraints so prefetch/total requests cannot drop adult/category/tag
    // filters and replace the correct result set with the full catalog.
    variables.facets = activeVars.facets;
    [
      'adultContent',
      'gameDomainName',
      'hasUpdated',
      'supportsVortex',
      'name',
    ].forEach(function (key) {
      variables.filter[key] = activeVars.filter[key] || [];
    });
    variables.postFilter.tag = activeVars.postFilter.tag || [];
    if (activeVars.postFilter.categoryName) {
      variables.postFilter.categoryName = activeVars.postFilter.categoryName;
    } else {
      delete variables.postFilter.categoryName;
    }
    applyNexusUrlNumericFilters(variables.filter);
    applyActiveFilterChipNumericFilters(variables.filter);
    applyActiveFilterChipNumericFilters(variables.postFilter);
    applySidebarNumericFiltersToGraphql(variables.filter);
    return variables;
  }

  function applySidebarNumericFilterEntryToGraphql(filter, rowText, name, parsed) {
    if (!filter || !Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    var context = String(name || '') + ' ' + String(rowText || '');
    if (/download/i.test(rowText) || /download/i.test(name)) {
      if (/max|to|upper|less|lte|under|up to/i.test(context)) {
        pushGraphqlIntFilter(filter, 'downloads', 'LTE', parsed);
      } else if (/min|from|lower|greater|gte|over|at least/i.test(context)) {
        pushGraphqlIntFilter(filter, 'downloads', 'GTE', parsed);
      } else {
        pushGraphqlIntFilter(filter, 'downloads', 'LTE', parsed);
      }
    } else if (/endorse/i.test(rowText) || /endorse/i.test(name)) {
      if (/max|to|upper|less|lte|under|up to/i.test(context)) {
        pushGraphqlIntFilter(filter, 'endorsements', 'LTE', parsed);
      } else if (/min|from|lower|greater|gte|over|at least/i.test(context)) {
        pushGraphqlIntFilter(filter, 'endorsements', 'GTE', parsed);
      }
    } else if (/file\s*size|filesize|\bsize\b/i.test(rowText) || /file\s*size|filesize|\bsize\b/i.test(name)) {
      if (/max|to|upper|less|lte|under|up to/i.test(context)) {
        pushGraphqlIntFilter(filter, 'fileSize', 'LTE', parsed);
      } else if (/min|from|lower|greater|gte|over|at least/i.test(context)) {
        pushGraphqlIntFilter(filter, 'fileSize', 'GTE', parsed);
      }
    }
  }

  function applySidebarNumericFiltersToGraphql(filter) {
    if (!filter) {
      return;
    }
    var appliedFromPanel = false;
    var panel = document.getElementById('filters-panel') || findNexusFilterAside();
    if (panel) {
      var inputs = panel.querySelectorAll('input');
      for (var i = 0; i < inputs.length; i++) {
        var input = inputs[i];
        if (!input || input.type === 'checkbox' || input.type === 'radio' || input.type === 'hidden') {
          continue;
        }
        var row = input.closest('section, fieldset, label, div');
        var rowText = normalizeUiText(row && row.textContent || '').slice(0, 160);
        var name = normalizeUiText(
          input.getAttribute('name') ||
          input.getAttribute('aria-label') ||
          input.getAttribute('placeholder') ||
          ''
        );
        var raw = normalizeUiText(input.value || '').replace(/,/g, '');
        if (!raw) {
          continue;
        }
        var parsed = parseInt(raw, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          continue;
        }
        appliedFromPanel = true;
        applySidebarNumericFilterEntryToGraphql(filter, rowText, name, parsed);
      }
    }
    if (appliedFromPanel) {
      return;
    }
    var stashed = enhancer.stashedSidebarNumericFilters || [];
    for (var s = 0; s < stashed.length; s++) {
      var entry = stashed[s];
      if (!entry || !entry.value) {
        continue;
      }
      applySidebarNumericFilterEntryToGraphql(
        filter,
        entry.rowText || '',
        entry.name || '',
        entry.value
      );
    }
  }

  function fetchFilteredBrowseResultsTotal(config) {
    config = config || enhancer.config || {};
    if (!hasNumericNexusBrowseFilters()) {
      return Promise.resolve(0);
    }
    var sessionKey = getBrowseSessionKey();
    if (enhancer.nexusFilteredGraphqlTotalSessionKey === sessionKey &&
        enhancer.nexusFilteredGraphqlTotal > 0) {
      lockNexusFilteredDisplayTotal(enhancer.nexusFilteredGraphqlTotal);
      return Promise.resolve(enhancer.nexusFilteredGraphqlTotal);
    }
    if (enhancer.filteredBrowseTotalFetchInFlight) {
      return Promise.resolve(getGraphqlFilteredBrowseResultsTotal());
    }
    enhancer.filteredBrowseTotalFetchInFlight = true;
    var variables = buildFilteredBatchGraphqlVariables(0, 1, config);
    return runModsListingGraphql(variables).then(function (result) {
      enhancer.filteredBrowseTotalFetchInFlight = false;
      if (result && result.totalCount > 0) {
        var domTotals = scanNexusResultsTotalsFromDom();
        var finalTotal = reconcileNumericFilteredResultsTotal(result.totalCount, domTotals);
        if (finalTotal <= 0) {
          return 0;
        }
        enhancer.nexusFilteredGraphqlTotal = finalTotal;
        enhancer.nexusFilteredGraphqlTotalSessionKey = sessionKey;
        mergeNexusFilteredResultsTotal(finalTotal);
        lockNumericFilteredResultsTotal(finalTotal, domTotals);
        logToHost('filtered browse graphql total', {
          total: finalTotal,
          graphqlTotal: result.totalCount,
          domResults: domTotals.resultsTotal || 0,
          domMatching: domTotals.matchingTotal || 0,
          sessionKey: sessionKey,
        });
        publishNumericFilteredResultsTotal(finalTotal);
        return finalTotal;
      }
      return 0;
    }).catch(function () {
      enhancer.filteredBrowseTotalFetchInFlight = false;
      return 0;
    });
  }

  function scheduleFilteredBrowseTotalFetch(config) {
    config = config || enhancer.config || null;
    if (!hasNumericNexusBrowseFilters()) {
      return;
    }
    if (getGraphqlFilteredBrowseResultsTotal() > 0) {
      return;
    }
    if (enhancer.filteredBrowseTotalFetchTimer) {
      clearTimeout(enhancer.filteredBrowseTotalFetchTimer);
    }
    enhancer.filteredBrowseTotalFetchTimer = setTimeout(function () {
      enhancer.filteredBrowseTotalFetchTimer = null;
      fetchFilteredBrowseResultsTotal(config);
    }, 150);
  }

  function filterFreshGraphqlNodes(nodes, config, options) {
    options = options || {};
    var minFresh = typeof options.minFresh === 'number' ? options.minFresh : 8;
    if (!nodes || !nodes.length) {
      return [];
    }
    var liveIds = collectLiveModIdSet(config);
    var fresh = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node && node.modId != null && !liveIds[String(node.modId)]) {
        fresh.push(node);
      }
    }
    if (fresh.length >= minFresh) {
      return fresh;
    }
    return options.allowFallback === false ? fresh : nodes;
  }

  function filterFreshTileElements(tiles, config, options) {
    options = options || {};
    var minFresh = typeof options.minFresh === 'number' ? options.minFresh : 8;
    if (!tiles || !tiles.length) {
      return [];
    }
    var liveIds = collectLiveModIdSet(config);
    var fresh = [];
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      var modId = extractModIdFromTile(tile);
      if (modId && !liveIds[String(modId)]) {
        fresh.push(tile);
      }
    }
    if (fresh.length >= minFresh) {
      return fresh;
    }
    return options.allowFallback === false ? fresh : tiles;
  }

  function shouldUseFilteredBrowseLightScan(config) {
    if (!config || !isFilteredBrowseSession(config)) {
      return false;
    }
    if (shouldUseNumericFilteredBrowseScan(config)) {
      return false;
    }
    return true;
  }

  function scheduleNumericFilteredHeadlineSync() {
    return;
  }

  function refreshClientSideNumericCatalogRefs(config) {
    config = config || enhancer.config || { installed: {}, tracked: {} };
    if (!config.installed) {
      config.installed = {};
    }
    if (!config.tracked) {
      config.tracked = {};
    }
    var catalog = enhancer.filteredCarouselCatalog || [];
    if (!catalog.length) {
      return catalog;
    }
    var grid = resolveNexusModGridElement() || findModGrid();
    var byModId = {};
    if (grid) {
      grid.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').forEach(function (tile) {
        var modId = extractModIdFromTile(tile);
        if (modId) {
          byModId[String(modId)] = tile;
        }
      });
    }
    var refreshed = [];
    for (var i = 0; i < catalog.length; i++) {
      var entry = catalog[i];
      if (!entry) {
        continue;
      }
      var modId = entry.modId;
      var card = (modId && byModId[String(modId)]) ? byModId[String(modId)] : entry.card;
      if (!card || !document.body.contains(card)) {
        continue;
      }
      refreshed.push({
        card: card,
        modId: modId,
        installed: modId ? (config.installed[String(modId)] || null) : null,
        tracked: !!(modId && config.tracked && config.tracked[String(modId)]),
      });
    }
    if (refreshed.length) {
      enhancer.filteredCarouselCatalog = refreshed;
      enhancer.filteredCarouselCatalogSessionKey = getFilteredCarouselCatalogSessionKey(config);
    }
    return refreshed.length ? refreshed : catalog;
  }

  function getMinimalNumericBrowseCatalog(config) {
    if (enhancer.clientSideNumericFilterActive) {
      return refreshClientSideNumericCatalogRefs(config);
    }
    return collectMinimalNumericBrowseTiles(config);
  }

  function collectMinimalNumericBrowseTiles(config) {
    config = config || enhancer.config || { installed: {}, tracked: {} };
    if (!config.installed) {
      config.installed = {};
    }
    if (!config.tracked) {
      config.tracked = {};
    }
    if (enhancer.clientSideNumericFilterActive) {
      return refreshClientSideNumericCatalogRefs(config);
    }
    var tiles = document.querySelectorAll(
      'main [data-e2eid="mod-tile"]:not([data-vortex-pool-tile]), ' +
      '#mainContent [data-e2eid="mod-tile"]:not([data-vortex-pool-tile])'
    );
    var catalog = [];
    var seen = {};
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      if (tile.closest('.vortex-enhanced-carousel-controls, [data-vortex-enhanced-filters="true"]')) {
        continue;
      }
      var modId = extractModIdFromTile(tile);
      var dedupeKey = modId ? String(modId) : ('tile-' + i);
      if (seen[dedupeKey]) {
        continue;
      }
      seen[dedupeKey] = true;
      catalog.push({
        card: tile,
        modId: modId,
        installed: modId ? (config.installed[String(modId)] || null) : null,
        tracked: !!(modId && config.tracked && config.tracked[String(modId)]),
      });
    }
    enhancer.filteredCarouselCatalog = catalog;
    enhancer.filteredCarouselCatalogSessionKey = getFilteredCarouselCatalogSessionKey(config);
    return catalog;
  }

  function ensureMinimalCarouselControlsQuick(config) {
    var controls = ensureCarouselControls();
    if (!controlsAreVisible(controls)) {
      if (enhancer.controlsPinnedSortRow && document.body.contains(enhancer.controlsPinnedSortRow)) {
        try {
          mountCarouselControlsInSortRow(enhancer.controlsPinnedSortRow);
        } catch (errPinnedQuick) {
          mountControlsFallback(controls);
        }
      } else {
        mountControlsFallback(controls);
      }
    }
    return controls;
  }

  function ensureMinimalNumericCarouselLayout(config, options) {
    options = options || {};
    var grid = enhancer.nexusModGridRef;
    if (!grid || !document.body.contains(grid)) {
      var catalog = enhancer.filteredCarouselCatalog || [];
      if (catalog.length && catalog[0].card && catalog[0].card.parentElement) {
        grid = catalog[0].card.parentElement;
      }
    }
    if (!grid) {
      grid = document.querySelector('.vortex-enhanced-nexus-grid, .mods-grid');
    }
    if (!grid) {
      return false;
    }
    document.documentElement.classList.add('vortex-enhanced-browse-wide', 'vortex-enhanced-filtered-browse');
    grid.classList.add('vortex-enhanced-nexus-grid', 'vortex-enhanced-grid-layout');
    applyGridLayoutStyles(grid, config);
    enhancer.nexusModGridRef = grid;
    var host = grid.parentElement;
    if (host && !host.classList.contains('vortex-enhanced-carousel-host')) {
      host.classList.add('vortex-enhanced-carousel-host');
    }
    if (options.mountControls !== false) {
      try {
        ensureMinimalCarouselControlsQuick(config);
      } catch (errMinimalControls) {
        // ignore
      }
    }
    installCarouselWheelHandler();
    return true;
  }

  function updateMinimalCarouselControlsInline(config, catalog, displayTotal) {
    config = config || enhancer.config || {};
    catalog = catalog || enhancer.filteredCarouselCatalog || [];
    var controls = ensureMinimalCarouselControlsQuick(config);
    if (!controls) {
      return;
    }
    var pageSize = getCarouselPageSize(config);
    var currentPage = Math.max(0, enhancer.globalPageIndex || 0);
    var loaded = catalog.length;
    var lockedTotal = getLockedNexusFilteredDisplayTotal();
    var hasLockedTotal = lockedTotal > 0 || displayTotal > 0;
    var total = displayTotal > 0
      ? displayTotal
      : (lockedTotal > 0 ? lockedTotal : loaded);
    var catalogPages = hasLockedTotal
      ? Math.max(1, Math.ceil(total / pageSize))
      : Math.max(1, Math.ceil(loaded / pageSize));
    var pageDisplay = controls.querySelector('[data-carousel-page]');
    var countDisplay = controls.querySelector('[data-carousel-count]');
    if (pageDisplay) {
      if (hasLockedTotal) {
        pageDisplay.textContent = 'Page ' + (currentPage + 1) + ' of ' + catalogPages;
      } else {
        pageDisplay.textContent = 'Page ' + (currentPage + 1);
      }
    }
    if (countDisplay) {
      var start = loaded > 0 ? (currentPage * pageSize + 1) : 0;
      var end = loaded > 0 ? Math.min(start + pageSize - 1, loaded) : 0;
      countDisplay.textContent = loaded > 0
        ? (hasLockedTotal
          ? ('Showing ' + start + '\u2013' + end + ' of ' + total + ' results \u00b7 ' + pageSize + ' per page')
          : ('Showing ' + start + '\u2013' + end + ' \u00b7 ' + pageSize + ' per page'))
        : ('Loading filtered results \u00b7 ' + pageSize + ' per page');
    }
    var prevBtn = controls.querySelector('[data-carousel="-1"]');
    var nextBtn = controls.querySelector('[data-carousel="1"]');
    if (prevBtn) {
      prevBtn.disabled = currentPage <= 0;
    }
    if (nextBtn) {
      var nextStart = (currentPage + 1) * pageSize;
      var hasLocalNext = nextStart < loaded;
      var hasMorePages = (currentPage + 1) < catalogPages;
      nextBtn.disabled = !hasLocalNext && !hasMorePages;
      if (!hasLocalNext && loaded >= pageSize) {
        nextBtn.disabled = false;
      }
    }
  }

  function applyMinimalNumericFilteredPage(config, catalog, options) {
    options = options || {};
    catalog = catalog || getMinimalNumericBrowseCatalog(config);
    if (!catalog.length) {
      updateMinimalCarouselControlsInline(config, catalog, 0);
      return 0;
    }
    var pageSize = getCarouselPageSize(config);
    var currentPage = Math.max(0, enhancer.globalPageIndex || 0);
    var sliceKey = String(currentPage) + ':' + catalog.length + ':' + pageSize;
    if (!options.forcePageApply && enhancer.lastMinimalAppliedSliceKey === sliceKey) {
      var lockedOnly = getLockedNexusFilteredDisplayTotal();
      updateMinimalCarouselControlsInline(config, catalog, lockedOnly > 0 ? lockedOnly : catalog.length);
      return Math.min(pageSize, Math.max(0, catalog.length - currentPage * pageSize));
    }
    var start = currentPage * pageSize;
    var pageSlice = catalog.slice(start, start + pageSize);
    var showIds = {};
    for (var s = 0; s < pageSlice.length; s++) {
      if (pageSlice[s].modId) {
        showIds[String(pageSlice[s].modId)] = true;
      }
    }
    var grid = resolveNexusModGridElement() || findModGrid();
    var matchedVisible = 0;
    var tiles = [];
    if (grid) {
      tiles = queryLiveGridModTiles(grid, { minDirect: 0 });
    }
    if (hasNumericNexusBrowseFilters() && enhancer.tilePool && enhancer.tilePool.length) {
      for (var poolTileIndex = 0; poolTileIndex < enhancer.tilePool.length; poolTileIndex++) {
        var poolEntry = enhancer.tilePool[poolTileIndex];
        var poolCard = poolEntry && poolEntry.card ? poolEntry.card : poolEntry;
        if (poolCard && poolCard.nodeType && tiles.indexOf(poolCard) < 0) {
          tiles.push(poolCard);
        }
      }
    }
    if (tiles.length < pageSlice.length) {
      tiles = Array.prototype.slice.call(document.querySelectorAll(
        'main [data-e2eid="mod-tile"], ' +
        '#mainContent [data-e2eid="mod-tile"], ' +
        '#vortex-enhanced-live-stash [data-e2eid="mod-tile"]'
      ));
    }
    tiles.forEach(function (tile) {
      if (tile.closest('.vortex-enhanced-carousel-controls, [data-vortex-enhanced-filters="true"]')) {
        return;
      }
      var tileModId = extractModIdFromTile(tile);
      var showTile = !!(tileModId && showIds[String(tileModId)]);
      if (showTile) {
        tile.classList.remove(
          'vortex-enhanced-carousel-hidden',
          'vortex-enhanced-nexus-live-hidden',
          'vortex-enhanced-hidden'
        );
        tile.style.removeProperty('display');
        if (grid && tile.parentElement !== grid) {
          grid.appendChild(tile);
        }
        matchedVisible++;
        if (config && tileModId) {
          try {
            decorateCard(
              tile,
              tileModId,
              config.installed[String(tileModId)] || null,
              config
            );
          } catch (errDecorateMinimalTile) {
            // Ignore one card's decoration failure.
          }
        }
      } else {
        tile.classList.add('vortex-enhanced-carousel-hidden');
        tile.style.setProperty('display', 'none', 'important');
      }
    });
    traceStep('minimal-apply-slice', {
      page: currentPage + 1,
      slice: pageSlice.length,
      visible: matchedVisible,
      catalog: catalog.length,
    });
    var displayTotal = getLockedNexusFilteredDisplayTotal();
    updateMinimalCarouselControlsInline(config, catalog, displayTotal);
    if (enhancer.clientSideNumericFilterActive &&
        !enhancer.clientSideNumericFetchInFlight &&
        currentPage >= 1 &&
        catalog.length < (currentPage + 2) * pageSize) {
      // Warm the next carousel page while the current page is visible.
      setTimeout(function () {
        if (!enhancer.clientSideNumericFilterActive ||
            enhancer.clientSideNumericFetchInFlight) {
          return;
        }
        fetchMoreClientSideNumericCarouselMods(config, currentPage + 1).then(function (ok) {
          if (ok && window.__vortexBrowseEnhancer) {
            window.__vortexBrowseEnhancer.scheduleScan(true);
          }
        });
      }, 0);
    }
    enhancer.lastMinimalAppliedSliceKey = sliceKey;
    installCarouselWheelHandler();
    return pageSlice.length;
  }

  function shouldUseClientSideNumericFilterApply() {
    stashSidebarNumericFilters();
    if (enhancer.stashedSidebarNumericFilters && enhancer.stashedSidebarNumericFilters.length) {
      return true;
    }
    if (hasSidebarDownloadsFilterApplied()) {
      return true;
    }
    if (hasNonDefaultNexusFilterChip()) {
      return /download|endorse|file size|filesize/i.test(
        document.body && document.body.textContent || ''
      );
    }
    return hasVisibleNexusFilterChipText() &&
      /max downloads|min downloads|max endorsements|min endorsements/i.test(
        document.body && document.body.textContent || ''
      );
  }

  function maybeScheduleClientSideNumericFilterApply(config) {
    config = config || enhancer.config;
    if (!config || !shouldAttemptClientSideNumericFilter()) {
      return false;
    }
    if (enhancer.clientSideNumericFilterRetryTimer) {
      clearTimeout(enhancer.clientSideNumericFilterRetryTimer);
    }
    enhancer.clientSideNumericFilterRetryTimer = setTimeout(function () {
      enhancer.clientSideNumericFilterRetryTimer = null;
      if (enhancer.clientSideNumericFilterActive || enhancer.clientSideNumericFilterApplyInFlight) {
        return;
      }
      traceStep('client-side-numeric-filter-scheduled', {
        stashed: (enhancer.stashedSidebarNumericFilters || []).length,
      });
      applySidebarNumericFiltersViaGraphql(config);
    }, 150);
    return false;
  }

  function captureSidebarNumericFilters() {
    var captured = [];
    var panel = document.getElementById('filters-panel') || findNexusFilterAside();
    if (!panel) {
      return captured;
    }
    var inputs = panel.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      if (!input || input.type === 'checkbox' || input.type === 'radio' || input.type === 'hidden') {
        continue;
      }
      var raw = normalizeUiText(input.value || '').replace(/,/g, '');
      if (!raw) {
        continue;
      }
      var parsed = parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        continue;
      }
      var row = input.closest('section, fieldset, label, div');
      var rowText = normalizeUiText(row && row.textContent || '').slice(0, 160);
      var name = normalizeUiText(
        input.getAttribute('name') ||
        input.getAttribute('aria-label') ||
        input.getAttribute('placeholder') ||
        ''
      );
      captured.push({
        rowText: rowText,
        name: name,
        value: parsed,
      });
    }
    return captured;
  }

  function captureNumericFiltersFromDomChips() {
    var captured = [];
    var seen = {};
    function pushEntry(rowText, name, value) {
      if (!Number.isFinite(value) || value <= 0) {
        return;
      }
      var key = String(name) + ':' + String(value);
      if (seen[key]) {
        return;
      }
      seen[key] = true;
      captured.push({
        rowText: rowText,
        name: name,
        value: value,
      });
    }
    forEachActiveNexusFilterChip(function (chip) {
      var text = normalizeUiText(chip.textContent || '');
      var aria = normalizeUiText(chip.getAttribute && chip.getAttribute('aria-label') || '');
      [text, aria].forEach(function (label) {
        if (!label) {
          return;
        }
        var maxDl = label.match(/max(?:imum)?\s+downloads?\s*[:]\s*([\d][\d,]*)/i);
        if (maxDl) {
          pushEntry(label.slice(0, 160), 'max downloads', parseInt(maxDl[1].replace(/,/g, ''), 10));
        }
        var minDl = label.match(/min(?:imum)?\s+downloads?\s*[:]\s*([\d][\d,]*)/i);
        if (minDl) {
          pushEntry(label.slice(0, 160), 'min downloads', parseInt(minDl[1].replace(/,/g, ''), 10));
        }
      });
    });
    var rows = document.querySelectorAll(
      '[class*="ActiveFilter"], [class*="AppliedFilter"], [class*="ResultsHeader"]'
    );
    for (var i = 0; i < rows.length; i++) {
      var rowText = normalizeUiText(rows[i].textContent || '');
      var maxRow = rowText.match(/max downloads:\s*([\d,]+)/i);
      if (maxRow) {
        pushEntry(rowText.slice(0, 160), 'max downloads', parseInt(maxRow[1].replace(/,/g, ''), 10));
      }
      var minRow = rowText.match(/min downloads:\s*([\d,]+)/i);
      if (minRow) {
        pushEntry(rowText.slice(0, 160), 'min downloads', parseInt(minRow[1].replace(/,/g, ''), 10));
      }
    }
    return captured;
  }

  function stashSidebarNumericFilters() {
    var captured = captureSidebarNumericFilters();
    if (!captured.length) {
      captured = captureNumericFiltersFromDomChips();
    }
    if (captured.length) {
      enhancer.stashedSidebarNumericFilters = captured;
    }
    return captured;
  }

  function getClientSideNumericFilterAttemptKey() {
    var stashed = enhancer.stashedSidebarNumericFilters || [];
    var chipKey = hasVisibleNexusFilterChipText() ? 'chip' : '';
    return getBrowseSessionKey() + '|' + chipKey + '|' + stashed.map(function (entry) {
      return String(entry.name || '') + ':' + String(entry.value || '');
    }).join(';');
  }

  function markClientSideNumericFilterSkipped(reason) {
    enhancer.clientSideNumericFilterSkipKey = getClientSideNumericFilterAttemptKey();
    traceStep('client-side-numeric-filter-skipped', {
      reason: reason || '',
      key: enhancer.clientSideNumericFilterSkipKey,
    });
  }

  function shouldAttemptClientSideNumericFilter() {
    if (enhancer.clientSideNumericFilterActive || enhancer.clientSideNumericFilterApplyInFlight) {
      return false;
    }
    if (enhancer.clientSideNumericFilterSkipKey &&
        enhancer.clientSideNumericFilterSkipKey === getClientSideNumericFilterAttemptKey()) {
      return false;
    }
    return shouldUseClientSideNumericFilterApply();
  }

  function applySidebarNumericFiltersViaGraphql(config) {
    config = config || enhancer.config;
    if (!config || !shouldAttemptClientSideNumericFilter()) {
      return Promise.resolve(false);
    }
    if (enhancer.clientSideNumericFilterApplyInFlight) {
      return Promise.resolve(false);
    }
    enhancer.clientSideNumericFilterApplyInFlight = true;
    traceStep('client-side-numeric-filter-start', {
      stashed: (enhancer.stashedSidebarNumericFilters || []).length,
    });
    return fetchFilteredBrowseResultsTotal(config).then(function () {
      var variables = buildFilteredBatchGraphqlVariables(0, 80, config);
      traceStep('client-side-numeric-filter-query', {
        offset: variables.offset || 0,
        count: variables.count || 0,
        hasFilter: !!(variables.filter && Object.keys(variables.filter).length),
      });
      return runModsListingGraphql(variables);
    }).then(function (result) {
      if (!result || !result.nodes || !result.nodes.length) {
        traceStep('client-side-numeric-filter-empty', {
          total: result && result.totalCount ? result.totalCount : 0,
        });
        markClientSideNumericFilterSkipped('empty-result');
        var nativeCatalog = collectMinimalNumericBrowseTiles(config);
        if (nativeCatalog.length) {
          // Keep the native first page visible, but allow later batches to
          // use the client-side listing API instead of navigating Nexus.
          enhancer.clientSideNumericFilterActive = true;
          enhancer.filteredCarouselCatalog = nativeCatalog;
          enhancer.filteredCarouselCatalogSessionKey = getFilteredCarouselCatalogSessionKey(config);
          enhancer.filteredBrowseEngaged = true;
          enhancer.domFilterBrowseActive = true;
          syncFilteredBrowseDocumentState();
          ensureMinimalNumericCarouselLayout(config, { mountControls: true });
          applyMinimalNumericFilteredPage(config, nativeCatalog, { forcePageApply: true });
        }
        return false;
      }
      enhancer.nexusFilterApplyInFlight = true;
      enhancer.filteredBrowseEngaged = true;
      enhancer.domFilterBrowseActive = true;
      syncFilteredBrowseDocumentState();
      enhancer.globalPageIndex = 0;
      enhancer.batchPageIndex = 0;
      enhancer.lastAppliedSliceKey = '';
      enhancer.lastMinimalAppliedSliceKey = '';
      enhancer.carouselPagingQuietUntil = Date.now() + 3000;
      resetFilteredBrowseTotalsState();
      var grid = resolveNexusModGridElement() || findModGrid();
      if (!grid) {
        return false;
      }
      var poolHost = document.getElementById('vortex-enhanced-pool-host');
      var stash = ensureLiveStashHost();
      grid.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').forEach(function (tile) {
        setCarouselTileVisibility(tile, false, grid, poolHost, stash);
      });
      var catalog = [];
      var nodes = filterFreshGraphqlNodes(result.nodes, config, { minFresh: 1, allowFallback: true });
      for (var n = 0; n < nodes.length; n++) {
        var tile = buildGraphQLModTile(nodes[n]);
        tile.removeAttribute('data-vortex-pool-tile');
        tile.removeAttribute(MARK);
        grid.appendChild(tile);
        var modId = extractModIdFromTile(tile);
        catalog.push({
          card: tile,
          modId: modId,
          installed: modId ? (config.installed[String(modId)] || null) : null,
          tracked: !!(modId && config.tracked && config.tracked[String(modId)]),
        });
      }
      enhancer.filteredCarouselCatalog = catalog;
      enhancer.filteredCarouselCatalogSessionKey = getFilteredCarouselCatalogSessionKey(config);
      if (typeof result.totalCount === 'number' && result.totalCount > 0) {
        enhancer.nexusFilteredGraphqlTotal = result.totalCount;
        enhancer.nexusFilteredGraphqlTotalSessionKey = getBrowseSessionKey();
        lockNexusFilteredDisplayTotal(result.totalCount);
      }
      ensureMinimalNumericCarouselLayout(config, { mountControls: true });
      applyMinimalNumericFilteredPage(config, catalog, { forcePageApply: true });
      for (var dc = 0; dc < catalog.length; dc++) {
        try {
          decorateCard(catalog[dc].card, catalog[dc].modId, catalog[dc].installed, config);
        } catch (errDecorateClientTile) {
          // ignore single tile decorate failures
        }
      }
      try {
        decorateVisibleGridTiles(config, { forceAll: true });
      } catch (errDecorateClientGrid) {
        // ignore
      }
      enhancer.clientSideNumericFilterActive = true;
      enhancer.globalPageIndex = 0;
      enhancer.batchPageIndex = 0;
      installCarouselWheelHandler();
      syncAutoAdvance();
      try {
        ensureCarouselControlsBar();
        protectBrowseControlsFromChromeHide();
      } catch (errClientControls) {
        // ignore
      }
      traceStep('client-side-numeric-filter-done', {
        tiles: catalog.length,
        total: result.totalCount || 0,
      });
      logToHost('client-side numeric filter apply ok', {
        tiles: catalog.length,
        total: result.totalCount || 0,
      });
      return true;
    }).catch(function (errClientFilter) {
      markClientSideNumericFilterSkipped('error');
      logErrorToHost('client-side numeric filter apply failed', {
        error: String(errClientFilter && errClientFilter.message || errClientFilter),
      });
      var fallbackCatalog = collectMinimalNumericBrowseTiles(config);
      if (fallbackCatalog.length) {
        enhancer.clientSideNumericFilterActive = true;
        enhancer.filteredCarouselCatalog = fallbackCatalog;
        enhancer.filteredCarouselCatalogSessionKey = getFilteredCarouselCatalogSessionKey(config);
        ensureMinimalNumericCarouselLayout(config, { mountControls: true });
        applyMinimalNumericFilteredPage(config, fallbackCatalog, { forcePageApply: true });
      }
      return false;
    }).finally(function () {
      enhancer.clientSideNumericFilterApplyInFlight = false;
      enhancer.nexusFilterApplyInFlight = false;
      enhancer.nexusFilterApplyStartUrl = '';
      enhancer.pendingNexusFilterUrl = '';
    });
  }

  function fetchMoreClientSideNumericCarouselMods(config, targetPage) {
    config = config || enhancer.config;
    if (!config || !enhancer.clientSideNumericFilterActive) {
      return Promise.resolve(false);
    }
    if (enhancer.clientSideNumericFetchInFlight) {
      return Promise.resolve(false);
    }
    var pageSize = getCarouselPageSize(config);
    var catalog = refreshClientSideNumericCatalogRefs(config);
    var needCount = (targetPage + 1) * pageSize;
    if (catalog.length >= needCount) {
      return Promise.resolve(true);
    }
    enhancer.clientSideNumericFetchInFlight = true;
    var offset = catalog.length;
    traceStep('client-side-numeric-fetch-more', {
      offset: offset,
      targetPage: targetPage + 1,
      catalog: catalog.length,
    });
    var pageStateVariables = extractNexusPageModsListingVariables();
    var variables = pageStateVariables || buildFilteredBatchGraphqlVariables(offset, 80, config);
    if (hasNumericNexusBrowseFilters()) {
      variables = cloneJson(variables);
      ['downloads', 'endorsements', 'fileSize'].forEach(function (numericField) {
        if (variables.filter) {
          delete variables.filter[numericField];
        }
        if (variables.postFilter) {
          delete variables.postFilter[numericField];
        }
      });
    }
    variables.offset = offset;
    variables.count = 80;
    return runModsListingGraphql(variables).then(function (result) {
      if (!result || !result.nodes || !result.nodes.length) {
        traceStep('client-side-numeric-fetch-more-graphql-empty', { offset: offset });
        return runModsListingGraphql(variables).then(function (pageStateResult) {
          if (!pageStateResult || !pageStateResult.nodes || !pageStateResult.nodes.length) {
            var nativePage = Math.floor(offset / 80) + 2;
            if (enhancer.fetchedNexusPages) {
              delete enhancer.fetchedNexusPages[nativePage];
            }
            if (enhancer.nativeMergedPages) {
              delete enhancer.nativeMergedPages[nativePage];
            }
            return fetchNativeNexusResultsPage(nativePage, config, {
              allowNavigation: false,
              ignoreNumericFilters: true,
            }).then(function (nativeOk) {
              if (!nativeOk) {
                traceStep('client-side-numeric-fetch-more-empty', { offset: offset });
                return false;
              }
              var refreshedNativeCatalog = collectMinimalNumericBrowseTiles(config);
              return refreshedNativeCatalog.length > offset;
            });
          }
          return pageStateResult;
        });
      }
      return result;
    }).then(function (result) {
      if (!result || !result.nodes || !result.nodes.length) {
        return false;
      }
      var grid = resolveNexusModGridElement() || findModGrid();
      if (!grid) {
        return false;
      }
      var nodes = filterFreshGraphqlNodes(result.nodes, config, { minFresh: 1, allowFallback: true });
      var existingIds = {};
      for (var c = 0; c < catalog.length; c++) {
        if (catalog[c].modId) {
          existingIds[String(catalog[c].modId)] = true;
        }
      }
      for (var n = 0; n < nodes.length; n++) {
        var node = nodes[n];
        var nodeModId = node && (node.modId || node.id);
        if (nodeModId && existingIds[String(nodeModId)]) {
          continue;
        }
        var tile = buildGraphQLModTile(node);
        tile.removeAttribute('data-vortex-pool-tile');
        tile.removeAttribute(MARK);
        grid.appendChild(tile);
        var extractedId = extractModIdFromTile(tile);
        catalog.push({
          card: tile,
          modId: extractedId,
          installed: extractedId ? (config.installed[String(extractedId)] || null) : null,
          tracked: !!(extractedId && config.tracked && config.tracked[String(extractedId)]),
        });
        if (extractedId) {
          existingIds[String(extractedId)] = true;
        }
      }
      enhancer.filteredCarouselCatalog = catalog;
      enhancer.filteredCarouselCatalogSessionKey = getFilteredCarouselCatalogSessionKey(config);
      if (typeof result.totalCount === 'number' && result.totalCount > 0) {
        enhancer.nexusFilteredGraphqlTotal = result.totalCount;
        enhancer.nexusFilteredGraphqlTotalSessionKey = getBrowseSessionKey();
        lockNexusFilteredDisplayTotal(result.totalCount);
      }
      traceStep('client-side-numeric-fetch-more-done', {
        added: nodes.length,
        catalog: catalog.length,
        total: result.totalCount || 0,
      });
      return catalog.length > offset;
    }).catch(function (errClientFetchMore) {
      logErrorToHost('client-side numeric fetch more failed', {
        error: String(errClientFetchMore && errClientFetchMore.message || errClientFetchMore),
        offset: offset,
      });
      return false;
    }).finally(function () {
      enhancer.clientSideNumericFetchInFlight = false;
    });
  }

  function recoverBrowseOopsViaClientSideNumeric() {
    var config = enhancer.config;
    if (!config || !shouldUseClientSideNumericFilterApply()) {
      return false;
    }
    var now = Date.now();
    if (enhancer.oopsRecoveryInFlight && enhancer.oopsRecoveryStartedAt &&
        now - enhancer.oopsRecoveryStartedAt < 3000) {
      return true;
    }
    var attempts = enhancer.oopsRecoveryAttempts || 0;
    if (attempts >= 6) {
      return true;
    }
    enhancer.oopsRecoveryInFlight = true;
    enhancer.oopsRecoveryStartedAt = now;
    enhancer.oopsRecoveryAttempts = attempts + 1;
    logToHost('browse oops client-side numeric recovery', {
      attempts: attempts + 1,
      stashed: (enhancer.stashedSidebarNumericFilters || []).length,
    });
    clearEnhancerLocks();
    enhancer.enhancementFullyPaused = false;
    enhancer.nexusFilterApplyInFlight = false;

    function runClientApply() {
      applySidebarNumericFiltersViaGraphql(config).finally(function () {
        enhancer.oopsRecoveryInFlight = false;
        if (window.__vortexBrowseEnhancer) {
          window.__vortexBrowseEnhancer.scheduleScan(true);
        }
      });
    }

    if (isBrowseOopsPage()) {
      var baseUrl = stripInternalBrowseParams(
        enhancer.lastGoodBrowseUrl || window.location.href
      );
      try {
        window.location.replace(baseUrl);
      } catch (errOopsBase) {
        try {
          window.location.href = baseUrl;
        } catch (errOopsHref) {
          runClientApply();
          return true;
        }
      }
      setTimeout(runClientApply, 900);
    } else {
      runClientApply();
    }
    return true;
  }

  function executeMinimalNumericFilteredBrowseScan(config) {
    config = config || enhancer.config;
    if (!config) {
      return emptyScanStats({});
    }
    if (!shouldUseNumericFilteredBrowseScan(config)) {
      return enhancer.lastStats || emptyScanStats(config);
    }
    if (enhancer.minimalNumericScanInProgress) {
      return enhancer.lastStats || emptyScanStats(config);
    }
    var stableSessionKey = getBrowseSessionKey();
    if (enhancer.numericFilteredBrowseStableKey === stableSessionKey &&
        (enhancer.filteredCarouselCatalog || []).length >= getCarouselPageSize(config)) {
      ensureMinimalNumericCarouselLayout(config, { mountControls: true });
      applyMinimalNumericFilteredPage(config, enhancer.filteredCarouselCatalog);
      updateMinimalCarouselControlsInline(
        config,
        enhancer.filteredCarouselCatalog,
        getLockedNexusFilteredDisplayTotal()
      );
      traceStep('minimal-scan-stable', {
        tiles: (enhancer.filteredCarouselCatalog || []).length,
        page: (enhancer.globalPageIndex || 0) + 1,
      });
      return enhancer.lastStats || emptyScanStats(config);
    }
    if (enhancer.clientSideNumericFilterActive) {
      var clientCatalog = refreshClientSideNumericCatalogRefs(config);
      if (clientCatalog.length) {
        ensureMinimalNumericCarouselLayout(config, { mountControls: true });
        applyMinimalNumericFilteredPage(config, clientCatalog);
        try {
          decorateVisibleGridTiles(config);
        } catch (errClientSideDecorate) {
          // ignore
        }
        var clientStats = {
          tileCount: clientCatalog.length,
          installedMatches: clientCatalog.filter(function (entry) { return !!entry.installed; }).length,
          hideInstalled: !!config.hideInstalled,
          onlyInstalled: !!config.onlyInstalled,
          hideTracked: !!config.hideTracked,
          onlyTracked: !!config.onlyTracked,
          installedKeys: Object.keys(config.installed || {}).length,
          numericFilteredScan: true,
          minimalNumericScan: true,
          clientSideNumeric: true,
        };
        enhancer.lastStats = clientStats;
        traceStep('minimal-scan-client-side', {
          tiles: clientCatalog.length,
          page: (enhancer.globalPageIndex || 0) + 1,
        });
        return clientStats;
      }
    }
    var pageSize = getCarouselPageSize(config);
    var existingCatalogLen = (enhancer.filteredCarouselCatalog || []).length;
    var now = Date.now();
    if (enhancer.minimalNumericScanLastAt &&
        now - enhancer.minimalNumericScanLastAt < 5000 &&
        existingCatalogLen >= pageSize) {
      traceStep('minimal-scan-coalesced', {
        sinceMs: now - enhancer.minimalNumericScanLastAt,
        catalog: existingCatalogLen,
      });
      return enhancer.lastStats || emptyScanStats(config);
    }
    if (enhancer.carouselPagingQuietUntil && now < enhancer.carouselPagingQuietUntil &&
        existingCatalogLen >= pageSize) {
      traceStep('minimal-scan-quiet', { catalog: existingCatalogLen });
      return enhancer.lastStats || emptyScanStats(config);
    }
    enhancer.minimalNumericScanInProgress = true;
    enhancer.minimalNumericScanLastAt = now;
    var catalog = [];
    try {
      traceStep('minimal-scan-start', { catalogBefore: existingCatalogLen });
      if (hasNumericNexusBrowseFilters() ||
          hasVisibleNexusFilterChipText() ||
          (config.filterBrowseActive && urlHasActiveNexusFilters())) {
        enhancer.filteredBrowseEngaged = true;
        enhancer.domFilterBrowseActive = true;
        if (hasNumericNexusBrowseFilters()) {
          enhancer.hadNumericNexusBrowseFilters = true;
        }
        syncFilteredBrowseDocumentState();
      }
      traceStep('minimal-scan-state-synced', {});
      if (!document.getElementById(STYLE_ID)) {
        ensureStyles();
      }
      if (config.hideSiteChrome) {
        document.documentElement.classList.add('vortex-enhanced-hide-chrome');
      }
      if (getNexusResultsPageFromUrl() > 1 || !enhancer.carouselAdvancePendingSince ||
          Date.now() - enhancer.carouselAdvancePendingSince > 3000) {
        enhancer.carouselAdvancePending = false;
        enhancer.carouselAdvancePendingSince = 0;
        enhancer.filteredNexusPageNavInFlight = false;
        enhancer.filteredNexusPageNavSince = 0;
      }
      traceStep('minimal-scan-collect', {});
      catalog = collectMinimalNumericBrowseTiles(config);
      traceStep('minimal-scan-collected', { tiles: catalog.length });
      if (hasNumericNexusBrowseFilters() && catalog.length &&
          !enhancer.clientSideNumericFilterActive) {
        // Native tiles are the reliable first batch. Keep them visible while
        // enabling the listing API for subsequent batches.
        enhancer.clientSideNumericFilterActive = true;
        enhancer.filteredCarouselCatalog = catalog;
        enhancer.filteredCarouselCatalogSessionKey = getFilteredCarouselCatalogSessionKey(config);
      }
      ensureMinimalNumericCarouselLayout(config, { mountControls: catalog.length > 0 });
      if (catalog.length) {
        traceStep('minimal-scan-apply-page', { tiles: catalog.length, page: (enhancer.globalPageIndex || 0) + 1 });
        applyMinimalNumericFilteredPage(config, catalog);
        if (catalog.length >= pageSize) {
          enhancer.numericFilteredBrowseStableKey = getBrowseSessionKey();
        }
      } else {
        updateMinimalCarouselControlsInline(config, catalog, 0);
      }
      setTimeout(function () {
        if (!shouldUseNumericFilteredBrowseScan(config)) {
          return;
        }
        scheduleFilteredBrowseTotalFetch(config);
      }, 120);
      traceStep('minimal-scan-done', { tiles: catalog.length });
      if (catalog.length >= pageSize && !enhancer.numericControlsMountedOnce) {
        enhancer.numericControlsMountedOnce = true;
        setTimeout(function () {
          try {
            ensureCarouselControlsBar();
            protectBrowseControlsFromChromeHide();
          } catch (errDeferredSortMount) {
            // ignore
          }
        }, 180);
      }
    } catch (errMinimalNumericScan) {
      var errMsg = String(errMinimalNumericScan && errMinimalNumericScan.message || errMinimalNumericScan);
      var errStack = errMinimalNumericScan && errMinimalNumericScan.stack
        ? String(errMinimalNumericScan.stack).slice(0, 1200)
        : '';
      traceStep('minimal-scan-failed', {
        step: enhancer.minimalNumericScanStep || '',
        error: errMsg,
      });
      logErrorToHost('minimal numeric browse scan failed', {
        error: errMsg,
        step: enhancer.minimalNumericScanStep || '',
        stack: errStack,
      });
      if ((enhancer.filteredCarouselCatalog || []).length >= pageSize) {
        catalog = enhancer.filteredCarouselCatalog;
      }
    } finally {
      installCarouselWheelHandler();
      enhancer.minimalNumericScanInProgress = false;
    }
    if (!catalog.length) {
      setTimeout(function () {
        if (!shouldUseNumericFilteredBrowseScan(config)) {
          return;
        }
        try {
          if ((enhancer.filteredCarouselCatalog || []).length >= getCarouselPageSize(config)) {
            return;
          }
          traceStep('minimal-scan-retry', {});
          var retryCatalog = collectMinimalNumericBrowseTiles(config);
          if (retryCatalog.length) {
            ensureMinimalNumericCarouselLayout(config, { mountControls: true });
            applyMinimalNumericFilteredPage(config, retryCatalog);
            enhancer.numericFilteredBrowseStableKey = getBrowseSessionKey();
            logToHost('minimal numeric scan retry ok', { tiles: retryCatalog.length });
          }
        } catch (errMinimalRetry) {
          logErrorToHost('minimal numeric scan retry failed', {
            error: String(errMinimalRetry && errMinimalRetry.message || errMinimalRetry),
            step: enhancer.minimalNumericScanStep || '',
          });
        }
      }, 450);
    }
    var stats = {
      tileCount: catalog.length,
      installedMatches: catalog.filter(function (entry) { return !!entry.installed; }).length,
      hideInstalled: !!config.hideInstalled,
      onlyInstalled: !!config.onlyInstalled,
      hideTracked: !!config.hideTracked,
      onlyTracked: !!config.onlyTracked,
      installedKeys: Object.keys(config.installed || {}).length,
      numericFilteredScan: true,
      minimalNumericScan: true,
    };
    enhancer.lastStats = stats;
    return stats;
  }

  function buildNumericFilteredLiveCatalog(config) {
    config = config || enhancer.config || { installed: {}, tracked: {} };
    if (!config.installed) {
      config.installed = {};
    }
    if (!config.tracked) {
      config.tracked = {};
    }
    var grid = resolveNexusModGridElement() || findModGrid();
    var catalog = [];
    var seenModIds = {};
    var tileNodes = [];
    if (grid) {
      tileNodes = queryLiveGridModTiles(grid, { minDirect: 1 });
    }
    var stash = document.getElementById('vortex-enhanced-live-stash');
    if (stash) {
      var stashed = stash.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])');
      for (var s = 0; s < stashed.length; s++) {
        if (tileNodes.indexOf(stashed[s]) < 0) {
          tileNodes.push(stashed[s]);
        }
      }
    }
    var poolHost = document.getElementById('vortex-enhanced-pool-host');
    if (poolHost) {
      var pooled = poolHost.querySelectorAll('[data-e2eid="mod-tile"]');
      for (var p = 0; p < pooled.length; p++) {
        if (tileNodes.indexOf(pooled[p]) < 0) {
          tileNodes.push(pooled[p]);
        }
      }
    }
    for (var i = 0; i < tileNodes.length; i++) {
      var tile = tileNodes[i];
      var modId = extractModIdFromTile(tile);
      if (modId) {
        seenModIds[String(modId)] = true;
      }
      catalog.push({
        card: tile,
        modId: modId,
        installed: modId ? (config.installed[String(modId)] || null) : null,
        tracked: !!(modId && config.tracked && config.tracked[String(modId)]),
      });
    }
    if (hasNumericNexusBrowseFilters() && enhancer.tilePool && enhancer.tilePool.length) {
      for (var p = 0; p < enhancer.tilePool.length; p++) {
        var pooled = enhancer.tilePool[p];
        var pooledCard = pooled && pooled.card ? pooled.card : pooled;
        if (!pooledCard || !pooledCard.nodeType) {
          continue;
        }
        var pooledModId = extractModIdFromTile(pooledCard);
        var pooledKey = pooledModId ? String(pooledModId) : ('pool-' + p);
        if (seen[pooledKey]) {
          continue;
        }
        seen[pooledKey] = true;
        catalog.push({
          card: pooledCard,
          modId: pooledModId,
          installed: pooledModId ? (config.installed[String(pooledModId)] || null) : null,
          tracked: !!(pooledModId && config.tracked && config.tracked[String(pooledModId)]),
        });
      }
    }
    var prior = enhancer.filteredCarouselCatalog || [];
    for (var j = 0; j < prior.length; j++) {
      var priorEntry = prior[j];
      if (!priorEntry || !priorEntry.card) {
        continue;
      }
      if (priorEntry.modId && seenModIds[String(priorEntry.modId)]) {
        continue;
      }
      if (priorEntry.modId) {
        seenModIds[String(priorEntry.modId)] = true;
      }
      catalog.push({
        card: priorEntry.card,
        modId: priorEntry.modId,
        installed: priorEntry.installed || (priorEntry.modId
          ? (config.installed[String(priorEntry.modId)] || null)
          : null),
        tracked: priorEntry.tracked != null
          ? !!priorEntry.tracked
          : !!(priorEntry.modId && config.tracked && config.tracked[String(priorEntry.modId)]),
      });
    }
    enhancer.filteredCarouselCatalog = catalog;
    enhancer.filteredCarouselCatalogSessionKey = getFilteredCarouselCatalogSessionKey(config);
    return catalog;
  }

  function applyNumericFilteredLivePage(config, options) {
    options = options || {};
    config = config || enhancer.config;
    if (!config) {
      return 0;
    }
    if (options.forcePageApply || options.rebuildCatalog) {
      buildNumericFilteredLiveCatalog(config);
    }
    var catalog = enhancer.filteredCarouselCatalog && enhancer.filteredCarouselCatalog.length
      ? enhancer.filteredCarouselCatalog
      : buildNumericFilteredLiveCatalog(config);
    if (!catalog.length) {
      return 0;
    }
    var pageSize = getCarouselPageSize(config);
    var currentPage = Math.max(0, enhancer.globalPageIndex || 0);
    if (!options.forcePageApply &&
        enhancer.carouselPagingQuietUntil && Date.now() < enhancer.carouselPagingQuietUntil) {
      return 0;
    }
    var start = currentPage * pageSize;
    var pageSlice = catalog.slice(start, start + pageSize);
    if (!pageSlice.length && currentPage > 0) {
      if (hasNumericNexusBrowseFilters()) {
        return 0;
      }
      enhancer.globalPageIndex = 0;
      enhancer.batchPageIndex = 0;
      currentPage = 0;
      start = 0;
      pageSlice = catalog.slice(0, pageSize);
      saveCarouselPagingState();
    }
    var showIds = {};
    var showTileSet = typeof WeakSet === 'function' ? new WeakSet() : null;
    var pageModIds = [];
    for (var s = 0; s < pageSlice.length; s++) {
      if (pageSlice[s].modId) {
        showIds[String(pageSlice[s].modId)] = true;
        pageModIds.push(pageSlice[s].modId);
      }
      if (pageSlice[s].card && showTileSet) {
        showTileSet.add(pageSlice[s].card);
      }
    }
    var grid = resolveNexusModGridElement() || findModGrid();
    var poolHost = document.getElementById('vortex-enhanced-pool-host');
    var stash = document.getElementById('vortex-enhanced-live-stash');
    function numericTileShouldShow(card, modId) {
      if (showTileSet && showTileSet.has(card)) {
        return true;
      }
      return !!(modId && showIds[String(modId)]);
    }
    for (var c = 0; c < catalog.length; c++) {
      var entry = catalog[c];
      if (!entry || !entry.card) {
        continue;
      }
      setCarouselTileVisibility(
        entry.card,
        numericTileShouldShow(entry.card, entry.modId),
        grid,
        poolHost,
        stash
      );
    }
    if (grid) {
      grid.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').forEach(function (tile) {
        if (showTileSet && showTileSet.has(tile)) {
          return;
        }
        var tileModId = extractModIdFromTile(tile);
        setCarouselTileVisibility(tile, numericTileShouldShow(tile, tileModId), grid, poolHost, stash);
      });
    }
    var decorated = 0;
    try {
      decorated = decorateFilteredPageTilesByModIds(config, showIds);
    } catch (errNumericDecorate) {
      logErrorToHost('numeric filtered page decorate failed', {
        error: String(errNumericDecorate && errNumericDecorate.message || errNumericDecorate),
      });
    }
    var displayTotal = getLockedNexusFilteredDisplayTotal() ||
      resolveNumericFilteredResultsTotal() ||
      catalog.length;
    var batchPages = displayTotal > 0
      ? Math.max(1, Math.ceil(displayTotal / pageSize))
      : Math.max(1, Math.ceil(catalog.length / pageSize));
    enhancer.lastAppliedSliceKey = getCarouselSliceKey(pageSize, pageModIds.sort(function (a, b) { return a - b; }));
    updateCarouselControls(displayTotal, batchPages, pageSize, currentPage, {
      skipCatalogResolve: true,
      loadedCatalogCount: catalog.length,
      displayTotal: displayTotal,
      catalogPages: batchPages,
    });
    if (!options.skipControlsRemount) {
      ensureNumericFilteredCarouselControls(config);
    }
    protectBrowseControlsFromChromeHide();
    installCarouselWheelHandler();
    return decorated;
  }

  function ensureNumericFilteredCarouselControls(config) {
    var controls = ensureCarouselControls();
    if (enhancer.controlsPinnedSortRow && document.body.contains(enhancer.controlsPinnedSortRow)) {
      try {
        mountCarouselControlsInSortRow(enhancer.controlsPinnedSortRow);
      } catch (errPinnedSortRow) {
        // ignore
      }
      return controls;
    }
    if (controls.parentElement &&
        controls.parentElement !== document.body &&
        document.body.contains(controls)) {
      return controls;
    }
    try {
      if (!mountControlsInCarouselHost(controls)) {
        mountControlsFallback(controls);
      }
    } catch (errMountNumericControls) {
      try {
        mountControlsFallback(controls);
      } catch (errMountNumericFallback) {
        // ignore
      }
    }
    return controls;
  }

  function ensureNumericFilteredCarouselLayout(config) {
    var grid = resolveNexusModGridElement() || findModGrid();
    if (!grid) {
      return false;
    }
    document.documentElement.classList.add('vortex-enhanced-browse-wide', 'vortex-enhanced-filtered-browse');
    grid.classList.add('vortex-enhanced-nexus-grid');
    applyGridLayoutStyles(grid, config);
    enhancer.nexusModGridRef = grid;
    var host = grid.parentElement;
    if (host && !host.classList.contains('vortex-enhanced-carousel-host')) {
      host.classList.add('vortex-enhanced-carousel-host');
    }
    ensureNumericFilteredCarouselControls(config);
    installCarouselWheelHandler();
    syncAutoAdvance();
    return true;
  }

  function executeNumericFilteredBrowseScan(config) {
    return executeMinimalNumericFilteredBrowseScan(config);
  }

  function scanFilteredBrowseLight(config) {
    if (getNexusResultsPageFromUrl() > 1 || !enhancer.carouselAdvancePendingSince ||
        Date.now() - enhancer.carouselAdvancePendingSince > 3000) {
      enhancer.carouselAdvancePending = false;
      enhancer.carouselAdvancePendingSince = 0;
      enhancer.filteredNexusPageNavInFlight = false;
      enhancer.filteredNexusPageNavSince = 0;
    }
    if (isNexusAuthPage()) {
      clearAuthPageEnhancement();
      return {
        tileCount: 0,
        installedMatches: 0,
        hideInstalled: !!config.hideInstalled,
        onlyInstalled: !!config.onlyInstalled,
        hideTracked: !!config.hideTracked,
        onlyTracked: !!config.onlyTracked,
        installedKeys: Object.keys(config.installed || {}).length,
        filteredBrowseLight: true,
        authPage: true,
      };
    }
    if (config && config.hideSiteChrome) {
      document.documentElement.classList.add('vortex-enhanced-hide-chrome');
    }
    hideNexusItemsPerPageUi();
    tagNexusPaginationNav();
    protectBrowseControlsFromChromeHide();
    refreshDomFilteredBrowseState();
    syncFilteredBrowseDocumentState();
    var liveCount = document.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').length;
    ensureFilteredCarouselCatalogFromLive(config);
    var needsApply = enhancer.carouselAdvancePending ||
      !enhancer.lastAppliedSliceKey ||
      !document.querySelector('.vortex-enhanced-carousel-controls') ||
      gridVisibleTilesNeedDecoration(config);
    if (needsApply) {
      safeApplyFilteredBrowseLiveOnlyPage(config, {
        forcePageApply: (enhancer.globalPageIndex || 0) > 0,
        skipHeadlineSync: true,
      });
    } else {
      decorateVisibleFilteredCarouselTiles(config);
    }
    ensureCarouselControlsBar();
    pinNexusFilteredResultsTotal();
    syncNexusFilteredResultsHeadlines();
    return {
      tileCount: liveCount,
      installedMatches: 0,
      hideInstalled: !!config.hideInstalled,
      onlyInstalled: !!config.onlyInstalled,
      hideTracked: !!config.hideTracked,
      onlyTracked: !!config.onlyTracked,
      installedKeys: Object.keys(config.installed || {}).length,
      filteredBrowseLight: true,
    };
  }

  function applyFilteredBrowseLightPage(config, options) {
    options = options || {};
    if (!config) {
      return 0;
    }
    return safeApplyFilteredBrowseLiveOnlyPage(config, options);
  }

  function isBrowseOopsHtml(html) {
    if (!html) {
      return false;
    }
    return /oops!? something went wrong|something went wrong|unexpected error|page could not be loaded/i.test(html);
  }

  function parseModTilesFromHtml(html, baseUrl, config) {
    if (isBrowseOopsHtml(html)) {
      return [];
    }
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var tiles = doc.querySelectorAll('[data-e2eid="mod-tile"]');
    var parsed = [];
    for (var i = 0; i < tiles.length; i++) {
      var clone = tiles[i].cloneNode(true);
      clone.setAttribute('data-vortex-pool-tile', 'true');
      clone.removeAttribute(MARK);
      fixTileResourceUrls(clone, baseUrl);
      parsed.push(clone);
    }
    if (parsed.length >= 8) {
      return parsed;
    }
    var nodes = parseGraphqlModNodesFromNextHtml(html);
    if (!nodes.length) {
      return parsed;
    }
    var built = [];
    for (var n = 0; n < nodes.length; n++) {
      built.push(buildGraphQLModTile(nodes[n]));
    }
    return built;
  }

  function appendFetchedTilesToPool(tileElements, config) {
    var pool = ensurePoolHost();
    if (!pool || !tileElements || tileElements.length === 0) {
      return 0;
    }

    var seen = {};
    for (var p = 0; p < enhancer.tilePool.length; p++) {
      if (enhancer.tilePool[p].modId) {
        seen[enhancer.tilePool[p].modId] = true;
      }
    }

    var added = 0;
    for (var i = 0; i < tileElements.length; i++) {
      var tile = tileElements[i];
      var modId = extractModIdFromTile(tile);
      if (modId && seen[modId]) {
        continue;
      }
      if (modId) {
        seen[modId] = true;
      }
      var catalogIndex = getMaxCatalogIndex() + 1;
      tile.setAttribute('data-vortex-catalog-index', String(catalogIndex));
      rememberCatalogIndex(modId, catalogIndex);
      pool.appendChild(tile);
      enhancer.tilePool.push({
        modId: modId,
        installed: modId ? (config.installed[String(modId)] || null) : null,
        tracked: !!(modId && config.tracked && config.tracked[String(modId)]),
        card: tile,
      });
      added++;
    }
    return added;
  }

  function getGameDomainFromPath() {
    var match = window.location.pathname.match(/^\/games\/([^/]+)\/mods/);
    if (!match) {
      return null;
    }
    var game = match[1].toLowerCase();
    return game === 'moddingtools' ? 'site' : game;
  }

  function loadNexusListingContext() {
    var params = new URLSearchParams(window.location.search);
    var arr = function (key) { return params.getAll(key); };
    var one = function (key) { return params.get(key) || null; };
    var context = {
      gameName: getGameDomainFromPath(),
      categories: arr('categoryName'),
      tagsContains: arr('tag'),
      tagsExclude: arr('excludedTag'),
      languages: arr('languageName'),
      title: one('title') || one('keyword') || one('q'),
      description: one('description'),
      sort: params.get('sort'),
      sortDirection: params.get('sortDirection') || 'DESC',
      sortExplicit: params.has('sort'),
      showAdult: params.get('showAdultContent'),
      onlyAdult: params.get('adultContent'),
      vortexSupport: params.get('supportsVortex'),
      onlyUpdated: params.get('hasUpdated'),
    };
    // Numeric Apply is handled before Nexus updates the URL. Read adult state
    // from the live sidebar so the same GraphQL request includes it.
    var panel = findNexusFilterAside();
    if (panel) {
      var controls = panel.querySelectorAll(
        'input[type="checkbox"], button[role="checkbox"], [role="checkbox"]'
      );
      for (var i = 0; i < controls.length; i++) {
        if (controls[i].closest('[data-vortex-enhanced-filters="true"]')) {
          continue;
        }
        var label = getNexusFilterInputLabel(controls[i]).toLowerCase();
        if (label.indexOf('show only adult') >= 0) {
          context.showAdult = isNexusFilterInputChecked(controls[i]) ? 'true' : null;
          context.onlyAdult = null;
        } else if (label.indexOf('hide adult') >= 0) {
          context.onlyAdult = isNexusFilterInputChecked(controls[i]) ? 'false' : null;
          context.showAdult = null;
        }
      }
    }
    return context;
  }

  function escHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"'`]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[ch];
    });
  }

  function formatCompactNumber(value) {
    var n = Number(value) || 0;
    if (n >= 1000000) {
      return (n / 1000000).toFixed(1) + 'm';
    }
    if (n >= 1000) {
      return (n / 1000).toFixed(1) + 'k';
    }
    return String(n);
  }

  function formatGraphqlFileSize(kb) {
    if (!kb) {
      return '0 B';
    }
    var bytes = kb * 1024;
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return parseFloat((bytes / Math.pow(1024, idx)).toFixed(1)) + units[idx];
  }

  function formatGraphqlTimeAgo(input) {
    var date = new Date(input);
    if (isNaN(date.getTime())) {
      return '';
    }
    var seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) {
      return 'just now';
    }
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return minutes + ' minute' + (minutes > 1 ? 's' : '') + ' ago';
    }
    var hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return hours + ' hour' + (hours > 1 ? 's' : '') + ' ago';
    }
    var days = Math.floor(hours / 24);
    if (days < 7) {
      return days + ' day' + (days > 1 ? 's' : '') + ' ago';
    }
    var weeks = Math.floor(days / 7);
    if (weeks < 4) {
      return weeks + ' week' + (weeks > 1 ? 's' : '') + ' ago';
    }
    var months = Math.floor(days / 30);
    if (months < 12) {
      return months + ' month' + (months > 1 ? 's' : '') + ' ago';
    }
    var years = Math.floor(days / 365);
    return years + ' year' + (years > 1 ? 's' : '') + ' ago';
  }

  function nexusTileIconHtml(kind) {
    var icons = {
      updated: 'M21,10.12H14.22L16.96,7.3C14.23,4.6 9.81,4.5 7.08,7.2C4.35,9.91 4.35,14.28 7.08,17C9.81,19.7 14.23,19.7 16.96,17C18.32,15.65 19,14.08 19,12.1H21C21,14.08 20.12,16.65 18.36,18.39C14.85,21.87 9.15,21.87 5.64,18.39C2.14,14.92 2.11,9.28 5.62,5.81C9.13,2.34 14.76,2.34 18.27,5.81L21,3V10.12M12.5,8V12.25L16,14.33L15.28,15.54L11,13V8H12.5Z',
      uploaded: 'M9,16V10H5L12,3L19,10H15V16H9M5,20V18H19V20H5Z',
      endorse: 'M23,10C23,8.89 22.1,8 21,8H14.68L15.64,3.43C15.66,3.33 15.67,3.22 15.67,3.11C15.67,2.7 15.5,2.32 15.23,2.05L14.17,1L7.59,7.58C7.22,7.95 7,8.45 7,9V19A2,2 0 0,0 9,21H18C18.83,21 19.54,20.5 19.84,19.78L22.86,12.73C22.95,12.5 23,12.26 23,12V10M1,21H5V9H1V21Z',
      download: 'M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z',
      filesize: 'M4.9 10.7L7.3 5.9C7.4 5.6 7.6 5.4 7.9 5.2C8.2 5.1 8.5 5 8.8 5H16.5C16.8 5 17.1 5.1 17.3 5.2C17.6 5.4 17.8 5.6 17.9 5.9L20.3 10.7H4.9ZM4.5 16.4V11.5H20.75V16.4C20.75 16.8 20.6 17.2 20.3 17.5C19.97 17.8 19.56 18 19.13 18H6.13C5.69 18 5.28 17.8 4.98 17.5C4.67 17.2 4.5 16.83 4.5 16.4Z',
    };
    var path = icons[kind];
    if (!path) {
      return '';
    }
    return '<svg viewBox="0 0 24 24" class="vortex-enhanced-tile-icon" aria-hidden="true"><path d="' + path + '" fill="currentColor"/></svg>';
  }

  function ensureTileRowIcon(row, kind) {
    if (!row || row.querySelector('svg')) {
      return;
    }
    row.insertAdjacentHTML('afterbegin', nexusTileIconHtml(kind));
  }

  function normalizeTileDateRow(card) {
    if (!card) {
      return;
    }

    var updated = card.querySelector('[data-e2eid="mod-tile-updated"]');
    var uploaded = card.querySelector('[data-e2eid="mod-tile-uploaded"]');
    if (updated) {
      ensureTileRowIcon(updated, 'updated');
    }
    if (uploaded) {
      ensureTileRowIcon(uploaded, 'uploaded');
    }

    if (updated && uploaded) {
      var updatedText = (updated.textContent || '').replace(/\s+/g, ' ').trim();
      var uploadedText = (uploaded.textContent || '').replace(/\s+/g, ' ').trim();
      if (updatedText && updatedText === uploadedText) {
        uploaded.classList.add('vortex-enhanced-hidden');
      } else {
        uploaded.classList.remove('vortex-enhanced-hidden');
      }
    }

    if (updated && updated.parentElement) {
      updated.parentElement.classList.add('vortex-enhanced-date-row');
    }
  }

  function normalizeTileFooterStats(card) {
    if (!card) {
      return;
    }

    var endorse = card.querySelector('[data-e2eid="mod-tile-endorsements"]');
    var downloads = card.querySelector('[data-e2eid="mod-tile-downloads"]');
    var fileSize = card.querySelector('[data-e2eid="mod-tile-file-size"]');

    if (endorse) {
      ensureTileRowIcon(endorse.closest('p') || endorse.parentElement, 'endorse');
    }
    if (downloads) {
      ensureTileRowIcon(downloads.closest('p') || downloads.parentElement, 'download');
    }
    if (fileSize) {
      ensureTileRowIcon(fileSize.closest('p') || fileSize.parentElement, 'filesize');
    }

    var footer = findTileFooter(card);
    if (footer) {
      footer.classList.add('vortex-enhanced-footer-row');
      footer.querySelectorAll('p').forEach(function (node) {
        node.classList.add('vortex-enhanced-footer-stat');
      });
    }
  }

  function normalizeCardChrome(card) {
    normalizeTileDateRow(card);
    normalizeTileFooterStats(card);
  }

  function buildGraphQLModTile(node) {
    var domain = node.game && node.game.domainName ? String(node.game.domainName) : '';
    var modId = node.modId != null ? String(node.modId) : '';
    var itemUrl = domain && modId ? ('https://www.nexusmods.com/' + domain + '/mods/' + modId) : '#';
    var authorName = (node.uploader && node.uploader.name) || '';
    var authorUrl = authorName ? ('https://www.nexusmods.com/profile/' + encodeURIComponent(authorName)) : '#';
    var categoryUrl = node.modCategory && domain
      ? ('https://www.nexusmods.com/games/' + domain + '/mods?categoryName=' + encodeURIComponent(node.modCategory.name))
      : '#';
    var thumb = node.thumbnailUrl && /^https?:\/\//i.test(node.thumbnailUrl) ? escHtml(node.thumbnailUrl) : '';
    var avatar = node.uploader && node.uploader.avatar && /^https?:\/\//i.test(node.uploader.avatar)
      ? escHtml(node.uploader.avatar) : '';

    var root = document.createElement('div');
    root.className = '@container/mod-tile group/mod-tile bg-surface-mid flex min-h-108 flex-col rounded';
    root.setAttribute('data-e2eid', 'mod-tile');
    root.setAttribute('data-vortex-pool-tile', 'true');
    root.innerHTML =
      '<div class="relative">' +
        '<a href="' + itemUrl + '">' +
          '<div class="bg-surface-translucent-low group/image relative z-0 flex aspect-video items-center justify-center overflow-hidden rounded-t">' +
            (thumb ? ('<img alt="' + escHtml(node.name || '') + '" class="absolute z-2 max-h-full transition-transform group-hover/image:scale-105" src="' + thumb + '">') : '') +
          '</div>' +
        '</a>' +
        '<div class="px-3 pt-3 pb-5">' +
          '<div class="divide-y divide-solid divide-stroke-weak">' +
            '<div class="space-y-1.5 pb-2">' +
              '<a class="nxm-link nxm-link-variant-secondary nxm-link-moderate typography-body-lg line-clamp-2 font-semibold break-words" data-e2eid="mod-tile-title" href="' + itemUrl + '">' + escHtml(node.name || '') + '</a>' +
              '<a class="nxm-link nxm-link-variant-secondary nxm-link-moderate typography-body-sm gap-x-1.5 flex" data-e2eid="user-link" href="' + authorUrl + '" target="_blank">' +
                (avatar ? ('<img class="size-4 shrink-0 rounded-full" loading="lazy" src="' + avatar + '">') : '') +
                '<span class="truncate">' + escHtml(authorName) + '</span>' +
              '</a>' +
            '</div>' +
            '<div class="flex flex-col space-y-0.5 py-2 leading-none @3xs/mod-tile:block @3xs/mod-tile:space-y-0">' +
              '<a class="nxm-link nxm-link-variant-secondary nxm-link-moderate typography-body-sm inline" data-e2eid="mod-tile-category" href="' + categoryUrl + '">' + escHtml((node.modCategory && node.modCategory.name) || '') + '</a>' +
            '</div>' +
            '<div class="vortex-enhanced-date-row flex flex-col gap-x-4 gap-y-1 py-2 @3xs/mod-tile:flex-row @3xs/mod-tile:gap-y-0">' +
              '<p class="typography-body-sm text-neutral-subdued flex items-center gap-x-1" data-e2eid="mod-tile-updated">' +
                nexusTileIconHtml('updated') +
                '<time>' + escHtml(formatGraphqlTimeAgo(node.updatedAt)) + '</time>' +
              '</p>' +
              '<p class="typography-body-sm text-neutral-subdued flex items-center gap-x-1" data-e2eid="mod-tile-uploaded">' +
                nexusTileIconHtml('uploaded') +
                '<time>' + escHtml(formatGraphqlTimeAgo(node.createdAt)) + '</time>' +
              '</p>' +
            '</div>' +
            '<div class="typography-body-sm text-neutral-subdued line-clamp-4 pt-2 break-words vortex-enhanced-desc-clamped" data-e2eid="mod-tile-summary">' + escHtml(node.summary || '') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="mt-auto flex min-h-8 items-center gap-x-4 rounded-b bg-surface-high px-3 vortex-enhanced-footer-row">' +
          '<p class="typography-body-sm text-neutral-moderate flex items-center gap-x-1 leading-4 vortex-enhanced-footer-stat">' +
            nexusTileIconHtml('endorse') +
            '<span data-e2eid="mod-tile-endorsements">' + escHtml(formatCompactNumber(node.endorsements)) + '</span>' +
          '</p>' +
          '<p class="typography-body-sm text-neutral-moderate flex items-center gap-x-1 leading-4 vortex-enhanced-footer-stat">' +
            nexusTileIconHtml('download') +
            '<span data-e2eid="mod-tile-downloads">' + escHtml(formatCompactNumber(node.downloads)) + '</span>' +
          '</p>' +
          '<p class="typography-body-sm text-neutral-moderate flex items-center gap-x-1 leading-4 vortex-enhanced-footer-stat">' +
            nexusTileIconHtml('filesize') +
            '<span data-e2eid="mod-tile-file-size">' + escHtml(formatGraphqlFileSize(node.fileSize)) + '</span>' +
          '</p>' +
        '</div>' +
      '</div>';
    return root;
  }

  function parseNumericUrlValue(raw) {
    if (raw == null || raw === '') {
      return null;
    }
    var cleaned = String(raw).replace(/,/g, '').trim();
    var rangeMatch = cleaned.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      return {
        min: parseInt(rangeMatch[1], 10),
        max: parseInt(rangeMatch[2], 10),
      };
    }
    var single = parseInt(cleaned, 10);
    return isNaN(single) ? null : { single: single };
  }

  function pushGraphqlIntFilter(target, field, op, value) {
    if (value == null || isNaN(value)) {
      return;
    }
    target[field] = target[field] || [];
    var normalized = String(value);
    for (var i = 0; i < target[field].length; i++) {
      var existing = target[field][i];
      if (existing && existing.op === op && String(existing.value) === normalized) {
        return;
      }
    }
    target[field].push({ op: op, value: normalized });
  }

  function scheduleFilteredBrowseRescan(delayMs) {
    delayMs = typeof delayMs === 'number' && delayMs >= 0 ? delayMs : 400;
    if (enhancer.filteredBrowseRescanTimer) {
      clearTimeout(enhancer.filteredBrowseRescanTimer);
      enhancer.filteredBrowseRescanTimer = null;
    }
    enhancer.filteredBrowseRescanTimer = setTimeout(function () {
      enhancer.filteredBrowseRescanTimer = null;
      if (!window.__vortexBrowseEnhancer ||
          !(urlHasActiveNexusFilters() || hasNumericNexusBrowseFilters() ||
            isFilteredBrowseSession(enhancer.config || {}))) {
        return;
      }
      if (gridVisibleTilesNeedDecoration(enhancer.config || {})) {
        decorateVisibleFilteredCarouselTiles(enhancer.config || {});
      }
      if (window.__vortexBrowseEnhancer) {
        window.__vortexBrowseEnhancer.scheduleScan(false);
      }
    }, delayMs);
  }

  function scheduleFilteredBrowseDecorationRetry(config) {
    if (!config || !(urlHasActiveNexusFilters() || hasNumericNexusBrowseFilters() || isFilteredBrowseSession(config))) {
      return;
    }
    if (enhancer.filteredBrowseDecorateRetryGen === undefined) {
      enhancer.filteredBrowseDecorateRetryGen = 0;
    }
    var retryGen = ++enhancer.filteredBrowseDecorateRetryGen;
    applyFiltersToAllGridTiles(config);
    dedupeLiveGridModTiles(config);
    decorateVisibleFilteredCarouselTiles(config);
    [120, 400, 900].forEach(function (delayMs) {
      setTimeout(function () {
        if (!window.__vortexBrowseEnhancer || retryGen !== enhancer.filteredBrowseDecorateRetryGen) {
          return;
        }
        if (!(urlHasActiveNexusFilters() || hasNumericNexusBrowseFilters() || isFilteredBrowseSession(config))) {
          return;
        }
        if (gridVisibleTilesNeedDecoration(config)) {
          applyFiltersToAllGridTiles(config);
          dedupeLiveGridModTiles(config);
          decorateVisibleFilteredCarouselTiles(config);
          installCarouselWheelHandler();
          ensureCarouselControlsBar();
          protectBrowseControlsFromChromeHide();
        }
      }, delayMs);
    });
  }

  function applyNumericFilterFromChipText(filter, text) {
    if (!filter || !text) {
      return;
    }
    var maxDownloads = text.match(/max(?:imum)?\s+downloads?\s*[:]\s*([\d][\d,]*)/i) ||
      text.match(/downloads?\s*(?:≤|<=|under|up to|max)\s*([\d][\d,]*)/i);
    if (maxDownloads) {
      pushGraphqlIntFilter(
        filter,
        'downloads',
        'LTE',
        parseInt(maxDownloads[1].replace(/,/g, ''), 10)
      );
    }
    var minDownloads = text.match(/min(?:imum)?\s+downloads?\s*[:]\s*([\d][\d,]*)/i) ||
      text.match(/downloads?\s*(?:≥|>=|over|at least|min)\s*([\d][\d,]*)/i);
    if (minDownloads) {
      pushGraphqlIntFilter(
        filter,
        'downloads',
        'GTE',
        parseInt(minDownloads[1].replace(/,/g, ''), 10)
      );
    }
    var maxEndorse = text.match(/max(?:imum)?\s+endorsements?\s*[:]\s*([\d][\d,]*)/i);
    if (maxEndorse) {
      pushGraphqlIntFilter(
        filter,
        'endorsements',
        'LTE',
        parseInt(maxEndorse[1].replace(/,/g, ''), 10)
      );
    }
    var minEndorse = text.match(/min(?:imum)?\s+endorsements?\s*[:]\s*([\d][\d,]*)/i);
    if (minEndorse) {
      pushGraphqlIntFilter(
        filter,
        'endorsements',
        'GTE',
        parseInt(minEndorse[1].replace(/,/g, ''), 10)
      );
    }
  }

  function forEachActiveNexusFilterChip(callback) {
    if (typeof callback !== 'function') {
      return;
    }
    var seen = {};
    var chipSelectors = [
      '.vortex-enhanced-nexus-active-filters button',
      '.vortex-enhanced-nexus-active-filters a',
      '[class*="ActiveFilter"] button',
      '[class*="ActiveFilter"] a',
      '[class*="AppliedFilter"] button',
      '[class*="AppliedFilter"] a',
      '[class*="ResultsHeader"] button',
      '[class*="ResultsHeader"] a',
    ];
    chipSelectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (chip) {
        if (isClearAllControl(chip) || seen[chip]) {
          return;
        }
        if (!isInMainBrowseColumn(chip, { ignoreVisibility: true })) {
          return;
        }
        seen[chip] = true;
        callback(chip);
      });
    });
    document.querySelectorAll('[class*="ActiveFilter"], [class*="AppliedFilter"], [class*="ResultsHeader"]').forEach(function (row) {
      row.querySelectorAll('button, a, [role="button"]').forEach(function (chip) {
        if (isClearAllControl(chip) || seen[chip]) {
          return;
        }
        if (!isInMainBrowseColumn(chip, { ignoreVisibility: true })) {
          return;
        }
        var text = normalizeUiText(chip.textContent || '');
        if (text.length < 4 || text.length > 72) {
          return;
        }
        if (!/max downloads|min downloads|max endorsements|min endorsements|^excluded:|^included:|^category:|^tag:/i.test(text)) {
          return;
        }
        seen[chip] = true;
        callback(chip);
      });
    });
  }

  function applyActiveFilterChipNumericFilters(filter) {
    if (!filter) {
      return;
    }
    forEachActiveNexusFilterChip(function (chip) {
      var text = normalizeUiText(chip.textContent);
      var aria = normalizeUiText(chip.getAttribute && chip.getAttribute('aria-label'));
      applyNumericFilterFromChipText(filter, text);
      if (aria && aria !== text) {
        applyNumericFilterFromChipText(filter, aria);
      }
    });
  }

  function mergeGraphqlFilterJsonTarget(target, source) {
    if (!target || !source || typeof source !== 'object') {
      return;
    }
    Object.keys(source).forEach(function (key) {
      var value = source[key];
      if (key === 'filter' && Array.isArray(value)) {
        value.forEach(function (entry) {
          mergeGraphqlFilterJsonTarget(target, entry);
        });
        return;
      }
      if (Array.isArray(value)) {
        target[key] = target[key] || [];
        value.forEach(function (entry) {
          if (!entry || typeof entry !== 'object') {
            return;
          }
          if (entry.op != null && entry.value != null) {
            pushGraphqlIntFilter(target, key, entry.op, entry.value);
          }
        });
        return;
      }
      if (value && typeof value === 'object' && value.op != null && value.value != null) {
        pushGraphqlIntFilter(target, key, value.op, value.value);
      }
    });
  }

  function applyUrlJsonFilterParams(filter) {
    if (!filter) {
      return;
    }
    try {
      var params = new URLSearchParams(window.location.search);
      ['filter', 'filters', 'nodeFilter', 'nodesFilter'].forEach(function (key) {
        params.getAll(key).forEach(function (raw) {
          if (!raw) {
            return;
          }
          var decoded = raw;
          try {
            if (decoded.indexOf('%') >= 0) {
              decoded = decodeURIComponent(decoded);
            }
            if (decoded.charAt(0) !== '{' && decoded.charAt(0) !== '[') {
              return;
            }
            mergeGraphqlFilterJsonTarget(filter, JSON.parse(decoded));
          } catch (errJsonFilter) {
            // ignore malformed filter blobs
          }
        });
      });
    } catch (errUrlJsonFilters) {
      // ignore
    }
  }

  function resolveNumericFilterField(key) {
    var k = String(key || '').toLowerCase().replace(/[_-]/g, '');
    if (k.indexOf('download') >= 0) {
      return 'downloads';
    }
    if (k.indexOf('endorse') >= 0) {
      return 'endorsements';
    }
    if (k.indexOf('filesize') >= 0 || k === 'size') {
      return 'fileSize';
    }
    return null;
  }

  function applyHashBrowseNumericFilters(filter) {
    if (!filter) {
      return;
    }
    try {
      var hash = (window.location.hash || '').replace(/^#/, '').trim();
      if (!hash) {
        return;
      }
      hash.split(/[&;]/).forEach(function (segment) {
        if (!segment) {
          return;
        }
        var eq = segment.indexOf('=');
        var key = eq >= 0 ? segment.slice(0, eq) : segment;
        var value = eq >= 0 ? segment.slice(eq + 1) : '';
        key = decodeURIComponent(key || '').trim();
        value = decodeURIComponent(value || '').trim();
        if (!key) {
          return;
        }
        var field = resolveNumericFilterField(key);
        if (!field) {
          return;
        }
        var parsed = parseNumericUrlValue(value);
        if (!parsed) {
          return;
        }
        if (parsed.min != null) {
          pushGraphqlIntFilter(filter, field, 'GTE', parsed.min);
        }
        if (parsed.max != null) {
          pushGraphqlIntFilter(filter, field, 'LTE', parsed.max);
        }
        if (parsed.single != null) {
          if (/max|to|upper|less|lte/i.test(key)) {
            pushGraphqlIntFilter(filter, field, 'LTE', parsed.single);
          } else if (/min|from|greater|gte/i.test(key)) {
            pushGraphqlIntFilter(filter, field, 'GTE', parsed.single);
          }
        }
      });
    } catch (errHashFilters) {
      // ignore
    }
  }

  function applyNexusUrlNumericFilters(filter) {
    if (!filter) {
      return;
    }
    applyUrlJsonFilterParams(filter);
    applyActiveFilterChipNumericFilters(filter);
    applyHashBrowseNumericFilters(filter);
    try {
      var params = new URLSearchParams(window.location.search);
      params.forEach(function (value, key) {
        var k = key.toLowerCase().replace(/[_-]/g, '');
        if (k === 'filter' || k === 'filters' || k === 'nodefilter' || k === 'nodesfilter') {
          return;
        }
        var parsed = parseNumericUrlValue(value);
        if (!parsed) {
          return;
        }

        var field = resolveNumericFilterField(k);
        if (!field) {
          return;
        }

        if (parsed.min != null) {
          pushGraphqlIntFilter(filter, field, 'GTE', parsed.min);
        }
        if (parsed.max != null) {
          pushGraphqlIntFilter(filter, field, 'LTE', parsed.max);
        }
        if (parsed.single != null) {
          if (k.indexOf('max') >= 0 || k.indexOf('to') >= 0 || k.indexOf('upper') >= 0 ||
              k.indexOf('less') >= 0 || k.indexOf('lte') >= 0) {
            pushGraphqlIntFilter(filter, field, 'LTE', parsed.single);
          } else if (k.indexOf('min') >= 0 || k.indexOf('from') >= 0 || k.indexOf('greater') >= 0 ||
                     k.indexOf('gte') >= 0) {
            pushGraphqlIntFilter(filter, field, 'GTE', parsed.single);
          }
        }
      });
    } catch (errUrlFilters) {
      // ignore
    }
  }

  function buildModsListingVariables(offset, count, ctx, config) {
    var adultFilter = [];
    if (ctx.onlyAdult === 'false') {
      adultFilter = [{ op: 'EQUALS', value: false }];
    } else if (ctx.showAdult === 'true') {
      adultFilter = [{ op: 'EQUALS', value: true }];
    }

    var tagsExclude = (ctx.tagsExclude || []).slice();
    if (shouldFilterTranslationsClientSide() &&
        !tagsExclude.some(function (tag) { return /translation/i.test(String(tag)); })) {
      tagsExclude.push('Translation');
    }

    var postFilter = {
      tag: tagsExclude.length
        ? tagsExclude.map(function (value) { return { op: 'NOT_EQUALS', value: String(value) }; })
        : [],
    };

    if (shouldFilterTranslationsClientSide()) {
      postFilter.categoryName = [{ op: 'NOT_EQUALS', value: 'Translation' }];
    }

    var variables = {
      count: count,
      offset: offset,
      facets: {
        categoryName: ctx.categories || [],
        languageName: ctx.languages || [],
        tag: ctx.tagsContains || [],
      },
      filter: {
        adultContent: adultFilter,
        gameDomainName: ctx.gameName ? [{ op: 'EQUALS', value: ctx.gameName }] : [],
        hasUpdated: ctx.onlyUpdated ? [{ op: 'EQUALS', value: ctx.onlyUpdated === 'true' }] : [],
        supportsVortex: ctx.vortexSupport ? [{ op: 'EQUALS', value: ctx.vortexSupport === 'true' }] : [],
        name: ctx.title ? [{ op: 'WILDCARD', value: ctx.title }] : [],
      },
      postFilter: postFilter,
    };

    if (ctx.sortExplicit && ctx.sort) {
      var sortField = String(ctx.sort);
      var sortAliases = {
        datepublished: 'createdAt',
        published: 'createdAt',
        date_published: 'createdAt',
        totaldownloads: 'downloads',
        total_downloads: 'downloads',
        uniquedownloads: 'downloads',
        endorsed: 'endorsements',
        endorsement: 'endorsements',
        title: 'name',
        size: 'fileSize',
        filesize: 'fileSize',
      };
      sortField = sortAliases[sortField.toLowerCase()] || sortField;
      var sortWhitelist = {
        createdAt: true,
        updatedAt: true,
        downloads: true,
        uniqueDownloads: true,
        endorsements: true,
        name: true,
        fileSize: true,
        lastComment: true,
      };
      if (/^(random|surprise|shuffle)$/i.test(sortField)) {
        variables.sort = [{ random: { seed: enhancer.randomSortSeed || Math.floor(Math.random() * 0x7fffffff) } }];
        enhancer.randomSortSeed = variables.sort[0].random.seed;
      } else if (sortWhitelist[sortField]) {
        variables.sort = [{ [sortField]: { direction: ctx.sortDirection === 'ASC' ? 'ASC' : 'DESC' } }];
      }
    }

    if (ctx.description) {
      variables.filter.description = [{ op: 'MATCHES', value: String(ctx.description) }];
    }

    applyNexusUrlNumericFilters(variables.filter);

    return variables;
  }

  function runModsListingGraphql(variables) {
    var query = [
      'query ModsListing($count: Int = 0, $facets: ModsFacet, $filter: ModsFilter, $offset: Int, $postFilter: ModsFilter, $sort: [ModsSort!]) {',
      '  mods(count: $count, facets: $facets, filter: $filter, offset: $offset, postFilter: $postFilter, sort: $sort, viewUserBlockedContent: false) {',
      '    nodes { adultContent createdAt downloads endorsements fileSize game { domainName id name } modCategory { categoryId name } modId name status summary thumbnailUrl uid updatedAt uploader { avatar memberId name } viewerDownloaded viewerEndorsed viewerTracked viewerUpdateAvailable }',
      '    totalCount',
      '  }',
      '}',
    ].join('\n');

    return graphqlRequest(query, variables, 'ModsListing').then(function (payload) {
      if (payload && payload.errors && payload.errors.length) {
        return null;
      }
      var data = payload && payload.data && payload.data.mods;
      if (!data || !Array.isArray(data.nodes)) {
        return null;
      }
      if (typeof data.totalCount === 'number' && data.totalCount > 0) {
        if (isNexusFilteredBrowse()) {
          if (!hasNumericNexusBrowseFilters()) {
            mergeNexusFilteredResultsTotal(data.totalCount);
            var filteredTotal = getLockedNexusFilteredDisplayTotal();
            if (filteredTotal > 0) {
              enhancer.nexusCatalogTotal = filteredTotal;
            }
          }
        } else {
          enhancer.nexusCatalogTotal = data.totalCount;
        }
      }
      return { nodes: data.nodes, totalCount: data.totalCount || 0 };
    }).catch(function () {
      return null;
    });
  }

  function fetchModsListingBatch(offset, count, config) {
    var ctx = loadNexusListingContext();
    var variables = buildModsListingVariables(offset, count, ctx, config);
    return runModsListingGraphql(variables);
  }

  function fetchModsListingBatchFromPageState(offset, count) {
    if (isNexusFilteredBrowse()) {
      return runModsListingGraphql(buildFilteredBatchGraphqlVariables(offset, count, enhancer.config || {}));
    }
    var pageVars = extractNexusPageModsListingVariables();
    if (!pageVars) {
      return Promise.resolve(null);
    }
    pageVars.offset = offset;
    pageVars.count = count;
    return runModsListingGraphql(pageVars);
  }

  function resolveBrowseSortField(ctx) {
    if (!ctx || !ctx.sort) {
      return null;
    }
    var sortField = String(ctx.sort);
    var sortAliases = {
      datepublished: 'createdAt',
      published: 'createdAt',
      date_published: 'createdAt',
      totaldownloads: 'downloads',
      total_downloads: 'downloads',
      uniquedownloads: 'uniqueDownloads',
      endorsed: 'endorsements',
      endorsement: 'endorsements',
      title: 'name',
      size: 'fileSize',
      filesize: 'fileSize',
      lastcomment: 'lastComment',
    };
    return sortAliases[sortField.toLowerCase()] || sortField;
  }

  function isGraphqlSupportedBrowseSort(ctx) {
    if (!ctx || !ctx.sortExplicit || !ctx.sort) {
      return true;
    }
    var sortField = resolveBrowseSortField(ctx);
    if (/^(random|surprise|shuffle)$/i.test(sortField)) {
      return true;
    }
    var graphqlSortFields = {
      createdAt: true,
      updatedAt: true,
      downloads: true,
      uniqueDownloads: true,
      endorsements: true,
      name: true,
      fileSize: true,
      lastComment: true,
    };
    return !!graphqlSortFields[sortField];
  }

  function shouldPreferSoftNexusPagination(ctx) {
    ctx = ctx || loadNexusListingContext();
    return !isGraphqlSupportedBrowseSort(ctx);
  }

  function getNativePoolStorageKey() {
    return 'vortex-enhanced-native-pool:' + getBrowseSessionKey();
  }

  function getDismissedPoolStorageKey() {
    return 'vortex-enhanced-dismissed-pool:' + getBrowseSessionKey();
  }

  function saveDismissedBrowsePoolSnapshot(config) {
    if (!isDismissedCarouselBrowseMode(config)) {
      return;
    }
    var cards = collectCards(config);
    if (!cards || cards.length < 1) {
      return;
    }
    var snapshot = {
      sessionKey: getBrowseSessionKey(),
      globalPageIndex: enhancer.globalPageIndex || 0,
      catalogModOffset: enhancer.catalogModOffset || 0,
      fetchedPages: enhancer.fetchedNexusPages || {},
      entries: [],
    };
    for (var i = 0; i < cards.length; i++) {
      var cardEntry = cards[i];
      if (!cardEntry || !cardEntry.modId) {
        continue;
      }
      snapshot.entries.push({
        modId: cardEntry.modId,
        catalogIndex: resolveCatalogIndex(cardEntry.card, cardEntry.modId),
      });
    }
    if (!snapshot.entries.length) {
      return;
    }
    try {
      sessionStorage.setItem(getDismissedPoolStorageKey(), JSON.stringify(snapshot));
    } catch (errSaveDismissedPool) {
      // ignore quota / private mode
    }
  }

  function restoreDismissedBrowsePoolSnapshot(config) {
    var raw = null;
    try {
      raw = sessionStorage.getItem(getDismissedPoolStorageKey());
    } catch (errReadDismissedPool) {
      return Promise.resolve(false);
    }
    if (!raw) {
      return Promise.resolve(false);
    }

    var snapshot = null;
    try {
      snapshot = JSON.parse(raw);
    } catch (errParseDismissedPool) {
      try {
        sessionStorage.removeItem(getDismissedPoolStorageKey());
      } catch (errRemoveDismissedPool) {
        // ignore
      }
      return Promise.resolve(false);
    }

    if (!snapshot || snapshot.sessionKey !== getBrowseSessionKey() ||
        !snapshot.entries || !snapshot.entries.length) {
      try {
        sessionStorage.removeItem(getDismissedPoolStorageKey());
      } catch (errRemoveDismissedPool2) {
        // ignore
      }
      return Promise.resolve(false);
    }

    if (typeof snapshot.catalogModOffset === 'number' && snapshot.catalogModOffset >= 0) {
      enhancer.catalogModOffset = snapshot.catalogModOffset;
    }
    enhancer.fetchedNexusPages = snapshot.fetchedPages || {};

    var modIds = [];
    for (var i = 0; i < snapshot.entries.length; i++) {
      if (snapshot.entries[i] && snapshot.entries[i].modId) {
        modIds.push(snapshot.entries[i].modId);
      }
    }
    if (!modIds.length) {
      return Promise.resolve(false);
    }

    return fetchModsByUidForTiles(modIds, config).then(function (nodes) {
      if (!nodes || !nodes.length) {
        return false;
      }
      var byModId = {};
      for (var n = 0; n < nodes.length; n++) {
        if (nodes[n] && nodes[n].modId != null) {
          byModId[String(nodes[n].modId)] = nodes[n];
        }
      }

      var tiles = [];
      for (var j = 0; j < snapshot.entries.length; j++) {
        var entry = snapshot.entries[j];
        var node = byModId[String(entry.modId)];
        if (!node) {
          continue;
        }
        var tile = buildGraphQLModTile(node);
        if (typeof entry.catalogIndex === 'number') {
          tile.setAttribute('data-vortex-catalog-index', String(entry.catalogIndex));
          rememberCatalogIndex(entry.modId, entry.catalogIndex);
        }
        tiles.push(tile);
      }

      if (!tiles.length) {
        return false;
      }

      var added = appendFetchedTilesToPool(tiles, config);
      if (added > 0) {
        try {
          sessionStorage.removeItem(getDismissedPoolStorageKey());
        } catch (errRemoveDismissedPool3) {
          // ignore
        }
      }
      return added > 0;
    }).catch(function () {
      return false;
    });
  }

  function clampDismissedCarouselPageToLoadedCatalog(config) {
    if (!isPooledNexusCarouselBrowseMode(config)) {
      return false;
    }
    if (isFilteredBrowsePagingLocked({}) || enhancer.fetchInFlightPage || enhancer.nativeNavFetchInFlight ||
        enhancer.dismissedBatchPrefetchInFlight || enhancer.carouselAdvancePending) {
      return false;
    }
    var pageSize = getCarouselPageSize(config);
    var catalogCount = getVisibleCarouselCatalogCount(config);
    if (catalogCount <= 0) {
      if ((enhancer.globalPageIndex || 0) > 0) {
        enhancer.globalPageIndex = 0;
        enhancer.batchPageIndex = 0;
        enhancer.lastAppliedSliceKey = '';
        saveCarouselPagingState();
        return true;
      }
      return false;
    }
    var maxFullPage = getMaxFullCarouselPageIndex(pageSize, catalogCount);
    var currentPage = enhancer.globalPageIndex || 0;
    if (currentPage > maxFullPage ||
        !carouselPageFullyLoaded(currentPage, catalogCount, pageSize)) {
      enhancer.globalPageIndex = maxFullPage;
      enhancer.batchPageIndex = maxFullPage;
      enhancer.lastAppliedSliceKey = '';
      saveCarouselPagingState();
      return true;
    }
    return false;
  }

  function saveNativePoolSnapshot(config) {
    if (!config) {
      return;
    }
    if (urlHasActiveNexusFilters() && !filteredBrowseHasEnoughCatalog(config)) {
      return;
    }
    var cards = collectCards(config);
    var snapshot = {
      sessionKey: getBrowseSessionKey(),
      globalPageIndex: enhancer.globalPageIndex || 0,
      catalogModOffset: enhancer.catalogModOffset || 0,
      fetchedPages: enhancer.fetchedNexusPages || {},
      nativeMergedPages: enhancer.nativeMergedPages || {},
      pendingPage: enhancer.nativeNavFetchTargetPage || null,
      entries: [],
    };
    for (var i = 0; i < cards.length; i++) {
      var cardEntry = cards[i];
      if (!cardEntry || !cardEntry.modId) {
        continue;
      }
      snapshot.entries.push({
        modId: cardEntry.modId,
        catalogIndex: resolveCatalogIndex(cardEntry.card, cardEntry.modId),
      });
    }
    try {
      sessionStorage.setItem(getNativePoolStorageKey(), JSON.stringify(snapshot));
    } catch (errSavePool) {
      // ignore quota / private mode
    }
  }

  function restoreNativePoolSnapshot(config) {
    var raw = null;
    try {
      raw = sessionStorage.getItem(getNativePoolStorageKey());
    } catch (errReadPool) {
      return Promise.resolve(false);
    }
    if (!raw) {
      return Promise.resolve(false);
    }

    var snapshot = null;
    try {
      snapshot = JSON.parse(raw);
    } catch (errParsePool) {
      try {
        sessionStorage.removeItem(getNativePoolStorageKey());
      } catch (errRemovePool) {
        // ignore
      }
      return Promise.resolve(false);
    }

    if (!snapshot || snapshot.sessionKey !== getBrowseSessionKey() || !snapshot.entries || !snapshot.entries.length) {
      try {
        sessionStorage.removeItem(getNativePoolStorageKey());
      } catch (errRemovePool2) {
        // ignore
      }
      return Promise.resolve(false);
    }

    if (typeof snapshot.globalPageIndex === 'number' && snapshot.globalPageIndex >= 0) {
      enhancer.globalPageIndex = snapshot.globalPageIndex;
    }
    if (typeof snapshot.catalogModOffset === 'number' && snapshot.catalogModOffset >= 0) {
      enhancer.catalogModOffset = snapshot.catalogModOffset;
    }
    enhancer.fetchedNexusPages = snapshot.fetchedPages || {};
    enhancer.nativeMergedPages = snapshot.nativeMergedPages || {};

    var modIds = [];
    for (var i = 0; i < snapshot.entries.length; i++) {
      if (snapshot.entries[i] && snapshot.entries[i].modId) {
        modIds.push(snapshot.entries[i].modId);
      }
    }
    if (!modIds.length) {
      return Promise.resolve(false);
    }

    return fetchModsByUidForTiles(modIds, config).then(function (nodes) {
      if (!nodes || !nodes.length) {
        return false;
      }
      var byModId = {};
      for (var n = 0; n < nodes.length; n++) {
        if (nodes[n] && nodes[n].modId != null) {
          byModId[String(nodes[n].modId)] = nodes[n];
        }
      }

      var tiles = [];
      for (var j = 0; j < snapshot.entries.length; j++) {
        var entry = snapshot.entries[j];
        var node = byModId[String(entry.modId)];
        if (!node) {
          continue;
        }
        var tile = buildGraphQLModTile(node);
        if (typeof entry.catalogIndex === 'number') {
          tile.setAttribute('data-vortex-catalog-index', String(entry.catalogIndex));
          rememberCatalogIndex(entry.modId, entry.catalogIndex);
        }
        tiles.push(tile);
      }

      if (!tiles.length) {
        return false;
      }

      enhancer.tilePool = enhancer.tilePool || [];
      var added = appendFetchedTilesToPool(tiles, config);
      if (typeof snapshot.pendingPage === 'number' && snapshot.pendingPage > 0) {
        markNativeMergedPage(snapshot.pendingPage);
      }
      if (added > 0) {
        try {
          sessionStorage.removeItem(getNativePoolStorageKey());
        } catch (errRemovePool3) {
          // ignore
        }
      }
      return added > 0;
    }).catch(function () {
      return false;
    });
  }

  function markNativeMergedPage(pageNum) {
    if (!pageNum || pageNum < 1) {
      return;
    }
    enhancer.nativeMergedPages = enhancer.nativeMergedPages || {};
    enhancer.nativeMergedPages[pageNum] = true;
    enhancer.fetchedNexusPages = enhancer.fetchedNexusPages || {};
    enhancer.fetchedNexusPages[pageNum] = true;
  }

  function finishNativeNavFetch(ok) {
    var resolve = enhancer.nativeNavFetchResolver;
    enhancer.nativeNavFetchResolver = null;
    enhancer.nativeNavFetchInFlight = false;
    enhancer.pendingNativeCatalogFetch = false;
    enhancer.pendingPoolFetch = false;
    if (resolve) {
      resolve(!!ok);
    }
  }

  function mergeLiveGridIntoPool(config) {
    var live = collectLiveGridCards(config);
    if (!live.length) {
      return 0;
    }
    var before = enhancer.tilePool.length;
    mergeTilesIntoPool(live, config);
    return Math.max(0, enhancer.tilePool.length - before);
  }

  function fetchNativeNexusResultsPageViaNavigation(pageNum, config, options) {
    options = options || {};
    var hardNavigation = options.hardNavigation !== false;
    if (!pageNum || pageNum < 2) {
      return Promise.resolve(false);
    }
    if (enhancer.fetchedNexusPages && enhancer.fetchedNexusPages[pageNum]) {
      return Promise.resolve(true);
    }
    if (enhancer.nativeNavFetchInFlight) {
      return Promise.resolve(false);
    }

    var currentUrlPage = getNexusResultsPageFromUrl();
    if (pageNum === currentUrlPage) {
      var mergedNow = mergeLiveGridIntoPool(config);
      if (mergedNow > 0 || collectLiveGridCards(config).length > 0) {
        markNativeMergedPage(pageNum);
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    }

    if (pageNum !== currentUrlPage + 1) {
      return Promise.resolve(false);
    }

    mergeLiveGridIntoPool(config);
    enhancer.nativeNavFetchInFlight = true;
    enhancer.nativeNavFetchTargetPage = pageNum;
    enhancer.pendingNativeCatalogFetch = true;
    enhancer.pendingPoolFetch = true;
    saveCarouselPagingState();

    var startLive = collectLiveGridCards(config);
    var startKey = '';
    for (var sk = 0; sk < startLive.length; sk++) {
      if (startLive[sk].modId) {
        startKey += (startKey ? ',' : '') + startLive[sk].modId;
      }
    }
    enhancer.nativeNavFetchStartKey = startKey;

    return new Promise(function (resolve) {
      enhancer.nativeNavFetchResolver = resolve;
      enhancer.nativeNavFetchDeadline = Date.now() + 45000;

      var navigated = navigateNexusResultsPageSoft(1, {
        forceSoft: options.forceSoftNavigation || urlHasActiveNexusFilters(),
      });
      if (!navigated) {
        var pageLink = findNexusPaginationPageLink(pageNum);
        if (pageLink) {
          enhancer.allowNexusPaginationClick = true;
          try {
            pageLink.click();
            navigated = true;
          } catch (errPageLink) {
            navigated = false;
          }
          setTimeout(function () {
            enhancer.allowNexusPaginationClick = false;
          }, 0);
        }
      }
      if (!navigated) {
        navigated = navigateNexusResultsPage(1);
      }
      if (!navigated) {
        if (!hardNavigation) {
          finishNativeNavFetch(false);
          return;
        }
        saveNativePoolSnapshot(config);
        try {
          window.location.assign(buildNexusResultsPageUrl(pageNum));
        } catch (errNav) {
          finishNativeNavFetch(false);
          return;
        }
      }

      var pollId = setInterval(function () {
        if (!enhancer.nativeNavFetchResolver) {
          clearInterval(pollId);
          return;
        }
        if (Date.now() > (enhancer.nativeNavFetchDeadline || 0)) {
          clearInterval(pollId);
          finishNativeNavFetch(false);
          return;
        }

        var cfg = enhancer.config;
        if (!cfg) {
          return;
        }

        var liveCards = collectLiveGridCards(cfg);
        if (liveCards.length < 8) {
          return;
        }

        var liveKey = '';
        for (var lk = 0; lk < liveCards.length; lk++) {
          if (liveCards[lk].modId) {
            liveKey += (liveKey ? ',' : '') + liveCards[lk].modId;
          }
        }

        var urlPage = getNexusResultsPageFromUrl();
        var contentChanged = !!liveKey && liveKey !== (enhancer.nativeNavFetchStartKey || '');
        if (!contentChanged && urlPage < pageNum) {
          return;
        }

        clearInterval(pollId);
        var added = mergeLiveGridIntoPool(cfg);
        var ok = added > 0 || (contentChanged && liveCards.length > 0);
        if (ok) {
          markNativeMergedPage(pageNum);
        }
        finishNativeNavFetch(ok);
        if (ok && window.__vortexBrowseEnhancer) {
          window.__vortexBrowseEnhancer.scheduleScan(true);
        }
      }, 250);
    });
  }

  function fetchNativeNexusResultsPage(pageNum, config, options) {
    options = options || {};
    var allowNavigation = options.allowNavigation;
    var allowSoftNavigation = allowNavigation === true || allowNavigation === 'soft';
    var allowHardNavigation = allowNavigation === true;
    if (!pageNum || pageNum < 2) {
      return Promise.resolve(false);
    }
    if (enhancer.fetchedNexusPages && enhancer.fetchedNexusPages[pageNum]) {
      if (urlHasActiveNexusFilters() && pageNum === 2 && !filteredBrowseHasEnoughCatalog(config)) {
        delete enhancer.fetchedNexusPages[pageNum];
      } else {
        return Promise.resolve(true);
      }
    }

    var url = buildNexusResultsPageUrl(pageNum);
    if (options.ignoreNumericFilters) {
      try {
        var batchUrl = new URL(url, window.location.href);
        batchUrl.searchParams.delete('maxDownloads');
        batchUrl.searchParams.delete('minDownloads');
        batchUrl.searchParams.delete('maxEndorsements');
        batchUrl.searchParams.delete('minEndorsements');
        url = batchUrl.toString();
      } catch (errBatchUrl) {
        // Keep the constructed URL if URL normalization is unavailable.
      }
    }
    var fetchController = typeof AbortController === 'function'
      ? new AbortController()
      : null;
    var fetchTimeout = setTimeout(function () {
      if (fetchController) {
        fetchController.abort();
      }
    }, 2500);
    return fetch(url, {
      credentials: 'include',
      headers: { Accept: 'text/html,application/xhtml+xml' },
      signal: fetchController ? fetchController.signal : undefined,
    }).then(function (response) {
      if (!response || !response.ok) {
        return null;
      }
      return response.text();
    }).then(function (html) {
      clearTimeout(fetchTimeout);
      if (!html) {
        return false;
      }
      var tiles = parseModTilesFromHtml(html, url, config);
      if (!tiles || tiles.length === 0) {
        return false;
      }
      if (urlHasActiveNexusFilters() && !options.ignoreNumericFilters) {
        tiles = filterFreshTileElements(tiles, config, { minFresh: 4, allowFallback: false });
      }
      if (!tiles || tiles.length === 0) {
        return false;
      }
      var added = appendFetchedTilesToPool(tiles, config);
      if (added <= 0) {
        return false;
      }
      markNativeMergedPage(pageNum);
      if (urlHasActiveNexusFilters()) {
        enhancer.lastAppliedSliceKey = '';
      }
      return true;
    }).catch(function () {
      clearTimeout(fetchTimeout);
      return false;
    }).then(function (ok) {
      if (ok) {
        return true;
      }
      if (!allowSoftNavigation) {
        return false;
      }
      return fetchNativeNexusResultsPageViaNavigation(pageNum, config, {
        hardNavigation: allowHardNavigation,
      });
    });
  }

  function resolveFilteredBatchNavigationMode(allowNavigation) {
    if (allowNavigation === true || allowNavigation === 'soft') {
      return allowNavigation;
    }
    if (allowNavigation === false) {
      return false;
    }
    if (urlHasActiveNexusFilters()) {
      return 'soft';
    }
    return false;
  }

  function ensureFilteredBrowseOnPageOne() {
    if (getNexusResultsPageFromUrl() <= 1) {
      return Promise.resolve(true);
    }
    return new Promise(function (resolve) {
      var navigated = withNexusPaginationUnhidden(function () {
        var pageOne = findNexusPaginationPageLink(1);
        if (pageOne) {
          enhancer.allowNexusPaginationClick = true;
          try {
            pageOne.click();
          } catch (clickErr) {
            enhancer.allowNexusPaginationClick = false;
            return navigateNexusResultsPageSoft(-1, { forceSoft: true });
          }
          setTimeout(function () {
            enhancer.allowNexusPaginationClick = false;
          }, 0);
          return true;
        }
        return navigateNexusResultsPageSoft(-1, { forceSoft: true });
      });
      if (!navigated) {
        resolve(false);
        return;
      }
      var deadline = Date.now() + 12000;
      var pollId = setInterval(function () {
        if (getNexusResultsPageFromUrl() <= 1) {
          clearInterval(pollId);
          resolve(true);
          return;
        }
        if (Date.now() > deadline) {
          clearInterval(pollId);
          resolve(false);
        }
      }, 200);
    });
  }

  function withNexusPaginationUnhidden(fn) {
    var hidden = document.querySelectorAll('.vortex-enhanced-nexus-pagination-hide');
    var restored = [];
    for (var i = 0; i < hidden.length; i++) {
      hidden[i].classList.remove('vortex-enhanced-nexus-pagination-hide');
      restored.push(hidden[i]);
    }
    try {
      return fn();
    } finally {
      for (var j = 0; j < restored.length; j++) {
        restored[j].classList.add('vortex-enhanced-nexus-pagination-hide');
      }
    }
  }

  function navigateFilteredBrowseBatchPageSoft(pageNum) {
    return withNexusPaginationUnhidden(function () {
      var pageLink = findNexusPaginationPageLink(pageNum);
      if (pageLink) {
        enhancer.pendingPoolFetch = true;
        saveCarouselPagingState();
        enhancer.allowNexusPaginationClick = true;
        try {
          pageLink.click();
        } catch (clickErr) {
          enhancer.allowNexusPaginationClick = false;
          return false;
        }
        setTimeout(function () {
          enhancer.allowNexusPaginationClick = false;
        }, 0);
        return true;
      }
      return navigateNexusResultsPageSoft(1, { forceSoft: true });
    });
  }

  function returnFilteredBrowseToPageOne() {
    return ensureFilteredBrowseOnPageOne();
  }

  function fetchFilteredBrowseBatchViaSoftNav(pageNum, config) {
    if (!pageNum || pageNum < 2 || !browseUsesFilteredCatalogPaging()) {
      return Promise.resolve(false);
    }
    if (enhancer.nativeNavFetchInFlight) {
      return Promise.resolve(false);
    }
    var minFreshTiles = 4;

    return ensureFilteredBrowsePageOnePooled(config).then(function (seeded) {
      if (!seeded) {
        return false;
      }
      var startIds = collectLiveModIdSet(config);
      enhancer.nativeNavFetchInFlight = true;
      enhancer.pendingNativeCatalogFetch = true;
      enhancer.pendingPoolFetch = true;

      return new Promise(function (resolve) {
        var navigated = navigateFilteredBrowseBatchPageSoft(pageNum);
        if (!navigated) {
          finishNativeNavFetch(false);
          resolve(false);
          return;
        }
        var deadline = Date.now() + 8000;
        var pollId = setInterval(function () {
          if (Date.now() > deadline) {
            clearInterval(pollId);
            returnFilteredBrowseToPageOne();
            finishNativeNavFetch(false);
            resolve(false);
            return;
          }
          var cfg = enhancer.config || config;
          var urlPage = getNexusResultsPageFromUrl();
          var liveCards = collectLiveGridCards(cfg);
          if (liveCards.length < minFreshTiles && urlPage < pageNum) {
            return;
          }
          var added = mergeLiveGridIntoPool(cfg);
          if (added < minFreshTiles) {
            var freshTiles = [];
            for (var i = 0; i < liveCards.length; i++) {
              var modId = liveCards[i].modId;
              if (modId && !startIds[String(modId)]) {
                var clone = liveCards[i].card.cloneNode(true);
                clone.setAttribute('data-vortex-pool-tile', 'true');
                freshTiles.push(clone);
              }
            }
            if (freshTiles.length >= minFreshTiles) {
              added = appendFetchedTilesToPool(freshTiles, cfg);
            }
          }
          if (added < minFreshTiles) {
            return;
          }
          clearInterval(pollId);
          var ok = added >= minFreshTiles;
          if (ok) {
            markNativeMergedPage(pageNum);
            enhancer.lastAppliedSliceKey = '';
            enhancer.fetchedNexusPages = enhancer.fetchedNexusPages || {};
            enhancer.fetchedNexusPages[pageNum] = true;
          }
          returnFilteredBrowseToPageOne().then(function () {
            finishNativeNavFetch(ok);
            if (ok && window.__vortexBrowseEnhancer) {
              mergeFilteredPoolIntoCarouselCatalog(enhancer.config || config);
            }
            resolve(ok);
          });
        }, 250);
      });
    });
  }

  function fetchFilteredBrowseBatchPage(pageNum, config, offset, allowNavigation, finishBatchFetch, appendGraphqlBatchResult) {
    ensureFilteredBrowsePoolSeeded(config);
    var freshOpts = { minFresh: 1, allowFallback: true };

    function processGraphqlResult(pageResult) {
      if (!pageResult || !pageResult.nodes || !pageResult.nodes.length) {
        return false;
      }
      var nodes = filterFreshGraphqlNodes(pageResult.nodes, config, freshOpts);
      if (nodes.length < freshOpts.minFresh) {
        return false;
      }
      if (appendGraphqlBatchResult({ nodes: nodes, totalCount: pageResult.totalCount })) {
        return finishBatchFetch(true);
      }
      return false;
    }

    function tryGraphqlBatch() {
      return fetchModsListingBatchFromPageState(offset, 80).then(function (pageResult) {
        if (pageResult && pageResult.nodes && pageResult.nodes.length) {
          return processGraphqlResult(pageResult);
        }
        var variables = buildFilteredBatchGraphqlVariables(offset, 80, config);
        return runModsListingGraphql(variables).then(processGraphqlResult);
      });
    }

    function tryHostNavBatch() {
      return fetchFilteredBrowseBatchViaHostNav(pageNum, config).then(finishBatchFetch);
    }

    function tryNativeNavBatch() {
      return fetchFilteredBrowseBatchViaSoftNav(pageNum, config).then(finishBatchFetch);
    }

    function tryHtmlBatch() {
      return fetchNativeNexusResultsPage(pageNum, config, { allowNavigation: allowNavigation || 'soft' }).then(function (htmlOk) {
        if (htmlOk) {
          return finishBatchFetch(true);
        }
        return false;
      });
    }

    return ensureFilteredBrowsePageOnePooled(config).then(function (seeded) {
      if (!seeded) {
        return false;
      }
      return tryGraphqlBatch().then(function (graphqlOk) {
        if (graphqlOk) {
          return true;
        }
        return tryHostNavBatch().then(function (hostOk) {
          if (hostOk) {
            return true;
          }
          return tryHtmlBatch().then(function (htmlOk) {
            if (htmlOk) {
              return true;
            }
            return tryNativeNavBatch();
          });
        });
      });
    });
  }

  function fetchFilteredOrDefaultNexusBatchPage(pageNum, config, offset, allowNavigation, finishBatchFetch, appendGraphqlBatchResult) {
    if (browseUsesFilteredCatalogPaging()) {
      return fetchFilteredBrowseBatchPage(
        pageNum,
        config,
        offset,
        allowNavigation,
        finishBatchFetch,
        appendGraphqlBatchResult
      );
    }
    var navMode = resolveFilteredBatchNavigationMode(allowNavigation);
    return fetchModsListingBatch(offset, 80, config).then(function (result) {
      if (appendGraphqlBatchResult(result)) {
        return finishBatchFetch(true);
      }
      return fetchNativeNexusResultsPage(pageNum, config, { allowNavigation: navMode }).then(function (nativeOk) {
        if (nativeOk) {
          return finishBatchFetch(true);
        }
        if (!navMode) {
          return finishBatchFetch(false);
        }
        return fetchNativeNexusResultsPageViaNavigation(pageNum, config, {
          hardNavigation: navMode === true,
        }).then(finishBatchFetch);
      });
    });
  }

  function fetchNexusBatchPage(pageNum, config, options) {
    options = options || {};
    var allowNavigation = options.allowNavigation !== false;
    if (config && config.onlyTracked) {
      return Promise.resolve(false);
    }
    if (!pageNum || pageNum < 2) {
      return Promise.resolve(false);
    }
    enhancer.fetchedNexusPages = enhancer.fetchedNexusPages || {};
    if (enhancer.fetchedNexusPages[pageNum]) {
      if (urlHasActiveNexusFilters() && pageNum === 2 && !filteredBrowseHasEnoughCatalog(config)) {
        delete enhancer.fetchedNexusPages[pageNum];
      } else {
        return Promise.resolve(true);
      }
    }
    if (enhancer.fetchInFlightPage === pageNum) {
      return Promise.resolve(false);
    }

    enhancer.fetchInFlightPage = pageNum;
    var ctx = loadNexusListingContext();
    var offset = (pageNum - 1) * 80;

    function finishBatchFetch(ok) {
      enhancer.fetchInFlightPage = null;
      return !!ok;
    }

    function appendGraphqlBatchResult(result) {
      if (!result || !result.nodes || result.nodes.length === 0) {
        return false;
      }
      var nodes = browseUsesFilteredCatalogPaging()
        ? filterFreshGraphqlNodes(result.nodes, config, { minFresh: 4, allowFallback: false })
        : result.nodes;
      if (browseUsesFilteredCatalogPaging() && nodes.length < 4) {
        return false;
      }
      var tiles = [];
      for (var i = 0; i < nodes.length; i++) {
        tiles.push(buildGraphQLModTile(nodes[i]));
      }
      var added = appendFetchedTilesToPool(tiles, config);
      if (added <= 0) {
        return false;
      }
      enhancer.fetchedNexusPages[pageNum] = true;
      if (browseUsesFilteredCatalogPaging()) {
        enhancer.lastAppliedSliceKey = '';
      }
      return true;
    }

    return fetchFilteredOrDefaultNexusBatchPage(
      pageNum,
      config,
      offset,
      allowNavigation,
      finishBatchFetch,
      appendGraphqlBatchResult
    );
  }

  function needsUpcomingBatchFetch(visibleCount, pageSize) {
    var catalogAvailable = getCatalogAvailableCount(visibleCount);
    if (!usesMergedCarouselPool()) {
      return ((enhancer.globalPageIndex || 0) + 1) * pageSize >= catalogAvailable;
    }
    var needForNextPage = (enhancer.globalPageIndex + 1) * pageSize;
    var needForPageAfterNext = (enhancer.globalPageIndex + 2) * pageSize;
    var needEarly = (enhancer.globalPageIndex + 3) * pageSize;
    var needForFullPageFour = 4 * pageSize;
    return needForNextPage > catalogAvailable ||
      needForPageAfterNext > catalogAvailable ||
      needEarly > catalogAvailable ||
      catalogAvailable < needForFullPageFour;
  }

  function filteredBrowseNeedsMoreCatalogPages(config) {
    config = config || enhancer.config || {};
    if (!isFilteredBrowseSession(config)) {
      return false;
    }
    var pageSize = getCarouselPageSize(config);
    var visibleCount = getVisibleCarouselCatalogCount(config);
    var needForNext = (enhancer.globalPageIndex + 1) * pageSize;
    return visibleCount < needForNext;
  }

  function getNextUnfetchedNexusPage() {
    if (browseUsesFilteredCatalogPaging()) {
      clearStaleFilteredBatchFetchFlags();
      if (!filteredBrowseHasEnoughCatalog() || filteredBrowseNeedsMoreCatalogPages()) {
        var forcedPage = getNextNexusPageToFetch();
        if (forcedPage > getNexusResultsPageFromUrl()) {
          return forcedPage;
        }
        return 2;
      }
    }
    var nextPage = getNextNexusPageToFetch();
    return nextPage > getNexusResultsPageFromUrl() ? nextPage : null;
  }

  function maybePrefetchNextBatch(config, cards) {
    if (config && config.onlyTracked) {
      return;
    }
    if (urlHasActiveNexusFilters() && (enhancer.globalPageIndex || 0) < 2) {
      return;
    }
    if (isCarouselQuietPeriod()) {
      return;
    }
    if (enhancer.pendingPoolFetch || enhancer.pendingNexusBatchAdvance || enhancer.fetchInFlightPage ||
        enhancer.nativeNavFetchInFlight || enhancer.pendingNativeCatalogFetch) {
      return;
    }
    if (isPooledNexusCarouselBrowseMode(config)) {
      maybePrefetchDismissedLiveBatch(config);
      return;
    }

    var pageSize = getCarouselPageSize(config);
    applyFilters(cards, config);
    var visible = getVisibleCarouselCards(cards);
    if (!needsUpcomingBatchFetch(visible.length, pageSize)) {
      return;
    }

    var nextPage = getNextUnfetchedNexusPage();
    if (!nextPage) {
      return;
    }

    fetchNexusBatchPage(nextPage, config, { allowNavigation: false }).then(function (ok) {
      if (ok) {
        enhancer.scheduleScan(true);
      }
    });
  }

  function beginNexusBatchFetch(config, options) {
    if (config && config.onlyTracked) {
      return Promise.resolve(false);
    }
    var nextPage = getNextUnfetchedNexusPage();
    if (!nextPage) {
      return Promise.resolve(false);
    }
    return fetchNexusBatchPage(nextPage, config, options);
  }

  function findNexusModGridFromTiles() {
    var tiles = findModTiles();
    if (tiles.length === 0) {
      return null;
    }

    var parent = tiles[0].parentElement;
    if (parent && parent.id === 'vortex-enhanced-catalog-grid') {
      return null;
    }
    if (parent && parent.classList && parent.classList.contains('mods-grid')) {
      return parent;
    }

    if (parent) {
      var directTiles = parent.querySelectorAll(':scope > [data-e2eid="mod-tile"]');
      if (directTiles.length >= 1) {
        return parent;
      }
    }

    var el = tiles[0].parentElement;
    while (el) {
      if (el.id === 'vortex-enhanced-catalog-grid') {
        return null;
      }
      var nested = el.querySelectorAll('[data-e2eid="mod-tile"]');
      if (nested.length >= 1) {
        return el;
      }
      el = el.parentElement;
    }

    return null;
  }

  function resolveNexusModGridElement() {
    var marked = document.querySelector('.vortex-enhanced-nexus-grid');
    if (marked && marked.id !== 'vortex-enhanced-catalog-grid') {
      enhancer.nexusModGridRef = marked;
      return marked;
    }
    if (enhancer.nexusModGridRef && document.body.contains(enhancer.nexusModGridRef)) {
      return enhancer.nexusModGridRef;
    }
    var fromTiles = findNexusModGridFromTiles();
    if (fromTiles) {
      fromTiles.classList.add('vortex-enhanced-nexus-grid');
      enhancer.nexusModGridRef = fromTiles;
      return fromTiles;
    }
    var host = document.querySelector('.vortex-enhanced-carousel-host');
    if (host) {
      var candidate = host.querySelector('.mods-grid, .vortex-enhanced-nexus-grid');
      if (candidate && candidate.id !== 'vortex-enhanced-catalog-grid') {
        candidate.classList.add('vortex-enhanced-nexus-grid');
        enhancer.nexusModGridRef = candidate;
        return candidate;
      }
    }
    return null;
  }

  function findNexusModGrid() {
    return resolveNexusModGridElement();
  }

  function applyGridLayoutStyles(grid, config) {
    if (!grid || !config) {
      return;
    }
    grid.classList.remove('vortex-enhanced-compact-tile');
    grid.classList.add('vortex-enhanced-grid-layout');
    var cols = config.gridColumns || 8;
    var rows = config.gridRows || 3;
    grid.style.setProperty('--vortex-grid-cols', String(cols));
    grid.style.setProperty('--vortex-grid-rows', String(rows));
    var cardHeight = Math.max(140, Math.min(492, Math.floor((window.innerHeight - 126) / rows)));
    grid.style.setProperty('--vortex-card-height', String(cardHeight) + 'px');
    grid.style.setProperty('--vortex-thumb-height', String(Math.max(145, Math.round(cardHeight * 0.36))) + 'px');
  }

  function ensureCatalogDisplayGrid(config) {
    var nexusGrid = findNexusModGrid();
    var host = document.querySelector('.vortex-enhanced-carousel-host');
    if (!host && nexusGrid && nexusGrid.parentElement) {
      host = nexusGrid.parentElement;
      host.classList.add('vortex-enhanced-carousel-host');
    }
    if (!host) {
      return null;
    }

    var catalogGrid = document.getElementById('vortex-enhanced-catalog-grid');
    if (!catalogGrid) {
      catalogGrid = document.createElement('div');
      catalogGrid.id = 'vortex-enhanced-catalog-grid';
      catalogGrid.setAttribute('data-vortex-enhanced-catalog-grid', 'true');
      catalogGrid.className = 'vortex-enhanced-grid-layout vortex-enhanced-catalog-grid';
      if (nexusGrid && nexusGrid.parentElement === host) {
        host.insertBefore(catalogGrid, nexusGrid.nextSibling);
      } else {
        host.appendChild(catalogGrid);
      }
    }

    if (nexusGrid) {
      nexusGrid.classList.add('vortex-enhanced-nexus-grid');
    }
    applyGridLayoutStyles(catalogGrid, config);
    return catalogGrid;
  }

  function setLocalCatalogDisplayActive(active) {
    var host = document.querySelector('.vortex-enhanced-carousel-host');
    var catalogGrid = document.getElementById('vortex-enhanced-catalog-grid');
    var nexusGrid = resolveNexusModGridElement();
    if (host) {
      host.classList.toggle('vortex-enhanced-local-catalog-active', !!active);
    }
    if (catalogGrid) {
      catalogGrid.style.display = active ? 'grid' : 'none';
    }
    if (nexusGrid) {
      nexusGrid.style.display = active ? 'none' : '';
    }
  }

  function getCarouselDisplayGrid(config) {
    if (config && isLocalCatalogMode(config) && enhancer.trackedCatalogActive) {
      var catalogGrid = ensureCatalogDisplayGrid(config);
      if (catalogGrid) {
        return catalogGrid;
      }
    }
    return findNexusModGrid();
  }

  function findModGrid() {
    return getCarouselDisplayGrid(enhancer.config);
  }

  function getCarouselPageSize(config) {
    var cols = config.gridColumns || 8;
    var rows = config.gridRows || 3;
    return cols * rows;
  }

  function hasClientCarouselFilters(config) {
    if (!config) {
      return false;
    }
    return !!(config.onlyInstalled || config.hideInstalled || config.hideTracked || config.onlyTracked);
  }

  function isOnlyTrackedLivePreview(config) {
    if (!config || !config.onlyTracked) {
      return false;
    }
    return !isTrackedCatalogReady(config);
  }

  function makeModUidFromConfig(config, modId) {
    return resolveModUid(config, modId);
  }

  function orderGraphqlNodesByModIds(nodes, modIds) {
    if (!nodes || nodes.length === 0 || !modIds || modIds.length === 0) {
      return nodes || [];
    }

    var byModId = {};
    nodes.forEach(function (node) {
      if (node && node.modId != null) {
        byModId[String(node.modId)] = node;
      }
    });

    var ordered = [];
    modIds.forEach(function (modId) {
      var node = byModId[String(modId)];
      if (node) {
        ordered.push(node);
      }
    });

    if (ordered.length >= nodes.length) {
      return ordered;
    }

    nodes.forEach(function (node) {
      if (!node || node.modId == null) {
        return;
      }
      if (ordered.indexOf(node) < 0) {
        ordered.push(node);
      }
    });
    return ordered;
  }

  function parseTrackedModsResponse(body, gameDomain, runtimeConfig) {
    var tracked = {};
    var items = Array.isArray(body)
      ? body
      : (body && (body.tracked_mods || body.data || body.results)) || [];
    if (!Array.isArray(items)) {
      return tracked;
    }

    var normalizedGame = String(gameDomain || '').toLowerCase();
    var cfg = runtimeConfig || enhancer.config || {};
    var expectedGameId = resolveGameNumericId(cfg);
    items.forEach(function (item) {
      if (!item) {
        return;
      }
      var modId = item.mod_id || item.modId || item.id;
      var domain = item.domain_name || item.game_domain_name || item.gameDomain || item.domain;
      var itemGameId = parseInt(String(item.game_id || item.gameId || ''), 10);
      if (!modId) {
        return;
      }
      if (expectedGameId && Number.isFinite(itemGameId) && itemGameId > 0 && itemGameId !== expectedGameId) {
        return;
      }
      if (normalizedGame && domain && String(domain).toLowerCase() !== normalizedGame) {
        return;
      }
      tracked[String(modId)] = true;
    });
    return tracked;
  }

  function syncTrackedModsFromSession(config) {
    if (enhancer.trackedSessionFetchInFlight || enhancer.trackedSessionFetched) {
      return;
    }

    enhancer.trackedSessionFetchInFlight = true;
    var gameDomain = getGameDomainFromPath();
    var urls = [
      'https://api.nexusmods.com/v1/user/tracked_mods.json',
      'https://api.nexusmods.com/v1/user/tracked_mods',
    ];

    function tryUrl(index) {
      if (index >= urls.length) {
        enhancer.trackedSessionFetchInFlight = false;
        enhancer.trackedSessionFetched = true;
        return;
      }

      fetch(urls[index], {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      }).then(function (response) {
        if (!response.ok) {
          tryUrl(index + 1);
          return null;
        }
        return response.json();
      }).then(function (body) {
        if (!body) {
          return;
        }
        var tracked = parseTrackedModsResponse(body, gameDomain, config);
        if (Object.keys(tracked).length === 0) {
          tryUrl(index + 1);
          return;
        }

        enhancer.trackedSessionFetchInFlight = false;
        enhancer.trackedSessionFetched = true;
        config.tracked = Object.assign({}, config.tracked || {}, tracked);
        sendToHost({
          type: 'track-state',
          tracked: tracked,
        });
        if (window.__vortexBrowseEnhancer) {
          window.__vortexBrowseEnhancer.scheduleScan(true);
        }
      }).catch(function () {
        tryUrl(index + 1);
      });
    }

    tryUrl(0);
  }

  function getTrackedCatalogModIds(config) {
    var ids = [];
    var tracked = config.tracked || {};
    Object.keys(tracked).forEach(function (key) {
      if (!tracked[key]) {
        return;
      }
      var modId = parseInt(key, 10);
      if (!modId || modId <= 0) {
        return;
      }
      if (config.hideInstalled && config.installed && config.installed[key]) {
        return;
      }
      if (config.onlyInstalled && !(config.installed && config.installed[key])) {
        return;
      }
      ids.push(modId);
    });
    ids.sort(function (a, b) { return a - b; });
    return ids;
  }

  function getInstalledCatalogModIds(config) {
    var ids = [];
    var installed = config.installed || {};
    Object.keys(installed).forEach(function (key) {
      var modId = parseInt(key, 10);
      if (!modId || modId <= 0) {
        return;
      }
      if (config.hideTracked && config.tracked && config.tracked[key]) {
        return;
      }
      if (config.onlyTracked && !(config.tracked && config.tracked[key])) {
        return;
      }
      ids.push(modId);
    });
    ids.sort(function (a, b) { return a - b; });
    return ids;
  }

  function isLocalCatalogMode(config) {
    return !!(config && (config.onlyTracked || config.onlyInstalled));
  }

  function getCatalogModIdsForPool(config) {
    if (!config) {
      return [];
    }
    if (config.onlyTracked) {
      return getTrackedCatalogModIds(config);
    }
    if (config.onlyInstalled) {
      return getInstalledCatalogModIds(config);
    }
    return [];
  }

  function hasLocalCatalogData(config) {
    if (!config) {
      return false;
    }
    if (config.onlyTracked) {
      return hasTrackedCatalogData(config);
    }
    if (config.onlyInstalled) {
      return getInstalledCatalogModIds(config).length > 0;
    }
    return false;
  }

  function getTrackedCatalogKey(config) {
    if (config.onlyInstalled) {
      return [
        'installed',
        getBrowseSessionKey(),
        Object.keys(config.installed || {}).length,
        !!config.hideTracked,
        !!config.onlyTracked,
      ].join('|');
    }
    return [
      'tracked',
      getBrowseSessionKey(),
      !!config.hideInstalled,
      !!config.onlyInstalled,
      getTrackedCatalogModIds(config).length,
    ].join('|');
  }

  function getCatalogSourceKey(config) {
    if (!config) {
      return '';
    }
    if (config.onlyInstalled) {
      return [
        'installed-src',
        getBrowseSessionKey(),
        Object.keys(config.installed || {}).length,
      ].join('|');
    }
    return [
      'tracked-src',
      getBrowseSessionKey(),
      countRawTrackedMods(config),
    ].join('|');
  }

  function getCatalogFilterKey(config) {
    if (!config) {
      return '';
    }
    return [
      !!config.hideInstalled,
      !!config.onlyInstalled,
      !!config.hideTracked,
      !!config.onlyTracked,
    ].join('|');
  }

  function registerCatalogTileEntry(entry) {
    if (!entry || !entry.modId || !entry.card) {
      return;
    }
    enhancer.catalogTileByModId = enhancer.catalogTileByModId || {};
    enhancer.catalogTileByModId[String(entry.modId)] = entry;
  }

  function registerCatalogTileEntries(entries) {
    if (!entries || !entries.length) {
      return;
    }
    for (var i = 0; i < entries.length; i++) {
      registerCatalogTileEntry(entries[i]);
    }
  }

  function registerTilesFromCatalogCaches() {
    registerCatalogTileEntries(enhancer.tilePool);
    enhancer.trackedCatalogPageCache = enhancer.trackedCatalogPageCache || {};
    Object.keys(enhancer.trackedCatalogPageCache).forEach(function (pageKey) {
      registerCatalogTileEntries(enhancer.trackedCatalogPageCache[pageKey]);
    });
    registerCatalogTileEntries(enhancer.warmedTrackedPage0);
  }

  function tryShowLocalCatalogPageFromRegistry(config, page) {
    if (!config || !isLocalCatalogMode(config)) {
      return false;
    }

    var catalogIds = getCatalogIdsForFetch(config);
    var pageSize = getCarouselPageSize(config);
    var pageIds = getCatalogPageFetchIds(catalogIds, page, pageSize);
    if (pageIds.length === 0) {
      return false;
    }

    var targetCount = Math.min(pageSize, pageIds.length);
    var entries = [];
    enhancer.catalogTileByModId = enhancer.catalogTileByModId || {};
    for (var i = 0; i < pageIds.length && entries.length < targetCount; i++) {
      var entry = enhancer.catalogTileByModId[String(pageIds[i])];
      if (!entry || !entry.card) {
        continue;
      }
      if (entry.modId) {
        entry.installed = config.installed[String(entry.modId)] || null;
        entry.tracked = !!(config.tracked && config.tracked[String(entry.modId)]);
      }
      entries.push(entry);
    }

    if (entries.length === 0) {
      return false;
    }

    swapTrackedCatalogPool(page, entries, config);
    showTrackedCatalogPage(config);
    return true;
  }

  function showLocalCatalogPendingState(config) {
    ensureCarouselLayout(config);
    ensureCarouselControlsBar();

    var grid = resolveNexusModGridElement();
    var poolHost = ensurePoolHost();
    var stash = ensureLiveStashHost();
    hideAllCarouselTiles(grid, poolHost, stash);

    if (grid && stash) {
      var liveTiles = grid.querySelectorAll(':scope > [data-e2eid="mod-tile"]:not([data-vortex-pool-tile])');
      for (var i = 0; i < liveTiles.length; i++) {
        var tile = liveTiles[i];
        tile.classList.add('vortex-enhanced-nexus-live-hidden', 'vortex-enhanced-carousel-hidden');
        tile.style.setProperty('display', 'none', 'important');
        if (tile.parentElement !== stash) {
          stash.appendChild(tile);
        }
      }
    }

    var pageSize = getCarouselPageSize(config);
    var controlVisibleCount = getEffectiveResultsTotal(config, 0);
    clampGlobalPageIndex(pageSize, controlVisibleCount);
    var batchPages = Math.max(1, Math.ceil(Math.max(controlVisibleCount, 1) / pageSize));
    updateCarouselControls(controlVisibleCount, batchPages, pageSize, enhancer.globalPageIndex || 0);
  }

  function applyLocalCatalogFilterRefresh(config) {
    if (!config || !isLocalCatalogMode(config)) {
      return false;
    }

    rememberTrackedResultsTotal(config);
    var optimisticCatalogTotal = getLocalCatalogHeadlineTotal(config);
    if (optimisticCatalogTotal > 0) {
      enhancer.nexusCatalogTotal = optimisticCatalogTotal;
    }
    syncNexusResultsHeadline(config);

    ensureLocalCatalogInitialized(config);
    enhancer.globalPageIndex = 0;
    saveCarouselPagingState();
    enhancer.trackedCatalogActive = true;
    ensureCatalogDisplayGrid(config);

    if (tryShowLocalCatalogPageFromRegistry(config, 0)) {
      markLocalCatalogBootstrapped();
      decorateVisibleCarouselSlice(collectCards(config), config);
      hideBrowsePageFooter();
      syncNexusResultsHeadline(config);
      ensureCarouselControlsBar();
      void ensureTrackedCatalogPool(config).then(function () {
        if (window.__vortexBrowseEnhancer) {
          window.__vortexBrowseEnhancer.scheduleScan(true);
        }
      });
      return true;
    }

    showLocalCatalogPendingState(config);
    hideBrowsePageFooter();
    void ensureTrackedCatalogPool(config).then(function (ok) {
      if (!ok || !window.__vortexBrowseEnhancer) {
        return;
      }
      window.__vortexBrowseEnhancer.scheduleScan(true);
    });
    return false;
  }

  function clearCatalogSortedIdsCache() {
    enhancer.catalogSortedIds = null;
    enhancer.catalogSortedIdsKey = '';
    enhancer.catalogListingTotal = 0;
    enhancer.catalogSortedIdsPromise = null;
    enhancer.catalogSortedIdsPromiseKey = '';
  }

  function normalizeCatalogSortField(sortField) {
    var field = String(sortField || 'createdAt');
    var sortAliases = {
      datepublished: 'createdAt',
      published: 'createdAt',
      date_published: 'createdAt',
      totaldownloads: 'downloads',
      total_downloads: 'downloads',
      uniquedownloads: 'uniqueDownloads',
      endorsed: 'endorsements',
      endorsement: 'endorsements',
      title: 'name',
      size: 'fileSize',
      filesize: 'fileSize',
      lastcomment: 'lastComment',
    };
    return sortAliases[field.toLowerCase()] || field;
  }

  function filterNodesByNexusContext(nodes, ctx) {
    if (!nodes || !nodes.length) {
      return [];
    }

    return nodes.filter(function (node) {
      if (!node) {
        return false;
      }

      if (ctx.onlyAdult === 'false' || ctx.onlyAdult === false) {
        if (node.adultContent) {
          return false;
        }
      } else if (ctx.showAdult === 'true' || ctx.showAdult === true) {
        if (!node.adultContent) {
          return false;
        }
      }

      if (ctx.categories && ctx.categories.length) {
        var categoryName = node.modCategory && node.modCategory.name;
        var categoryMatch = false;
        for (var i = 0; i < ctx.categories.length; i++) {
          if (String(ctx.categories[i]).toLowerCase() === String(categoryName || '').toLowerCase()) {
            categoryMatch = true;
            break;
          }
        }
        if (!categoryMatch) {
          return false;
        }
      }

      if (ctx.title) {
        var titleNeedle = String(ctx.title).toLowerCase();
        if (String(node.name || '').toLowerCase().indexOf(titleNeedle) < 0) {
          return false;
        }
      }

      if (ctx.description) {
        var descNeedle = String(ctx.description).toLowerCase();
        if (String(node.summary || '').toLowerCase().indexOf(descNeedle) < 0) {
          return false;
        }
      }

      return true;
    });
  }

  function sortNodesByNexusContext(nodes, ctx) {
    var copy = (nodes || []).slice();
    if (!copy.length) {
      return copy;
    }

    var dir = ctx.sortDirection === 'ASC' ? 1 : -1;
    var field = normalizeCatalogSortField(ctx.sortExplicit && ctx.sort ? ctx.sort : 'createdAt');

    if (/^(random|surprise|shuffle)$/i.test(field)) {
      var seed = enhancer.randomSortSeed || Math.floor(Math.random() * 0x7fffffff);
      enhancer.randomSortSeed = seed;
      copy.sort(function (a, b) {
        var ha = ((Number(a.modId) * 2654435761) ^ seed) >>> 0;
        var hb = ((Number(b.modId) * 2654435761) ^ seed) >>> 0;
        return ha - hb;
      });
      return copy;
    }

    copy.sort(function (a, b) {
      var av;
      var bv;

      if (field === 'name') {
        av = String(a.name || '').toLowerCase();
        bv = String(b.name || '').toLowerCase();
        var nameCmp = av.localeCompare(bv);
        if (nameCmp !== 0) {
          return nameCmp * dir;
        }
        return (Number(a.modId) || 0) - (Number(b.modId) || 0);
      }

      if (field === 'uniqueDownloads') {
        av = Number(a.uniqueDownloads != null ? a.uniqueDownloads : a.downloads) || 0;
        bv = Number(b.uniqueDownloads != null ? b.uniqueDownloads : b.downloads) || 0;
      } else if (field === 'lastComment') {
        av = Date.parse(a.lastComment || a.updatedAt || 0) || 0;
        bv = Date.parse(b.lastComment || b.updatedAt || 0) || 0;
      } else if (field === 'createdAt' || field === 'updatedAt') {
        av = Date.parse(a[field] || 0) || 0;
        bv = Date.parse(b[field] || 0) || 0;
      } else {
        av = Number(a[field]) || 0;
        bv = Number(b[field]) || 0;
      }

      if (av === bv) {
        return (Number(a.modId) || 0) - (Number(b.modId) || 0);
      }
      return av > bv ? dir : -dir;
    });

    return copy;
  }

  function fetchAllCatalogNodes(modIds, config) {
    if (!modIds || modIds.length === 0) {
      return Promise.resolve([]);
    }

    var chunkSize = 40;
    var chunks = [];
    for (var i = 0; i < modIds.length; i += chunkSize) {
      chunks.push(modIds.slice(i, i + chunkSize));
    }

    var merged = [];
    var index = 0;
    var batchSize = 5;

    function nextBatch() {
      if (index >= chunks.length) {
        return Promise.resolve(merged);
      }

      var batch = chunks.slice(index, index + batchSize);
      index += batchSize;
      return Promise.all(batch.map(function (chunk) {
        return fetchModsByUidForTiles(chunk, config);
      })).then(function (results) {
        for (var r = 0; r < results.length; r++) {
          merged = mergeGraphqlNodes(merged, results[r]);
        }
        return nextBatch();
      });
    }

    return nextBatch();
  }

  function resolveCatalogSortedModIds(config) {
    var cacheKey = getTrackedCatalogKey(config);
    if (enhancer.catalogSortedIdsKey === cacheKey && enhancer.catalogSortedIds) {
      return Promise.resolve(enhancer.catalogSortedIds);
    }
    if (enhancer.catalogSortedIdsPromiseKey === cacheKey && enhancer.catalogSortedIdsPromise) {
      return enhancer.catalogSortedIdsPromise;
    }

    var baseIds = getCatalogModIdsForPool(config);
    if (baseIds.length === 0) {
      clearCatalogSortedIdsCache();
      return Promise.resolve([]);
    }

    var ctx = loadNexusListingContext();
    enhancer.catalogSortedIdsPromiseKey = cacheKey;
    enhancer.catalogSortedIdsPromise = fetchAllCatalogNodes(baseIds, config).then(function (nodes) {
      var filtered = filterNodesByNexusContext(nodes, ctx);
      var sorted = sortNodesByNexusContext(filtered, ctx);
      var ids = [];
      for (var i = 0; i < sorted.length; i++) {
        var modId = parseInt(sorted[i].modId, 10);
        if (modId > 0) {
          ids.push(modId);
        }
      }
      enhancer.catalogSortedIds = ids;
      enhancer.catalogSortedIdsKey = cacheKey;
      enhancer.catalogListingTotal = ids.length;
      enhancer.catalogSortedIdsPromise = null;
      enhancer.catalogSortedIdsPromiseKey = '';
      return ids;
    }).catch(function () {
      enhancer.catalogSortedIdsPromise = null;
      enhancer.catalogSortedIdsPromiseKey = '';
      return baseIds;
    });

    return enhancer.catalogSortedIdsPromise;
  }

  function getCatalogIdsForFetch(config) {
    var catalogKey = getTrackedCatalogKey(config);
    if (enhancer.catalogSortedIdsKey === catalogKey &&
        enhancer.catalogSortedIds &&
        enhancer.catalogSortedIds.length > 0) {
      return enhancer.catalogSortedIds;
    }
    return getCatalogModIdsForPool(config);
  }

  function scheduleBackgroundCatalogSort(config) {
    if (!config || !isLocalCatalogMode(config)) {
      return;
    }

    var catalogKey = getTrackedCatalogKey(config);
    if (enhancer.catalogSortedIdsKey === catalogKey && enhancer.catalogSortedIds) {
      return;
    }
    if (enhancer.catalogSortScheduledKey === catalogKey) {
      return;
    }

    enhancer.catalogSortScheduledKey = catalogKey;
    resolveCatalogSortedModIds(config).then(function (sortedIds) {
      enhancer.catalogSortScheduledKey = '';
      if (!sortedIds || sortedIds.length === 0 || !enhancer.config || !isLocalCatalogMode(enhancer.config)) {
        return;
      }
      if (getTrackedCatalogKey(enhancer.config) !== catalogKey) {
        return;
      }
      if (!isTrackedCatalogReady(enhancer.config)) {
        return;
      }

      var page = enhancer.globalPageIndex || 0;
      var pageSize = getCarouselPageSize(enhancer.config);
      var sortedPageIds = getCatalogPageFetchIds(sortedIds, page, pageSize);
      var currentIds = enhancer.tilePool.map(function (entry) {
        return entry.modId;
      }).filter(Boolean);
      if (sortedPageIds.join(',') === currentIds.join(',')) {
        return;
      }

      enhancer.trackedCatalogLoadedPage = -1;
      enhancer.localCatalogBootstrapped = false;
      enhancer.lastAppliedSliceKey = '';
      if (window.__vortexBrowseEnhancer) {
        window.__vortexBrowseEnhancer.scheduleScan(true);
      }
    }).catch(function () {
      enhancer.catalogSortScheduledKey = '';
    });
  }

  function getTrackedWarmKey(config) {
    if (!config) {
      return '';
    }
    return [
      getBrowseSessionKey(),
      !!config.hideInstalled,
      getTrackedCatalogModIds(config).length,
    ].join('|');
  }

  function applyWarmedTrackedPage(config, page) {
    if (page !== 0 || !config || !config.onlyTracked) {
      return false;
    }
    var warmKey = getTrackedWarmKey(config);
    if (!enhancer.warmedTrackedPage0 || enhancer.warmedTrackedPageKey !== warmKey) {
      return false;
    }
    swapTrackedCatalogPool(0, enhancer.warmedTrackedPage0.slice(), config);
    markLocalCatalogBootstrapped();
    return true;
  }

  function scheduleBackgroundTrackedCatalogWarm(config) {
    if (!config || isLocalCatalogMode(config)) {
      return;
    }
    if (getTrackedCatalogModIds(config).length === 0) {
      return;
    }

    var warmKey = getTrackedWarmKey(config);
    if (enhancer.warmedTrackedPageKey === warmKey && enhancer.warmedTrackedPage0 &&
        enhancer.warmedTrackedPage0.length > 0) {
      return;
    }
    if (enhancer.backgroundTrackedWarmInFlight) {
      return;
    }

    if (enhancer.backgroundTrackedWarmTimer) {
      clearTimeout(enhancer.backgroundTrackedWarmTimer);
    }

    enhancer.backgroundTrackedWarmTimer = setTimeout(function () {
      enhancer.backgroundTrackedWarmTimer = null;
      var latest = enhancer.config || config;
      if (!latest || isLocalCatalogMode(latest)) {
        return;
      }

      var latestKey = getTrackedWarmKey(latest);
      if (enhancer.warmedTrackedPageKey === latestKey && enhancer.warmedTrackedPage0 &&
          enhancer.warmedTrackedPage0.length > 0) {
        return;
      }

      var catalogIds = getCatalogModIdsForPool(latest);
      if (catalogIds.length === 0) {
        return;
      }

      enhancer.backgroundTrackedWarmInFlight = true;
      var pageSize = getCarouselPageSize(latest);
      fetchCatalogPageEntries(catalogIds, 0, pageSize, latest, { poolTile: true }).then(function (entries) {
        enhancer.backgroundTrackedWarmInFlight = false;
        if (!entries || entries.length === 0) {
          return;
        }
        var current = enhancer.config || latest;
        if (!current || isLocalCatalogMode(current)) {
          return;
        }
        if (getTrackedWarmKey(current) !== latestKey) {
          return;
        }
        enhancer.warmedTrackedPage0 = entries;
        enhancer.warmedTrackedPageKey = latestKey;
      }).catch(function () {
        enhancer.backgroundTrackedWarmInFlight = false;
      });
    }, 0);
  }

  function resetTrackedCatalogPool() {
    var preserveCards = {};
    if (enhancer.warmedTrackedPage0) {
      for (var w = 0; w < enhancer.warmedTrackedPage0.length; w++) {
        var warmEntry = enhancer.warmedTrackedPage0[w];
        if (warmEntry && warmEntry.card) {
          preserveCards[warmEntry.card] = true;
        }
      }
    }

    clearCatalogSortedIdsCache();
    enhancer.trackedCatalogActive = false;
    enhancer.trackedCatalogKey = '';
    enhancer.trackedCatalogSourceKey = '';
    enhancer.trackedCatalogFilterKey = '';
    enhancer.catalogTileByModId = {};
    enhancer.trackedCatalogLoadedPage = -1;
    enhancer.trackedCatalogPageCache = {};
    enhancer.tilePool = [];
    document.querySelectorAll('[data-vortex-pool-tile="true"]').forEach(function (tile) {
      if (!preserveCards[tile] && tile.parentElement) {
        tile.parentElement.removeChild(tile);
      }
    });
    var pool = document.getElementById('vortex-enhanced-pool-host');
    if (pool) {
      var child = pool.firstChild;
      while (child) {
        var next = child.nextSibling;
        if (!preserveCards[child]) {
          pool.removeChild(child);
        }
        child = next;
      }
    }
  }

  function buildModIdListingOrFilters(modIds, config) {
    var gameId = resolveGameNumericId(config);
    var gameDomain = getGameDomainFromPath();
    return modIds.map(function (modId) {
      var clause = {
        modId: [{ op: 'EQUALS', value: String(modId) }],
      };
      if (gameId) {
        clause.gameId = [{ op: 'EQUALS', value: String(gameId) }];
      } else if (gameDomain) {
        clause.gameDomainName = [{ op: 'EQUALS', value: gameDomain }];
      }
      return clause;
    });
  }

  function fetchModsListingByModIds(modIds, config) {
    if (!modIds || modIds.length === 0) {
      return Promise.resolve([]);
    }

    var orFilters = buildModIdListingOrFilters(modIds, config);

    var tagsExclude = [];
    if (shouldApplyTranslationFilter()) {
      tagsExclude.push('Translation');
    }

    var variables = {
      count: modIds.length,
      offset: 0,
      facets: {},
      filter: {
        op: 'OR',
        filter: orFilters,
      },
      postFilter: {
        tag: tagsExclude.map(function (value) {
          return { op: 'NOT_EQUALS', value: String(value) };
        }),
      },
    };

    if (shouldApplyTranslationFilter()) {
      variables.postFilter.categoryName = [{ op: 'NOT_EQUALS', value: 'Translation' }];
    }

    var query = [
      'query ModsListing($count: Int = 0, $facets: ModsFacet, $filter: ModsFilter, $offset: Int, $postFilter: ModsFilter, $sort: [ModsSort!]) {',
      '  mods(count: $count, facets: $facets, filter: $filter, offset: $offset, postFilter: $postFilter, sort: $sort, viewUserBlockedContent: false) {',
      '    nodes { adultContent createdAt downloads endorsements fileSize game { domainName id name } modCategory { categoryId name } modId name status summary thumbnailUrl uid updatedAt uploader { avatar memberId name } viewerDownloaded viewerEndorsed viewerTracked viewerUpdateAvailable }',
      '    totalCount',
      '  }',
      '}',
    ].join('\n');

    return graphqlRequest(query, variables, 'ModsListing').then(function (payload) {
      if (payload && payload.errors && payload.errors.length) {
        return [];
      }
      var data = payload && payload.data && payload.data.mods;
      if (!data || !Array.isArray(data.nodes)) {
        return [];
      }
      return orderGraphqlNodesByModIds(data.nodes, modIds);
    }).catch(function () {
      return [];
    });
  }

  function fetchModsListingByModIdsChunked(modIds, config) {
    if (!modIds || modIds.length === 0) {
      return Promise.resolve([]);
    }

    var chunkSize = 12;
    var chunks = [];
    for (var i = 0; i < modIds.length; i += chunkSize) {
      chunks.push(modIds.slice(i, i + chunkSize));
    }

    return Promise.all(chunks.map(function (chunk) {
      return fetchModsListingByModIds(chunk, config).then(function (nodes) {
        if (nodes && nodes.length > 0) {
          return nodes;
        }
        return fetchModsListingByModIds(chunk, config);
      }).catch(function () {
        return [];
      });
    })).then(function (results) {
      var merged = [];
      for (var r = 0; r < results.length; r++) {
        merged = mergeGraphqlNodes(merged, results[r]);
      }
      return orderGraphqlNodesByModIds(merged, modIds);
    });
  }

  function fetchModsByUidChunk(modIds, config) {
    if (!modIds || modIds.length === 0) {
      return Promise.resolve([]);
    }

    var uids = [];
    modIds.forEach(function (modId) {
      var uid = makeModUidForFetch(config, modId);
      if (uid) {
        uids.push(uid);
      }
    });

    if (uids.length === 0) {
      return Promise.resolve([]);
    }

    var query = [
      'query modsByUid($uids: [ID!]!, $count: Int) {',
      '  modsByUid(uids: $uids, count: $count) {',
      '    nodes { adultContent createdAt downloads endorsements fileSize game { domainName id name } modCategory { categoryId name } modId name status summary thumbnailUrl uid updatedAt uploader { avatar memberId name } viewerDownloaded viewerEndorsed viewerTracked viewerUpdateAvailable }',
      '  }',
      '}',
    ].join('\n');

    return graphqlRequest(query, { uids: uids, count: uids.length }, 'modsByUid').then(function (payload) {
      var nodes = payload && payload.data && payload.data.modsByUid && payload.data.modsByUid.nodes
        ? payload.data.modsByUid.nodes
        : [];
      return orderGraphqlNodesByModIds(nodes, modIds);
    }).catch(function () {
      return [];
    });
  }

  function removeTrackedPoolTilesExceptCache(entries) {
    if (!entries || entries.length === 0) {
      return;
    }
    var keepTiles = getTrackedCatalogCachedTileSet();
    for (var i = 0; i < entries.length; i++) {
      var card = entries[i] && entries[i].card;
      if (!card || keepTiles[card]) {
        continue;
      }
      if (card.parentElement) {
        card.parentElement.removeChild(card);
      }
    }
  }

  function swapTrackedCatalogPool(page, newEntries, config) {
    if (enhancer.trackedCatalogLoadedPage >= 0 && enhancer.tilePool.length > 0) {
      snapshotTrackedCatalogPage(enhancer.trackedCatalogLoadedPage);
    }

    var previousEntries = enhancer.tilePool.slice();
    enhancer.tilePool = newEntries;
    removeTrackedPoolTilesExceptCache(previousEntries);

    enhancer.trackedCatalogLoadedPage = page;
    enhancer.trackedCatalogActive = true;
    if (newEntries.length > 0) {
      snapshotTrackedCatalogPage(page);
      prefetchTrackedCatalogPageCache(page + 1, config);
      prefetchTrackedCatalogPageCache(page + 2, config);
      prefetchTrackedCatalogPageCache(page + 3, config);
    }
  }

  function requestModTilesFromHost(modIds, config) {
    var webviewPromise = fetchModsByUidForTilesWebview(modIds, config);

    var hostPromise = new Promise(function (resolve) {
      var requestId = 'mt-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
      var settled = false;
      enhancer.pendingModTileRequests = enhancer.pendingModTileRequests || {};

      function finish(nodes) {
        if (settled) {
          return;
        }
        settled = true;
        delete enhancer.pendingModTileRequests[requestId];
        resolve(Array.isArray(nodes) ? nodes : []);
      }

      enhancer.pendingModTileRequests[requestId] = finish;

      sendToHost({
        type: 'fetch-mod-tiles',
        requestId: requestId,
        modIds: modIds,
      });

      setTimeout(function () {
        if (!settled && enhancer.pendingModTileRequests[requestId]) {
          delete enhancer.pendingModTileRequests[requestId];
          finish([]);
        }
      }, 200);
    });

    return hostPromise.then(function (hostNodes) {
      var merged = hostNodes || [];
      if (getMissingModIds(modIds, merged).length === 0) {
        return orderGraphqlNodesByModIds(merged, modIds);
      }
      return webviewPromise.then(function (webviewNodes) {
        merged = mergeGraphqlNodes(merged, webviewNodes || []);
        var missing = getMissingModIds(modIds, merged);
        if (missing.length === 0) {
          return orderGraphqlNodesByModIds(merged, modIds);
        }
        return fetchModsByUidForTilesWebview(missing, config).then(function (extra) {
          return orderGraphqlNodesByModIds(mergeGraphqlNodes(merged, extra), modIds);
        });
      });
    });
  }

  function fetchModsByUidForTilesWebview(modIds, config) {
    if (!modIds || modIds.length === 0) {
      return Promise.resolve([]);
    }

    return fetchModsListingByModIdsChunked(modIds, config).then(function (listingNodes) {
      if (listingNodes && listingNodes.length > 0) {
        return listingNodes;
      }

      return fetchModsListingByModIds(modIds, config).then(function (singleBatchNodes) {
        if (singleBatchNodes && singleBatchNodes.length > 0) {
          return singleBatchNodes;
        }

        var chunkSize = 20;
        var chunks = [];
        for (var i = 0; i < modIds.length; i += chunkSize) {
          chunks.push(modIds.slice(i, i + chunkSize));
        }

        return chunks.reduce(function (chain, chunk) {
          return chain.then(function (merged) {
            return fetchModsByUidChunk(chunk, config).then(function (nodes) {
              if (!nodes || nodes.length === 0) {
                return merged;
              }
              return merged.concat(nodes);
            });
          });
        }, Promise.resolve([])).then(function (merged) {
          return orderGraphqlNodesByModIds(merged, modIds);
        });
      });
    });
  }

  function getReturnedModIdSet(nodes) {
    var set = {};
    (nodes || []).forEach(function (node) {
      if (node && node.modId != null) {
        set[String(node.modId)] = true;
      }
    });
    return set;
  }

  function getMissingModIds(modIds, nodes) {
    var returned = getReturnedModIdSet(nodes);
    return (modIds || []).filter(function (modId) {
      return !returned[String(modId)];
    });
  }

  function mergeGraphqlNodes(primary, extra) {
    var merged = (primary || []).slice();
    var seen = getReturnedModIdSet(merged);
    (extra || []).forEach(function (node) {
      if (node && node.modId != null && !seen[String(node.modId)]) {
        seen[String(node.modId)] = true;
        merged.push(node);
      }
    });
    return merged;
  }

  function getCatalogPageFetchIds(catalogIds, pageIndex, pageSize) {
    var start = pageIndex * pageSize;
    if (start >= catalogIds.length) {
      return [];
    }
    var overscan = Math.min(16, Math.max(8, Math.ceil(pageSize / 3)));
    return catalogIds.slice(start, Math.min(catalogIds.length, start + pageSize + overscan));
  }

  function buildCatalogTileEntry(node, config, pool, options) {
    var tile = buildGraphQLModTile(node);
    var modId = extractModIdFromTile(tile);
    if (!modId) {
      return null;
    }
    seedModEnrichmentCache(modId, node);
    applyCachedModEnrichment(tile, modId);
    if (options && options.poolTile) {
      tile.setAttribute('data-vortex-pool-tile', 'true');
      tile.style.setProperty('display', 'none', 'important');
    }
    if (pool) {
      pool.appendChild(tile);
    }
    var entry = {
      modId: modId,
      installed: config.installed[String(modId)] || null,
      tracked: !!(config.tracked && config.tracked[String(modId)]),
      card: tile,
    };
    registerCatalogTileEntry(entry);
    return entry;
  }

  function buildCatalogEntriesFromPageFetch(pageIds, pageSize, nodes, config, options) {
    var pool = ensurePoolHost();
    var byModId = {};
    (nodes || []).forEach(function (node) {
      if (node && node.modId != null) {
        byModId[String(node.modId)] = node;
      }
    });

    var entries = [];
    for (var i = 0; i < pageIds.length && entries.length < pageSize; i++) {
      var node = byModId[String(pageIds[i])];
      if (!node) {
        continue;
      }
      var entry = buildCatalogTileEntry(node, config, pool, options);
      if (entry) {
        entries.push(entry);
      }
    }
    return entries;
  }

  function fetchCatalogNodesForIds(modIds, config, attempt) {
    return fetchModsByUidForTiles(modIds, config).then(function (nodes) {
      var merged = nodes || [];
      var missing = getMissingModIds(modIds, merged);
      if (missing.length > 0 && attempt < 2) {
        return fetchModsByUidForTilesWebview(missing, config).then(function (extra) {
          return mergeGraphqlNodes(merged, extra);
        });
      }
      return merged;
    });
  }

  function showOnlyTrackedLoadingState(config) {
    showLocalCatalogPendingState(config);
  }

  function fetchCatalogPageEntries(catalogIds, pageIndex, pageSize, config, options) {
    var pageIds = getCatalogPageFetchIds(catalogIds, pageIndex, pageSize);
    if (pageIds.length === 0) {
      return Promise.resolve([]);
    }

    return fetchCatalogNodesForIds(pageIds, config, 0).then(function (nodes) {
      var entries = buildCatalogEntriesFromPageFetch(pageIds, pageSize, nodes, config, options);
      if (entries.length >= pageSize) {
        return entries;
      }

      var start = pageIndex * pageSize;
      var nextStart = start + pageIds.length;
      var stillNeed = pageSize - entries.length;
      var extraIds = catalogIds.slice(nextStart, nextStart + stillNeed + 8);
      if (extraIds.length === 0) {
        return entries;
      }

      var combinedIds = pageIds.concat(extraIds);
      return fetchCatalogNodesForIds(combinedIds, config, 0).then(function (moreNodes) {
        return buildCatalogEntriesFromPageFetch(combinedIds, pageSize, moreNodes, config, options);
      });
    });
  }

  function fetchModsByUidForTiles(modIds, config) {
    if (!modIds || modIds.length === 0) {
      return Promise.resolve([]);
    }
    return requestModTilesFromHost(modIds, config).then(function (nodes) {
      if (nodes && nodes.length > 0 && getMissingModIds(modIds, nodes).length === 0) {
        return nodes;
      }
      return fetchModsByUidForTilesWebview(modIds, config);
    });
  }

  function hasTrackedCatalogData(config) {
    if (!config || !config.onlyTracked) {
      return false;
    }
    return getTrackedCatalogModIds(config).length > 0;
  }

  function isOnlyTrackedCatalogLoading(config) {
    if (!config || !isLocalCatalogMode(config)) {
      return false;
    }
    if (isTrackedCatalogReady(config)) {
      return false;
    }
    if (!hasLocalCatalogData(config)) {
      return config.onlyTracked;
    }
    return getCatalogModIdsForPool(config).length > 0;
  }

  function isTrackedCatalogReady(config) {
    if (!config || !isLocalCatalogMode(config) || !enhancer.trackedCatalogActive) {
      return false;
    }
    var page = enhancer.globalPageIndex || 0;
    return enhancer.trackedCatalogLoadedPage === page && enhancer.tilePool.length > 0;
  }

  function snapshotTrackedCatalogPage(page) {
    if (!enhancer.tilePool || enhancer.tilePool.length === 0) {
      return null;
    }
    enhancer.trackedCatalogPageCache = enhancer.trackedCatalogPageCache || {};
    enhancer.trackedCatalogPageCache[page] = enhancer.tilePool.map(function (entry) {
      return {
        modId: entry.modId,
        installed: entry.installed || null,
        tracked: !!entry.tracked,
        card: entry.card,
      };
    });
  }

  function prefetchTrackedCatalogPageCache(page, config) {
    if (!config || !isLocalCatalogMode(config) || page < 0) {
      return;
    }
    enhancer.trackedCatalogPageCache = enhancer.trackedCatalogPageCache || {};
    if (enhancer.trackedCatalogPageCache[page]) {
      return;
    }

    var catalogIds = getCatalogIdsForFetch(config);
    var pageSize = getCarouselPageSize(config);
    var start = page * pageSize;
    if (start >= catalogIds.length) {
      return;
    }

    var pageIds = getCatalogPageFetchIds(catalogIds, page, pageSize);
    if (pageIds.length === 0) {
      return;
    }

    return fetchCatalogPageEntries(catalogIds, page, pageSize, config, { poolTile: true }).then(function (cachedEntries) {
      if (!cachedEntries || cachedEntries.length === 0) {
        return;
      }
      if (enhancer.trackedCatalogPageCache[page]) {
        return;
      }
      enhancer.trackedCatalogPageCache[page] = cachedEntries;
    }).catch(function () {
      // ignore prefetch failures
    });
  }

  function snapshotCurrentCatalogPageIfNeeded() {
    var page = enhancer.trackedCatalogLoadedPage;
    if (page >= 0 && enhancer.tilePool && enhancer.tilePool.length > 0) {
      snapshotTrackedCatalogPage(page);
    }
  }

  function restoreTrackedCatalogPageFromCache(page, config) {
    enhancer.trackedCatalogPageCache = enhancer.trackedCatalogPageCache || {};
    var cached = enhancer.trackedCatalogPageCache[page];
    if (!cached || !cached.length) {
      return false;
    }

    var grid = findModGrid();
    var poolHost = ensurePoolHost();
    var stash = ensureLiveStashHost();
    if (grid) {
      grid.querySelectorAll(':scope > [data-e2eid="mod-tile"]').forEach(function (tile) {
        setCarouselTileVisibility(tile, false, grid, poolHost, stash);
      });
    }

    var pool = ensurePoolHost();
    enhancer.tilePool = [];
    for (var i = 0; i < cached.length; i++) {
      var entry = cached[i];
      if (!entry || !entry.card) {
        continue;
      }
      entry.card.classList.remove(
        'vortex-enhanced-hidden',
        'vortex-enhanced-carousel-hidden',
        'vortex-enhanced-nexus-live-hidden'
      );
      entry.card.style.removeProperty('display');
      if (entry.modId) {
        entry.installed = config.installed[String(entry.modId)] || null;
        entry.tracked = !!(config.tracked && config.tracked[String(entry.modId)]);
      }
      if (pool && entry.card.parentElement !== pool) {
        pool.appendChild(entry.card);
      }
      enhancer.tilePool.push(entry);
    }

    registerCatalogTileEntries(enhancer.tilePool);
    enhancer.trackedCatalogLoadedPage = page;
    enhancer.trackedCatalogActive = true;
    prefetchTrackedCatalogPageCache(page + 1, config);
    prefetchTrackedCatalogPageCache(page + 2, config);
    prefetchTrackedCatalogPageCache(page + 3, config);
    if (enhancer.tilePool.length === 0) {
      delete enhancer.trackedCatalogPageCache[page];
      return false;
    }
    return true;
  }

  function getTrackedCatalogCachedTileSet() {
    var keepTiles = {};
    enhancer.trackedCatalogPageCache = enhancer.trackedCatalogPageCache || {};
    Object.keys(enhancer.trackedCatalogPageCache).forEach(function (pageKey) {
      var cached = enhancer.trackedCatalogPageCache[pageKey];
      if (!cached) {
        return;
      }
      for (var i = 0; i < cached.length; i++) {
        if (cached[i] && cached[i].card) {
          keepTiles[cached[i].card] = true;
        }
      }
    });
    return keepTiles;
  }

  function clearTrackedCatalogTiles() {
    var keepTiles = getTrackedCatalogCachedTileSet();
    enhancer.tilePool = [];
    document.querySelectorAll('[data-vortex-pool-tile="true"]').forEach(function (tile) {
      if (keepTiles[tile]) {
        tile.classList.add('vortex-enhanced-carousel-hidden');
        tile.style.setProperty('display', 'none', 'important');
        var poolKeep = document.getElementById('vortex-enhanced-pool-host');
        if (poolKeep && tile.parentElement !== poolKeep) {
          poolKeep.appendChild(tile);
        }
        return;
      }
      if (tile.parentElement) {
        tile.parentElement.removeChild(tile);
      }
    });
    var pool = document.getElementById('vortex-enhanced-pool-host');
    if (pool) {
      Array.prototype.slice.call(pool.childNodes).forEach(function (child) {
        if (child.nodeType === 1 &&
            child.getAttribute('data-vortex-pool-tile') === 'true' &&
            !keepTiles[child]) {
          pool.removeChild(child);
        }
      });
    }
  }

  function canActivateTrackedCatalog(config) {
    if (!config || !config.onlyTracked) {
      return false;
    }
    return getTrackedCatalogModIds(config).length > 0;
  }

  function scanLiveOnlyTrackedPreview(config, scrollY) {
    if (!canActivateTrackedCatalog(config)) {
      enhancer.trackedCatalogActive = false;
    }
    syncFilterPanelUiFromHost(config);
    ensureHideSiteChrome(config);
    ensureCarouselLayout(config);
    ensureVortexFilterPanel(config);
    applyDefaultFilterSectionState();
    ensureNexusFiltersPanelOpenOnLoad(config);
    hideNexusRewardsPromo();
    syncNexusResultsHeadline(config);
    showLocalCatalogPendingState(config);
    ensureCarouselControlsBar();
    hideBrowsePageFooter();
    syncAutoAdvance();

    requestAnimationFrame(function () {
      window.scrollTo(0, scrollY);
    });

    if (!enhancer.awaitingHostTrackedListUntil || Date.now() >= enhancer.awaitingHostTrackedListUntil) {
      if (!enhancer.trackedSessionFetchInFlight && !hasTrackedCatalogData(config)) {
        syncTrackedModsFromSession(config);
      }
    }

    var trackedTotal = getEffectiveResultsTotal(config, 0);
    var stats = {
      tileCount: trackedTotal,
      installedMatches: 0,
      hideInstalled: !!config.hideInstalled,
      onlyInstalled: !!config.onlyInstalled,
      hideTracked: !!config.hideTracked,
      onlyTracked: !!config.onlyTracked,
      installedKeys: Object.keys(config.installed || {}).length,
      onlyTrackedLoading: true,
    };
    enhancer.lastStats = stats;
    return stats;
  }

  function stashLiveNexusTilesForLocalCatalog(config) {
    if (!config || !isLocalCatalogMode(config) || !isTrackedCatalogReady(config)) {
      return;
    }

    var grid = findNexusModGrid();
    if (!grid) {
      return;
    }

    var stash = ensureLiveStashHost();
    var liveTiles = grid.querySelectorAll(':scope > [data-e2eid="mod-tile"]:not([data-vortex-pool-tile])');
    for (var i = 0; i < liveTiles.length; i++) {
      var tile = liveTiles[i];
      tile.classList.add('vortex-enhanced-nexus-live-hidden', 'vortex-enhanced-carousel-hidden');
      tile.style.setProperty('display', 'none', 'important');
      if (stash && tile.parentElement !== stash) {
        stash.appendChild(tile);
      }
    }
  }

  function restoreStashedLiveNexusTiles() {
    var stash = document.getElementById('vortex-enhanced-live-stash');
    if (!stash) {
      return;
    }
    var grid = resolveNexusModGridElement();
    if (!grid) {
      return;
    }

    var tiles = stash.querySelectorAll('[data-e2eid="mod-tile"].vortex-enhanced-nexus-live-hidden');
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      tile.classList.remove('vortex-enhanced-nexus-live-hidden', 'vortex-enhanced-carousel-hidden', 'vortex-enhanced-hidden');
      tile.style.removeProperty('display');
      if (tile.parentElement !== grid) {
        grid.appendChild(tile);
      }
    }
  }

  function restoreLiveBrowseGridAfterCatalog(config) {
    setLocalCatalogDisplayActive(false);
    enhancer.trackedCatalogActive = false;
    enhancer.globalPageIndex = 0;
    enhancer.lastAppliedSliceKey = '';
    enhancer.lastVisibleModsKey = '';
    saveCarouselPagingState();

    if (config) {
      ensureCarouselLayout(config);
    }
    restoreStashedLiveNexusTiles();
    unhideAllCarouselTiles();

    if (!config) {
      return false;
    }

    var liveCards = collectLiveGridCards(config);
    if (liveCards.length === 0) {
      if (shouldDeferDismissLayoutCollapse() || isTranslationFilterDismissedBrowse()) {
        return false;
      }
      var reloadUrl = enhancer.lastGoodBrowseUrl || window.location.href;
      if (reloadUrl && reloadUrl.indexOf('nexusmods.com') >= 0) {
        sendBrowseNavigateToHost(stripInternalBrowseParams(reloadUrl));
      }
      return false;
    }

    applyFilters(liveCards, config);
    applyFiltersToAllGridTiles(config);
    applyLiveCarouselPage(liveCards, config);
    decorateVisibleCarouselSlice(liveCards, config);
    syncNexusResultsHeadline(config);
    ensureCarouselControlsBar();
    installCarouselWheelHandler();
    syncAutoAdvance();
    return true;
  }

  function ensureLocalCatalogInitialized(config) {
    if (!isLocalCatalogMode(config)) {
      return;
    }

    if (config.onlyTracked && !canActivateTrackedCatalog(config)) {
      enhancer.trackedCatalogActive = false;
      return;
    }

    if (config.onlyInstalled && getInstalledCatalogModIds(config).length === 0) {
      enhancer.trackedCatalogActive = false;
      return;
    }

    var sourceKey = getCatalogSourceKey(config);
    var filterKey = getCatalogFilterKey(config);
    var catalogKey = getTrackedCatalogKey(config);

    if (enhancer.trackedCatalogSourceKey !== sourceKey) {
      resetTrackedCatalogPool();
      enhancer.trackedCatalogSourceKey = sourceKey;
      enhancer.trackedCatalogFilterKey = filterKey;
      enhancer.trackedCatalogKey = catalogKey;
      enhancer.trackedCatalogFetchAttempts = 0;
      enhancer.localCatalogBootstrapped = false;
      enhancer.globalPageIndex = 0;
      enhancer.trackedCatalogLoadedPage = -1;
      enhancer.lastAppliedSliceKey = '';
    } else if (enhancer.trackedCatalogFilterKey !== filterKey) {
      registerTilesFromCatalogCaches();
      enhancer.trackedCatalogFilterKey = filterKey;
      enhancer.trackedCatalogKey = catalogKey;
      enhancer.globalPageIndex = 0;
      enhancer.trackedCatalogLoadedPage = -1;
      enhancer.lastAppliedSliceKey = '';
      enhancer.localCatalogBootstrapped = false;
      clearCatalogSortedIdsCache();
    } else if (enhancer.trackedCatalogKey !== catalogKey) {
      enhancer.trackedCatalogKey = catalogKey;
    }

    enhancer.trackedCatalogActive = true;
    ensureCatalogDisplayGrid(config);
  }

  function markLocalCatalogBootstrapped() {
    enhancer.localCatalogBootstrapped = true;
  }

  function clearLocalCatalogBootstrap() {
    enhancer.localCatalogBootstrapped = false;
  }

  function getGridConfigKey(config) {
    if (!config) {
      return '';
    }
    return [config.gridColumns || 8, config.gridRows || 3].join('|');
  }

  function getFilterCarouselConfigKey(config) {
    if (!config) {
      return '';
    }
    return [
      !!config.hideInstalled,
      !!config.onlyInstalled,
      !!config.hideTracked,
      !!config.onlyTracked,
    ].join('|');
  }

  function revertLocalCatalogPageIndex(previousPage) {
    if (typeof previousPage === 'number' && previousPage >= 0) {
      enhancer.globalPageIndex = previousPage;
    } else {
      enhancer.globalPageIndex = 0;
    }
    saveCarouselPagingState();
    enhancer.lastAppliedSliceKey = '';
  }

  function restoreAndShowLocalCatalogPage(page, config) {
    if (restoreTrackedCatalogPageFromCache(page, config)) {
      showTrackedCatalogPage(config);
      decorateVisibleCarouselSlice(collectCards(config), config);
      ensureCarouselControlsBar();
      hideBrowsePageFooter();
      syncNexusResultsHeadline(config);
      return true;
    }
    return false;
  }

  function ensureTrackedCatalogPool(config) {
    if (!isLocalCatalogMode(config)) {
      return Promise.resolve(false);
    }

    ensureLocalCatalogInitialized(config);

    scheduleBackgroundCatalogSort(config);

    var catalogIds = getCatalogIdsForFetch(config);
    if (catalogIds.length === 0) {
      return Promise.resolve(false);
    }

    enhancer.trackedCatalogActive = true;
    enhancer.nexusCatalogTotal = getTrackedCatalogModIds(config).length || catalogIds.length;

    var pageSize = getCarouselPageSize(config);
    var page = Math.max(0, enhancer.globalPageIndex || 0);

    if (tryShowLocalCatalogPageFromRegistry(config, page)) {
      markLocalCatalogBootstrapped();
      return Promise.resolve(true);
    }

    if (enhancer.trackedCatalogLoadedPage === page && enhancer.tilePool.length > 0) {
      markLocalCatalogBootstrapped();
      return Promise.resolve(true);
    }

    if (restoreTrackedCatalogPageFromCache(page, config)) {
      markLocalCatalogBootstrapped();
      return Promise.resolve(true);
    }

    if (applyWarmedTrackedPage(config, page)) {
      return Promise.resolve(true);
    }

    var pageIds = getCatalogPageFetchIds(catalogIds, page, pageSize);
    if (pageIds.length === 0) {
      return Promise.resolve(false);
    }

    if (enhancer.trackedCatalogFetchInFlight) {
      return new Promise(function (resolve) {
        var attempts = 0;
        function waitForFetch() {
          attempts++;
          if (!enhancer.trackedCatalogFetchInFlight) {
            resolve(resolveLocalCatalogPageReady(page, config));
            return;
          }
          if (attempts >= 80) {
            resolve(resolveLocalCatalogPageReady(page, config));
            return;
          }
          setTimeout(waitForFetch, 100);
        }
        waitForFetch();
      });
    }

    var fetchPage = page;
    var fetchGeneration = (enhancer.trackedCatalogFetchGeneration || 0) + 1;
    enhancer.trackedCatalogFetchGeneration = fetchGeneration;
    enhancer.trackedCatalogFetchInFlight = true;

    function fetchPageTiles(attempt) {
      return fetchCatalogPageEntries(catalogIds, fetchPage, pageSize, config).then(function (entries) {
        if ((!entries || entries.length === 0) && attempt < 2) {
          return new Promise(function (resolveDelay) {
            setTimeout(resolveDelay, 50 + attempt * 75);
          }).then(function () {
            return fetchPageTiles(attempt + 1);
          });
        }
        return entries || [];
      });
    }

    return fetchPageTiles(0).then(function (newEntries) {
      enhancer.trackedCatalogFetchInFlight = false;
      if (enhancer.pendingCatalogRescanAfterFetch && window.__vortexBrowseEnhancer) {
        enhancer.pendingCatalogRescanAfterFetch = false;
        window.__vortexBrowseEnhancer.scheduleScan(true);
      }
      if (fetchGeneration !== enhancer.trackedCatalogFetchGeneration) {
        return false;
      }
      var latest = enhancer.config || config;
      if (!latest || !isLocalCatalogMode(latest)) {
        return false;
      }
      if ((enhancer.globalPageIndex || 0) !== fetchPage) {
        if (restoreTrackedCatalogPageFromCache(fetchPage, latest)) {
          markLocalCatalogBootstrapped();
          return true;
        }
        return false;
      }
      if (!newEntries || newEntries.length === 0) {
        if (restoreTrackedCatalogPageFromCache(fetchPage, latest)) {
          markLocalCatalogBootstrapped();
          return true;
        }
        return false;
      }

      if (newEntries.length > 0) {
        swapTrackedCatalogPool(fetchPage, newEntries, latest);
        markLocalCatalogBootstrapped();
      }
      return newEntries.length > 0;
    }).catch(function () {
      enhancer.trackedCatalogFetchInFlight = false;
      if (enhancer.pendingCatalogRescanAfterFetch && window.__vortexBrowseEnhancer) {
        enhancer.pendingCatalogRescanAfterFetch = false;
        window.__vortexBrowseEnhancer.scheduleScan(true);
      }
      return false;
    });
  }

  function navigateTrackedCatalogPage(config) {
    if (!config || !isLocalCatalogMode(config)) {
      return Promise.resolve(false);
    }

    enhancer.localCatalogNavLock = true;
    var page = Math.max(0, enhancer.globalPageIndex || 0);
    var previousLoadedPage = enhancer.trackedCatalogLoadedPage;
    enhancer.lastAppliedSliceKey = '';

    if (restoreAndShowLocalCatalogPage(page, config)) {
      prefetchTrackedCatalogPageCache(page + 1, config);
      prefetchTrackedCatalogPageCache(page + 2, config);
      prefetchTrackedCatalogPageCache(page + 3, config);
      markLocalCatalogBootstrapped();
      enhancer.localCatalogNavLock = false;
      return Promise.resolve(true);
    }

    return ensureTrackedCatalogPool(config).then(function (ok) {
      var latest = enhancer.config || config;
      if (!latest || !isLocalCatalogMode(latest)) {
        enhancer.localCatalogNavLock = false;
        return false;
      }
      if (ok && isTrackedCatalogReady(latest)) {
        showTrackedCatalogPage(latest);
        decorateVisibleCarouselSlice(collectCards(latest), latest);
        ensureCarouselControlsBar();
        hideBrowsePageFooter();
        syncNexusResultsHeadline(latest);
        prefetchTrackedCatalogPageCache(page + 1, latest);
        prefetchTrackedCatalogPageCache(page + 2, latest);
        prefetchTrackedCatalogPageCache(page + 3, latest);
        enhancer.localCatalogNavLock = false;
        return true;
      }

      if (restoreAndShowLocalCatalogPage(page, latest)) {
        enhancer.localCatalogNavLock = false;
        return true;
      }

      if ((enhancer.globalPageIndex || 0) === page) {
        revertLocalCatalogPageIndex(previousLoadedPage >= 0 ? previousLoadedPage : 0);
        restoreAndShowLocalCatalogPage(enhancer.globalPageIndex, latest);
      }
      enhancer.localCatalogNavLock = false;
      return false;
    }).catch(function () {
      enhancer.localCatalogNavLock = false;
      return false;
    });
  }

  function applyTrackedCatalogView(config) {
    enhancer.lastAppliedSliceKey = '';
    return ensureTrackedCatalogPool(config).then(function (ok) {
      var latest = enhancer.config || config;
      if (!latest || !isLocalCatalogMode(latest)) {
        return false;
      }
      if (!ok) {
        enhancer.trackedCatalogFetchAttempts = (enhancer.trackedCatalogFetchAttempts || 0) + 1;
        if (enhancer.trackedCatalogFetchAttempts < 6) {
          setTimeout(function () {
            if (window.__vortexBrowseEnhancer && enhancer.config && isLocalCatalogMode(enhancer.config)) {
              window.__vortexBrowseEnhancer.scheduleScan(false);
            }
          }, 600 + enhancer.trackedCatalogFetchAttempts * 400);
        }
        return false;
      }
      enhancer.trackedCatalogFetchAttempts = 0;
      var cards = collectCards(latest);
      showTrackedCatalogPage(latest);
      decorateVisibleCarouselSlice(cards, latest);
      ensureCarouselControlsBar();
      hideBrowsePageFooter();
      syncNexusResultsHeadline(latest);
      return true;
    });
  }

  function getEffectiveResultsTotal(config, visibleCount) {
    if (!config) {
      return Math.max(visibleCount || 0, 0);
    }

    if (config.onlyTracked) {
      return getOnlyTrackedCatalogTotal(config);
    }

    if (isOnlyTrackedLivePreview(config)) {
      return getOnlyTrackedCatalogTotal(config);
    }

    if (isLocalCatalogMode(config)) {
      var catalogKey = getTrackedCatalogKey(config);
      if (enhancer.catalogSortedIdsKey === catalogKey &&
          typeof enhancer.catalogListingTotal === 'number' &&
          enhancer.catalogListingTotal >= 0) {
        return enhancer.catalogListingTotal;
      }
    }

    if (config.onlyTracked && hasTrackedCatalogData(config)) {
      return getOnlyTrackedCatalogTotal(config);
    }

    if (config.onlyInstalled && hasLocalCatalogData(config)) {
      var installedTotal = getInstalledCatalogModIds(config).length;
      if (installedTotal > 0) {
        return installedTotal;
      }
    }

    if (config.onlyInstalled) {
      return Object.keys(config.installed || {}).length;
    }

    if (isFilteredBrowseSession(config) || isNexusFilteredBrowse() || hasNumericNexusBrowseFilters()) {
      var pinnedFilteredTotal = getFilteredBrowseDisplayTotal();
      if (pinnedFilteredTotal > 0) {
        return pinnedFilteredTotal;
      }
    }

    var nexusTotal = parseNexusResultsTotal();
    var base = nexusTotal && nexusTotal > 0 ? nexusTotal : Math.max(visibleCount || 0, 0);

    if (config.hideInstalled && config.installed) {
      base = Math.max(0, base - Object.keys(config.installed).length);
    }

    if (config.hideTracked && config.tracked) {
      var hiddenTracked = 0;
      Object.keys(config.tracked).forEach(function (key) {
        if (config.tracked[key]) {
          hiddenTracked++;
        }
      });
      base = Math.max(0, base - hiddenTracked);
    }

    return base;
  }

  function getCarouselCatalogPages(pageSize, visibleCount, config) {
    var effectiveTotal;
    if (isLocalCatalogMode(config) || hasClientCarouselFilters(config)) {
      effectiveTotal = getEffectiveResultsTotal(config, 0);
    } else {
      effectiveTotal = getEffectiveResultsTotal(config, visibleCount);
    }
    if (effectiveTotal > 0) {
      return Math.max(1, Math.ceil(effectiveTotal / pageSize));
    }

    var loadedPages = Math.max(1, Math.ceil(Math.max(visibleCount, 1) / pageSize));
    var nexusTotal = parseNexusResultsTotal();
    if (nexusTotal && nexusTotal > 0) {
      return Math.max(loadedPages, Math.ceil(nexusTotal / pageSize));
    }
    return loadedPages;
  }

  function canFetchMoreCarouselBatches() {
    return !!getNextUnfetchedNexusPage() || canNavigateNexusResultsPage(1);
  }

  function getCarouselConfigKey(config) {
    return [
      config.gridColumns || 8,
      config.gridRows || 3,
      !!config.hideInstalled,
      !!config.onlyInstalled,
      !!config.hideTracked,
      !!config.onlyTracked,
    ].join('|');
  }

  function getVisibleCarouselCards(cards) {
    return cards.filter(function (entry) {
      return !entry.card.classList.contains('vortex-enhanced-hidden');
    });
  }

  function findNexusPaginationPageLink(pageNum) {
    if (!pageNum || pageNum < 1) {
      return null;
    }
    var target = String(pageNum);
    var navs = document.querySelectorAll('.vortex-enhanced-nexus-pagination-hide, nav, [role="navigation"]');
    for (var n = 0; n < navs.length; n++) {
      var nav = navs[n];
      if (!nav.querySelector('[aria-current="page"]')) {
        continue;
      }
      var links = nav.querySelectorAll('a, button');
      for (var j = 0; j < links.length; j++) {
        var link = links[j];
        if (isInsideCarouselControls(link)) {
          continue;
        }
        if (link.disabled || link.getAttribute('aria-disabled') === 'true') {
          continue;
        }
        var text = (link.textContent || '').trim();
        var aria = (link.getAttribute('aria-label') || '').trim();
        if (text === target || aria === ('Page ' + target) || aria === ('Go to page ' + target)) {
          return link;
        }
      }
    }
    return null;
  }

  function findNexusPaginationButton(direction) {
    var forward = direction > 0;
    var selectors = forward
      ? ['a[rel="next"]', 'button[rel="next"]', 'a[aria-label*="Next"]', 'button[aria-label*="Next"]']
      : ['a[rel="prev"]', 'button[rel="prev"]', 'a[aria-label*="Previous"]', 'button[aria-label*="Previous"]'];

    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && !isInsideCarouselControls(el) &&
          el.getAttribute('aria-disabled') !== 'true' && !el.disabled) {
        return el;
      }
    }

    var navs = document.querySelectorAll('.vortex-enhanced-nexus-pagination-hide, nav, [role="navigation"]');
    for (var n = 0; n < navs.length; n++) {
      var nav = navs[n];
      if (!nav.querySelector('[aria-current="page"]')) {
        continue;
      }
      var links = nav.querySelectorAll('a, button');
      for (var j = 0; j < links.length; j++) {
        var link = links[j];
        if (isInsideCarouselControls(link)) {
          continue;
        }
        if (link.disabled || link.getAttribute('aria-disabled') === 'true') {
          continue;
        }
        var label = (link.getAttribute('aria-label') || '').trim().toLowerCase();
        var text = (link.textContent || '').trim();
        if (forward) {
          if (label.indexOf('next') >= 0 || text === '>' || text === 'Next' || text === '\u203A') {
            return link;
          }
        } else if (label.indexOf('prev') >= 0 || text === '<' || text === 'Previous' || text === '\u2039') {
          return link;
        }
      }

      var current = nav.querySelector('[aria-current="page"]');
      if (current) {
        var sibling = forward ? current.nextElementSibling : current.previousElementSibling;
        while (sibling) {
          var candidate = sibling.matches('a, button') ? sibling : sibling.querySelector('a, button');
          if (candidate && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true') {
            var pageNum = (candidate.textContent || '').trim();
            if (/^\d+$/.test(pageNum)) {
              return candidate;
            }
          }
          sibling = forward ? sibling.nextElementSibling : sibling.previousElementSibling;
        }
      }
    }

    return null;
  }

  function stopAutoAdvance() {
    if (enhancer.autoAdvanceTimer) {
      clearInterval(enhancer.autoAdvanceTimer);
      enhancer.autoAdvanceTimer = null;
    }
  }

  function syncAutoAdvance(forceRestart) {
    if (!enhancer.autoAdvanceEnabled) {
      stopAutoAdvance();
      return;
    }
    if (enhancer.autoAdvanceTimer && !forceRestart) {
      return;
    }
    stopAutoAdvance();
    var ms = enhancer.autoAdvanceMs || 8000;
    enhancer.autoAdvanceTimer = setInterval(function () {
      var cfg = enhancer.config;
      if (cfg && isLocalCatalogMode(cfg) && enhancer.trackedCatalogActive) {
        if (enhancer.trackedCatalogFetchInFlight) {
          return;
        }
      } else if (enhancer.carouselAdvancePending || enhancer.fetchInFlightPage ||
          enhancer.nativeNavFetchInFlight || enhancer.pendingNativeCatalogFetch) {
        return;
      }
      advanceCarouselPage(1);
    }, ms);
  }

  function syncAutoAdvanceUi() {
    var controls = document.querySelector('.vortex-enhanced-carousel-controls');
    if (!controls) {
      return;
    }
    var toggle = controls.querySelector('[data-auto-advance-toggle]');
    var slider = controls.querySelector('[data-auto-advance-speed]');
    var label = controls.querySelector('[data-auto-advance-label]');
    if (toggle) {
      toggle.checked = !!enhancer.autoAdvanceEnabled;
    }
    if (slider) {
      slider.value = String(Math.round((enhancer.autoAdvanceMs || 8000) / 1000));
    }
    if (label) {
      label.textContent = String(Math.round((enhancer.autoAdvanceMs || 8000) / 1000)) + 's';
    }
  }

  function getBrowseSessionKeyFromHref(href) {
    try {
      var url = new URL(href, window.location.origin);
      url.hash = '';
      ['page', 'p', 'offset', 'count'].forEach(function (key) {
        url.searchParams.delete(key);
      });
      return url.pathname + '?' + url.searchParams.toString();
    } catch (err) {
      return '';
    }
  }

  function getBrowseSessionKey() {
    var key = getBrowseSessionKeyFromHref(getActiveBrowseHref());
    if (key) {
      return key;
    }
    return window.location.pathname;
  }

  function getBrowsePathname() {
    try {
      return new URL(window.location.href).pathname;
    } catch (err) {
      return window.location.pathname;
    }
  }

  function nodeHasVortexEnhancedUi(node) {
    if (!node) {
      return false;
    }
    if (node.getAttribute && node.getAttribute('data-vortex-enhanced-ui') === 'true') {
      return true;
    }
    if (node.id === 'vortex-enhanced-controls-bar' ||
        node.id === 'vortex-enhanced-controls-anchor' ||
        node.id === 'vortex-enhanced-carousel-controls') {
      return true;
    }
    if (node.classList && (
        node.classList.contains('vortex-enhanced-results-toolbar') ||
        node.classList.contains('vortex-enhanced-sort-toolbar-row') ||
        node.classList.contains('vortex-enhanced-controls-bar-fallback') ||
        node.classList.contains('vortex-enhanced-nexus-active-filters') ||
        node.classList.contains('vortex-enhanced-nexus-active-filters-shell')
    )) {
      return true;
    }
    if (node.querySelector && node.querySelector('[data-vortex-enhanced-ui="true"]')) {
      return true;
    }
    return false;
  }

  function getPagingStorageKey(sessionKey) {
    var key = sessionKey || getBrowseSessionKey();
    return 'vortex-enhanced-carousel:' + key;
  }

  function saveCarouselPagingStateForKey(sessionKey) {
    if (!sessionKey) {
      return;
    }
    try {
      sessionStorage.setItem(getPagingStorageKey(sessionKey), JSON.stringify({
        globalPageIndex: enhancer.globalPageIndex || 0,
        catalogModOffset: enhancer.catalogModOffset || 0,
        batchVisibleHistory: enhancer.batchVisibleHistory || [],
        nexusResultsPage: getNexusResultsPageFromUrl(),
        lastCarouselConfigKey: enhancer.lastCarouselConfigKey || '',
        pendingNexusBatchAdvance: !!enhancer.pendingNexusBatchAdvance,
        pendingBatchPrefetch: !!enhancer.pendingBatchPrefetch,
        pendingTargetPage: enhancer.pendingTargetPage,
        carouselAdvancePending: !!enhancer.carouselAdvancePending,
        scrollY: window.scrollY || 0,
      }));
    } catch (errSave) {
      // ignore quota / private mode
    }
  }

  function saveCarouselPagingState() {
    saveCarouselPagingStateForKey(getBrowseSessionKey());
  }

  function restoreCarouselPagingStateForKey(sessionKey) {
    if (!sessionKey) {
      return;
    }
    try {
      var raw = sessionStorage.getItem(getPagingStorageKey(sessionKey));
      if (!raw) {
        return;
      }
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') {
        return;
      }
      if (typeof saved.globalPageIndex === 'number' && saved.globalPageIndex >= 0) {
        enhancer.globalPageIndex = saved.globalPageIndex;
      }
      if (typeof saved.catalogModOffset === 'number' && saved.catalogModOffset >= 0) {
        enhancer.catalogModOffset = saved.catalogModOffset;
      }
      if (Array.isArray(saved.batchVisibleHistory)) {
        enhancer.batchVisibleHistory = saved.batchVisibleHistory.slice();
      }
      if (typeof saved.lastCarouselConfigKey === 'string' && saved.lastCarouselConfigKey) {
        enhancer.lastCarouselConfigKey = saved.lastCarouselConfigKey;
      }
      if (saved.pendingNexusBatchAdvance) {
        enhancer.pendingNexusBatchAdvance = true;
      }
      if (saved.pendingBatchPrefetch) {
        enhancer.pendingBatchPrefetch = true;
      }
      if (typeof saved.pendingTargetPage === 'number' && saved.pendingTargetPage >= 0) {
        enhancer.pendingTargetPage = saved.pendingTargetPage;
      }
      if (saved.carouselAdvancePending) {
        enhancer.carouselAdvancePending = true;
      }
      if (typeof saved.scrollY === 'number' && saved.scrollY >= 0) {
        enhancer.savedListScrollY = saved.scrollY;
      }
      var pageSize = getCarouselPageSize(enhancer.config);
      var localStart = getCatalogSliceStart(pageSize);
      enhancer.batchPageIndex = Math.max(0, Math.floor(localStart / pageSize));
    } catch (errRestore) {
      // ignore corrupt storage
    }
  }

  function restoreCarouselPagingState() {
    restoreCarouselPagingStateForKey(getBrowseSessionKey());
  }

  function clearCarouselPagingState() {
    try {
      sessionStorage.removeItem(getPagingStorageKey());
    } catch (err) {
      // ignore
    }
  }

  function resetGlobalPagingSoft() {
    clearCarouselPagingState();
    enhancer.globalPageIndex = 0;
    enhancer.batchPageIndex = 0;
    enhancer.catalogModOffset = 0;
    enhancer.batchVisibleHistory = [];
    enhancer.pagingStateHydrated = false;
    enhancer.tilePool = [];
    enhancer.pendingPoolFetch = false;
    enhancer.pendingTargetPage = null;
    enhancer.pendingNexusBatchAdvance = false;
    enhancer.pendingBatchPageIndex = null;
    enhancer.pendingBatchPrefetch = false;
    enhancer.prefetchBatchInFlight = false;
    enhancer.lastDomBatchKey = '';
    enhancer.prefetchAttempted = false;
    enhancer.fetchInFlightPage = null;
    enhancer.fetchedNexusPages = {};
    enhancer.nativeMergedPages = {};
    enhancer.nativeNavFetchInFlight = false;
    enhancer.nativeNavFetchTargetPage = null;
    enhancer.nativeNavFetchResolver = null;
    enhancer.nativeNavFetchDeadline = 0;
    enhancer.pendingNativeCatalogFetch = false;
    enhancer.carouselAdvancePending = false;
    enhancer.catalogIndicesBootstrapped = false;
    enhancer.catalogModIdToIndex = {};
    enhancer.lastAppliedSliceKey = '';
    enhancer.cacheFetchAttempts = 0;
    enhancer.cacheFetchInFlight = false;
    enhancer.nexusPageSizeAttempts = 0;
    enhancer.nexusPageSizePending = false;
    enhancer.filteredFillAttempts = 0;
    enhancer.filteredFillInFlight = false;
    enhancer.filteredBrowsePoolSessionKey = '';
    enhancer.filteredBrowseStableSessionKey = '';
    enhancer.trackedCatalogActive = false;
    enhancer.trackedCatalogKey = '';
    enhancer.trackedCatalogLoadedPage = -1;
    enhancer.trackedCatalogPageCache = {};
    enhancer.trackedSessionFetched = false;
    enhancer.trackedCatalogFetchInFlight = false;
  }

  function resetGlobalPaging() {
    resetGlobalPagingSoft();
    if (!isCarouselQuietPeriod()) {
      cleanupPoolArtifacts();
      enhancer.pendingPoolCleanup = false;
    } else {
      enhancer.pendingPoolCleanup = true;
    }
  }

  function getBatchPageIndex() {
    return enhancer.batchPageIndex || 0;
  }

  function resetTranslationFilters() {
    if (enhancer.userDismissedTranslationFilter) {
      enhancer.hideTranslationsApplied = false;
      enhancer.clientHideTranslations = false;
      enhancer.preferHideTranslations = false;
      enhancer.forceDefaultFilters = false;
    } else {
      enhancer.hideTranslationsApplied = true;
      enhancer.clientHideTranslations = true;
      enhancer.preferHideTranslations = true;
      enhancer.forceDefaultFilters = true;
    }
    enhancer.filtersOpenAttempts = 0;
    enhancer.translationUrlApplied = false;
    enhancer.translationUrlPending = false;
  }

  function isNexusResultsBatchSize(count) {
    return count === 20 || count === 40 || count === 80;
  }

  function shouldResetPoolForDomBatch(cards) {
    if (enhancer.cacheFetchInFlight || enhancer.pendingPoolFetch || enhancer.pendingNexusBatchAdvance) {
      return false;
    }
    if (enhancer.catalogModOffset > 0 || enhancer.globalPageIndex > 0) {
      return false;
    }
    if (enhancer.tilePool && enhancer.tilePool.length > 0) {
      return false;
    }
    if (!cards.length || !enhancer.tilePool.length || !enhancer.lastDomBatchKey) {
      return false;
    }
    var nextKey = String(cards.length);
    if (nextKey === enhancer.lastDomBatchKey) {
      return false;
    }
    return isNexusResultsBatchSize(cards.length) || isNexusResultsBatchSize(parseInt(enhancer.lastDomBatchKey, 10));
  }

  function syncPoolEntryMetadata(config) {
    for (var i = 0; i < enhancer.tilePool.length; i++) {
      var entry = enhancer.tilePool[i];
      if (!entry.modId) {
        continue;
      }
      entry.installed = config.installed[String(entry.modId)] || null;
      entry.tracked = !!(config.tracked && config.tracked[String(entry.modId)]);
      if (config.onlyInstalled) {
        entry.installed = entry.installed || { version: '' };
      }
      if (config.onlyTracked) {
        entry.tracked = true;
      }
    }
  }

  function applyPoolFilterClasses(config) {
    syncPoolEntryMetadata(config);
    for (var i = 0; i < enhancer.tilePool.length; i++) {
      var entry = enhancer.tilePool[i];
      var card = entry.card;
      var isInstalled = !!entry.installed;
      var isTracked = !!entry.tracked;
      var hide = false;

      if (config.onlyInstalled && !isInstalled) {
        hide = true;
      }
      if (config.hideInstalled && isInstalled) {
        hide = true;
      }
      if (config.onlyTracked && !isTracked) {
        hide = true;
      }
      if (config.hideTracked && isTracked) {
        hide = true;
      }

      if (shouldFilterTranslationsClientSide() && isTranslationModCard(card)) {
        hide = true;
      }

      card.classList.toggle('vortex-enhanced-hidden', hide);
    }
  }

  function getFilteredPoolEntries(config) {
    applyPoolFilterClasses(config);
    return enhancer.tilePool.filter(function (entry) {
      return !entry.card.classList.contains('vortex-enhanced-hidden');
    });
  }

  function mergeTilesIntoPool(cards, config) {
    var seen = {};
    for (var i = 0; i < enhancer.tilePool.length; i++) {
      if (enhancer.tilePool[i].modId) {
        seen[enhancer.tilePool[i].modId] = true;
      }
    }

    for (var j = 0; j < cards.length; j++) {
      var live = cards[j];
      if (!live.modId) {
        continue;
      }

      if (seen[live.modId]) {
        for (var k = 0; k < enhancer.tilePool.length; k++) {
          if (enhancer.tilePool[k].modId !== live.modId) {
            continue;
          }
          var entry = enhancer.tilePool[k];
          entry.installed = live.installed;
          entry.tracked = live.tracked;
          var liveLen = (live.card.textContent || '').replace(/\s+/g, '').length;
          var cloneLen = (entry.card.textContent || '').replace(/\s+/g, '').length;
          if (liveLen > cloneLen + 16) {
            var refreshed = live.card.cloneNode(true);
            refreshed.setAttribute('data-vortex-pool-tile', 'true');
            if (entry.card.parentElement) {
              entry.card.parentElement.replaceChild(refreshed, entry.card);
            } else {
              var poolHost = ensurePoolHost();
              if (poolHost) {
                poolHost.appendChild(refreshed);
              }
            }
            entry.card = refreshed;
          }
          break;
        }
        continue;
      }

      seen[live.modId] = true;
      var clone = live.card.cloneNode(true);
      clone.setAttribute('data-vortex-pool-tile', 'true');
      var catalogIndex = getMaxCatalogIndex() + 1;
      clone.setAttribute('data-vortex-catalog-index', String(catalogIndex));
      rememberCatalogIndex(live.modId, catalogIndex);
      var pool = ensurePoolHost();
      if (pool) {
        pool.appendChild(clone);
      }
      enhancer.tilePool.push({
        modId: live.modId,
        installed: live.installed,
        tracked: live.tracked,
        card: clone,
      });

      if (live.card.getAttribute('data-vortex-pool-tile') !== 'true') {
        live.card.classList.add('vortex-enhanced-nexus-live-hidden');
        var stash = ensureLiveStashHost();
        if (stash && live.card.parentElement !== stash) {
          stash.appendChild(live.card);
        }
      }
    }
  }

  function resolvePoolPageIndex(filtered, pageSize) {
    var totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    var page = enhancer.globalPageIndex;

    if (page < 0) {
      page = 0;
    }

    if (filtered.length === 0) {
      enhancer.globalPageIndex = 0;
      return 0;
    }

    var start = page * pageSize;
    if (start >= filtered.length) {
      page = Math.max(0, totalPages - 1);
      enhancer.globalPageIndex = page;
    }

    return page;
  }

  function renderPoolPage(config) {
    var grid = findModGrid();
    var pool = ensurePoolHost();
    if (!grid || !pool) {
      return;
    }

    var pageSize = getCarouselPageSize(config);
    var filtered = getFilteredPoolEntries(config);

    if (filtered.length === 0 && enhancer.tilePool.length === 0) {
      return;
    }

    if (enhancer.liveCarouselMode) {
      return;
    }

    var page = resolvePoolPageIndex(filtered, pageSize);
    var totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    var start = page * pageSize;
    var slice = filtered.slice(start, start + pageSize);

    if (slice.length === 0 && filtered.length > 0) {
      page = 0;
      enhancer.globalPageIndex = 0;
      enhancer.pendingTargetPage = null;
      start = 0;
      slice = filtered.slice(0, pageSize);
    }

    var liveTiles = grid.querySelectorAll(':scope > [data-e2eid="mod-tile"]:not([data-vortex-pool-tile])');
    for (var h = 0; h < liveTiles.length; h++) {
      liveTiles[h].classList.add('vortex-enhanced-nexus-live-hidden');
    }
    stashLiveTilesFromGrid(grid);

    var poolTiles = grid.querySelectorAll('[data-vortex-pool-tile="true"]');
    for (var p = 0; p < poolTiles.length; p++) {
      pool.appendChild(poolTiles[p]);
    }

    for (var i = 0; i < slice.length; i++) {
      var entry = slice[i];
      entry.card.classList.remove('vortex-enhanced-carousel-hidden');
      if (entry.card.parentElement !== grid) {
        grid.appendChild(entry.card);
      }
      decorateCard(entry.card, entry.modId, entry.installed, config);
    }

    updateCarouselControls(filtered.length, totalPages, pageSize, page);

    var pageModIds = [];
    for (var k = 0; k < slice.length; k++) {
      if (slice[k].modId) {
        pageModIds.push(slice[k].modId);
      }
    }
    pageModIds.sort(function (a, b) { return a - b; });
    var visibleKey = pageModIds.join(',');
    if (visibleKey !== enhancer.lastVisibleModsKey) {
      enhancer.lastVisibleModsKey = visibleKey;
      if (pageModIds.length > 0) {
        sendToHost({ type: 'visible-mods', modIds: pageModIds });
      }
    }
  }

  function decorateVisibleCarouselSlice(cards, config) {
    var pageSize = getCarouselPageSize(config);
    var catalogReady = isLocalCatalogMode(config) && isTrackedCatalogReady(config);
    if (!catalogReady) {
      applyFilters(cards, config);
    }
    var visible = catalogReady ? cards : getVisibleCarouselCards(cards);
    var localStart = catalogReady ? 0 : (isLocalCatalogMode(config) ? 0 : getCatalogSliceStart(pageSize));
    var slice = visible.slice(localStart, localStart + pageSize);
    var modIds = [];
    for (var i = 0; i < slice.length; i++) {
      decorateCard(slice[i].card, slice[i].modId, slice[i].installed, config);
      if (slice[i].modId) {
        modIds.push(slice[i].modId);
      }
    }
    scheduleModEnrichment(config, modIds);
  }

  function queryVisibleFilteredCarouselTiles(grid) {
    if (!grid) {
      return [];
    }
    return Array.prototype.slice.call(grid.querySelectorAll(
      ':scope > [data-e2eid="mod-tile"]:not(.vortex-enhanced-carousel-hidden):not(.vortex-enhanced-hidden)'
    ));
  }

  function dedupeLiveGridModTiles(config) {
    if (!config || !(urlHasActiveNexusFilters() || hasNumericNexusBrowseFilters() || isFilteredBrowseSession(config))) {
      return 0;
    }
    var grid = resolveNexusModGridElement() || findModGrid();
    if (!grid) {
      return 0;
    }
    var tiles = queryLiveGridModTiles(grid, { minDirect: 1 });
    if (tiles.length < 25) {
      return 0;
    }
    var keep = {};
    var hidden = 0;
    for (var i = tiles.length - 1; i >= 0; i--) {
      var tile = tiles[i];
      var modId = extractModIdFromTile(tile);
      if (!modId) {
        continue;
      }
      var key = String(modId);
      if (keep[key]) {
        tile.classList.add('vortex-enhanced-carousel-hidden');
        tile.style.setProperty('display', 'none', 'important');
        hidden++;
      } else {
        keep[key] = true;
      }
    }
    return hidden;
  }

  function scheduleFilteredBrowseConfigTouch(config, prevConfig, nextConfig) {
    if (!config || !isFilteredBrowseSession(config)) {
      return;
    }
    if (nextConfig && nextConfig.filterBrowseActive && (!prevConfig || !prevConfig.filterBrowseActive)) {
      resetFilteredBrowseCatalogState();
      resetFilteredBrowseTotalsState();
      enhancer.globalPageIndex = 0;
      enhancer.batchPageIndex = 0;
      enhancer.lastAppliedSliceKey = '';
      return;
    }
    if (enhancer.footerActionQuietUntil && Date.now() < enhancer.footerActionQuietUntil) {
      return;
    }
    if (enhancer.filteredBrowseConfigTouchTimer) {
      clearTimeout(enhancer.filteredBrowseConfigTouchTimer);
      enhancer.filteredBrowseConfigTouchTimer = null;
    }
    enhancer.filteredBrowseConfigTouchTimer = setTimeout(function () {
      enhancer.filteredBrowseConfigTouchTimer = null;
      var cfg = enhancer.config || config;
      if (!cfg || !isFilteredBrowseSession(cfg)) {
        return;
      }
      if (shouldUseNumericFilteredBrowseScan(cfg)) {
        return;
      }
      if (enhancer.footerActionQuietUntil && Date.now() < enhancer.footerActionQuietUntil) {
        return;
      }
      if (gridVisibleTilesNeedDecoration(cfg)) {
        decorateVisibleFilteredCarouselTiles(cfg);
      }
    }, 450);
  }

  function scheduleFilteredBrowseGridRefresh(config) {
    if (!config || !isFilteredBrowseSession(config)) {
      return;
    }
    var now = Date.now();
    if (enhancer.filteredBrowseGridRefreshWindowStart && now - enhancer.filteredBrowseGridRefreshWindowStart < 5000) {
      if ((enhancer.filteredBrowseGridRefreshCount || 0) >= 4) {
        return;
      }
    } else {
      enhancer.filteredBrowseGridRefreshWindowStart = now;
      enhancer.filteredBrowseGridRefreshCount = 0;
    }
    if (enhancer.filteredBrowseGridRefreshTimer) {
      clearTimeout(enhancer.filteredBrowseGridRefreshTimer);
      enhancer.filteredBrowseGridRefreshTimer = null;
    }
    enhancer.filteredBrowseGridRefreshTimer = setTimeout(function () {
      enhancer.filteredBrowseGridRefreshTimer = null;
      if (!isFilteredBrowseSession(config)) {
        return;
      }
      if (enhancer.filteredBrowseObserverBusy || enhancer.filteredBrowseEnhanceInFlight) {
        return;
      }
      if (enhancer.footerActionQuietUntil && Date.now() < enhancer.footerActionQuietUntil) {
        return;
      }
      enhancer.filteredBrowseGridRefreshCount = (enhancer.filteredBrowseGridRefreshCount || 0) + 1;
      enhancer.filteredBrowseObserverBusy = true;
      try {
        if (gridVisibleTilesNeedDecoration(config)) {
          decorateVisibleFilteredCarouselTiles(config);
        }
      } finally {
        enhancer.filteredBrowseObserverBusy = false;
      }
    }, 450);
  }

  function ensureFilteredBrowseGridObserver(config) {
    if (enhancer.filteredBrowseGridObserver) {
      enhancer.filteredBrowseGridObserver.disconnect();
      enhancer.filteredBrowseGridObserver = null;
      enhancer.filteredBrowseGridObserverHost = null;
    }
  }

  function decorateVisibleFilteredCarouselTiles(config) {
    if (!config) {
      return 0;
    }
    var grid = resolveNexusModGridElement() || findModGrid();
    if (!grid) {
      return 0;
    }
    var tiles = queryVisibleFilteredCarouselTiles(grid);
    if (tiles.length === 0) {
      tiles = queryLiveGridModTiles(grid, { minDirect: 1 }).filter(filteredBrowseTileIsDisplayed);
    }
    var modIds = [];
    var decorated = 0;
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      tile.classList.remove('vortex-enhanced-nexus-live-hidden');
      if (tile.style) {
        tile.style.removeProperty('display');
      }
      var modId = extractModIdFromTile(tile);
      var installedEntry = modId ? (config.installed[String(modId)] || null) : null;
      decorateCard(tile, modId, installedEntry, config);
      decorated++;
      if (modId) {
        modIds.push(modId);
      }
    }
    if (modIds.length) {
      scheduleModEnrichment(config, modIds);
    }
    return decorated;
  }

  function gridVisibleTilesNeedDecoration(config) {
    if (!config || !isFilteredBrowseSession(config)) {
      return false;
    }
    var grid = resolveNexusModGridElement() || findModGrid();
    if (!grid) {
      return true;
    }
    var tiles = queryVisibleFilteredCarouselTiles(grid);
    if (tiles.length === 0) {
      tiles = Array.prototype.slice.call(grid.querySelectorAll(
        '[data-e2eid="mod-tile"]:not(.vortex-enhanced-carousel-hidden):not(.vortex-enhanced-hidden)'
      ));
    }
    if (tiles.length < 4) {
      return false;
    }
    var sample = Math.min(tiles.length, 8);
    var missing = 0;
    for (var i = 0; i < sample; i++) {
      if (!tiles[i].querySelector('.vortex-enhanced-install, .vortex-enhanced-footer-actions, .vortex-enhanced-track')) {
        missing++;
      }
    }
    return missing >= Math.max(2, Math.floor(sample / 2));
  }

  function filteredBrowseTileIsDisplayed(tile) {
    if (!tile) {
      return false;
    }
    if (tile.classList.contains('vortex-enhanced-carousel-hidden') ||
        tile.classList.contains('vortex-enhanced-hidden') ||
        tile.classList.contains('vortex-enhanced-nexus-live-hidden')) {
      return false;
    }
    if (tile.style && tile.style.display === 'none') {
      return false;
    }
    return true;
  }

  function decorateFilteredPageTilesByModIds(config, showIds, pageEntries) {
    if (!config || !showIds) {
      return 0;
    }
    if (pageEntries && pageEntries.length) {
      var directIds = [];
      var directDecorated = 0;
      for (var p = 0; p < pageEntries.length; p++) {
        var entry = pageEntries[p];
        if (!entry || !entry.card || !entry.modId) {
          continue;
        }
        var directInstalled = config.installed[String(entry.modId)] || null;
        decorateCard(entry.card, entry.modId, directInstalled, config);
        directIds.push(entry.modId);
        directDecorated++;
      }
      if (directIds.length) {
        scheduleModEnrichment(config, directIds);
      }
      return directDecorated;
    }
    var grid = resolveNexusModGridElement() || findModGrid();
    if (!grid) {
      return 0;
    }
    var tiles = queryLiveGridModTiles(grid, { minDirect: 1, includePoolTiles: true });
    var modIds = [];
    var decorated = 0;
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      var modId = extractModIdFromTile(tile);
      if (!modId || !showIds[String(modId)]) {
        continue;
      }
      tile.classList.remove(
        'vortex-enhanced-carousel-hidden',
        'vortex-enhanced-nexus-live-hidden',
        'vortex-enhanced-hidden'
      );
      if (tile.style) {
        tile.style.removeProperty('display');
      }
      var installedEntry = config.installed[String(modId)] || null;
      decorateCard(tile, modId, installedEntry, config);
      decorated++;
      modIds.push(modId);
    }
    if (modIds.length) {
      scheduleModEnrichment(config, modIds);
    }
    return decorated;
  }

  function decorateVisibleGridTiles(config, options) {
    options = options || {};
    if (!config) {
      return 0;
    }
    var grid = resolveNexusModGridElement() || findModGrid();
    if (!grid) {
      return 0;
    }
    var tiles = queryLiveGridModTiles(grid, { minDirect: 1 });
    var modIds = [];
    var decorated = 0;
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      if (shouldUseNumericFilteredBrowseScan(config) &&
          tile.classList.contains('vortex-enhanced-carousel-hidden')) {
        continue;
      }
      if (!options.forceAll && !filteredBrowseTileIsDisplayed(tile)) {
        continue;
      }
      tile.classList.remove('vortex-enhanced-nexus-live-hidden');
      if (tile.style && !tile.classList.contains('vortex-enhanced-carousel-hidden')) {
        tile.style.removeProperty('display');
      }
      var modId = extractModIdFromTile(tile);
      var installedEntry = modId ? (config.installed[String(modId)] || null) : null;
      decorateCard(tile, modId, installedEntry, config);
      decorated++;
      if (modId) {
        modIds.push(modId);
      }
    }
    if (modIds.length) {
      scheduleModEnrichment(config, modIds);
    }
    return decorated;
  }

  function applyFilteredBrowseLiveOnlyPage(config, options) {
    options = options || {};
    if (!config || !isFilteredBrowseSession(config)) {
      return 0;
    }
    if (enhancer.carouselPagingQuietUntil && Date.now() < enhancer.carouselPagingQuietUntil &&
        !options.forcePageApply) {
      return 0;
    }
    clearStaleFilteredBrowseFetchLocks();
    ensureCarouselLayout(config);
    restoreMainBrowseContentVisibility();
    if (!(options.forcePageApply && options.skipDecorationRetry)) {
      applyFiltersToAllGridTiles(config);
      dedupeLiveGridModTiles(config);
    }

    var live = collectLiveGridCards(config);
    if (live.length < 4 && getFilteredCarouselVisibleEntries(config).length < 4) {
      var partialDecorated = decorateVisibleGridTiles(config, { forceAll: true });
      scheduleFilteredBrowseRescan(200);
      startFilteredBrowseDecorationWatchdog(config);
      return partialDecorated;
    }
    var visible = getFilteredCarouselVisibleEntries(config);
    var pageSize = getCarouselPageSize(config);
    var currentPage = Math.max(0, enhancer.globalPageIndex || 0);
    if (visible.length > 0) {
      var clampedLivePage = clampFilteredBrowseLivePageIndex(pageSize, visible.length, currentPage, options);
      if (clampedLivePage !== currentPage) {
        currentPage = clampedLivePage;
        enhancer.globalPageIndex = clampedLivePage;
        enhancer.batchPageIndex = clampedLivePage;
        saveCarouselPagingState();
      }
    }

    var start = currentPage * pageSize;
    var pageSlice = visible.slice(start, start + pageSize);
    if (pageSlice.length === 0 && visible.length > 0) {
      if (currentPage > 0) {
        enhancer.pendingTargetPage = currentPage;
        if (!enhancer.carouselAdvancePending && !enhancer.pendingNativeCatalogFetch) {
          enhancer.carouselAdvancePending = true;
          var pageFetchPromise = beginNexusBatchFetch(config, {
            allowNavigation: 'soft',
            forceSoftNavigation: true,
          });
          if (pageFetchPromise && typeof pageFetchPromise.then === 'function') {
            pageFetchPromise.then(function (ok) {
              enhancer.carouselAdvancePending = false;
              enhancer.pendingTargetPage = null;
              if (ok) {
                mergeLiveGridIntoPool(config);
                safeApplyFilteredBrowseLiveOnlyPage(config);
              }
            }).catch(function () {
              enhancer.carouselAdvancePending = false;
              enhancer.pendingTargetPage = null;
            });
          } else {
            enhancer.carouselAdvancePending = false;
            enhancer.pendingTargetPage = null;
          }
        }
        return 0;
      }
      currentPage = 0;
      enhancer.globalPageIndex = 0;
      enhancer.batchPageIndex = 0;
      start = 0;
      pageSlice = visible.slice(0, pageSize);
      saveCarouselPagingState();
    }

    var showIds = {};
    var pageModIds = [];
    for (var s = 0; s < pageSlice.length; s++) {
      if (pageSlice[s].modId) {
        showIds[String(pageSlice[s].modId)] = true;
        pageModIds.push(pageSlice[s].modId);
      }
    }
    pageModIds.sort(function (a, b) { return a - b; });

    var grid = resolveNexusModGridElement() || findModGrid();
    var stash = ensureLiveStashHost();
    for (var showIdx = 0; showIdx < pageSlice.length; showIdx++) {
      var sliceEntry = pageSlice[showIdx];
      var sliceCard = sliceEntry && sliceEntry.card;
      if (!sliceCard) {
        continue;
      }
      if (grid && sliceCard.isConnected && grid.contains(sliceCard)) {
        sliceCard.classList.remove(
          'vortex-enhanced-carousel-hidden',
          'vortex-enhanced-nexus-live-hidden',
          'vortex-enhanced-hidden'
        );
        sliceCard.style.removeProperty('display');
      } else if (grid) {
        setCarouselTileVisibility(sliceCard, true, grid, null, stash);
      }
    }
    if (grid) {
      // Fetched cards retain data-vortex-pool-tile after being mounted in the
      // live grid. Include them here or a prior fetched page remains visible
      // while only the page counter advances.
      grid.querySelectorAll(
        '[data-e2eid="mod-tile"]:not(.vortex-enhanced-carousel-hidden), ' +
        '[data-e2eid="mod-tile"]:not([style*="display: none"])'
      ).forEach(function (tile) {
        var tileModId = extractModIdFromTile(tile);
        var showTile = !!(tileModId && showIds[String(tileModId)]);
        if (showTile) {
          tile.classList.remove(
            'vortex-enhanced-carousel-hidden',
            'vortex-enhanced-nexus-live-hidden',
            'vortex-enhanced-hidden'
          );
          tile.style.removeProperty('display');
        } else {
          tile.classList.add('vortex-enhanced-carousel-hidden');
          tile.style.setProperty('display', 'none', 'important');
        }
      });
    }
    if (stash) {
      stash.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').forEach(function (tile) {
        var stashedModId = extractModIdFromTile(tile);
        if (stashedModId && showIds[String(stashedModId)] && grid) {
          setCarouselTileVisibility(tile, true, grid, null, stash);
        } else {
          tile.classList.add('vortex-enhanced-carousel-hidden');
          tile.style.setProperty('display', 'none', 'important');
        }
      });
    }

    var decorated = decorateFilteredPageTilesByModIds(config, showIds, pageSlice);
    if (decorated < Math.min(pageSlice.length, 4)) {
      decorated = decorateVisibleGridTiles(config);
    }
    installCarouselWheelHandler();

    var controlVisibleCount = getEffectiveResultsTotal(config, visible.length);
    var batchPages = Math.max(1, Math.ceil(Math.max(controlVisibleCount, 1) / pageSize));
    enhancer.batchPageIndex = currentPage;
    enhancer.lastAppliedSliceKey = getCarouselSliceKey(pageSize, pageModIds);
    updateCarouselControls(controlVisibleCount, batchPages, pageSize, currentPage);
    ensureCarouselControlsBar();
    protectBrowseControlsFromChromeHide();
    hideBrowsePageFooter();
    if (!options.skipHeadlineSync) {
      pinNexusFilteredResultsTotal();
      syncNexusFilteredResultsHeadlines();
      scheduleFilteredResultsHeadlineResync();
    } else {
      refreshCarouselControlsFilteredTotal();
    }
    syncNexusResultsHeadline(config);

    var visibleKey = pageModIds.join(',');
    if (visibleKey !== enhancer.lastVisibleModsKey) {
      enhancer.lastVisibleModsKey = visibleKey;
      if (pageModIds.length > 0) {
        sendToHost({ type: 'visible-mods', modIds: pageModIds });
      }
    }

    decorated += decorateVisibleFilteredCarouselTiles(config);
    if (!options.skipDecorationRetry) {
      scheduleFilteredBrowseDecorationRetry(config);
    }
    return decorated;
  }

  function applyFilteredBrowseCarouselPage(config, cards) {
    if (!config) {
      return;
    }
    if (filteredBrowseUsesLiveCatalogOnly()) {
      applyFilteredBrowseLiveOnlyPage(config);
      return;
    }
    clearStaleFilteredBrowseFetchLocks();
    ensureCarouselLayout(config);
    restoreMainBrowseContentVisibility();
    if (!cards || !cards.length) {
      cards = collectCards(config);
    }
    applyDismissedCatalogCarouselPage(cards, config);
    decorateVisibleGridTiles(config);
    installCarouselWheelHandler();
    hideBrowsePageFooter();
    protectBrowseControlsFromChromeHide();
    scheduleFilteredBrowseDecorationRetry(config);
  }

  function refreshClientFilterCarousel(config) {
    if (!config || isLocalCatalogMode(config)) {
      return;
    }
    enhancer.lastAppliedSliceKey = '';
    enhancer.globalPageIndex = 0;
    saveCarouselPagingState();
    var liveCards = collectCards(config);
    applyFilters(liveCards, config);
    applyFiltersToAllGridTiles(config);
    applyLiveCarouselPage(liveCards, config);
    decorateVisibleCarouselSlice(liveCards, config);
    syncNexusResultsHeadline(config);
    ensureCarouselControlsBar();
  }

  function resolveLocalCatalogPageReady(page, config) {
    if (restoreTrackedCatalogPageFromCache(page, config)) {
      markLocalCatalogBootstrapped();
      return true;
    }
    return isTrackedCatalogReady(config);
  }

  function applyLiveCarouselPage(cards, config) {
    if (config && isLocalCatalogMode(config) && enhancer.trackedCatalogActive && isTrackedCatalogReady(config)) {
      showTrackedCatalogPage(config);
      return;
    }
    if (isOnlyTrackedLivePreview(config)) {
      showOnlyTrackedLoadingState(config);
      return;
    }
    if (enhancer.nativeNavFetchInFlight || enhancer.pendingNativeCatalogFetch) {
      if (!enhancer.filteredBrowseHostBatchInFlight ||
          enhancer.filteredBrowseHostBatchPhase === 'forward') {
        return;
      }
    }
    if (isPooledNexusCarouselBrowseMode(config) && !filteredBrowseUsesLiveCatalogOnly()) {
      applyDismissedCatalogCarouselPage(cards, config);
      return;
    }
    if (enhancer.applyingCarouselPage) {
      return;
    }
    var scanGeneration = enhancer.scanGeneration || 0;
    enhancer.applyingCarouselPage = true;

    try {
    var pageSize = getCarouselPageSize(config);
    var grid = (config && isLocalCatalogMode(config) && enhancer.trackedCatalogActive && isTrackedCatalogReady(config))
      ? getCarouselDisplayGrid(config)
      : resolveNexusModGridElement();
    var poolHost = ensurePoolHost();
    var stash = ensureLiveStashHost();

    if (isLocalCatalogMode(config) && isTrackedCatalogReady(config)) {
      stashLiveNexusTilesForLocalCatalog(config);
    } else if (!isLocalCatalogMode(config) || isOnlyTrackedLivePreview(config)) {
      restoreStashedLiveNexusTiles();
    }

    applyFilters(cards, config);
    applyFiltersToAllGridTiles(config);
    var visible = sortCatalogEntries(getVisibleCarouselCards(cards));
    var previewMode = isOnlyTrackedLivePreview(config);
    var controlVisibleCount = getEffectiveResultsTotal(config, visible.length);
    if (previewMode || (isLocalCatalogMode(config) && hasLocalCatalogData(config))) {
      clampGlobalPageIndex(pageSize, controlVisibleCount);
    } else if (!isLocalCatalogMode(config)) {
      clampGlobalPageIndex(pageSize, visible.length);
    }
    var catalogReady = isLocalCatalogMode(config) && hasLocalCatalogData(config) &&
      enhancer.trackedCatalogActive && isTrackedCatalogReady(config);
    var localStart = catalogReady ? 0 : getCatalogSliceStart(pageSize);
    var localEnd = localStart + pageSize;
    var batchPages = Math.max(1, Math.ceil(Math.max(controlVisibleCount, 1) / pageSize));

    enhancer.batchPageIndex = Math.max(0, Math.floor(localStart / pageSize));

    var slice = visible.slice(localStart, localEnd);
    if (slice.length < pageSize &&
        localStart + pageSize > visible.length &&
        enhancer.globalPageIndex > 0) {
      var clampedPage = urlHasActiveNexusFilters()
        ? clampFilteredBrowseLivePageIndex(pageSize, visible.length, enhancer.globalPageIndex, {})
        : getMaxFullCarouselPageIndex(pageSize, visible.length);
      if (enhancer.globalPageIndex > clampedPage) {
        enhancer.globalPageIndex = clampedPage;
        enhancer.batchPageIndex = clampedPage;
        saveCarouselPagingState();
        localStart = getCatalogSliceStart(pageSize);
        localEnd = localStart + pageSize;
        slice = visible.slice(localStart, localEnd);
        if (isDismissedCarouselBrowseMode(config) && canFetchMoreCarouselBatches()) {
          maybePrefetchDismissedLiveBatch(config);
        }
      }
    }
    var pageModIds = [];
    for (var k = 0; k < slice.length; k++) {
      if (slice[k].modId) {
        pageModIds.push(slice[k].modId);
      }
    }
    pageModIds.sort(function (a, b) { return a - b; });
    var sliceKey = getCarouselSliceKey(pageSize, pageModIds);
    if (sliceKey === enhancer.lastAppliedSliceKey) {
      updateCarouselControls(controlVisibleCount, batchPages, pageSize, enhancer.batchPageIndex);
      if (slice.length > 0 && (hasClientCarouselFilters(config) || isLocalCatalogMode(config))) {
        showCarouselSlice(slice, grid, poolHost, stash, config);
      } else if (slice.length > 0) {
        for (var re = 0; re < slice.length; re++) {
          setCarouselTileVisibility(slice[re].card, true, grid, poolHost, stash);
          decorateCard(slice[re].card, slice[re].modId, slice[re].installed, config);
        }
      }
      return;
    }
    enhancer.lastAppliedSliceKey = sliceKey;

    if (isOnlyTrackedCatalogLoading(config) && slice.length === 0) {
      if (enhancer.trackedCatalogFetchInFlight) {
        updateCarouselControls(controlVisibleCount, batchPages, pageSize, enhancer.batchPageIndex);
        return;
      }
      if (enhancer.trackedCatalogFetchInFlight && enhancer.tilePool.length > 0) {
        updateCarouselControls(controlVisibleCount, batchPages, pageSize, enhancer.batchPageIndex);
        return;
      }
      updateCarouselControls(controlVisibleCount, batchPages, pageSize, enhancer.batchPageIndex);
      return;
    }

    var useLiveOnlyPaging = !enhancer.tilePool || enhancer.tilePool.length === 0;
    if (urlHasActiveNexusFilters() && filteredBrowseUsesLiveCatalogOnly()) {
      useLiveOnlyPaging = true;
    } else if (isDismissedCarouselBrowseMode(config) &&
        !dismissedLiveGridCoversCarouselPage(config, enhancer.globalPageIndex || 0)) {
      useLiveOnlyPaging = false;
    } else if (!useLiveOnlyPaging && grid && sliceCardsSatisfiedByLiveGrid(slice, grid)) {
      useLiveOnlyPaging = true;
    }
    if (useLiveOnlyPaging && grid) {
      var sliceModIds = {};
      var sliceConnected = false;
      for (var sm = 0; sm < slice.length; sm++) {
        if (slice[sm].modId) {
          sliceModIds[String(slice[sm].modId)] = true;
        }
        if (slice[sm].card && slice[sm].card.isConnected) {
          sliceConnected = true;
        }
      }
      if (slice.length > 0 && !sliceConnected) {
        enhancer.lastAppliedSliceKey = '';
        unhideAllCarouselTiles();
        var freshCards = usesMergedCarouselPool() ? collectCards(config) : collectLiveGridCards(config);
        applyFilters(freshCards, config);
        visible = sortCatalogEntries(getVisibleCarouselCards(freshCards));
        slice = visible.slice(localStart, localEnd);
        sliceModIds = {};
        for (var rf = 0; rf < slice.length; rf++) {
          if (slice[rf].modId) {
            sliceModIds[String(slice[rf].modId)] = true;
          }
        }
      }
      var matchedVisible = 0;
      grid.querySelectorAll('[data-e2eid="mod-tile"]').forEach(function (tile) {
        var tileModId = extractModIdFromTile(tile);
        var showTile = slice.length === 0 || !!(tileModId && sliceModIds[String(tileModId)]);
        tile.classList.remove('vortex-enhanced-nexus-live-hidden', 'vortex-enhanced-carousel-hidden');
        if (tile.style) {
          tile.style.removeProperty('display');
        }
        if (!showTile) {
          tile.classList.add('vortex-enhanced-carousel-hidden');
          tile.style.setProperty('display', 'none', 'important');
        } else {
          matchedVisible++;
          var installedEntry = tileModId ? (config.installed[String(tileModId)] || null) : null;
          decorateCard(tile, tileModId, installedEntry, config);
        }
      });
      if (slice.length > 0 && matchedVisible === 0) {
        enhancer.lastAppliedSliceKey = '';
        unhideAllCarouselTiles();
        var fallbackCards = usesMergedCarouselPool() ? collectCards(config) : collectLiveGridCards(config);
        applyFilters(fallbackCards, config);
        visible = sortCatalogEntries(getVisibleCarouselCards(fallbackCards));
        slice = visible.slice(localStart, localEnd);
        for (var fb = 0; fb < slice.length; fb++) {
          setCarouselTileVisibility(slice[fb].card, true, grid, poolHost, stash);
          decorateCard(slice[fb].card, slice[fb].modId, slice[fb].installed, config);
        }
        updateCarouselControls(getEffectiveResultsTotal(config, visible.length),
          Math.max(1, Math.ceil(Math.max(getEffectiveResultsTotal(config, visible.length), 1) / pageSize)),
          pageSize, enhancer.batchPageIndex);
        return;
      }
    } else {
      hideAllCarouselTiles(grid, poolHost, stash);
    }

    var shown = 0;
    for (var j = 0; j < slice.length; j++) {
      if (scanGeneration !== enhancer.scanGeneration) {
        if (shown > 0) {
          break;
        }
        enhancer.applyingCarouselPage = false;
        return;
      }
      setCarouselTileVisibility(slice[j].card, true, grid, poolHost, stash);
      decorateCard(slice[j].card, slice[j].modId, slice[j].installed, config);
      shown++;
    }

    if (shown === 0 && slice.length > 0) {
      unhideAllCarouselTiles();
      for (var fb = 0; fb < slice.length; fb++) {
        var liveCard = slice[fb].card;
        if (!liveCard) {
          continue;
        }
        liveCard.classList.remove('vortex-enhanced-carousel-hidden', 'vortex-enhanced-nexus-live-hidden');
        if (liveCard.style) {
          liveCard.style.removeProperty('display');
        }
        if (grid && liveCard.parentElement !== grid) {
          grid.appendChild(liveCard);
        }
        decorateCard(liveCard, slice[fb].modId, slice[fb].installed, config);
        shown++;
      }
    }

    if (shown === 0 && slice.length > 0) {
      for (var rescue = 0; rescue < slice.length; rescue++) {
        setCarouselTileVisibility(slice[rescue].card, true, grid, poolHost, stash);
        decorateCard(slice[rescue].card, slice[rescue].modId, slice[rescue].installed, config);
        shown++;
      }
    }

    if (shown === 0 && isDismissedCarouselBrowseMode(config) &&
        !dismissedLiveGridCoversCarouselPage(config, enhancer.globalPageIndex || 0) &&
        canFetchMoreCarouselBatches()) {
      maybePrefetchDismissedLiveBatch(config);
    }

    if (shown === 0 && slice.length > 0) {
      return;
    }

    updateCarouselControls(controlVisibleCount, batchPages, pageSize, enhancer.batchPageIndex);

    var visibleKey = pageModIds.join(',');
    if (visibleKey !== enhancer.lastVisibleModsKey) {
      enhancer.lastVisibleModsKey = visibleKey;
      if (pageModIds.length > 0) {
        sendToHost({ type: 'visible-mods', modIds: pageModIds });
      }
    }

    if (!config.onlyTracked) {
      maybePrefetchNextBatch(config, cards);
    }
    if (isPooledNexusCarouselBrowseMode(config)) {
      installCarouselWheelHandler();
      hideBrowsePageFooter();
      protectBrowseControlsFromChromeHide();
    }
    } finally {
      enhancer.applyingCarouselPage = false;
    }
  }

  function ensureFilteredCatalogFill(config) {
    if (config.onlyTracked) {
      return;
    }
    if (isFilteredBrowseSession(config) && filteredBrowseUsesLiveCatalogOnly()) {
      return;
    }
    if (!hasClientCarouselFilters(config)) {
      return;
    }
    if (enhancer.filteredFillInFlight || enhancer.cacheFetchInFlight || enhancer.fetchInFlightPage) {
      return;
    }
    if (enhancer.pendingPoolFetch || enhancer.pendingNexusBatchAdvance) {
      return;
    }

    var pageSize = getCarouselPageSize(config);
    var filteredCount = getFilteredPoolEntries(config).length;
    if (filteredCount >= pageSize) {
      enhancer.filteredFillAttempts = 0;
      return;
    }
    if (!canFetchMoreCarouselBatches()) {
      return;
    }
    if ((enhancer.filteredFillAttempts || 0) >= 12) {
      return;
    }

    enhancer.filteredFillInFlight = true;
    enhancer.filteredFillAttempts = (enhancer.filteredFillAttempts || 0) + 1;
    beginNexusBatchFetch(config, { allowNavigation: false }).then(function (ok) {
      enhancer.filteredFillInFlight = false;
      if (ok && window.__vortexBrowseEnhancer) {
        window.__vortexBrowseEnhancer.scheduleScan(true);
      }
    });
  }

  function prefetchPoolFill(config) {
    if (enhancer.liveCarouselMode || enhancer.pendingPoolFetch || enhancer.pendingTargetPage !== null) {
      return;
    }
    if (enhancer.globalPageIndex !== 0 || enhancer.prefetchAttempted) {
      return;
    }

    var pageSize = getCarouselPageSize(config);
    var filtered = getFilteredPoolEntries(config);
    if (filtered.length >= pageSize) {
      return;
    }

    enhancer.prefetchAttempted = true;
    navigateNexusResultsPage(1);
  }

  function getLocalCarouselPage(config) {
    return getBatchPageIndex();
  }

  function refreshCarouselControlsFilteredTotal(options) {
    options = options || {};
    if (enhancer.refreshingCarouselControlsFilteredTotal) {
      return;
    }
    var config = enhancer.config;
    if (!config || !document.querySelector('.vortex-enhanced-carousel-controls')) {
      return;
    }
    enhancer.refreshingCarouselControlsFilteredTotal = true;
    try {
      var pageSize = getCarouselPageSize(config);
      var visible = 0;
      if (options.skipCatalogResolve) {
        visible = (enhancer.filteredCarouselCatalog || []).length;
      } else if (isFilteredBrowseSession(config)) {
        visible = getFilteredCarouselVisibleEntries(config).length;
      } else {
        visible = collectCards(config).length;
      }
      var displayTotal = options.displayTotal > 0
        ? options.displayTotal
        : (getFilteredBrowseDisplayTotal() || getEffectiveResultsTotal(config, visible));
      var catalogPages = options.catalogPages > 0
        ? options.catalogPages
        : Math.max(1, Math.ceil(Math.max(displayTotal, visible) / pageSize));
      updateCarouselControls(
        displayTotal,
        catalogPages,
        pageSize,
        enhancer.globalPageIndex || 0,
        {
          skipCatalogResolve: !!options.skipCatalogResolve,
          loadedCatalogCount: visible,
          displayTotal: displayTotal,
          catalogPages: catalogPages,
        }
      );
    } finally {
      enhancer.refreshingCarouselControlsFilteredTotal = false;
    }
  }

  function updateCarouselControls(visibleCount, batchPages, pageSize, batchPage, options) {
    options = options || {};
    var controls = document.querySelector('.vortex-enhanced-carousel-controls');
    if (!controls) {
      return;
    }

    var config = enhancer.config || {};
    var pageDisplay = controls.querySelector('[data-carousel-page]');
    var countDisplay = controls.querySelector('[data-carousel-count]');
    var loadedCatalogCount = visibleCount;
    if (isFilteredBrowseSession(config)) {
      if (options.loadedCatalogCount != null) {
        loadedCatalogCount = options.loadedCatalogCount;
      } else {
        loadedCatalogCount = enhancer.filteredCarouselCatalog ? enhancer.filteredCarouselCatalog.length : 0;
        if (loadedCatalogCount <= 0 && !options.skipCatalogResolve) {
          loadedCatalogCount = getFilteredCarouselVisibleEntries(config).length;
        }
      }
    }
    var catalogPages;
    if (options.catalogPages > 0) {
      catalogPages = options.catalogPages;
    } else if (options.displayTotal > 0) {
      catalogPages = Math.max(1, Math.ceil(options.displayTotal / pageSize));
    } else {
      catalogPages = getCarouselCatalogPages(pageSize, visibleCount, config);
    }

    if (pageDisplay) {
      pageDisplay.textContent = 'Page ' + (enhancer.globalPageIndex + 1) + ' of ' + catalogPages;
    }
    if (countDisplay) {
      var grid = findModGrid();
      var onPage = 0;
      if (grid) {
        onPage = grid.querySelectorAll(
          ':scope > [data-e2eid="mod-tile"]:not(.vortex-enhanced-carousel-hidden):not(.vortex-enhanced-hidden)'
        ).length;
      }
      if (visibleCount <= 0) {
        countDisplay.textContent = 'No mods match the current filters';
      } else if (hasClientCarouselFilters(config) || isLocalCatalogMode(config)) {
        var filteredStart = enhancer.globalPageIndex * pageSize + 1;
        var filteredEnd = onPage > 0
          ? Math.min(filteredStart + onPage - 1, visibleCount)
          : Math.min(filteredStart + pageSize - 1, visibleCount);
        countDisplay.textContent = 'Showing ' + filteredStart + '\u2013' + filteredEnd +
          ' of ' + visibleCount + ' matching \u00b7 ' + pageSize + ' per page';
      } else if (isLocalCatalogMode(config) && hasLocalCatalogData(config) && onPage === 0 &&
          !isTrackedCatalogReady(config)) {
        countDisplay.textContent = 'Loading catalog...';
      } else if (isFilteredBrowseSession(config) || isNexusFilteredBrowse() ||
          shouldUseNumericFilteredBrowseScan(config)) {
        var filteredDisplayTotal = options.displayTotal > 0
          ? options.displayTotal
          : getLockedNexusFilteredDisplayTotal();
        if (!filteredDisplayTotal && shouldUseNumericFilteredBrowseScan(config)) {
          filteredDisplayTotal = Math.max(
            visibleCount,
            loadedCatalogCount,
            (enhancer.filteredCarouselCatalog || []).length,
            pageSize
          );
        }
        if (!filteredDisplayTotal) {
          filteredDisplayTotal = getFilteredBrowseDisplayTotal() ||
            getEffectiveResultsTotal(config, visibleCount);
        }
        var filteredStart = enhancer.globalPageIndex * pageSize + 1;
        var filteredEnd = Math.min(filteredStart + Math.max(onPage, pageSize) - 1, filteredDisplayTotal);
        countDisplay.textContent = 'Showing ' + filteredStart + '\u2013' + filteredEnd +
          ' of ' + filteredDisplayTotal + ' results \u00b7 ' + pageSize + ' per page';
      } else {
        var nexusTotal = parseNexusResultsTotal();
        var displayTotal = visibleCount > 0 ? visibleCount : (nexusTotal || 0);
        var filteredStart = enhancer.globalPageIndex * pageSize + 1;
        var filteredEnd = Math.min(filteredStart + Math.max(onPage, 1) - 1, displayTotal);
        if (nexusTotal && nexusTotal > 0) {
          countDisplay.textContent = 'Showing ' + filteredStart + '\u2013' + filteredEnd +
            ' of ' + displayTotal + ' matching \u00b7 ' + pageSize + ' per page';
        } else {
          var start = onPage > 0 ? (enhancer.globalPageIndex * pageSize + 1) : 0;
          var end = onPage > 0 ? (start + onPage - 1) : 0;
          countDisplay.textContent = onPage > 0
            ? ('Showing ' + start + '\u2013' + end + ' \u00b7 ' + pageSize + ' per page')
            : ('Showing ' + start + '\u2013' + end + ' \u00b7 ' + pageSize + ' per page');
        }
      }
    }

    var prevBtn = controls.querySelector('[data-carousel="-1"]');
    var nextBtn = controls.querySelector('[data-carousel="1"]');
    if (prevBtn) {
      prevBtn.disabled = enhancer.globalPageIndex <= 0;
    }
    if (nextBtn) {
      var nextPageStart = (enhancer.globalPageIndex + 1) * pageSize;
      var hasLoadedNext = isFilteredBrowseSession(config)
        ? nextPageStart < loadedCatalogCount
        : nextPageStart < visibleCount;
      if (config.onlyTracked && hasTrackedCatalogData(config)) {
        nextBtn.disabled = catalogPages > 0 && (enhancer.globalPageIndex + 1) >= catalogPages;
      } else if (isLocalCatalogMode(config) && hasLocalCatalogData(config)) {
        nextBtn.disabled = catalogPages > 0 && (enhancer.globalPageIndex + 1) >= catalogPages;
      } else if (hasClientCarouselFilters(config)) {
        nextBtn.disabled = !hasLoadedNext && !canFetchMoreCarouselBatches();
      } else if (isFilteredBrowseSession(config) || shouldUseNumericFilteredBrowseScan(config)) {
        var filteredCanFetch = canFetchMoreCarouselBatches();
        var filteredLoadedCount = options.loadedCatalogCount != null
          ? options.loadedCatalogCount
          : (enhancer.filteredCarouselCatalog ? enhancer.filteredCarouselCatalog.length : 0);
        if (filteredLoadedCount <= 0 && !options.skipCatalogResolve &&
            !shouldUseNumericFilteredBrowseScan(config)) {
          filteredLoadedCount = getFilteredCarouselVisibleEntries(config).length;
        }
        if (filteredLoadedCount <= 0 && shouldUseNumericFilteredBrowseScan(config)) {
          filteredLoadedCount = document.querySelectorAll(
            '[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])'
          ).length;
        }
        var filteredLoadedNext = (enhancer.globalPageIndex + 1) * pageSize < filteredLoadedCount;
        var filteredNexusTotal = options.displayTotal > 0
          ? options.displayTotal
          : getLockedNexusFilteredDisplayTotal();
        if (!filteredNexusTotal && shouldUseNumericFilteredBrowseScan(config)) {
          filteredNexusTotal = Math.max(filteredLoadedCount, visibleCount, pageSize * 2);
        }
        if (!filteredNexusTotal && !shouldUseNumericFilteredBrowseScan(config)) {
          filteredNexusTotal = getFilteredBrowseDisplayTotal() || parseNexusResultsTotal() || 0;
        }
        var filteredTotalPages = filteredNexusTotal > 0
          ? Math.max(catalogPages, Math.ceil(filteredNexusTotal / pageSize))
          : catalogPages;
        var filteredAtEnd = filteredTotalPages > 0 &&
          (enhancer.globalPageIndex + 1) >= filteredTotalPages;
        nextBtn.disabled = !filteredLoadedNext && !hasLoadedNext && !filteredCanFetch && filteredAtEnd;
        if (!filteredLoadedNext && !hasLoadedNext && (filteredCanFetch || filteredLoadedCount >= pageSize)) {
          nextBtn.disabled = false;
        }
      } else {
        var needsNexusFetch = !hasLoadedNext;
        var canFetchMore = canFetchMoreCarouselBatches();
        var atCatalogEnd = catalogPages > 0 && (enhancer.globalPageIndex + 1) >= catalogPages;
        nextBtn.disabled = needsNexusFetch && !canFetchMore && atCatalogEnd;
      }
    }
  }

  function reportVisibleModsForPage(visibleCards, pageSize, localPage) {
    var start = localPage * pageSize;
    var slice = visibleCards.slice(start, start + pageSize);
    var modIds = [];
    for (var i = 0; i < slice.length; i++) {
      if (slice[i].modId) {
        modIds.push(slice[i].modId);
      }
    }

    modIds.sort(function (a, b) { return a - b; });
    var key = modIds.join(',');
    if (key === enhancer.lastVisibleModsKey) {
      return;
    }

    enhancer.lastVisibleModsKey = key;
    if (modIds.length > 0) {
      sendToHost({ type: 'visible-mods', modIds: modIds });
    }
  }

  function tryAdvanceFilteredForward(config, attempt) {
    if (config && isLocalCatalogMode(config) && enhancer.trackedCatalogActive && isTrackedCatalogReady(config)) {
      enhancer.carouselAdvancePending = false;
      return;
    }
    attempt = attempt || 0;
    if (attempt > 10) {
      enhancer.carouselAdvancePending = false;
      applyLiveCarouselPage(collectCards(config), config);
      return;
    }

    if (config && config.onlyTracked && canActivateTrackedCatalog(config) && !isTrackedCatalogReady(config)) {
      var catalogCount = getTrackedCatalogModIds(config).length;
      var pageSize = getCarouselPageSize(config);
      var catalogNextStart = (enhancer.globalPageIndex + 1) * pageSize;
      if (catalogNextStart >= catalogCount) {
        enhancer.carouselAdvancePending = false;
        return;
      }
      ensureLocalCatalogInitialized(config);
      if (!enhancer.trackedCatalogFetchInFlight && !enhancer.localCatalogBootstrapped) {
        applyTrackedCatalogView(config);
      }
      enhancer.globalPageIndex += 1;
      enhancer.lastAppliedSliceKey = '';
      saveCarouselPagingState();
      navigateTrackedCatalogPage(config).then(function (ok) {
        enhancer.carouselAdvancePending = false;
        if (!ok) {
          enhancer.globalPageIndex = Math.max(0, enhancer.globalPageIndex - 1);
          saveCarouselPagingState();
          applyLiveCarouselPage(collectLiveGridCards(config), config);
        }
      });
      return;
    }

    var cards = collectCards(config);
    applyFilters(cards, config);
    var visible = sortCatalogEntries(getVisibleCarouselCards(cards));
    var pageSize = getCarouselPageSize(config);
    var nextPageStart = (enhancer.globalPageIndex + 1) * pageSize;

    if (nextPageStart < visible.length) {
      enhancer.globalPageIndex += 1;
      enhancer.batchPageIndex = Math.max(0, Math.floor(getCatalogSliceStart(pageSize) / pageSize));
      enhancer.carouselAdvancePending = false;
      saveCarouselPagingState();
      enhancer.pendingTargetPage = null;
      if (urlHasActiveNexusFilters()) {
        applyFilteredBrowseCarouselPage(config, cards);
      } else {
        applyLiveCarouselPage(cards, config);
        decorateVisibleCarouselSlice(cards, config);
      }
      scrollCarouselIntoView();
      return;
    }

    if (!canFetchMoreCarouselBatches()) {
      enhancer.carouselAdvancePending = false;
      clampGlobalPageIndex(pageSize, visible.length);
      if (urlHasActiveNexusFilters()) {
        applyFilteredBrowseCarouselPage(config, cards);
      } else {
        applyLiveCarouselPage(cards, config);
      }
      return;
    }

    beginNexusBatchFetch(config).then(function (ok) {
      if (!ok) {
        enhancer.carouselAdvancePending = false;
        var stale = collectCards(config);
        clampGlobalPageIndex(pageSize, getVisibleCarouselCards(stale).length);
        if (urlHasActiveNexusFilters()) {
          applyFilteredBrowseCarouselPage(config, stale);
        } else {
          applyLiveCarouselPage(stale, config);
        }
        return;
      }
      tryAdvanceFilteredForward(config, attempt + 1);
    });
  }

  function finishTrackedCatalogPageAdvance(config, ok) {
    if (ok) {
      enhancer.trackedPageRetryAttempts = 0;
      scrollCarouselIntoView();
      return;
    }

    enhancer.lastAppliedSliceKey = '';
    var attempts = (enhancer.trackedPageRetryAttempts || 0) + 1;
    enhancer.trackedPageRetryAttempts = attempts;

    if (attempts <= 6) {
      setTimeout(function () {
        if (!enhancer.config || !isLocalCatalogMode(enhancer.config)) {
          return;
        }
        navigateTrackedCatalogPage(config).then(function (retryOk) {
          finishTrackedCatalogPageAdvance(config, retryOk);
        });
      }, 350 + attempts * 250);
      return;
    }

    enhancer.trackedPageRetryAttempts = 0;
    if (restoreTrackedCatalogPageFromCache(enhancer.globalPageIndex, config)) {
      showTrackedCatalogPage(config);
      decorateVisibleCarouselSlice(collectCards(config), config);
    }
    scrollCarouselIntoView();
  }

  function clearFilteredBrowseLocksForPaging() {
    if (enhancer.filteredBrowseHostBatchInFlight) {
      if (enhancer.filteredBrowseHostBatchDeadline &&
          Date.now() > enhancer.filteredBrowseHostBatchDeadline) {
        finishFilteredBrowseHostBatch(false);
      }
      return;
    }
    enhancer.pendingNativeCatalogFetch = false;
    enhancer.nativeNavFetchInFlight = false;
    enhancer.pendingPoolFetch = false;
    enhancer.fetchInFlightPage = null;
    enhancer.dismissedBatchPrefetchInFlight = false;
  }

  function clearStaleFilteredBrowseFetchLocks() {
    if (enhancer.clearingFilteredBrowseLocks) {
      return;
    }
    enhancer.clearingFilteredBrowseLocks = true;
    try {
      if (enhancer.filteredBrowseHostBatchInFlight &&
          enhancer.filteredBrowseHostBatchDeadline &&
          Date.now() > enhancer.filteredBrowseHostBatchDeadline) {
        finishFilteredBrowseHostBatch(false);
      }
      if (urlHasActiveNexusFilters()) {
        var liveOnly = isFilteredBrowseSession() &&
          !(getVisibleCarouselCatalogCount() >= filteredBrowseBatchCatalogThreshold() ||
            (enhancer.tilePool && enhancer.tilePool.length >= filteredBrowseBatchCatalogThreshold()));
        if (liveOnly) {
          if (!enhancer.filteredBrowseHostBatchInFlight) {
            enhancer.pendingNativeCatalogFetch = false;
            enhancer.nativeNavFetchInFlight = false;
            enhancer.pendingPoolFetch = false;
            enhancer.fetchInFlightPage = null;
            enhancer.carouselAdvancePending = false;
            enhancer.dismissedBatchPrefetchInFlight = false;
          }
          return;
        }
      }
      if (enhancer.filteredBrowseHostBatchInFlight) {
        return;
      }
      if (enhancer.pendingNativeCatalogFetch && !enhancer.nativeNavFetchInFlight) {
        enhancer.pendingNativeCatalogFetch = false;
        enhancer.pendingPoolFetch = false;
        enhancer.fetchInFlightPage = null;
        enhancer.dismissedBatchPrefetchInFlight = false;
      }
    } finally {
      enhancer.clearingFilteredBrowseLocks = false;
    }
  }

  function applyFilteredCarouselPageView(config, options) {
    options = options || {};
    if (isFilteredBrowseSession(config)) {
      applyFilteredNexusDirectPage(config, options);
      return;
    }
    if (filteredBrowseUsesLiveCatalogOnly()) {
      safeApplyFilteredBrowseLiveOnlyPage(config, options);
      return;
    }
    enhancer.lastAppliedSliceKey = '';
    applyFilteredBrowseCarouselPage(config, collectCards(config));
  }

  function waitForFilteredNexusPageLoad(targetNexusPage, config, options) {
    options = options || {};
    var minTiles = options.minTiles || 4;
    var startModIds = options.startModIds || null;
    var deadline = Date.now() + (options.timeoutMs || 20000);
    return new Promise(function (resolve) {
      var pollId = setInterval(function () {
        if (Date.now() > deadline) {
          clearInterval(pollId);
          resolve(false);
          return;
        }
        if (isBrowseOopsPage()) {
          clearInterval(pollId);
          resolve(false);
          return;
        }
        if (filteredNexusPageReady(targetNexusPage, startModIds, config, minTiles)) {
          clearInterval(pollId);
          resolve(true);
        }
      }, 200);
    });
  }

  function clickFilteredNexusPaginationTarget(targetNexusPage, direction) {
    var pageLink = findNexusPaginationPageLink(targetNexusPage);
    if (pageLink) {
      enhancer.allowNexusPaginationClick = true;
      try {
        pageLink.click();
      } catch (errPageLink) {
        enhancer.allowNexusPaginationClick = false;
        return false;
      }
      setTimeout(function () {
        enhancer.allowNexusPaginationClick = false;
      }, 0);
      return true;
    }
    if (direction === 1 || direction === -1) {
      var btn = findNexusPaginationButton(direction);
      if (btn) {
        return navigateNexusResultsPageSoft(direction, { forceSoft: true });
      }
    }
    return false;
  }

  function navigateFilteredBrowsePageByUrl(pageNum) {
    if (!pageNum || pageNum < 1) {
      return false;
    }
    try {
      var url = buildNexusResultsPageUrl(pageNum);
      enhancer.pendingPoolFetch = true;
      saveCarouselPagingState();
      window.location.replace(url);
      return true;
    } catch (errFilteredPageUrl) {
      return false;
    }
  }

  function navigateFilteredNexusResultsPage(targetNexusPage, config) {
    if (!targetNexusPage || targetNexusPage < 1) {
      return Promise.resolve(false);
    }
    var currentPage = getNexusResultsPageFromUrl();
    if (currentPage === targetNexusPage &&
        collectLiveGridCards(config || enhancer.config || {}).length >= 4) {
      return Promise.resolve(true);
    }
    if (enhancer.filteredNexusPageNavInFlight) {
      return Promise.resolve(false);
    }
    enhancer.filteredNexusPageNavInFlight = true;
    enhancer.filteredNexusPageNavSince = Date.now();
    enhancer.carouselPagingQuietUntil = Date.now() + 6000;

    var direction = targetNexusPage - currentPage;
    var startModIds = collectLiveModIdSet(config);
    var navMode = 'none';

    var navigated = withNexusPaginationUnhidden(function () {
      if (!hasNumericNexusBrowseFilters() &&
          clickFilteredNexusPaginationTarget(targetNexusPage, direction)) {
        navMode = 'page-link';
        return true;
      }
      if (direction === 1 || direction === -1) {
        if (navigateNexusResultsPageSoft(direction, { forceSoft: true })) {
          navMode = 'soft-button';
          return true;
        }
      }
      return false;
    });

    if (!navigated) {
      if (hasNumericNexusBrowseFilters()) {
        logToHost('navigateFilteredNexusResultsPage blocked hard navigation', {
          targetNexusPage: targetNexusPage,
        });
      } else {
        navigated = navigateFilteredBrowsePageByUrl(targetNexusPage);
        if (navigated) {
          navMode = 'url-replace';
        }
      }
    }

    if (!navigated) {
      enhancer.filteredNexusPageNavInFlight = false;
      enhancer.filteredNexusPageNavSince = 0;
      logToHost('navigateFilteredNexusResultsPage failed', {
        targetNexusPage: targetNexusPage,
        currentPage: getNexusResultsPageFromUrl(),
        direction: direction,
      });
      return Promise.resolve(false);
    }

    logToHost('navigateFilteredNexusResultsPage started', {
      targetNexusPage: targetNexusPage,
      currentPage: currentPage,
      navMode: navMode,
    });

    function finishNav(ok) {
      enhancer.filteredNexusPageNavInFlight = false;
      enhancer.filteredNexusPageNavSince = 0;
      if (ok) {
        try {
          sendToHost({
            type: 'browse-navigate',
            url: stripInternalBrowseParams(window.location.href),
            syncOnly: true,
          });
        } catch (errSyncNav) {
          // ignore
        }
      }
      return ok;
    }

    return waitForFilteredNexusPageLoad(targetNexusPage, config, {
      startModIds: startModIds,
      timeoutMs: 18000,
    }).then(finishNav);
  }

  function applyFilteredNexusDirectPage(config, options) {
    options = options || {};
    if (!config || !isFilteredBrowseSession(config)) {
      return 0;
    }
    return safeApplyFilteredBrowseLiveOnlyPage(config, options);
  }

  function clearStaleCarouselAdvanceLocks() {
    var now = Date.now();
    if (enhancer.carouselAdvancePending &&
        (!enhancer.carouselAdvancePendingSince ||
         now - enhancer.carouselAdvancePendingSince > 3000)) {
      enhancer.carouselAdvancePending = false;
      enhancer.carouselAdvancePendingSince = 0;
    }
    if (enhancer.filteredNexusPageNavSince &&
        now - enhancer.filteredNexusPageNavSince > 25000) {
      enhancer.filteredNexusPageNavInFlight = false;
      enhancer.filteredNexusPageNavSince = 0;
    }
  }

  function advanceFilteredCarouselPageHostFallback(targetNexusPage) {
    var targetUrl = buildNexusResultsPageUrl(targetNexusPage);
    logToHost('advanceFilteredCarouselPage host-fallback', {
      targetNexusPage: targetNexusPage,
      targetUrl: targetUrl,
    });
    enhancer.filteredNexusPageNavInFlight = true;
    enhancer.filteredNexusPageNavSince = Date.now();
    enhancer.carouselPagingQuietUntil = Date.now() + 10000;
    try {
      sendToHost({
        type: 'browse-navigate',
        url: stripInternalBrowseParams(targetUrl),
        syncOnly: false,
      });
    } catch (errFilteredNavHost) {
      // ignore
    }
    try {
      window.location.replace(targetUrl);
    } catch (errFilteredNavReplace) {
      // ignore
    }
  }

  function advanceFilteredCarouselPage(config, delta) {
    logToHost('advanceFilteredCarouselPage begin', {
      delta: delta,
      urlPage: getNexusResultsPageFromUrl(),
      inFlight: !!enhancer.filteredNexusPageNavInFlight,
      pending: !!enhancer.carouselAdvancePending,
    });
    try {
    if (!config || !isFilteredBrowseSession(config)) {
      logToHost('advanceFilteredCarouselPage skipped', {
        reason: 'not-filtered-session',
        hasConfig: !!config,
      });
      return false;
    }

    var currentNexusPage = getNexusResultsPageFromUrl();
    var targetNexusPage = currentNexusPage + delta;
    if (targetNexusPage < 1) {
      logToHost('advanceFilteredCarouselPage skipped', {
        reason: 'before-first-page',
        currentNexusPage: currentNexusPage,
        targetNexusPage: targetNexusPage,
      });
      return false;
    }

    if (enhancer.filteredNexusPageNavInFlight || enhancer.carouselAdvancePending) {
      logToHost('advanceFilteredCarouselPage blocked', {
        reason: 'in-flight',
        filteredNexusPageNavInFlight: !!enhancer.filteredNexusPageNavInFlight,
        carouselAdvancePending: !!enhancer.carouselAdvancePending,
      });
      return false;
    }

    logToHost('advanceFilteredCarouselPage', {
      delta: delta,
      mode: 'pipeline',
      currentNexusPage: currentNexusPage,
      targetNexusPage: targetNexusPage,
    });

    if (targetNexusPage === currentNexusPage) {
      applyFilteredBrowseLightPage(config);
      scrollCarouselIntoView();
      return true;
    }

    enhancer.carouselAdvancePending = true;
    enhancer.carouselAdvancePendingSince = Date.now();
    enhancer.carouselPagingQuietUntil = Date.now() + 10000;
    enhancer.lastAppliedSliceKey = '';
    resetFilteredCarouselCatalog();

    navigateFilteredNexusResultsPage(targetNexusPage, config).then(function (navOk) {
      enhancer.carouselAdvancePending = false;
      enhancer.carouselAdvancePendingSince = 0;
      if (navOk) {
        applyFilteredBrowseLightPage(config);
        scrollCarouselIntoView();
        logToHost('advanceFilteredCarouselPage done', {
          targetNexusPage: targetNexusPage,
          urlPage: getNexusResultsPageFromUrl(),
        });
        return;
      }
      if (!hasNumericNexusBrowseFilters()) {
        advanceFilteredCarouselPageHostFallback(targetNexusPage);
      }
    }).catch(function (errFilteredNavPipeline) {
      enhancer.carouselAdvancePending = false;
      enhancer.carouselAdvancePendingSince = 0;
      enhancer.filteredNexusPageNavInFlight = false;
      enhancer.filteredNexusPageNavSince = 0;
      logErrorToHost('advanceFilteredCarouselPage pipeline error', {
        error: String(errFilteredNavPipeline && errFilteredNavPipeline.message || errFilteredNavPipeline),
        targetNexusPage: targetNexusPage,
      });
      if (!hasNumericNexusBrowseFilters()) {
        advanceFilteredCarouselPageHostFallback(targetNexusPage);
      }
    });
    return true;
    } catch (errAdvanceFilteredSync) {
      enhancer.carouselAdvancePending = false;
      enhancer.carouselAdvancePendingSince = 0;
      enhancer.filteredNexusPageNavInFlight = false;
      enhancer.filteredNexusPageNavSince = 0;
      logErrorToHost('advanceFilteredCarouselPage sync error', {
        error: String(errAdvanceFilteredSync && errAdvanceFilteredSync.message || errAdvanceFilteredSync),
        delta: delta,
      });
      return false;
    }
  }

  function advanceNumericFilteredCarouselPage(config, delta) {
    config = config || enhancer.config;
    if (!config || !delta) {
      return false;
    }
    logToHost('advanceNumericFilteredCarouselPage', {
      delta: delta,
      page: (enhancer.globalPageIndex || 0) + 1,
      clientSide: !!enhancer.clientSideNumericFilterActive,
    });
    traceStep('advance-numeric-filtered', {
      delta: delta,
      page: (enhancer.globalPageIndex || 0) + 1,
      clientSide: !!enhancer.clientSideNumericFilterActive,
      catalog: (enhancer.filteredCarouselCatalog || []).length,
    });
    clearStaleCarouselAdvanceLocks();
    var pageSize = getCarouselPageSize(config);
    var catalog = getMinimalNumericBrowseCatalog(config);

    if (delta < 0) {
      if (enhancer.globalPageIndex <= 0) {
        return false;
      }
      enhancer.globalPageIndex -= 1;
      enhancer.batchPageIndex = enhancer.globalPageIndex;
      enhancer.lastAppliedSliceKey = '';
      saveCarouselPagingState();
      enhancer.lastMinimalAppliedSliceKey = '';
      enhancer.carouselPagingQuietUntil = Date.now() + 4000;
      applyMinimalNumericFilteredPage(config, catalog, { forcePageApply: true });
      scrollCarouselIntoView();
      logToHost('advanceNumericFilteredCarouselPage local', {
        page: enhancer.globalPageIndex + 1,
        catalog: catalog.length,
        clientSide: !!enhancer.clientSideNumericFilterActive,
      });
      traceStep('advance-numeric-filtered-local', {
        page: enhancer.globalPageIndex + 1,
        catalog: catalog.length,
      });
      return true;
    }

    if (enhancer.carouselAdvancePending) {
      logToHost('advanceNumericFilteredCarouselPage blocked', { reason: 'pending' });
      return false;
    }

    var targetIndex = enhancer.globalPageIndex + 1;
    var needStart = targetIndex * pageSize;
    if (needStart < catalog.length) {
      enhancer.globalPageIndex = targetIndex;
      enhancer.batchPageIndex = targetIndex;
      enhancer.lastAppliedSliceKey = '';
      enhancer.lastMinimalAppliedSliceKey = '';
      enhancer.carouselPagingQuietUntil = Date.now() + 4000;
      saveCarouselPagingState();
      applyMinimalNumericFilteredPage(config, catalog, { forcePageApply: true });
      scrollCarouselIntoView();
      logToHost('advanceNumericFilteredCarouselPage local', {
        page: targetIndex + 1,
        catalog: catalog.length,
        clientSide: !!enhancer.clientSideNumericFilterActive,
      });
      traceStep('advance-numeric-filtered-local', {
        page: targetIndex + 1,
        catalog: catalog.length,
      });
      return true;
    }

    var displayTotal = getLockedNexusFilteredDisplayTotal() || catalog.length;
    var maxPageIndex = displayTotal > 0
      ? Math.max(0, Math.ceil(displayTotal / pageSize) - 1)
      : targetIndex;
    if (targetIndex > maxPageIndex && !canFetchMoreCarouselBatches()) {
      logToHost('advanceNumericFilteredCarouselPage blocked', {
        reason: 'end-of-catalog',
        page: targetIndex + 1,
        displayTotal: displayTotal,
      });
      return false;
    }

    if (hasNumericNexusBrowseFilters() && !enhancer.clientSideNumericFilterActive) {
      enhancer.carouselAdvancePending = false;
      enhancer.carouselAdvancePendingSince = 0;
      logToHost('advanceNumericFilteredCarouselPage blocked', {
        reason: 'numeric-batch-source-unavailable',
        page: targetIndex + 1,
        catalog: catalog.length,
      });
      return false;
    }

    enhancer.carouselAdvancePending = true;
    enhancer.carouselAdvancePendingSince = Date.now();
    logToHost('advanceNumericFilteredCarouselPage fetch', {
      targetPage: targetIndex + 1,
      catalog: catalog.length,
      needStart: needStart,
    });
    fetchMoreFilteredCarouselMods(config, targetIndex).then(function (ok) {
      enhancer.carouselAdvancePending = false;
      enhancer.carouselAdvancePendingSince = 0;
      var refreshed = getMinimalNumericBrowseCatalog(config);
      if (ok || (targetIndex * pageSize) < refreshed.length) {
        enhancer.globalPageIndex = targetIndex;
        enhancer.batchPageIndex = targetIndex;
        enhancer.lastAppliedSliceKey = '';
        saveCarouselPagingState();
        enhancer.lastMinimalAppliedSliceKey = '';
        enhancer.carouselPagingQuietUntil = Date.now() + 4000;
        applyMinimalNumericFilteredPage(config, refreshed, { forcePageApply: true });
        scrollCarouselIntoView();
        logToHost('advanceNumericFilteredCarouselPage fetch done', {
          page: targetIndex + 1,
          catalog: refreshed.length,
          ok: !!ok,
        });
        return;
      }
      logToHost('advanceNumericFilteredCarouselPage fetch failed', {
        page: targetIndex + 1,
        catalog: refreshed.length,
      });
    }).catch(function (errNumericAdvanceFetch) {
      enhancer.carouselAdvancePending = false;
      enhancer.carouselAdvancePendingSince = 0;
      logErrorToHost('advanceNumericFilteredCarouselPage fetch error', {
        error: String(errNumericAdvanceFetch && errNumericAdvanceFetch.message || errNumericAdvanceFetch),
      });
    });
    return true;
  }

  function advanceFilteredLiveCarouselPage(config, delta) {
    config = config || enhancer.config;
    if (!config) {
      return false;
    }
    if (shouldUseNumericFilteredBrowseScan(config)) {
      return advanceNumericFilteredCarouselPage(config, delta);
    }
    logToHost('advanceFilteredLiveCarouselPage begin', {
      delta: delta,
      page: (enhancer.globalPageIndex || 0) + 1,
      catalog: enhancer.filteredCarouselCatalog ? enhancer.filteredCarouselCatalog.length : 0,
      numeric: !!shouldUseNumericFilteredBrowseScan(config),
    });
    ensureFilteredCarouselCatalogFromLive(config);
    var liveTileCount = collectLiveGridCards(config).length;
    logToHost('advanceFilteredLiveCarouselPage primed', {
      delta: delta,
      page: (enhancer.globalPageIndex || 0) + 1,
      catalog: enhancer.filteredCarouselCatalog ? enhancer.filteredCarouselCatalog.length : 0,
      liveTiles: liveTileCount,
    });
    try {
    if (!config || !isFilteredBrowseSession(config)) {
      logToHost('advanceFilteredLiveCarouselPage skipped', { reason: 'not-filtered-session' });
      return false;
    }
    clearStaleCarouselAdvanceLocks();
    clearStaleFilteredBrowseFetchLocks();
    enhancer.carouselPagingQuietUntil = Date.now() + 1200;
    var pageSize = getCarouselPageSize(config);

    if (delta < 0) {
      if (enhancer.globalPageIndex <= 0) {
        return false;
      }
      enhancer.globalPageIndex -= 1;
      enhancer.batchPageIndex = enhancer.globalPageIndex;
      enhancer.lastAppliedSliceKey = '';
      saveCarouselPagingState();
      if (hasNumericNexusBrowseFilters()) {
        applyNumericFilteredLivePage(config, { forcePageApply: true });
      } else {
        safeApplyFilteredBrowseLiveOnlyPage(config, { forcePageApply: true, skipHeadlineSync: true });
      }
      scrollCarouselIntoView();
      logToHost('advanceFilteredLiveCarouselPage back', {
        page: enhancer.globalPageIndex + 1,
      });
      return true;
    }

    if (enhancer.carouselAdvancePending) {
      logToHost('advanceFilteredLiveCarouselPage blocked', { reason: 'pending' });
      return false;
    }

    var visible = getFilteredCarouselVisibleEntries(config);
    var nextPageStart = (enhancer.globalPageIndex + 1) * pageSize;
    var nextPageEnd = nextPageStart + pageSize;
    var knownFilteredTotal = getLockedNexusFilteredDisplayTotal() ||
      getEffectiveResultsTotal(config, visible.length);
    var nextPageIsComplete = visible.length >= nextPageEnd ||
      (knownFilteredTotal > 0 && visible.length >= knownFilteredTotal);
    if (nextPageStart < visible.length && nextPageIsComplete) {
      enhancer.globalPageIndex += 1;
      enhancer.batchPageIndex = enhancer.globalPageIndex;
      enhancer.lastAppliedSliceKey = '';
      saveCarouselPagingState();
      if (hasNumericNexusBrowseFilters()) {
        applyNumericFilteredLivePage(config, { forcePageApply: true });
      } else {
        safeApplyFilteredBrowseLiveOnlyPage(config, { forcePageApply: true, skipHeadlineSync: true });
      }
      scrollCarouselIntoView();
      logToHost('advanceFilteredLiveCarouselPage local', {
        page: enhancer.globalPageIndex + 1,
        visible: visible.length,
        liveTiles: liveTileCount,
      });
      return true;
    }

    if (liveTileCount > nextPageStart) {
      ensureFilteredCarouselCatalogFromLive(config);
      visible = getFilteredCarouselVisibleEntries(config);
      nextPageIsComplete = visible.length >= nextPageEnd ||
        (knownFilteredTotal > 0 && visible.length >= knownFilteredTotal);
      if (nextPageStart < visible.length && nextPageIsComplete) {
        enhancer.globalPageIndex += 1;
        enhancer.batchPageIndex = enhancer.globalPageIndex;
        enhancer.lastAppliedSliceKey = '';
        saveCarouselPagingState();
        if (hasNumericNexusBrowseFilters()) {
          applyNumericFilteredLivePage(config, { forcePageApply: true });
        } else {
          safeApplyFilteredBrowseLiveOnlyPage(config, { forcePageApply: true, skipHeadlineSync: true });
        }
        scrollCarouselIntoView();
        logToHost('advanceFilteredLiveCarouselPage local-resync', {
          page: enhancer.globalPageIndex + 1,
          visible: visible.length,
          liveTiles: liveTileCount,
        });
        return true;
      }
    }

    var catalogTotal = hasNumericNexusBrowseFilters()
      ? (getLockedNexusFilteredDisplayTotal() || visible.length)
      : getEffectiveResultsTotal(config, visible.length);
    var maxPageIndex = catalogTotal > 0
      ? Math.max(0, Math.ceil(catalogTotal / pageSize) - 1)
      : enhancer.globalPageIndex;
    if (enhancer.globalPageIndex >= maxPageIndex && !canFetchMoreCarouselBatches()) {
      logToHost('advanceFilteredLiveCarouselPage blocked', {
        reason: 'end-of-catalog',
        page: enhancer.globalPageIndex + 1,
        catalogTotal: catalogTotal,
      });
      return false;
    }

    var targetPage = enhancer.globalPageIndex + 1;
    enhancer.carouselAdvancePending = true;
    enhancer.carouselAdvancePendingSince = Date.now();
    logToHost('advanceFilteredLiveCarouselPage fetch', {
      targetPage: targetPage + 1,
      visible: visible.length,
      needStart: nextPageStart,
    });
    fetchMoreFilteredCarouselMods(config, targetPage).then(function (ok) {
      enhancer.carouselAdvancePending = false;
      enhancer.carouselAdvancePendingSince = 0;
      var refreshedVisible = getFilteredCarouselVisibleEntries(config);
      var refreshedStart = targetPage * pageSize;
      var refreshedEnd = refreshedStart + pageSize;
      var refreshedComplete = refreshedVisible.length >= refreshedEnd ||
        (knownFilteredTotal > 0 && refreshedVisible.length >= knownFilteredTotal);
      if (refreshedComplete) {
        enhancer.globalPageIndex = targetPage;
        enhancer.batchPageIndex = targetPage;
        enhancer.lastAppliedSliceKey = '';
        saveCarouselPagingState();
        if (hasNumericNexusBrowseFilters()) {
          applyNumericFilteredLivePage(config, { forcePageApply: true });
        } else {
          safeApplyFilteredBrowseLiveOnlyPage(config, { forcePageApply: true, skipHeadlineSync: true });
        }
        scrollCarouselIntoView();
        logToHost('advanceFilteredLiveCarouselPage fetch done', {
          page: targetPage + 1,
          visible: refreshedVisible.length,
          ok: !!ok,
        });
        return;
      }
      logToHost('advanceFilteredLiveCarouselPage fetch failed', {
        targetPage: targetPage + 1,
        visible: refreshedVisible.length,
      });
    }).catch(function (errFilteredLiveAdvance) {
      enhancer.carouselAdvancePending = false;
      enhancer.carouselAdvancePendingSince = 0;
      logErrorToHost('advanceFilteredLiveCarouselPage fetch error', {
        error: String(errFilteredLiveAdvance && errFilteredLiveAdvance.message || errFilteredLiveAdvance),
      });
    });
    return true;
    } catch (errAdvanceFilteredLive) {
      logErrorToHost('advanceFilteredLiveCarouselPage error', {
        error: String(errAdvanceFilteredLive && errAdvanceFilteredLive.message || errAdvanceFilteredLive),
        stack: String(errAdvanceFilteredLive && errAdvanceFilteredLive.stack || ''),
        delta: delta,
      });
      return false;
    }
  }

  function advanceCarouselPage(delta) {
    var config = enhancer.config;
    // Numeric browse controls use advanceNumericFilteredCarouselPage
    // directly. Older document-level listeners can survive reinjection, so
    // never let this general path process numeric clicks a second time.
    if (config && shouldUseNumericFilteredBrowseScan(config)) {
      return false;
    }
    clearStaleCarouselAdvanceLocks();
    enhancer.carouselAdvancePending = false;
    enhancer.carouselAdvancePendingSince = 0;
    var numericBrowse = shouldUseNumericFilteredBrowseScan(config);
    traceStep('advance-carousel-page', {
      delta: delta,
      numeric: !!numericBrowse,
      page: (enhancer.globalPageIndex || 0) + 1,
      catalog: enhancer.filteredCarouselCatalog ? enhancer.filteredCarouselCatalog.length : 0,
      clientSide: !!enhancer.clientSideNumericFilterActive,
    });
    var domFiltered = !!enhancer.domFilterBrowseActive;
    var filteredSession = !!(config && isFilteredBrowseSession(config));
    logToHost('advanceCarouselPage', {
      delta: delta,
      filtered: filteredSession,
      numeric: !!numericBrowse,
      domFiltered: !!domFiltered,
      engaged: !!enhancer.filteredBrowseEngaged,
      liveOnly: !!(filteredSession && filteredBrowseUsesLiveCatalogOnly()),
      hasConfig: !!config,
      carouselAdvancePending: !!enhancer.carouselAdvancePending,
      filteredNexusPageNavInFlight: !!enhancer.filteredNexusPageNavInFlight,
      urlPage: getNexusResultsPageFromUrl(),
      domPage: getNexusResultsPageFromDom(),
      catalog: enhancer.filteredCarouselCatalog ? enhancer.filteredCarouselCatalog.length : 0,
      page: (enhancer.globalPageIndex || 0) + 1,
      clientSide: !!enhancer.clientSideNumericFilterActive,
    });
    if (config && numericBrowse) {
      try {
        clearFilteredBrowseLocksForPaging();
      } catch (errClearNumericLocks) {
        logErrorToHost('clearFilteredBrowseLocksForPaging failed', {
          error: String(errClearNumericLocks && errClearNumericLocks.message || errClearNumericLocks),
        });
      }
      try {
        advanceNumericFilteredCarouselPage(config, delta);
      } catch (errAdvanceNumericRoute) {
        logErrorToHost('advanceNumericFilteredCarouselPage route error', {
          error: String(errAdvanceNumericRoute && errAdvanceNumericRoute.message || errAdvanceNumericRoute),
        });
      }
      return;
    }
    if (config && filteredSession) {
      try {
        clearFilteredBrowseLocksForPaging();
      } catch (errClearFilteredLocks) {
        logErrorToHost('clearFilteredBrowseLocksForPaging failed', {
          error: String(errClearFilteredLocks && errClearFilteredLocks.message || errClearFilteredLocks),
        });
      }
      try {
        advanceFilteredLiveCarouselPage(config, delta);
      } catch (errAdvanceFilteredRoute) {
        logErrorToHost('advanceFilteredLiveCarouselPage route error', {
          error: String(errAdvanceFilteredRoute && errAdvanceFilteredRoute.message || errAdvanceFilteredRoute),
        });
      }
      return;
    }
    if (urlHasActiveNexusFilters()) {
      try {
        clearFilteredBrowseLocksForPaging();
      } catch (errClearFilteredLocksGeneric) {
        logErrorToHost('clearFilteredBrowseLocksForPaging failed', {
          error: String(errClearFilteredLocksGeneric && errClearFilteredLocksGeneric.message || errClearFilteredLocksGeneric),
        });
      }
    }

    if (delta > 0) {
      if (config && isLocalCatalogMode(config) && enhancer.trackedCatalogActive) {
        if (enhancer.localCatalogNavLock) {
          return;
        }
      } else if (enhancer.carouselAdvancePending) {
        return;
      } else if (enhancer.fetchInFlightPage || enhancer.nativeNavFetchInFlight ||
          enhancer.pendingNativeCatalogFetch) {
        if (!enhancer.filteredBrowseHostBatchInFlight ||
            enhancer.filteredBrowseHostBatchPhase === 'forward') {
          return;
        }
      }
    } else if (config && isLocalCatalogMode(config) && enhancer.trackedCatalogActive &&
        enhancer.localCatalogNavLock) {
      return;
    }

    var pageSize = getCarouselPageSize(config);

    if (delta < 0) {
      if (enhancer.globalPageIndex <= 0) {
        return;
      }
      enhancer.carouselAdvancePending = false;
      var targetBackPage = enhancer.globalPageIndex - 1;
      if (isLocalCatalogMode(config) && enhancer.trackedCatalogActive &&
          restoreTrackedCatalogPageFromCache(targetBackPage, config)) {
        enhancer.globalPageIndex = targetBackPage;
        enhancer.batchPageIndex = targetBackPage;
        enhancer.lastAppliedSliceKey = '';
        saveCarouselPagingState();
        showTrackedCatalogPage(config);
        decorateVisibleCarouselSlice(collectCards(config), config);
        scrollCarouselIntoView();
        return;
      }
      enhancer.globalPageIndex -= 1;
      enhancer.batchPageIndex = Math.max(0, Math.floor(getCatalogSliceStart(pageSize) / pageSize));
      saveCarouselPagingState();
      enhancer.pendingTargetPage = null;
      enhancer.lastAppliedSliceKey = '';
      if (isLocalCatalogMode(config) && enhancer.trackedCatalogActive) {
        if (!hasLocalCatalogData(config) || getCatalogModIdsForPool(config).length === 0) {
          return;
        }
        snapshotCurrentCatalogPageIfNeeded();
        var revertPage = enhancer.globalPageIndex + 1;
        navigateTrackedCatalogPage(config).then(function (ok) {
          if (!ok) {
            enhancer.globalPageIndex = revertPage;
            saveCarouselPagingState();
            restoreAndShowLocalCatalogPage(revertPage, config);
          }
          finishTrackedCatalogPageAdvance(config, ok);
        });
        return;
      }
      var backCards = collectCards(config);
      if (urlHasActiveNexusFilters()) {
        applyFilteredBrowseCarouselPage(config, backCards);
      } else {
        applyLiveCarouselPage(backCards, config);
      }
      scrollCarouselIntoView();
      return;
    }

    if (isLocalCatalogMode(config) && enhancer.trackedCatalogActive) {
      if (!hasLocalCatalogData(config) || getCatalogModIdsForPool(config).length === 0) {
        return;
      }
      var catalogCount = getCatalogModIdsForPool(config).length;
      var catalogNextStart = (enhancer.globalPageIndex + 1) * pageSize;
      if (catalogNextStart >= catalogCount) {
        return;
      }
      var targetForwardPage = enhancer.globalPageIndex + 1;
      if (restoreTrackedCatalogPageFromCache(targetForwardPage, config)) {
        snapshotCurrentCatalogPageIfNeeded();
        enhancer.globalPageIndex = targetForwardPage;
        enhancer.lastAppliedSliceKey = '';
        saveCarouselPagingState();
        showTrackedCatalogPage(config);
        decorateVisibleCarouselSlice(collectCards(config), config);
        prefetchTrackedCatalogPageCache(targetForwardPage + 1, config);
        prefetchTrackedCatalogPageCache(targetForwardPage + 2, config);
        prefetchTrackedCatalogPageCache(targetForwardPage + 3, config);
        scrollCarouselIntoView();
        return;
      }
      snapshotCurrentCatalogPageIfNeeded();
      var previousCatalogPage = enhancer.globalPageIndex;
      enhancer.globalPageIndex += 1;
      enhancer.lastAppliedSliceKey = '';
      saveCarouselPagingState();
      navigateTrackedCatalogPage(config).then(function (ok) {
        if (!ok) {
          enhancer.globalPageIndex = previousCatalogPage;
          saveCarouselPagingState();
          restoreAndShowLocalCatalogPage(previousCatalogPage, config);
        }
        finishTrackedCatalogPageAdvance(config, ok);
      });
      return;
    }

    if (hasClientCarouselFilters(config)) {
      if (enhancer.carouselAdvancePending) {
        return;
      }
      enhancer.carouselAdvancePending = true;
      tryAdvanceFilteredForward(config, 0);
      return;
    }

    var cards = collectCards(config);
    applyFilters(cards, config);
    var visible = getVisibleCarouselCards(cards);
    var visibleCount = visible.length;
    var maxLoadedPageIndex = getMaxFullCarouselPageIndex(pageSize, visibleCount);
    if (delta > 0 && enhancer.globalPageIndex > maxLoadedPageIndex &&
        !canFetchMoreCarouselBatches()) {
      return;
    }
    var targetPage = enhancer.globalPageIndex + 1;
    var hasNextPageLoaded = carouselPageFullyLoaded(targetPage, visibleCount, pageSize);

    if (!hasNextPageLoaded && isPooledNexusCarouselBrowseMode(config)) {
      maybePrefetchDismissedLiveBatch(config);
      cards = collectCards(config);
      applyFilters(cards, config);
      visible = getVisibleCarouselCards(cards);
      visibleCount = visible.length;
      hasNextPageLoaded = carouselPageFullyLoaded(targetPage, visibleCount, pageSize);
    }

    if (hasNextPageLoaded) {
      enhancer.globalPageIndex += 1;
      enhancer.batchPageIndex = Math.max(0, Math.floor(getCatalogSliceStart(pageSize) / pageSize));
      saveCarouselPagingState();
    } else {
      var nextPage = getNextUnfetchedNexusPage();
      if (!nextPage) {
        return;
      }

      enhancer.carouselAdvancePending = true;
      enhancer.pendingTargetPage = enhancer.globalPageIndex + 1;
      saveCarouselPagingState();
      var pooledAdvance = isPooledNexusCarouselBrowseMode(config);
      beginNexusBatchFetch(config, {
        allowNavigation: urlHasActiveNexusFilters() ? 'soft' : false,
      }).then(function (ok) {
        return ok;
      }).then(function (ok) {
        enhancer.carouselAdvancePending = false;
        if (!ok) {
          enhancer.pendingTargetPage = null;
          return;
        }
        if (pooledAdvance) {
          if (isDismissedCarouselBrowseMode(config)) {
            saveDismissedBrowsePoolSnapshot(config);
          } else {
            saveNativePoolSnapshot(config);
          }
        }
        enhancer.globalPageIndex += 1;
        enhancer.pendingTargetPage = null;
        saveCarouselPagingState();
        var refreshed = collectCards(config);
        if (urlHasActiveNexusFilters()) {
          applyFilteredBrowseCarouselPage(config, refreshed);
        } else {
          applyLiveCarouselPage(refreshed, config);
        }
        ensureCarouselControlsBar();
        protectBrowseControlsFromChromeHide();
        scheduleControlsRemount();
        scrollCarouselIntoView();
      });
      return;
    }

    enhancer.pendingTargetPage = null;
    var refreshed = collectCards(config);
    if (urlHasActiveNexusFilters()) {
      applyFilteredBrowseCarouselPage(config, refreshed);
    } else {
      applyLiveCarouselPage(refreshed, config);
    }
    scrollCarouselIntoView();
  }

  function applyPendingTargetPage(config) {
    if (enhancer.pendingTargetPage === null || enhancer.pendingTargetPage === undefined) {
      return;
    }

    var pageSize = getCarouselPageSize(config);
    var filtered = getFilteredPoolEntries(config);
    var target = enhancer.pendingTargetPage;
    var neededForTarget = target * pageSize + 1;

    if (filtered.length >= neededForTarget) {
      enhancer.globalPageIndex = target;
      enhancer.pendingTargetPage = null;
      enhancer.pendingPoolFetch = false;
      return;
    }

    if (!findNexusPaginationButton(1)) {
      enhancer.pendingTargetPage = null;
      enhancer.pendingPoolFetch = false;
    }
  }

  function ensureCarouselLayout(config) {
    var grid = findNexusModGrid();
    if (!grid) {
      return false;
    }

    document.documentElement.classList.add('vortex-enhanced-browse-wide');

    grid.classList.add('vortex-enhanced-nexus-grid');
    applyGridLayoutStyles(grid, config);
    enhancer.nexusModGridRef = grid;

    var tiles = grid.querySelectorAll('[data-e2eid="mod-tile"]');
    for (var i = 0; i < tiles.length; i++) {
      tiles[i].classList.remove('vortex-enhanced-compact-tile');
    }

    if (isLocalCatalogMode(config) && enhancer.trackedCatalogActive) {
      ensureCatalogDisplayGrid(config);
    }

    var host = grid.parentElement;
    if (host && !host.classList.contains('vortex-enhanced-carousel-host')) {
      host.classList.add('vortex-enhanced-carousel-host');
    }

    ensureCarouselControlsBar();
    installCarouselWheelHandler();

    syncAutoAdvance();
    return true;
  }

  function isTranslationModCard(card) {
    if (!card) {
      return false;
    }

    var category = card.querySelector('[data-e2eid="mod-tile-category"]');
    var categoryText = ((category && category.textContent) || '').toLowerCase();
    if (categoryText.indexOf('translation') >= 0 || categoryText.indexOf('traduction') >= 0) {
      return true;
    }

    var categoryLinks = card.querySelectorAll(
      'a[href*="category"], a[href*="Category"], [data-e2eid="mod-tile-category"] a'
    );
    for (var c = 0; c < categoryLinks.length; c++) {
      var href = (categoryLinks[c].getAttribute('href') || '').toLowerCase();
      var linkText = (categoryLinks[c].textContent || '').toLowerCase();
      if (href.indexOf('translation') >= 0 || href.indexOf('traduction') >= 0 ||
          linkText.indexOf('translation') >= 0 || linkText.indexOf('traduction') >= 0) {
        return true;
      }
    }

    var tagsHost = card.querySelector('[data-e2eid="mod-tile-tags"]');
    var tagsText = ((tagsHost && tagsHost.textContent) || '').toLowerCase();
    if (tagsText.indexOf('translation') >= 0 || tagsText.indexOf('traduction') >= 0) {
      return true;
    }

    var title = card.querySelector('[data-e2eid="mod-tile-title"]');
    var descNode = findCardDescription(card);
    var titleText = ((title && title.textContent) || '').trim();
    var text = (titleText + ' ' + ((descNode && descNode.textContent) || '')).toLowerCase();

    if (/\btraduction\b/i.test(titleText) || /\btranslated?\b/i.test(titleText)) {
      return true;
    }

    if (/[-\u2013]\s*(RU|DE|FR|PL|ES|IT|PT|CN|JP|KR|BR|UA|CZ|TR|NL|SE|NO|DK|FI|HU|RO|GR|TH|VN|ID|AR|HE|GB|US)\s*$/i.test(titleText)) {
      return true;
    }
    if (/\b(simplified chinese|traditional chinese|polish version|german version|french version|spanish version|russian version|chinese version|korean version|japanese version)\b/i.test(text)) {
      return true;
    }
    if (/\s[-\u2013]\s(RU|DE|FR|PL|ES|IT|PT|CN|JP|KR|BR|UA|CZ|TR|NL|SE|NO|DK|FI|HU|RO|GR|TH|VN|ID|AR|HE|EN|GB|US)\b/i.test(titleText)) {
      return true;
    }

    var markers = [
      'traduction', 'translation', ' translated', 'translate to', 'translated to',
      'localisation', 'localization', 'localisation', ' lang pack', 'language pack',
      'polish version', 'german version', 'french version', 'spanish version',
      'russian version', 'chinese version', 'korean version', 'japanese version',
      'subtitle pack', 'voiceline translation',
    ];
    for (var m = 0; m < markers.length; m++) {
      if (text.indexOf(markers[m]) >= 0) {
        return true;
      }
    }

    return false;
  }

  function normalizeUiText(value) {
    var sample = String(value || '');
    if (sample.length > 2048) {
      sample = sample.slice(0, 2048);
    }
    var normalized = sample.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.length > 512) {
      return normalized.slice(0, 512);
    }
    return normalized;
  }

  function rowLooksLikeNexusActiveFilters(node) {
    if (!node || !node.querySelector) {
      return false;
    }
    var text = normalizeUiText(node.textContent);
    if (text.indexOf('clear all') < 0) {
      return false;
    }
    if (/\b[\d][\d,]* results\b/i.test(text)) {
      return false;
    }
    if (rowHasSortControls(node)) {
      return false;
    }
    if (browseUrlHasRemovableActiveFilters()) {
      return rowHasVisibleActiveFilterChips(node);
    }
    return false;
  }

  function isInMainBrowseColumn(node, options) {
    if (!node) {
      return false;
    }
    if (node.closest('aside, #filters-panel, [data-vortex-enhanced-filters="true"]')) {
      return false;
    }
    var aside = findNexusFilterAside();
    if (aside && aside.contains(node)) {
      return false;
    }
    var ignoreVisibility = !!(options && options.ignoreVisibility);
    var rect = node.getBoundingClientRect();
    if (!ignoreVisibility && !rect.width && !rect.height) {
      return false;
    }
    if (aside && !ignoreVisibility) {
      var asideRect = aside.getBoundingClientRect();
      if (rect.left < asideRect.right - 24) {
        return false;
      }
    }
    return true;
  }

  function looksLikeActiveFilterChip(node) {
    if (!node) {
      return false;
    }
    if (node.closest('label, [role="checkbox"], input, aside, #filters-panel')) {
      return false;
    }
    var aria = normalizeUiText(node.getAttribute && node.getAttribute('aria-label'));
    if (aria.indexOf('clear all') >= 0) {
      return false;
    }
    if (aria.indexOf('translation') >= 0 &&
        (aria.indexOf('excluded') >= 0 || aria.indexOf('exclude') >= 0 || aria.indexOf('remove') >= 0)) {
      return true;
    }
    if (!node.textContent) {
      return false;
    }
    var text = normalizeUiText(node.textContent);
    if (text.indexOf('clear all') >= 0) {
      return false;
    }
    if (text.indexOf('excluded:') >= 0 && text.length < 64) {
      return true;
    }
    if (text.length < 64 &&
        (text.indexOf('max downloads') >= 0 ||
         text.indexOf('min downloads') >= 0 ||
         text.indexOf('max endorsements') >= 0 ||
         text.indexOf('min endorsements') >= 0)) {
      return !!node.closest('button, a, [role="button"]');
    }
    if (text.length < 64 &&
        text.indexOf('translation') >= 0 &&
        (text.indexOf('excluded') >= 0 || text.indexOf('exclude') >= 0)) {
      return true;
    }
    if ((text.indexOf('hide adult') >= 0 ||
        text.indexOf('hide installed') >= 0 ||
        text.indexOf('only installed') >= 0 ||
        text.indexOf('hide tracked') >= 0 ||
        text.indexOf('only tracked') >= 0) &&
        text.length < 48) {
      return !!node.closest('button, a, [role="button"]');
    }
    return false;
  }

  function isClearAllControl(node) {
    if (!node || !node.textContent) {
      return false;
    }
    if (!isInMainBrowseColumn(node, { ignoreVisibility: browseUrlHasRemovableActiveFilters() })) {
      return false;
    }
    var label = normalizeUiText(node.textContent);
    return label === 'clear all';
  }

  function findNexusClearAllControl(nearRow) {
    if (nearRow) {
      var local = nearRow.querySelectorAll('button, a, [role="button"], span');
      for (var i = 0; i < local.length; i++) {
        if (isClearAllControl(local[i])) {
          return local[i];
        }
      }
    }
    var nodes = document.querySelectorAll('button, a, [role="button"], span');
    for (var j = 0; j < nodes.length; j++) {
      if (isClearAllControl(nodes[j])) {
        return nodes[j];
      }
    }
    return null;
  }

  function findNexusActiveFilterChip() {
    var selectors = [
      '[class*="ActiveFilter"] button',
      '[class*="ActiveFilter"] a',
      '[class*="AppliedFilter"] button',
      '[class*="AppliedFilter"] a',
      'button',
      'a',
      '[role="button"]',
      'span',
      'div',
    ];
    for (var s = 0; s < selectors.length; s++) {
      var nodes = document.querySelectorAll(selectors[s]);
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (!isInMainBrowseColumn(node, { ignoreVisibility: true })) {
          continue;
        }
        if (!looksLikeActiveFilterChip(node)) {
          continue;
        }
        return node.closest('button, a, [role="button"]') || node;
      }
    }
    return null;
  }

  function findTranslationFilterChipAnywhere() {
    if (!translationFilterExcludedInUrl()) {
      return null;
    }
    var chip = findNexusActiveFilterChip();
    if (chip) {
      return chip;
    }
    var nodes = document.querySelectorAll('[class*="ActiveFilter"], [class*="AppliedFilter"], button, a, [role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!isInMainBrowseColumn(node, { ignoreVisibility: true })) {
        continue;
      }
      var text = normalizeUiText(node.textContent);
      var aria = normalizeUiText(node.getAttribute && node.getAttribute('aria-label'));
      if ((text.indexOf('translation') >= 0 || aria.indexOf('translation') >= 0) &&
          (text.indexOf('exclud') >= 0 || aria.indexOf('exclud') >= 0)) {
        return node.closest('button, a, [role="button"]') || node;
      }
    }
    return null;
  }

  function findActiveFiltersRowFromChip(chip) {
    if (!chip) {
      return null;
    }
    var clearEl = findNexusClearAllControl(chip.parentElement) || findNexusClearAllControl(null);
    var row = chip.parentElement;
    if (clearEl && row && row.contains(clearEl)) {
      return row;
    }
    if (clearEl && clearEl.parentElement && clearEl.parentElement.contains(chip)) {
      return clearEl.parentElement;
    }
    return row;
  }

  function rowHasVisibleActiveFilterChips(row) {
    if (!row || !row.querySelectorAll) {
      return false;
    }
    var chips = row.querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < chips.length; i++) {
      var chip = chips[i];
      if (isClearAllControl(chip)) {
        continue;
      }
      if (looksLikeActiveFilterChip(chip)) {
        return true;
      }
      var text = normalizeUiText(chip.textContent);
      if (text.indexOf('excluded:') >= 0 ||
          text.indexOf('hide adult') >= 0 ||
          text.indexOf('hide installed') >= 0 ||
          text.indexOf('only installed') >= 0 ||
          text.indexOf('hide tracked') >= 0 ||
          text.indexOf('only tracked') >= 0) {
        return true;
      }
    }
    return false;
  }

  function browseUrlHasRemovableActiveFilters() {
    if (translationFilterExcludedInUrl()) {
      return true;
    }
    return urlHasActiveNexusFilters();
  }

  function shouldPreserveActiveFilterRow(row) {
    if (!row) {
      return false;
    }
    if (rowHasVisibleActiveFilterChips(row)) {
      return true;
    }
    if (browseUrlHasRemovableActiveFilters() && findNexusClearAllControl(row)) {
      return true;
    }
    return false;
  }

  function findExcludedTranslationChipInRow(row) {
    if (!row || !row.querySelectorAll) {
      return null;
    }
    var nodes = row.querySelectorAll('button, a, [role="button"], span, div, p');
    for (var i = 0; i < nodes.length; i++) {
      var text = normalizeUiText(nodes[i].textContent);
      if (text.indexOf('excluded:') >= 0 && text.indexOf('translation') >= 0) {
        return nodes[i].closest('button, a, [role="button"]') || nodes[i];
      }
    }
    return null;
  }

  function ensureActiveFilterRowVisible(row) {
    if (!row) {
      return;
    }
    row.classList.remove(
      'vortex-enhanced-chrome-hidden',
      'vortex-enhanced-browse-trim-hidden',
      'vortex-enhanced-nexus-active-filters-empty',
      'vortex-enhanced-browse-gap-collapse'
    );
    unhideBrowseContentChain(row);
    row.querySelectorAll('button, a, [role="button"], span, div, p').forEach(function (node) {
      if (isClearAllControl(node) || looksLikeActiveFilterChip(node)) {
        node.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden', 'vortex-enhanced-browse-gap-collapse');
      }
      var text = normalizeUiText(node.textContent);
      if (text.indexOf('excluded:') >= 0 || text.indexOf('translation') >= 0) {
        node.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden', 'vortex-enhanced-browse-gap-collapse');
      }
    });
  }

  function findNexusActiveFilterRow() {
    var chip = findTranslationFilterChipAnywhere() || findNexusActiveFilterChip();
    if (chip) {
      ensureActiveFilterRowVisible(chip.closest('[class*="ActiveFilter"], [class*="AppliedFilter"], [class*="ResultsHeader"]') || chip.parentElement);
      var chipRow = findActiveFiltersRowFromChip(chip);
      if (chipRow && isInMainBrowseColumn(chipRow, { ignoreVisibility: true })) {
        return chipRow;
      }
    }

    if (!browseUrlHasRemovableActiveFilters()) {
      return null;
    }

    var clearEl = findNexusClearAllControl(null);
    if (!clearEl || !isInMainBrowseColumn(clearEl)) {
      return null;
    }

    var row = clearEl.parentElement;
    for (var depth = 0; depth < 6 && row; depth++) {
      if (!isInMainBrowseColumn(row)) {
        break;
      }
      if (rowHasSortControls(row) || rowLooksLikeResultsHeader(row)) {
        break;
      }
      if (findNexusClearAllControl(row)) {
        return row;
      }
      row = row.parentElement;
    }

    return clearEl.parentElement;
  }

  function nodeIsProtectedFromGapCollapse(node) {
    if (!node) {
      return true;
    }
    if (node.classList && node.classList.contains('vortex-enhanced-carousel-host')) {
      return true;
    }
    if (node.closest('.vortex-enhanced-carousel-host')) {
      return true;
    }
    if (node.querySelector('.vortex-enhanced-carousel-host, .vortex-enhanced-grid-layout, [data-e2eid="mod-tile"]')) {
      return true;
    }
    if (rowHasSortControls(node)) {
      return true;
    }
    if (toolbarChildShouldStayVisible(node)) {
      return true;
    }
    if (node.querySelector('.vortex-enhanced-sort-toolbar-row, .vortex-enhanced-unified-toolbar-row, .vortex-enhanced-results-toolbar')) {
      return true;
    }
    return false;
  }

  function restoreNumericBrowseVisibilityLight() {
    var shellSelectors = [
      '.vortex-enhanced-carousel-host',
      '.vortex-enhanced-grid-layout',
      '.vortex-enhanced-nexus-grid',
      '.vortex-enhanced-unified-toolbar-row',
      '.vortex-enhanced-sort-toolbar-row',
      '.vortex-enhanced-results-toolbar',
      '#vortex-enhanced-carousel-controls',
      '#vortex-enhanced-controls-bar',
      '#vortex-enhanced-controls-anchor',
      '[data-vortex-enhanced-ui="true"]',
    ];
    shellSelectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (node) {
        node.classList.remove(
          'vortex-enhanced-browse-gap-collapse',
          'vortex-enhanced-nexus-active-filters-empty',
          'vortex-enhanced-chrome-hidden',
          'vortex-enhanced-browse-trim-hidden'
        );
        unhideBrowseContentChain(node);
      });
    });
    var grid = resolveNexusModGridElement() || findModGrid();
    if (grid) {
      unhideBrowseContentChain(grid);
      var host = grid.parentElement;
      if (host) {
        host.classList.add('vortex-enhanced-carousel-host');
        host.classList.remove('vortex-enhanced-browse-gap-collapse', 'vortex-enhanced-chrome-hidden');
        unhideBrowseContentChain(host);
      }
    }
  }

  function restoreMainBrowseContentVisibility() {
    if (shouldUseNumericFilteredBrowseScan()) {
      restoreNumericBrowseVisibilityLight();
      return;
    }
    var selectors = [
      '.vortex-enhanced-carousel-host',
      '.vortex-enhanced-grid-layout',
      '.vortex-enhanced-nexus-grid',
      '.vortex-enhanced-unified-toolbar-row',
      '.vortex-enhanced-sort-toolbar-row',
      '.vortex-enhanced-results-toolbar',
      '#vortex-enhanced-carousel-controls',
      '#vortex-enhanced-controls-bar',
      '#vortex-enhanced-controls-anchor',
      '[data-vortex-enhanced-ui="true"]',
      '[data-e2eid="mod-tile"]',
    ];
    selectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (node) {
        node.classList.remove(
          'vortex-enhanced-browse-gap-collapse',
          'vortex-enhanced-nexus-active-filters-empty',
          'vortex-enhanced-chrome-hidden',
          'vortex-enhanced-browse-trim-hidden'
        );
        if (node.style) {
          node.style.removeProperty('height');
          node.style.removeProperty('min-height');
          node.style.removeProperty('margin');
          node.style.removeProperty('padding');
        }
        unhideBrowseContentChain(node);
      });
    });

    var grid = findModGrid();
    if (grid) {
      unhideBrowseContentChain(grid);
      var host = grid.parentElement;
      if (host) {
        host.classList.remove('vortex-enhanced-browse-gap-collapse', 'vortex-enhanced-chrome-hidden');
        unhideBrowseContentChain(host);
      }
    }
  }

  function clearBrowseLayoutCollapseMarks() {
    restoreMainBrowseContentVisibility();

    document.querySelectorAll('.vortex-enhanced-browse-gap-collapse, .vortex-enhanced-nexus-active-filters-empty').forEach(function (node) {
      if (nodeIsProtectedFromGapCollapse(node)) {
        node.classList.remove('vortex-enhanced-browse-gap-collapse', 'vortex-enhanced-nexus-active-filters-empty');
      }
    });
  }

  function nodeIsStrictDismissedFilterRow(node) {
    if (!node || !isInMainBrowseColumn(node, { ignoreVisibility: true })) {
      return false;
    }
    if (nodeIsProtectedFromGapCollapse(node)) {
      return false;
    }
    if (rowHasVisibleActiveFilterChips(node)) {
      return false;
    }
    if (rowHasSortControls(node)) {
      return false;
    }
    if (node.querySelector('[data-e2eid="mod-tile"], .vortex-enhanced-carousel-host, .vortex-enhanced-grid-layout')) {
      return false;
    }
    var text = normalizeUiText(node.textContent);
    if (/\b[\d][\d,]*\s+(?:results|matching)\b/i.test(text)) {
      return false;
    }
    if (text.indexOf('date published') >= 0 || text.indexOf('prev') >= 0 || text.indexOf('next') >= 0) {
      return false;
    }
    if (node.classList.contains('vortex-enhanced-nexus-active-filters')) {
      return true;
    }
    var className = String(node.className || '');
    if (className.indexOf('ActiveFilter') < 0 && className.indexOf('AppliedFilter') < 0) {
      return false;
    }
    return text.indexOf('clear all') >= 0 ||
      text.indexOf('excluded') >= 0 ||
      text.indexOf('translation') >= 0;
  }

  function collapseDismissedFilterNode(node) {
    if (!node || nodeIsProtectedFromGapCollapse(node)) {
      return;
    }
    if (rowHasSortControls(node) || node.querySelector('[data-e2eid="mod-tile"], .vortex-enhanced-carousel-host')) {
      return;
    }
    node.classList.remove(
      'vortex-enhanced-nexus-active-filters',
      'vortex-enhanced-nexus-active-filters-shell',
      'vortex-enhanced-nexus-active-filters-host',
      'vortex-enhanced-nexus-browse-header-compact',
      'vortex-enhanced-has-active-filters',
      'vortex-enhanced-chrome-hidden'
    );
    node.classList.add('vortex-enhanced-browse-gap-collapse', 'vortex-enhanced-nexus-active-filters-empty');
  }

  function syncBrowseUrlFilterDocumentState() {
    var root = document.documentElement;
    if (!root) {
      return;
    }
    if (browseUrlHasRemovableActiveFilters()) {
      root.classList.remove('vortex-enhanced-no-url-filters');
      return;
    }
    root.classList.add('vortex-enhanced-no-url-filters');
  }

  function nodeLooksLikeEmptyFilterSlot(node) {
    if (!node || nodeIsProtectedFromGapCollapse(node)) {
      return false;
    }
    if (rowHasVisibleActiveFilterChips(node) || rowHasSortControls(node)) {
      return false;
    }
    if (!isInMainBrowseColumn(node, { ignoreVisibility: true })) {
      return false;
    }
    if (node.closest('.vortex-enhanced-carousel-host, aside, #filters-panel, [data-vortex-enhanced-filters="true"]')) {
      return false;
    }
    if (node.querySelector('.vortex-enhanced-carousel-host, .vortex-enhanced-unified-toolbar-row, .vortex-enhanced-sort-toolbar-row, [data-e2eid="mod-tile"]')) {
      return false;
    }
    if (node.classList && node.classList.contains('vortex-enhanced-nexus-active-filters-empty')) {
      return true;
    }
    var className = String(node.className || '');
    if (className.indexOf('ActiveFilter') >= 0 || className.indexOf('AppliedFilter') >= 0) {
      return nodeIsStrictDismissedFilterRow(node);
    }
    if (node.classList && node.classList.contains('vortex-enhanced-nexus-active-filters')) {
      return nodeIsStrictDismissedFilterRow(node);
    }
    return false;
  }

  function collapseFilterGapBetweenToolbarAndGrid() {
    syncBrowseUrlFilterDocumentState();
    if (browseUrlHasRemovableActiveFilters() ||
        shouldDeferDismissLayoutCollapse()) {
      return;
    }

    restoreMainBrowseContentVisibility();

    var host = document.querySelector('.vortex-enhanced-carousel-host') || findModGrid();
    var toolbar = findResultsToolbarRow();
    if (!host) {
      return;
    }

    if (toolbar) {
      toolbar.classList.remove('vortex-enhanced-has-active-filters');
      if (toolbar.style) {
        toolbar.style.removeProperty('padding-bottom');
        toolbar.style.removeProperty('margin-bottom');
        toolbar.style.removeProperty('min-height');
        toolbar.style.removeProperty('row-gap');
      }
      collapseEmptyToolbarChildren(toolbar);
    }

    document.querySelectorAll('.vortex-enhanced-nexus-active-filters, [class*="ActiveFilter"], [class*="AppliedFilter"]').forEach(function (node) {
      if (nodeIsStrictDismissedFilterRow(node)) {
        collapseDismissedFilterNode(node);
      }
    });

    hideOrphanedClearAllRows();

    if (host.style) {
      host.style.removeProperty('margin-top');
      host.style.removeProperty('padding-top');
    }
    if (toolbar && toolbar.style) {
      toolbar.style.removeProperty('padding-bottom');
      toolbar.style.removeProperty('margin-bottom');
    }
  }

  function finalizeDismissedFilterLayout() {
    if (browseUrlHasRemovableActiveFilters()) {
      return;
    }

    restoreMainBrowseContentVisibility();

    document.querySelectorAll('.vortex-enhanced-nexus-active-filters, [class*="ActiveFilter"], [class*="AppliedFilter"]').forEach(function (node) {
      if (!nodeIsStrictDismissedFilterRow(node)) {
        return;
      }
      collapseDismissedFilterNode(node);
    });

    document.querySelectorAll('.vortex-enhanced-unified-toolbar-row, .vortex-enhanced-sort-toolbar-row, .vortex-enhanced-results-toolbar').forEach(function (toolbar) {
      toolbar.classList.remove('vortex-enhanced-has-active-filters');
      if (toolbar.style) {
        toolbar.style.removeProperty('padding-bottom');
        toolbar.style.removeProperty('margin-bottom');
        toolbar.style.removeProperty('min-height');
      }
    });

    document.querySelectorAll('.vortex-enhanced-nexus-active-filters-shell, .vortex-enhanced-nexus-active-filters-host').forEach(function (node) {
      node.classList.remove('vortex-enhanced-nexus-active-filters-shell', 'vortex-enhanced-nexus-active-filters-host');
    });

    hideOrphanedClearAllRows();
    collapseFilterGapBetweenToolbarAndGrid();
  }

  function hideOrphanedClearAllRows() {
    if (browseUrlHasRemovableActiveFilters()) {
      return;
    }

    document.querySelectorAll('.vortex-enhanced-nexus-active-filters, .vortex-enhanced-nexus-clear-all').forEach(function (node) {
      var row = node.classList && node.classList.contains('vortex-enhanced-nexus-active-filters')
        ? node
        : node.closest('.vortex-enhanced-nexus-active-filters');
      if (!row) {
        if (isClearAllControl(node)) {
          row = node.parentElement;
        }
      }
      if (!row || shouldPreserveActiveFilterRow(row)) {
        return;
      }
      row.classList.add('vortex-enhanced-browse-gap-collapse', 'vortex-enhanced-nexus-active-filters-empty');
      row.classList.remove('vortex-enhanced-nexus-active-filters');
    });

    var clearEl = findNexusClearAllControl(null);
    if (clearEl && isInMainBrowseColumn(clearEl)) {
      var clearRow = clearEl.parentElement;
      if (clearRow && !shouldPreserveActiveFilterRow(clearRow)) {
        clearRow.classList.add('vortex-enhanced-browse-gap-collapse', 'vortex-enhanced-nexus-active-filters-empty');
      }
    }
  }

  function releaseActiveFiltersShellMarks() {
    var filtersActive = browseUrlHasRemovableActiveFilters();
    document.querySelectorAll('.vortex-enhanced-nexus-active-filters-shell .vortex-enhanced-browse-trim-hidden').forEach(function (node) {
      if (!filtersActive || !normalizeUiText(node.textContent)) {
        node.classList.add('vortex-enhanced-browse-gap-collapse');
        node.classList.remove('vortex-enhanced-browse-trim-hidden');
        return;
      }
      node.classList.remove('vortex-enhanced-browse-trim-hidden');
    });
    document.querySelectorAll('.vortex-enhanced-nexus-active-filters-shell, .vortex-enhanced-nexus-active-filters-host, .vortex-enhanced-nexus-browse-header-compact').forEach(function (node) {
      if (!filtersActive && !node.querySelector('.vortex-enhanced-nexus-active-filters')) {
        node.classList.add('vortex-enhanced-browse-gap-collapse');
      }
      node.classList.remove('vortex-enhanced-nexus-active-filters-shell', 'vortex-enhanced-nexus-active-filters-host', 'vortex-enhanced-nexus-browse-header-compact');
    });
  }

  function toolbarChildShouldStayVisible(child) {
    if (!child) {
      return false;
    }
    if (rowHasVisibleActiveFilterChips(child)) {
      return true;
    }
    if (rowHasSortControls(child)) {
      return true;
    }
    if (child.querySelector('#vortex-enhanced-carousel-controls, #vortex-enhanced-controls-anchor')) {
      return true;
    }
    var text = normalizeUiText(child.textContent);
    if (/\b[\d][\d,]*\s+(?:results|matching)\b/i.test(text)) {
      return true;
    }
    if (text.indexOf('date published') >= 0 ||
        text.indexOf('all time') >= 0 ||
        text.indexOf('prev') >= 0 ||
        text.indexOf('next') >= 0) {
      return true;
    }
    return false;
  }

  function collapseEmptyToolbarChildren(toolbar) {
    if (!toolbar || !toolbar.children || browseUrlHasRemovableActiveFilters()) {
      return;
    }
    Array.prototype.forEach.call(toolbar.children, function (child) {
      if (toolbarChildShouldStayVisible(child)) {
        child.classList.remove(
          'vortex-enhanced-browse-gap-collapse',
          'vortex-enhanced-nexus-active-filters-empty',
          'vortex-enhanced-nexus-active-filters'
        );
        if (child.style) {
          child.style.removeProperty('min-height');
          child.style.removeProperty('height');
        }
        return;
      }
      if (nodeLooksLikeEmptyFilterSlot(child) || nodeIsStrictDismissedFilterRow(child)) {
        collapseDismissedFilterNode(child);
        return;
      }
      var text = normalizeUiText(child.textContent);
      if (!text) {
        collapseDismissedFilterNode(child);
        return;
      }
      if (text !== 'clear all' &&
          text.indexOf('excluded:') < 0 &&
          text.indexOf('excluded translation') < 0) {
        return;
      }
      collapseDismissedFilterNode(child);
    });
  }

  function trimBrowseGapAboveGrid() {
    var host = document.querySelector('.vortex-enhanced-carousel-host') || findModGrid();
    if (!host) {
      return;
    }

    var toolbar = findResultsToolbarRow();
    if (!browseUrlHasRemovableActiveFilters()) {
      hideOrphanedClearAllRows();
      if (toolbar) {
        toolbar.classList.remove('vortex-enhanced-has-active-filters');
      }
    }
    collapseEmptyToolbarChildren(toolbar);

    var toolbarBottom = toolbar ? toolbar.getBoundingClientRect().bottom : 0;
    var hostTop = host.getBoundingClientRect().top;
    var gap = hostTop - toolbarBottom;

    if (gap < 6) {
      if (toolbar) {
        toolbar.style.removeProperty('padding-bottom');
        toolbar.style.removeProperty('margin-bottom');
        toolbar.style.removeProperty('min-height');
      }
      hideOrphanedClearAllRows();
      return;
    }

    if (!shouldDeferDismissLayoutCollapse()) {
      collapseFilterGapBetweenToolbarAndGrid();
    }
  }

  function collapseEmptyActiveFiltersLayout() {
    releaseActiveFiltersShellMarks();

    document.querySelectorAll('.vortex-enhanced-unified-toolbar-row, .vortex-enhanced-sort-toolbar-row').forEach(function (toolbar) {
      if (!toolbar.querySelector('.vortex-enhanced-nexus-active-filters') ||
          !rowHasVisibleActiveFilterChips(toolbar)) {
        toolbar.classList.remove('vortex-enhanced-has-active-filters');
      }
    });

    document.querySelectorAll('.vortex-enhanced-nexus-active-filters-empty').forEach(function (node) {
      if (!node.classList.contains('vortex-enhanced-browse-gap-collapse')) {
        node.classList.remove('vortex-enhanced-nexus-active-filters-empty');
      }
    });

    var candidates = document.querySelectorAll('[class*="ResultsHeader"], [class*="ActiveFilter"], [class*="AppliedFilter"]');
    for (var i = 0; i < candidates.length; i++) {
      var node = candidates[i];
      if (!isInMainBrowseColumn(node)) {
        continue;
      }
      if (node.closest('.vortex-enhanced-carousel-host, [data-vortex-enhanced-filters="true"], aside, #filters-panel')) {
        continue;
      }
      if (toolbarChildShouldStayVisible(node)) {
        continue;
      }
      if (node.querySelector('.vortex-enhanced-carousel-host')) {
        continue;
      }

      var text = normalizeUiText(node.textContent);
      var lookedLikeFilters = rowLooksLikeNexusActiveFilters(node) ||
        text.indexOf('excluded:') >= 0 ||
        (text.indexOf('clear all') >= 0 && text.length < 32);
      if (!lookedLikeFilters && text) {
        continue;
      }
      if (shouldPreserveActiveFilterRow(node)) {
        node.classList.remove('vortex-enhanced-nexus-active-filters-empty', 'vortex-enhanced-browse-gap-collapse');
        continue;
      }

      node.classList.add('vortex-enhanced-nexus-active-filters-empty');
      node.classList.add('vortex-enhanced-browse-gap-collapse');
      node.classList.remove('vortex-enhanced-nexus-active-filters');
    }

    hideOrphanedClearAllRows();
    trimBrowseGapAboveGrid();
  }

  function compactActiveFiltersShell(row) {
    if (!row) {
      return;
    }
    var shell = row.parentElement;
    for (var depth = 0; depth < 5 && shell; depth++) {
      if (!isInMainBrowseColumn(shell)) {
        break;
      }
      shell.classList.add('vortex-enhanced-nexus-active-filters-shell');
      shell.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden', 'vortex-enhanced-nexus-active-filters-empty');
      if (shell.querySelector('.vortex-enhanced-sort-toolbar-row, .vortex-enhanced-unified-toolbar-row')) {
        Array.prototype.forEach.call(shell.children, function (child) {
          if (child === row || child.contains(row)) {
            return;
          }
          if (child.querySelector('.vortex-enhanced-sort-toolbar-row, .vortex-enhanced-unified-toolbar-row')) {
            return;
          }
          var childText = normalizeUiText(child.textContent);
          if (!childText) {
            child.classList.add('vortex-enhanced-browse-trim-hidden');
          }
        });
      }
      if (shell.matches && shell.matches('[class*="ResultsHeader"]')) {
        break;
      }
      shell = shell.parentElement;
    }
  }

  function resolveNexusFilterChipActionTarget(node, row) {
    if (!node || !row || !row.contains(node)) {
      return null;
    }

    var clearNode = node.closest('.vortex-enhanced-nexus-clear-all') ||
      (isClearAllControl(node) ? node : null);
    if (clearNode && row.contains(clearNode)) {
      return clearNode.closest('button, a, [role="button"]') || clearNode;
    }

    var chip = node.closest('button, a, [role="button"]');
    if (!chip || !row.contains(chip)) {
      return null;
    }
    if (isClearAllControl(chip)) {
      return chip;
    }

    var chipText = normalizeUiText(chip.textContent);
    if (chipText.indexOf('excluded:') >= 0 ||
        chipText.indexOf('hide adult') >= 0 ||
        chipText.indexOf('hide installed') >= 0 ||
        chipText.indexOf('only installed') >= 0 ||
        chipText.indexOf('hide tracked') >= 0 ||
        chipText.indexOf('only tracked') >= 0) {
      if (node !== chip) {
        var nested = node.closest('button, [role="button"]');
        if (nested && chip.contains(nested) && nested !== chip) {
          return nested;
        }
      }
      return chip;
    }

    return chip;
  }

  function triggerNativeFilterControlClick(target) {
    if (!target || !target.isConnected) {
      return false;
    }

    enhancer.allowNexusPaginationClick = true;
    try {
      target.click();
      return true;
    } catch (errClick) {
      return false;
    } finally {
      setTimeout(function () {
        enhancer.allowNexusPaginationClick = false;
      }, 300);
    }
  }

  function ensureActiveFilterRowInteraction(row) {
    if (!row || row.getAttribute('data-vortex-active-filter-click') === 'true') {
      return;
    }
    row.setAttribute('data-vortex-active-filter-click', 'true');
    row.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) {
        return;
      }

      noteNexusActiveFilterUserAction(event);

      var actionTarget = resolveNexusFilterChipActionTarget(event.target, row);
      if (!actionTarget) {
        return;
      }

      if (event.target === actionTarget) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      triggerNativeFilterControlClick(actionTarget);
    }, true);
  }

  function layoutNexusActiveFiltersInline() {
    document.querySelectorAll('.vortex-enhanced-nexus-active-filters').forEach(function (node) {
      if (node.style) {
        node.style.removeProperty('display');
        node.style.removeProperty('flex-direction');
        node.style.removeProperty('flex-wrap');
        node.style.removeProperty('align-items');
        node.style.removeProperty('gap');
        node.style.removeProperty('margin');
        node.style.removeProperty('padding');
        node.style.removeProperty('min-height');
        node.style.removeProperty('width');
      }
      node.classList.remove('vortex-enhanced-nexus-active-filters');
    });
    releaseActiveFiltersShellMarks();

    var row = findNexusActiveFilterRow();
    if (!row || !isInMainBrowseColumn(row)) {
      if (isTranslationFilterDismissedBrowse()) {
        syncDismissedFilterBrowseState();
        return null;
      }
      if (!browseUrlHasRemovableActiveFilters()) {
        hideOrphanedClearAllRows();
      } else {
        collapseEmptyActiveFiltersLayout();
      }
      return null;
    }

    row.classList.add('vortex-enhanced-nexus-active-filters');
    ensureActiveFilterRowVisible(row);

    var toolbar = row.closest('.vortex-enhanced-unified-toolbar-row, .vortex-enhanced-sort-toolbar-row');
    if (toolbar) {
      toolbar.classList.add('vortex-enhanced-has-active-filters');
    }

    var clearEl = findNexusClearAllControl(row) || findNexusClearAllControl(null);
    if (clearEl) {
      clearEl.classList.add('vortex-enhanced-nexus-clear-all');
      clearEl.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
    }

    var translationChip = findTranslationFilterChipAnywhere();
    if (translationChip) {
      var chipRow = translationChip.closest('[class*="ActiveFilter"], [class*="AppliedFilter"], [class*="ResultsHeader"]') || translationChip.parentElement;
      if (chipRow && chipRow !== row) {
        ensureActiveFilterRowVisible(chipRow);
        chipRow.classList.add('vortex-enhanced-nexus-active-filters');
      } else {
        ensureActiveFilterRowVisible(translationChip);
      }
    }

    compactActiveFiltersShell(row);
    ensureActiveFilterRowInteraction(row);

    if (translationFilterExcludedInUrl() && !findExcludedTranslationChipInRow(row)) {
      setTimeout(function () {
        if (window.__vortexBrowseEnhancer) {
          window.__vortexBrowseEnhancer.scheduleScan(true);
        }
      }, 450);
    }

    return row;
  }

  function unhideBrowseContentChain(node) {
    var current = node;
    while (current && current !== document.documentElement) {
      if (current.id === 'siteHeader' ||
          current.id === 'site-header' ||
          (current.tagName === 'HEADER' && !current.querySelector('.vortex-enhanced-sort-toolbar-row, .vortex-enhanced-nexus-active-filters'))) {
        break;
      }
      if (current.classList && (
        current.classList.contains('vortex-enhanced-chrome-hidden') ||
        current.classList.contains('vortex-enhanced-browse-trim-hidden')
      )) {
        current.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
      } else if (current.classList) {
        current.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
      }
      current = current.parentElement;
    }
  }

  function protectNexusActiveFiltersRow() {
    return layoutNexusActiveFiltersInline();
  }

  function rowLooksLikeResultsToolbarContainer(node) {
    if (!node || !node.querySelector) {
      return false;
    }
    return !!(
      node.querySelector('.vortex-enhanced-sort-toolbar-row, .vortex-enhanced-unified-toolbar-row') ||
      rowHasSortControls(node) ||
      /\b[\d][\d,]* results\b/i.test(normalizeUiText(node.textContent))
    );
  }

  function protectNexusBrowseHeaderStack() {
    var toolbar = findResultsToolbarRow();
    if (toolbar && isInMainBrowseColumn(toolbar)) {
      toolbar.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
      unhideBrowseContentChain(toolbar);
    }
    if (isTranslationFilterDismissedBrowse()) {
      syncDismissedFilterBrowseState();
      return toolbar;
    }
    var row = layoutNexusActiveFiltersInline();
    trimBrowseGapAboveGrid();
    return row || toolbar;
  }

  function shouldPreserveMainColumnBrowseChrome(node) {
    if (!node) {
      return false;
    }
    if (rowHasSortControls(node) || rowLooksLikeResultsToolbarContainer(node)) {
      return true;
    }
    if (node.classList &&
        (node.classList.contains('vortex-enhanced-results-toolbar') ||
         node.classList.contains('vortex-enhanced-nexus-active-filters'))) {
      return true;
    }
    if (browseUrlHasRemovableActiveFilters() &&
        rowHasVisibleActiveFilterChips(node) &&
        (rowLooksLikeNexusActiveFilters(node) || shouldPreserveActiveFilterRow(node))) {
      return true;
    }
    if (node.querySelector &&
        node.querySelector('.vortex-enhanced-sort-toolbar-row, .vortex-enhanced-unified-toolbar-row, [data-e2eid="mod-tile"]')) {
      return true;
    }
    return false;
  }

  function shouldKeepVisibleInHideChrome(node, host) {
    if (!node || !host) {
      return false;
    }
    if (node === host || node.contains(host)) {
      return true;
    }
    if (node.classList && node.classList.contains('vortex-enhanced-nexus-active-filters')) {
      return browseUrlHasRemovableActiveFilters() && rowHasVisibleActiveFilterChips(node);
    }
    if ((node.tagName === 'ASIDE' || node.id === 'filters-panel') &&
        (node.classList.contains('vortex-enhanced-nexus-filters-open') || isNexusFiltersPanelVisible())) {
      return true;
    }
    if (node.querySelector && node.querySelector(
      '.vortex-enhanced-carousel-host, .vortex-enhanced-grid-layout, .vortex-enhanced-sort-toolbar-row, .vortex-enhanced-unified-toolbar-row, .vortex-enhanced-nexus-active-filters, [data-vortex-enhanced-ui="true"], [data-e2eid="mod-tile"]'
    )) {
      return true;
    }
    if (rowLooksLikeResultsToolbarContainer(node)) {
      return true;
    }
    if (rowLooksLikeNexusActiveFilters(node)) {
      return true;
    }
    if (nodeHasVortexEnhancedUi(node)) {
      return true;
    }
    return false;
  }

  function isValidFilterToolbarRow(row) {
    if (!row || !isInMainBrowseColumn(row, { ignoreVisibility: true })) {
      return false;
    }
    if (row.closest('aside') || row.tagName === 'ASIDE' || row.querySelector('aside')) {
      return false;
    }
    var text = normalizeUiText(row.textContent);
    if (text.indexOf('vortex filters') >= 0 ||
        text.indexOf('categories') >= 0 ||
        text.indexOf('language support') >= 0) {
      return false;
    }
    return rowHasVisibleActiveFilterChips(row) ||
      !!findNexusClearAllControl(row) ||
      hasVisibleNexusFilterChipText() ||
      !!row.querySelector('[data-vortex-results-headline="true"]');
  }

  function isValidCarouselToolbarRow(row) {
    if (!row) {
      return false;
    }
    if (!rowHasSortControls(row)) {
      return false;
    }
    if (row.closest('aside') || row.tagName === 'ASIDE') {
      return false;
    }
    if (row.querySelector('aside')) {
      return false;
    }
    var text = normalizeUiText(row.textContent);
    if (text.indexOf('categories') >= 0 ||
        text.indexOf('language support') >= 0 ||
        text.indexOf('vortex filters') >= 0) {
      return false;
    }
    return !rowLooksLikeResultsHeader(row);
  }

  function findFilteredResultsToolbarRow() {
    var row = findNexusActiveFilterRow();
    if (row && isValidFilterToolbarRow(row)) {
      return row;
    }
    row = document.querySelector('.vortex-enhanced-nexus-active-filters');
    if (row && isValidFilterToolbarRow(row)) {
      return row;
    }
    var headline = findResultsHeadlineElement();
    if (headline) {
      var el = headline.parentElement;
      for (var depth = 0; depth < 8 && el; depth++) {
        if (rowHasSortControls(el)) {
          break;
        }
        if (isValidFilterToolbarRow(el)) {
          return el;
        }
        el = el.parentElement;
      }
      var chipShell = headline.closest('[class*="ActiveFilter"], [class*="AppliedFilter"], [class*="ResultsHeader"]');
      if (chipShell && isValidFilterToolbarRow(chipShell)) {
        return chipShell;
      }
    }
    return null;
  }

  function mountCarouselControlsInSortRow(row) {
    if (!row || !rowHasSortControls(row)) {
      return false;
    }
    clearInHostControlsBar();
    removeControlsFallbackBar();
    row.classList.add('vortex-enhanced-results-toolbar', 'vortex-enhanced-sort-toolbar-row');
    var anchor = ensureControlsAnchor(row);
    var controls = ensureCarouselControls();
    if (controls.parentElement !== anchor) {
      anchor.appendChild(controls);
    }
    enhancer.controlsPinnedFilterRow = null;
    enhancer.controlsPinnedSortRow = row;
    return true;
  }

  function cleanupInvalidToolbarRows() {
    document.querySelectorAll('aside.vortex-enhanced-results-toolbar, aside.vortex-enhanced-sort-toolbar-row').forEach(function (node) {
      node.classList.remove('vortex-enhanced-results-toolbar', 'vortex-enhanced-sort-toolbar-row');
    });
  }

  function findToolbarButton(labelExact) {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var label = normalizeUiText(btn.getAttribute('aria-label') || btn.textContent);
      if (label === labelExact) {
        return btn;
      }
    }
    return null;
  }

  function rowHasSortControls(row) {
    if (!row || !row.querySelector) {
      return false;
    }
    return !!(
      row.querySelector('button[aria-label="Sort by"]') ||
      row.querySelector('button[aria-label="Sort direction"]') ||
      row.querySelector('button[aria-label="Mods per page"]') ||
      row.querySelector('button[aria-label="Time"]') ||
      row.querySelector('button[aria-label="Display"]')
    );
  }

  function rowLooksLikeResultsHeader(row) {
    var text = normalizeUiText(row && row.textContent);
    return text.indexOf('show filters') >= 0 || /\b\d[\d,]* results\b/.test(text);
  }

  function findResultsHeadlineElement() {
    var marked = document.querySelector('[data-vortex-results-headline="true"]');
    if (marked) {
      return marked;
    }

    var resultsHeadline = null;
    var matchingHeadline = null;
    walkResultsCountLabelHosts(function (host, _text, label) {
      if (label === 'results' && !resultsHeadline) {
        resultsHeadline = host;
        return false;
      }
      if (label === 'matching' && !matchingHeadline) {
        matchingHeadline = host;
      }
    });
    if (resultsHeadline) {
      return resultsHeadline;
    }
    if (!hasNumericNexusBrowseFilters() && matchingHeadline) {
      return matchingHeadline;
    }
    return null;
  }

  function findUnifiedToolbarRow() {
    var sortRow = findSortToolbarRow();
    var headline = findResultsHeadlineElement();

    if (headline) {
      var headEl = headline;
      for (var headDepth = 0; headDepth < 12 && headEl; headDepth++) {
        if (rowHasSortControls(headEl) && isValidCarouselToolbarRow(headEl)) {
          headEl.classList.add('vortex-enhanced-sort-toolbar-row', 'vortex-enhanced-unified-toolbar-row');
          return headEl;
        }
        if (sortRow && headEl.contains(sortRow)) {
          if (isValidCarouselToolbarRow(headEl)) {
            headEl.classList.add('vortex-enhanced-sort-toolbar-row', 'vortex-enhanced-unified-toolbar-row');
            return headEl;
          }
        }
        headEl = headEl.parentElement;
      }
    }

    if (sortRow && headline) {
      var sortAncestor = sortRow;
      for (var sortDepth = 0; sortDepth < 12 && sortAncestor; sortDepth++) {
        if (sortAncestor.contains(headline) && isValidCarouselToolbarRow(sortAncestor)) {
          sortAncestor.classList.add('vortex-enhanced-sort-toolbar-row', 'vortex-enhanced-unified-toolbar-row');
          return sortAncestor;
        }
        sortAncestor = sortAncestor.parentElement;
      }
    }

    if (sortRow) {
      sortRow.classList.add('vortex-enhanced-unified-toolbar-row');
      return sortRow;
    }

    return null;
  }

  function findSortToolbarRow() {
    var seed = findToolbarButton('sort by') ||
      findToolbarButton('sort direction') ||
      findToolbarButton('mods per page') ||
      findToolbarButton('time');

    if (seed) {
      var el = seed;
      for (var depth = 0; depth < 12 && el; depth++) {
        if (rowLooksLikeResultsHeader(el)) {
          if (rowHasSortControls(el) && isValidCarouselToolbarRow(el)) {
            el.classList.add('vortex-enhanced-sort-toolbar-row');
            return el;
          }
          break;
        }
        if (rowHasSortControls(el)) {
          var text = normalizeUiText(el.textContent);
          if (text.indexOf('show filters') < 0 && !/\b\d[\d,]* results\b/.test(text)) {
            if (isValidCarouselToolbarRow(el)) {
              el.classList.add('vortex-enhanced-sort-toolbar-row');
              return el;
            }
          }
        }
        el = el.parentElement;
      }
      if (seed.parentElement) {
        seed.parentElement.classList.add('vortex-enhanced-sort-toolbar-row');
        return seed.parentElement;
      }
    }

    var nodes = document.querySelectorAll('[role="combobox"], button, select');
    for (var i = 0; i < nodes.length; i++) {
      var label = normalizeUiText(nodes[i].textContent);
      if (label.indexOf('date published') >= 0 ||
          label.indexOf('downloads') >= 0 ||
          label.indexOf('endorsements') >= 0 ||
          label === 'desc' ||
          label.indexOf('all time') >= 0) {
        var legacyEl = nodes[i];
        for (var legacyDepth = 0; legacyDepth < 8 && legacyEl; legacyDepth++) {
          if (rowLooksLikeResultsHeader(legacyEl)) {
            if (rowHasSortControls(legacyEl) && isValidCarouselToolbarRow(legacyEl)) {
              legacyEl.classList.add('vortex-enhanced-sort-toolbar-row');
              return legacyEl;
            }
            break;
          }
          var legacyText = normalizeUiText(legacyEl.textContent);
          if ((legacyText.indexOf('date published') >= 0 ||
               legacyText.indexOf('downloads') >= 0 ||
               legacyText.indexOf('endorsements') >= 0) &&
              (legacyText.indexOf('all time') >= 0 || legacyText.indexOf('desc') >= 0)) {
            if (isValidCarouselToolbarRow(legacyEl)) {
              legacyEl.classList.add('vortex-enhanced-sort-toolbar-row');
              return legacyEl;
            }
          }
          legacyEl = legacyEl.parentElement;
        }
      }
    }
    return null;
  }

  function findResultsToolbarRow() {
    if (enhancer.controlsPinnedSortRow && document.body.contains(enhancer.controlsPinnedSortRow)) {
      return enhancer.controlsPinnedSortRow;
    }

    var sortRow = findSortToolbarRow();
    if (sortRow) {
      enhancer.controlsPinnedSortRow = sortRow;
      return sortRow;
    }

    if (!enhancer.filteredBrowseEngaged && !enhancer.domFilterBrowseActive && !hasVisibleNexusFilterChipText()) {
      var unified = findUnifiedToolbarRow();
      if (unified && rowHasSortControls(unified) && !rowLooksLikeResultsHeader(unified)) {
        return unified;
      }
    }

    var showFilters = findShowFiltersRow();
    if (!showFilters) {
      return null;
    }

    var el = showFilters.parentElement;
    for (var depth = 0; depth < 10 && el; depth++) {
      if (rowHasSortControls(el) && !rowLooksLikeResultsHeader(el) && isValidCarouselToolbarRow(el)) {
        el.classList.add('vortex-enhanced-sort-toolbar-row');
        return el;
      }
      el = el.parentElement;
    }

    return showFilters.parentElement;
  }

  function removeControlsFallbackBar() {
    var fallback = document.getElementById('vortex-enhanced-controls-bar');
    if (fallback && fallback.parentElement &&
        !fallback.classList.contains('vortex-enhanced-controls-bar-in-host')) {
      fallback.parentElement.removeChild(fallback);
    }
  }

  function clearInHostControlsBar() {
    var bar = document.getElementById('vortex-enhanced-controls-bar');
    if (bar && bar.classList.contains('vortex-enhanced-controls-bar-in-host') && bar.parentElement) {
      bar.parentElement.removeChild(bar);
    }
  }

  function mountControlsInCarouselHost(controls) {
    if (!controls) {
      return false;
    }

    var host = document.querySelector('.vortex-enhanced-carousel-host');
    if (!host) {
      return false;
    }

    var bar = document.getElementById('vortex-enhanced-controls-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'vortex-enhanced-controls-bar';
      bar.setAttribute('data-vortex-enhanced-ui', 'true');
    }
    bar.className = 'vortex-enhanced-results-toolbar vortex-enhanced-controls-bar-fallback vortex-enhanced-controls-bar-in-host';

    if (bar.parentElement !== host) {
      host.insertBefore(bar, host.firstChild);
    }

    if (controls.parentElement !== bar) {
      bar.appendChild(controls);
    }

    unhideVortexUiAncestors(bar);
    return controls.isConnected;
  }

  function mountControlsFallback(controls) {
    if (!controls) {
      return false;
    }

    var host = document.querySelector('.vortex-enhanced-carousel-host');
    var grid = findModGrid();
    var insertParent = null;
    var insertBefore = null;

    if (host && host.parentElement) {
      insertParent = host.parentElement;
      insertBefore = host;
    } else if (grid && grid.parentElement) {
      insertParent = grid.parentElement;
      insertBefore = grid;
    } else {
      return false;
    }

    var bar = document.getElementById('vortex-enhanced-controls-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'vortex-enhanced-controls-bar';
      bar.className = 'vortex-enhanced-results-toolbar vortex-enhanced-controls-bar-fallback';
      bar.setAttribute('data-vortex-enhanced-ui', 'true');
    }

    if (bar.parentElement !== insertParent || bar.nextElementSibling !== insertBefore) {
      insertParent.insertBefore(bar, insertBefore);
    }

    if (controls.parentElement !== bar) {
      bar.appendChild(controls);
    }

    return controls.isConnected;
  }

  function controlsAreVisible(controls) {
    if (!controls || !controls.isConnected) {
      return false;
    }
    var rect = controls.getBoundingClientRect();
    return rect.width > 8 && rect.height > 8;
  }

  function ensureControlsAnchor(toolbarRow) {
    var anchor = document.getElementById('vortex-enhanced-controls-anchor');
    if (!anchor) {
      anchor = document.createElement('div');
      anchor.id = 'vortex-enhanced-controls-anchor';
      anchor.className = 'vortex-enhanced-controls-anchor';
      anchor.setAttribute('data-vortex-enhanced-ui', 'true');
    }

    if (anchor.parentElement !== toolbarRow) {
      toolbarRow.classList.add('vortex-enhanced-results-toolbar');
      toolbarRow.appendChild(anchor);
    }

    return anchor;
  }

  function bindCarouselControlButtons(controls) {
    if (!controls) {
      return;
    }
    var buttons = controls.querySelectorAll('.vortex-enhanced-carousel-btn[data-carousel]');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (btn.getAttribute('data-vortex-bound') === '1') {
        continue;
      }
      btn.setAttribute('data-vortex-bound', '1');
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
        var delta = parseInt(this.getAttribute('data-carousel'), 10);
        if (delta) {
          traceStep('carousel-btn-click', { delta: delta, page: (enhancer.globalPageIndex || 0) + 1 });
          if (shouldUseNumericFilteredBrowseScan(enhancer.config)) {
            advanceNumericFilteredCarouselPage(enhancer.config, delta);
          } else {
            advanceCarouselPage(delta);
          }
        }
      }, true);
    }
  }

  function ensureCarouselControls() {
    var controls = document.getElementById('vortex-enhanced-carousel-controls');
    if (!controls) {
      controls = document.createElement('div');
      controls.id = 'vortex-enhanced-carousel-controls';
      controls.className = 'vortex-enhanced-carousel-controls vortex-enhanced-carousel-controls-inline';
      controls.setAttribute('data-vortex-enhanced-ui', 'true');
      controls.innerHTML =
        '<button type="button" class="vortex-enhanced-carousel-btn" data-carousel="-1" aria-label="Previous page">Prev</button>' +
        '<span data-carousel-page>Page 1</span>' +
        '<span data-carousel-count></span>' +
        '<label class="vortex-enhanced-auto-advance"><input type="checkbox" data-auto-advance-toggle> Auto</label>' +
        '<label class="vortex-enhanced-auto-advance">Speed ' +
        '<input type="range" data-auto-advance-speed min="1" max="30" step="1" value="8">' +
        '<span data-auto-advance-label>8s</span></label>' +
        '<button type="button" class="vortex-enhanced-carousel-btn" data-carousel="1" aria-label="Next page">Next</button>';
    }

    bindCarouselControlButtons(controls);
    syncAutoAdvanceUi();
    return controls;
  }

  function ensureCarouselControlsBar() {
    var controls = ensureCarouselControls();
    var hideChrome = !!(enhancer.config && enhancer.config.hideSiteChrome);

    var sortRow = findSortToolbarRow();
    if (sortRow && rowHasSortControls(sortRow)) {
      mountCarouselControlsInSortRow(sortRow);
      if (hideChrome) {
        protectBrowseControlsFromChromeHide();
      }
      return controls;
    }

    if (enhancer.controlsPinnedSortRow && document.body.contains(enhancer.controlsPinnedSortRow)) {
      mountCarouselControlsInSortRow(enhancer.controlsPinnedSortRow);
      if (hideChrome) {
        protectBrowseControlsFromChromeHide();
      }
      return controls;
    }

    var toolbarRow = findResultsToolbarRow();
    if (toolbarRow && isValidCarouselToolbarRow(toolbarRow)) {
      mountCarouselControlsInSortRow(toolbarRow);
      if (hideChrome) {
        protectBrowseControlsFromChromeHide();
      }
      return controls;
    }

    if (hideChrome && !enhancer.filteredBrowseEngaged) {
      if (mountControlsInCarouselHost(controls)) {
        protectBrowseControlsFromChromeHide();
        return controls;
      }
    } else {
      clearInHostControlsBar();
    }

    mountControlsFallback(controls);
    if (hideChrome) {
      protectBrowseControlsFromChromeHide();
    }
    return controls;
  }

  function scheduleControlsRemount() {
    if (enhancer.controlsRemountTimers) {
      enhancer.controlsRemountTimers.forEach(function (timer) {
        clearTimeout(timer);
      });
    }

    enhancer.controlsRemountTimers = [80, 300, 750].map(function (delay) {
      return setTimeout(function () {
        if (!document.querySelector('.vortex-enhanced-grid-layout')) {
          return;
        }
        var sortRow = findSortToolbarRow();
        if (sortRow && rowHasSortControls(sortRow)) {
          mountCarouselControlsInSortRow(sortRow);
          protectBrowseControlsFromChromeHide();
          return;
        }
        if (enhancer.controlsPinnedSortRow && document.body.contains(enhancer.controlsPinnedSortRow)) {
          mountCarouselControlsInSortRow(enhancer.controlsPinnedSortRow);
          protectBrowseControlsFromChromeHide();
          return;
        }
        var controls = ensureCarouselControlsBar();
        if (controls && !controlsAreVisible(controls)) {
          if (enhancer.config && enhancer.config.hideSiteChrome && !enhancer.filteredBrowseEngaged) {
            mountControlsInCarouselHost(controls);
          } else if (!sortRow) {
            mountControlsFallback(controls);
          }
        }
        protectBrowseControlsFromChromeHide();
      }, delay);
    });
  }

  function hideBrowsePageFooter() {
    var host = document.querySelector('.vortex-enhanced-carousel-host');
    var selectors = [
      'footer',
      '[class*="site-footer"]',
      '[class*="SiteFooter"]',
      '[class*="GlobalFooter"]',
    ];

    selectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (node) {
        if (!host || !host.contains(node)) {
          node.classList.add('vortex-enhanced-browse-trim-hidden');
        }
      });
    });

    tagNexusPaginationNav();

    if (!host) {
      return;
    }

    var node = host.nextElementSibling;
    while (node) {
      if (!node.querySelector || !node.querySelector('[data-vortex-enhanced-ui="true"]')) {
        node.classList.add('vortex-enhanced-browse-trim-hidden');
      }
      node = node.nextElementSibling;
    }
  }

  function ensureCacheFill(config) {
    if (enhancer.cacheFetchInFlight || enhancer.pendingPoolFetch) {
      return;
    }

    var pageSize = getCarouselPageSize(config);
    var filtered = getFilteredPoolEntries(config);
    if (filtered.length >= pageSize) {
      return;
    }

    if (enhancer.cacheFetchAttempts >= 5) {
      return;
    }

    if (!findNexusPaginationButton(1)) {
      return;
    }

    enhancer.cacheFetchInFlight = true;
    enhancer.cacheFetchAttempts += 1;
    navigateNexusResultsPage(1);
  }

  function installCarouselWheelHandler() {
    if (!markVortexDocumentHook('carousel-wheel-nav')) {
      return;
    }

    var lastWheelAdvance = 0;
    var wheelAccum = 0;
    document.addEventListener('wheel', function (event) {
      if (!document.querySelector('.vortex-enhanced-carousel-host')) {
        if (!document.documentElement.classList.contains('vortex-enhanced-filtered-browse') &&
            !(enhancer.config && isFilteredBrowseSession(enhancer.config))) {
          return;
        }
      }

      if (enhancer.localCatalogNavLock) {
        return;
      }

      var wheelConfig = enhancer.config;
      if (wheelConfig && isLocalCatalogMode(wheelConfig) && enhancer.trackedCatalogFetchInFlight) {
        return;
      }

      if (!event.target.closest('#mainContent') &&
          !event.target.closest('.vortex-enhanced-carousel-host') &&
          !event.target.closest('.vortex-enhanced-grid-layout') &&
          !event.target.closest('[data-e2eid="mod-tile"]') &&
          !event.target.closest('.vortex-enhanced-controls-bar-fallback') &&
          !event.target.closest('.vortex-enhanced-carousel-controls')) {
        return;
      }

      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }

      wheelAccum += event.deltaY;
      var now = Date.now();
      if (Math.abs(wheelAccum) < 80) {
        return;
      }
      var wheelQuietMs = 100;
      if (now - lastWheelAdvance < wheelQuietMs) {
        wheelAccum = 0;
        return;
      }
      if (enhancer.dismissedPoolPagingActive || enhancer.carouselAdvancePending ||
          enhancer.dismissedBatchPrefetchInFlight) {
        wheelAccum = 0;
        return;
      }

      var delta = wheelAccum > 0 ? 1 : -1;
      wheelAccum = 0;
      if (delta < 0 && enhancer.globalPageIndex <= 0) {
        return;
      }
      lastWheelAdvance = now;
      event.preventDefault();
      event.stopPropagation();
      if (wheelConfig && shouldUseNumericFilteredBrowseScan(wheelConfig)) {
        advanceNumericFilteredCarouselPage(wheelConfig, delta);
      } else {
        advanceCarouselPage(delta);
      }
    }, { passive: false, capture: true });
  }

  function releaseCarouselForSessionChange() {
    enhancer.scanGeneration = (enhancer.scanGeneration || 0) + 1;
    enhancer.applyingCarouselPage = false;
    enhancer.lastAppliedSliceKey = '';
    enhancer.lastVisibleModsKey = '';
    enhancer.tilePool = [];

    document.querySelectorAll('[data-vortex-pool-tile="true"]').forEach(function (tile) {
      if (tile.parentElement) {
        tile.parentElement.removeChild(tile);
      }
    });

    document.querySelectorAll(
      '.vortex-enhanced-carousel-hidden, .vortex-enhanced-nexus-live-hidden'
    ).forEach(function (node) {
      node.classList.remove('vortex-enhanced-carousel-hidden', 'vortex-enhanced-nexus-live-hidden');
      if (node.style) {
        node.style.removeProperty('display');
      }
    });

    var stash = document.getElementById('vortex-enhanced-live-stash');
    if (stash) {
      while (stash.firstChild) {
        stash.removeChild(stash.firstChild);
      }
    }

    var pool = document.getElementById('vortex-enhanced-pool-host');
    if (pool) {
      while (pool.firstChild) {
        pool.removeChild(pool.firstChild);
      }
    }
  }

  function cleanupPoolArtifacts(discardStash) {
    if (discardStash) {
      releaseCarouselForSessionChange();
    } else {
      restoreLiveTilesFromStash();
    }

    var stash = document.getElementById('vortex-enhanced-live-stash');
    if (stash && stash.parentElement) {
      stash.parentElement.removeChild(stash);
    }

    var pool = document.getElementById('vortex-enhanced-pool-host');
    if (pool && pool.parentElement) {
      pool.parentElement.removeChild(pool);
    }
    enhancer.tilePool = [];

    var grid = findModGrid();
    if (!grid) {
      return;
    }

    var poolTiles = grid.querySelectorAll('[data-vortex-pool-tile="true"]');
    for (var i = 0; i < poolTiles.length; i++) {
      poolTiles[i].parentElement.removeChild(poolTiles[i]);
    }

    grid.querySelectorAll('.vortex-enhanced-nexus-live-hidden').forEach(function (node) {
      node.classList.remove('vortex-enhanced-nexus-live-hidden');
    });
  }

  function scrollCarouselIntoView() {
    var config = enhancer.config || {};
    var toolbar = document.querySelector('.vortex-enhanced-results-toolbar, #vortex-enhanced-controls-bar');
    var controls = document.getElementById('vortex-enhanced-carousel-controls');
    var host = document.querySelector('.vortex-enhanced-carousel-host');
    var grid = findModGrid();

    if (config.hideSiteChrome) {
      return;
    }

    var target = host || grid;
    if (!target) {
      return;
    }

    var rect = target.getBoundingClientRect();
    var bottomPadding = 24;
    var desiredBottom = window.innerHeight - bottomPadding;
    var targetScrollY = window.scrollY + rect.bottom - desiredBottom;
    if (targetScrollY > window.scrollY + 8) {
      window.scrollTo({ top: targetScrollY, behavior: 'instant' });
    }
  }
  function findShowFiltersRow() {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var text = (buttons[i].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.indexOf('show filters') === 0 || text.indexOf('hide filters') === 0) {
        return buttons[i].closest('div') || buttons[i].parentElement;
      }
    }
    return null;
  }

  function mountVortexFilterPanel(panel) {
    var aside = findNexusFilterAside() || document.querySelector('aside');
    var filtersOpen = isNexusFiltersPanelOpen();
    var hideChrome = !!(enhancer.config && enhancer.config.hideSiteChrome);

    if (filtersOpen && aside) {
      panel.classList.add('vortex-enhanced-filter-panel-aside');
      panel.classList.remove('vortex-enhanced-filter-panel-inline');
      aside.insertBefore(panel, aside.firstChild);
      return true;
    }

    if (hideChrome && aside) {
      panel.classList.add('vortex-enhanced-filter-panel-aside');
      panel.classList.remove('vortex-enhanced-filter-panel-inline');
      if (panel.parentElement !== aside) {
        aside.insertBefore(panel, aside.firstChild);
      }
      return true;
    }

    var showFiltersRow = findShowFiltersRow();
    if (showFiltersRow && showFiltersRow.parentElement) {
      panel.classList.add('vortex-enhanced-filter-panel-inline');
      panel.classList.remove('vortex-enhanced-filter-panel-aside');
      var parent = showFiltersRow.parentElement;
      if (showFiltersRow.nextSibling) {
        parent.insertBefore(panel, showFiltersRow.nextSibling);
      } else {
        parent.appendChild(panel);
      }
      return true;
    }

    if (aside) {
      panel.classList.add('vortex-enhanced-filter-panel-aside');
      panel.classList.remove('vortex-enhanced-filter-panel-inline');
      aside.insertBefore(panel, aside.firstChild);
      return true;
    }

    return false;
  }

  function buildFilterPanelHtml(config) {
    var cols = config.gridColumns || 8;
    var rows = config.gridRows || 3;
    return [
      '<button type="button" class="vortex-enhanced-filter-section-toggle" aria-expanded="true">',
      '<span>Vortex filters</span>',
      '<span class="vortex-enhanced-filter-chevron">\u25B8</span>',
      '</button>',
      '<div class="vortex-enhanced-filter-body">',
      '<label class="vortex-enhanced-filter-option">',
      '<input type="checkbox" data-filter="hideInstalled"' + (config.hideInstalled ? ' checked' : '') + '> Hide installed',
      '</label>',
      '<label class="vortex-enhanced-filter-option">',
      '<input type="checkbox" data-filter="onlyInstalled"' + (config.onlyInstalled ? ' checked' : '') + '> Only installed',
      '</label>',
      '<label class="vortex-enhanced-filter-option">',
      '<input type="checkbox" data-filter="hideTracked"' + (config.hideTracked ? ' checked' : '') + '> Hide tracked',
      '</label>',
      '<label class="vortex-enhanced-filter-option">',
      '<input type="checkbox" data-filter="onlyTracked"' + (config.onlyTracked ? ' checked' : '') + '> Only tracked',
      '</label>',
      '</div>',
      '<div class="vortex-enhanced-grid-controls">',
      '<span class="vortex-enhanced-grid-label">Carousel columns</span>',
      '<button type="button" class="vortex-enhanced-grid-btn" data-grid="columns" data-delta="-1" aria-label="Fewer columns">-</button>',
      '<span class="vortex-enhanced-grid-value" data-grid-display="columns">' + cols + '</span>',
      '<button type="button" class="vortex-enhanced-grid-btn" data-grid="columns" data-delta="1" aria-label="More columns">+</button>',
      '</div>',
      '<div class="vortex-enhanced-grid-controls">',
      '<span class="vortex-enhanced-grid-label">Carousel rows</span>',
      '<button type="button" class="vortex-enhanced-grid-btn" data-grid="rows" data-delta="-1" aria-label="Fewer rows">-</button>',
      '<span class="vortex-enhanced-grid-value" data-grid-display="rows">' + rows + '</span>',
      '<button type="button" class="vortex-enhanced-grid-btn" data-grid="rows" data-delta="1" aria-label="More rows">+</button>',
      '</div>',
    ].join('');
  }

  function syncFilterPanelUiFromHost(config) {
    var panel = document.querySelector('[data-vortex-enhanced-filters="true"]');
    if (!panel || !config) {
      return;
    }

    if (enhancer.filterUiLockUntil && Date.now() < enhancer.filterUiLockUntil) {
      return;
    }

    enhancer.suppressFilterEvents = true;
    try {
      var filters = ['hideInstalled', 'onlyInstalled', 'hideTracked', 'onlyTracked'];
      filters.forEach(function (name) {
        var input = panel.querySelector('input[data-filter="' + name + '"]');
        if (input) {
          var optimistic = enhancer.optimisticFilters && enhancer.optimisticFilters[name];
          input.checked = optimistic !== undefined ? !!optimistic : !!config[name];
        }
      });
    } finally {
      enhancer.suppressFilterEvents = false;
    }

    syncFilterPanelGridUi(panel, config);
  }

  function syncFilterPanelGridUi(panel, config) {
    if (!panel || !config) {
      return;
    }

    var colsDisplay = panel.querySelector('[data-grid-display="columns"]');
    var rowsDisplay = panel.querySelector('[data-grid-display="rows"]');
    if (colsDisplay) {
      colsDisplay.textContent = String(config.gridColumns || 8);
    }
    if (rowsDisplay) {
      rowsDisplay.textContent = String(config.gridRows || 3);
    }
  }

  function syncFilterPanelUi(panel, config) {
    syncFilterPanelGridUi(panel, config);
  }

  function ensureVortexFilterPanel(config) {
    var panel = document.querySelector('[data-vortex-enhanced-filters="true"]');
    if (!panel) {
      panel = document.createElement('div');
      panel.setAttribute('data-vortex-enhanced-filters', 'true');
      panel.className = 'vortex-enhanced-filter-panel';
      panel.innerHTML = buildFilterPanelHtml(config);
      mountVortexFilterPanel(panel);
    } else {
      if (panel.querySelector('.vortex-enhanced-content-options-toggle')) {
        panel.innerHTML = buildFilterPanelHtml(config);
      }
      syncFilterPanelUiFromHost(config);
      mountVortexFilterPanel(panel);
    }

    applyDefaultFilterSectionState();
    return true;
  }

  function unhideVortexUiAncestors(node) {
    var current = node;
    while (current) {
      current.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
      current = current.parentElement;
    }
  }

  function protectBrowseControlsFromChromeHide() {
    protectNexusBrowseHeaderStack();
    var selectors = [
      '#vortex-enhanced-carousel-controls',
      '#vortex-enhanced-controls-bar',
      '#vortex-enhanced-controls-anchor',
      '.vortex-enhanced-results-toolbar',
      '.vortex-enhanced-sort-toolbar-row',
      '.vortex-enhanced-controls-bar-fallback',
      '.vortex-enhanced-controls-bar-in-host',
      '.vortex-enhanced-nexus-active-filters',
      '[data-vortex-enhanced-ui="true"]',
    ];
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (node) {
        node.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
        unhideVortexUiAncestors(node);
      });
    });
    if (enhancer.config && enhancer.config.hideSiteChrome) {
      hideNexusItemsPerPageUi();
    }
  }

  function markNodeChromeHidden(node) {
    if (!node || nodeHasVortexEnhancedUi(node)) {
      return;
    }
    if (enhancer.userWantsNexusFiltersOpen || isNexusFiltersPanelVisible()) {
      if (node.id === 'filters-panel' ||
          (node.matches && node.matches('aside')) ||
          (node.closest && node.closest('#filters-panel, aside.vortex-enhanced-nexus-filters-open'))) {
        return;
      }
    }
    if (node.querySelector && node.querySelector(
      '#vortex-enhanced-carousel-controls, #vortex-enhanced-controls-bar, [data-vortex-enhanced-ui="true"]'
    )) {
      return;
    }
    node.classList.add('vortex-enhanced-chrome-hidden');
  }

  function hideNexusGameBannerStrip(host) {
    var anchor = host || document.querySelector('.vortex-enhanced-carousel-host') || findModGrid() || findSortToolbarRow();
    var bannerSelectors = [
      '[class*="GameHeader"]',
      '[class*="PageHero"]',
      '[class*="HeroBanner"]',
      '[class*="CoverBanner"]',
      '[class*="ModsHeader"]',
      '[class*="GameBanner"]',
      '[class*="TitleBanner"]',
      '[class*="Breadcrumbs"]',
    ];
    bannerSelectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (node) {
        if (anchor && (anchor.contains(node) || node.contains(anchor))) {
          return;
        }
        if (node.closest('.vortex-enhanced-nexus-filters-open, #filters-panel.vortex-enhanced-nexus-filters-open')) {
          return;
        }
        markNodeChromeHidden(node);
      });
    });

    var headings = document.querySelectorAll('h1, h2, h3, [class*="Title"]');
    for (var i = 0; i < headings.length; i++) {
      var heading = headings[i];
      if (heading.closest('.vortex-enhanced-carousel-controls, [data-vortex-enhanced-filters="true"], .vortex-enhanced-sort-toolbar-row')) {
        continue;
      }
      if (anchor && anchor.contains(heading)) {
        continue;
      }
      var text = normalizeUiText(heading.textContent);
      if (!/\bmods$/i.test(text) || text.length > 120) {
        continue;
      }
      if (heading.querySelector('[data-e2eid="mod-tile"]')) {
        continue;
      }
      var block = heading.closest('section, header, article, div') || heading;
      if (anchor && block.contains(anchor)) {
        continue;
      }
      markNodeChromeHidden(block);
    }
  }

  function revealActiveFilterUiForCurrentUrl() {
    if (!browseUrlHasRemovableActiveFilters()) {
      return;
    }

    document.querySelectorAll('[class*="ActiveFilter"], [class*="AppliedFilter"], [class*="ResultsHeader"]').forEach(function (node) {
      if (!isInMainBrowseColumn(node, { ignoreVisibility: true })) {
        return;
      }
      var text = normalizeUiText(node.textContent);
      if (text.indexOf('clear all') < 0 &&
          text.indexOf('excluded') < 0 &&
          text.indexOf('translation') < 0) {
        return;
      }
      node.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden', 'vortex-enhanced-browse-gap-collapse');
      if (text.indexOf('clear all') >= 0 || text.indexOf('excluded') >= 0 || text.indexOf('translation') >= 0) {
        node.classList.add('vortex-enhanced-nexus-active-filters');
        ensureActiveFilterRowVisible(node);
      }
    });
  }

  function hideResultsHeaderNonToolbarSections() {
    if (!enhancer.config || !enhancer.config.hideSiteChrome) {
      return;
    }

    var host = document.querySelector('.vortex-enhanced-carousel-host') || findModGrid();
    document.querySelectorAll('[class*="ResultsHeader"], [class*="ModsToolbar"], [class*="ModsHeader"]').forEach(function (shell) {
      if (!isInMainBrowseColumn(shell, { ignoreVisibility: true })) {
        return;
      }
      if (!rowHasSortControls(shell) &&
          !rowLooksLikeResultsToolbarContainer(shell) &&
          !shell.querySelector('.vortex-enhanced-sort-toolbar-row, .vortex-enhanced-unified-toolbar-row')) {
        markNodeChromeHidden(shell);
        return;
      }
      for (var i = 0; i < shell.children.length; i++) {
        var child = shell.children[i];
        if (shouldKeepVisibleInHideChrome(child, host || shell)) {
          child.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
          continue;
        }
        if (rowHasSortControls(child) ||
            rowLooksLikeResultsToolbarContainer(child) ||
            child.classList.contains('vortex-enhanced-nexus-active-filters') ||
            child.querySelector(
              '.vortex-enhanced-sort-toolbar-row, .vortex-enhanced-unified-toolbar-row, .vortex-enhanced-nexus-active-filters, [data-vortex-enhanced-ui="true"]'
            )) {
          child.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
          continue;
        }
        if (!nodeHasVortexEnhancedUi(child)) {
          markNodeChromeHidden(child);
        }
      }
    });
  }

  function hideChromeSiblingsAroundHost(host) {
    host = host || document.querySelector('.vortex-enhanced-carousel-host') || findModGrid();
    if (!host) {
      return;
    }

    host.classList.remove('vortex-enhanced-chrome-hidden');

    var node = host;
    for (var depth = 0; depth < 6 && node; depth++) {
      var parent = node.parentElement;
      if (!parent) {
        break;
      }
      for (var i = 0; i < parent.children.length; i++) {
        var sibling = parent.children[i];
        if (sibling === node || sibling.contains(host)) {
          continue;
        }
        if (shouldKeepVisibleInHideChrome(sibling, host)) {
          sibling.classList.remove('vortex-enhanced-chrome-hidden');
          continue;
        }
        if (sibling.tagName === 'ASIDE' || sibling.id === 'filters-panel') {
          if (isNexusFiltersPanelOpen() ||
              sibling.classList.contains('vortex-enhanced-nexus-filters-open') ||
              enhancer.userWantsNexusFiltersOpen) {
            markNexusFiltersPanelOpen(true);
            sibling.classList.add('vortex-enhanced-nexus-filters-open');
            sibling.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
            if (sibling.style) {
              sibling.style.removeProperty('display');
            }
          } else {
            sibling.classList.add('vortex-enhanced-chrome-hidden');
          }
          continue;
        }
        if (sibling.querySelector && sibling.querySelector('.vortex-enhanced-carousel-host')) {
          sibling.classList.remove('vortex-enhanced-chrome-hidden');
          continue;
        }
        if (sibling.classList && sibling.classList.contains('vortex-enhanced-carousel-host')) {
          continue;
        }
        sibling.classList.add('vortex-enhanced-chrome-hidden');
      }
      node = parent;
    }

    var prev = host.previousElementSibling;
    while (prev) {
      if (shouldKeepVisibleInHideChrome(prev, host)) {
        prev.classList.remove('vortex-enhanced-chrome-hidden');
      } else if (!nodeHasVortexEnhancedUi(prev)) {
        prev.classList.add('vortex-enhanced-chrome-hidden');
      }
      prev = prev.previousElementSibling;
    }
  }

  function applyDismissedBrowseHideChrome(config) {
    document.documentElement.classList.add('vortex-enhanced-hide-chrome');
    ensureDismissedBrowseChromeSafe();
    syncBrowseUrlFilterDocumentState();
    protectBrowseControlsFromChromeHide();
    hideNexusSiteBannerChrome();
    hideResultsHeaderNonToolbarSections();
    hideChromeSiblingsAroundHost();
    hideNexusGameBannerStrip();
    hideBrowsePageFooter();
    layoutNexusActiveFiltersInline();
    ensureCarouselControlsBar();
    hideNexusItemsPerPageUi();
    ensureChromeHideWatchdog(config);
  }

  function isTranslationDismissHandsOff() {
    return !!(enhancer.userDismissedTranslationFilter &&
      enhancer.translationDismissHandsOffUntil &&
      Date.now() < enhancer.translationDismissHandsOffUntil);
  }

  function unhideBrowseToolbarAndGrid() {
    var selectors = [
      '.vortex-enhanced-carousel-host',
      '.vortex-enhanced-grid-layout',
      '.vortex-enhanced-unified-toolbar-row',
      '.vortex-enhanced-sort-toolbar-row',
      '.vortex-enhanced-results-toolbar',
      '#vortex-enhanced-carousel-controls',
      '#vortex-enhanced-controls-bar',
      '#vortex-enhanced-controls-anchor',
      '[data-vortex-enhanced-ui="true"]',
    ];
    selectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (node) {
        node.classList.remove(
          'vortex-enhanced-chrome-hidden',
          'vortex-enhanced-browse-trim-hidden',
          'vortex-enhanced-browse-gap-collapse',
          'vortex-enhanced-nexus-active-filters-empty'
        );
        unhideBrowseContentChain(node);
      });
    });

    document.querySelectorAll('[class*="ResultsHeader"], [class*="ActiveFilter"], [class*="AppliedFilter"]').forEach(function (node) {
      if (!isInMainBrowseColumn(node, { ignoreVisibility: true })) {
        return;
      }
      if (rowLooksLikeResultsToolbarContainer(node) || rowHasSortControls(node)) {
        node.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
        unhideBrowseContentChain(node);
      }
    });
  }

  function hideNexusSiteBannerChrome() {
    var bannerSelectors = [
      'header',
      'footer',
      '#siteHeader',
      '#site-header',
      '[class*="GlobalHeader"]',
      '[class*="GlobalNav"]',
      '[class*="SiteHeader"]',
      '[class*="site-footer"]',
      '[class*="Breadcrumbs"]',
      '[class*="GameHeader"]',
      '[class*="PageHero"]',
      '[class*="HeroBanner"]',
      '[class*="CoverBanner"]',
      '[class*="ModsHeader"]',
      '[class*="GameBanner"]',
    ];
    bannerSelectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (node) {
        if (nodeHasVortexEnhancedUi(node) || rowLooksLikeResultsToolbarContainer(node)) {
          node.classList.remove('vortex-enhanced-chrome-hidden');
          return;
        }
        if (node.closest('.vortex-enhanced-carousel-host, .vortex-enhanced-unified-toolbar-row, .vortex-enhanced-sort-toolbar-row')) {
          return;
        }
        if (isInMainBrowseColumn(node, { ignoreVisibility: true })) {
          if (shouldPreserveMainColumnBrowseChrome(node)) {
            node.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
            return;
          }
          markNodeChromeHidden(node);
          return;
        }
        markNodeChromeHidden(node);
      });
    });
    hideNexusGameBannerStrip(null);
    hideMainColumnHeroAboveCarousel();
  }

  function hideMainColumnHeroAboveCarousel() {
    var host = document.querySelector('.vortex-enhanced-carousel-host') || findModGrid();
    if (!host) {
      return;
    }
    document.querySelectorAll('nav, ol, ul, section, div, header').forEach(function (node) {
      if (!isInMainBrowseColumn(node, { ignoreVisibility: true })) {
        return;
      }
      if (node === host || node.contains(host) || host.contains(node)) {
        return;
      }
      if (shouldPreserveMainColumnBrowseChrome(node) || shouldKeepVisibleInHideChrome(node, host)) {
        return;
      }
      var text = normalizeUiText(node.textContent);
      if (text.indexOf('home >') >= 0 ||
          (/\bmods$/i.test(text) && text.length < 80) ||
          (node.querySelector('img') && !node.querySelector('[data-e2eid="mod-tile"]') && text.length < 160)) {
        markNodeChromeHidden(node);
      }
    });
  }

  function clearAuthPageEnhancement() {
    document.documentElement.classList.remove(
      'vortex-enhanced-hide-chrome',
      'vortex-enhanced-browse-wide',
      'vortex-enhanced-translation-dismissed'
    );
    document.documentElement.classList.add('vortex-enhanced-auth-page');
    stopChromeHideWatchdog();
    document.querySelectorAll('.vortex-enhanced-chrome-hidden, .vortex-enhanced-browse-trim-hidden').forEach(function (node) {
      node.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
    });
  }

  function applyHideSiteChrome(config) {
    if (isNexusAuthPage()) {
      clearAuthPageEnhancement();
      return;
    }
    document.documentElement.classList.remove('vortex-enhanced-auth-page');
    if (!config || !config.hideSiteChrome) {
      document.documentElement.classList.remove('vortex-enhanced-hide-chrome');
      stopChromeHideWatchdog();
      document.querySelectorAll('.vortex-enhanced-chrome-hidden').forEach(function (node) {
        node.classList.remove('vortex-enhanced-chrome-hidden');
      });
      if (isTranslationFilterDismissedBrowse()) {
        ensureDismissedBrowseChromeSafe();
      }
      return;
    }
    if (isTranslationFilterDismissedBrowse()) {
      applyDismissedBrowseHideChrome(config);
      return;
    }
    document.documentElement.classList.add('vortex-enhanced-hide-chrome');
    layoutNexusActiveFiltersInline();
    revealActiveFilterUiForCurrentUrl();
    hideNexusSiteBannerChrome();
    hideNexusChromeAboveGrid();
    hideNexusGameBannerStrip();
    hideMainColumnHeroAboveCarousel();
    protectBrowseControlsFromChromeHide();
    ensureChromeHideWatchdog(config);
  }

  function ensureHideSiteChrome(config) {
    applyHideSiteChrome(config);
  }

  function scheduleChromeHideRefresh() {
    if (isNexusAuthPage()) {
      return;
    }
    if (!enhancer.config || !enhancer.config.hideSiteChrome) {
      return;
    }
    if (enhancer.chromeHideDebounceTimer) {
      return;
    }
    enhancer.chromeHideDebounceTimer = setTimeout(function () {
      enhancer.chromeHideDebounceTimer = null;
      if (enhancer.config && enhancer.config.hideSiteChrome && !isBrowseEnhancementPaused()) {
        if (isTranslationFilterDismissedBrowse()) {
          applyDismissedBrowseHideChrome(enhancer.config);
        } else {
          hideNexusChromeAboveGrid();
          hideNexusGameBannerStrip();
          protectBrowseControlsFromChromeHide();
        }
      }
    }, 80);
  }

  function ensureChromeHideWatchdog(config) {
    if (!config || !config.hideSiteChrome) {
      stopChromeHideWatchdog();
      return;
    }
    if (enhancer.chromeHideWatchdogTimer) {
      return;
    }
    enhancer.chromeHideWatchdogTimer = setInterval(function () {
      if (!enhancer.config || !enhancer.config.hideSiteChrome || isBrowseEnhancementPaused()) {
        return;
      }
      if (!isBrowseModsListPathname(getBrowsePathname())) {
        return;
      }
      if (!document.querySelector('.vortex-enhanced-carousel-host') && !findModGrid()) {
        return;
      }
      if (isUserInteractingWithNexusFilters()) {
        hideNexusSiteBannerChrome();
        hideMainColumnHeroAboveCarousel();
        hideNexusGameBannerStrip();
        protectBrowseControlsFromChromeHide();
        ensureNexusFiltersPanelStayOpen();
        return;
      }
      if (isTranslationFilterDismissedBrowse()) {
        applyDismissedBrowseHideChrome(enhancer.config);
        return;
      }
      hideNexusChromeAboveGrid();
      hideNexusGameBannerStrip();
      protectBrowseControlsFromChromeHide();
    }, 1500);
  }

  function stopChromeHideWatchdog() {
    if (enhancer.chromeHideWatchdogTimer) {
      clearInterval(enhancer.chromeHideWatchdogTimer);
      enhancer.chromeHideWatchdogTimer = null;
    }
    if (enhancer.chromeHideDebounceTimer) {
      clearTimeout(enhancer.chromeHideDebounceTimer);
      enhancer.chromeHideDebounceTimer = null;
    }
  }

  function hideNexusChromeAboveGrid() {
    if (isTranslationFilterDismissedBrowse()) {
      applyDismissedBrowseHideChrome(enhancer.config || {});
      return;
    }
    var host = document.querySelector('.vortex-enhanced-carousel-host') || findModGrid();
    if (!host) {
      hideNexusGameBannerStrip(null);
      return;
    }

    host.classList.remove('vortex-enhanced-chrome-hidden');

    var selectors = [
      'header',
      'footer',
      'aside',
      '#filters-panel',
      '#siteHeader',
      '#site-header',
      '[class*="GlobalHeader"]',
      '[class*="GlobalNav"]',
      '[class*="SiteHeader"]',
      '[class*="site-footer"]',
      '[class*="ResultsHeader"]',
      '[class*="Breadcrumbs"]',
      '[class*="GameHeader"]',
      '[class*="PageHero"]',
      '[class*="HeroBanner"]',
      '[class*="CoverBanner"]',
      '[class*="ModsHeader"]',
      '[class*="GameBanner"]',
    ];
    selectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (node) {
        if (nodeHasVortexEnhancedUi(node) ||
            (node.classList && node.classList.contains('vortex-enhanced-results-toolbar'))) {
          node.classList.remove('vortex-enhanced-chrome-hidden');
          return;
        }
        if (isInMainBrowseColumn(node, { ignoreVisibility: true })) {
          if (shouldPreserveMainColumnBrowseChrome(node)) {
            node.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
            return;
          }
          if (!host.contains(node) && !node.contains(host)) {
            markNodeChromeHidden(node);
          }
          return;
        }
        if (!host.contains(node) && !node.contains(host)) {
          if (selector === 'aside' || selector === '#filters-panel') {
            if (isNexusFiltersPanelOpen() ||
                enhancer.userWantsNexusFiltersOpen ||
                node.classList.contains('vortex-enhanced-nexus-filters-open')) {
              markNexusFiltersPanelOpen(true);
              node.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
              if (node.style) {
                node.style.removeProperty('display');
              }
              return;
            }
            node.classList.add('vortex-enhanced-chrome-hidden');
            return;
          }
          if (selector.indexOf('ResultsHeader') >= 0) {
            if (rowLooksLikeResultsToolbarContainer(node) || rowHasSortControls(node)) {
              node.classList.remove(
                'vortex-enhanced-chrome-hidden',
                'vortex-enhanced-browse-trim-hidden',
                'vortex-enhanced-nexus-active-filters-empty',
                'vortex-enhanced-browse-gap-collapse'
              );
              unhideBrowseContentChain(node);
              return;
            }
            if (browseUrlHasRemovableActiveFilters() &&
                rowHasVisibleActiveFilterChips(node) &&
                (rowLooksLikeNexusActiveFilters(node) || shouldPreserveActiveFilterRow(node))) {
              node.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-nexus-active-filters-empty', 'vortex-enhanced-browse-gap-collapse');
              node.classList.add('vortex-enhanced-nexus-active-filters');
              ensureActiveFilterRowVisible(node);
              return;
            }
          }
          node.classList.add('vortex-enhanced-chrome-hidden');
        }
      });
    });

    hideChromeSiblingsAroundHost(host);
    hideNexusGameBannerStrip(host);
    hideMainColumnHeroAboveCarousel();
    protectBrowseControlsFromChromeHide();
    hideNexusItemsPerPageUi();
  }

  function tagNexusPaginationNav() {
    var navs = document.querySelectorAll('nav, [role="navigation"]');
    for (var i = 0; i < navs.length; i++) {
      if (navs[i].querySelector('[aria-current="page"]')) {
        navs[i].classList.add('vortex-enhanced-nexus-pagination-hide');
      }
    }

    var inputs = document.querySelectorAll('input');
    for (var j = 0; j < inputs.length; j++) {
      var input = inputs[j];
      var row = input.closest('div, form, label');
      if (!row) {
        continue;
      }
      var rowText = (row.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (rowText.indexOf('page') >= 0 && rowText.indexOf('go') >= 0) {
        row.classList.add('vortex-enhanced-nexus-pagination-hide');
      }
    }
  }

  function setHideTranslationsControl(input, enabled) {
    if (!input) {
      return false;
    }

    var isChecked = !!(input.checked ||
      input.getAttribute('aria-checked') === 'true' ||
      input.getAttribute('data-state') === 'checked');

    if (enabled === isChecked) {
      return true;
    }

    enhancer.allowNexusPaginationClick = true;
    try {
      input.click();
    } catch (err) {
      // fall through
    }
    enhancer.allowNexusPaginationClick = false;

    isChecked = !!(input.checked ||
      input.getAttribute('aria-checked') === 'true' ||
      input.getAttribute('data-state') === 'checked');
    if (enabled !== isChecked && input.dispatchEvent) {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      isChecked = !!(input.checked ||
        input.getAttribute('aria-checked') === 'true' ||
        input.getAttribute('data-state') === 'checked');
    }

    return enabled === isChecked;
  }

  function ensureTranslationFilterWatchdog() {
    if (enhancer.userDismissedTranslationFilter) {
      return;
    }
    if (enhancer.translationFilterWatchdog) {
      return;
    }

    enhancer.translationFilterWatchdog = setInterval(function () {
      if (enhancer.userDismissedTranslationFilter) {
        clearInterval(enhancer.translationFilterWatchdog);
        enhancer.translationFilterWatchdog = null;
        return;
      }
      if (isCarouselQuietPeriod()) {
        return;
      }
      if (urlHasActiveNexusFilters()) {
        return;
      }
      if (enhancer.nexusFilterCooldownUntil && Date.now() < enhancer.nexusFilterCooldownUntil) {
        return;
      }
      if (isNexusHideTranslationsActive()) {
        clearInterval(enhancer.translationFilterWatchdog);
        enhancer.translationFilterWatchdog = null;
        return;
      }
      applyDefaultNexusFilters(enhancer.config);
    }, 4000);
  }

  // Hide translations ON by default for fresh browse sessions; user chip/clear-all dismiss opts out.
  function applyDefaultNexusFilters(config) {
    if (enhancer.userDismissedTranslationFilter) {
      return;
    }

    if (translationFilterExcludedInUrl()) {
      enhancer.clientHideTranslations = true;
      enhancer.preferHideTranslations = true;
      enhancer.hideTranslationsApplied = true;
      enhancer.defaultFiltersApplied = true;
      enhancer.translationUrlApplied = true;
      enhancer.translationUrlPending = false;
      return;
    }

    enhancer.clientHideTranslations = true;
    enhancer.preferHideTranslations = true;
    enhancer.forceDefaultFilters = true;
    enhancer.hideTranslationsApplied = true;

    if (enhancer.nexusFilterApplyInFlight) {
      return;
    }

    if (enhancer.nexusFilterCooldownUntil && Date.now() < enhancer.nexusFilterCooldownUntil) {
      return;
    }

    if (urlHasActiveNexusFilters()) {
      return;
    }

    if (isCarouselQuietPeriod()) {
      return;
    }

    if (shouldDeferNexusUrlMutation()) {
      return;
    }

    if (isNexusFiltersPanelOpen()) {
      return;
    }

    if (ensureTranslationFilterUrl()) {
      return;
    }

    if (isNexusHideTranslationsActive()) {
      enhancer.defaultFiltersApplied = true;
      enhancer.filtersOpenAttempts = 0;
      return;
    }

    var input = findHideTranslationsCheckbox();
    if (!input) {
      enhancer.filtersOpenAttempts = (enhancer.filtersOpenAttempts || 0) + 1;
      if (!isNexusFiltersPanelOpen() && openNexusFiltersPanel()) {
        setTimeout(function () {
          enhancer.scheduleScan(true);
        }, 650);
        return;
      }
      if ((enhancer.filtersOpenAttempts || 0) % 6 === 0) {
        setTimeout(function () {
          enhancer.scheduleScan(true);
        }, 1200);
      }
      return;
    }

    if (setHideTranslationsControl(input, true)) {
      enhancer.defaultFiltersApplied = true;
      enhancer.filtersOpenAttempts = 0;
      if (!isNexusFiltersPanelVisible() && !enhancer.userWantsNexusFiltersOpen) {
        closeNexusFiltersPanel();
      }
      setTimeout(function () {
        enhancer.scheduleScan(true);
      }, 350);
      return;
    }

    var label = input.closest('label');
    if (label && label !== input) {
      enhancer.allowNexusPaginationClick = true;
      try {
        label.click();
      } catch (errLabel) {
        // ignore
      }
      enhancer.allowNexusPaginationClick = false;
      if (isNexusHideTranslationsActive()) {
        enhancer.defaultFiltersApplied = true;
        enhancer.filtersOpenAttempts = 0;
        if (!isNexusFiltersPanelVisible() && !enhancer.userWantsNexusFiltersOpen) {
          closeNexusFiltersPanel();
        }
        setTimeout(function () {
          enhancer.scheduleScan(true);
        }, 350);
        return;
      }
    }

    setTimeout(function () {
      enhancer.scheduleScan(true);
    }, 500);
  }

  function ensureStyles() {
    var css = [
      '[data-e2eid="mod-tile-downloaded"],',
      '[data-e2eid="mod-tile-update-available"],',
      '[data-e2eid="mod-tile-downloaded"] *,',
      '[data-e2eid="mod-tile-update-available"] *,',
      '.vortex-enhanced-hide-nexus-badge {',
      '  display: none !important;',
      '}',
      '.vortex-enhanced-card { position: relative !important; }',
      '.vortex-enhanced-badge {',
      '  position: absolute;',
      '  top: 8px;',
      '  right: 8px;',
      '  background: #1ea34a;',
      '  color: #fff;',
      '  padding: 3px 8px;',
      '  border-radius: 4px;',
      '  font-size: 11px;',
      '  font-weight: 700;',
      '  z-index: 30;',
      '  pointer-events: none;',
      '  line-height: 1.3;',
      '  white-space: nowrap;',
      '  max-width: calc(100% - 16px);',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  box-shadow: 0 1px 4px rgba(0,0,0,0.35);',
      '}',
      '.vortex-enhanced-hidden { display: none !important; }',
      '.vortex-enhanced-actions {',
      '  display: inline-flex !important;',
      '  align-items: center !important;',
      '  gap: 6px !important;',
      '  margin-left: auto !important;',
      '  flex-shrink: 0 !important;',
      '}',
      '.vortex-enhanced-install {',
      '  background: #2d6cdf;',
      '  color: #fff;',
      '  border: none;',
      '  padding: 3px 10px;',
      '  border-radius: 4px;',
      '  font-size: 11px;',
      '  font-weight: 700;',
      '  cursor: pointer;',
      '  line-height: 1.3;',
      '  box-shadow: 0 1px 3px rgba(0,0,0,0.3);',
      '}',
      '.vortex-enhanced-install:hover { background: #2459b8; }',
      '.vortex-enhanced-install:disabled {',
      '  opacity: 0.65;',
      '  cursor: wait;',
      '}',
      '.vortex-enhanced-meta-bar {',
      '  display: flex !important;',
      '  flex-direction: row !important;',
      '  align-items: center !important;',
      '  justify-content: space-between !important;',
      '  gap: 8px !important;',
      '  width: 100% !important;',
      '  margin-bottom: 2px !important;',
      '}',
      '.vortex-enhanced-category-block {',
      '  display: block !important;',
      '  width: 100% !important;',
      '  min-height: 18px !important;',
      '  padding-top: 0 !important;',
      '  padding-bottom: 0 !important;',
      '  margin-bottom: 0 !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-category"] {',
      '  display: block !important;',
      '  overflow: hidden !important;',
      '  text-overflow: ellipsis !important;',
      '  white-space: nowrap !important;',
      '  font-size: 12px !important;',
      '  line-height: 1.2 !important;',
      '  max-width: 100% !important;',
      '}',
      '.vortex-enhanced-install-row {',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  justify-content: flex-end !important;',
      '  gap: 6px !important;',
      '  width: 100% !important;',
      '  min-height: 22px !important;',
      '  margin: 2px 0 4px 0 !important;',
      '  flex: 0 0 auto !important;',
      '}',
      '.vortex-enhanced-date-row {',
      '  display: flex !important;',
      '  flex-direction: row !important;',
      '  flex-wrap: nowrap !important;',
      '  align-items: center !important;',
      '  gap: 12px !important;',
      '  min-height: 18px !important;',
      '  margin-top: 2px !important;',
      '  margin-bottom: 2px !important;',
      '  padding-top: 0 !important;',
      '  padding-bottom: 0 !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-updated"],',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-uploaded"] {',
      '  display: inline-flex !important;',
      '  align-items: center !important;',
      '  gap: 4px !important;',
      '  font-size: 11px !important;',
      '  line-height: 1.2 !important;',
      '  white-space: nowrap !important;',
      '  flex: 0 0 auto !important;',
      '  margin: 0 !important;',
      '}',
      '.vortex-enhanced-tile-icon {',
      '  width: 1rem !important;',
      '  height: 1rem !important;',
      '  flex-shrink: 0 !important;',
      '  display: inline-block !important;',
      '}',
      '.vortex-enhanced-footer-stat {',
      '  display: inline-flex !important;',
      '  align-items: center !important;',
      '  gap: 4px !important;',
      '  font-size: 11px !important;',
      '  line-height: 1.2 !important;',
      '  white-space: nowrap !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-title"] {',
      '  font-size: 14px !important;',
      '  line-height: 1.25 !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-summary"],',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-description"],',
      '.vortex-enhanced-grid-layout .vortex-enhanced-desc-clamped {',
      '  font-size: 12px !important;',
      '  line-height: 1.35 !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="user-link"] {',
      '  font-size: 11px !important;',
      '  line-height: 1.2 !important;',
      '}',
      '.vortex-enhanced-deps {',
      '  font-size: 10px;',
      '  font-weight: 700;',
      '  white-space: nowrap;',
      '  line-height: 1.2;',
      '}',
      '.vortex-enhanced-deps-missing { color: #e6a817; }',
      '.vortex-enhanced-deps-ok { color: #1ea34a; }',
      '.vortex-enhanced-footer-row {',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  gap: 8px !important;',
      '  width: 100% !important;',
      '  flex-wrap: nowrap !important;',
      '  overflow: visible !important;',
      '}',
      '.vortex-enhanced-footer-actions {',
      '  display: inline-flex !important;',
      '  align-items: center !important;',
      '  gap: 6px !important;',
      '  margin-left: auto !important;',
      '  flex-shrink: 0 !important;',
      '}',
      '.vortex-enhanced-track,',
      '.vortex-enhanced-endorse {',
      '  background: transparent;',
      '  border: none;',
      '  cursor: pointer;',
      '  padding: 2px;',
      '  line-height: 0;',
      '  display: inline-flex !important;',
      '  align-items: center;',
      '  justify-content: center;',
      '  visibility: visible !important;',
      '  opacity: 1 !important;',
      '  flex-shrink: 0 !important;',
      '}',
      '.vortex-enhanced-track:hover,',
      '.vortex-enhanced-endorse:hover { opacity: 0.85; }',
      '.vortex-enhanced-track:disabled,',
      '.vortex-enhanced-endorse:disabled { opacity: 0.45; cursor: wait; }',
      '.vortex-enhanced-endorse.is-disabled { opacity: 0.35; cursor: not-allowed; }',
      '.vortex-enhanced-icon { width: 16px; height: 16px; display: block; }',
      '[data-e2eid="mod-tile"] [data-e2eid="mod-tile-options"],',
      '[data-e2eid="mod-tile"] button[aria-label="Mod options"] {',
      '  display: none !important;',
      '}',
      '.vortex-enhanced-footer-actions { pointer-events: auto; }',
      '.vortex-enhanced-nexus-toast-host {',
      '  position: fixed;',
      '  bottom: 24px;',
      '  left: 50%;',
      '  transform: translateX(-50%);',
      '  z-index: 99999;',
      '  pointer-events: none;',
      '}',
      '.vortex-enhanced-nexus-toast {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 10px;',
      '  background: #2a2a2a;',
      '  color: #fff;',
      '  padding: 10px 16px;',
      '  border-radius: 6px;',
      '  font-size: 14px;',
      '  box-shadow: 0 4px 12px rgba(0,0,0,0.4);',
      '}',
      '.vortex-enhanced-toast-icon {',
      '  width: 20px;',
      '  height: 20px;',
      '  border-radius: 50%;',
      '  background: #1ea34a;',
      '  color: #fff;',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  font-size: 12px;',
      '  font-weight: 700;',
      '}',
      'html.vortex-enhanced-browse-wide {',
      '  overflow: hidden !important;',
      '  max-height: 100vh !important;',
      '}',
      'html.vortex-enhanced-browse-wide body {',
      '  overflow: hidden !important;',
      '}',
      'html.vortex-enhanced-browse-wide .next-container-fluid {',
      '  max-width: 100% !important;',
      '  width: 100% !important;',
      '  padding-left: 8px !important;',
      '  padding-right: 8px !important;',
      '}',
      'html.vortex-enhanced-browse-wide #mainContent {',
      '  width: 100% !important;',
      '  max-width: 100% !important;',
      '}',
      'html.vortex-enhanced-browse-wide .mods-grid,',
      'html.vortex-enhanced-browse-wide .vortex-enhanced-grid-layout {',
      '  width: 100% !important;',
      '  max-width: 100% !important;',
      '}',
      '.vortex-enhanced-grid-layout {',
      '  display: grid !important;',
      '  grid-template-columns: repeat(var(--vortex-grid-cols, 8), minmax(0, 1fr)) !important;',
      '  grid-template-rows: none !important;',
      '  grid-auto-rows: var(--vortex-card-height, 450px) !important;',
      '  gap: 12px !important;',
      '  overflow: hidden !important;',
      '  width: 100% !important;',
      '  max-width: 100% !important;',
      '  max-height: calc(var(--vortex-grid-rows, 3) * (var(--vortex-card-height, 450px) + 12px)) !important;',
      '  grid-auto-flow: row !important;',
      '  align-items: stretch !important;',
      '}',
      '.vortex-enhanced-carousel-host {',
      '  display: block !important;',
      '  width: 100% !important;',
      '  max-width: 100% !important;',
      '  overflow: hidden !important;',
      '  overscroll-behavior: contain;',
      '  min-height: 0 !important;',
      '}',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-carousel-host {',
      '  display: flex !important;',
      '  flex-direction: column !important;',
      '}',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-controls-bar-in-host {',
      '  display: flex !important;',
      '  flex: 0 0 auto !important;',
      '  align-items: center !important;',
      '  justify-content: flex-end !important;',
      '  flex-wrap: nowrap !important;',
      '  gap: 8px !important;',
      '  width: 100% !important;',
      '  padding: 4px 8px 6px !important;',
      '  margin: 0 !important;',
      '  min-height: 36px !important;',
      '  visibility: visible !important;',
      '  position: sticky !important;',
      '  top: 0 !important;',
      '  z-index: 40 !important;',
      '  pointer-events: none !important;',
      '  background: #101010 !important;',
      '  border-bottom: 1px solid rgba(255,255,255,0.08) !important;',
      '}',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-controls-bar-in-host > * {',
      '  pointer-events: auto !important;',
      '}',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-carousel-host > .vortex-enhanced-grid-layout {',
      '  flex: 1 1 auto !important;',
      '}',
      '.vortex-enhanced-pool-host,',
      '.vortex-enhanced-nexus-live-hidden {',
      '  display: none !important;',
      '}',
      '#vortex-enhanced-catalog-grid {',
      '  display: none;',
      '}',
      '.vortex-enhanced-local-catalog-active #vortex-enhanced-catalog-grid {',
      '  display: grid !important;',
      '}',
      '.vortex-enhanced-local-catalog-active .vortex-enhanced-nexus-grid {',
      '  display: none !important;',
      '}',
      '.vortex-enhanced-grid-layout > [data-e2eid="mod-tile"] {',
      '  width: 100% !important;',
      '  min-width: 0 !important;',
      '  max-width: none !important;',
      '  flex: unset !important;',
      '  display: flex !important;',
      '  flex-direction: column !important;',
      '  justify-content: flex-start !important;',
      '  height: var(--vortex-card-height, 450px) !important;',
      '  min-height: var(--vortex-card-height, 450px) !important;',
      '  max-height: var(--vortex-card-height, 450px) !important;',
      '  overflow: hidden !important;',
      '  box-sizing: border-box !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"].vortex-enhanced-carousel-hidden,',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"].vortex-enhanced-hidden,',
      'main [data-e2eid="mod-tile"].vortex-enhanced-carousel-hidden,',
      '#mainContent [data-e2eid="mod-tile"].vortex-enhanced-carousel-hidden {',
      '  display: none !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"] > a[href*="/mods/"]:first-of-type {',
      '  flex: 0 0 auto !important;',
      '  width: 100% !important;',
      '  max-height: var(--vortex-thumb-height, 160px) !important;',
      '  min-height: 120px !important;',
      '  overflow: hidden !important;',
      '  display: block !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"] > a[href*="/mods/"]:first-of-type img,',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"] img[data-e2eid="mod-tile-image"] {',
      '  width: 100% !important;',
      '  height: 100% !important;',
      '  max-height: var(--vortex-thumb-height, 160px) !important;',
      '  min-height: 120px !important;',
      '  object-fit: cover !important;',
      '  display: block !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-title"] {',
      '  display: -webkit-box !important;',
      '  -webkit-line-clamp: 2 !important;',
      '  -webkit-box-orient: vertical !important;',
      '  overflow: hidden !important;',
      '  margin-bottom: 2px !important;',
      '  line-height: 1.25 !important;',
      '  flex: 0 0 auto !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-author"] {',
      '  margin-bottom: 2px !important;',
      '  line-height: 1.2 !important;',
      '  flex: 0 0 auto !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-description"],',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"] p[class*="line-clamp"],',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"] div[class*="line-clamp"],',
      '.vortex-enhanced-grid-layout .vortex-enhanced-injected-desc,',
      '.vortex-enhanced-grid-layout .vortex-enhanced-desc-clamped {',
      '  display: -webkit-box !important;',
      '  -webkit-box-orient: vertical !important;',
      '  overflow: hidden !important;',
      '  margin-top: 2px !important;',
      '  margin-bottom: 0 !important;',
      '  padding-bottom: 0 !important;',
      '  line-height: 1.35 !important;',
      '  flex: 0 0 auto !important;',
      '}',
      '.vortex-enhanced-grid-layout .vortex-enhanced-title-1l .vortex-enhanced-desc-clamped,',
      '.vortex-enhanced-grid-layout .vortex-enhanced-title-1l [data-e2eid="mod-tile-description"],',
      '.vortex-enhanced-grid-layout .vortex-enhanced-title-1l [data-e2eid="mod-tile-summary"],',
      '.vortex-enhanced-grid-layout .vortex-enhanced-title-1l .vortex-enhanced-injected-desc {',
      '  -webkit-line-clamp: 4 !important;',
      '}',
      '.vortex-enhanced-grid-layout .vortex-enhanced-title-2l .vortex-enhanced-desc-clamped,',
      '.vortex-enhanced-grid-layout .vortex-enhanced-title-2l [data-e2eid="mod-tile-description"],',
      '.vortex-enhanced-grid-layout .vortex-enhanced-title-2l [data-e2eid="mod-tile-summary"],',
      '.vortex-enhanced-grid-layout .vortex-enhanced-title-2l .vortex-enhanced-injected-desc {',
      '  -webkit-line-clamp: 3 !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"] > div.vortex-enhanced-card-shell,',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"] > div:first-child {',
      '  flex: 1 1 auto !important;',
      '  flex-grow: 1 !important;',
      '  display: flex !important;',
      '  flex-direction: column !important;',
      '  min-height: 0 !important;',
      '  height: 100% !important;',
      '  width: 100% !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"] > div.vortex-enhanced-card-shell > div,',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"] > div:first-child > div {',
      '  flex: 0 0 auto !important;',
      '  flex-grow: 0 !important;',
      '  min-height: 0 !important;',
      '  padding-bottom: 0 !important;',
      '  margin-bottom: 0 !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-updated"],',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-date"] {',
      '  margin-top: 0 !important;',
      '  margin-bottom: 0 !important;',
      '  flex: 0 0 auto !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-stats"],',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-file-size"],',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-endorses"],',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile-downloads"] {',
      '  display: flex !important;',
      '  visibility: visible !important;',
      '  flex-shrink: 0 !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"] [class*="flex-1"],',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"] [class*="grow"] {',
      '  flex: 0 0 auto !important;',
      '  flex-grow: 0 !important;',
      '  min-height: 0 !important;',
      '}',
      '.vortex-enhanced-meta-stats {',
      '  display: none !important;',
      '}',
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"] .mt-auto,',
      '.vortex-enhanced-grid-layout .vortex-enhanced-footer-row {',
      '  margin-top: auto !important;',
      '  padding-top: 0 !important;',
      '  flex-shrink: 0 !important;',
      '  min-height: 34px !important;',
      '  width: 100% !important;',
      '}',
      '.vortex-enhanced-chrome-hidden {',
      '  display: none !important;',
      '}',
      '.vortex-enhanced-browse-trim-hidden {',
      '  display: none !important;',
      '}',
      '.vortex-enhanced-carousel-hidden { display: none !important; }',
      '#vortex-enhanced-carousel-controls,',
      '#vortex-enhanced-controls-bar,',
      '#vortex-enhanced-controls-anchor {',
      '  visibility: visible !important;',
      '  opacity: 1 !important;',
      '}',
      '.vortex-enhanced-controls-bar-fallback {',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  justify-content: flex-end !important;',
      '  width: 100% !important;',
      '  padding: 0 !important;',
      '  margin: 0 !important;',
      '  flex-shrink: 0 !important;',
      '  position: relative !important;',
      '  z-index: 5 !important;',
      '  min-height: 0 !important;',
      '}',
      '.vortex-enhanced-controls-anchor {',
      '  display: inline-flex !important;',
      '  align-items: center !important;',
      '  margin-left: auto !important;',
      '  flex-shrink: 0 !important;',
      '}',
      '.vortex-enhanced-results-toolbar {',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  flex-wrap: nowrap !important;',
      '  gap: 8px !important;',
      '  width: 100% !important;',
      '  overflow: visible !important;',
      '}',
      '.vortex-enhanced-sort-toolbar-row {',
      '  display: flex !important;',
      '  flex-direction: row !important;',
      '  align-items: center !important;',
      '  flex-wrap: nowrap !important;',
      '  gap: 8px !important;',
      '  width: 100% !important;',
      '  min-height: 0 !important;',
      '  margin: 0 !important;',
      '  padding: 0 !important;',
      '}',
      '.vortex-enhanced-unified-toolbar-row {',
      '  display: flex !important;',
      '  flex-direction: row !important;',
      '  align-items: center !important;',
      '  flex-wrap: nowrap !important;',
      '  gap: 10px !important;',
      '  width: 100% !important;',
      '  max-width: 100% !important;',
      '  box-sizing: border-box !important;',
      '}',
      '.vortex-enhanced-filter-toolbar-row {',
      '  display: flex !important;',
      '  flex-direction: row !important;',
      '  align-items: center !important;',
      '  flex-wrap: wrap !important;',
      '  gap: 8px !important;',
      '  width: 100% !important;',
      '  box-sizing: border-box !important;',
      '}',
      '.vortex-enhanced-filter-toolbar-row > .vortex-enhanced-controls-anchor {',
      '  margin-left: auto !important;',
      '  flex: 0 0 auto !important;',
      '}',
      '.vortex-enhanced-unified-toolbar-row > .vortex-enhanced-controls-anchor {',
      '  margin-left: auto !important;',
      '  flex: 0 0 auto !important;',
      '}',
      '.vortex-enhanced-sort-toolbar-row > .vortex-enhanced-controls-anchor {',
      '  margin-left: auto !important;',
      '}',
      '[data-radix-popper-content-wrapper].vortex-enhanced-browse-trim-hidden,',
      '[role="listbox"].vortex-enhanced-browse-trim-hidden {',
      '  display: none !important;',
      '}',
      '.vortex-enhanced-carousel-controls-inline {',
      '  display: inline-flex !important;',
      '  align-items: center !important;',
      '  gap: 10px !important;',
      '  margin-left: 0 !important;',
      '  flex-wrap: nowrap !important;',
      '  padding: 0 !important;',
      '  margin-bottom: 0 !important;',
      '}',
      '.vortex-enhanced-hide-native-count {',
      '  display: none !important;',
      '}',
      '.vortex-enhanced-carousel-controls {',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  justify-content: flex-end !important;',
      '  gap: 10px !important;',
      '  padding: 0 !important;',
      '  margin-bottom: 0 !important;',
      '  flex-shrink: 0 !important;',
      '  visibility: visible !important;',
      '  opacity: 1 !important;',
      '}',
      '.vortex-enhanced-carousel-meta {',
      '  display: none;',
      '}',
      '.vortex-enhanced-carousel-btn {',
      '  background: #2d6cdf;',
      '  color: #fff;',
      '  border: none;',
      '  border-radius: 4px;',
      '  padding: 6px 14px;',
      '  cursor: pointer;',
      '  font-size: 13px;',
      '  font-weight: 700;',
      '  line-height: 1.4;',
      '  box-shadow: 0 1px 3px rgba(0,0,0,0.3);',
      '  white-space: nowrap;',
      '}',
      '.vortex-enhanced-carousel-btn:hover { background: #2459b8; }',
      '.vortex-enhanced-carousel-btn:disabled {',
      '  opacity: 0.45;',
      '  cursor: not-allowed;',
      '}',
      '.vortex-enhanced-carousel-hint {',
      '  font-size: 11px;',
      '  opacity: 0.7;',
      '}',
      '[data-carousel-page], [data-carousel-count] {',
      '  font-size: 12px;',
      '  font-weight: 700;',
      '}',
      '[data-carousel-count] {',
      '  font-size: 11px;',
      '  font-weight: 400;',
      '  opacity: 0.8;',
      '}',
      '.vortex-enhanced-auto-advance {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  font-size: 11px;',
      '  margin-top: 2px;',
      '}',
      '.vortex-enhanced-auto-advance input[type="range"] {',
      '  width: 90px;',
      '}',
      'html.vortex-enhanced-hide-chrome header,',
      'html.vortex-enhanced-hide-chrome footer,',
      'html.vortex-enhanced-hide-chrome #siteHeader,',
      'html.vortex-enhanced-hide-chrome #site-header,',
      'html.vortex-enhanced-hide-chrome:not(.vortex-enhanced-translation-dismissed) aside:not(.vortex-enhanced-nexus-filters-open),',
      'html.vortex-enhanced-hide-chrome:not(.vortex-enhanced-translation-dismissed) #filters-panel:not(.vortex-enhanced-nexus-filters-open),',
      'html.vortex-enhanced-hide-chrome [class*="site-footer"],',
      'html.vortex-enhanced-hide-chrome [class*="GlobalHeader"],',
      'html.vortex-enhanced-hide-chrome [class*="GlobalNav"],',
      'html.vortex-enhanced-hide-chrome [class*="SiteHeader"],',
      'html.vortex-enhanced-hide-chrome:not(.vortex-enhanced-translation-dismissed) [class*="ResultsHeader"]:not(:has(.vortex-enhanced-nexus-active-filters)):not(:has(.vortex-enhanced-sort-toolbar-row)):not(:has(.vortex-enhanced-unified-toolbar-row)):not(:has([class*="ActiveFilter"])):not(:has([class*="AppliedFilter"])),',
      'html.vortex-enhanced-hide-chrome [class*="ActiveFilter"]:not(.vortex-enhanced-nexus-active-filters):not(:has(.vortex-enhanced-nexus-active-filters)),',
      'html.vortex-enhanced-hide-chrome [class*="AppliedFilter"]:not(.vortex-enhanced-nexus-active-filters):not(:has(.vortex-enhanced-nexus-active-filters)),',
      'html.vortex-enhanced-hide-chrome [class*="Breadcrumbs"],',
      'html.vortex-enhanced-hide-chrome [class*="GameHeader"],',
      'html.vortex-enhanced-hide-chrome [class*="PageHero"],',
      'html.vortex-enhanced-hide-chrome [class*="HeroBanner"],',
      'html.vortex-enhanced-hide-chrome [class*="CoverBanner"],',
      'html.vortex-enhanced-hide-chrome [class*="ModsHeader"],',
      'html.vortex-enhanced-hide-chrome [class*="GameBanner"],',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-chrome-hidden {',
      '  display: none !important;',
      '}',
      'html.vortex-enhanced-auth-page input,',
      'html.vortex-enhanced-auth-page textarea,',
      'html.vortex-enhanced-auth-page select,',
      'html.vortex-enhanced-auth-page form,',
      'html.vortex-enhanced-auth-page main,',
      'html.vortex-enhanced-auth-page label,',
      'html.vortex-enhanced-auth-page button {',
      '  display: revert !important;',
      '  visibility: visible !important;',
      '  opacity: 1 !important;',
      '}',
      'html.vortex-enhanced-hide-chrome #filters-panel.vortex-enhanced-nexus-filters-open,',
      'html.vortex-enhanced-hide-chrome aside.vortex-enhanced-nexus-filters-open,',
      'html.vortex-enhanced-hide-chrome #filters-panel.vortex-enhanced-nexus-filters-open.vortex-enhanced-chrome-hidden,',
      'html.vortex-enhanced-hide-chrome aside.vortex-enhanced-nexus-filters-open.vortex-enhanced-chrome-hidden {',
      '  display: block !important;',
      '  visibility: visible !important;',
      '}',
      'html.vortex-enhanced-translation-dismissed.vortex-enhanced-hide-chrome [class*="ResultsHeader"],',
      'html.vortex-enhanced-translation-dismissed.vortex-enhanced-hide-chrome .vortex-enhanced-results-toolbar,',
      'html.vortex-enhanced-translation-dismissed.vortex-enhanced-hide-chrome .vortex-enhanced-carousel-host,',
      'html.vortex-enhanced-translation-dismissed.vortex-enhanced-hide-chrome .vortex-enhanced-nexus-grid,',
      'html.vortex-enhanced-translation-dismissed.vortex-enhanced-hide-chrome [data-e2eid="mod-tile"]:not(.vortex-enhanced-carousel-hidden):not(.vortex-enhanced-nexus-live-hidden),',
      'html.vortex-enhanced-translation-dismissed.vortex-enhanced-hide-chrome nav:has([aria-current="page"]):not(.vortex-enhanced-nexus-pagination-hide) {',
      '  visibility: visible !important;',
      '}',
      'html.vortex-enhanced-translation-dismissed.vortex-enhanced-hide-chrome [class*="ResultsHeader"],',
      'html.vortex-enhanced-translation-dismissed.vortex-enhanced-hide-chrome .vortex-enhanced-results-toolbar,',
      'html.vortex-enhanced-translation-dismissed.vortex-enhanced-hide-chrome .vortex-enhanced-sort-toolbar-row,',
      'html.vortex-enhanced-translation-dismissed.vortex-enhanced-hide-chrome .vortex-enhanced-unified-toolbar-row {',
      '  display: flex !important;',
      '}',
      'html.vortex-enhanced-translation-dismissed.vortex-enhanced-hide-chrome .vortex-enhanced-nexus-grid {',
      '  display: grid !important;',
      '}',
      'html.vortex-enhanced-translation-dismissed.vortex-enhanced-hide-chrome [data-e2eid="mod-tile"]:not(.vortex-enhanced-carousel-hidden):not(.vortex-enhanced-nexus-live-hidden) {',
      '  display: block !important;',
      '}',
      'html.vortex-enhanced-translation-dismissed:not(.vortex-enhanced-hide-chrome) [class*="ResultsHeader"],',
      'html.vortex-enhanced-translation-dismissed:not(.vortex-enhanced-hide-chrome) .vortex-enhanced-results-toolbar,',
      'html.vortex-enhanced-translation-dismissed:not(.vortex-enhanced-hide-chrome) .vortex-enhanced-carousel-host,',
      'html.vortex-enhanced-translation-dismissed:not(.vortex-enhanced-hide-chrome) .vortex-enhanced-nexus-grid,',
      'html.vortex-enhanced-translation-dismissed:not(.vortex-enhanced-hide-chrome) [data-e2eid="mod-tile"]:not(.vortex-enhanced-carousel-hidden):not(.vortex-enhanced-nexus-live-hidden),',
      'html.vortex-enhanced-translation-dismissed:not(.vortex-enhanced-hide-chrome) nav:has([aria-current="page"]):not(.vortex-enhanced-nexus-pagination-hide) {',
      '  visibility: visible !important;',
      '}',
      'html.vortex-enhanced-translation-dismissed:not(.vortex-enhanced-hide-chrome) [class*="ResultsHeader"],',
      'html.vortex-enhanced-translation-dismissed:not(.vortex-enhanced-hide-chrome) .vortex-enhanced-results-toolbar,',
      'html.vortex-enhanced-translation-dismissed:not(.vortex-enhanced-hide-chrome) .vortex-enhanced-sort-toolbar-row,',
      'html.vortex-enhanced-translation-dismissed:not(.vortex-enhanced-hide-chrome) .vortex-enhanced-unified-toolbar-row {',
      '  display: flex !important;',
      '}',
      'html.vortex-enhanced-translation-dismissed:not(.vortex-enhanced-hide-chrome) .vortex-enhanced-nexus-grid {',
      '  display: grid !important;',
      '}',
      'html.vortex-enhanced-translation-dismissed:not(.vortex-enhanced-hide-chrome) [data-e2eid="mod-tile"]:not(.vortex-enhanced-carousel-hidden):not(.vortex-enhanced-nexus-live-hidden) {',
      '  display: block !important;',
      '}',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-nexus-active-filters,',
      'html.vortex-enhanced-hide-chrome [class*="ResultsHeader"]:has(.vortex-enhanced-nexus-active-filters),',
      'html.vortex-enhanced-hide-chrome [class*="ActiveFilter"].vortex-enhanced-nexus-active-filters,',
      'html.vortex-enhanced-hide-chrome [class*="AppliedFilter"].vortex-enhanced-nexus-active-filters,',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-unified-toolbar-row,',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-results-toolbar,',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-sort-toolbar-row,',
      'html.vortex-enhanced-hide-chrome #vortex-enhanced-controls-bar,',
      'html.vortex-enhanced-hide-chrome #vortex-enhanced-carousel-controls,',
      'html.vortex-enhanced-hide-chrome #vortex-enhanced-controls-anchor,',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-controls-bar-fallback,',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-controls-bar-in-host,',
      'html.vortex-enhanced-hide-chrome [data-vortex-enhanced-ui="true"] {',
      '  display: flex !important;',
      '  visibility: visible !important;',
      '}',
      'html.vortex-enhanced-hide-chrome #vortex-enhanced-controls-anchor {',
      '  display: inline-flex !important;',
      '}',
      'html.vortex-enhanced-hide-chrome aside.vortex-enhanced-nexus-filters-open {',
      '  display: block !important;',
      '  visibility: visible !important;',
      '}',
      'html.vortex-enhanced-hide-chrome #filters-panel.vortex-enhanced-nexus-filters-open {',
      '  display: block !important;',
      '  visibility: visible !important;',
      '}',
      'aside.vortex-enhanced-nexus-filters-open.vortex-enhanced-browse-trim-hidden,',
      'aside.vortex-enhanced-nexus-filters-open.vortex-enhanced-chrome-hidden {',
      '  display: block !important;',
      '  visibility: visible !important;',
      '}',
      '#filters-panel.vortex-enhanced-nexus-filters-open.vortex-enhanced-browse-trim-hidden,',
      '#filters-panel.vortex-enhanced-nexus-filters-open.vortex-enhanced-chrome-hidden {',
      '  display: block !important;',
      '  visibility: visible !important;',
      '}',
      '.vortex-enhanced-nexus-rewards-hidden {',
      '  display: none !important;',
      '  visibility: hidden !important;',
      '  height: 0 !important;',
      '  overflow: hidden !important;',
      '  margin: 0 !important;',
      '  padding: 0 !important;',
      '}',
      '.vortex-enhanced-nexus-pagination-hide {',
      '  display: none !important;',
      '}',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-items-per-page-hide,',
      'html.vortex-enhanced-hide-chrome button[aria-label="Mods per page"] {',
      '  display: none !important;',
      '  visibility: hidden !important;',
      '  width: 0 !important;',
      '  min-width: 0 !important;',
      '  padding: 0 !important;',
      '  margin: 0 !important;',
      '  overflow: hidden !important;',
      '  pointer-events: none !important;',
      '}',
      '.vortex-enhanced-filter-panel {',
      '  margin: 0 0 12px 0;',
      '  padding: 0;',
      '  border-bottom: 1px solid rgba(255,255,255,0.12);',
      '}',
      '.vortex-enhanced-filter-panel-inline {',
      '  width: 100%;',
      '  max-width: 100%;',
      '  clear: both;',
      '  display: block;',
      '  box-sizing: border-box;',
      '}',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-filter-panel-inline {',
      '  display: none !important;',
      '}',
      '.vortex-enhanced-nexus-active-filters {',
      '  display: flex !important;',
      '  flex-direction: row !important;',
      '  flex-wrap: wrap !important;',
      '  align-items: center !important;',
      '  gap: 8px !important;',
      '  margin: 0 !important;',
      '  padding: 0 !important;',
      '  min-height: 28px !important;',
      '  height: auto !important;',
      '  line-height: 1.2 !important;',
      '  position: relative !important;',
      '  z-index: 45 !important;',
      '  pointer-events: auto !important;',
      '  flex: 0 0 100% !important;',
      '  width: 100% !important;',
      '  max-width: 100% !important;',
      '}',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-unified-toolbar-row:has(.vortex-enhanced-nexus-active-filters),',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-sort-toolbar-row:has(.vortex-enhanced-nexus-active-filters) {',
      '  flex-wrap: wrap !important;',
      '}',
      '.vortex-enhanced-nexus-active-filters > :not(button):not(a):not([role="button"]) {',
      '  margin: 0 !important;',
      '  padding-top: 0 !important;',
      '  padding-bottom: 0 !important;',
      '  min-height: 0 !important;',
      '  line-height: 1.2 !important;',
      '}',
      '.vortex-enhanced-nexus-active-filters button,',
      '.vortex-enhanced-nexus-active-filters a,',
      '.vortex-enhanced-nexus-active-filters [role="button"],',
      '.vortex-enhanced-nexus-clear-all {',
      '  position: relative !important;',
      '  z-index: 46 !important;',
      '  pointer-events: auto !important;',
      '  cursor: pointer !important;',
      '  min-height: 24px !important;',
      '  touch-action: manipulation !important;',
      '}',
      '.vortex-enhanced-nexus-active-filters-shell,',
      '[class*="ResultsHeader"]:has(.vortex-enhanced-nexus-active-filters) {',
      '  margin-top: 0 !important;',
      '  margin-bottom: 0 !important;',
      '  padding-top: 0 !important;',
      '  padding-bottom: 0 !important;',
      '  min-height: 0 !important;',
      '  height: auto !important;',
      '  gap: 0 !important;',
      '  position: relative !important;',
      '  z-index: 44 !important;',
      '  pointer-events: auto !important;',
      '}',
      '.vortex-enhanced-nexus-active-filters-empty,',
      '.vortex-enhanced-browse-gap-collapse,',
      '.vortex-enhanced-nexus-active-filters.vortex-enhanced-browse-gap-collapse,',
      '[class*="ActiveFilter"].vortex-enhanced-browse-gap-collapse,',
      '[class*="AppliedFilter"].vortex-enhanced-browse-gap-collapse,',
      '.vortex-enhanced-nexus-active-filters-shell.vortex-enhanced-browse-gap-collapse {',
      '  display: none !important;',
      '  visibility: hidden !important;',
      '  height: 0 !important;',
      '  min-height: 0 !important;',
      '  max-height: 0 !important;',
      '  margin: 0 !important;',
      '  padding: 0 !important;',
      '  overflow: hidden !important;',
      '  border: 0 !important;',
      '  flex: 0 0 0 !important;',
      '  line-height: 0 !important;',
      '}',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-unified-toolbar-row:not(.vortex-enhanced-has-active-filters) > .vortex-enhanced-browse-gap-collapse,',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-sort-toolbar-row:not(.vortex-enhanced-has-active-filters) > .vortex-enhanced-browse-gap-collapse {',
      '  display: none !important;',
      '}',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-carousel-host {',
      '  margin-top: 0 !important;',
      '  padding-top: 0 !important;',
      '}',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-carousel-host > .vortex-enhanced-grid-layout {',
      '  margin-top: 0 !important;',
      '  padding-top: 0 !important;',
      '}',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-unified-toolbar-row:not(.vortex-enhanced-has-active-filters),',
      'html.vortex-enhanced-hide-chrome .vortex-enhanced-sort-toolbar-row:not(.vortex-enhanced-has-active-filters) {',
      '  flex-wrap: nowrap !important;',
      '  row-gap: 0 !important;',
      '  margin-bottom: 0 !important;',
      '  padding-bottom: 0 !important;',
      '}',
      'html.vortex-enhanced-no-url-filters .vortex-enhanced-unified-toolbar-row:not(.vortex-enhanced-has-active-filters),',
      'html.vortex-enhanced-no-url-filters .vortex-enhanced-sort-toolbar-row:not(.vortex-enhanced-has-active-filters) {',
      '  flex-wrap: nowrap !important;',
      '  row-gap: 0 !important;',
      '  margin-bottom: 0 !important;',
      '  padding-bottom: 0 !important;',
      '}',
      'html.vortex-enhanced-no-url-filters .vortex-enhanced-unified-toolbar-row:not(.vortex-enhanced-has-active-filters) > .vortex-enhanced-browse-gap-collapse,',
      'html.vortex-enhanced-no-url-filters .vortex-enhanced-sort-toolbar-row:not(.vortex-enhanced-has-active-filters) > .vortex-enhanced-browse-gap-collapse {',
      '  display: none !important;',
      '}',
      'html.vortex-enhanced-no-url-filters .vortex-enhanced-carousel-host {',
      '  margin-top: 0 !important;',
      '  padding-top: 0 !important;',
      '  transform: translateY(-18px) !important;',
      '}',
      '.vortex-enhanced-nexus-clear-all {',
      '  display: inline !important;',
      '  margin: 0 !important;',
      '  padding: 0 !important;',
      '  white-space: nowrap !important;',
      '}',
      '[data-vortex-enhanced-filters="true"] {',
      '  display: block !important;',
      '  visibility: visible !important;',
      '}',
      'aside.vortex-enhanced-nexus-filters-open [data-vortex-enhanced-filters="true"],',
      '#filters-panel.vortex-enhanced-nexus-filters-open [data-vortex-enhanced-filters="true"] {',
      '  display: block !important;',
      '  visibility: visible !important;',
      '}',
      '.vortex-enhanced-filter-panel-aside {',
      '  width: 100%;',
      '}',
      '.vortex-enhanced-filter-section-toggle {',
      '  width: 100%;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  background: transparent;',
      '  border: none;',
      '  color: inherit;',
      '  font-size: 11px;',
      '  font-weight: 700;',
      '  letter-spacing: 0.06em;',
      '  text-transform: uppercase;',
      '  padding: 10px 0;',
      '  cursor: pointer;',
      '  text-align: left;',
      '}',
      '.vortex-enhanced-filter-section-toggle[aria-expanded="true"] .vortex-enhanced-filter-chevron {',
      '  transform: rotate(90deg);',
      '}',
      '.vortex-enhanced-filter-chevron {',
      '  display: inline-block;',
      '  transition: transform 0.15s ease;',
      '  opacity: 0.75;',
      '}',
      '.vortex-enhanced-filter-body {',
      '  padding-bottom: 12px;',
      '}',
      '.vortex-enhanced-filter-body-collapsed {',
      '  display: none;',
      '}',
      '.vortex-enhanced-filter-option {',
      '  display: flex !important;',
      '  align-items: center;',
      '  gap: 8px;',
      '  font-size: 13px;',
      '  margin-bottom: 8px;',
      '  cursor: pointer;',
      '}',
      '.vortex-enhanced-grid-controls {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  margin-top: 10px;',
      '}',
      '.vortex-enhanced-grid-label {',
      '  font-size: 12px;',
      '  opacity: 0.85;',
      '  min-width: 88px;',
      '}',
      '.vortex-enhanced-grid-btn {',
      '  background: #2d6cdf;',
      '  color: #fff;',
      '  border: none;',
      '  border-radius: 4px;',
      '  width: 28px;',
      '  height: 24px;',
      '  cursor: pointer;',
      '  font-weight: 700;',
      '}',
      '.vortex-enhanced-grid-btn:hover { background: #2459b8; }',
      '.vortex-enhanced-grid-value {',
      '  min-width: 20px;',
      '  text-align: center;',
      '  font-weight: 700;',
      '}',
    ].join('\n');

    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = css;
  }

  function findCategoryHost(card) {
    var category = card.querySelector('[data-e2eid="mod-tile-category"]');
    if (category && category.parentElement) {
      return category.parentElement;
    }

    var known = card.querySelector('[data-e2eid="mod-tile-tags"], [data-e2eid="mod-tile-meta"]');
    if (known && known.parentElement) {
      return known.parentElement;
    }

    var categoryLink = card.querySelector('a[href*="categoryName="], a[href*="category="], a[href*="/categories/"]');
    if (categoryLink && categoryLink.parentElement) {
      return categoryLink.parentElement;
    }

    return null;
  }

  function hideNexusDownloadedBadge(card) {
    var selectors = [
      '[data-e2eid="mod-tile-downloaded"]',
      '[data-e2eid="mod-tile-update-available"]',
    ];

    selectors.forEach(function (selector) {
      var badge = card.querySelector(selector);
      if (!badge) {
        return;
      }

      badge.classList.add('vortex-enhanced-hide-nexus-badge');

      var container = badge.closest('.absolute') || badge.parentElement;
      if (container) {
        container.classList.add('vortex-enhanced-hide-nexus-badge');
      }
    });
  }

  function hideBadgesInNode(node) {
    if (!node || node.nodeType !== 1) {
      return;
    }

    if (node.matches && node.matches('[data-e2eid="mod-tile-downloaded"], [data-e2eid="mod-tile-update-available"]')) {
      hideNexusDownloadedBadge(node.closest('[data-e2eid="mod-tile"]') || node.parentElement);
      return;
    }

    if (node.querySelectorAll) {
      var tiles = node.matches && node.matches('[data-e2eid="mod-tile"]')
        ? [node]
        : Array.prototype.slice.call(node.querySelectorAll('[data-e2eid="mod-tile"]'));
      tiles.forEach(hideNexusDownloadedBadge);
    }
  }

  function findTileFooter(card) {
    var mtAutoBlocks = card.querySelectorAll('.mt-auto');
    if (mtAutoBlocks.length > 0) {
      return mtAutoBlocks[mtAutoBlocks.length - 1];
    }

    var fileSize = card.querySelector('[data-e2eid="mod-tile-file-size"]');
    if (fileSize) {
      var footer = fileSize.closest('.mt-auto') || fileSize.parentElement;
      if (footer) {
        return footer;
      }
    }

    var known = card.querySelector(
      '[data-e2eid="mod-tile-stats"], [data-e2eid="mod-tile-footer"], [data-e2eid="mod-tile-endorses"], [data-e2eid="mod-tile-downloads"]'
    );
    if (known) {
      return known.closest('.mt-auto') || known.parentElement || known;
    }

    var statsText = card.querySelector('[class*="stats"], [class*="endorse"], [class*="download"]');
    if (statsText) {
      return statsText.closest('.mt-auto') || statsText.parentElement;
    }

    return null;
  }

  function graphqlRequest(query, variables, operationName) {
    return fetch(GRAPHQL_URL, {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: '*/*',
        'Content-Type': 'application/json',
        'x-graphql-operationname': operationName || 'VortexBrowseEnhancer',
      },
      body: JSON.stringify({
        query: query,
        variables: variables || {},
        operationName: operationName || undefined,
      }),
    }).then(function (response) {
      return response.json();
    });
  }

  function bellIconHtml(isTracked) {
    if (isTracked) {
      return '<svg class="vortex-enhanced-icon" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path fill="#e6a817" d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>' +
        '</svg>';
    }
    return '<svg class="vortex-enhanced-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="none" stroke="#ffffff" stroke-width="2" d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>' +
      '<path fill="none" stroke="#ffffff" stroke-width="2" d="M13.73 21a2 2 0 01-3.46 0"/>' +
      '</svg>';
  }

  function endorseIconHtml(isEndorsed) {
    if (isEndorsed) {
      return '<svg class="vortex-enhanced-icon" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path fill="#1ea34a" d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>' +
        '</svg>';
    }
    return '<svg class="vortex-enhanced-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="none" stroke="#ffffff" stroke-width="2" d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>' +
      '</svg>';
  }

  function showNexusStyleToast(message) {
    var host = document.querySelector('.vortex-enhanced-nexus-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'vortex-enhanced-nexus-toast-host';
      document.body.appendChild(host);
    }

    var toast = document.createElement('div');
    toast.className = 'vortex-enhanced-nexus-toast';
    toast.innerHTML = '<span class="vortex-enhanced-toast-icon">\u2713</span><span></span>';
    toast.lastElementChild.textContent = message;
    host.appendChild(toast);

    setTimeout(function () {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    }, 3200);
  }

  function hideModOptionsButton(card) {
    var btn = card.querySelector('[data-e2eid="mod-tile-options"]') ||
      card.querySelector('button[aria-label="Mod options"]');
    if (btn) {
      btn.setAttribute('tabindex', '-1');
      btn.setAttribute('aria-hidden', 'true');
    }
  }

  function fetchViewerModState(config, modIds) {
    if (!modIds || modIds.length === 0 || !config.modUids) {
      return Promise.resolve({ tracked: {}, endorsed: {}, downloaded: {} });
    }

    var uids = [];
    var uidToModId = {};

    modIds.forEach(function (modId) {
      var uid = config.modUids[String(modId)];
      if (uid) {
        uids.push(uid);
        uidToModId[uid] = modId;
      }
    });

    if (uids.length === 0) {
      return Promise.resolve({ tracked: {}, endorsed: {}, downloaded: {} });
    }

    var query = [
      'query modsByUid($uids: [ID!]!, $count: Int) {',
      '  modsByUid(uids: $uids, count: $count) {',
      '    nodes { uid modId viewerTracked viewerEndorsed viewerDownloaded }',
      '  }',
      '}',
    ].join('\n');

    return graphqlRequest(query, { uids: uids, count: uids.length }, 'modsByUid').then(function (payload) {
      var tracked = {};
      var endorsed = {};
      var downloaded = {};
      var nodes = payload && payload.data && payload.data.modsByUid && payload.data.modsByUid.nodes
        ? payload.data.modsByUid.nodes
        : [];

      nodes.forEach(function (node) {
        if (!node || !node.uid) {
          return;
        }
        var modId = uidToModId[node.uid] || node.modId;
        if (!modId) {
          return;
        }
        var key = String(modId);
        tracked[key] = !!node.viewerTracked;
        endorsed[key] = !!node.viewerEndorsed;
        downloaded[key] = !!node.viewerDownloaded;
      });

      return { tracked: tracked, endorsed: endorsed, downloaded: downloaded };
    }).catch(function () {
      return { tracked: {}, endorsed: {}, downloaded: {} };
    });
  }

  function fetchModEnrichmentDetails(config, modIds) {
    if (!modIds || modIds.length === 0) {
      return Promise.resolve({});
    }

    return fetchModsListingByModIds(modIds, config).then(function (nodes) {
      var result = {};
      (nodes || []).forEach(function (node) {
        if (!node || node.modId == null) {
          return;
        }
        var normalized = normalizeEnrichmentDetails(node, node.modId);
        if (normalized && normalized.summary) {
          result[String(node.modId)] = { summary: normalized.summary, enriched: true };
        }
      });
      return result;
    }).catch(function () {
      return {};
    });
  }

  function applySummaryToCard(card, summary) {
    if (!card || !summary) {
      return false;
    }

    var text = String(summary).replace(/\s+/g, ' ').trim();
    if (!text) {
      return false;
    }

    var desc = card.querySelector('[data-e2eid="mod-tile-summary"]') ||
      card.querySelector('[data-e2eid="mod-tile-description"]') ||
      card.querySelector('.vortex-enhanced-injected-desc');
    if (!desc) {
      desc = document.createElement('div');
      desc.setAttribute('data-e2eid', 'mod-tile-summary');
      desc.className = 'typography-body-sm text-neutral-subdued line-clamp-4 pt-2 break-words vortex-enhanced-desc-clamped';

      var dateRow = card.querySelector('.vortex-enhanced-date-row, [data-e2eid="mod-tile-updated"]');
      var anchor = dateRow && dateRow.parentElement ? dateRow.parentElement : null;
      if (dateRow && anchor) {
        if (dateRow.nextSibling) {
          anchor.insertBefore(desc, dateRow.nextSibling);
        } else {
          anchor.appendChild(desc);
        }
      } else {
        var footer = findTileFooter(card);
        if (footer && footer.parentElement) {
          footer.parentElement.insertBefore(desc, footer);
        } else {
          card.appendChild(desc);
        }
      }
    }

    if (!desc.textContent || !desc.textContent.trim()) {
      desc.textContent = text;
    }
    return true;
  }

  function seedModEnrichmentCache(modId, node) {
    if (!modId || !node) {
      return;
    }
    var normalized = normalizeEnrichmentDetails(node, modId);
    if (!normalized || !normalized.summary) {
      return;
    }
    enhancer.modEnrichmentCache = enhancer.modEnrichmentCache || {};
    enhancer.modEnrichmentCache[String(modId)] = normalized;
  }

  function applyEnrichmentToCatalogPool(config) {
    if (!config || !isLocalCatalogMode(config) || !enhancer.tilePool) {
      return;
    }

    for (var i = 0; i < enhancer.tilePool.length; i++) {
      var entry = enhancer.tilePool[i];
      if (!entry || !entry.card || !entry.modId) {
        continue;
      }
      applyCachedModEnrichment(entry.card, entry.modId);
      compactCardFlex(entry.card);
      normalizeCardChrome(entry.card);
      pinFooterToCardBottom(entry.card);
      tuneCardTextLayout(entry.card);
    }
  }

  function ensureModTileEnrichment(card, modId, details) {
    if (!card || !details || !details.summary) {
      return;
    }

    removeInjectedMetaStats(card);
    restoreNativeTileStats(card);
    applySummaryToCard(card, details.summary);

    clampDescription(findCardDescription(card));
    compactCardFlex(card);
    normalizeCardChrome(card);
    pinFooterToCardBottom(card);
    tuneCardTextLayout(card);
  }

  function applyEnrichmentToVisibleTiles(config) {
    var grid = findModGrid();
    if (!grid) {
      return;
    }

    var tiles = grid.querySelectorAll(
      '[data-e2eid="mod-tile"]:not(.vortex-enhanced-carousel-hidden):not(.vortex-enhanced-hidden)'
    );
    for (var i = 0; i < tiles.length; i++) {
      var card = tiles[i];
      var link = card.querySelector('a[href*="/mods/"]');
      var modId = link ? parseModIdFromUrl(link.href) : null;
      removeInjectedMetaStats(card);
      restoreNativeTileStats(card);
      ensureTileImagesLoaded(card);
      if (modId) {
        applyCachedModEnrichment(card, modId);
        compactCardFlex(card);
        normalizeCardChrome(card);
        pinFooterToCardBottom(card);
        tuneCardTextLayout(card);
        ensureFooterActions(card, modId, config);
      }
    }
  }

  function applyCachedModEnrichment(card, modId) {
    if (!modId || !enhancer.modEnrichmentCache) {
      return;
    }
    var details = enhancer.modEnrichmentCache[String(modId)];
    if (details) {
      ensureModTileEnrichment(card, modId, details);
    }
  }

  function scheduleModEnrichment(config, modIds) {
    if (!modIds || modIds.length === 0) {
      return;
    }

    if (!enhancer.modEnrichmentCache) {
      enhancer.modEnrichmentCache = {};
    }

    var missing = [];
    for (var i = 0; i < modIds.length; i++) {
      var key = String(modIds[i]);
      if (!enhancer.modEnrichmentCache[key]) {
        missing.push(modIds[i]);
      }
    }

    if (missing.length === 0) {
      return;
    }

    var requestKey = missing.slice().sort(function (a, b) { return a - b; }).join(',');
    if (requestKey === enhancer.lastEnrichmentFetchKey) {
      return;
    }
    enhancer.lastEnrichmentFetchKey = requestKey;

    if (enhancer.enrichmentFetchTimer) {
      clearTimeout(enhancer.enrichmentFetchTimer);
    }

    enhancer.enrichmentFetchTimer = setTimeout(function () {
      enhancer.enrichmentFetchTimer = null;
      fetchModEnrichmentDetails(config, missing).then(function (detailsMap) {
        Object.keys(detailsMap).forEach(function (modKey) {
          enhancer.modEnrichmentCache[modKey] = detailsMap[modKey];
        });
        enhancer.lastEnrichmentFetchKey = '';
        applyEnrichmentToVisibleTiles(config);
        applyEnrichmentToCatalogPool(config);
      });
    }, 350);
  }

  function graphqlMutationSucceeded(payload, fieldName) {
    if (!payload || (payload.errors && payload.errors.length)) {
      return false;
    }
    var root = payload.data && payload.data[fieldName];
    return !!(root && root.success);
  }

  function toggleTrackMod(modUid, currentlyTracked) {
    var operationName = currentlyTracked ? 'untrackMod' : 'trackMod';
    var fieldName = operationName;
    var mutation = currentlyTracked
      ? 'mutation untrackMod($modUid: ID!) { untrackMod(modUid: $modUid) { success } }'
      : 'mutation trackMod($modUid: ID!) { trackMod(modUid: $modUid) { success trackedMod { uid } } }';

    return graphqlRequest(mutation, { modUid: String(modUid) }, operationName).then(function (payload) {
      return graphqlMutationSucceeded(payload, fieldName);
    });
  }

  function toggleEndorseMod(modUid, currentlyEndorsed) {
    var operationName = currentlyEndorsed ? 'abstainFromModEndorsement' : 'createModEndorsement';
    var fieldName = operationName;

    var mutation = currentlyEndorsed
      ? 'mutation abstainFromModEndorsement($modUid: String!) { abstainFromModEndorsement(modUid: $modUid) { success } }'
      : 'mutation createModEndorsement($modUid: String!) { createModEndorsement(modUid: $modUid) { success } }';

    return graphqlRequest(mutation, { modUid: String(modUid) }, operationName).then(function (payload) {
      return graphqlMutationSucceeded(payload, fieldName);
    });
  }

  function isFooterActionPending(action, modId) {
    return !!(enhancer.pendingFooterActions && enhancer.pendingFooterActions[action + ':' + modId]);
  }

  function setFooterActionPending(action, modId, pending, targetState) {
    if (!enhancer.pendingFooterActions) {
      enhancer.pendingFooterActions = {};
    }
    if (!enhancer.pendingFooterTargets) {
      enhancer.pendingFooterTargets = {};
    }
    if (!enhancer.pendingFooterActionTimers) {
      enhancer.pendingFooterActionTimers = {};
    }
    var key = action + ':' + modId;
    if (enhancer.pendingFooterActionTimers[key]) {
      clearTimeout(enhancer.pendingFooterActionTimers[key]);
      enhancer.pendingFooterActionTimers[key] = null;
    }
    if (pending) {
      enhancer.pendingFooterActions[key] = true;
      if (typeof targetState === 'boolean') {
        enhancer.pendingFooterTargets[key] = targetState;
      }
      enhancer.pendingFooterActionTimers[key] = setTimeout(function () {
        enhancer.pendingFooterActionTimers[key] = null;
        if (!isFooterActionPending(action, modId)) {
          return;
        }
        setFooterActionPending(action, modId, false);
        if (window.__vortexBrowseEnhancer) {
          window.__vortexBrowseEnhancer.scheduleScan(true);
        }
      }, 12000);
    } else {
      delete enhancer.pendingFooterActions[key];
      delete enhancer.pendingFooterTargets[key];
    }
  }

  function getFooterActionPendingTarget(action, modId) {
    if (!enhancer.pendingFooterTargets) {
      return null;
    }
    var key = action + ':' + modId;
    if (!isFooterActionPending(action, modId)) {
      return null;
    }
    var target = enhancer.pendingFooterTargets[key];
    return typeof target === 'boolean' ? target : null;
  }

  function updateTrackButtonUi(btn, isTracked) {
    btn.classList.toggle('is-tracked', isTracked);
    btn.title = isTracked ? 'Untrack mod' : 'Track mod';
    btn.innerHTML = bellIconHtml(isTracked);
  }

  function updateEndorseButtonUi(btn, modId, isEndorsed) {
    var canEndorse = !!(enhancer.config.viewerDownloaded && enhancer.config.viewerDownloaded[String(modId)]) ||
      !!(enhancer.config.installed && enhancer.config.installed[String(modId)]);
    btn.classList.toggle('is-endorsed', isEndorsed);
    btn.classList.toggle('is-disabled', !canEndorse);
    btn.title = !canEndorse
      ? 'Download this mod before endorsing'
      : (isEndorsed ? 'Remove endorsement' : 'Endorse mod');
    btn.innerHTML = endorseIconHtml(isEndorsed);
    if (!isFooterActionPending('endorse', modId)) {
      btn.disabled = !canEndorse;
    }
  }

  function ensureFooterActionButton(card, footer, actionsWrap, className, modId, modUid, config) {
    var btn = card.querySelector('.' + className);
    if (!modUid) {
      if (btn) {
        btn.remove();
      }
      return null;
    }

    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = className;
      btn.setAttribute('data-mod-id', String(modId));
      btn.setAttribute('data-mod-uid', String(modUid));
      actionsWrap.appendChild(btn);
    } else if (btn.parentElement !== actionsWrap) {
      actionsWrap.appendChild(btn);
    }

    btn.setAttribute('data-mod-uid', String(modUid));
    if (!isFooterActionPending(className === 'vortex-enhanced-track' ? 'track' : 'endorse', modId)) {
      btn.disabled = false;
    }
    return btn;
  }

  function ensureFooterActions(card, modId, config) {
    hideModOptionsButton(card);

    var footer = findTileFooter(card);
    if (!footer || !modId) {
      return;
    }

    footer.classList.add('vortex-enhanced-footer-row');

    var modUid = resolveModUid(config, modId);
    var actionsWrap = footer.querySelector('.vortex-enhanced-footer-actions');
    if (!actionsWrap) {
      actionsWrap = document.createElement('div');
      actionsWrap.className = 'vortex-enhanced-footer-actions';
      footer.appendChild(actionsWrap);
    }

    var isTracked = !!(config.tracked && config.tracked[String(modId)]);
    var isEndorsed = !!(config.endorsed && config.endorsed[String(modId)]);

    var trackBtn = ensureFooterActionButton(card, footer, actionsWrap, 'vortex-enhanced-track', modId, modUid, config);
    if (trackBtn) {
      var pendingTrackTarget = getFooterActionPendingTarget('track', modId);
      if (pendingTrackTarget !== null) {
        updateTrackButtonUi(trackBtn, pendingTrackTarget);
        trackBtn.disabled = true;
        trackBtn.classList.add('is-pending');
      } else {
        trackBtn.classList.remove('is-pending');
        updateTrackButtonUi(trackBtn, isTracked);
      }
    }

    var endorseBtn = ensureFooterActionButton(card, footer, actionsWrap, 'vortex-enhanced-endorse', modId, modUid, config);
    if (endorseBtn) {
      var pendingEndorseTarget = getFooterActionPendingTarget('endorse', modId);
      if (pendingEndorseTarget !== null) {
        updateEndorseButtonUi(endorseBtn, modId, pendingEndorseTarget);
        endorseBtn.disabled = true;
        endorseBtn.classList.add('is-pending');
      } else {
        endorseBtn.classList.remove('is-pending');
        if (!isFooterActionPending('endorse', modId)) {
          updateEndorseButtonUi(endorseBtn, modId, isEndorsed);
        }
      }
    }

    pinFooterToCardBottom(card);
  }

  function buildDependencyLabel(modId, config) {
    if (!modId || !config.dependencies) {
      return null;
    }

    var summary = config.dependencies[String(modId)];
    if (!summary || !summary.total) {
      return null;
    }

    var label = document.createElement('span');
    label.className = 'vortex-enhanced-deps';

    if (summary.missing > 0) {
      label.className += ' vortex-enhanced-deps-missing';
      label.textContent = '\u26a0 ' + summary.missing + (summary.missing === 1 ? ' dep' : ' deps');
      label.title = summary.missing + ' required mod(s) not installed in Vortex';
    } else {
      label.className += ' vortex-enhanced-deps-ok';
      label.textContent = 'Deps \u2713';
      label.title = 'All listed Nexus requirements are installed';
    }

    return label;
  }

  function countTitleLines(titleEl) {
    if (!titleEl) {
      return 1;
    }

    var style = window.getComputedStyle(titleEl);
    var lineHeight = parseFloat(style.lineHeight);
    if (!lineHeight || isNaN(lineHeight)) {
      lineHeight = parseFloat(style.fontSize) * 1.25;
    }

    var height = titleEl.getBoundingClientRect().height;
    return Math.max(1, Math.min(2, Math.round(height / lineHeight)));
  }

  function findCardDescription(card) {
    if (!card) {
      return null;
    }

    var summary = card.querySelector('[data-e2eid="mod-tile-summary"]');
    if (summary) {
      return summary;
    }

    var desc = card.querySelector('[data-e2eid="mod-tile-description"]') ||
      card.querySelector('.vortex-enhanced-injected-desc');
    if (desc) {
      return desc;
    }

    var lineClamp = card.querySelector('p[class*="line-clamp"], div[class*="line-clamp"]');
    if (lineClamp && !lineClamp.closest('.vortex-enhanced-footer-row, .mt-auto, .vortex-enhanced-actions')) {
      return lineClamp;
    }

    var blocks = card.querySelectorAll('p, div');
    for (var i = 0; i < blocks.length; i++) {
      var node = blocks[i];
      if (node.closest('.vortex-enhanced-footer-row, .mt-auto, .vortex-enhanced-actions, [data-e2eid="mod-tile-title"], [data-e2eid="mod-tile-author"]')) {
        continue;
      }
      if (node.querySelector('[data-e2eid="mod-tile-title"], [data-e2eid="mod-tile-author"]')) {
        continue;
      }
      var text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 48) {
        return node;
      }
    }

    return null;
  }

  function clampDescription(desc, maxLines) {
    if (!desc) {
      return;
    }

    var lines = maxLines || 3;

    desc.classList.forEach(function (cls) {
      if (cls.indexOf('line-clamp') >= 0) {
        desc.classList.remove(cls);
      }
    });
    desc.classList.add('vortex-enhanced-desc-clamped');

    desc.style.setProperty('display', '-webkit-box', 'important');
    desc.style.setProperty('-webkit-box-orient', 'vertical', 'important');
    desc.style.setProperty('-webkit-line-clamp', String(lines), 'important');
    desc.style.setProperty('overflow', 'hidden', 'important');
    desc.style.setProperty('line-height', '1.35', 'important');
    desc.style.removeProperty('height');
    desc.style.removeProperty('max-height');
    desc.style.setProperty('margin-bottom', '0', 'important');
    desc.style.setProperty('padding-bottom', '0', 'important');
    desc.style.setProperty('flex', '0 0 auto', 'important');
  }

  function tuneCardTextLayout(card) {
    if (!card) {
      return;
    }

    var title = card.querySelector('[data-e2eid="mod-tile-title"]');
    card.classList.remove('vortex-enhanced-title-1l', 'vortex-enhanced-title-2l');

    if (!title) {
      card.classList.add('vortex-enhanced-title-1l');
    } else if (countTitleLines(title) >= 2) {
      card.classList.add('vortex-enhanced-title-2l');
    } else {
      card.classList.add('vortex-enhanced-title-1l');
    }

    var descLines = card.classList.contains('vortex-enhanced-title-2l') ? 3 : 4;
    clampDescription(findCardDescription(card), descLines);
  }

  function ensureCategoryLine(card) {
    var category = card.querySelector('[data-e2eid="mod-tile-category"]');
    if (!category) {
      return;
    }

    var block = category.closest('div.py-2') || category.parentElement;
    if (block) {
      block.classList.add('vortex-enhanced-category-block');
      block.classList.remove('vortex-enhanced-meta-bar');
    }
  }

  function ensureInstallRow(card) {
    var existing = card.querySelector('.vortex-enhanced-install-row');
    if (existing) {
      return existing;
    }

    var row = document.createElement('div');
    row.className = 'vortex-enhanced-install-row';

    var category = card.querySelector('[data-e2eid="mod-tile-category"]');
    if (category) {
      var categoryBlock = category.closest('div.py-2') || category.parentElement;
      if (categoryBlock && categoryBlock.parentElement) {
        if (categoryBlock.nextSibling) {
          categoryBlock.parentElement.insertBefore(row, categoryBlock.nextSibling);
        } else {
          categoryBlock.parentElement.appendChild(row);
        }
        return row;
      }
    }

    var footer = findTileFooter(card);
    if (footer && footer.parentElement) {
      footer.parentElement.insertBefore(row, footer);
      return row;
    }

    card.appendChild(row);
    return row;
  }

  function syncDependencyBadge(card, modId, config, actionsRow) {
    if (!card || !actionsRow) {
      return;
    }

    var existingDeps = actionsRow.querySelector('.vortex-enhanced-deps');
    var depLabel = buildDependencyLabel(modId, config);

    if (!depLabel) {
      if (existingDeps) {
        existingDeps.remove();
      }
      return;
    }

    if (existingDeps) {
      existingDeps.replaceWith(depLabel);
      return;
    }

    actionsRow.insertBefore(depLabel, actionsRow.firstChild);
  }

  function ensureMetaRow(card) {
    ensureCategoryLine(card);
    return ensureInstallRow(card);
  }

  function decorateCard(card, modId, installedEntry, config) {
    if (!card) {
      return;
    }

    card.setAttribute(MARK, modId ? String(modId) : 'unknown');
    card.classList.add('vortex-enhanced-card');
    hideNexusDownloadedBadge(card);
    removeInjectedMetaStats(card);
    restoreNativeTileStats(card);
    normalizeCardChrome(card);
    ensureTileImagesLoaded(card);
    applyCachedModEnrichment(card, modId);
    compactCardFlex(card);
    tuneCardTextLayout(card);
    ensureFooterActions(card, modId, config);
    pinFooterToCardBottom(card);

    var existingBadge = card.querySelector('.vortex-enhanced-badge');
    if (existingBadge) {
      existingBadge.remove();
    }

    var installRow = ensureMetaRow(card);
    var depLabel = buildDependencyLabel(modId, config);

    card.querySelectorAll('.vortex-enhanced-deps').forEach(function (node) {
      if (!installRow || node.parentElement !== installRow) {
        node.remove();
      }
    });

    if (installedEntry) {
      var badge = document.createElement('div');
      badge.className = 'vortex-enhanced-badge';
      badge.textContent = installedEntry.version
        ? '\u2713 Installed ' + installedEntry.version
        : '\u2713 Installed';
      card.appendChild(badge);

      var existingActions = card.querySelector('.vortex-enhanced-actions');
      if (existingActions) {
        existingActions.remove();
      }

      if (installRow && depLabel) {
        syncDependencyBadge(card, modId, config, installRow);
      }
      pinFooterToCardBottom(card);
      return;
    }

    if (!modId || !installRow) {
      var orphanActions = card.querySelector('.vortex-enhanced-actions');
      if (orphanActions) {
        orphanActions.remove();
      }
      pinFooterToCardBottom(card);
      return;
    }

    var isDownloading = !!(config.downloading && config.downloading[String(modId)]);
    if (!isDownloading && enhancer.pendingInstalls[String(modId)]) {
      delete enhancer.pendingInstalls[String(modId)];
    }
    var installProgress = config.installing && config.installing[String(modId)];
    var actions = installRow.querySelector('.vortex-enhanced-actions');
    var installBtn = actions ? actions.querySelector('.vortex-enhanced-install') : null;

    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'vortex-enhanced-actions';
      installRow.appendChild(actions);
    } else if (actions.parentElement !== installRow) {
      installRow.appendChild(actions);
    }

    syncDependencyBadge(card, modId, config, installRow);

    if (!installBtn) {
      installBtn = document.createElement('button');
      installBtn.type = 'button';
      installBtn.className = 'vortex-enhanced-install';
      installBtn.setAttribute('data-mod-id', String(modId));
      actions.appendChild(installBtn);
    } else {
      installBtn.setAttribute('data-mod-id', String(modId));
      if (installBtn.parentElement !== actions) {
        actions.appendChild(installBtn);
      }
    }

    var installLabel = '\u2193 Install';
    var installDisabled = false;
    if (isDownloading) {
      installLabel = 'Starting...';
      installDisabled = true;
    } else if (installProgress === 'downloading') {
      installLabel = 'Downloading...';
      installDisabled = true;
    } else if (installProgress === 'downloaded' || installProgress === 'installing') {
      installLabel = 'Installing...';
      installDisabled = true;
    }

    installBtn.textContent = installLabel;
    installBtn.disabled = installDisabled;
    pinFooterToCardBottom(card);
  }

  function shouldHideTileCard(card, config, installedEntry, isTracked) {
    if (!card) {
      return false;
    }
    config = config || enhancer.config || {};

    var isInstalled = !!installedEntry;
    if (config.onlyInstalled && !isInstalled) {
      return true;
    }
    if (config.hideInstalled && isInstalled) {
      return true;
    }
    if (config.onlyTracked && !isTracked) {
      return true;
    }
    if (config.hideTracked && isTracked) {
      return true;
    }
    if (shouldFilterTranslationsClientSide() && isTranslationModCard(card)) {
      return true;
    }
    return false;
  }

  function applyFilters(cards, config) {
    cards.forEach(function (entry) {
      var card = entry.card;
      card.classList.remove('vortex-enhanced-hidden');
      if (shouldHideTileCard(card, config, entry.installed, !!entry.tracked)) {
        card.classList.add('vortex-enhanced-hidden');
      }
    });
  }

  function applyFiltersToAllGridTiles(config) {
    if (config && config.onlyTracked && enhancer.trackedCatalogActive && isTrackedCatalogReady(config)) {
      return;
    }
    var seen = {};
    var grid = findNexusModGrid();
    var tileNodes = [];

    if (grid) {
      tileNodes = Array.prototype.slice.call(grid.querySelectorAll('[data-e2eid="mod-tile"]'));
    }
    ['#vortex-enhanced-live-stash [data-e2eid="mod-tile"]', '#vortex-enhanced-pool-host [data-e2eid="mod-tile"]'].forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (node) {
        if (tileNodes.indexOf(node) < 0) {
          tileNodes.push(node);
        }
      });
    });

    tileNodes.forEach(function (card) {
        if (seen[card]) {
          return;
        }
        seen[card] = true;

        var modId = extractModIdFromTile(card);
        var installedEntry = modId ? (config.installed[String(modId)] || null) : null;
        var isTracked = !!(modId && config.tracked && config.tracked[String(modId)]);

        card.classList.remove('vortex-enhanced-hidden');
        if (shouldHideTileCard(card, config, installedEntry, isTracked)) {
          card.classList.add('vortex-enhanced-hidden');
        }
    });
  }

  function queryLiveGridModTiles(grid, options) {
    options = options || {};
    if (!grid) {
      return [];
    }
    var poolFilter = options.includePoolTiles ? '' : ':not([data-vortex-pool-tile])';
    var selector = '[data-e2eid="mod-tile"]' + poolFilter;
    var minDirect = typeof options.minDirect === 'number' ? options.minDirect : 1;
    var direct = grid.querySelectorAll(':scope > ' + selector);
    if (direct.length >= minDirect) {
      return Array.prototype.slice.call(direct);
    }
    return Array.prototype.slice.call(grid.querySelectorAll(selector));
  }

  function collectLiveGridCards(config) {
    config = config || enhancer.config || { installed: {}, tracked: {} };
    if (!config.installed) {
      config.installed = {};
    }
    if (!config.tracked) {
      config.tracked = {};
    }
    var grid = resolveNexusModGridElement();
    var tileNodes = [];

    if (grid) {
      tileNodes = queryLiveGridModTiles(grid, { minDirect: 4 });
    }

    var stash = document.getElementById('vortex-enhanced-live-stash');
    if (stash) {
      var stashed = stash.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])');
      for (var s = 0; s < stashed.length; s++) {
        if (tileNodes.indexOf(stashed[s]) < 0) {
          tileNodes.push(stashed[s]);
        }
      }
    }

    if (tileNodes.length === 0) {
      return [];
    }

    var cards = [];

    for (var i = 0; i < tileNodes.length; i++) {
      var card = tileNodes[i];
      var modId = extractModIdFromTile(card);
      var installedEntry = modId ? (config.installed[String(modId)] || null) : null;
      var isTracked = modId && config.tracked && config.tracked[String(modId)];
      cards.push({ card: card, modId: modId, installed: installedEntry, tracked: !!isTracked });
    }

    return sortCatalogEntries(cards);
  }

  function resolveOnlyTrackedCards(config) {
    if (config.onlyTracked && !canActivateTrackedCatalog(config)) {
      return collectLiveGridCards(config);
    }

    ensureLocalCatalogInitialized(config);

    if (!hasTrackedCatalogData(config)) {
      if (enhancer.awaitingHostTrackedListUntil && Date.now() < enhancer.awaitingHostTrackedListUntil) {
        return collectLiveGridCards(config);
      }
      enhancer.trackedSessionFetched = false;
      if (!enhancer.trackedSessionFetchInFlight) {
        syncTrackedModsFromSession(config);
      }
      return collectLiveGridCards(config);
    }

    var trackedCatalogIds = getTrackedCatalogModIds(config);
    if (trackedCatalogIds.length === 0) {
      return [];
    }

    if (isTrackedCatalogReady(config)) {
      return collectCards(config);
    }

    if (enhancer.trackedCatalogFetchInFlight && enhancer.tilePool.length > 0) {
      return collectCards(config);
    }

    if (!enhancer.localCatalogBootstrapped && !enhancer.trackedCatalogFetchInFlight) {
      applyTrackedCatalogView(config);
    }

    if (enhancer.tilePool.length > 0) {
      return collectCards(config);
    }

    return [];
  }

  function resolveOnlyInstalledCards(config) {
    ensureLocalCatalogInitialized(config);

    if (!hasLocalCatalogData(config)) {
      return [];
    }

    var catalogIds = getInstalledCatalogModIds(config);
    if (catalogIds.length === 0) {
      return [];
    }

    if (isTrackedCatalogReady(config)) {
      return collectCards(config);
    }

    if (enhancer.trackedCatalogFetchInFlight && enhancer.tilePool.length > 0) {
      return collectCards(config);
    }

    if (!enhancer.localCatalogBootstrapped && !enhancer.trackedCatalogFetchInFlight) {
      applyTrackedCatalogView(config);
    }

    if (enhancer.tilePool.length > 0) {
      return collectCards(config);
    }

    return [];
  }

  function scanLocalCatalog(config, scrollY) {
    if (config.onlyTracked && !canActivateTrackedCatalog(config)) {
      return scanLiveOnlyTrackedPreview(config, scrollY);
    }

    if (config.onlyTracked && !isTrackedCatalogReady(config)) {
      ensureLocalCatalogInitialized(config);
      if (!enhancer.localCatalogBootstrapped && !enhancer.trackedCatalogFetchInFlight) {
        applyTrackedCatalogView(config);
      }
      return scanLiveOnlyTrackedPreview(config, scrollY);
    }

    syncFilterPanelUiFromHost(config);
    ensureLocalCatalogInitialized(config);
    if (isTrackedCatalogReady(config)) {
      stashLiveNexusTilesForLocalCatalog(config);
    } else {
      restoreStashedLiveNexusTiles();
    }

    if (enhancer.localCatalogNavLock) {
      if (isTrackedCatalogReady(config)) {
        showTrackedCatalogPage(config);
        decorateVisibleCarouselSlice(collectCards(config), config);
        syncNexusResultsHeadline(config);
        ensureCarouselControlsBar();
      }
      return enhancer.lastStats || emptyScanStats(config);
    }

    if (enhancer.localCatalogBootstrapped && isTrackedCatalogReady(config)) {
      var readyCards = collectCards(config);
      showTrackedCatalogPage(config);
      decorateVisibleCarouselSlice(readyCards, config);
      ensureCarouselControlsBar();
      hideBrowsePageFooter();
      syncNexusResultsHeadline(config);
      syncAutoAdvance();
      scheduleControlsRemount();
      requestAnimationFrame(function () {
        window.scrollTo(0, scrollY);
      });
      var readyStats = {
        tileCount: readyCards.length,
        installedMatches: readyCards.filter(function (entry) { return !!entry.installed; }).length,
        hideInstalled: !!config.hideInstalled,
        onlyInstalled: !!config.onlyInstalled,
        hideTracked: !!config.hideTracked,
        onlyTracked: !!config.onlyTracked,
        installedKeys: Object.keys(config.installed || {}).length,
      };
      enhancer.lastStats = readyStats;
      return readyStats;
    }

    if (enhancer.localCatalogBootstrapped && !isTrackedCatalogReady(config) &&
        !enhancer.trackedCatalogFetchInFlight) {
      navigateTrackedCatalogPage(config);
    }

    if (!enhancer.localCatalogBootstrapped && !enhancer.trackedCatalogFetchInFlight) {
      if (config.onlyTracked) {
        resolveOnlyTrackedCards(config);
      } else if (config.onlyInstalled) {
        resolveOnlyInstalledCards(config);
      }
    }

    var cards = collectCards(config);

    if (isTrackedCatalogReady(config)) {
      showTrackedCatalogPage(config);
      decorateVisibleCarouselSlice(cards, config);
    } else if (!enhancer.localCatalogBootstrapped && !enhancer.trackedCatalogFetchInFlight) {
      showLocalCatalogPendingState(config);
      applyTrackedCatalogView(config);
    }

    ensureCarouselControlsBar();
    hideBrowsePageFooter();
    syncNexusResultsHeadline(config);
    syncAutoAdvance();
    scheduleControlsRemount();
    if (config.hideSiteChrome) {
      if (isTranslationFilterDismissedBrowse()) {
        applyDismissedBrowseHideChrome(config);
      } else {
        hideNexusChromeAboveGrid();
        hideNexusGameBannerStrip();
      }
    }

    requestAnimationFrame(function () {
      window.scrollTo(0, scrollY);
    });

    var stats = {
      tileCount: cards.length,
      installedMatches: cards.filter(function (entry) { return !!entry.installed; }).length,
      hideInstalled: !!config.hideInstalled,
      onlyInstalled: !!config.onlyInstalled,
      hideTracked: !!config.hideTracked,
      onlyTracked: !!config.onlyTracked,
      installedKeys: Object.keys(config.installed || {}).length,
    };
    enhancer.lastStats = stats;
    if (stats.tileCount > 0 && isBrowseModsListPathname(getBrowsePathname())) {
      try {
        enhancer.lastGoodBrowseUrl = window.location.href;
      } catch (errGoodUrl) {
        // ignore
      }
    }
    return attachHostLogs(stats, config);
  }

  function collectCards(config) {
    bootstrapCatalogIndices(config);

    if (isLocalCatalogMode(config) && enhancer.trackedCatalogActive) {
      var poolOnly = [];
      for (var p = 0; p < (enhancer.tilePool ? enhancer.tilePool.length : 0); p++) {
        var poolEntry = enhancer.tilePool[p];
        if (poolEntry.modId) {
          poolEntry.installed = config.installed[String(poolEntry.modId)] || null;
          poolEntry.tracked = !!(config.tracked && config.tracked[String(poolEntry.modId)]);
        }
        poolOnly.push(poolEntry);
      }
      return sortCatalogEntries(poolOnly);
    }

    var live = collectLiveGridCards(config);
    if ((urlHasActiveNexusFilters() || hasNumericNexusBrowseFilters()) &&
        filteredBrowseUsesLiveCatalogOnly()) {
      return live;
    }
    if (!enhancer.tilePool || enhancer.tilePool.length === 0) {
      return live;
    }

    var combined = live.slice();
    var seen = {};

    for (var j = 0; j < live.length; j++) {
      if (live[j].modId) {
        seen[live[j].modId] = true;
      }
    }

    for (var i = 0; i < enhancer.tilePool.length; i++) {
      var poolEntry = enhancer.tilePool[i];
      if (poolEntry.modId) {
        poolEntry.installed = config.installed[String(poolEntry.modId)] || null;
        poolEntry.tracked = !!(config.tracked && config.tracked[String(poolEntry.modId)]);
        if (seen[poolEntry.modId]) {
          continue;
        }
        seen[poolEntry.modId] = true;
      }
      combined.push(poolEntry);
    }

    return sortCatalogEntries(combined);
  }

  function reportVisibleMods(cards) {
    var modIds = [];
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].modId) {
        modIds.push(cards[i].modId);
      }
    }

    modIds.sort(function (a, b) { return a - b; });
    var key = modIds.join(',');
    if (key === enhancer.lastVisibleModsKey) {
      return;
    }

    enhancer.lastVisibleModsKey = key;
    if (modIds.length > 0) {
      sendToHost({ type: 'visible-mods', modIds: modIds });
    }
  }

  function emptyScanStats(config) {
    return {
      tileCount: 0,
      installedMatches: 0,
      hideInstalled: !!config.hideInstalled,
      onlyInstalled: !!config.onlyInstalled,
      hideTracked: !!config.hideTracked,
      onlyTracked: !!config.onlyTracked,
      installedKeys: Object.keys(config.installed || {}).length,
      browseTransition: true,
    };
  }

  function browseNeedsEnhancementRecovery(config) {
    if (!config || !config.hideSiteChrome) {
      return false;
    }
    if (!isBrowseModsListPathname(getBrowsePathname())) {
      return false;
    }
    var tiles = document.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').length;
    if (tiles < 4) {
      return false;
    }
    if (!document.querySelector('.vortex-enhanced-carousel-host')) {
      return true;
    }
    return gridVisibleTilesNeedDecoration(config);
  }

  function recoverBrowseEnhancementIfNeeded(config) {
    if (!browseNeedsEnhancementRecovery(config)) {
      return false;
    }
    clearCarouselQuietPeriod();
    enhancer.enhancementFullyPaused = false;
    enhancer.pendingPoolCleanup = false;
    return true;
  }

  function runNumericFilteredBrowseScanPath(config) {
    if (hasNumericNexusBrowseFilters() ||
        hasVisibleNexusFilterChipText() ||
        (config && config.filterBrowseActive && urlHasActiveNexusFilters())) {
      enhancer.filteredBrowseEngaged = true;
      enhancer.domFilterBrowseActive = true;
      syncFilteredBrowseDocumentState();
    }
    var numericEarlyStats = executeMinimalNumericFilteredBrowseScan(config);
    logToHost('scanNumericFilteredBrowse early', {
      stats: numericEarlyStats,
      liveTiles: numericEarlyStats.tileCount || 0,
      minimal: true,
    });
    return attachHostLogs(numericEarlyStats, config);
  }

  function scan(config) {
    if (enhancer.scanInProgress) {
      return attachHostLogs(enhancer.lastStats || emptyScanStats(config), config);
    }
    config = config || enhancer.config || {};
    if (config.filterBrowseActive && urlHasMeaningfulNexusFilters()) {
      enhancer.domFilterBrowseActive = true;
      enhancer.filteredBrowseEngaged = true;
    }
    if (shouldUseNumericFilteredBrowseScan(config)) {
      return attachHostLogs(runNumericFilteredBrowseScanPath(config), config);
    }
    enhancer.scanInProgress = true;
    try {
    var pathname = getBrowsePathname();
    if (shouldUseNumericFilteredBrowseScan(config)) {
      return runNumericFilteredBrowseScanPath(config);
    }

    if (recoverFromBrowseOopsIfNeeded()) {
      return attachHostLogs(enhancer.lastStats || emptyScanStats(config), config);
    }

    var filterApplyInFlight = enhancer.nexusFilterApplyInFlight && !isBrowseOopsPage();
    var needsRecovery = recoverBrowseEnhancementIfNeeded(config);

    if (isBrowseEnhancementPaused()) {
      return enhancer.lastStats || emptyScanStats(config);
    }

    if (enhancer.enhancementFullyPaused && !isBrowseOopsPage() && !needsRecovery) {
      return enhancer.lastStats || emptyScanStats(config);
    }

    if (enhancer.localCatalogNavLock) {
      return enhancer.lastStats || emptyScanStats(config);
    }

    refreshDomFilteredBrowseState();
    if (shouldUseNumericFilteredBrowseScan(config)) {
      return runNumericFilteredBrowseScanPath(config);
    }
    if (!config.onlyTracked && !config.onlyInstalled && !isLocalCatalogMode(config) &&
        isBrowseModsListPathname(pathname) &&
        shouldUseFilteredBrowseLightScan(config)) {
      clearStaleFilteredBrowseFetchLocks();
      if (enhancer.filteredBrowseHostBatchInFlight && enhancer.filteredBrowseHostBatchPhase !== 'forward') {
        finishFilteredBrowseHostBatch(false);
      }
      var shortCircuitStats = executeFilteredBrowseLightScan(config, { nested: true });
      return attachHostLogs(shortCircuitStats, config);
    }
    if (!isBrowseModsListPathname(pathname)) {
      if (isBrowseModDetailPathname(pathname) || pathname.indexOf('/mods') >= 0) {
        enterBrowseDetailHandsOffMode();
      }
      return enhancer.lastStats || emptyScanStats(config);
    }

    if (enhancer.browseDetailHandsOff) {
      exitBrowseDetailHandsOffMode();
    }

    if (shouldTakeFilteredBrowseFastPath(config)) {
      return runFilteredBrowseFastScan(config);
    }

    var scrollY = window.scrollY || 0;
    if (typeof enhancer.savedListScrollY === 'number' && enhancer.savedListScrollY >= 0) {
      scrollY = enhancer.savedListScrollY;
      enhancer.savedListScrollY = null;
    }
    ensureStyles();
    restoreMainBrowseContentVisibility();
    if (isPooledNexusCarouselBrowseMode(config) && isDismissedCarouselBrowseMode(config)) {
      prepareDismissedCarouselBrowse(config);
    }
    clearTranslationDismissNavigationPendingIfReady();
    if (isTranslationFilterDismissedBrowse()) {
      prepareDismissedCarouselBrowse(config);
    } else {
      syncBrowseUrlFilterDocumentState();
      if (!browseUrlHasRemovableActiveFilters()) {
        hideOrphanedClearAllRows();
        if (!shouldDeferDismissLayoutCollapse()) {
          collapseFilterGapBetweenToolbarAndGrid();
        }
      }
    }

    var sessionKey = getBrowseSessionKey();
    var browsePath = getBrowsePathname();
    noteBrowseGameContext(browsePath);
    if (sessionKey !== enhancer.poolSessionKey && enhancer.poolSessionKey) {
      var translationOnlySessionChange =
        translationFilterRemovedBetweenSessionKeys(enhancer.poolSessionKey, sessionKey) ||
        sessionKeyChangeIsTranslationOnly(enhancer.poolSessionKey, sessionKey);
      if (translationFilterRemovedBetweenSessionKeys(enhancer.poolSessionKey, sessionKey)) {
        acknowledgeUserTranslationFilterDismissal('session-scan');
      } else if (sessionKeyChangeIsTranslationOnly(enhancer.poolSessionKey, sessionKey)) {
        resetNexusResultsHeadlineCache();
      }
      enhancer.poolSessionKey = sessionKey;
      enhancer.browsePathname = browsePath;
      if (translationOnlySessionChange) {
        enhancer.carouselQuietUntil = 0;
        enhancer.pendingPoolCleanup = false;
        enhancer.lastAppliedSliceKey = '';
        enhancer.tilePool = [];
        resetNexusResultsHeadlineCache();
        unhideAllCarouselTiles();
        syncDismissedFilterBrowseState();
        enhancer.globalPageIndex = 0;
        enhancer.batchPageIndex = 0;
        if (config.hideSiteChrome) {
          applyDismissedBrowseHideChrome(config);
        }
        prepareDismissedCarouselBrowse(config);
      } else {
        resetGlobalPagingSoft();
        resetTranslationFilters();
        enhancer.lastAppliedSliceKey = '';
        enhancer.globalPageIndex = 0;
        unhideAllCarouselTiles();
        if (config.onlyTracked || config.onlyInstalled) {
          ensureLocalCatalogInitialized(config);
          enhancer.carouselQuietUntil = 0;
        } else if (!isCarouselQuietPeriod() && !enhancer.nexusFilterApplyInFlight &&
                   !urlHasActiveNexusFilters()) {
          beginCarouselQuietPeriod(1200);
        } else if (urlHasActiveNexusFilters()) {
          resetFilteredBrowseCatalogState();
        }
      }
    } else if (!enhancer.poolSessionKey) {
      enhancer.poolSessionKey = sessionKey;
      enhancer.browsePathname = browsePath;
    }

    enhancer.poolSessionKey = sessionKey;
    enhancer.browsePathname = browsePath;

    if (isBrowseEnhancementPaused()) {
      return enhancer.lastStats || emptyScanStats(config);
    }

    if (isPooledNexusCarouselBrowseMode(config) && isFilteredBrowseSession(config)) {
      clearStaleFilteredBrowseFetchLocks();
      enhancer.nativePoolRestorePromise = null;
      enhancer.dismissedPoolRestorePromise = null;
      if (enhancer.filteredBrowseHostBatchInFlight && enhancer.filteredBrowseHostBatchPhase !== 'forward') {
        finishFilteredBrowseHostBatch(false);
      }
      if (hasNumericNexusBrowseFilters()) {
        var numericStats = executeNumericFilteredBrowseScan(config);
        logToHost('scanNumericFilteredBrowse done', {
          stats: numericStats,
          liveTiles: numericStats.tileCount || 0,
        });
        return attachHostLogs(numericStats, config);
      }
      logToHost('scan filtered browse path', summarizeFilteredBrowseState(config));
      var filteredLiveTiles = document.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').length;
      if (shouldUseFilteredBrowseLightScan(config)) {
        var lightStats = executeFilteredBrowseLightScan(config, { nested: true });
        logToHost('scanFilteredBrowseLight done', {
          stats: lightStats,
          state: summarizeFilteredBrowseState(config),
        });
        return attachHostLogs(lightStats, config);
      }
      if (filteredLiveTiles > 0 && isCarouselQuietPeriod()) {
        applyFilteredNexusDirectPage(config, { skipDecorationRetry: true });
        if (filteredLiveTiles < 8) {
          return attachHostLogs(scanLightDuringQuiet(config), config);
        }
      }
    }

    ensureHideSiteChrome(config);
    cleanupInvalidToolbarRows();
    ensureCarouselLayout(config);
    ensureVortexFilterPanel(config);
    applyDefaultFilterSectionState();
    ensureNexusFiltersPanelOpenOnLoad(config);
    hideNexusRewardsPromo();
    syncNexusFiltersState(config);
    if (translationFilterExcludedInUrl()) {
      enhancer.translationUrlApplied = true;
      enhancer.translationUrlPending = false;
    }
    if (enhancer.userDismissedTranslationFilter) {
      syncHideTranslationsSidebarIfNeeded();
    }
    if (!shouldDeferHeavyNexusUi(config) && !filterApplyInFlight) {
      applyDefaultNexusFilters(config);
      ensureTranslationFilterWatchdog();
    }
    if (!isFilteredBrowseSession(config) &&
        !isNexusFiltersPanelVisible() && !enhancer.filtersPanelOpenApplied) {
      if ((enhancer.hideTranslationsApplied || config.hideSiteChrome) && !urlHasActiveNexusFilters()) {
        if (!enhancer.nexusFilterCooldownUntil || Date.now() >= enhancer.nexusFilterCooldownUntil) {
          hideNexusFilterAside();
        }
      }
    }
    hideNexusItemsPerPageUi();
    tagNexusPaginationNav();
    protectNexusBrowseHeaderStack();

    var gridConfigKey = getGridConfigKey(config);
    var filterConfigKey = getFilterCarouselConfigKey(config);
    if (!enhancer.pagingStateHydrated) {
      restoreCarouselPagingState();
      enhancer.pagingStateHydrated = true;
    }
    if (gridConfigKey !== enhancer.lastGridConfigKey) {
      enhancer.lastGridConfigKey = gridConfigKey;
      if (isLocalCatalogMode(config) && enhancer.localCatalogBootstrapped) {
        enhancer.lastAppliedSliceKey = '';
        if (isTrackedCatalogReady(config)) {
          showTrackedCatalogPage(config);
        } else {
          navigateTrackedCatalogPage(config);
        }
      }
    }
    if (filterConfigKey !== enhancer.lastFilterCarouselConfigKey) {
      if (enhancer.lastFilterCarouselConfigKey && !isLocalCatalogMode(config)) {
        resetGlobalPaging();
      }
      if (isLocalCatalogMode(config)) {
        ensureLocalCatalogInitialized(config);
        enhancer.carouselQuietUntil = 0;
      } else {
        resetTrackedCatalogPool();
        clearLocalCatalogBootstrap();
      }
      enhancer.lastFilterCarouselConfigKey = filterConfigKey;
      enhancer.lastCarouselConfigKey = getCarouselConfigKey(config);
      enhancer.lastAppliedSliceKey = '';
      saveCarouselPagingState();
    } else if (getCarouselConfigKey(config) !== enhancer.lastCarouselConfigKey) {
      enhancer.lastCarouselConfigKey = getCarouselConfigKey(config);
    }

    ensureLiveStashHost();
    ensurePoolHost();
    if (!enhancer.liveCarouselMode) {
      trySetNexusPageSize(80);
    }

    if (isLocalCatalogMode(config)) {
      return scanLocalCatalog(config, scrollY);
    }

    if (!enhancer.nativePoolRestorePromise &&
        (shouldPreferSoftNexusPagination() || urlHasActiveNexusFilters())) {
      try {
        var skipFilteredPoolRestore = urlHasActiveNexusFilters();
        if (skipFilteredPoolRestore && sessionStorage.getItem(getNativePoolStorageKey())) {
          clearFilteredBrowsePoolSnapshot();
        }
        if (!skipFilteredPoolRestore && sessionStorage.getItem(getNativePoolStorageKey())) {
          enhancer.nativePoolRestorePromise = restoreNativePoolSnapshot(config).then(function (restored) {
            enhancer.nativePoolRestorePromise = null;
            if (restored && window.__vortexBrowseEnhancer) {
              window.__vortexBrowseEnhancer.scheduleScan(true);
            }
            return restored;
          });
          return enhancer.lastStats || emptyScanStats(config);
        }
      } catch (errNativeRestore) {
        // ignore
      }
    }
    if (enhancer.nativePoolRestorePromise) {
      return enhancer.lastStats || emptyScanStats(config);
    }

    if (isDismissedCarouselBrowseMode(config) && !urlHasActiveNexusFilters() &&
        !enhancer.dismissedPoolRestorePromise &&
        (!enhancer.tilePool || enhancer.tilePool.length === 0)) {
      try {
        if (sessionStorage.getItem(getDismissedPoolStorageKey())) {
          enhancer.dismissedPoolRestorePromise = restoreDismissedBrowsePoolSnapshot(config).then(function (restored) {
            enhancer.dismissedPoolRestorePromise = null;
            if (restored && window.__vortexBrowseEnhancer) {
              window.__vortexBrowseEnhancer.scheduleScan(true);
            }
            return restored;
          });
          return enhancer.lastStats || emptyScanStats(config);
        }
      } catch (errDismissedRestore) {
        // ignore
      }
    }
    if (enhancer.dismissedPoolRestorePromise) {
      return enhancer.lastStats || emptyScanStats(config);
    }

    var cards = collectCards(config);

    if (isPooledNexusCarouselBrowseMode(config) &&
        clampDismissedCarouselPageToLoadedCatalog(config)) {
      cards = collectCards(config);
    }

    if (enhancer.filteredBrowseHostBatchInFlight) {
      handleFilteredBrowseHostBatchScan(config);
      cards = collectCards(config);
    } else if (enhancer.pendingNativeCatalogFetch) {
      var mergedOnScan = mergeLiveGridIntoPool(config);
      var nativePage = getNexusResultsPageFromUrl();
      if (mergedOnScan > 0) {
        markNativeMergedPage(nativePage);
      }
      finishNativeNavFetch(mergedOnScan > 0);
      cards = collectCards(config);
    }

    markCurrentNexusPageFetched();

    if (config.onlyTracked) {
      cards = resolveOnlyTrackedCards(config);
    } else {
      enhancer.trackedListHydrated = false;
      restoreStashedLiveNexusTiles();
    }

    if (getPageSizeFromUrl() === 80 && cards.length >= 24) {
      enhancer.nexusPageSizePending = false;
      hideNexusItemsPerPageUi();
    }

    if (shouldResetPoolForDomBatch(cards)) {
      if (!enhancer.pendingNexusBatchAdvance) {
        resetGlobalPaging();
      }
      enhancer.poolSessionKey = sessionKey;
    }

    if (cards.length > 0) {
      enhancer.lastDomBatchKey = String(cards.length);
    }

    if (enhancer.pendingNexusBatchAdvance) {
      var wasPrefetch = !!enhancer.pendingBatchPrefetch;
      enhancer.pendingNexusBatchAdvance = false;
      enhancer.pendingBatchPrefetch = false;
      enhancer.prefetchBatchInFlight = false;
      enhancer.pendingPoolFetch = false;
      if (enhancer.pendingBatchPageIndex === -1) {
        var navPageSize = getCarouselPageSize(config);
        var localStart = getCatalogSliceStart(navPageSize);
        enhancer.batchPageIndex = Math.max(0, Math.floor(localStart / navPageSize));
        enhancer.pendingBatchPageIndex = null;
      } else if (!wasPrefetch) {
        var restoredPageSize = getCarouselPageSize(config);
        var restoredLocalStart = getCatalogSliceStart(restoredPageSize);
        enhancer.batchPageIndex = Math.max(0, Math.floor(restoredLocalStart / restoredPageSize));
      }
      saveCarouselPagingState();
    } else if (enhancer.pendingTargetPage !== null && enhancer.pendingTargetPage !== undefined) {
      if (enhancer.pendingTargetPage >= 0) {
        enhancer.batchPageIndex = enhancer.pendingTargetPage;
      } else {
        enhancer.batchPageIndex = 0;
      }
      enhancer.pendingTargetPage = null;
    }

    enhancer.pendingPoolFetch = false;
    enhancer.cacheFetchInFlight = false;

    if (config.onlyTracked) {
      if (isTrackedCatalogReady(config)) {
        showTrackedCatalogPage(config);
        decorateVisibleCarouselSlice(collectCards(config), config);
      } else if (!enhancer.trackedCatalogFetchInFlight) {
        applyTrackedCatalogView(config);
      }
    } else if (isPooledNexusCarouselBrowseMode(config) && isFilteredBrowseSession(config)) {
      mergeIntoFilteredCarouselCatalog(collectLiveGridCards(config), config);
      mergeFilteredPoolIntoCarouselCatalog(config);
      if (!isFilteredBrowsePagingLocked({}) && !enhancer.carouselAdvancePending &&
          !enhancer.filteredNexusPageNavInFlight) {
        if (!enhancer.lastAppliedSliceKey || gridVisibleTilesNeedDecoration(config)) {
          applyFilteredNexusDirectPage(config, {
            skipDecorationRetry: true,
            skipHeadlineSync: true,
          });
        }
      }
      if (hasNumericNexusBrowseFilters()) {
        scheduleNumericFilteredHeadlineSync();
      }
    } else {
      applyLiveCarouselPage(cards, config);
      decorateVisibleCarouselSlice(cards, config);
      if (urlHasActiveNexusFilters()) {
        decorateVisibleGridTiles(config);
      }
    }

    if (!config.onlyTracked) {
      if (browseUsesFilteredCatalogPaging()) {
        ensureFilteredBrowsePoolSeeded(config);
      }
      maybePrefetchNextBatch(config, cards);
      ensureFilteredCatalogFill(config);
    }

    ensureCarouselControlsBar();
    protectBrowseControlsFromChromeHide();
    hideBrowsePageFooter();
    syncNexusResultsHeadline(config);
    syncAutoAdvance();
    scheduleControlsRemount();
    if (isFilteredBrowseSession(config)) {
      if (!(enhancer.carouselPagingQuietUntil && Date.now() < enhancer.carouselPagingQuietUntil)) {
        dedupeLiveGridModTiles(config);
        if (gridVisibleTilesNeedDecoration(config)) {
          decorateVisibleFilteredCarouselTiles(config);
        }
      }
      logToHost('scan filtered browse complete', {
        tileCount: cards.length,
        browseHref: getActiveBrowseHref(),
        filterBrowseActive: !!(config && config.filterBrowseActive),
        state: summarizeFilteredBrowseState(config),
      });
    }

    if (cards.length < getCarouselPageSize(config) && !enhancer.nexusPageSizePending && !enhancer.liveCarouselMode) {
      trySetNexusPageSize(80);
    }

    requestAnimationFrame(function () {
      window.scrollTo(0, scrollY);
    });

    if (cards.length > 0) {
      try {
        enhancer.lastGoodBrowseUrl = window.location.href;
      } catch (errScanUrl) {
        // ignore
      }
    }

    if (urlHasActiveNexusFilters() && cards.length >= getCarouselPageSize(config)) {
      enhancer.filteredBrowseStableSessionKey = getBrowseSessionKey();
    }

    return attachHostLogs({
      tileCount: cards.length,
      installedMatches: cards.filter(function (entry) { return !!entry.installed; }).length,
      hideInstalled: !!config.hideInstalled,
      onlyInstalled: !!config.onlyInstalled,
      hideTracked: !!config.hideTracked,
      onlyTracked: !!config.onlyTracked,
      installedKeys: Object.keys(config.installed || {}).length,
    }, config);
    } catch (errScanBody) {
      logErrorToHost('scan failed', {
        error: String(errScanBody && errScanBody.message || errScanBody),
        stack: String(errScanBody && errScanBody.stack || ''),
      });
      return attachHostLogs(enhancer.lastStats || emptyScanStats(config), config);
    } finally {
      enhancer.scanInProgress = false;
    }
  }

  var enhancer = {
    config: {
      installed: {},
      hideInstalled: false,
      onlyInstalled: false,
      hideTracked: false,
      onlyTracked: false,
      gridColumns: 8,
      gridRows: 3,
      applyDefaultFilters: true,
      hideSiteChrome: true,
      downloading: {},
      dependencies: {},
      modUids: {},
      tracked: {},
      endorsed: {},
      viewerDownloaded: {},
    },
    debounceTimer: null,
    retryTimer: null,
    viewerFetchTimer: null,
    pendingInstalls: {},
    pendingFooterActions: {},
    pendingFooterTargets: {},
    lastStats: null,
    lastVisibleModsKey: '',
    lastViewerFetchKey: '',
    defaultFiltersApplied: false,
    hideTranslationsApplied: false,
    gameNumericId: 0,
    clientHideTranslations: true,
    preferHideTranslations: true,
    browsePathname: '',
    controlsRemountTimers: [],
    modEnrichmentCache: {},
    lastEnrichmentFetchKey: '',
    enrichmentFetchTimer: null,
    filtersOpenAttempts: 0,
    forceDefaultFilters: true,
    translationUrlApplied: false,
    translationUrlPending: false,
    userDismissedTranslationFilter: false,
    lastBrowseGameSlug: '',
    translationDismissGuardTimer: null,
    translationDismissGuardStartedAt: 0,
    translationDismissedAt: 0,
    translationDismissNavPending: false,
    translationDismissHandsOffUntil: 0,
    carouselQuietUntil: 0,
    carouselQuietTimer: null,
    scanGeneration: 0,
    pendingPoolCleanup: false,
    nexusPageSizeTarget: 80,
    nexusPageSizePending: false,
    nexusPageSizeAttempts: 0,
    globalPageIndex: 0,
    batchPageIndex: 0,
    catalogModOffset: 0,
    batchVisibleHistory: [],
    tilePool: [],
    poolSessionKey: '',
    pendingPoolFetch: false,
    pendingTargetPage: null,
    pendingNexusBatchAdvance: false,
    pendingBatchPageIndex: null,
    pendingBatchPrefetch: false,
    prefetchBatchInFlight: false,
    fetchInFlightPage: null,
    fetchedNexusPages: {},
    nativeMergedPages: {},
    nativeNavFetchInFlight: false,
    nativeNavFetchTargetPage: null,
    nativeNavFetchResolver: null,
    nativeNavFetchDeadline: 0,
    pendingNativeCatalogFetch: false,
    nativePoolRestorePromise: null,
    nativeNavFetchStartKey: '',
    carouselAdvancePending: false,
    dismissedBatchPrefetchInFlight: false,
    dismissedBatchPrefetchDone: false,
    dismissedPoolRestorePromise: null,
    dismissedPoolPagingActive: false,
    dismissedPoolPagingQuietUntil: 0,
    dismissedPrefetchDebounceTimer: null,
    filteredBrowseRescanTimer: null,
    filteredBrowsePoolSessionKey: '',
    filteredBrowseStableSessionKey: '',
    filteredBrowsePageOnePooled: false,
    filteredBrowseHostBatchInFlight: false,
    filteredBrowseHostBatchPhase: '',
    filteredBrowseHostBatchReturnUrl: '',
    filteredBrowseHostBatchResolver: null,
    filteredBrowseHostBatchTimeoutId: null,
    filteredBrowseHostBatchDeadline: 0,
    dismissedPoolSnapshotTimer: null,
    applyingCarouselPage: false,
    catalogIndicesBootstrapped: false,
    catalogModIdToIndex: {},
    lastAppliedSliceKey: '',
    allowNexusPaginationClick: false,
    chromeHideWatchdogTimer: null,
    chromeHideDebounceTimer: null,
    lastDomBatchKey: '',
    liveCarouselMode: false,
    liveCarouselTimer: null,
    lastCarouselConfigKey: '',
    lastGridConfigKey: '',
    lastFilterCarouselConfigKey: '',
    localCatalogBootstrapped: false,
    trackedCatalogFetchGeneration: 0,
    autoAdvanceEnabled: false,
    autoAdvanceMs: 8000,
    autoAdvanceTimer: null,
    cacheFetchAttempts: 0,
    cacheFetchInFlight: false,
    browseDetailHandsOff: false,
    savedListSessionKey: '',
    savedListScrollY: null,
    filteredFillInFlight: false,
    filteredFillAttempts: 0,
    trackedCatalogActive: false,
    trackedCatalogKey: '',
    trackedCatalogSourceKey: '',
    trackedCatalogFilterKey: '',
    catalogTileByModId: {},
    trackedCatalogLoadedPage: -1,
    trackedCatalogFetchInFlight: false,
    trackedCatalogFetchAttempts: 0,
    trackedCatalogPageCache: {},
    trackedSessionFetchInFlight: false,
    trackedSessionFetched: false,
    trackedListHydrated: false,
    filterUiLockUntil: 0,
    suppressFilterEvents: false,
    nexusFilterCooldownUntil: 0,
    domFilterBrowseActive: false,
    filteredBrowseEngaged: false,
    controlsPinnedFilterRow: null,
    controlsPinnedSortRow: null,
    nexusFilteredTotalsCaptured: false,
    nexusFilteredResultsTotal: 0,
    nexusFilteredMatchingTotal: 0,
    nexusFilteredDisplayTotalLocked: 0,
    nexusFilteredGraphqlTotal: 0,
    hadNumericNexusBrowseFilters: false,
    refreshingDomFilteredBrowseState: false,
    syncingFilteredHeadlinePass: false,
    filteredBrowseLightScanInFlight: false,
    numericFilteredHeadlineSyncTimer: null,
    nexusFilteredGraphqlTotalSessionKey: '',
    filteredBrowseTotalFetchInFlight: false,
    filteredBrowseTotalFetchTimer: null,
    resolvingDomActiveFilters: false,
    syncingFilteredHeadlines: false,
    filteredHeadlineSyncTimer: null,
    userWantsNexusFiltersOpen: false,
    nativeFilterCleanupScheduled: false,
    nexusFilterApplyInFlight: false,
    nexusFilterApplyStartUrl: '',
    nexusFilterRefreshTimer: null,
    nexusModGridRef: null,
    oopsRecoveryInFlight: false,
    oopsRecoveryAttempts: 0,
    oopsRecoveryStartedAt: 0,
    localCatalogNavLock: false,
    oopsWatchdogTimer: null,
    lastGoodBrowseUrl: '',
    pendingNexusFilterUrl: '',
    enhancementFullyPaused: false,
    optimisticFilters: {},
    trackedPageRetryAttempts: 0,
    pendingModTileRequests: {},

    notifyBrowseContextChange: function () {
      beginCarouselQuietPeriod();
    },

    releaseAuthPage: function () {
      clearAuthPageEnhancement();
      return { released: true };
    },

    setTabActive: function (active) {
      if (active) {
        enhancer.enhancementFullyPaused = false;
        if (window.__vortexBrowseEnhancer) {
          window.__vortexBrowseEnhancer.scheduleScan(true);
        }
        return { active: true };
      }

      enhancer.enhancementFullyPaused = true;
      stopAutoAdvance();
      return { active: false };
    },

    finalizeBrowseContextTransition: function () {
      refreshDomFilteredBrowseState();
      if ((enhancer.userDismissedTranslationFilter || urlHasActiveNexusFilters() ||
          hasDomActiveNexusFilters() || hasSidebarDownloadsFilterApplied() ||
          (this.config && (this.config.filterBrowseActive || isFilteredBrowseSession(this.config)))) &&
          isBrowseModsListPathname(getBrowsePathname())) {
        try {
          clearCarouselQuietPeriod();
          if (enhancer.userDismissedTranslationFilter) {
            syncDismissedFilterBrowseState();
          }
          if (this.config && this.config.hideSiteChrome) {
            applyDismissedBrowseHideChrome(this.config);
          }
          if (isDismissedCarouselBrowseMode(this.config || {})) {
            prepareDismissedCarouselBrowse(this.config || {});
          }
          if (this.config && shouldUseNumericFilteredBrowseScan(this.config)) {
            enhancer.domFilterBrowseActive = true;
            enhancer.filteredBrowseEngaged = true;
            var finalizePageSize = getCarouselPageSize(this.config);
            var finalizeCatalogLen = (enhancer.filteredCarouselCatalog || []).length;
            if (finalizeCatalogLen >= finalizePageSize &&
                this.lastStats && this.lastStats.tileCount >= finalizePageSize) {
              updateMinimalCarouselControlsInline(
                this.config,
                enhancer.filteredCarouselCatalog,
                getLockedNexusFilteredDisplayTotal() || finalizeCatalogLen
              );
            } else {
              this.lastStats = executeMinimalNumericFilteredBrowseScan(this.config);
            }
            try {
              ensureCarouselControlsBar();
            } catch (errFinalizeControls) {
              // ignore
            }
          } else if (this.config && shouldUseFilteredBrowseLightScan(this.config)) {
            this.lastStats = executeFilteredBrowseLightScan(this.config);
          } else {
            this.scheduleScan(true);
          }
          ensureNexusFiltersPanelStayOpen();
        } catch (errFinalizeFiltered) {
          if (this.config && shouldUseNumericFilteredBrowseScan(this.config)) {
            try {
              this.lastStats = executeMinimalNumericFilteredBrowseScan(this.config);
            } catch (errFinalizeNumeric) {
              logErrorToHost('finalize numeric browse failed', {
                error: String(errFinalizeNumeric && errFinalizeNumeric.message || errFinalizeNumeric),
              });
            }
          } else if (!(this.config && isFilteredBrowseSession(this.config) && shouldUseFilteredBrowseLightScan(this.config))) {
            this.scheduleScan(true);
          }
        }
        return;
      }
      enhancer.carouselQuietUntil = 0;
      if (enhancer.carouselQuietTimer) {
        clearTimeout(enhancer.carouselQuietTimer);
        enhancer.carouselQuietTimer = null;
      }
      if (enhancer.pendingPoolCleanup) {
        cleanupPoolArtifacts(true);
        enhancer.pendingPoolCleanup = false;
      }
      if (this.config && isActiveLocalCatalogMode()) {
        ensureLocalCatalogInitialized(this.config);
        clearLocalCatalogBootstrap();
        applyTrackedCatalogView(this.config);
        return;
      }
      this.scheduleScan(true);
    },

    receiveModTiles: function (requestId, nodes) {
      enhancer.pendingModTileRequests = enhancer.pendingModTileRequests || {};
      var resolve = enhancer.pendingModTileRequests[requestId];
      if (!resolve) {
        return;
      }
      delete enhancer.pendingModTileRequests[requestId];
      resolve(Array.isArray(nodes) ? nodes : []);
    },

    update: function (nextConfig) {
      if (isNexusAuthPage()) {
        clearAuthPageEnhancement();
        return this.lastStats || emptyScanStats(this.config);
      }
      if (enhancer.optimisticFilters && nextConfig) {
        var optimisticNames = ['hideInstalled', 'onlyInstalled', 'hideTracked', 'onlyTracked'];
        optimisticNames.forEach(function (name) {
          if (Object.prototype.hasOwnProperty.call(enhancer.optimisticFilters, name)) {
            nextConfig[name] = enhancer.optimisticFilters[name];
          }
        });
      }

      if (nextConfig && enhancer.config && enhancer.filterUiLockUntil && Date.now() < enhancer.filterUiLockUntil) {
        var filters = ['hideInstalled', 'onlyInstalled', 'hideTracked', 'onlyTracked'];
        filters.forEach(function (name) {
          if (Object.prototype.hasOwnProperty.call(enhancer.config, name) &&
              !!enhancer.config[name] !== !!nextConfig[name]) {
            nextConfig[name] = enhancer.config[name];
          }
        });
      }

      var prevConfig = enhancer.config;
      var prevCatalogKey = prevConfig && isLocalCatalogMode(prevConfig) ? getTrackedCatalogKey(prevConfig) : '';
      var nextCatalogKey = nextConfig && isLocalCatalogMode(nextConfig) ? getTrackedCatalogKey(nextConfig) : '';
      var catalogKeyChanged = prevCatalogKey !== nextCatalogKey;

      if (nextConfig && prevConfig && nextConfig.onlyTracked) {
        var prevTracked = prevConfig.tracked || {};
        var nextTracked = nextConfig.tracked || {};
        var prevCount = countRawTrackedMods(prevConfig);
        var nextCount = countRawTrackedMods(nextConfig);
        if (prevCount > nextCount) {
          nextConfig.tracked = Object.assign({}, nextTracked, prevTracked);
        }
        if (nextCount > 0 && nextCount >= prevCount) {
          enhancer.awaitingHostTrackedListUntil = 0;
        }
        rememberTrackedResultsTotal(nextConfig);
        var pinnedCatalogTotal = getLocalCatalogHeadlineTotal(nextConfig);
        if (pinnedCatalogTotal > 0) {
          enhancer.nexusCatalogTotal = pinnedCatalogTotal;
        }
        syncNexusResultsHeadline(nextConfig);
      } else if (nextConfig && isLocalCatalogMode(nextConfig)) {
        rememberTrackedResultsTotal(nextConfig);
        syncNexusResultsHeadline(nextConfig);
      } else if (nextConfig && !nextConfig.onlyTracked && prevConfig && prevConfig.onlyTracked) {
        syncNexusResultsHeadline(nextConfig);
      }

      this.config = nextConfig || this.config;
      var self = this;

      rememberTrackedResultsTotal(this.config);

      if (enhancer.optimisticFilters && self.config) {
        var confirmNames = ['hideInstalled', 'onlyInstalled', 'hideTracked', 'onlyTracked'];
        confirmNames.forEach(function (name) {
          if (Object.prototype.hasOwnProperty.call(enhancer.optimisticFilters, name) &&
              !!self.config[name] === !!enhancer.optimisticFilters[name]) {
            delete enhancer.optimisticFilters[name];
          }
        });
      }

      if (nextConfig && nextConfig.applyDefaultFilters) {
        restoreTranslationDismissState();
        if (!enhancer.userDismissedTranslationFilter) {
          this.preferHideTranslations = true;
        } else {
          applyTranslationDismissRuntimeState();
        }
      }
      if (nextConfig && nextConfig.gameNumericId) {
        this.gameNumericId = nextConfig.gameNumericId;
      }
      if (nextConfig) {
        syncFilterPanelUiFromHost(nextConfig);
      }

      if (nextConfig && isLocalCatalogMode(nextConfig)) {
        if (catalogKeyChanged) {
          ensureLocalCatalogInitialized(nextConfig);
          if (!enhancer.localCatalogBootstrapped && !enhancer.trackedCatalogFetchInFlight) {
            applyTrackedCatalogView(nextConfig);
          }
          if (nextConfig.onlyTracked && !isTrackedCatalogReady(nextConfig)) {
            this.scheduleScan(true);
            return this.lastStats || emptyScanStats(this.config);
          }
        } else if (enhancer.localCatalogBootstrapped) {
          syncPoolEntryMetadata(nextConfig);
          applyPoolFilterClasses(nextConfig);
          if (isTrackedCatalogReady(nextConfig)) {
            showTrackedCatalogPage(nextConfig);
            decorateVisibleCarouselSlice(collectCards(nextConfig), nextConfig);
          }
          return this.lastStats || emptyScanStats(this.config);
        } else if (!enhancer.trackedCatalogFetchInFlight) {
          applyTrackedCatalogView(nextConfig);
          return this.lastStats || emptyScanStats(this.config);
        }
        if (enhancer.trackedCatalogFetchInFlight) {
          return this.lastStats || emptyScanStats(this.config);
        }
      }

      if (prevConfig && isLocalCatalogMode(prevConfig) && nextConfig && !isLocalCatalogMode(nextConfig)) {
        enhancer.trackedCatalogActive = false;
        restoreLiveBrowseGridAfterCatalog(nextConfig);
      }

      if (isBrowseEnhancementPaused()) {
        return this.lastStats || emptyScanStats(this.config);
      }
      if (enhancer.trackedCatalogFetchInFlight && nextConfig && isLocalCatalogMode(nextConfig)) {
        if (nextConfig.onlyTracked && !isTrackedCatalogReady(nextConfig)) {
          this.scheduleScan(true);
          return this.lastStats || emptyScanStats(this.config);
        }
        var prevTrackedCount = prevConfig ? getTrackedCatalogModIds(prevConfig).length : 0;
        var nextTrackedCount = getTrackedCatalogModIds(nextConfig).length;
        if (nextTrackedCount !== prevTrackedCount) {
          this.config = nextConfig;
          enhancer.pendingCatalogRescanAfterFetch = true;
          enhancer.warmedTrackedPage0 = null;
          enhancer.warmedTrackedPageKey = '';
        }
        return this.lastStats || emptyScanStats(this.config);
      }
      if (nextConfig && !isLocalCatalogMode(nextConfig)) {
        scheduleBackgroundTrackedCatalogWarm(nextConfig);
      }
      if (self.config && isFilteredBrowseSession(self.config)) {
        if (enhancer.filteredBrowseLightScanInFlight || enhancer.scanInProgress) {
          return attachHostLogs(self.lastStats || emptyScanStats(self.config), self.config);
        }
        try {
          scheduleFilteredBrowseConfigTouch(self.config, prevConfig, nextConfig);
        } catch (errUpdateFiltered) {
          logErrorToHost('update filtered config touch failed', {
            error: String(errUpdateFiltered && errUpdateFiltered.message || errUpdateFiltered),
          });
        }
        if (shouldUseFilteredBrowseLightScan(self.config)) {
          try {
            self.lastStats = executeFilteredBrowseLightScan(self.config);
          } catch (errFilteredLightUpdate) {
            logErrorToHost('filtered update light scan failed', {
              error: String(errFilteredLightUpdate && errFilteredLightUpdate.message || errFilteredLightUpdate),
            });
            self.lastStats = self.lastStats || emptyScanStats(self.config);
          }
          return attachHostLogs(self.lastStats, self.config);
        }
        if (shouldUseNumericFilteredBrowseScan(self.config)) {
          var numericPageSize = getCarouselPageSize(self.config);
          var numericCatalogLen = (enhancer.filteredCarouselCatalog || []).length;
          if (numericCatalogLen >= numericPageSize &&
              self.lastStats && self.lastStats.tileCount >= numericPageSize) {
            updateMinimalCarouselControlsInline(
              self.config,
              enhancer.filteredCarouselCatalog,
              getLockedNexusFilteredDisplayTotal() || numericCatalogLen
            );
            return attachHostLogs(self.lastStats, self.config);
          }
          try {
            self.lastStats = executeNumericFilteredBrowseScan(self.config);
          } catch (errNumericUpdate) {
            logErrorToHost('numeric filtered update scan failed', {
              error: String(errNumericUpdate && errNumericUpdate.message || errNumericUpdate),
            });
            self.lastStats = self.lastStats || emptyScanStats(self.config);
          }
          return attachHostLogs(self.lastStats, self.config);
        }
        scheduleNumericFilteredHeadlineSync();
      }
      return attachHostLogs(this.scheduleScan(true), self.config);
    },

    scheduleViewerStateFetch: function (modIds) {
      var self = this;
      var key = (modIds || []).join(',');
      if (!key || key === self.lastViewerFetchKey) {
        return;
      }

      self.lastViewerFetchKey = key;

      if (self.viewerFetchTimer) {
        clearTimeout(self.viewerFetchTimer);
      }

      self.viewerFetchTimer = setTimeout(function () {
        self.viewerFetchTimer = null;
        fetchViewerModState(self.config, modIds).then(function (state) {
          if (!state) {
            return;
          }

          var tracked = state.tracked || {};
          var endorsed = state.endorsed || {};
          var downloaded = state.downloaded || {};

          if (Object.keys(tracked).length === 0 &&
              Object.keys(endorsed).length === 0 &&
              Object.keys(downloaded).length === 0) {
            return;
          }

          self.config.tracked = Object.assign({}, self.config.tracked || {}, tracked);
          self.config.endorsed = Object.assign({}, self.config.endorsed || {}, endorsed);
          self.config.viewerDownloaded = Object.assign({}, self.config.viewerDownloaded || {}, downloaded);
          sendToHost({
            type: 'viewer-state',
            tracked: tracked,
            endorsed: endorsed,
            downloaded: downloaded,
          });
          self.scheduleScan(true);
        });
      }, 500);
    },

    scheduleScan: function (immediate) {
      var self = this;

      if (isBrowseEnhancementPaused()) {
        return self.lastStats || emptyScanStats(self.config);
      }

      if (isTranslationDismissNavigationPending()) {
        setTimeout(function () {
          if (window.__vortexBrowseEnhancer) {
            window.__vortexBrowseEnhancer.scheduleScan(true);
          }
        }, 450);
        return self.lastStats || emptyScanStats(self.config);
      }

      if (self.debounceTimer) {
        clearTimeout(self.debounceTimer);
      }

      if (immediate) {
        if (self.scanInProgress) {
          return attachHostLogs(self.lastStats || emptyScanStats(self.config), self.config);
        }
        try {
          self.lastStats = executeBrowseScan(self.config);
        } catch (errScanNow) {
          logErrorToHost('scan immediate failed', {
            error: String(errScanNow && errScanNow.message || errScanNow),
            stack: String(errScanNow && errScanNow.stack || ''),
          });
          self.lastStats = self.lastStats || emptyScanStats(self.config);
        }
        self.scheduleRetryIfEmpty();
        return attachHostLogs(self.lastStats, self.config);
      }

      var debounceMs = 350;
      if (self.config && isFilteredBrowseSession(self.config)) {
        debounceMs = shouldUseFilteredBrowseLightScan(self.config) ? 1400 : 900;
      } else if (self.config && isLocalCatalogMode(self.config) && enhancer.trackedCatalogActive) {
        debounceMs = 150;
      } else if (self.config && self.config.onlyInstalled && !self.config.onlyTracked) {
        debounceMs = 900;
      }

      self.debounceTimer = setTimeout(function () {
        self.debounceTimer = null;
        try {
          self.lastStats = executeBrowseScan(self.config);
        } catch (errScanDebounced) {
          logErrorToHost('scan debounced failed', {
            error: String(errScanDebounced && errScanDebounced.message || errScanDebounced),
            stack: String(errScanDebounced && errScanDebounced.stack || ''),
          });
          self.lastStats = self.lastStats || emptyScanStats(self.config);
        }
        self.scheduleRetryIfEmpty();
      }, debounceMs);
      return attachHostLogs(self.lastStats || emptyScanStats(self.config), self.config);
    },

    scheduleRetryIfEmpty: function () {
      var self = this;
      if (self.retryTimer) {
        clearTimeout(self.retryTimer);
        self.retryTimer = null;
      }

      if (!self.lastStats || self.lastStats.tileCount > 0) {
        return;
      }

      var attempts = 0;
      function retry() {
        attempts++;
        try {
          if (self.config && shouldUseNumericFilteredBrowseScan(self.config)) {
            self.lastStats = executeMinimalNumericFilteredBrowseScan(self.config);
          } else if (self.config && shouldUseFilteredBrowseLightScan(self.config)) {
            self.lastStats = executeFilteredBrowseLightScan(self.config);
          } else {
            self.lastStats = executeBrowseScan(self.config);
          }
        } catch (errRetryScan) {
          logErrorToHost('scan retry failed', {
            error: String(errRetryScan && errRetryScan.message || errRetryScan),
            attempt: attempts,
          });
          self.lastStats = self.lastStats || emptyScanStats(self.config);
        }
        if (self.lastStats.tileCount > 0 || attempts >= 20) {
          self.retryTimer = null;
          return;
        }
        self.retryTimer = setTimeout(retry, 500);
      }

      self.retryTimer = setTimeout(retry, 500);
    },

    init: function () {
      var self = this;
      if (self.observer) {
        return;
      }
      self.observer = new MutationObserver(function (mutations) {
        if (enhancer.syncingFilteredHeadlines) {
          return;
        }
        if (recoverFromBrowseOopsIfNeeded()) {
          return;
        }
        if (isTranslationDismissNavigationPending()) {
          return;
        }
        if (enhancer.config && isLocalCatalogMode(enhancer.config) && enhancer.localCatalogBootstrapped) {
          return;
        }
        if (isBrowseEnhancementPaused()) {
          return;
        }
        if (enhancer.enhancementFullyPaused) {
          return;
        }
        if (enhancer.nexusFilterApplyInFlight) {
          return;
        }
        if (enhancer.nexusFilterCooldownUntil && Date.now() < enhancer.nexusFilterCooldownUntil &&
            !(enhancer.userDismissedTranslationFilter && isTranslationDismissHandsOff()) &&
            !urlHasActiveNexusFilters()) {
          return;
        }
        if (enhancer.applyingCarouselPage || enhancer.dismissedPoolPagingActive) {
          return;
        }
        if (enhancer.dismissedPoolPagingQuietUntil && Date.now() < enhancer.dismissedPoolPagingQuietUntil) {
          return;
        }
        if (enhancer.filteredNexusPageNavInFlight) {
          return;
        }
        if (enhancer.carouselPagingQuietUntil && Date.now() < enhancer.carouselPagingQuietUntil &&
            enhancer.config && isFilteredBrowseSession(enhancer.config) &&
            !mutationAddsLiveModTiles(mutations) && !gridVisibleTilesNeedDecoration(enhancer.config)) {
          return;
        }
        if (enhancer.trackedCatalogFetchInFlight && enhancer.trackedCatalogActive &&
            enhancer.config && isLocalCatalogMode(enhancer.config)) {
          return;
        }
        if (mutationTouchesOnlyEnhancerInternals(mutations)) {
          return;
        }
        if (shouldUseNumericFilteredBrowseScan(enhancer.config)) {
          if (enhancer.minimalNumericScanInProgress) {
            return;
          }
          if (enhancer.carouselPagingQuietUntil && Date.now() < enhancer.carouselPagingQuietUntil) {
            return;
          }
          var stableCatalogLen = (enhancer.filteredCarouselCatalog || []).length;
          var stablePageSize = getCarouselPageSize(enhancer.config || {});
          if (stableCatalogLen >= stablePageSize && !mutationAddsLiveModTiles(mutations)) {
            return;
          }
          if (enhancer.numericMutationRescanTimer) {
            clearTimeout(enhancer.numericMutationRescanTimer);
          }
          enhancer.numericMutationRescanTimer = setTimeout(function () {
            enhancer.numericMutationRescanTimer = null;
            if (!window.__vortexBrowseEnhancer ||
                !shouldUseNumericFilteredBrowseScan(enhancer.config) ||
                enhancer.minimalNumericScanInProgress) {
              return;
            }
            if (enhancer.carouselPagingQuietUntil && Date.now() < enhancer.carouselPagingQuietUntil) {
              return;
            }
            try {
              enhancer.lastStats = executeMinimalNumericFilteredBrowseScan(enhancer.config);
            } catch (errNumericMutationRescan) {
              logErrorToHost('minimal numeric mutation rescan failed', {
                error: String(errNumericMutationRescan && errNumericMutationRescan.message || errNumericMutationRescan),
                step: enhancer.minimalNumericScanStep || '',
              });
            }
          }, 650);
          return;
        }
        if (enhancer.config && shouldUseFilteredBrowseLightScan(enhancer.config) &&
            !mutationAddsLiveModTiles(mutations) &&
            !gridVisibleTilesNeedDecoration(enhancer.config) &&
            !enhancer.nativeNavFetchInFlight && !enhancer.dismissedBatchPrefetchInFlight) {
          return;
        }
        mutations.forEach(function (mutation) {
          if (mutation.addedNodes) {
            for (var i = 0; i < mutation.addedNodes.length; i++) {
              hideBadgesInNode(mutation.addedNodes[i]);
            }
          }
        });
        if (enhancer.config && enhancer.config.hideSiteChrome && !isBrowseEnhancementPaused() &&
            !(enhancer.config && urlHasActiveNexusFilters() && shouldUseFilteredBrowseLightScan(enhancer.config))) {
          scheduleChromeHideRefresh();
        }
        self.scheduleScan(false);
      });
      self.observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });

      if (!enhancer.oopsWatchdogTimer) {
        enhancer.oopsWatchdogTimer = setInterval(function () {
          recoverFromBrowseOopsIfNeeded();
        }, 2000);
      }

      if (!enhancer.startupEnhancementWatchdogTimer) {
        var startupWatchChecks = 0;
        enhancer.startupEnhancementWatchdogTimer = setInterval(function () {
          startupWatchChecks++;
          if (startupWatchChecks > 30 || !window.__vortexBrowseEnhancer) {
            clearInterval(enhancer.startupEnhancementWatchdogTimer);
            enhancer.startupEnhancementWatchdogTimer = null;
            return;
          }
          var cfg = enhancer.config;
          if (!cfg || !browseNeedsEnhancementRecovery(cfg)) {
            if (startupWatchChecks > 8 &&
                document.querySelector('.vortex-enhanced-carousel-host')) {
              clearInterval(enhancer.startupEnhancementWatchdogTimer);
              enhancer.startupEnhancementWatchdogTimer = null;
            }
            return;
          }
          recoverBrowseEnhancementIfNeeded(cfg);
          self.scheduleScan(true);
        }, 1000);
      }
    },

    getStats: function () {
      if (this.lastStats) {
        return this.lastStats;
      }
      if (shouldUseNumericFilteredBrowseScan(this.config)) {
        return executeNumericFilteredBrowseScan(this.config);
      }
      return executeBrowseScan(this.config);
    },
  };

  function installBrowseUrlWatcher() {
    if (window.__vortexBrowseEnhancerUrlWatch) {
      return;
    }
    window.__vortexBrowseEnhancerUrlWatch = true;
    var lastPathname = getBrowsePathname();
    var lastSessionKey = isBrowseModsListPathname(lastPathname) ? getBrowseSessionKey() : '';
    var lastBrowseHref = window.location.href;

    setInterval(function () {
      if (!window.__vortexBrowseEnhancer) {
        return;
      }

      var pathname = getBrowsePathname();
      var onList = isBrowseModsListPathname(pathname);
      var onDetail = isBrowseModDetailPathname(pathname);
      var nextSessionKey = getBrowseSessionKey();
      var prevPathname = lastPathname;
      var prevWasList = isBrowseModsListPathname(prevPathname);

      if (pathname === prevPathname && (!onList || nextSessionKey === lastSessionKey)) {
        if (onDetail && !enhancer.browseDetailHandsOff) {
          enterBrowseDetailHandsOffMode();
        }
        return;
      }

      if (prevWasList && onDetail) {
        if (!enhancer.savedListSessionKey && lastSessionKey) {
          enhancer.savedListSessionKey = lastSessionKey;
        }
        if (lastSessionKey) {
          saveCarouselPagingStateForKey(lastSessionKey);
        }
        enterBrowseDetailHandsOffMode();
        lastPathname = pathname;
        lastSessionKey = nextSessionKey;
        return;
      }

      if (onDetail) {
        enterBrowseDetailHandsOffMode();
        lastPathname = pathname;
        lastSessionKey = nextSessionKey;
        return;
      }

      if (!onList) {
        lastPathname = pathname;
        lastSessionKey = nextSessionKey;
        lastBrowseHref = window.location.href;
        return;
      }

      var currentHref = window.location.href;
      if (currentHref !== lastBrowseHref) {
        if (translationFilterDroppedBetweenHrefs(lastBrowseHref, currentHref)) {
          acknowledgeUserTranslationFilterDismissal('url-watch');
          enhancer.translationDismissNavPending = false;
          enhancer.enhancementFullyPaused = false;
          startTranslationDismissGuard();
          if (window.__vortexBrowseEnhancer) {
            window.__vortexBrowseEnhancer.scheduleScan(true);
          }
        }
        var paginationOnlyHrefChange = isNexusPaginationOnlyHrefChange(lastBrowseHref, currentHref);
        var translationFilterHrefDrop = translationFilterDroppedBetweenHrefs(lastBrowseHref, currentHref);
        if (!paginationOnlyHrefChange &&
            !translationFilterHrefDrop &&
            !enhancer.nexusFilterApplyInFlight &&
            (urlHasActiveNexusFilters(currentHref) || urlHasActiveNexusFilters(lastBrowseHref))) {
          enhancer.nexusFilterCooldownUntil = Date.now() + (urlHasActiveNexusFilters(currentHref) ? 4000 : 25000);
          if (!enhancer.config || !enhancer.config.onlyTracked) {
            var filteredQuietMs = urlHasActiveNexusFilters(currentHref) ? 600 : 8000;
            enhancer.carouselQuietUntil = Math.max(enhancer.carouselQuietUntil || 0, Date.now() + filteredQuietMs);
          }
        }
        var prevFilterSessionKey = getBrowseSessionKeyFromHref(lastBrowseHref);
        var nextFilterSessionKey = getBrowseSessionKeyFromHref(currentHref);
        if (!paginationOnlyHrefChange &&
            nextFilterSessionKey !== prevFilterSessionKey &&
            (urlHasActiveNexusFilters(currentHref) || urlHasActiveNexusFilters(lastBrowseHref))) {
          // This also covers removing the final filter. Clear pooled later-page
          // DOM before either the filtered or unfiltered scan takes over.
          prepareCarouselForNativeFilterChange();
        }
        if (nextFilterSessionKey !== prevFilterSessionKey &&
            urlHasActiveNexusFilters(currentHref) &&
            enhancer.lastHostFilterNotifyKey !== nextFilterSessionKey) {
          enhancer.lastHostFilterNotifyKey = nextFilterSessionKey;
          clearCarouselQuietPeriod();
          if (!enhancer.nexusFilterApplyInFlight) {
            // Nexus briefly exposes the new filtered count as "matching"
            // while retaining its full-catalog "results" label. Preserve the
            // new count before clearing totals for the changed session.
            var transitionTotals = scanNexusResultsTotalsFromDom();
            var transitionFilteredTotal = transitionTotals.matchingTotal > 0
              ? transitionTotals.matchingTotal
              : resolveFilteredBrowseDisplayTotal(
                transitionTotals.resultsTotal || 0,
                transitionTotals.matchingTotal || 0
              );
            resetFilteredBrowseCatalogState();
            resetFilteredBrowseTotalsState();
            if (transitionFilteredTotal > 0) {
              mergeNexusFilteredResultsTotal(transitionFilteredTotal);
              lockNexusFilteredDisplayTotal(transitionFilteredTotal);
            }
            traceStep('filter-session-total-preserved', {
              href: currentHref,
              resultsTotal: transitionTotals.resultsTotal || 0,
              matchingTotal: transitionTotals.matchingTotal || 0,
              preservedTotal: transitionFilteredTotal || 0,
            });
            enhancer.globalPageIndex = 0;
            enhancer.batchPageIndex = 0;
            enhancer.lastAppliedSliceKey = '';
            saveCarouselPagingState();
          }
          try {
            sendToHost({
              type: 'browse-navigate',
              url: stripInternalBrowseParams(currentHref),
              syncOnly: true,
            });
          } catch (errFilterHostNotify) {
            // ignore
          }
          scheduleFilteredBrowseConfigTouch(enhancer.config || {}, null, enhancer.config || {});
          if (window.__vortexBrowseEnhancer) {
            window.__vortexBrowseEnhancer.finalizeBrowseContextTransition();
          }
        }
        if (translationFilterHrefDrop) {
          clearCarouselQuietPeriod();
        }
        if (enhancer.nexusFilterApplyInFlight && currentHref !== enhancer.nexusFilterApplyStartUrl) {
          setTimeout(function () {
            releaseNexusFilterApplyWhenStable(0);
          }, 500);
        }
        lastBrowseHref = currentHref;
      }

      var returningFromDetail = isBrowseModDetailPathname(prevPathname) || enhancer.browseDetailHandsOff;
      if (returningFromDetail) {
        exitBrowseDetailHandsOffMode();
        enhancer.pagingStateHydrated = false;
        enhancer.poolSessionKey = nextSessionKey;
        enhancer.filteredFillAttempts = 0;
        if (enhancer.savedListSessionKey) {
          restoreCarouselPagingStateForKey(enhancer.savedListSessionKey);
        } else {
          restoreCarouselPagingState();
        }
        enhancer.browsePathname = pathname;
        window.__vortexBrowseEnhancer.finalizeBrowseContextTransition();
      } else if (prevWasList && nextSessionKey !== lastSessionKey) {
        var translationOnlySessionChange =
          translationFilterRemovedBetweenSessionKeys(lastSessionKey, nextSessionKey) ||
          sessionKeyChangeIsTranslationOnly(lastSessionKey, nextSessionKey);
        if (translationFilterRemovedBetweenSessionKeys(lastSessionKey, nextSessionKey)) {
          acknowledgeUserTranslationFilterDismissal('session-watch');
        }
        if (translationOnlySessionChange) {
          handleTranslationOnlyBrowseSessionChange(nextSessionKey);
        } else {
          resetGlobalPagingSoft();
          resetTranslationFilters();
          enhancer.poolSessionKey = nextSessionKey;
          enhancer.filteredFillAttempts = 0;
          if (isActiveLocalCatalogMode()) {
            enhancer.globalPageIndex = 0;
            enhancer.trackedCatalogLoadedPage = -1;
            enhancer.trackedCatalogPageCache = {};
            enhancer.lastAppliedSliceKey = '';
            clearLocalCatalogBootstrap();
            ensureLocalCatalogInitialized(enhancer.config || {});
            applyTrackedCatalogView(enhancer.config || {});
          } else if (!isCarouselQuietPeriod() && !enhancer.nexusFilterApplyInFlight &&
                     !urlHasActiveNexusFilters()) {
            beginCarouselQuietPeriod();
          } else if (urlHasActiveNexusFilters()) {
            enhancer.globalPageIndex = 0;
            enhancer.batchPageIndex = 0;
            enhancer.lastAppliedSliceKey = '';
            saveCarouselPagingState();
            clearCarouselQuietPeriod();
            if (window.__vortexBrowseEnhancer) {
              window.__vortexBrowseEnhancer.scheduleScan(true);
            }
          }
        }
      } else if (!prevWasList) {
        enhancer.poolSessionKey = nextSessionKey;
        enhancer.pagingStateHydrated = false;
      }

      enhancer.browsePathname = pathname;
      lastPathname = pathname;
      lastSessionKey = nextSessionKey;
    }, 400);
  }

  function installNexusActiveFilterDismissCapture() {
    if (window.__vortexBrowseEnhancerActiveFilterDismissCapture) {
      return;
    }
    window.__vortexBrowseEnhancerActiveFilterDismissCapture = true;

    document.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) {
        return;
      }
      if (!isBrowseModsListPathname(getBrowsePathname())) {
        return;
      }

      var clearEl = event.target.closest('.vortex-enhanced-nexus-clear-all, a, button, [role="button"]');
      if (clearEl && isClearAllControl(clearEl) && isInMainBrowseColumn(clearEl)) {
        acknowledgeUserTranslationFilterDismissal('clear-all-capture');
        return;
      }

      if (isTranslationFilterChipNode(event.target)) {
        acknowledgeUserTranslationFilterDismissal('chip-capture');
      }
    }, true);
  }

  function installNexusActiveFilterPointerFallback() {
    if (window.__vortexBrowseEnhancerActiveFilterPointerFallback) {
      return;
    }
    window.__vortexBrowseEnhancerActiveFilterPointerFallback = true;

    document.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) {
        return;
      }
      if (!isBrowseModsListPathname(getBrowsePathname())) {
        return;
      }

      var row = document.querySelector('.vortex-enhanced-nexus-active-filters');
      if (!row) {
        return;
      }

      var x = event.clientX;
      var y = event.clientY;
      var rowRect = row.getBoundingClientRect();
      if (x < rowRect.left || x > rowRect.right || y < rowRect.top || y > rowRect.bottom) {
        return;
      }

      if (event.target.closest('.vortex-enhanced-nexus-active-filters, .vortex-enhanced-nexus-clear-all')) {
        return;
      }

      var controls = row.querySelectorAll(
        'button, a, [role="button"], .vortex-enhanced-nexus-clear-all'
      );
      for (var i = 0; i < controls.length; i++) {
        var control = controls[i];
        var controlRect = control.getBoundingClientRect();
        if (x < controlRect.left || x > controlRect.right ||
            y < controlRect.top || y > controlRect.bottom) {
          continue;
        }

        noteNexusActiveFilterUserAction(event);

        var actionTarget = resolveNexusFilterChipActionTarget(control, row) ||
          control.closest('button, a, [role="button"]') ||
          control;
        event.preventDefault();
        event.stopPropagation();
        triggerNativeFilterControlClick(actionTarget);
        return;
      }
    }, true);
  }

  function installModTileNavigationHandler() {
    if (window.__vortexBrowseEnhancerModNav) {
      return;
    }
    window.__vortexBrowseEnhancerModNav = true;

    document.addEventListener('click', function (event) {
      if (!isBrowseModsListPathname(getBrowsePathname())) {
        return;
      }

      var link = event.target.closest('a[href*="/mods/"]');
      if (!link || !link.href) {
        return;
      }
      if (link.closest('.vortex-enhanced-carousel-controls, .vortex-enhanced-footer-row, .vortex-enhanced-actions, [data-vortex-enhanced-filters="true"]')) {
        return;
      }

      var modId = parseModIdFromUrl(link.href);
      if (!modId) {
        return;
      }

      enhancer.savedListSessionKey = getBrowseSessionKey();
      enhancer.savedListScrollY = window.scrollY || 0;
      saveCarouselPagingStateForKey(enhancer.savedListSessionKey);
    }, true);
  }

  noteBrowseGameContext(getBrowsePathname());
  restoreTranslationDismissState();
  enhancer.init();
  installBrowseUrlWatcher();
  installNexusActiveFilterDismissCapture();
  installNexusActiveFilterPointerFallback();
  installModTileNavigationHandler();
  enhancer.showToast = showNexusStyleToast;
  enhancer.clearPending = function (action, modId) {
    setFooterActionPending(action, modId, false);
    this.scheduleScan(true);
  };
  enhancer.reattachDocumentHooks = reattachDocumentHooks;
  window.__vortexBrowseEnhancer = enhancer;
  ensureStyles();
  reattachDocumentHooks();

  function beginInstall(btn) {
    var modId = parseInt(btn.getAttribute('data-mod-id'), 10);
    if (!modId || btn.disabled || enhancer.pendingInstalls[String(modId)]) {
      return false;
    }

    enhancer.pendingInstalls[String(modId)] = true;
    btn.disabled = true;
    btn.textContent = 'Starting...';
    sendToHost({ type: 'install-mod', modId: modId });

    setTimeout(function () {
      delete enhancer.pendingInstalls[String(modId)];
    }, 3000);

    return true;
  }

  if (!window.__vortexBrowseEnhancerInstallClick) {
    window.__vortexBrowseEnhancerInstallClick = true;
    document.addEventListener('pointerdown', function (event) {
      var btn = event.target.closest('.vortex-enhanced-install');
      if (!btn || event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      beginInstall(btn);
    }, true);

    document.addEventListener('click', function (event) {
      var btn = event.target.closest('.vortex-enhanced-install');
      if (!btn) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  function handleTrackClick(btn) {
    var modId = parseInt(btn.getAttribute('data-mod-id'), 10);
    if (!modId || btn.disabled || isFooterActionPending('track', modId)) {
      return;
    }

    var currentlyTracked = btn.classList.contains('is-tracked');
    var nextTracked = !currentlyTracked;
    if (enhancer.config) {
      enhancer.config.tracked = Object.assign({}, enhancer.config.tracked || {}, {});
      if (nextTracked) {
        enhancer.config.tracked[String(modId)] = true;
      } else {
        delete enhancer.config.tracked[String(modId)];
      }
    }
    setFooterActionPending('track', modId, true, nextTracked);
    btn.disabled = true;
    btn.classList.add('is-pending');
    updateTrackButtonUi(btn, nextTracked);
    sendToHost({ type: 'toggle-track', modId: modId, tracked: currentlyTracked });
  }

  function handleEndorseClick(btn) {
    if (btn.disabled || btn.classList.contains('is-disabled')) {
      return;
    }

    var modId = parseInt(btn.getAttribute('data-mod-id'), 10);
    if (!modId || isFooterActionPending('endorse', modId)) {
      return;
    }

    var currentlyEndorsed = btn.classList.contains('is-endorsed');
    var nextEndorsed = !currentlyEndorsed;
    setFooterActionPending('endorse', modId, true, nextEndorsed);
    btn.disabled = true;
    btn.classList.add('is-pending');
    updateEndorseButtonUi(btn, modId, nextEndorsed);
    sendToHost({ type: 'toggle-endorse', modId: modId, endorsed: currentlyEndorsed });
  }

  if (!window.__vortexBrowseEnhancerFooterClick) {
    window.__vortexBrowseEnhancerFooterClick = true;

    document.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) {
        return;
      }

      var trackBtn = event.target.closest('.vortex-enhanced-track');
      if (trackBtn) {
        event.preventDefault();
        event.stopPropagation();
        handleTrackClick(trackBtn);
        return;
      }

      var endorseBtn = event.target.closest('.vortex-enhanced-endorse');
      if (!endorseBtn) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      handleEndorseClick(endorseBtn);
    }, true);

    document.addEventListener('click', function (event) {
      if (event.target.closest('.vortex-enhanced-track, .vortex-enhanced-endorse')) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  if (!window.__vortexBrowseEnhancerMouseNav) {
    window.__vortexBrowseEnhancerMouseNav = true;
    function handleMouseNav(event) {
      if (event.button === 3) {
        event.preventDefault();
        event.stopPropagation();
        window.history.back();
        return;
      }
      if (event.button === 4) {
        event.preventDefault();
        event.stopPropagation();
        window.history.forward();
      }
    }
    window.addEventListener('mouseup', handleMouseNav, true);
    window.addEventListener('auxclick', handleMouseNav, true);
  }

  if (!window.__vortexBrowseEnhancerNexusPagination) {
    window.__vortexBrowseEnhancerNexusPagination = true;
    document.addEventListener('click', function (event) {
      if (enhancer.allowNexusPaginationClick) {
        return;
      }
      if (event.target.closest('.vortex-enhanced-nexus-active-filters, .vortex-enhanced-nexus-clear-all')) {
        return;
      }
      var link = event.target.closest('a, button');
      if (!link || !isNexusResultsPagination(link)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }, true);
  }

  function exitLocalCatalogMode() {
    enhancer.trackedCatalogFetchGeneration = (enhancer.trackedCatalogFetchGeneration || 0) + 1;
    enhancer.filterUiLockUntil = 0;
    clearEnhancerLocks();
    enhancer.trackedCatalogFetchInFlight = false;
    enhancer.trackedCatalogLoadedPage = -1;
    enhancer.trackedPageRetryAttempts = 0;
    clearLocalCatalogBootstrap();
    enhancer.trackedCatalogKey = '';
    enhancer.trackedCatalogPageCache = {};
    if (enhancer.optimisticFilters) {
      delete enhancer.optimisticFilters.onlyTracked;
      delete enhancer.optimisticFilters.onlyInstalled;
    }

    var catalogGrid = document.getElementById('vortex-enhanced-catalog-grid');
    var poolHost = ensurePoolHost();
    if (catalogGrid && poolHost) {
      catalogGrid.querySelectorAll('[data-e2eid="mod-tile"]').forEach(function (tile) {
        tile.classList.add('vortex-enhanced-carousel-hidden');
        tile.style.setProperty('display', 'none', 'important');
        if (tile.parentElement !== poolHost) {
          poolHost.appendChild(tile);
        }
      });
    }
    clearTrackedCatalogTiles();

    var liveConfig = enhancer.config;
    restoreLiveBrowseGridAfterCatalog(liveConfig);

    if (window.__vortexBrowseEnhancer) {
      window.__vortexBrowseEnhancer.scheduleScan(true);
    }
  }

  function navigateNexusFilterInWebview(targetUrl) {
    if (!targetUrl || targetUrl.indexOf('nexusmods.com') < 0) {
      return false;
    }
    if (enhancer.userDismissedTranslationFilter) {
      targetUrl = buildUrlWithoutTranslationExcludedTag(targetUrl);
    }
    targetUrl = stripInternalBrowseParams(targetUrl);
    enhancer.nexusFilterApplyInFlight = true;
    enhancer.pendingNexusFilterUrl = targetUrl;
    enhancer.nexusFilterApplyStartUrl = window.location.href;
    enhancer.nexusFilterCooldownUntil = Date.now() + 30000;
    closeNexusFiltersPanel();
    try {
      window.location.replace(targetUrl);
    } catch (errNav) {
      try {
        window.location.href = targetUrl;
      } catch (errHref) {
        enhancer.nexusFilterApplyInFlight = false;
        enhancer.pendingNexusFilterUrl = '';
        return false;
      }
    }
    try {
      sendToHost({ type: 'browse-navigate', url: targetUrl, syncOnly: true });
    } catch (errHostSync) {
      // ignore
    }
    setTimeout(function () {
      releaseNexusFilterApplyWhenStable(0);
    }, 700);
    return true;
  }

  function exitOnlyTrackedMode() {
    exitLocalCatalogMode();
  }

  function applyLocalFilterState(filter, enabled) {
    if (!enhancer.config) {
      enhancer.config = {};
    }

    var config = enhancer.config;
    if (filter === 'hideInstalled') {
      config.hideInstalled = enabled;
      if (enabled) {
        config.onlyInstalled = false;
      }
    } else if (filter === 'onlyInstalled') {
      config.onlyInstalled = enabled;
      if (enabled) {
        config.hideInstalled = false;
      }
    } else if (filter === 'hideTracked') {
      config.hideTracked = enabled;
      if (enabled) {
        config.onlyTracked = false;
      }
    } else if (filter === 'onlyTracked') {
      config.onlyTracked = enabled;
      if (enabled) {
        config.hideTracked = false;
      }
    }
  }

  function isBrowseOopsPage() {
    if (!document.body) {
      return false;
    }
    var headings = document.querySelectorAll('h1, h2, h3, [role="heading"]');
    for (var i = 0; i < headings.length && i < 16; i++) {
      var headingText = normalizeUiText(headings[i].textContent || '');
      if (headingText.indexOf('oops') >= 0 || headingText.indexOf('something went wrong') >= 0) {
        return true;
      }
    }
    var roots = [
      document.getElementById('mainContent'),
      document.querySelector('main'),
      document.body,
    ];
    var seenRoot = {};
    for (var r = 0; r < roots.length; r++) {
      var root = roots[r];
      if (!root || seenRoot[root]) {
        continue;
      }
      seenRoot[root] = true;
      var sample = normalizeUiText(root.textContent || '');
      if (sample.length > 4000) {
        sample = sample.slice(0, 4000);
      }
      if (/oops!? something went wrong|something went wrong|unexpected error|try again later|page could not be loaded/i.test(sample)) {
        return true;
      }
    }
    return false;
  }

  function appendBrowseReloadParam(url) {
    try {
      var parsed = new URL(url);
      parsed.searchParams.set('_vortex_reload', String(Date.now()));
      return parsed.href;
    } catch (errReload) {
      return url;
    }
  }

  function resolveBrowseOopsRecoveryUrl() {
    var recoveryUrl = enhancer.pendingNexusFilterUrl ||
      (urlHasActiveNexusFilters(window.location.href) ? window.location.href : '') ||
      readNexusFilterFormUrl() ||
      enhancer.lastGoodBrowseUrl ||
      window.location.href;
    if (enhancer.userDismissedTranslationFilter) {
      recoveryUrl = buildUrlWithoutTranslationExcludedTag(recoveryUrl) || recoveryUrl;
    }
    return stripInternalBrowseParams(recoveryUrl);
  }

  function recoverDismissedBrowseOopsIfNeeded() {
    if (!isBrowseOopsPage() || !enhancer.userDismissedTranslationFilter) {
      return false;
    }
    if (urlHasActiveNexusFilters()) {
      return recoverFromBrowseOopsIfNeeded();
    }
    var now = Date.now();
    if (enhancer.oopsRecoveryInFlight && enhancer.oopsRecoveryStartedAt &&
        now - enhancer.oopsRecoveryStartedAt < 3000) {
      return true;
    }
    var attempts = enhancer.oopsRecoveryAttempts || 0;
    if (attempts >= 6) {
      return true;
    }
    enhancer.oopsRecoveryInFlight = true;
    enhancer.oopsRecoveryStartedAt = now;
    enhancer.oopsRecoveryAttempts = attempts + 1;
    clearEnhancerLocks();
    enhancer.translationDismissNavPending = false;
    enhancer.enhancementFullyPaused = false;
    var recoveryUrl = resolveBrowseOopsRecoveryUrl();
    navigateBrowseUrlViaHost(recoveryUrl);
    setTimeout(function () {
      enhancer.oopsRecoveryInFlight = false;
      if (window.__vortexBrowseEnhancer) {
        window.__vortexBrowseEnhancer.scheduleScan(true);
      }
    }, 1500);
    return true;
  }

  function recoverFromBrowseOopsIfNeeded() {
    if (!isBrowseOopsPage()) {
      enhancer.oopsRecoveryAttempts = 0;
      enhancer.oopsRecoveryInFlight = false;
      return false;
    }
    if (isTranslationFilterDismissedBrowse() && !urlHasActiveNexusFilters() &&
        !enhancer.pendingNexusFilterUrl) {
      return recoverDismissedBrowseOopsIfNeeded();
    }
    if (shouldDeferDismissLayoutCollapse() && !urlHasActiveNexusFilters() &&
        !enhancer.pendingNexusFilterUrl) {
      return false;
    }
    var now = Date.now();
    if (enhancer.oopsRecoveryInFlight && enhancer.oopsRecoveryStartedAt &&
        now - enhancer.oopsRecoveryStartedAt < 3000) {
      return true;
    }
    var attempts = enhancer.oopsRecoveryAttempts || 0;
    if (attempts >= 8) {
      return true;
    }
    enhancer.oopsRecoveryInFlight = true;
    enhancer.oopsRecoveryStartedAt = now;
    enhancer.oopsRecoveryAttempts = attempts + 1;
    if (shouldUseClientSideNumericFilterApply() ||
        (enhancer.stashedSidebarNumericFilters && enhancer.stashedSidebarNumericFilters.length)) {
      return recoverBrowseOopsViaClientSideNumeric();
    }
    var recoveryUrl = resolveBrowseOopsRecoveryUrl();
    var filterRecovery = urlHasActiveNexusFilters(recoveryUrl) &&
      (urlHasNumericNexusFilters(recoveryUrl) || hasNonDefaultNexusFilterChip());
    if (!filterRecovery) {
      recoveryUrl = appendBrowseReloadParam(recoveryUrl);
    }
    logToHost('browse oops detected in webview', {
      filterRecovery: filterRecovery,
      attempts: attempts + 1,
      filterApplyInFlight: !!enhancer.nexusFilterApplyInFlight,
    });
    clearEnhancerLocks();
    enhancer.nexusFilterApplyInFlight = false;
    enhancer.enhancementFullyPaused = false;
    enhancer.pendingNexusFilterUrl = recoveryUrl;
    if (filterRecovery) {
      try {
        window.location.replace(recoveryUrl);
      } catch (errFilterRecover) {
        try {
          window.location.href = recoveryUrl;
        } catch (errFilterHref) {
          navigateBrowseUrlViaHost(recoveryUrl, { syncOnly: true });
        }
      }
      try {
        sendToHost({ type: 'browse-navigate', url: recoveryUrl, syncOnly: true });
      } catch (errFilterRecoverHost) {
        // ignore
      }
    } else {
      navigateBrowseUrlViaHost(recoveryUrl);
    }
    setTimeout(function () {
      enhancer.oopsRecoveryInFlight = false;
      clearEnhancerLocks();
      if (window.__vortexBrowseEnhancer) {
        window.__vortexBrowseEnhancer.finalizeBrowseContextTransition();
        window.__vortexBrowseEnhancer.scheduleScan(true);
      }
    }, 1200);
    return true;
  }

  function scheduleNexusFilterFastRefresh(delayMs) {
    if (enhancer.nexusFilterRefreshTimer) {
      clearTimeout(enhancer.nexusFilterRefreshTimer);
      enhancer.nexusFilterRefreshTimer = null;
    }
    enhancer.nexusFilterRefreshTimer = setTimeout(function () {
      enhancer.nexusFilterRefreshTimer = null;
      if (isBrowseOopsPage()) {
        recoverFromBrowseOopsIfNeeded();
        return;
      }
      var targetUrl = stripInternalBrowseParams(buildNexusFilterApplyUrl());
      if (!targetUrl) {
        return;
      }
      navigateNexusFilterInWebview(targetUrl);
    }, typeof delayMs === 'number' ? delayMs : 600);
  }

  function buildNexusFilterApplyUrl() {
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('count', String(enhancer.nexusPageSizeTarget || 80));
      if (shouldApplyTranslationFilter()) {
        var tags = url.searchParams.getAll('excludedTag');
        if (tags.indexOf('Translation') < 0) {
          url.searchParams.append('excludedTag', 'Translation');
        }
      } else {
        var keptApplyTags = url.searchParams.getAll('excludedTag').filter(function (tag) {
          return !/translation/i.test(String(tag));
        });
        url.searchParams.delete('excludedTag');
        keptApplyTags.forEach(function (tag) {
          url.searchParams.append('excludedTag', tag);
        });
      }

      var panel = findNexusFilterAside();
      if (panel) {
        // A form's action does not include its current control values. Build
        // from the live URL and explicitly replace the adult state below.
        url.searchParams.delete('showAdultContent');
        url.searchParams.delete('adultContent');
        var inputs = panel.querySelectorAll('input[type="checkbox"], button[role="checkbox"], [role="checkbox"]');
        for (var i = 0; i < inputs.length; i++) {
          var input = inputs[i];
          var labelText = getNexusFilterInputLabel(input).toLowerCase();
          var checked = isNexusFilterInputChecked(input);
          if (!checked) {
            if (labelText.indexOf('show only adult') >= 0) {
              url.searchParams.delete('showAdultContent');
              url.searchParams.delete('adultContent');
            }
            continue;
          }

          if (labelText.indexOf('hide translation') >= 0 ||
              labelText.indexOf('no translation') >= 0 ||
              labelText.indexOf('exclude translation') >= 0) {
            continue;
          }

          if (labelText.indexOf('show only adult') >= 0) {
            url.searchParams.set('showAdultContent', 'true');
            url.searchParams.delete('adultContent');
            continue;
          }
          if (labelText.indexOf('hide adult') >= 0) {
            url.searchParams.set('adultContent', 'false');
            url.searchParams.delete('showAdultContent');
            continue;
          }
          if (labelText.indexOf('vortex') >= 0 && labelText.indexOf('support') >= 0) {
            url.searchParams.set('supportsVortex', 'true');
            continue;
          }
          if (labelText.indexOf('updated') >= 0 && labelText.indexOf('only') >= 0) {
            url.searchParams.set('hasUpdated', 'true');
            continue;
          }

          var sectionText = findNexusFilterSectionRoot(input, panel);
          var value = getNexusFilterInputLabel(input);
          if (!value) {
            continue;
          }

          if (sectionText.indexOf('categor') >= 0) {
            url.searchParams.append('categoryName', value);
          } else if (sectionText.indexOf('language') >= 0) {
            url.searchParams.append('languageName', value);
          } else if (sectionText.indexOf('tag') >= 0) {
            url.searchParams.append('tag', value);
          }
        }

        var titleInput = panel.querySelector('input[name="title"], input[placeholder*="Title"], input[aria-label="Title"]');
        var descInput = panel.querySelector('input[name="description"], input[placeholder*="Description"], input[aria-label="Description"]');
        if (titleInput && titleInput.value) {
          url.searchParams.set('title', titleInput.value.trim());
        }
        if (descInput && descInput.value) {
          url.searchParams.set('description', descInput.value.trim());
        }
      }

      url.searchParams.delete('page');
      url.searchParams.delete('offset');
      return finalizeNexusFilterApplyUrl(url.href);
    } catch (errApplyUrl) {
      return finalizeNexusFilterApplyUrl(window.location.href);
    }
  }

  function releaseNexusFilterApplyWhenStable(attempt) {
    if (!enhancer.nexusFilterApplyInFlight) {
      return;
    }

    var liveTiles = document.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').length;
    var poolTiles = document.querySelectorAll('#vortex-enhanced-pool-host [data-e2eid="mod-tile"]').length;
    var stable = liveTiles >= 4 || poolTiles >= 4;
    var urlChanged = enhancer.nexusFilterApplyStartUrl &&
      window.location.href !== enhancer.nexusFilterApplyStartUrl;
    var oopsPage = isBrowseOopsPage();

    if (oopsPage && attempt >= 3) {
      logToHost('filter apply landed on oops page', { attempt: attempt });
      recoverFromBrowseOopsIfNeeded();
      return;
    }
    if (oopsPage) {
      setTimeout(function () {
        releaseNexusFilterApplyWhenStable(attempt + 1);
      }, 250);
      return;
    }

    if (stable || (urlChanged && !oopsPage) || attempt >= 30) {
      enhancer.nexusFilterApplyInFlight = false;
      enhancer.enhancementFullyPaused = false;
      enhancer.nexusFilterApplyStartUrl = '';
      enhancer.pendingNexusFilterUrl = '';
      enhancer.carouselQuietUntil = 0;
      if (urlHasActiveNexusFilters()) {
        clearStaleFilteredBrowseFetchLocks();
      }
      restoreMainBrowseContentVisibility();
      if (!browseUrlHasRemovableActiveFilters()) {
        if (enhancer.userDismissedTranslationFilter) {
          syncDismissedFilterBrowseState();
        } else {
          finalizeDismissedFilterLayout();
        }
      }
      if (isBrowseModsListPathname(getBrowsePathname()) && !isBrowseOopsPage()) {
        try {
          enhancer.lastGoodBrowseUrl = window.location.href;
        } catch (errGoodFilterUrl) {
          // ignore
        }
      }
      var didFilteredEnhance = false;
      if (isNexusFilteredBrowse() && isBrowseModsListPathname(getBrowsePathname()) && !isBrowseOopsPage()) {
        var releaseConfig = enhancer.config || {};
        enhancer.domFilterBrowseActive = true;
        enhancer.filteredBrowseEngaged = true;
        refreshDomFilteredBrowseState();
        enhancer.globalPageIndex = 0;
        enhancer.batchPageIndex = 0;
        enhancer.lastAppliedSliceKey = '';
        if (shouldUseNumericFilteredBrowseScan(releaseConfig) || hasNumericNexusBrowseFilters()) {
          scheduleFilteredBrowseTotalFetch(releaseConfig);
          executeMinimalNumericFilteredBrowseScan(releaseConfig);
          didFilteredEnhance = true;
          logToHost('filter apply numeric minimal scan', {
            tiles: (enhancer.filteredCarouselCatalog || []).length,
          });
        } else {
          scheduleFilteredBrowseTotalFetch(releaseConfig);
          pinNexusFilteredResultsTotal();
          syncNexusFilteredResultsHeadlines();
          scheduleFilteredResultsHeadlineResync();
          resetFilteredCarouselCatalog();
          mergeIntoFilteredCarouselCatalog(collectLiveGridCards(releaseConfig), releaseConfig);
          if (enhancer.tilePool && enhancer.tilePool.length) {
            mergeIntoFilteredCarouselCatalog(collectCards(releaseConfig), releaseConfig);
          }
          applyFilteredNexusDirectPage(releaseConfig, { skipDecorationRetry: true });
          decorateVisibleFilteredCarouselTiles(releaseConfig);
          didFilteredEnhance = true;
        }
        try {
          sendToHost({
            type: 'browse-navigate',
            url: stripInternalBrowseParams(window.location.href),
            syncOnly: true,
          });
        } catch (errFilterReleaseHost) {
          // ignore
        }
      }
      if (window.__vortexBrowseEnhancer) {
        if (enhancer.userDismissedTranslationFilter) {
          prepareDismissedCarouselBrowse(enhancer.config || {});
          enhancer.lastAppliedSliceKey = '';
          enhancer.globalPageIndex = 0;
          enhancer.batchPageIndex = 0;
          window.__vortexBrowseEnhancer.scheduleScan(true);
        } else {
          window.__vortexBrowseEnhancer.finalizeBrowseContextTransition();
          if (!didFilteredEnhance) {
            window.__vortexBrowseEnhancer.scheduleScan(true);
          }
        }
      }
      return;
    }

    setTimeout(function () {
      if (liveTiles >= 4 || poolTiles >= 4) {
        try {
          decorateVisibleGridTiles(enhancer.config || {}, { forceAll: true });
        } catch (errEarlyDecorate) {
          // ignore
        }
      }
      releaseNexusFilterApplyWhenStable(attempt + 1);
    }, 200);
  }

  function isNexusSidebarApplyTarget(target) {
    if (!target || !target.closest) {
      return null;
    }
    var control = target.closest('button, input[type="submit"], [role="button"]');
    if (!control) {
      return null;
    }
    var filterPanel = control.closest('#filters-panel') || control.closest('aside');
    if (!filterPanel || filterPanel.closest('[data-vortex-enhanced-filters="true"]')) {
      return null;
    }
    var label = normalizeUiText(
      control.textContent ||
      control.getAttribute('aria-label') ||
      control.getAttribute('value') ||
      ''
    ).toLowerCase();
    if (label !== 'apply' &&
        label.indexOf('apply filter') !== 0 &&
        label !== 'apply filters') {
      return null;
    }
    return control;
  }

  function handleNexusSidebarFilterApply(event) {
    prepareCarouselForNativeFilterChange();
    enhancer.clientSideNumericFilterSkipKey = '';
    stashSidebarNumericFilters();
    var useClientSide = shouldUseClientSideNumericFilterApply();
    traceStep('nexus-filter-apply-intercept', {
      clientSide: useClientSide,
      stashed: (enhancer.stashedSidebarNumericFilters || []).length,
    });
    if (useClientSide) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
      }
      enhancer.nexusFilterCooldownUntil = Date.now() + 25000;
      enhancer.carouselQuietUntil = Math.max(enhancer.carouselQuietUntil || 0, Date.now() + 2000);
      enhancer.lastAppliedSliceKey = '';
      resetFilteredBrowseCatalogState();
      applySidebarNumericFiltersViaGraphql(enhancer.config);
      return true;
    }

    // buildNexusFilterApplyUrl serializes the live controls. A form action
    // alone contains no selected checkbox/input values.
    var targetUrl = buildNexusFilterApplyUrl();
    if (!targetUrl) {
      return false;
    }
    traceStep('nexus-filter-apply-url', {
      targetUrl: targetUrl,
      currentUrl: window.location.href,
    });

    enhancer.nexusFilterApplyInFlight = true;
    enhancer.nexusFilterApplyStartUrl = window.location.href;
    enhancer.pendingNexusFilterUrl = targetUrl;
    enhancer.nexusFilterCooldownUntil = Date.now() + 25000;
    enhancer.carouselQuietUntil = Math.max(enhancer.carouselQuietUntil || 0, Date.now() + 2000);
    enhancer.lastAppliedSliceKey = '';
    resetFilteredBrowseCatalogState();
    resetFilteredBrowseTotalsState();
    enhancer.carouselPagingQuietUntil = Date.now() + 8000;

    setTimeout(function () {
      releaseNexusFilterApplyWhenStable(0);
    }, 300);
    return true;
  }

  function ensureNexusFilterApplyCapture() {
    if (!markVortexDocumentHook('nexus-apply-capture')) {
      return;
    }
    document.addEventListener('pointerdown', function (event) {
      if (!isNexusSidebarApplyTarget(event.target)) {
        return;
      }
      noteNexusFilterPanelInteraction();
      handleNexusSidebarFilterApply(event);
    }, true);
    document.addEventListener('click', function (event) {
      if (!isNexusSidebarApplyTarget(event.target)) {
        return;
      }
      noteNexusFilterPanelInteraction();
      handleNexusSidebarFilterApply(event);
    }, true);
    document.addEventListener('submit', function (event) {
      var form = event.target;
      if (!form || !form.closest) {
        return;
      }
      var filterPanel = form.closest('#filters-panel') || form.closest('aside');
      if (!filterPanel || filterPanel.closest('[data-vortex-enhanced-filters="true"]')) {
        return;
      }
      noteNexusFilterPanelInteraction();
      handleNexusSidebarFilterApply(event);
    }, true);
  }

  function ensureCarouselControlClickCapture() {
    if (!markVortexDocumentHook('carousel-control-click')) {
      return;
    }
    document.addEventListener('click', function (event) {
      var carouselBtn = event.target.closest('.vortex-enhanced-carousel-btn[data-carousel]');
      if (!carouselBtn) {
        return;
      }
      // Buttons mounted by ensureCarouselControls have their own capture
      // handler. The document fallback must not process the same click too.
      if (carouselBtn.getAttribute('data-vortex-bound') === '1') {
        return;
      }
      var delta = parseInt(carouselBtn.getAttribute('data-carousel'), 10);
      if (delta) {
        event.preventDefault();
        if (shouldUseNumericFilteredBrowseScan(enhancer.config)) {
          advanceNumericFilteredCarouselPage(enhancer.config, delta);
        } else {
          advanceCarouselPage(delta);
        }
      }
    }, true);
  }

  function reattachDocumentHooks() {
    ensureNexusFilterInteractionCapture();
    ensureNexusFilterApplyCapture();
    ensureCarouselControlClickCapture();
    installCarouselWheelHandler();
  }

  if (!window.__vortexBrowseEnhancerFilterUi) {
    window.__vortexBrowseEnhancerFilterUi = true;
    document.addEventListener('change', function (event) {
      var input = event.target;
      if (!input || !input.getAttribute) {
        return;
      }

      if (input.matches('[data-auto-advance-toggle]')) {
        enhancer.autoAdvanceEnabled = !!input.checked;
        syncAutoAdvance(true);
        return;
      }

      if (input.matches('[data-auto-advance-speed]')) {
        enhancer.autoAdvanceMs = Math.max(1000, parseInt(input.value, 10) * 1000);
        syncAutoAdvanceUi();
        syncAutoAdvance(true);
        return;
      }

      if ((input.closest('#filters-panel') || input.closest('aside')) &&
          !input.closest('[data-vortex-enhanced-filters="true"]')) {
        noteNexusFilterPanelInteraction();
        enhancer.nexusFilterCooldownUntil = Date.now() + 8000;
        return;
      }

      if (enhancer.suppressFilterEvents) {
        return;
      }

      if (!input.getAttribute('data-filter')) {
        return;
      }
      if (!input.closest('[data-vortex-enhanced-filters="true"]')) {
        return;
      }

      var filter = input.getAttribute('data-filter');
      if (!filter) {
        return;
      }

      var enabled = !!input.checked;
      clearEnhancerLocks();
      enhancer.optimisticFilters = enhancer.optimisticFilters || {};
      enhancer.optimisticFilters[filter] = enabled;
      applyLocalFilterState(filter, enabled);
      enhancer.filterUiLockUntil = Date.now() + 8000;

      sendToHost({ type: 'filter-set', filter: filter, enabled: enabled });

      if (filter === 'onlyTracked' && !enabled) {
        enhancer.filterUiLockUntil = 0;
        exitLocalCatalogMode();
      } else if (filter === 'onlyInstalled' && !enabled) {
        enhancer.filterUiLockUntil = 0;
        exitLocalCatalogMode();
      } else if (filter === 'onlyTracked' && enabled) {
        enhancer.awaitingHostTrackedListUntil = Date.now() + 4000;
        enhancer.trackedSessionFetched = false;
        enhancer.filterUiLockUntil = Date.now() + 1500;
        if (enhancer.config) {
          enhancer.config.onlyTracked = true;
        }
        applyLocalCatalogFilterRefresh(enhancer.config);
      } else if (filter === 'onlyInstalled' && enabled) {
        if (enhancer.config) {
          enhancer.config.onlyInstalled = true;
        }
        applyLocalCatalogFilterRefresh(enhancer.config);
      } else if (enhancer.config && isLocalCatalogMode(enhancer.config)) {
        applyLocalCatalogFilterRefresh(enhancer.config);
      } else if (filter === 'hideInstalled' || filter === 'hideTracked') {
        if (enhancer.config) {
          refreshClientFilterCarousel(enhancer.config);
          if (window.__vortexBrowseEnhancer) {
            window.__vortexBrowseEnhancer.scheduleScan(true);
          }
        }
      }

    }, true);

    document.addEventListener('click', function (event) {
      var nexusFilterRoot = event.target.closest('#filters-panel') || event.target.closest('aside');
      if (nexusFilterRoot && !event.target.closest('[data-vortex-enhanced-filters="true"]')) {
        noteNexusFilterPanelInteraction();
      }

      var nexusFilterBtn = event.target.closest('button');
      if (nexusFilterBtn) {
        var filterLabel = (nexusFilterBtn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (filterLabel.indexOf('show filters') === 0 || filterLabel.indexOf('hide filters') === 0) {
          var openingFilters = filterLabel.indexOf('show filters') === 0;
          markNexusFiltersPanelOpen(openingFilters);
          [80, 260, 700, 1400].forEach(function (delayMs) {
            setTimeout(function () {
              if (openingFilters || isNexusFiltersPanelVisible()) {
                markNexusFiltersPanelOpen(true);
              }
              syncNexusFiltersState(enhancer.config);
              protectNexusActiveFiltersRow();
              if (enhancer.config && enhancer.config.hideSiteChrome) {
                applyHideSiteChrome(enhancer.config);
              }
              cleanupInvalidToolbarRows();
            }, delayMs);
          });
        }
      }

      var filterToggle = event.target.closest('.vortex-enhanced-filter-section-toggle');
      if (filterToggle) {
        var filterPanel = filterToggle.closest('[data-vortex-enhanced-filters="true"]');
        var body = filterPanel && filterPanel.querySelector('.vortex-enhanced-filter-body');
        if (body) {
          var collapsed = body.classList.toggle('vortex-enhanced-filter-body-collapsed');
          filterToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        }
        event.preventDefault();
        return;
      }

      var btn = event.target.closest('.vortex-enhanced-grid-btn');
      if (!btn) {
        return;
      }

      var panel = btn.closest('[data-vortex-enhanced-filters="true"]');
      if (!panel) {
        return;
      }

      var axis = btn.getAttribute('data-grid');
      var delta = parseInt(btn.getAttribute('data-delta'), 10);
      if (!axis || !delta) {
        return;
      }

      var display = panel.querySelector('[data-grid-display="' + axis + '"]');
      var current = display ? parseInt(display.textContent, 10) : (axis === 'columns' ? 8 : 4);
      if (!current) {
        current = axis === 'columns' ? 8 : 4;
      }

      var next = current + delta;
      if (axis === 'columns') {
        next = Math.max(4, Math.min(14, next));
        sendToHost({ type: 'grid-layout', columns: next });
      } else {
        next = Math.max(2, Math.min(8, next));
        sendToHost({ type: 'grid-layout', rows: next });
      }

      event.preventDefault();
    }, true);
  }

  if (!window.__vortexBrowseEnhancerSortNavigate) {
    window.__vortexBrowseEnhancerSortNavigate = true;

    document.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) {
        return;
      }

      var sortBtn = event.target.closest('button');
      if (sortBtn) {
        var sortBtnLabel = (sortBtn.getAttribute('aria-label') || sortBtn.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        if (sortBtnLabel === 'sort by') {
          enhancer.carouselQuietUntil = Date.now() + 6000;
          scheduleQuietPeriodEnd();
        }
      }

      var option = event.target.closest('[role="option"]');
      if (!option || !isNexusSortListboxOption(option)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      var sortParam = sortParamFromOptionLabel(option.textContent);
      if (sortParam === undefined) {
        return;
      }

        if (isActiveLocalCatalogMode()) {
        navigateBrowseSortOption(option);
        return;
      }

      var nextPath = buildBrowseUrlWithSort(sortParam);
      beginCarouselQuietPeriod();
      enhancer.poolSessionKey = getBrowseSessionKeyFromHref(nextPath);
      try {
        enhancer.browsePathname = new URL(nextPath, window.location.origin).pathname;
      } catch (errPath) {
        enhancer.browsePathname = getBrowsePathname();
      }
      enterLiveCarouselMode(8000);
      var scheduleDismissedChromeRefresh = function () {
        if (!enhancer.config || !enhancer.config.hideSiteChrome) {
          return;
        }
        if (isTranslationFilterDismissedBrowse()) {
          applyDismissedBrowseHideChrome(enhancer.config);
        } else {
          hideNexusChromeAboveGrid();
          hideNexusGameBannerStrip();
        }
      };
      try {
        sendToHost({
          type: 'browse-navigate',
          url: new URL(nextPath, window.location.origin).href,
        });
      } catch (errNav) {
        window.location.assign(nextPath);
      }
      [120, 400, 900, 1800].forEach(function (delay) {
        setTimeout(scheduleDismissedChromeRefresh, delay);
      });
    }, true);

    document.addEventListener('click', function (event) {
      var option = event.target.closest('[role="option"]');
      if (!option || !isNexusSortListboxOption(option)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }, true);
  }

})();
