import { types } from 'vortex-api';
import { lookupNumericNexusGameId, makeModUID } from './modUid';
import { logEnhancerError, logEnhancerInfo } from './logger';

const GRAPHQL_URL = 'https://api-router.nexusmods.com/graphql';
const NEXUS_REST = 'https://api.nexusmods.com/v1';
const USER_AGENT = 'Vortex/BuiltinModBrowserEnhanced/1.0.0';

interface NexusAccount {
  APIKey?: string;
  OAuthCredentials?: {
    token?: string;
    refreshToken?: string;
    fingerprint?: string;
  };
}

function getNexusAccount(state: any): NexusAccount | null {
  return (state && state.confidential && state.confidential.account && state.confidential.account.nexus)
    || null;
}

export function isNexusLoggedIn(api: types.IExtensionApi): boolean {
  const state = api.store.getState() as any;
  if (state && state.persistent && state.persistent.nexus && state.persistent.nexus.userInfo) {
    return true;
  }
  const account = getNexusAccount(state);
  return !!(account && (account.APIKey || (account.OAuthCredentials && account.OAuthCredentials.token)));
}

async function graphqlRequest(
  api: types.IExtensionApi,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<any | null> {
  const account = getNexusAccount(api.store.getState());
  const token = account && account.OAuthCredentials && account.OAuthCredentials.token;
  if (!token) {
    return null;
  }

  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-graphql-operationname': operationName,
    },
    body: JSON.stringify({
      query,
      variables,
      operationName,
    }),
  });

  return response.json();
}

async function restTrackMod(
  api: types.IExtensionApi,
  gameDomain: string,
  modId: number,
  track: boolean,
): Promise<boolean> {
  const account = getNexusAccount(api.store.getState());
  const apiKey = account && account.APIKey;
  if (!apiKey) {
    return false;
  }

  const headers: Record<string, string> = {
    apikey: apiKey,
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
  };

  const url = `${NEXUS_REST}/user/tracked_mods.json`;
  const params = new URLSearchParams({
    domain_name: gameDomain,
    mod_id: String(modId),
  });

  const response = track
    ? await fetch(url, {
      method: 'POST',
      headers: Object.assign({}, headers, {
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
      body: params.toString(),
    })
    : await fetch(`${url}?${params.toString()}`, {
      method: 'DELETE',
      headers,
    });

  logEnhancerInfo('restTrackMod', {
    gameDomain,
    modId,
    track,
    status: response.status,
  });

  return response.status === 200 || response.status === 201 || response.status === 204;
}

async function graphqlTrackMod(
  api: types.IExtensionApi,
  gameDomain: string,
  modId: number,
  track: boolean,
): Promise<boolean> {
  const modUid = makeModUID(gameDomain, modId);
  if (!modUid) {
    return false;
  }

  const operationName = track ? 'trackMod' : 'untrackMod';
  const mutation = track
    ? 'mutation trackMod($modUid: ID!) { trackMod(modUid: $modUid) { success } }'
    : 'mutation untrackMod($modUid: ID!) { untrackMod(modUid: $modUid) { success } }';

  const payload = await graphqlRequest(api, operationName, mutation, { modUid: String(modUid) });
  const root = payload && payload.data && payload.data[operationName];
  const ok = !!(root && root.success);

  logEnhancerInfo('graphqlTrackMod', {
    gameDomain,
    modId,
    modUid,
    track,
    ok,
    errors: payload && payload.errors,
  });

  return ok;
}

export async function toggleTrackModViaVortex(
  api: types.IExtensionApi,
  gameDomain: string,
  modId: number,
  track: boolean,
): Promise<boolean> {
  if (!isNexusLoggedIn(api)) {
    throw new Error('Not logged in to Nexus Mods in Vortex');
  }

  if (await restTrackMod(api, gameDomain, modId, track)) {
    return true;
  }

  if (await graphqlTrackMod(api, gameDomain, modId, track)) {
    return true;
  }

  return false;
}

function buildNexusRestHeaders(account: NexusAccount | null): Record<string, string> | null {
  if (!account) {
    return null;
  }

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
  };

  if (account.APIKey) {
    headers.apikey = account.APIKey;
    return headers;
  }

  const token = account.OAuthCredentials && account.OAuthCredentials.token;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  return null;
}

function parseTrackedModsPayload(body: any, gameDomain: string): { [modId: string]: boolean } {
  const tracked: { [modId: string]: boolean } = {};
  const items = Array.isArray(body)
    ? body
    : (body && (body.tracked_mods || body.data || body.results)) || [];

  if (!Array.isArray(items)) {
    return tracked;
  }

  const normalizedGame = String(gameDomain || '').toLowerCase();
  const expectedGameId = lookupNumericNexusGameId(gameDomain);

  items.forEach((item: any) => {
    if (!item) {
      return;
    }

    const modId = item.mod_id || item.modId || item.id;
    const domain = item.domain_name || item.game_domain_name || item.gameDomain || item.domain;
    const itemGameId = parseInt(String(item.game_id || item.gameId || ''), 10);
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

export async function fetchTrackedModIdsForGame(
  api: types.IExtensionApi,
  gameDomain: string,
): Promise<{ [modId: string]: boolean }> {
  const tracked: { [modId: string]: boolean } = {};
  if (!isNexusLoggedIn(api) || !gameDomain) {
    logEnhancerInfo('fetchTrackedModIdsForGame skipped: not logged in or missing game', { gameDomain });
    return tracked;
  }

  const account = getNexusAccount(api.store.getState());
  const headers = buildNexusRestHeaders(account);
  if (!headers) {
    logEnhancerInfo('fetchTrackedModIdsForGame skipped: no Nexus API key or OAuth token', { gameDomain });
    return tracked;
  }

  const urls = [
    `${NEXUS_REST}/user/tracked_mods.json`,
    `${NEXUS_REST}/user/tracked_mods`,
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        logEnhancerInfo('fetchTrackedModIdsForGame non-ok', {
          gameDomain,
          url,
          status: response.status,
        });
        continue;
      }

      const body = await response.json();
      const parsed = parseTrackedModsPayload(body, gameDomain);
      Object.assign(tracked, parsed);
      if (Object.keys(tracked).length > 0) {
        break;
      }
    } catch (err) {
      logEnhancerError('fetchTrackedModIdsForGame', err, { gameDomain, url });
    }
  }

  logEnhancerInfo('fetchTrackedModIdsForGame loaded', {
    gameDomain,
    count: Object.keys(tracked).length,
  });

  return tracked;
}

function orderGraphqlNodesByModIds(nodes: any[], modIds: number[]): any[] {
  const byId: { [modId: string]: any } = {};
  nodes.forEach((node) => {
    if (node && node.modId != null) {
      byId[String(node.modId)] = node;
    }
  });
  return modIds
    .map((modId) => byId[String(modId)])
    .filter((node) => !!node);
}

export async function fetchModListingNodesForGame(
  api: types.IExtensionApi,
  gameDomain: string,
  modIds: number[],
): Promise<any[]> {
  if (!isNexusLoggedIn(api) || !gameDomain || modIds.length === 0) {
    return [];
  }

  const chunkSize = 12;
  const chunks: number[][] = [];
  for (let i = 0; i < modIds.length; i += chunkSize) {
    chunks.push(modIds.slice(i, i + chunkSize));
  }

  const chunkResults = await Promise.all(chunks.map(async (chunk) => {
    const gameId = lookupNumericNexusGameId(gameDomain);
    const orFilters = chunk.map((modId) => {
      const clause: Record<string, unknown> = {
        modId: [{ op: 'EQUALS', value: String(modId) }],
      };
      if (gameId) {
        clause.gameId = [{ op: 'EQUALS', value: String(gameId) }];
      } else {
        clause.gameDomainName = [{ op: 'EQUALS', value: gameDomain }];
      }
      return clause;
    });

    const query = [
      'query ModsListing($count: Int = 0, $facets: ModsFacet, $filter: ModsFilter, $offset: Int, $postFilter: ModsFilter, $sort: [ModsSort!]) {',
      '  mods(count: $count, facets: $facets, filter: $filter, offset: $offset, postFilter: $postFilter, sort: $sort, viewUserBlockedContent: false) {',
      '    nodes { adultContent createdAt downloads endorsements fileSize game { domainName id name } modCategory { categoryId name } modId name status summary thumbnailUrl uid updatedAt uploader { avatar memberId name } viewerDownloaded viewerEndorsed viewerTracked viewerUpdateAvailable }',
      '    totalCount',
      '  }',
      '}',
    ].join('\n');

    try {
      const payload = await graphqlRequest(api, 'ModsListing', query, {
        count: chunk.length,
        offset: 0,
        facets: {},
        filter: {
          op: 'OR',
          filter: orFilters,
        },
        postFilter: {
          tag: [{ op: 'NOT_EQUALS', value: 'Translation' }],
          categoryName: [{ op: 'NOT_EQUALS', value: 'Translation' }],
        },
      });

      return payload && payload.data && payload.data.mods && payload.data.mods.nodes
        ? payload.data.mods.nodes
        : [];
    } catch (err) {
      logEnhancerError('fetchModListingNodesForGame chunk failed', err, {
        gameDomain,
        chunkSize: chunk.length,
      });
      return [];
    }
  }));

  const merged: any[] = [];
  chunkResults.forEach((nodes) => {
    merged.push(...nodes);
  });

  return orderGraphqlNodesByModIds(merged, modIds);
}

export async function toggleEndorseModViaVortex(
  api: types.IExtensionApi,
  gameDomain: string,
  modId: number,
  endorse: boolean,
): Promise<boolean> {
  if (!isNexusLoggedIn(api)) {
    throw new Error('Not logged in to Nexus Mods in Vortex');
  }

  const ext = api.ext as any;
  if (typeof ext.nexusEndorseMod !== 'function') {
    throw new Error('Nexus endorse API is unavailable');
  }

  const status = endorse ? 'endorse' : 'abstain';
  await ext.nexusEndorseMod(gameDomain, String(modId), status);
  return true;
}

export async function fetchViewerModStateViaVortex(
  api: types.IExtensionApi,
  gameDomain: string,
  modIds: number[],
): Promise<{ tracked: { [modId: string]: boolean }; endorsed: { [modId: string]: boolean }; downloaded: { [modId: string]: boolean } }> {
  const tracked: { [modId: string]: boolean } = {};
  const endorsed: { [modId: string]: boolean } = {};
  const downloaded: { [modId: string]: boolean } = {};

  const uids: string[] = [];
  const uidToModId: { [uid: string]: number } = {};

  modIds.forEach((modId) => {
    const uid = makeModUID(gameDomain, modId);
    if (uid) {
      uids.push(uid);
      uidToModId[uid] = modId;
    }
  });

  if (uids.length === 0) {
    return { tracked, endorsed, downloaded };
  }

  const query = [
    'query modsByUid($uids: [ID!]!, $count: Int) {',
    '  modsByUid(uids: $uids, count: $count) {',
    '    nodes { uid modId viewerTracked viewerEndorsed viewerDownloaded }',
    '  }',
    '}',
  ].join('\n');

  try {
    const payload = await graphqlRequest(api, 'modsByUid', query, {
      uids,
      count: uids.length,
    });

    const nodes = payload && payload.data && payload.data.modsByUid && payload.data.modsByUid.nodes
      ? payload.data.modsByUid.nodes
      : [];

    nodes.forEach((node: any) => {
      if (!node || !node.uid) {
        return;
      }
      const modId = uidToModId[String(node.uid)] || node.modId;
      if (!modId) {
        return;
      }
      const key = String(modId);
      tracked[key] = !!node.viewerTracked;
      endorsed[key] = !!node.viewerEndorsed;
      downloaded[key] = !!node.viewerDownloaded;
    });
  } catch (err) {
    logEnhancerError('fetchViewerModStateViaVortex', err, { gameDomain, modCount: modIds.length });
  }

  return { tracked, endorsed, downloaded };
}
