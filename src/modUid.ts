import * as fs from 'fs';
import * as path from 'path';

let domainToNumericId: Map<string, number> | null = null;
let cacheLoadAttempted = false;

function loadNexusGameIdCache(): Map<string, number> {
  if (domainToNumericId) {
    return domainToNumericId;
  }

  domainToNumericId = new Map();

  if (cacheLoadAttempted) {
    return domainToNumericId;
  }

  cacheLoadAttempted = true;

  try {
    const cachePath = path.join(process.env.APPDATA || '', 'Vortex', 'temp', 'nexus_gamelist.json');
    if (!fs.existsSync(cachePath)) {
      return domainToNumericId;
    }

    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (!Array.isArray(raw)) {
      return domainToNumericId;
    }

    raw.forEach((entry: any) => {
      const domain = entry && entry.domain_name;
      const id = parseInt(String(entry && entry.id), 10);
      if (domain && !isNaN(id)) {
        domainToNumericId!.set(String(domain).toLowerCase(), id);
      }
    });
  } catch (err) {
    // Nexus game list is optional; UID lookup falls back gracefully.
  }

  return domainToNumericId;
}

export function lookupNumericNexusGameId(gameDomain: string): number | null {
  const map = loadNexusGameIdCache();
  const id = map.get(String(gameDomain || '').toLowerCase());
  return id != null ? id : null;
}

export function makeModUID(gameDomain: string, modId: number): string | null {
  if (!Number.isFinite(modId) || modId <= 0) {
    return null;
  }

  const gameIdNum = lookupNumericNexusGameId(gameDomain);
  if (!gameIdNum) {
    return null;
  }

  const uid = (BigInt(gameIdNum) << BigInt(32)) | BigInt(modId);
  return uid.toString();
}

export function buildModUidMap(gameDomain: string, modIds: number[]): { [modId: string]: string } {
  const result: { [modId: string]: string } = {};
  modIds.forEach((modId) => {
    const uid = makeModUID(gameDomain, modId);
    if (uid) {
      result[String(modId)] = uid;
    }
  });
  return result;
}

export function numericGameIdToDomain(numericGameId: number): string | null {
  const map = loadNexusGameIdCache();
  for (const [domain, id] of map.entries()) {
    if (id === numericGameId) {
      return domain;
    }
  }
  return null;
}
