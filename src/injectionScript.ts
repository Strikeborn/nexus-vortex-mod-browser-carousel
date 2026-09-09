export interface ModDependencySummary {
  total: number;
  missing: number;
}

export interface EnhancerConfig {
  installed: {
    [nexusModId: string]: {
      nexusModId: number;
      version?: string;
      name?: string;
    };
  };
  hideInstalled: boolean;
  onlyInstalled: boolean;
  hideTracked: boolean;
  onlyTracked: boolean;
  gridColumns?: number;
  gridRows?: number;
  applyDefaultFilters?: boolean;
  hideSiteChrome?: boolean;
  downloading?: {
    [nexusModId: string]: boolean;
  };
  installing?: {
    [nexusModId: string]: 'downloading' | 'downloaded' | 'installing';
  };
  dependencies?: {
    [nexusModId: string]: ModDependencySummary;
  };
  modUids?: {
    [nexusModId: string]: string;
  };
  tracked?: {
    [nexusModId: string]: boolean;
  };
  endorsed?: {
    [nexusModId: string]: boolean;
  };
  viewerDownloaded?: {
    [nexusModId: string]: boolean;
  };
  gameNumericId?: number;
  trackedListLoaded?: boolean;
}

declare const INJECTION_RUNTIME: string;

export function buildEnhancerBootstrapScript(): string {
  return INJECTION_RUNTIME;
}

export function buildEnhancerUpdateScript(config: EnhancerConfig): string {
  const payload = JSON.stringify(config);
  return `(function(){if(window.__vortexBrowseEnhancer){return window.__vortexBrowseEnhancer.update(${payload});}return { error: 'enhancer missing' };})();`;
}

export function buildEnhancerProbeScript(): string {
  return '(function(){return !!window.__vortexBrowseEnhancer;})();';
}

export function buildEnhancerPauseBrowseScript(): string {
  return [
    '(function(){',
    'if(window.__vortexBrowseEnhancer && window.__vortexBrowseEnhancer.notifyBrowseContextChange){',
    'window.__vortexBrowseEnhancer.notifyBrowseContextChange();',
    '}',
    '})();',
  ].join('');
}

export function buildEnhancerBrowseContextScript(config: EnhancerConfig): string {
  return buildEnhancerUpdateScript(config);
}

export function buildEnhancerFinalizeBrowseScript(): string {
  return [
    '(function(){',
    'if(window.__vortexBrowseEnhancer&&window.__vortexBrowseEnhancer.finalizeBrowseContextTransition){',
    'return window.__vortexBrowseEnhancer.finalizeBrowseContextTransition();',
    '}',
    'return null;',
    '})();',
  ].join('');
}

export function buildEnhancerSetTabActiveScript(active: boolean): string {
  return [
    '(function(){',
    'if(window.__vortexBrowseEnhancer&&window.__vortexBrowseEnhancer.setTabActive){',
    `return window.__vortexBrowseEnhancer.setTabActive(${active ? 'true' : 'false'});`,
    '}',
    'return null;',
    '})();',
  ].join('');
}

export function buildEnhancerInjection(config: EnhancerConfig): string {
  return buildEnhancerBootstrapScript() + '\n' + buildEnhancerUpdateScript(config);
}
