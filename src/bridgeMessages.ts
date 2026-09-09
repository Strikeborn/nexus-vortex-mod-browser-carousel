export interface InstallModMessage {
  type: 'install-mod';
  modId: number;
}

export interface VisibleModsMessage {
  type: 'visible-mods';
  modIds: number[];
}

export interface TrackStateMessage {
  type: 'track-state';
  tracked: { [modId: string]: boolean };
}

export interface ViewerStateMessage {
  type: 'viewer-state';
  tracked: { [modId: string]: boolean };
  endorsed: { [modId: string]: boolean };
  downloaded: { [modId: string]: boolean };
}

export interface TrackModMessage {
  type: 'track-mod';
  modId: number;
  tracked: boolean;
}

export interface EndorseModMessage {
  type: 'endorse-mod';
  modId: number;
  endorsed: boolean;
}

export interface ToggleTrackMessage {
  type: 'toggle-track';
  modId: number;
  tracked: boolean;
}

export interface ToggleEndorseMessage {
  type: 'toggle-endorse';
  modId: number;
  endorsed: boolean;
}

export type FilterToggleName = 'hideInstalled' | 'onlyInstalled' | 'hideTracked' | 'onlyTracked';

export interface FilterToggleMessage {
  type: 'filter-toggle';
  filter: FilterToggleName;
}

export interface FilterSetMessage {
  type: 'filter-set';
  filter: FilterToggleName;
  enabled: boolean;
}

export interface GridLayoutMessage {
  type: 'grid-layout';
  columns?: number;
  rows?: number;
}

export interface BrowseNavigateMessage {
  type: 'browse-navigate';
  url: string;
}

export interface FetchModTilesMessage {
  type: 'fetch-mod-tiles';
  requestId: string;
  modIds: number[];
}

export type BridgeMessage =
  | InstallModMessage
  | VisibleModsMessage
  | TrackStateMessage
  | ViewerStateMessage
  | TrackModMessage
  | EndorseModMessage
  | ToggleTrackMessage
  | ToggleEndorseMessage
  | FilterToggleMessage
  | FilterSetMessage
  | GridLayoutMessage
  | BrowseNavigateMessage
  | FetchModTilesMessage;

export const BRIDGE_LOG_PREFIX = '__VORTEX_ENHANCE__:';

export function parseBridgeMessage(raw: string): BridgeMessage | null {
  if (!raw || raw.indexOf(BRIDGE_LOG_PREFIX) !== 0) {
    return null;
  }

  try {
    const payload = JSON.parse(raw.slice(BRIDGE_LOG_PREFIX.length));
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    if (payload.type === 'install-mod') {
      const modId = parseInt(String(payload.modId), 10);
      if (!modId || modId <= 0) {
        return null;
      }
      return { type: 'install-mod', modId };
    }

    if (payload.type === 'visible-mods') {
      const modIds = Array.isArray(payload.modIds)
        ? payload.modIds
            .map((value: any) => parseInt(String(value), 10))
            .filter((value: number) => Number.isFinite(value) && value > 0)
        : [];
      return { type: 'visible-mods', modIds };
    }

    if (payload.type === 'track-state') {
      const tracked: { [modId: string]: boolean } = {};
      if (payload.tracked && typeof payload.tracked === 'object') {
        Object.keys(payload.tracked).forEach((key) => {
          tracked[key] = !!payload.tracked[key];
        });
      }
      return { type: 'track-state', tracked };
    }

    if (payload.type === 'viewer-state') {
      const tracked: { [modId: string]: boolean } = {};
      const endorsed: { [modId: string]: boolean } = {};
      const downloaded: { [modId: string]: boolean } = {};
      if (payload.tracked && typeof payload.tracked === 'object') {
        Object.keys(payload.tracked).forEach((key) => {
          tracked[key] = !!payload.tracked[key];
        });
      }
      if (payload.endorsed && typeof payload.endorsed === 'object') {
        Object.keys(payload.endorsed).forEach((key) => {
          endorsed[key] = !!payload.endorsed[key];
        });
      }
      if (payload.downloaded && typeof payload.downloaded === 'object') {
        Object.keys(payload.downloaded).forEach((key) => {
          downloaded[key] = !!payload.downloaded[key];
        });
      }
      return { type: 'viewer-state', tracked, endorsed, downloaded };
    }

    if (payload.type === 'track-mod') {
      const modId = parseInt(String(payload.modId), 10);
      if (!modId || modId <= 0) {
        return null;
      }
      return { type: 'track-mod', modId, tracked: !!payload.tracked };
    }

    if (payload.type === 'endorse-mod') {
      const modId = parseInt(String(payload.modId), 10);
      if (!modId || modId <= 0) {
        return null;
      }
      return { type: 'endorse-mod', modId, endorsed: !!payload.endorsed };
    }

    if (payload.type === 'toggle-track') {
      const modId = parseInt(String(payload.modId), 10);
      if (!modId || modId <= 0) {
        return null;
      }
      return { type: 'toggle-track', modId, tracked: !!payload.tracked };
    }

    if (payload.type === 'toggle-endorse') {
      const modId = parseInt(String(payload.modId), 10);
      if (!modId || modId <= 0) {
        return null;
      }
      return { type: 'toggle-endorse', modId, endorsed: !!payload.endorsed };
    }

    if (payload.type === 'filter-toggle') {
      const filter = payload.filter;
      if (filter !== 'hideInstalled' && filter !== 'onlyInstalled' &&
          filter !== 'hideTracked' && filter !== 'onlyTracked') {
        return null;
      }
      return { type: 'filter-toggle', filter };
    }

    if (payload.type === 'filter-set') {
      const filter = payload.filter;
      if (filter !== 'hideInstalled' && filter !== 'onlyInstalled' &&
          filter !== 'hideTracked' && filter !== 'onlyTracked') {
        return null;
      }
      return { type: 'filter-set', filter, enabled: !!payload.enabled };
    }

    if (payload.type === 'grid-layout') {
      const columns = payload.columns !== undefined
        ? parseInt(String(payload.columns), 10)
        : undefined;
      const rows = payload.rows !== undefined
        ? parseInt(String(payload.rows), 10)
        : undefined;
      return { type: 'grid-layout', columns, rows };
    }

    if (payload.type === 'fetch-mod-tiles') {
      const requestId = String(payload.requestId || '').trim();
      const modIds = Array.isArray(payload.modIds)
        ? payload.modIds
            .map((value: any) => parseInt(String(value), 10))
            .filter((value: number) => Number.isFinite(value) && value > 0)
        : [];
      if (!requestId || modIds.length === 0) {
        return null;
      }
      return { type: 'fetch-mod-tiles', requestId, modIds };
    }

    if (payload.type === 'browse-navigate') {
      const url = String(payload.url || '').trim();
      if (!url || url.indexOf('nexusmods.com') < 0) {
        return null;
      }
      return { type: 'browse-navigate', url };
    }
  } catch (err) {
    return null;
  }

  return null;
}
