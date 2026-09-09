import { InstalledModsPayload } from './installedMods';

export class BrowseCatalogCache {
  private tileByModId: { [modId: string]: any } = {};
  private prefetchToken = 0;

  clear(): void {
    this.tileByModId = {};
    this.prefetchToken += 1;
  }

  resolveModTiles(modIds: number[]): any[] | null {
    if (modIds.length === 0) {
      return null;
    }
    const nodes: any[] = [];
    for (const modId of modIds) {
      const node = this.tileByModId[String(modId)];
      if (!node) {
        return null;
      }
      nodes.push(node);
    }
    return nodes;
  }

  storeModTiles(modIds: number[], nodes: any[]): void {
    nodes.forEach((node) => {
      if (node && node.modId != null) {
        this.tileByModId[String(node.modId)] = node;
      }
    });
  }

  invalidateModIds(modIds: number[]): void {
    modIds.forEach((modId) => {
      delete this.tileByModId[String(modId)];
    });
  }

  pruneExcept(allowedModIds: number[]): void {
    const allowed: { [modId: string]: boolean } = {};
    allowedModIds.forEach((modId) => {
      allowed[String(modId)] = true;
    });
    Object.keys(this.tileByModId).forEach((key) => {
      if (!allowed[key]) {
        delete this.tileByModId[key];
      }
    });
  }

  nextPrefetchToken(): number {
    return ++this.prefetchToken;
  }

  isPrefetchStale(token: number): boolean {
    return token !== this.prefetchToken;
  }

  static buildModIdListKey(modIds: number[]): string {
    return modIds.slice().sort((a, b) => a - b).join(',');
  }

  static getTrackedModIds(tracked: { [modId: string]: boolean }): number[] {
    return Object.keys(tracked)
      .filter((key) => !!tracked[key])
      .map((key) => parseInt(key, 10))
      .filter((modId) => Number.isFinite(modId) && modId > 0)
      .sort((a, b) => a - b);
  }

  static getInstalledModIds(installed: InstalledModsPayload): number[] {
    return Object.keys(installed)
      .map((key) => parseInt(key, 10))
      .filter((modId) => Number.isFinite(modId) && modId > 0)
      .sort((a, b) => a - b);
  }

  static pageSlice(modIds: number[], pageSize: number, overscan: number = 16): number[] {
    if (modIds.length === 0) {
      return [];
    }
    return modIds.slice(0, pageSize + overscan);
  }
}