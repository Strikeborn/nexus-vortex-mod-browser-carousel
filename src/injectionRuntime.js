(function () {
  if (window.__vortexBrowseEnhancer) {
    return;
  }

  var STYLE_ID = 'vortex-browse-enhancer-styles';
  var MARK = 'data-vortex-enhanced';
  var BRIDGE_PREFIX = '__VORTEX_ENHANCE__:';
  var GRAPHQL_URL = 'https://api-router.nexusmods.com/graphql';
  var MOD_ID_NUMERIC = /\/mods\/(\d+)(?:\/|$|\?|#)/;
  var MOD_ID_SLUG = /\/mods\/[^/]*-(\d+)(?:\/|$|\?|#)/;
  var MOD_SUBPAGE = new RegExp('/mods/[^/]+/(files|images|videos|posts|bugs|logs|stats|news)(?:/|$)');
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
    if (MOD_SUBPAGE.test(pathname)) {
      return true;
    }
    return !!parseModIdFromUrl(pathname);
  }

  function sendToHost(payload) {
    try {
      console.log(BRIDGE_PREFIX + JSON.stringify(payload));
    } catch (err) {
      console.error(BRIDGE_PREFIX + JSON.stringify({ type: 'error', message: 'bridge encode failed' }));
    }
  }

  function parseModIdFromUrl(url) {
    try {
      var pathname = new URL(url, window.location.origin).pathname;
      var numeric = pathname.match(MOD_ID_NUMERIC);
      if (numeric) {
        return parseInt(numeric[1], 10);
      }
      var slug = pathname.match(MOD_ID_SLUG);
      if (slug) {
        return parseInt(slug[1], 10);
      }
    } catch (err) {
      return null;
    }
    return null;
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
      if (MOD_SUBPAGE.test(href)) {
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
    var btn = findItemsPerPageButton();
    if (btn) {
      btn.classList.add('vortex-enhanced-browse-trim-hidden');
    }

    if (options.closeDropdowns) {
      closeOpenDropdowns();
    }

    document.querySelectorAll('[role="listbox"], [data-radix-popper-content-wrapper]').forEach(function (node) {
      var menuText = (node.textContent || '').toLowerCase();
      if (menuText.indexOf('items') >= 0 && /\b(20|40|60|80)\b/.test(menuText)) {
        node.classList.add('vortex-enhanced-browse-trim-hidden');
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
    url.searchParams.append('excludedTag', 'Translation');

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

    if (urlCount === targetSize && liveTiles < 8) {
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
        return true;
      }
    }
    return false;
  }

  function ensureNexusFiltersPanelOpenOnLoad(config) {
    if (enhancer.filtersPanelOpenApplied) {
      return;
    }
    if (!isNexusFiltersPanelOpen()) {
      openNexusFiltersPanel();
    }
    var aside = findNexusFilterAside();
    if (aside) {
      aside.classList.add('vortex-enhanced-nexus-filters-open');
      aside.classList.remove('vortex-enhanced-chrome-hidden');
      aside.classList.remove('vortex-enhanced-browse-trim-hidden');
    }
    var filtersPanel = document.getElementById('filters-panel');
    if (filtersPanel) {
      filtersPanel.classList.add('vortex-enhanced-nexus-filters-open');
      filtersPanel.classList.remove('vortex-enhanced-browse-trim-hidden');
    }
    if (isNexusFiltersPanelOpen() || aside || filtersPanel) {
      enhancer.filtersPanelOpenApplied = true;
    }
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

  function collapseNativeNexusFilterSections() {
    var aside = findNexusFilterAside() || document.getElementById('filters-panel');
    if (!aside) {
      return;
    }

    var contentRoot = findNativeContentOptionsRoot();

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
      btn.click();
    });

    expandNativeNexusContentOptions();
    setTimeout(expandNativeNexusContentOptions, 400);
    setTimeout(expandNativeNexusContentOptions, 1200);
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

  function findNexusFilterAside() {
    var filtersPanel = document.getElementById('filters-panel');
    if (filtersPanel && !filtersPanel.querySelector('[data-vortex-enhanced-filters="true"]')) {
      return filtersPanel;
    }

    var asides = document.querySelectorAll('aside');
    for (var i = 0; i < asides.length; i++) {
      if (asides[i].querySelector('[data-vortex-enhanced-filters="true"]')) {
        continue;
      }
      var text = (asides[i].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.indexOf('categories') >= 0 ||
          text.indexOf('hide translations') >= 0 ||
          text.indexOf('language support') >= 0 ||
          text.indexOf('tags') >= 0) {
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
      if (enhancer.clientHideTranslations || enhancer.forceDefaultFilters) {
        var tags = url.searchParams.getAll('excludedTag');
        if (!tags.some(function (tag) {
          return /translation/i.test(String(tag));
        })) {
          url.searchParams.append('excludedTag', 'Translation');
        }
      }
      url.searchParams.delete('page');
      url.searchParams.delete('offset');
      url.searchParams.delete('_vortex_reload');
      return url.href;
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
    var open = isNexusFiltersPanelOpen();
    var aside = findNexusFilterAside();

    if (aside) {
      aside.classList.toggle('vortex-enhanced-nexus-filters-open', open);
      aside.classList.remove('vortex-enhanced-chrome-hidden');
      aside.classList.remove('vortex-enhanced-browse-trim-hidden');
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
    collapseNativeNexusFilterSections();
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

  function syncNexusResultsHeadline(config) {
    if (!config) {
      return;
    }

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

      var useMatching = hasClientCarouselFilters(config) ||
        (isLocalCatalogMode(config) && (hasLocalCatalogData(config) || isOnlyTrackedLivePreview(config)));
      if (useMatching && effective > 0) {
        node.textContent = formatResultsCount(effective) + ' results';
      } else {
        var original = node.getAttribute('data-vortex-results-original');
        if (original) {
          node.textContent = original.replace(/\smatching$/i, ' results');
        }
      }
      return;
    }
  }

  function parseNexusResultsTotal() {
    var config = enhancer.config;
    if (config && isLocalCatalogMode(config)) {
      var catalogTotal = getLocalCatalogHeadlineTotal(config);
      if (catalogTotal > 0) {
        return catalogTotal;
      }
    }

    if (enhancer.nexusCatalogTotal && enhancer.nexusCatalogTotal > 0) {
      return enhancer.nexusCatalogTotal;
    }

    var headline = document.querySelector('[data-vortex-results-headline="true"]');
    if (headline) {
      var original = headline.getAttribute('data-vortex-results-original');
      if (original) {
        var originalMatch = original.match(/^([\d][\d,]*)\s+results$/i);
        if (originalMatch) {
          return parseInt(originalMatch[1].replace(/,/g, ''), 10);
        }
      }
    }

    var nodes = document.querySelectorAll('span, div, p, strong');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].closest('.vortex-enhanced-carousel-controls')) {
        continue;
      }
      var text = (nodes[i].textContent || '').replace(/\s+/g, ' ').trim();
      var match = text.match(/^([\d][\d,]*)\s+results$/i);
      if (match) {
        return parseInt(match[1].replace(/,/g, ''), 10);
      }
    }
    return null;
  }

  function parseGraphInt(value) {
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
        return parseGraphInt(value.value);
      }
      if (value.kb != null) {
        return parseGraphInt(value.kb);
      }
      if (value.bytes != null) {
        var bytes = parseGraphInt(value.bytes);
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

  function scheduleQuietPeriodEnd() {
    if (enhancer.carouselQuietTimer) {
      clearTimeout(enhancer.carouselQuietTimer);
    }
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
    }, 3500);
  }

  function beginCarouselQuietPeriod(durationMs) {
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
    scheduleQuietPeriodEnd();
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

  function urlHasActiveNexusFilters(href) {
    try {
      var url = new URL(href || window.location.href);
      var seen = {};
      var keys = [];
      url.searchParams.forEach(function (_, key) {
        if (!seen[key]) {
          seen[key] = true;
          keys.push(key);
        }
      });

      return keys.some(function (key) {
        if (key === 'count' || key === 'page' || key === 'p' || key === 'offset') {
          return false;
        }
        if (/^sort/i.test(key) || key === 'direction' || key === 'order') {
          return false;
        }
        if (key === 'excludedTag') {
          var tags = url.searchParams.getAll('excludedTag');
          return !(tags.length === 1 && tags[0] === 'Translation');
        }
        return true;
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

    var needsTranslation = !!(enhancer.clientHideTranslations || enhancer.forceDefaultFilters);
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
    if (!enhancer.clientHideTranslations && !enhancer.forceDefaultFilters) {
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
    if (isNexusFiltersPanelOpen()) {
      return;
    }

    var filtersPanel = document.getElementById('filters-panel');
    if (filtersPanel &&
        !filtersPanel.classList.contains('vortex-enhanced-nexus-filters-open')) {
      filtersPanel.classList.add('vortex-enhanced-browse-trim-hidden');
    }

    document.querySelectorAll('aside').forEach(function (aside) {
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

  function navigateNexusResultsPageSoft(direction) {
    var btn = findNexusPaginationButton(direction);
    if (!btn) {
      return false;
    }

    enhancer.pendingPoolFetch = true;
    saveCarouselPagingState();

    var preferSoft = shouldPreferSoftNexusPagination();
    var href = btn.getAttribute('href');
    if (!preferSoft && href && href !== '#' && href.indexOf('javascript:') !== 0) {
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

  function navigateNexusResultsPage(direction) {
    var btn = findNexusPaginationButton(direction);
    if (btn) {
      enhancer.pendingPoolFetch = true;
      saveCarouselPagingState();

      var preferSoft = shouldPreferSoftNexusPagination();
      var href = btn.getAttribute('href');
      if (!preferSoft && href && href !== '#' && href.indexOf('javascript:') !== 0) {
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
    var url = new URL(window.location.href);
    url.searchParams.set('page', String(pageNum));
    if (!url.searchParams.get('count')) {
      url.searchParams.set('count', '80');
    }
    return url.toString();
  }

  function markCurrentNexusPageFetched() {
    var page = getNexusResultsPageFromUrl();
    var ctx = loadNexusListingContext();
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

  function parseModTilesFromHtml(html, baseUrl) {
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
    return parsed;
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
    return {
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

  function buildModsListingVariables(offset, count, ctx, config) {
    var adultFilter = [];
    if (ctx.onlyAdult === 'false') {
      adultFilter = [{ op: 'EQUALS', value: false }];
    } else if (ctx.showAdult === 'true') {
      adultFilter = [{ op: 'EQUALS', value: true }];
    }

    var tagsExclude = (ctx.tagsExclude || []).slice();
    if ((enhancer.hideTranslationsApplied || enhancer.clientHideTranslations) &&
        !tagsExclude.some(function (tag) { return /translation/i.test(String(tag)); })) {
      tagsExclude.push('Translation');
    }

    var postFilter = {
      tag: tagsExclude.length
        ? tagsExclude.map(function (value) { return { op: 'NOT_EQUALS', value: String(value) }; })
        : [],
    };

    if ((enhancer.hideTranslationsApplied || enhancer.clientHideTranslations)) {
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
        filter: [],
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

    return variables;
  }

  function fetchModsListingBatch(offset, count, config) {
    var ctx = loadNexusListingContext();
    var variables = buildModsListingVariables(offset, count, ctx, config);
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
        enhancer.nexusCatalogTotal = data.totalCount;
      }
      return { nodes: data.nodes, totalCount: data.totalCount || 0 };
    }).catch(function () {
      return null;
    });
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

  function saveNativePoolSnapshot(config) {
    if (!config) {
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

  function fetchNativeNexusResultsPageViaNavigation(pageNum, config) {
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

      var navigated = navigateNexusResultsPageSoft(1);
      if (!navigated) {
        navigated = navigateNexusResultsPage(1);
      }
      if (!navigated) {
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

  function fetchNativeNexusResultsPage(pageNum, config) {
    if (!pageNum || pageNum < 2) {
      return Promise.resolve(false);
    }
    if (enhancer.fetchedNexusPages && enhancer.fetchedNexusPages[pageNum]) {
      return Promise.resolve(true);
    }

    var url = buildNexusResultsPageUrl(pageNum);
    return fetch(url, {
      credentials: 'include',
      headers: { Accept: 'text/html,application/xhtml+xml' },
    }).then(function (response) {
      if (!response || !response.ok) {
        return null;
      }
      return response.text();
    }).then(function (html) {
      if (!html) {
        return false;
      }
      var tiles = parseModTilesFromHtml(html, url);
      if (!tiles || tiles.length === 0) {
        return false;
      }
      var added = appendFetchedTilesToPool(tiles, config);
      if (added <= 0) {
        return false;
      }
      markNativeMergedPage(pageNum);
      return true;
    }).catch(function () {
      return false;
    }).then(function (ok) {
      if (ok) {
        return true;
      }
      return fetchNativeNexusResultsPageViaNavigation(pageNum, config);
    });
  }

  function fetchNexusBatchPage(pageNum, config) {
    if (config && config.onlyTracked) {
      return Promise.resolve(false);
    }
    if (!pageNum || pageNum < 2) {
      return Promise.resolve(false);
    }
    enhancer.fetchedNexusPages = enhancer.fetchedNexusPages || {};
    if (enhancer.fetchedNexusPages[pageNum]) {
      return Promise.resolve(true);
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
      var tiles = [];
      for (var i = 0; i < result.nodes.length; i++) {
        tiles.push(buildGraphQLModTile(result.nodes[i]));
      }
      var added = appendFetchedTilesToPool(tiles, config);
      if (added <= 0) {
        return false;
      }
      enhancer.fetchedNexusPages[pageNum] = true;
      return true;
    }

    return fetchModsListingBatch(offset, 80, config).then(function (result) {
      if (appendGraphqlBatchResult(result)) {
        return finishBatchFetch(true);
      }
      return fetchNativeNexusResultsPage(pageNum, config).then(function (htmlOk) {
        if (htmlOk) {
          return finishBatchFetch(true);
        }
        return fetchNativeNexusResultsPageViaNavigation(pageNum, config).then(finishBatchFetch);
      });
    });
  }

  function needsUpcomingBatchFetch(visibleCount, pageSize) {
    var catalogAvailable = getCatalogAvailableCount(visibleCount);
    var needForNextPage = (enhancer.globalPageIndex + 1) * pageSize;
    var needForPageAfterNext = (enhancer.globalPageIndex + 2) * pageSize;
    var needEarly = (enhancer.globalPageIndex + 3) * pageSize;
    var needForFullPageFour = 4 * pageSize;
    return needForNextPage > catalogAvailable ||
      needForPageAfterNext > catalogAvailable ||
      needEarly > catalogAvailable ||
      catalogAvailable < needForFullPageFour;
  }

  function getNextUnfetchedNexusPage() {
    var nextPage = getNextNexusPageToFetch();
    return nextPage > getNexusResultsPageFromUrl() ? nextPage : null;
  }

  function maybePrefetchNextBatch(config, cards) {
    if (config && config.onlyTracked) {
      return;
    }
    if (isCarouselQuietPeriod()) {
      return;
    }
    if (enhancer.pendingPoolFetch || enhancer.pendingNexusBatchAdvance || enhancer.fetchInFlightPage ||
        enhancer.nativeNavFetchInFlight || enhancer.pendingNativeCatalogFetch) {
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

    fetchNexusBatchPage(nextPage, config).then(function (ok) {
      if (ok) {
        enhancer.scheduleScan(true);
      }
    });
  }

  function beginNexusBatchFetch(config) {
    if (config && config.onlyTracked) {
      return Promise.resolve(false);
    }
    var nextPage = getNextUnfetchedNexusPage();
    if (!nextPage) {
      return Promise.resolve(false);
    }
    return fetchNexusBatchPage(nextPage, config);
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
    var cardHeight = Math.max(418, Math.min(492, Math.floor((window.innerHeight - 96) / rows)));
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
    if (enhancer.clientHideTranslations || enhancer.forceDefaultFilters) {
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

    if ((enhancer.clientHideTranslations || enhancer.forceDefaultFilters)) {
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
      var reloadUrl = enhancer.lastGoodBrowseUrl || window.location.href;
      if (reloadUrl && reloadUrl.indexOf('nexusmods.com') >= 0) {
        sendToHost({ type: 'browse-navigate', url: appendBrowseReloadParam(reloadUrl) });
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
    var key = getBrowseSessionKeyFromHref(window.location.href);
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
        node.classList.contains('vortex-enhanced-controls-bar-fallback')
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
    enhancer.hideTranslationsApplied = true;
    enhancer.clientHideTranslations = true;
    enhancer.preferHideTranslations = true;
    enhancer.forceDefaultFilters = true;
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

      if ((enhancer.hideTranslationsApplied || enhancer.clientHideTranslations) && isTranslationModCard(card)) {
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
    if (useLiveOnlyPaging && grid) {
      var sliceModIds = {};
      for (var sm = 0; sm < slice.length; sm++) {
        if (slice[sm].modId) {
          sliceModIds[String(slice[sm].modId)] = true;
        }
      }
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
        }
      });
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
    } finally {
      enhancer.applyingCarouselPage = false;
    }
  }

  function ensureFilteredCatalogFill(config) {
    if (config.onlyTracked) {
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
    beginNexusBatchFetch(config).then(function (ok) {
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

  function updateCarouselControls(visibleCount, batchPages, pageSize, batchPage) {
    var controls = document.querySelector('.vortex-enhanced-carousel-controls');
    if (!controls) {
      return;
    }

    var config = enhancer.config || {};
    var pageDisplay = controls.querySelector('[data-carousel-page]');
    var countDisplay = controls.querySelector('[data-carousel-count]');
    var catalogPages = getCarouselCatalogPages(pageSize, visibleCount, config);

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
      var hasLoadedNext = nextPageStart < visibleCount;
      if (config.onlyTracked && hasTrackedCatalogData(config)) {
        nextBtn.disabled = catalogPages > 0 && (enhancer.globalPageIndex + 1) >= catalogPages;
      } else if (isLocalCatalogMode(config) && hasLocalCatalogData(config)) {
        nextBtn.disabled = catalogPages > 0 && (enhancer.globalPageIndex + 1) >= catalogPages;
      } else if (hasClientCarouselFilters(config)) {
        nextBtn.disabled = !hasLoadedNext && !canFetchMoreCarouselBatches();
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
      applyLiveCarouselPage(cards, config);
      decorateVisibleCarouselSlice(cards, config);
      scrollCarouselIntoView();
      return;
    }

    if (!canFetchMoreCarouselBatches()) {
      enhancer.carouselAdvancePending = false;
      clampGlobalPageIndex(pageSize, visible.length);
      applyLiveCarouselPage(cards, config);
      return;
    }

    beginNexusBatchFetch(config).then(function (ok) {
      if (!ok) {
        enhancer.carouselAdvancePending = false;
        var stale = collectCards(config);
        clampGlobalPageIndex(pageSize, getVisibleCarouselCards(stale).length);
        applyLiveCarouselPage(stale, config);
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

  function advanceCarouselPage(delta) {
    var config = enhancer.config;
    if (delta > 0) {
      if (config && isLocalCatalogMode(config) && enhancer.trackedCatalogActive) {
        if (enhancer.localCatalogNavLock) {
          return;
        }
      } else if (enhancer.carouselAdvancePending || enhancer.fetchInFlightPage ||
          enhancer.nativeNavFetchInFlight || enhancer.pendingNativeCatalogFetch) {
        return;
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
      applyLiveCarouselPage(backCards, config);
      decorateVisibleCarouselSlice(backCards, config);
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

    var nextPageStart = (enhancer.globalPageIndex + 1) * pageSize;
    var hasNextPageLoaded = nextPageStart < visible.length;

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
      beginNexusBatchFetch(config).then(function (ok) {
        enhancer.carouselAdvancePending = false;
        if (!ok) {
          enhancer.pendingTargetPage = null;
          return;
        }
        enhancer.globalPageIndex += 1;
        enhancer.pendingTargetPage = null;
        saveCarouselPagingState();
        var refreshed = collectCards(config);
        applyLiveCarouselPage(refreshed, config);
        decorateVisibleCarouselSlice(refreshed, config);
        ensureCarouselControlsBar();
        protectBrowseControlsFromChromeHide();
        scheduleControlsRemount();
        scrollCarouselIntoView();
      });
      return;
    }

    enhancer.pendingTargetPage = null;
    var refreshed = collectCards(config);
    applyLiveCarouselPage(refreshed, config);
    decorateVisibleCarouselSlice(refreshed, config);
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
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function shouldKeepVisibleInHideChrome(node, host) {
    if (!node || !host) {
      return false;
    }
    if (node === host || node.contains(host)) {
      return true;
    }
    if (node.tagName === 'ASIDE' &&
        (node.classList.contains('vortex-enhanced-nexus-filters-open') || isNexusFiltersPanelOpen())) {
      return true;
    }
    if (node.querySelector && node.querySelector(
      '.vortex-enhanced-carousel-host, .vortex-enhanced-grid-layout, .vortex-enhanced-sort-toolbar-row, [data-vortex-enhanced-ui="true"]'
    )) {
      return true;
    }
    if (nodeHasVortexEnhancedUi(node)) {
      return true;
    }
    return false;
  }

  function isValidCarouselToolbarRow(row) {
    if (!row || !rowHasSortControls(row)) {
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

    var nodes = document.querySelectorAll('span, div, p, strong');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.closest('.vortex-enhanced-carousel-controls, [data-vortex-enhanced-filters="true"]')) {
        continue;
      }
      var text = normalizeUiText(node.textContent);
      if (/^[\d][\d,]* results$/i.test(text)) {
        return node;
      }
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
    var unified = findUnifiedToolbarRow();
    if (unified) {
      return unified;
    }

    var sortRow = findSortToolbarRow();
    if (sortRow) {
      return sortRow;
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

    syncAutoAdvanceUi();
    return controls;
  }

  function ensureCarouselControlsBar() {
    var controls = ensureCarouselControls();
    var hideChrome = !!(enhancer.config && enhancer.config.hideSiteChrome);
    var toolbarRow = findResultsToolbarRow();

    if (toolbarRow && isValidCarouselToolbarRow(toolbarRow)) {
      clearInHostControlsBar();
      toolbarRow.classList.add('vortex-enhanced-results-toolbar');
      var anchor = ensureControlsAnchor(toolbarRow);
      if (controls.parentElement !== anchor) {
        anchor.appendChild(controls);
      }
      removeControlsFallbackBar();
      if (hideChrome) {
        protectBrowseControlsFromChromeHide();
      }
      return controls;
    }

    if (hideChrome) {
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
        var toolbarRow = findResultsToolbarRow();
        var controls = ensureCarouselControlsBar();
        if (controls && !controlsAreVisible(controls)) {
          if (enhancer.config && enhancer.config.hideSiteChrome) {
            mountControlsInCarouselHost(controls);
          } else if (!toolbarRow) {
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
    if (window.__vortexBrowseEnhancerWheelNav) {
      return;
    }
    window.__vortexBrowseEnhancerWheelNav = true;

    var lastWheelAdvance = 0;
    var wheelAccum = 0;
    document.addEventListener('wheel', function (event) {
      if (!document.querySelector('.vortex-enhanced-carousel-host')) {
        return;
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

      event.preventDefault();
      event.stopPropagation();

      wheelAccum += event.deltaY;
      var now = Date.now();
      if (Math.abs(wheelAccum) < 80) {
        return;
      }
      if (now - lastWheelAdvance < 650) {
        return;
      }

      lastWheelAdvance = now;
      var delta = wheelAccum > 0 ? 1 : -1;
      wheelAccum = 0;
      advanceCarouselPage(delta);
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
      var topTarget = document.getElementById('vortex-enhanced-controls-bar') ||
        controls || toolbar || host || grid;
      if (!topTarget) {
        return;
      }
      var topRect = topTarget.getBoundingClientRect();
      var topPadding = 8;
      var alignTopScrollY = window.scrollY + topRect.top - topPadding;
      if (Math.abs(alignTopScrollY - window.scrollY) > 8) {
        window.scrollTo({ top: Math.max(0, alignTopScrollY), behavior: 'instant' });
      }
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

    var aside = document.querySelector('aside');
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
    var selectors = [
      '#vortex-enhanced-carousel-controls',
      '#vortex-enhanced-controls-bar',
      '#vortex-enhanced-controls-anchor',
      '.vortex-enhanced-results-toolbar',
      '.vortex-enhanced-sort-toolbar-row',
      '.vortex-enhanced-controls-bar-fallback',
      '.vortex-enhanced-controls-bar-in-host',
      '[data-vortex-enhanced-ui="true"]',
    ];
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (node) {
        node.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
        unhideVortexUiAncestors(node);
      });
    });
  }

  function markNodeChromeHidden(node) {
    if (!node || nodeHasVortexEnhancedUi(node)) {
      return;
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

  function applyHideSiteChrome(config) {
    if (!config || !config.hideSiteChrome) {
      document.documentElement.classList.remove('vortex-enhanced-hide-chrome');
      stopChromeHideWatchdog();
      document.querySelectorAll('.vortex-enhanced-chrome-hidden').forEach(function (node) {
        node.classList.remove('vortex-enhanced-chrome-hidden');
      });
      return;
    }
    document.documentElement.classList.add('vortex-enhanced-hide-chrome');
    hideNexusChromeAboveGrid();
    hideNexusGameBannerStrip();
    protectBrowseControlsFromChromeHide();
    ensureChromeHideWatchdog(config);
  }

  function ensureHideSiteChrome(config) {
    applyHideSiteChrome(config);
  }

  function scheduleChromeHideRefresh() {
    if (!enhancer.config || !enhancer.config.hideSiteChrome) {
      return;
    }
    if (enhancer.chromeHideDebounceTimer) {
      return;
    }
    enhancer.chromeHideDebounceTimer = setTimeout(function () {
      enhancer.chromeHideDebounceTimer = null;
      if (enhancer.config && enhancer.config.hideSiteChrome && !isBrowseEnhancementPaused()) {
        hideNexusChromeAboveGrid();
        hideNexusGameBannerStrip();
        protectBrowseControlsFromChromeHide();
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
    var host = document.querySelector('.vortex-enhanced-carousel-host') || findModGrid() || findSortToolbarRow();
    if (!host) {
      hideNexusGameBannerStrip(null);
      return;
    }

    host.classList.remove('vortex-enhanced-chrome-hidden');

    var selectors = [
      'header',
      'footer',
      'aside',
      '#siteHeader',
      '#site-header',
      '[class*="GlobalHeader"]',
      '[class*="GlobalNav"]',
      '[class*="SiteHeader"]',
      '[class*="site-footer"]',
      '[class*="ModsToolbar"]',
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
        if (!host.contains(node) && !node.contains(host)) {
          if (selector === 'aside') {
            if (node.classList.contains('vortex-enhanced-nexus-filters-open') || isNexusFiltersPanelOpen()) {
              node.classList.add('vortex-enhanced-nexus-filters-open');
              node.classList.remove('vortex-enhanced-chrome-hidden');
              node.classList.remove('vortex-enhanced-browse-trim-hidden');
              return;
            }
            node.classList.add('vortex-enhanced-chrome-hidden');
            return;
          }
          node.classList.add('vortex-enhanced-chrome-hidden');
        }
      });
    });

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
          if (sibling.classList.contains('vortex-enhanced-nexus-filters-open') || isNexusFiltersPanelOpen()) {
            sibling.classList.add('vortex-enhanced-nexus-filters-open');
            sibling.classList.remove('vortex-enhanced-chrome-hidden');
            sibling.classList.remove('vortex-enhanced-browse-trim-hidden');
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

    hideNexusGameBannerStrip(host);
    protectBrowseControlsFromChromeHide();
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
    if (enhancer.translationFilterWatchdog) {
      return;
    }

    enhancer.translationFilterWatchdog = setInterval(function () {
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

  // IMPERATIVE (user requirement — do not disable): hide translations ON by default.
  // See AGENTS.md "Hide translations — IMPERATIVE". Client + Nexus filters must stay active.
  function applyDefaultNexusFilters(config) {
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
      closeNexusFiltersPanel();
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
        closeNexusFiltersPanel();
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
      '  background: #101010 !important;',
      '  border-bottom: 1px solid rgba(255,255,255,0.08) !important;',
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
      '.vortex-enhanced-grid-layout > [data-e2eid="mod-tile"].vortex-enhanced-carousel-hidden,',
      '.vortex-enhanced-grid-layout > [data-e2eid="mod-tile"].vortex-enhanced-hidden {',
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
      'html.vortex-enhanced-hide-chrome aside:not(.vortex-enhanced-nexus-filters-open),',
      'html.vortex-enhanced-hide-chrome #filters-panel:not(.vortex-enhanced-nexus-filters-open),',
      'html.vortex-enhanced-hide-chrome [class*="site-footer"],',
      'html.vortex-enhanced-hide-chrome [class*="GlobalHeader"],',
      'html.vortex-enhanced-hide-chrome [class*="GlobalNav"],',
      'html.vortex-enhanced-hide-chrome [class*="SiteHeader"],',
      'html.vortex-enhanced-hide-chrome [class*="ModsToolbar"],',
      'html.vortex-enhanced-hide-chrome [class*="ResultsHeader"],',
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
    var key = action + ':' + modId;
    if (pending) {
      enhancer.pendingFooterActions[key] = true;
      if (typeof targetState === 'boolean') {
        enhancer.pendingFooterTargets[key] = targetState;
      }
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

    var category = card.querySelector('[data-e2eid="mod-tile-category"]');
    if (!category) {
      return null;
    }

    var row = document.createElement('div');
    row.className = 'vortex-enhanced-install-row';

    var categoryBlock = category.closest('div.py-2') || category.parentElement;
    if (categoryBlock && categoryBlock.parentElement) {
      if (categoryBlock.nextSibling) {
        categoryBlock.parentElement.insertBefore(row, categoryBlock.nextSibling);
      } else {
        categoryBlock.parentElement.appendChild(row);
      }
      return row;
    }

    return null;
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
    if ((enhancer.hideTranslationsApplied || enhancer.clientHideTranslations) && isTranslationModCard(card)) {
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
    var selectors = [
      '.vortex-enhanced-grid-layout [data-e2eid="mod-tile"]',
      '#vortex-enhanced-live-stash [data-e2eid="mod-tile"]',
      '#vortex-enhanced-pool-host [data-e2eid="mod-tile"]',
    ];
    var seen = {};

    selectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (card) {
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
    });
  }

  function collectLiveGridCards(config) {
    var grid = resolveNexusModGridElement();
    var tileNodes = [];

    if (grid) {
      tileNodes = Array.prototype.slice.call(
        grid.querySelectorAll(':scope > [data-e2eid="mod-tile"]:not([data-vortex-pool-tile])')
      );
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
      hideNexusChromeAboveGrid();
      hideNexusGameBannerStrip();
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
    return stats;
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

  function scan(config) {
    if (recoverFromBrowseOopsIfNeeded()) {
      return enhancer.lastStats || emptyScanStats(config);
    }

    if (enhancer.nexusFilterApplyInFlight && !isBrowseOopsPage()) {
      return enhancer.lastStats || emptyScanStats(config);
    }

    if (isBrowseEnhancementPaused()) {
      return enhancer.lastStats || emptyScanStats(config);
    }

    if (enhancer.enhancementFullyPaused && !isBrowseOopsPage()) {
      return enhancer.lastStats || emptyScanStats(config);
    }

    if (enhancer.localCatalogNavLock) {
      return enhancer.lastStats || emptyScanStats(config);
    }

    var pathname = getBrowsePathname();
    if (!isBrowseModsListPathname(pathname)) {
      if (isBrowseModDetailPathname(pathname) || pathname.indexOf('/mods') >= 0) {
        enterBrowseDetailHandsOffMode();
      }
      return enhancer.lastStats || emptyScanStats(config);
    }

    if (enhancer.browseDetailHandsOff) {
      exitBrowseDetailHandsOffMode();
    }

    var scrollY = window.scrollY || 0;
    if (typeof enhancer.savedListScrollY === 'number' && enhancer.savedListScrollY >= 0) {
      scrollY = enhancer.savedListScrollY;
      enhancer.savedListScrollY = null;
    }
    ensureStyles();

    var sessionKey = getBrowseSessionKey();
    var browsePath = getBrowsePathname();
    if (sessionKey !== enhancer.poolSessionKey && enhancer.poolSessionKey) {
      resetGlobalPagingSoft();
      resetTranslationFilters();
      enhancer.lastAppliedSliceKey = '';
      enhancer.globalPageIndex = 0;
      enhancer.poolSessionKey = sessionKey;
      enhancer.browsePathname = browsePath;
      unhideAllCarouselTiles();
      if (config.onlyTracked || config.onlyInstalled) {
        ensureLocalCatalogInitialized(config);
        enhancer.carouselQuietUntil = 0;
      } else if (!isCarouselQuietPeriod() && !enhancer.nexusFilterApplyInFlight) {
        beginCarouselQuietPeriod(1200);
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
    if (!shouldDeferHeavyNexusUi(config)) {
      applyDefaultNexusFilters(config);
      ensureTranslationFilterWatchdog();
      if (!isNexusHideTranslationsActive()) {
        applyDefaultNexusFilters(config);
      }
    }
    if (!isNexusFiltersPanelOpen() && !enhancer.filtersPanelOpenApplied) {
      if ((enhancer.hideTranslationsApplied || config.hideSiteChrome) && !urlHasActiveNexusFilters()) {
        if (!enhancer.nexusFilterCooldownUntil || Date.now() >= enhancer.nexusFilterCooldownUntil) {
          hideNexusFilterAside();
        }
      }
    }
    hideNexusItemsPerPageUi();
    tagNexusPaginationNav();

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

    if (!enhancer.nativePoolRestorePromise && shouldPreferSoftNexusPagination()) {
      try {
        if (sessionStorage.getItem(getNativePoolStorageKey())) {
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

    var cards = collectCards(config);

    if (enhancer.pendingNativeCatalogFetch) {
      var mergedOnScan = mergeLiveGridIntoPool(config);
      var nativePage = getNexusResultsPageFromUrl();
      if (mergedOnScan > 0 || collectLiveGridCards(config).length >= 8) {
        markNativeMergedPage(nativePage);
      }
      finishNativeNavFetch(mergedOnScan > 0 || collectLiveGridCards(config).length >= 8);
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
    } else {
      applyLiveCarouselPage(cards, config);
      decorateVisibleCarouselSlice(cards, config);
    }

    if (!config.onlyTracked) {
      maybePrefetchNextBatch(config, cards);
      ensureFilteredCatalogFill(config);
    }

    ensureCarouselControlsBar();
    protectBrowseControlsFromChromeHide();
    hideBrowsePageFooter();
    syncNexusResultsHeadline(config);
    syncAutoAdvance();
    scheduleControlsRemount();

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

    return {
      tileCount: cards.length,
      installedMatches: cards.filter(function (entry) { return !!entry.installed; }).length,
      hideInstalled: !!config.hideInstalled,
      onlyInstalled: !!config.onlyInstalled,
      hideTracked: !!config.hideTracked,
      onlyTracked: !!config.onlyTracked,
      installedKeys: Object.keys(config.installed || {}).length,
    };
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
      stopChromeHideWatchdog();
      releaseBrowseListEnhancements();
      return { active: false };
    },

    finalizeBrowseContextTransition: function () {
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
        this.preferHideTranslations = true;
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
      this.scheduleScan(true);
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

      if (self.debounceTimer) {
        clearTimeout(self.debounceTimer);
      }

      if (immediate) {
        self.lastStats = scan(self.config);
        self.scheduleRetryIfEmpty();
        return self.lastStats;
      }

      var debounceMs = 350;
      if (self.config && isLocalCatalogMode(self.config) && enhancer.trackedCatalogActive) {
        debounceMs = 150;
      } else if (self.config && self.config.onlyInstalled && !self.config.onlyTracked) {
        debounceMs = 900;
      }

      self.debounceTimer = setTimeout(function () {
        self.debounceTimer = null;
        self.lastStats = scan(self.config);
        self.scheduleRetryIfEmpty();
      }, debounceMs);
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
        self.lastStats = scan(self.config);
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
        if (recoverFromBrowseOopsIfNeeded()) {
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
        if (enhancer.nexusFilterCooldownUntil && Date.now() < enhancer.nexusFilterCooldownUntil) {
          return;
        }
        if (enhancer.applyingCarouselPage) {
          return;
        }
        if (enhancer.trackedCatalogFetchInFlight && enhancer.trackedCatalogActive &&
            enhancer.config && isLocalCatalogMode(enhancer.config)) {
          return;
        }
        if (mutationTouchesOnlyEnhancerInternals(mutations)) {
          return;
        }
        mutations.forEach(function (mutation) {
          if (mutation.addedNodes) {
            for (var i = 0; i < mutation.addedNodes.length; i++) {
              hideBadgesInNode(mutation.addedNodes[i]);
            }
          }
        });
        if (enhancer.config && enhancer.config.hideSiteChrome && !isBrowseEnhancementPaused()) {
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
    },

    getStats: function () {
      return this.lastStats || scan(this.config);
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
        var paginationOnlyHrefChange = isNexusPaginationOnlyHrefChange(lastBrowseHref, currentHref);
        if (!paginationOnlyHrefChange &&
            !enhancer.nexusFilterApplyInFlight &&
            (urlHasActiveNexusFilters(currentHref) || urlHasActiveNexusFilters(lastBrowseHref))) {
          enhancer.nexusFilterCooldownUntil = Date.now() + 25000;
          if (!enhancer.config || !enhancer.config.onlyTracked) {
            enhancer.carouselQuietUntil = Math.max(enhancer.carouselQuietUntil || 0, Date.now() + 8000);
          }
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
        } else if (!isCarouselQuietPeriod() && !enhancer.nexusFilterApplyInFlight) {
          beginCarouselQuietPeriod();
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

  enhancer.init();
  installBrowseUrlWatcher();
  installModTileNavigationHandler();
  enhancer.showToast = showNexusStyleToast;
  enhancer.clearPending = function (action, modId) {
    setFooterActionPending(action, modId, false);
    this.scheduleScan(true);
  };
  window.__vortexBrowseEnhancer = enhancer;
  ensureStyles();

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
    enhancer.nexusFilterApplyInFlight = true;
    enhancer.pendingNexusFilterUrl = targetUrl;
    enhancer.nexusFilterApplyStartUrl = window.location.href;
    enhancer.nexusFilterCooldownUntil = Date.now() + 30000;
    closeNexusFiltersPanel();
    try {
      window.location.replace(targetUrl);
    } catch (errNav) {
      window.location.href = targetUrl;
    }
    setTimeout(function () {
      releaseNexusFilterApplyWhenStable(0);
    }, 600);
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
    var bodyText = (document.body.textContent || '').replace(/\s+/g, ' ').trim();
    if (/oops!? something went wrong|something went wrong|unexpected error|try again later|page could not be loaded/i.test(bodyText)) {
      return true;
    }
    var headings = document.querySelectorAll('h1, h2, h3, [role="heading"]');
    for (var i = 0; i < headings.length; i++) {
      var headingText = (headings[i].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (headingText.indexOf('oops') >= 0 || headingText.indexOf('something went wrong') >= 0) {
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

  function recoverFromBrowseOopsIfNeeded() {
    if (!isBrowseOopsPage()) {
      enhancer.oopsRecoveryAttempts = 0;
      enhancer.oopsRecoveryInFlight = false;
      return false;
    }
    if (enhancer.nexusFilterApplyInFlight && enhancer.pendingNexusFilterUrl) {
      var filterRetryUrl = appendBrowseReloadParam(enhancer.pendingNexusFilterUrl);
      if (filterRetryUrl !== window.location.href) {
        navigateNexusFilterInWebview(filterRetryUrl);
      }
      return true;
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
    var recoveryUrl = appendBrowseReloadParam(
      enhancer.pendingNexusFilterUrl ||
      readNexusFilterFormUrl() ||
      (urlHasActiveNexusFilters(window.location.href) ? window.location.href : '') ||
      enhancer.lastGoodBrowseUrl ||
      window.location.href
    );
    clearEnhancerLocks();
    enhancer.nexusFilterApplyInFlight = false;
    enhancer.enhancementFullyPaused = false;
    enhancer.pendingNexusFilterUrl = recoveryUrl;
    sendToHost({ type: 'browse-navigate', url: recoveryUrl });
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
      var targetUrl = appendBrowseReloadParam(buildNexusFilterApplyUrl());
      if (!targetUrl) {
        return;
      }
      navigateNexusFilterInWebview(targetUrl);
    }, typeof delayMs === 'number' ? delayMs : 600);
  }

  function buildNexusFilterApplyUrl() {
    var formUrl = readNexusFilterFormUrl();
    if (formUrl) {
      return formUrl;
    }

    try {
      var url = new URL(window.location.href);
      url.searchParams.set('count', String(enhancer.nexusPageSizeTarget || 80));
      if (enhancer.clientHideTranslations || enhancer.forceDefaultFilters) {
        var tags = url.searchParams.getAll('excludedTag');
        if (tags.indexOf('Translation') < 0) {
          url.searchParams.append('excludedTag', 'Translation');
        }
      }

      var panel = findNexusFilterAside();
      if (panel) {
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
      return url.href;
    } catch (errApplyUrl) {
      return window.location.href;
    }
  }

  function releaseNexusFilterApplyWhenStable(attempt) {
    if (!enhancer.nexusFilterApplyInFlight) {
      return;
    }

    var liveTiles = document.querySelectorAll('[data-e2eid="mod-tile"]:not([data-vortex-pool-tile])').length;
    var poolTiles = document.querySelectorAll('#vortex-enhanced-pool-host [data-e2eid="mod-tile"]').length;
    var stable = liveTiles >= 12 || poolTiles >= 12;
    var urlChanged = enhancer.nexusFilterApplyStartUrl &&
      window.location.href !== enhancer.nexusFilterApplyStartUrl;
    var oopsPage = isBrowseOopsPage();

    if (oopsPage && enhancer.pendingNexusFilterUrl && attempt >= 2) {
      navigateNexusFilterInWebview(appendBrowseReloadParam(enhancer.pendingNexusFilterUrl));
      return;
    }

    if (stable || (urlChanged && !oopsPage) || attempt >= 30) {
      enhancer.nexusFilterApplyInFlight = false;
      enhancer.enhancementFullyPaused = false;
      enhancer.nexusFilterApplyStartUrl = '';
      enhancer.pendingNexusFilterUrl = '';
      enhancer.carouselQuietUntil = 0;
      if (isBrowseModsListPathname(getBrowsePathname()) && !isBrowseOopsPage()) {
        try {
          enhancer.lastGoodBrowseUrl = window.location.href;
        } catch (errGoodFilterUrl) {
          // ignore
        }
      }
      if (window.__vortexBrowseEnhancer) {
        window.__vortexBrowseEnhancer.finalizeBrowseContextTransition();
        window.__vortexBrowseEnhancer.scheduleScan(true);
      }
      return;
    }

    setTimeout(function () {
      releaseNexusFilterApplyWhenStable(attempt + 1);
    }, 400);
  }

  if (!window.__vortexBrowseEnhancerNexusApplyCapture) {
    window.__vortexBrowseEnhancerNexusApplyCapture = true;
    document.addEventListener('click', function (event) {
      var nexusBtn = event.target.closest('button');
      if (!nexusBtn) {
        return;
      }
      var filterPanel = nexusBtn.closest('#filters-panel') || nexusBtn.closest('aside');
      if (!filterPanel || filterPanel.closest('[data-vortex-enhanced-filters="true"]')) {
        return;
      }
      var btnLabel = (nexusBtn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (btnLabel !== 'apply' && btnLabel.indexOf('apply filter') !== 0) {
        return;
      }

      var targetUrl = readNexusFilterFormUrl() || buildNexusFilterApplyUrl();
      if (!targetUrl) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      enhancer.nexusFilterApplyInFlight = true;
      enhancer.nexusFilterApplyStartUrl = window.location.href;
      enhancer.pendingNexusFilterUrl = targetUrl;
      enhancer.nexusFilterCooldownUntil = Date.now() + 25000;
      enhancer.carouselQuietUntil = Math.max(enhancer.carouselQuietUntil || 0, Date.now() + 10000);

      navigateNexusFilterInWebview(targetUrl);
    }, true);
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
        if (!event.target.closest('input[type="checkbox"], label, [role="checkbox"], button[role="checkbox"]')) {
          enhancer.nexusFilterCooldownUntil = Date.now() + 20000;
        }
      }

      var carouselBtn = event.target.closest('.vortex-enhanced-carousel-btn[data-carousel]');
      if (carouselBtn) {
        var delta = parseInt(carouselBtn.getAttribute('data-carousel'), 10);
        if (delta) {
          event.preventDefault();
          advanceCarouselPage(delta);
        }
        return;
      }

      var nexusFilterBtn = event.target.closest('button');
      if (nexusFilterBtn) {
        var filterLabel = (nexusFilterBtn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (filterLabel.indexOf('show filters') === 0 || filterLabel.indexOf('hide filters') === 0) {
          var aside = findNexusFilterAside();
          if (aside) {
            if (filterLabel.indexOf('show filters') === 0) {
              aside.classList.add('vortex-enhanced-nexus-filters-open');
              aside.classList.remove('vortex-enhanced-chrome-hidden', 'vortex-enhanced-browse-trim-hidden');
            } else {
              aside.classList.remove('vortex-enhanced-nexus-filters-open');
            }
          }
          setTimeout(function () {
            syncNexusFiltersState(enhancer.config);
            if (enhancer.config && enhancer.config.hideSiteChrome) {
              applyHideSiteChrome(enhancer.config);
            }
            cleanupInvalidToolbarRows();
            enhancer.scheduleScan(true);
          }, 120);
          setTimeout(function () {
            enhancer.scheduleScan(true);
          }, 500);
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
      try {
        sendToHost({
          type: 'browse-navigate',
          url: new URL(nextPath, window.location.origin).href,
        });
      } catch (errNav) {
        window.location.assign(nextPath);
      }
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
