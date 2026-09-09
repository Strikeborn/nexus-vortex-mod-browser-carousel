import { types, util } from 'vortex-api';
import { getActiveGameId, getInstalledNexusMods } from './installedMods';
import { logEnhancerError, logEnhancerInfo } from './logger';
import { makeModUID, numericGameIdToDomain } from './modUid';

export interface ModDependencySummary {
  total: number;
  missing: number;
}

export type ModDependencyMap = {
  [nexusModId: string]: ModDependencySummary;
};

interface NexusRequirementNode {
  modId?: number | string;
  gameId?: number | string;
  externalRequirement?: boolean;
}

interface NexusRequirementsPayload {
  nexusRequirements?: {
    nodes?: NexusRequirementNode[];
  };
}

const DEP_CACHE_MS = 4 * 60 * 60 * 1000;
const BATCH_SIZE = 20;

const dependencyCache = new Map<string, { expires: number; value: ModDependencySummary }>();

function cacheKey(gameDomain: string, modId: number): string {
  return `${gameDomain}:${modId}`;
}

function getInstalledModIdsByGame(api: types.IExtensionApi): Map<string, Set<number>> {
  const state = api.store.getState();
  const modsTable = state.persistent.mods || {};
  const result = new Map<string, Set<number>>();

  Object.keys(modsTable).forEach((gameId) => {
    const installed = getInstalledNexusMods(api, gameId);
    result.set(gameId, new Set(Array.from(installed.keys())));
  });

  return result;
}

function resolveRequirementGameId(
  req: NexusRequirementNode,
  fallbackGameId: string,
  fallbackDomain: string,
): string {
  if (req.gameId !== undefined && req.gameId !== null && req.gameId !== '') {
    const numeric = parseInt(String(req.gameId), 10);
    if (!isNaN(numeric)) {
      const domain = numericGameIdToDomain(numeric);
      if (domain) {
        return domain;
      }
    }
  }

  return fallbackGameId || fallbackDomain;
}

function summarizeRequirements(
  payload: NexusRequirementsPayload | undefined,
  installedByGame: Map<string, Set<number>>,
  fallbackGameId: string,
  fallbackDomain: string,
): ModDependencySummary {
  const nodes = payload && payload.nexusRequirements && payload.nexusRequirements.nodes
    ? payload.nexusRequirements.nodes
    : [];

  let total = 0;
  let missing = 0;

  nodes.forEach((req) => {
    if (req.externalRequirement) {
      return;
    }

    const reqModId = parseInt(String(req.modId), 10);
    if (!reqModId || reqModId <= 0) {
      return;
    }

    total++;

    const reqGameId = resolveRequirementGameId(req, fallbackGameId, fallbackDomain);
    const installed = installedByGame.get(reqGameId);
    if (!installed || !installed.has(reqModId)) {
      missing++;
    }
  });

  return { total, missing };
}

function unwrapExtResult<T>(response: any): T {
  if (Array.isArray(response)) {
    return (response.length === 1 ? response[0] : response) as T;
  }
  return response as T;
}

async function fetchRequirementsBatch(
  api: types.IExtensionApi,
  uids: string[],
): Promise<Record<string, NexusRequirementsPayload>> {
  const nexusGetModRequirements = api.ext && api.ext.nexusGetModRequirements;
  if (typeof nexusGetModRequirements !== 'function') {
    return {};
  }

  const response = await nexusGetModRequirements(uids);
  return unwrapExtResult<Record<string, NexusRequirementsPayload>>(response) || {};
}

export async function fetchDependencySummaries(
  api: types.IExtensionApi,
  modIds: number[],
): Promise<ModDependencyMap> {
  const vortexGameId = getActiveGameId(api);
  const gameDomain = util.nexusGameId(undefined, vortexGameId);
  const installedByGame = getInstalledModIdsByGame(api);
  const result: ModDependencyMap = {};

  const pending: { modId: number; uid: string }[] = [];

  modIds.forEach((modId) => {
    if (!Number.isFinite(modId) || modId <= 0) {
      return;
    }

    const key = cacheKey(gameDomain, modId);
    const cached = dependencyCache.get(key);
    if (cached && cached.expires > Date.now()) {
      result[String(modId)] = cached.value;
      return;
    }

    const uid = makeModUID(gameDomain, modId);
    if (!uid) {
      return;
    }

    pending.push({ modId, uid });
  });

  if (pending.length === 0) {
    return result;
  }

  logEnhancerInfo('fetchDependencySummaries', {
    gameDomain,
    requested: modIds.length,
    pending: pending.length,
  });

  try {
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const uidList = batch.map((entry) => entry.uid);
      const response = await fetchRequirementsBatch(api, uidList);

      batch.forEach((entry) => {
        const summary = summarizeRequirements(
          response[entry.uid],
          installedByGame,
          vortexGameId,
          gameDomain,
        );
        const key = cacheKey(gameDomain, entry.modId);
        dependencyCache.set(key, { expires: Date.now() + DEP_CACHE_MS, value: summary });
        result[String(entry.modId)] = summary;
      });
    }
  } catch (err) {
    logEnhancerError('fetchDependencySummaries failed', err, { gameDomain });
  }

  return result;
}
