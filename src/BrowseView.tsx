import { types, Webview, MainPage, FormInput } from 'vortex-api';
import * as s from './styles.css';
const { Button } = require('react-bootstrap');
import React = require("react");
import { IProps } from 'vortex-api/lib/controls/FormInput';
import { util } from "vortex-api";
import {
  getInProgressNexusMods,
  getInstalledNexusMods,
  InstalledModsPayload,
  toInProgressModsPayload,
  toInstalledModsPayload,
} from './installedMods';
import { EnhancerConfig } from './injectionScript';
import { WebviewBridge } from './webviewBridge';
import { logEnhancerError, logEnhancerInfo } from './logger';
import { parseBridgeMessage } from './bridgeMessages';
import { safeInstallModFromBrowse } from './nexusInstall';
import { fetchDependencySummaries, ModDependencyMap } from './modDependencies';
import { buildModUidMap, lookupNumericNexusGameId } from './modUid';
import { startVortexUiLayout } from './vortexUiLayout';
import {
  fetchModListingNodesForGame,
  fetchTrackedModIdsForGame,
  fetchViewerModStateViaVortex,
  isNexusLoggedIn,
  toggleEndorseModViaVortex,
  toggleTrackModViaVortex,
} from './nexusActions';
import { FilterToggleName } from './bridgeMessages';
import { BROWSE_PAGE_ID, LEGACY_BROWSE_PAGE_IDS } from './extensionMeta';

function isBrowseWebviewVisible(session: { mainPage?: string; secondaryPage?: string }, pageId: string): boolean {
  const ourIds = [pageId].concat(LEGACY_BROWSE_PAGE_IDS).filter((id, index, all) => id && all.indexOf(id) === index);
  const main = session.mainPage || '';
  const secondary = session.secondaryPage || '';

  for (let i = 0; i < ourIds.length; i++) {
    if (main === ourIds[i] || secondary === ourIds[i]) {
      return true;
    }
  }

  // Default visible when session has not picked a page yet (fresh mount on Browse).
  if (!main && !secondary) {
    return true;
  }

  return false;
}
import {
  buildDefaultBrowseUrl,
  clearBrowseSessionIfGameMismatch,
  extractGameSlugFromBrowseUrl,
  isDefaultBrowseLanding,
  rememberBrowseUrl,
  resolveBrowseWebviewSrc,
  urlsMatchGame,
} from './browseSession';
import { BrowseCatalogCache } from './browseCatalogCache';

class Props {
  api: types.IExtensionApi;
  browsePageId?: string;
}

interface BrowseViewState {
  hideInstalled: boolean;
  onlyInstalled: boolean;
  hideTracked: boolean;
  onlyTracked: boolean;
  downloadingModIds: { [modId: string]: boolean };
  dependencyInfo: ModDependencyMap;
  trackedModIds: { [modId: string]: boolean };
  endorsedModIds: { [modId: string]: boolean };
  viewerDownloadedModIds: { [modId: string]: boolean };
  gridColumns: number;
  gridRows: number;
  hideSiteChrome: boolean;
  trackedListLoaded: boolean;
  tabActive: boolean;
}

export default class BrowseView extends React.Component<Props, BrowseViewState> {
  webView = {
    ref: null,
    currentUrl: ''
  }

  urlBar: React.Component<IProps, any, any> = null
  header: React.Component<{}, any, any> = null
  mainPage: React.Component<{}, any, any> = null

  private bridge: WebviewBridge = new WebviewBridge(null);
  private storeUnsubscribe: () => void = null;
  private pageVisibilityUnsubscribe: () => void = null;
  private showMainPageHandler: (pageId: string) => void = null;
  private webviewListenersAttached = false;

  private static isBrowseTabActive(api: types.IExtensionApi, pageId: string): boolean {
    return isBrowseWebviewVisible(api.store.getState().session || {}, pageId);
  }

  constructor(props: Props) {
    super(props);
    this.shouldApplyDefaultFilters = isDefaultBrowseLanding(this.getGame());
    this.state = {
      hideInstalled: false,
      onlyInstalled: false,
      hideTracked: false,
      onlyTracked: false,
      downloadingModIds: {},
      dependencyInfo: {},
      trackedModIds: {},
      endorsedModIds: {},
      viewerDownloadedModIds: {},
      gridColumns: 8,
      gridRows: 3,
      hideSiteChrome: true,
      trackedListLoaded: false,
      tabActive: BrowseView.isBrowseTabActive(props.api, props.browsePageId || 'Browse'),
    };
  }

  private dependencyFetchTimer: any = null;
  private dependencyFetchToken = 0;
  private lastDependencyRequestKey = '';
  private browseEnhancementTimer: any = null;
  private viewerStateFetchTimer: any = null;
  private lastVisibleModIds: number[] = [];
  private resolvedWebviewSrc: string | null = null;
  private shouldApplyDefaultFilters = false;
  private lastKnownGameSlug: string = '';
  private gameWatchUnsubscribe: () => void = null;
  private trackedLoadToken = 0;
  private catalogCache = new BrowseCatalogCache();
  private backgroundSyncTimer: any = null;
  private backgroundSyncInFlight = false;
  private lastSyncedTrackedKey = '';
  private lastSyncedInstalledKey = '';

  private getCatalogPageSize(): number {
    return this.state.gridColumns * this.state.gridRows;
  }

  private getTrackedCatalogPrefetchModIds(): number[] {
    const all = BrowseCatalogCache.getTrackedModIds(this.state.trackedModIds);
    return BrowseCatalogCache.pageSlice(all, this.getCatalogPageSize());
  }

  private getInstalledCatalogPrefetchModIds(): number[] {
    const installed = toInstalledModsPayload(getInstalledNexusMods(this.props.api));
    const all = BrowseCatalogCache.getInstalledModIds(installed);
    return BrowseCatalogCache.pageSlice(all, this.getCatalogPageSize());
  }

  private getLocalCatalogModIds(): number[] {
    const installed = toInstalledModsPayload(getInstalledNexusMods(this.props.api));
    if (this.state.onlyTracked) {
      return BrowseCatalogCache.getTrackedModIds(this.state.trackedModIds).filter((modId) => {
        const key = String(modId);
        if (this.state.hideInstalled && installed[key]) {
          return false;
        }
        if (this.state.onlyInstalled && !installed[key]) {
          return false;
        }
        return true;
      });
    }
    if (this.state.onlyInstalled) {
      return BrowseCatalogCache.getInstalledModIds(installed).filter((modId) => {
        const key = String(modId);
        if (this.state.hideTracked && this.state.trackedModIds[key]) {
          return false;
        }
        if (this.state.onlyTracked && !this.state.trackedModIds[key]) {
          return false;
        }
        return true;
      });
    }
    return [];
  }

  private prefetchLocalCatalogPage0 = async () => {
    const ids = BrowseCatalogCache.pageSlice(this.getLocalCatalogModIds(), this.getCatalogPageSize());
    await this.prefetchModTiles(ids);
  };

  prefetchModTiles = async (modIds: number[]) => {
    const ids = Array.from(new Set(modIds.filter((modId) => modId > 0)));
    if (ids.length === 0) {
      return;
    }
    if (this.catalogCache.resolveModTiles(ids)) {
      return;
    }

    const token = this.catalogCache.nextPrefetchToken();
    const gameDomain = this.getGame();
    try {
      const nodes = await fetchModListingNodesForGame(this.props.api, gameDomain, ids);
      if (this.catalogCache.isPrefetchStale(token)) {
        return;
      }
      this.catalogCache.storeModTiles(ids, nodes);
    } catch (err) {
      logEnhancerError('prefetchModTiles', err, { gameDomain, count: ids.length });
    }
  }

  prefetchTrackedCatalogTiles = async (modIds?: number[]) => {
    const ids = modIds && modIds.length > 0 ? modIds : this.getTrackedCatalogPrefetchModIds();
    await this.prefetchModTiles(ids);
  }

  prefetchInstalledCatalogTiles = async (modIds?: number[]) => {
    const ids = modIds && modIds.length > 0 ? modIds : this.getInstalledCatalogPrefetchModIds();
    await this.prefetchModTiles(ids);
  }

  prefetchAllCatalogTiles = async () => {
    await Promise.all([
      this.prefetchTrackedCatalogTiles(),
      this.prefetchInstalledCatalogTiles(),
    ]);
  }

  private syncCatalogCacheAfterTrackedChange(nextTracked: { [modId: string]: boolean }) {
    const nextIds = BrowseCatalogCache.getTrackedModIds(nextTracked);
    const nextKey = BrowseCatalogCache.buildModIdListKey(nextIds);
    if (nextKey !== this.lastSyncedTrackedKey) {
      this.catalogCache.pruneExcept([
        ...nextIds,
        ...BrowseCatalogCache.getInstalledModIds(toInstalledModsPayload(getInstalledNexusMods(this.props.api))),
      ]);
      this.lastSyncedTrackedKey = nextKey;
      void this.prefetchTrackedCatalogTiles(nextIds.length > 0
        ? BrowseCatalogCache.pageSlice(nextIds, this.getCatalogPageSize())
        : []);
      this.refreshEnhancement(50);
    }
  }

  private syncCatalogCacheAfterInstalledChange(installed: InstalledModsPayload) {
    const nextIds = BrowseCatalogCache.getInstalledModIds(installed);
    const nextKey = BrowseCatalogCache.buildModIdListKey(nextIds);
    if (nextKey !== this.lastSyncedInstalledKey) {
      this.catalogCache.pruneExcept([
        ...nextIds,
        ...BrowseCatalogCache.getTrackedModIds(this.state.trackedModIds),
      ]);
      this.lastSyncedInstalledKey = nextKey;
      void this.prefetchInstalledCatalogTiles(nextIds.length > 0
        ? BrowseCatalogCache.pageSlice(nextIds, this.getCatalogPageSize())
        : []);
    }
  }

  startBackgroundCatalogSync() {
    if (this.backgroundSyncTimer) {
      return;
    }
    const tick = () => {
      void this.runBackgroundCatalogSync();
      this.backgroundSyncTimer = setTimeout(tick, 45000);
    };
    void this.runBackgroundCatalogSync();
    this.backgroundSyncTimer = setTimeout(tick, 45000);
  }

  stopBackgroundCatalogSync() {
    if (this.backgroundSyncTimer) {
      clearTimeout(this.backgroundSyncTimer);
      this.backgroundSyncTimer = null;
    }
  }

  runBackgroundCatalogSync = async () => {
    if (this.backgroundSyncInFlight || !isNexusLoggedIn(this.props.api)) {
      return;
    }
    this.backgroundSyncInFlight = true;
    try {
      await this.loadTrackedModIds({ quiet: true });
      await this.prefetchAllCatalogTiles();
      if (this.state.onlyTracked || this.state.onlyInstalled ||
          this.state.hideInstalled || this.state.hideTracked) {
        this.refreshEnhancement(50);
      }
    } catch (err) {
      logEnhancerError('runBackgroundCatalogSync', err);
    } finally {
      this.backgroundSyncInFlight = false;
    }
  }

  getGame() {
    const api = this.props.api;
    const state = api.store.getState();
    const gameId = state.persistent.profiles[state.settings.profiles.activeProfileId].gameId;
    const nexusPage = util.nexusGameId(undefined, gameId);

    return nexusPage;
  }

  outsideSitesNotAllowedDialog() {
    const api = this.props.api;
    api.showDialog("error",
      "Outside sites not allowed",
      {
        md: "I'm sorry, but for security reasons you cannot browse outside Nexusmods sites",

      },
      [{ label: "Ok, I understand" }],
      );
  }

  buildEnhancerConfig(): EnhancerConfig {
    const installed = toInstalledModsPayload(getInstalledNexusMods(this.props.api));
    const gameDomain = this.getGame();
    const trackedModIdsForUids = this.state.onlyTracked
      ? Object.keys(this.state.trackedModIds)
          .map((modKey) => parseInt(modKey, 10))
          .filter((modId) => Number.isFinite(modId) && modId > 0 && !!this.state.trackedModIds[String(modId)])
      : this.lastVisibleModIds;
    return {
      installed,
      hideInstalled: this.state.hideInstalled,
      onlyInstalled: this.state.onlyInstalled,
      hideTracked: this.state.hideTracked,
      onlyTracked: this.state.onlyTracked,
      gridColumns: this.state.gridColumns,
      gridRows: this.state.gridRows,
      applyDefaultFilters: true,
      hideSiteChrome: this.state.hideSiteChrome,
      downloading: this.state.downloadingModIds,
      installing: toInProgressModsPayload(getInProgressNexusMods(this.props.api)),
      dependencies: this.state.dependencyInfo,
      modUids: buildModUidMap(gameDomain, trackedModIdsForUids),
      gameNumericId: lookupNumericNexusGameId(gameDomain) || undefined,
      tracked: this.state.trackedModIds,
      endorsed: this.state.endorsedModIds,
      viewerDownloaded: this.state.viewerDownloadedModIds,
      trackedListLoaded: this.state.trackedListLoaded,
    };
  }

  scheduleDependencyFetch(modIds: number[]) {
    const unique = Array.from(new Set(modIds.filter((modId) => modId > 0))).sort((a, b) => a - b);
    const requestKey = unique.join(',');

    if (!requestKey || requestKey === this.lastDependencyRequestKey) {
      return;
    }

    this.lastDependencyRequestKey = requestKey;
    this.lastVisibleModIds = unique;

    if (this.dependencyFetchTimer) {
      clearTimeout(this.dependencyFetchTimer);
    }

    this.dependencyFetchTimer = setTimeout(() => {
      this.dependencyFetchTimer = null;
      this.loadDependencies(unique);
    }, 150);
  }

  loadDependencies = async (modIds: number[]) => {
    const token = ++this.dependencyFetchToken;

    try {
      const summaries = await fetchDependencySummaries(this.props.api, modIds);
      if (token !== this.dependencyFetchToken) {
        return;
      }

      this.setState({ dependencyInfo: summaries }, () => this.refreshEnhancement(50));
    } catch (err) {
      logEnhancerError('loadDependencies', err);
    }
  }

  loadTrackedModIds = async (options?: { quiet?: boolean }) => {
    if (!isNexusLoggedIn(this.props.api)) {
      return;
    }

    const token = ++this.trackedLoadToken;
    const gameDomain = this.getGame();

    try {
      const tracked = await fetchTrackedModIdsForGame(this.props.api, gameDomain);
      if (token !== this.trackedLoadToken) {
        return;
      }

      const prevKey = this.lastSyncedTrackedKey;
      this.setState((prev) => {
        const nextTracked = Object.keys(tracked).length > 0
          ? Object.assign({}, prev.trackedModIds, tracked)
          : prev.trackedModIds;
        return {
          trackedModIds: nextTracked,
          trackedListLoaded: true,
        };
      }, () => {
        this.syncCatalogCacheAfterTrackedChange(this.state.trackedModIds);
        void this.prefetchTrackedCatalogTiles();
        const trackedChanged = this.lastSyncedTrackedKey !== prevKey;
        if (!options?.quiet || trackedChanged) {
          this.refreshEnhancement(options?.quiet && !this.state.onlyTracked ? 50 : 0);
        }
        const rawCount = Object.keys(this.state.trackedModIds).filter((key) => !!this.state.trackedModIds[key]).length;
        logEnhancerInfo('loadTrackedModIds applied', {
          gameDomain,
          rawCount,
          onlyTracked: this.state.onlyTracked,
        });
      });
    } catch (err) {
      logEnhancerError('loadTrackedModIds', err, { gameDomain });
    }
  }

  scheduleViewerStateFetch(modIds: number[]) {
    const unique = Array.from(new Set(modIds.filter((modId) => modId > 0)));
    if (unique.length === 0 || !isNexusLoggedIn(this.props.api)) {
      return;
    }

    if (this.viewerStateFetchTimer) {
      clearTimeout(this.viewerStateFetchTimer);
    }

    this.viewerStateFetchTimer = setTimeout(async () => {
      this.viewerStateFetchTimer = null;
      try {
        const gameDomain = this.getGame();
        const state = await fetchViewerModStateViaVortex(this.props.api, gameDomain, unique);
        this.setState((prev) => ({
          trackedModIds: prev.onlyTracked
            ? prev.trackedModIds
            : Object.assign({}, prev.trackedModIds, state.tracked || {}),
          endorsedModIds: Object.assign({}, prev.endorsedModIds, state.endorsed || {}),
          viewerDownloadedModIds: Object.assign({}, prev.viewerDownloadedModIds, state.downloaded || {}),
        }), () => this.refreshEnhancement(50));
      } catch (err) {
        logEnhancerError('scheduleViewerStateFetch', err);
      }
    }, 500);
  }

  handleToggleTrack = async (modId: number, currentlyTracked: boolean) => {
    const modKey = String(modId);
    const nextTracked = !currentlyTracked;
    const gameDomain = this.getGame();

    try {
      const success = await toggleTrackModViaVortex(this.props.api, gameDomain, modId, nextTracked);
      if (success) {
        this.setState((prev) => ({
          trackedModIds: Object.assign({}, prev.trackedModIds, { [modKey]: nextTracked }),
        }), () => {
          if (!nextTracked) {
            this.catalogCache.invalidateModIds([modId]);
          }
          this.syncCatalogCacheAfterTrackedChange(this.state.trackedModIds);
          void this.prefetchTrackedCatalogTiles();
          this.refreshEnhancement(0);
          this.bridge.showToast(nextTracked ? 'Mod tracked' : 'Mod untracked');
          setTimeout(() => {
            this.bridge.clearPending('track', modId);
          }, 300);
        });
        return;
      }

      this.bridge.showToast('Could not update track status');
      this.bridge.clearPending('track', modId);
      this.refreshEnhancement(10);
    } catch (err) {
      logEnhancerError('handleToggleTrack', err, { modId });
      this.bridge.showToast('Could not update track status');
      this.bridge.clearPending('track', modId);
      this.refreshEnhancement(10);
    }
  }

  handleToggleEndorse = async (modId: number, currentlyEndorsed: boolean) => {
    const modKey = String(modId);
    const nextEndorsed = !currentlyEndorsed;
    const gameDomain = this.getGame();

    try {
      const success = await toggleEndorseModViaVortex(this.props.api, gameDomain, modId, nextEndorsed);
      if (success) {
        this.setState((prev) => ({
          endorsedModIds: Object.assign({}, prev.endorsedModIds, { [modKey]: nextEndorsed }),
        }), () => {
          this.refreshEnhancement(0);
          this.bridge.showToast(nextEndorsed ? 'Mod endorsed' : 'Endorsement removed');
          setTimeout(() => {
            this.bridge.clearPending('endorse', modId);
          }, 300);
        });
        return;
      }

      this.bridge.showToast('Could not update endorsement');
      this.bridge.clearPending('endorse', modId);
      this.refreshEnhancement(10);
    } catch (err) {
      logEnhancerError('handleToggleEndorse', err, { modId });
      this.bridge.showToast('Could not update endorsement');
      this.bridge.clearPending('endorse', modId);
      this.refreshEnhancement(10);
    }
  }

  refreshEnhancement(delay: number = 250) {
    if (!this.state.tabActive) {
      return;
    }
    try {
      const installed = getInstalledNexusMods(this.props.api);
      const config = this.buildEnhancerConfig();
      logEnhancerInfo('refreshEnhancement', {
        installedCount: installed.size,
        hideInstalled: config.hideInstalled,
        onlyInstalled: config.onlyInstalled,
        hideTracked: config.hideTracked,
        onlyTracked: config.onlyTracked,
        trackedCount: Object.keys(config.tracked || {}).length,
        downloadingCount: Object.keys(config.downloading || {}).length,
      });
      this.bridge.scheduleInject(config, delay);
    } catch (err) {
      logEnhancerError('refreshEnhancement', err);
    }
  }

  handleBridgeMessage = async (message: string) => {
    const payload = parseBridgeMessage(message);
    if (!payload) {
      return;
    }

    if (payload.type === 'install-mod') {
      const modKey = String(payload.modId);
      if (this.state.downloadingModIds[modKey]) {
        logEnhancerInfo('install-mod ignored (already pending)', { modId: payload.modId });
        return;
      }

      logEnhancerInfo('install-mod requested', { modId: payload.modId });

      this.setState((prev) => ({
        downloadingModIds: Object.assign({}, prev.downloadingModIds, { [modKey]: true }),
      }), () => this.refreshEnhancement(10));

      void safeInstallModFromBrowse(this.props.api, payload.modId).finally(() => {
        this.setState((prev) => {
          const nextDownloading = Object.assign({}, prev.downloadingModIds);
          delete nextDownloading[modKey];
          return { downloadingModIds: nextDownloading };
        }, () => {
          this.refreshEnhancement(50);
          setTimeout(() => this.refreshEnhancement(200), 400);
        });
      });
      return;
    }

    if (payload.type === 'visible-mods') {
      this.lastVisibleModIds = payload.modIds;
      this.scheduleDependencyFetch(payload.modIds);
      this.scheduleViewerStateFetch(payload.modIds);
      if (!this.state.onlyTracked && !this.state.onlyInstalled) {
        this.refreshEnhancement(50);
      }
    }

    if (payload.type === 'track-state') {
      const tracked = payload.tracked || {};
      this.setState((prev) => ({
        trackedModIds: Object.assign({}, prev.trackedModIds, tracked),
        trackedListLoaded: true,
      }), () => {
        this.syncCatalogCacheAfterTrackedChange(this.state.trackedModIds);
        void this.prefetchTrackedCatalogTiles();
        this.refreshEnhancement(this.state.onlyTracked ? 0 : 50);
      });
    }

    if (payload.type === 'viewer-state') {
      this.setState((prev) => {
        const incomingTracked = payload.tracked || {};

        return {
          trackedModIds: Object.assign({}, prev.trackedModIds, incomingTracked),
          trackedListLoaded: prev.trackedListLoaded || Object.keys(incomingTracked).length > 0,
          endorsedModIds: Object.assign({}, prev.endorsedModIds, payload.endorsed || {}),
          viewerDownloadedModIds: Object.assign({}, prev.viewerDownloadedModIds, payload.downloaded || {}),
        };
      }, () => {
        if (this.state.onlyTracked || this.state.onlyInstalled) {
          this.refreshEnhancement(0);
        } else {
          this.refreshEnhancement(50);
        }
      });
    }

    if (payload.type === 'track-mod') {
      const modKey = String(payload.modId);
      this.setState((prev) => ({
        trackedModIds: Object.assign({}, prev.trackedModIds, { [modKey]: !!payload.tracked }),
      }), () => {
        if (!payload.tracked) {
          this.catalogCache.invalidateModIds([payload.modId]);
        }
        this.syncCatalogCacheAfterTrackedChange(this.state.trackedModIds);
        void this.prefetchTrackedCatalogTiles();
        this.refreshEnhancement(this.state.onlyTracked ? 0 : 10);
      });
    }

    if (payload.type === 'endorse-mod') {
      const modKey = String(payload.modId);
      this.setState((prev) => ({
        endorsedModIds: Object.assign({}, prev.endorsedModIds, { [modKey]: !!payload.endorsed }),
      }), () => this.refreshEnhancement(10));
    }

    if (payload.type === 'toggle-track') {
      await this.handleToggleTrack(payload.modId, payload.tracked);
      return;
    }

    if (payload.type === 'toggle-endorse') {
      await this.handleToggleEndorse(payload.modId, payload.endorsed);
      return;
    }

    if (payload.type === 'filter-toggle') {
      this.handleFilterToggle(payload.filter);
      return;
    }

    if (payload.type === 'filter-set') {
      this.handleFilterSet(payload.filter, payload.enabled);
      return;
    }

    if (payload.type === 'grid-layout') {
      this.handleGridLayout(payload.columns, payload.rows);
    }

    if (payload.type === 'fetch-mod-tiles') {
      const cached = this.catalogCache.resolveModTiles(payload.modIds);
      if (cached && cached.length === payload.modIds.length) {
        await this.bridge.deliverModTiles(payload.requestId, cached);
        return;
      }

      const gameDomain = this.getGame();
      try {
        const nodes = await fetchModListingNodesForGame(
          this.props.api,
          gameDomain,
          payload.modIds,
        );
        if (nodes.length > 0) {
          this.catalogCache.storeModTiles(payload.modIds, nodes);
        }
        await this.bridge.deliverModTiles(payload.requestId, nodes);
      } catch (err) {
        logEnhancerError('fetch-mod-tiles failed', err, {
          requestId: payload.requestId,
          modCount: payload.modIds.length,
        });
        await this.bridge.deliverModTiles(payload.requestId, []);
      }
      return;
    }

    if (payload.type === 'browse-navigate') {
      this.handleBrowseNavigate(payload.url);
    }
  }

  onWebviewConsoleMessage = (event: any) => {
    const message = event && (event.message || event.detail);
    if (typeof message === 'string') {
      this.handleBridgeMessage(message);
    }
  }

  onWebviewFinishLoad = () => {
    const webview = this.webView.ref && this.webView.ref.mNode;
    const src = webview && webview.src ? webview.src : this.webView.currentUrl;
    if (!src || src.indexOf('nexusmods.com') < 0 || src.indexOf('/mods') < 0) {
      return;
    }

    this.bridge.resetBootstrap();
    this.rememberCurrentWebviewUrl(src);
    if (this.state.onlyTracked && Object.keys(this.state.trackedModIds).length === 0) {
      void this.loadTrackedModIds();
    }
    this.refreshEnhancement(400);
    setTimeout(() => this.refreshEnhancement(200), 1800);
  }

  onWebviewDomReady = () => {
    if (!this.webView.ref || !this.webView.ref.mNode) {
      return;
    }

    const src = this.webView.ref.mNode.src;
    if (src.includes("nexusmods.com/")) {
      this.webView.currentUrl = src;
      rememberBrowseUrl(src);
      this.bridge.setWebview(this.webView.ref.mNode);
      this.bridge.resetBootstrap();
      this.refreshEnhancement(100);
      setTimeout(() => this.refreshEnhancement(200), 1500);
      if (this.shouldApplyDefaultFilters) {
        this.shouldApplyDefaultFilters = false;
      }
    } else {
      console.log("Attempted to leave Nexus sites");
      this.webView.ref.mNode.goBack();
      this.outsideSitesNotAllowedDialog();
    }
  }

  private isBrowseQueryOnlyChange(previousUrl: string, nextUrl: string): boolean {
    if (!previousUrl || !nextUrl) {
      return false;
    }

    try {
      const previous = new URL(previousUrl);
      const next = new URL(nextUrl);
      return previous.origin === next.origin && previous.pathname === next.pathname;
    } catch (err) {
      return false;
    }
  }

  private rememberCurrentWebviewUrl(url: string) {
    if (!url) {
      return;
    }
    rememberBrowseUrl(url);
    this.webView.currentUrl = url;
  }

  private scheduleBrowseEnhancementAfterNavigation(baseDelay: number = 1200) {
    this.bridge.resetBootstrap();
    if (this.browseEnhancementTimer) {
      clearTimeout(this.browseEnhancementTimer);
      this.browseEnhancementTimer = null;
    }

    const retryDelays = [baseDelay, baseDelay + 1400, baseDelay + 3200];
    retryDelays.forEach((delay) => {
      setTimeout(() => {
        this.bridge.finalizeBrowseContext().catch(() => undefined);
        this.refreshEnhancement(250);
      }, delay);
    });
  }

  private handleBrowseNavigate(url: string) {
    const webview = this.webView.ref && this.webView.ref.mNode;
    if (!webview || !url) {
      return;
    }

    if (url.indexOf('nexusmods.com') < 0) {
      logEnhancerInfo('browse-navigate rejected (non-nexus url)', { url });
      return;
    }

    logEnhancerInfo('browse-navigate requested', { url });
    this.bridge.resetBootstrap();

    let displayUrl = url;
    try {
      const parsed = new URL(url);
      parsed.searchParams.delete('_vortex_reload');
      displayUrl = parsed.href;
    } catch (err) {
      displayUrl = url;
    }
    this.rememberCurrentWebviewUrl(displayUrl);

    const previousUrl = this.webView.currentUrl || (webview.src ? String(webview.src) : '');
    const queryOnly = this.isBrowseQueryOnlyChange(previousUrl, url);

    if (queryOnly && typeof webview.executeJavaScript === 'function') {
      const script = `window.location.replace(${JSON.stringify(url)});`;
      webview.executeJavaScript(script).catch(() => {
        webview.src = url;
      });
    } else {
      webview.src = url;
    }

    this.scheduleBrowseEnhancementAfterNavigation(1500);
  }

  onWebviewNavigateInPage = () => {
    const webview = this.webView.ref && this.webView.ref.mNode;
    const nextUrl = webview && webview.src ? webview.src : this.webView.currentUrl;
    if (nextUrl) {
      this.rememberCurrentWebviewUrl(nextUrl);
    }
    this.scheduleBrowseEnhancementAfterNavigation();
  }

  onWebviewNavigate = (event: any) => {
    const webview = this.webView.ref && this.webView.ref.mNode;
    const nextUrl = webview && webview.src ? webview.src : this.webView.currentUrl;
    const previousUrl = this.webView.currentUrl || '';
    const inPage = event && event.type === 'did-navigate-in-page';

    if (nextUrl) {
      this.rememberCurrentWebviewUrl(nextUrl);
    }

    if (inPage || this.isBrowseQueryOnlyChange(previousUrl, nextUrl || '')) {
      this.scheduleBrowseEnhancementAfterNavigation();
      return;
    }

    this.bridge.resetBootstrap();
    this.refreshEnhancement(400);
  }

  getWebviewSrc(): string {
    const game = this.getGame();
    const resolvedSlug = this.resolvedWebviewSrc
      ? extractGameSlugFromBrowseUrl(this.resolvedWebviewSrc)
      : null;
    if (!this.resolvedWebviewSrc || !resolvedSlug || resolvedSlug !== game) {
      clearBrowseSessionIfGameMismatch(game);
      this.resolvedWebviewSrc = resolveBrowseWebviewSrc(game);
    }
    return this.resolvedWebviewSrc;
  }

  navigateToActiveGame(gameSlug?: string) {
    const game = gameSlug || this.getGame();
    if (!game) {
      return;
    }

    clearBrowseSessionIfGameMismatch(game);
    this.resolvedWebviewSrc = buildDefaultBrowseUrl(game);
    this.lastVisibleModIds = [];
    this.lastDependencyRequestKey = '';
    this.bridge.resetBootstrap();
    this.catalogCache.clear();
    this.lastSyncedTrackedKey = '';
    this.lastSyncedInstalledKey = '';

    this.setState({
      dependencyInfo: {},
      trackedModIds: {},
      endorsedModIds: {},
      viewerDownloadedModIds: {},
      downloadingModIds: {},
      trackedListLoaded: false,
    });

    this.loadTrackedModIds();

    const webview = this.webView.ref && this.webView.ref.mNode;
    if (webview) {
      webview.src = this.resolvedWebviewSrc;
      this.webView.currentUrl = this.resolvedWebviewSrc;
    }

    this.refreshEnhancement(300);
  }

  subscribeToActiveGame() {
    const api = this.props.api;
    this.lastKnownGameSlug = this.getGame();

    this.gameWatchUnsubscribe = api.store.subscribe(() => {
      const nextGame = this.getGame();
      if (!nextGame || nextGame === this.lastKnownGameSlug) {
        return;
      }

      logEnhancerInfo('Active Vortex game changed while Browse open', {
        from: this.lastKnownGameSlug,
        to: nextGame,
      });
      this.lastKnownGameSlug = nextGame;
      this.navigateToActiveGame(nextGame);
    });
  }

  ensureWebviewMatchesActiveGame() {
    const expected = this.getGame();
    const webview = this.webView.ref && this.webView.ref.mNode;
    const currentSrc = webview && webview.src ? webview.src : this.webView.currentUrl;
    if (!expected || !currentSrc || !currentSrc.includes('nexusmods.com')) {
      return;
    }

    if (!extractGameSlugFromBrowseUrl(currentSrc) || !urlsMatchGame(currentSrc, expected)) {
      logEnhancerInfo('Browse webview game mismatch; reloading for active game', {
        expected,
        current: currentSrc,
      });
      this.navigateToActiveGame(expected);
    }
  }

  handleFilterSet = (filter: FilterToggleName, enabled: boolean) => {
    this.setState((prev) => {
      const next = {
        hideInstalled: prev.hideInstalled,
        onlyInstalled: prev.onlyInstalled,
        hideTracked: prev.hideTracked,
        onlyTracked: prev.onlyTracked,
      };

      if (filter === 'hideInstalled') {
        next.hideInstalled = enabled;
        if (enabled) {
          next.onlyInstalled = false;
        }
      } else if (filter === 'onlyInstalled') {
        next.onlyInstalled = enabled;
        if (enabled) {
          next.hideInstalled = false;
        }
      } else if (filter === 'hideTracked') {
        next.hideTracked = enabled;
        if (enabled) {
          next.onlyTracked = false;
        }
      } else if (filter === 'onlyTracked') {
        next.onlyTracked = enabled;
        if (enabled) {
          next.hideTracked = false;
          const trackedCount = Object.keys(prev.trackedModIds).filter((key) => !!prev.trackedModIds[key]).length;
          if (trackedCount === 0) {
            next.trackedListLoaded = false;
          }
        }
      }

      return next;
    }, () => {
      this.refreshEnhancement(0);
      if (this.state.onlyTracked || this.state.onlyInstalled) {
        void this.prefetchLocalCatalogPage0();
      }
      if (filter === 'onlyTracked' && enabled) {
        const trackedCount = Object.keys(this.state.trackedModIds)
          .filter((key) => !!this.state.trackedModIds[key]).length;
        if (trackedCount === 0) {
          void this.loadTrackedModIds();
        }
      }
      logEnhancerInfo('Filter set from sidebar', {
        filter,
        enabled,
        hideInstalled: this.state.hideInstalled,
        onlyInstalled: this.state.onlyInstalled,
        hideTracked: this.state.hideTracked,
        onlyTracked: this.state.onlyTracked,
      });
    });
  }

  handleFilterToggle = (filter: FilterToggleName) => {
    this.setState((prev) => {
      const next = {
        hideInstalled: prev.hideInstalled,
        onlyInstalled: prev.onlyInstalled,
        hideTracked: prev.hideTracked,
        onlyTracked: prev.onlyTracked,
      };

      if (filter === 'hideInstalled') {
        next.hideInstalled = !prev.hideInstalled;
        next.onlyInstalled = false;
      } else if (filter === 'onlyInstalled') {
        next.onlyInstalled = !prev.onlyInstalled;
        next.hideInstalled = false;
      } else if (filter === 'hideTracked') {
        next.hideTracked = !prev.hideTracked;
        next.onlyTracked = false;
      } else if (filter === 'onlyTracked') {
        next.onlyTracked = !prev.onlyTracked;
        next.hideTracked = false;
        if (next.onlyTracked) {
          const trackedCount = Object.keys(prev.trackedModIds).filter((key) => !!prev.trackedModIds[key]).length;
          if (trackedCount === 0) {
            next.trackedListLoaded = false;
          }
        }
      }

      return next;
    }, () => {
      this.refreshEnhancement(0);
      if (filter === 'onlyTracked' && this.state.onlyTracked) {
        void this.prefetchTrackedCatalogTiles();
        void this.loadTrackedModIds();
      } else if (filter === 'onlyInstalled' && this.state.onlyInstalled) {
        void this.prefetchInstalledCatalogTiles();
      }
      logEnhancerInfo('Filter toggled from sidebar', {
        hideInstalled: this.state.hideInstalled,
        onlyInstalled: this.state.onlyInstalled,
        hideTracked: this.state.hideTracked,
        onlyTracked: this.state.onlyTracked,
      });
    });
  }

  handleGridLayout = (columns?: number, rows?: number) => {
    this.setState((prev) => {
      const nextColumns = columns !== undefined
        ? Math.max(4, Math.min(14, columns))
        : prev.gridColumns;
      const nextRows = rows !== undefined
        ? Math.max(2, Math.min(8, rows))
        : prev.gridRows;
      return { gridColumns: nextColumns, gridRows: nextRows };
    }, () => this.refreshEnhancement(50));
  }

  onWebviewMouseUp = (event: MouseEvent) => {
    this.handleMouseNavigation(event);
  }

  onWebviewAuxClick = (event: MouseEvent) => {
    this.handleMouseNavigation(event);
  }

  handleMouseNavigation(event: MouseEvent) {
    const webview = this.webView.ref && this.webView.ref.mNode;
    if (!webview) {
      return;
    }

    if (event.button === 3) {
      if (webview.canGoBack()) {
        event.preventDefault();
        event.stopPropagation();
        webview.goBack();
      }
      return;
    }

    if (event.button === 4) {
      if (webview.canGoForward()) {
        event.preventDefault();
        event.stopPropagation();
        webview.goForward();
      }
    }
  }

  attachWebviewListeners(webview: any) {
    if (!webview || this.webviewListenersAttached) {
      return;
    }

    webview.addEventListener('dom-ready', this.onWebviewDomReady);
    webview.addEventListener('did-finish-load', this.onWebviewFinishLoad);
    webview.addEventListener('did-navigate-in-page', this.onWebviewNavigateInPage);
    webview.addEventListener('did-navigate', this.onWebviewNavigate);
    webview.addEventListener('mouseup', this.onWebviewMouseUp);
    webview.addEventListener('auxclick', this.onWebviewAuxClick);
    webview.addEventListener('console-message', this.onWebviewConsoleMessage);
    this.webviewListenersAttached = true;
  }

  detachWebviewListeners(webview: any) {
    if (!webview || !this.webviewListenersAttached) {
      return;
    }

    webview.removeEventListener('dom-ready', this.onWebviewDomReady);
    webview.removeEventListener('did-finish-load', this.onWebviewFinishLoad);
    webview.removeEventListener('did-navigate-in-page', this.onWebviewNavigateInPage);
    webview.removeEventListener('did-navigate', this.onWebviewNavigate);
    webview.removeEventListener('mouseup', this.onWebviewMouseUp);
    webview.removeEventListener('auxclick', this.onWebviewAuxClick);
    webview.removeEventListener('console-message', this.onWebviewConsoleMessage);
    this.webviewListenersAttached = false;
  }

  setHideInstalled = () => { this.handleFilterToggle('hideInstalled'); }
  setOnlyInstalled = () => { this.handleFilterToggle('onlyInstalled'); }
  setHideTracked = () => { this.handleFilterToggle('hideTracked'); }
  setOnlyTracked = () => { this.handleFilterToggle('onlyTracked'); }

  subscribeToModChanges() {
    const api = this.props.api;
    if (!api.store) {
      return;
    }

    let lastInstalledSnapshot = JSON.stringify(toInstalledModsPayload(getInstalledNexusMods(api)));
    let lastProgressSnapshot = JSON.stringify(toInProgressModsPayload(getInProgressNexusMods(api)));

    this.storeUnsubscribe = api.store.subscribe(() => {
      const installedPayload = toInstalledModsPayload(getInstalledNexusMods(api));
      const progressPayload = toInProgressModsPayload(getInProgressNexusMods(api));
      const nextInstalledSnapshot = JSON.stringify(installedPayload);
      const nextProgressSnapshot = JSON.stringify(progressPayload);
      if (nextInstalledSnapshot === lastInstalledSnapshot &&
          nextProgressSnapshot === lastProgressSnapshot) {
        return;
      }

      lastInstalledSnapshot = nextInstalledSnapshot;
      lastProgressSnapshot = nextProgressSnapshot;
      this.lastDependencyRequestKey = '';
      this.scheduleDependencyFetch(this.lastVisibleModIds);
      this.syncCatalogCacheAfterInstalledChange(installedPayload);
      const filterActive = this.state.onlyInstalled || this.state.hideInstalled ||
        this.state.onlyTracked || this.state.hideTracked;
      this.refreshEnhancement(filterActive ? 0 : 100);
    });
  }

  toggleHideSiteChrome = () => {
    this.setState((prev) => ({ hideSiteChrome: !prev.hideSiteChrome }), () => {
      this.refreshEnhancement(50);
    });
  }

  private handleTabVisibilityChange = () => {
    const pageId = this.props.browsePageId || 'Browse';
    const nextActive = BrowseView.isBrowseTabActive(this.props.api, pageId);
    if (nextActive === this.state.tabActive) {
      return;
    }

    if (!nextActive) {
      logEnhancerInfo('Browse tab deactivated', { pageId });
      void this.bridge.setTabActive(false);
    }

    this.setState({ tabActive: nextActive }, () => {
      if (nextActive) {
        logEnhancerInfo('Browse tab activated', { pageId });
        this.ensureWebviewLoaded();
        setTimeout(() => this.refreshEnhancement(200), 100);
      }
    });
  }

  private ensureWebviewLoaded() {
    const webview = this.webView.ref && this.webView.ref.mNode;
    const src = this.getWebviewSrc();
    if (!webview || !src) {
      return;
    }

    const current = webview.src ? String(webview.src) : '';
    if (!current || current === 'about:blank' || current.indexOf('nexusmods.com') < 0) {
      webview.src = src;
      this.webView.currentUrl = src;
      rememberBrowseUrl(src);
      this.bridge.setWebview(webview);
      this.bridge.resetBootstrap();
    }
  }

  render() {
    const { tabActive } = this.state;
    const mainPageStyle: React.CSSProperties = {
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    };
    const webviewClassName = tabActive ? s.iframeStyle : `${s.iframeStyle} ${s.webviewHidden}`;
    return (
      <div className={tabActive ? s.pageRoot : s.pageRootInactive}>
      <MainPage ref={(mainPage) => { this.mainPage = mainPage; }} style={mainPageStyle}>
        <MainPage.Header ref={(header) => { this.header = header; }}>
          <div className={this.state.hideSiteChrome ? s.toolbarCompact : s.toolbarRow}>
            {!this.state.hideSiteChrome ? (
              <div className={s.navGroup}>
                <Button onClick={(event: React.MouseEvent<HTMLElement>) => {
                  if (this.webView.ref && this.webView.ref.mNode.canGoBack) {
                    this.webView.ref.mNode.goBack();
                    return true;
                  }
                  return false;
                }}>Back</Button>
                <Button onClick={(event: React.MouseEvent<HTMLElement>) => {
                  if (this.webView.ref && this.webView.ref.mNode.canGoForward) {
                    this.webView.ref.mNode.goForward();
                    return true;
                  }
                  return false;
                }}>Forward</Button>
                <Button onClick={(event: React.MouseEvent<HTMLElement>) => {
                  if (this.webView.ref) {
                    this.webView.ref.mNode.reload();
                    return true;
                  }
                  return false;
                }}>Refresh</Button>
              </div>
            ) : null}
            <Button
              bsStyle={this.state.hideSiteChrome ? 'success' : 'default'}
              onClick={this.toggleHideSiteChrome}
            >
              {this.state.hideSiteChrome ? 'Show' : 'Hide'}
            </Button>
            {!this.state.hideSiteChrome ? (
              <FormInput ref={(urlBar) => { this.urlBar = urlBar; }} className={s.addressBar} value={this.webView.currentUrl} readOnly onChange={(newValue: string) => { console.log(newValue); }}></FormInput>
            ) : null}
          </div>
        </MainPage.Header>
        <MainPage.Body className={s.pageBody}>
          <Webview autoFocus={tabActive} ref={(webView) => {
            this.webView.ref = webView;
            if (webView && webView.mNode) {
              this.attachWebviewListeners(webView.mNode);
              this.bridge.setWebview(webView.mNode);
            }
          }} src={this.getWebviewSrc()} className={webviewClassName}></Webview>
        </MainPage.Body>
      </MainPage>
      </div>
    );
  }

  componentDidUpdate(_prevProps: Props, prevState: BrowseViewState) {
    if (!prevState.tabActive && this.state.tabActive) {
      this.ensureWebviewLoaded();
    }
  }

  componentDidMount() {
    this.pageVisibilityUnsubscribe = this.props.api.store.subscribe(this.handleTabVisibilityChange);
    this.showMainPageHandler = (pageId: string) => {
      const ourId = this.props.browsePageId || BROWSE_PAGE_ID;
      if (pageId === ourId) {
        if (!this.state.tabActive) {
          this.setState({ tabActive: true }, () => {
            this.ensureWebviewLoaded();
            setTimeout(() => this.refreshEnhancement(200), 100);
          });
        } else {
          this.ensureWebviewLoaded();
        }
      } else if (this.state.tabActive) {
        void this.bridge.setTabActive(false);
        this.setState({ tabActive: false });
      }
    };
    this.props.api.events.on('show-main-page', this.showMainPageHandler);
    this.handleTabVisibilityChange();
    setTimeout(() => this.ensureWebviewLoaded(), 0);
    if (this.webView.ref && this.webView.ref.mNode) {
      this.attachWebviewListeners(this.webView.ref.mNode);
    }
    this.lastKnownGameSlug = this.getGame();
    this.subscribeToModChanges();
    this.subscribeToActiveGame();
    startVortexUiLayout();
    this.loadTrackedModIds();
    this.startBackgroundCatalogSync();
    setTimeout(() => {
      void this.prefetchAllCatalogTiles();
      this.ensureWebviewMatchesActiveGame();
    }, 500);
  }

  componentWillUnmount() {
    this.stopBackgroundCatalogSync();
    if (this.showMainPageHandler) {
      this.props.api.events.removeListener('show-main-page', this.showMainPageHandler);
      this.showMainPageHandler = null;
    }
    if (this.pageVisibilityUnsubscribe) {
      this.pageVisibilityUnsubscribe();
      this.pageVisibilityUnsubscribe = null;
    }
    this.bridge.setTabActive(false).catch(() => undefined);
    if (this.browseEnhancementTimer) {
      clearTimeout(this.browseEnhancementTimer);
      this.browseEnhancementTimer = null;
    }
    if (this.dependencyFetchTimer) {
      clearTimeout(this.dependencyFetchTimer);
      this.dependencyFetchTimer = null;
    }
    if (this.storeUnsubscribe) {
      this.storeUnsubscribe();
      this.storeUnsubscribe = null;
    }
    if (this.gameWatchUnsubscribe) {
      this.gameWatchUnsubscribe();
      this.gameWatchUnsubscribe = null;
    }
    if (this.webView.ref && this.webView.ref.mNode) {
      this.detachWebviewListeners(this.webView.ref.mNode);
    }
  }
}
