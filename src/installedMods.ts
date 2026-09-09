import { types } from 'vortex-api';
import { IMod } from 'vortex-api/lib/extensions/mod_management/types/IMod';

export interface InstalledNexusMod {
  nexusModId: number;
  version?: string;
  name?: string;
}

export interface InstalledModsPayload {
  [nexusModId: string]: InstalledNexusMod;
}

const NEXUS_MOD_URL = /\/mods\/(\d+)(?:\/|$|\?|#)/i;

export function getActiveGameId(api: types.IExtensionApi): string {
  const state = api.store.getState();
  const profileId = state.settings.profiles.activeProfileId;
  return state.persistent.profiles[profileId].gameId;
}

function parseModIdFromNexusUrl(value: any): number | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const match = value.match(NEXUS_MOD_URL);
  if (!match) {
    return null;
  }

  const nexusModId = parseInt(match[1], 10);
  return isNaN(nexusModId) ? null : nexusModId;
}

function extractNexusModId(mod: IMod): number | null {
  const attrs = mod.attributes || {};

  const directFields = ['modId', 'sourceModId', 'nexusModId'];
  for (let i = 0; i < directFields.length; i++) {
    const raw = attrs[directFields[i]];
    if (raw !== undefined && raw !== null && raw !== '') {
      const direct = parseInt(String(raw), 10);
      if (!isNaN(direct)) {
        return direct;
      }
    }
  }

  const urlFields = ['url', 'modPageUrl', 'source', 'homepage', 'customUrl', 'referenceUrl', 'reference'];
  for (let i = 0; i < urlFields.length; i++) {
    const parsed = parseModIdFromNexusUrl(attrs[urlFields[i]]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export function getInstalledNexusMods(
  api: types.IExtensionApi,
  gameId?: string,
): Map<number, InstalledNexusMod> {
  const gid = gameId || getActiveGameId(api);
  const mods: { [modId: string]: IMod } =
    api.store.getState().persistent.mods[gid] || {};

  const result = new Map<number, InstalledNexusMod>();

  Object.keys(mods).forEach((modKey) => {
    const mod = mods[modKey];
    if (mod.state !== 'installed') {
      return;
    }

    const nexusModId = extractNexusModId(mod);
    if (nexusModId === null) {
      return;
    }

    if (!result.has(nexusModId)) {
      result.set(nexusModId, {
        nexusModId,
        version: mod.attributes?.version || mod.attributes?.modVersion,
        name: mod.attributes?.modName || mod.attributes?.logicalFileName,
      });
    }
  });

  return result;
}

export function toInstalledModsPayload(map: Map<number, InstalledNexusMod>): InstalledModsPayload {
  const payload: InstalledModsPayload = {};
  map.forEach((entry, nexusModId) => {
    payload[String(nexusModId)] = entry;
  });
  return payload;
}

export type InProgressModState = 'downloading' | 'downloaded' | 'installing';

export interface InProgressModsPayload {
  [nexusModId: string]: InProgressModState;
}

const IN_PROGRESS_MOD_STATES = new Set<InProgressModState>([
  'downloading',
  'downloaded',
  'installing',
]);

export function getInProgressNexusMods(
  api: types.IExtensionApi,
  gameId?: string,
): Map<number, InProgressModState> {
  const gid = gameId || getActiveGameId(api);
  const mods: { [modId: string]: IMod } =
    api.store.getState().persistent.mods[gid] || {};

  const result = new Map<number, InProgressModState>();

  Object.keys(mods).forEach((modKey) => {
    const mod = mods[modKey];
    const state = mod.state as InProgressModState;
    if (!IN_PROGRESS_MOD_STATES.has(state)) {
      return;
    }

    const nexusModId = extractNexusModId(mod);
    if (nexusModId === null) {
      return;
    }

    result.set(nexusModId, state);
  });

  return result;
}

export function toInProgressModsPayload(
  map: Map<number, InProgressModState>,
): InProgressModsPayload {
  const payload: InProgressModsPayload = {};
  map.forEach((state, nexusModId) => {
    payload[String(nexusModId)] = state;
  });
  return payload;
}
