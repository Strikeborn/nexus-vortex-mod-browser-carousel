import {
  buildEnhancerBootstrapScript,
  buildEnhancerBrowseContextScript,
  buildEnhancerFinalizeBrowseScript,
  buildEnhancerInjection,
  buildEnhancerPauseBrowseScript,
  buildEnhancerProbeScript,
  buildEnhancerSetTabActiveScript,
  buildEnhancerUpdateScript,
  EnhancerConfig,
} from './injectionScript';
import { logEnhancerError, logEnhancerInfo } from './logger';
import {
  buildNexusWebSessionProbeScript,
  buildNexusWebSessionReleaseScript,
  NexusWebSessionProbe,
} from './nexusWebSession';

function runWebviewScript(webview: any, script: string, context: string): Promise<any> {
  const result = webview.executeJavaScript(script, false);

  if (result && typeof result.then === 'function') {
    return result.catch((err: any) => {
      logEnhancerError(`${context} failed (promise)`, err, { scriptLength: script.length });
      throw err;
    });
  }

  return Promise.resolve(undefined);
}

export class WebviewBridge {
  private webview: any;
  private debounceTimer: any = null;
  private browseContextTimer: any = null;
  private bootstrapped = false;

  private flushWebviewHostLogs(stats: any) {
    if (!stats || !Array.isArray(stats.hostLogs)) {
      return;
    }
    stats.hostLogs.forEach((entry: any) => {
      const message = entry && entry.message ? String(entry.message) : '';
      if (!message) {
        return;
      }
      const detail = entry && entry.detail !== undefined ? entry.detail : {};
      if (entry && entry.level === 'error') {
        logEnhancerError(`[webview] ${message}`, null, detail);
      } else {
        logEnhancerInfo(`[webview] ${message}`, detail);
      }
    });
  }

  constructor(webviewNode: any) {
    this.webview = webviewNode;
  }

  setWebview(webviewNode: any) {
    const sameNode = this.webview === webviewNode;
    this.webview = webviewNode;
    if (!sameNode) {
      this.bootstrapped = false;
    }
  }

  private runUpdate(config: EnhancerConfig, context: string = 'enhancer update'): Promise<void> {
    if (!this.webview || typeof this.webview.executeJavaScript !== 'function') {
      logEnhancerError(`${context} skipped: webview.executeJavaScript unavailable`);
      return Promise.resolve();
    }

    return runWebviewScript(this.webview, buildEnhancerUpdateScript(config), context).then((stats: any) => {
      if (stats && stats.error === 'enhancer missing') {
        this.bootstrapped = false;
        return this.bootstrap(config, `${context} (re-bootstrap)`);
      }

      this.flushWebviewHostLogs(stats);

      this.bootstrapped = true;
      logEnhancerInfo(`${context} succeeded`, {
        installedCount: Object.keys(config.installed || {}).length,
        hideInstalled: config.hideInstalled,
        onlyInstalled: config.onlyInstalled,
        hideTracked: config.hideTracked,
        onlyTracked: config.onlyTracked,
        webviewStats: stats,
      });
    });
  }

  private bootstrap(config: EnhancerConfig, context: string = 'enhancer bootstrap'): Promise<void> {
    if (!this.webview || typeof this.webview.executeJavaScript !== 'function') {
      logEnhancerError(`${context} skipped: webview.executeJavaScript unavailable`);
      return Promise.resolve();
    }

    return runWebviewScript(this.webview, buildEnhancerInjection(config), context).then((stats: any) => {
      this.flushWebviewHostLogs(stats);

      this.bootstrapped = true;
      logEnhancerInfo(`${context} succeeded`, {
        installedCount: Object.keys(config.installed || {}).length,
        hideInstalled: config.hideInstalled,
        onlyInstalled: config.onlyInstalled,
        hideTracked: config.hideTracked,
        onlyTracked: config.onlyTracked,
        webviewStats: stats,
      });
    });
  }

  inject(config: EnhancerConfig, attempt: number = 0): Promise<void> {
    if (!this.webview || typeof this.webview.executeJavaScript !== 'function') {
      logEnhancerError('inject skipped: webview.executeJavaScript unavailable');
      return Promise.resolve();
    }

    return runWebviewScript(this.webview, buildEnhancerProbeScript(), 'enhancer probe').then((exists: boolean) => {
      if (exists) {
        this.bootstrapped = true;
        return this.runUpdate(config);
      }

      this.bootstrapped = false;
      return this.bootstrap(config);
    }).catch((err) => {
      if (attempt >= 10) {
        logEnhancerError('inject failed after retries', err, { attempt });
        return Promise.resolve();
      }
      const retryDelay = Math.min(1600, 200 + attempt * 150);
      return new Promise<void>((resolve) => {
        setTimeout(resolve, retryDelay);
      }).then(() => this.inject(config, attempt + 1));
    });
  }

  scheduleInject(config: EnhancerConfig, delay: number = 250): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (delay <= 0) {
      return this.inject(config).catch((err) => {
        logEnhancerError('scheduleInject', err);
      });
    }
    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.inject(config).then(() => resolve()).catch((err) => {
          logEnhancerError('scheduleInject', err);
          resolve();
        });
      }, delay);
    });
  }

  scheduleBrowseContextPause(): void {
    if (!this.webview || typeof this.webview.executeJavaScript !== 'function') {
      return;
    }

    runWebviewScript(
      this.webview,
      buildEnhancerPauseBrowseScript(),
      'browse context pause',
    ).catch((err) => {
      logEnhancerError('scheduleBrowseContextPause', err);
    });
  }

  scheduleBrowseContextUpdate(config: EnhancerConfig, delay: number = 2500): void {
    if (this.browseContextTimer) {
      clearTimeout(this.browseContextTimer);
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.browseContextTimer = setTimeout(() => {
      this.browseContextTimer = null;
      if (!this.webview || typeof this.webview.executeJavaScript !== 'function') {
        return;
      }

      runWebviewScript(
        this.webview,
        buildEnhancerBrowseContextScript(config),
        'browse context update',
      ).then((stats: any) => {
        this.flushWebviewHostLogs(stats);
        this.bootstrapped = true;
        logEnhancerInfo('browse context update succeeded', {
          installedCount: Object.keys(config.installed || {}).length,
          webviewStats: stats,
        });
      }).catch((err) => {
        logEnhancerError('scheduleBrowseContextUpdate', err);
      });
    }, delay);
  }

  finalizeBrowseContext(): Promise<void> {
    if (!this.webview || typeof this.webview.executeJavaScript !== 'function') {
      return Promise.resolve();
    }

    return runWebviewScript(
      this.webview,
      buildEnhancerFinalizeBrowseScript(),
      'browse context finalize',
    ).then((stats: any) => {
      this.flushWebviewHostLogs(stats);
      logEnhancerInfo('browse context finalize succeeded', { webviewStats: stats });
    }).catch((err) => {
      logEnhancerError('finalizeBrowseContext', err);
    });
  }

  scheduleBrowseContextFinalize(delay: number = 3800): void {
    if (this.browseContextTimer) {
      clearTimeout(this.browseContextTimer);
    }

    this.browseContextTimer = setTimeout(() => {
      this.browseContextTimer = null;
      this.finalizeBrowseContext().catch((err) => {
        logEnhancerError('scheduleBrowseContextFinalize', err);
      });
    }, delay);
  }

  resetBootstrap(): void {
    this.bootstrapped = false;
  }

  probeEnhancer(): Promise<boolean> {
    if (!this.webview || typeof this.webview.executeJavaScript !== 'function') {
      return Promise.resolve(false);
    }

    return runWebviewScript(this.webview, buildEnhancerProbeScript(), 'enhancer probe').then((exists: any) => {
      return !!exists;
    }).catch(() => false);
  }

  releaseAuthPageUI(): Promise<void> {
    if (!this.webview || typeof this.webview.executeJavaScript !== 'function') {
      return Promise.resolve();
    }

    return runWebviewScript(
      this.webview,
      buildNexusWebSessionReleaseScript(),
      'nexus auth page release',
    ).then(() => undefined).catch((err) => {
      logEnhancerError('releaseAuthPageUI failed', err);
    });
  }

  probeNexusWebSession(): Promise<NexusWebSessionProbe | null> {
    if (!this.webview || typeof this.webview.executeJavaScript !== 'function') {
      return Promise.resolve(null);
    }

    return runWebviewScript(
      this.webview,
      buildNexusWebSessionProbeScript(),
      'nexus web session probe',
    ).then((result: any) => {
      if (!result || typeof result !== 'object') {
        return null;
      }
      const state = result.state === 'login-page' || result.state === 'error' ? result.state : 'browse';
      return {
        state,
        loggedIn: !!result.loggedIn,
        error: result.error ? String(result.error) : undefined,
      };
    }).catch((err) => {
      logEnhancerError('nexus web session probe failed', err);
      return null;
    });
  }

  showToast(message: string): Promise<void> {
    if (!this.webview || typeof this.webview.executeJavaScript !== 'function') {
      return Promise.resolve();
    }
    const script = `(function(){if(window.__vortexBrowseEnhancer){window.__vortexBrowseEnhancer.showToast(${JSON.stringify(message)});}})();`;
    return runWebviewScript(this.webview, script, 'show toast');
  }

  deliverModTiles(requestId: string, nodes: any[]): Promise<void> {
    if (!this.webview || typeof this.webview.executeJavaScript !== 'function') {
      return Promise.resolve();
    }
    const script = `(function(){if(window.__vortexBrowseEnhancer&&window.__vortexBrowseEnhancer.receiveModTiles){window.__vortexBrowseEnhancer.receiveModTiles(${JSON.stringify(requestId)}, ${JSON.stringify(nodes || [])});}})();`;
    return runWebviewScript(this.webview, script, 'deliver mod tiles');
  }

  clearPending(action: string, modId: number): Promise<void> {
    if (!this.webview || typeof this.webview.executeJavaScript !== 'function') {
      return Promise.resolve();
    }
    const script = `(function(){if(window.__vortexBrowseEnhancer){window.__vortexBrowseEnhancer.clearPending(${JSON.stringify(action)}, ${modId});}})();`;
    return runWebviewScript(this.webview, script, 'clear pending');
  }

  setTabActive(active: boolean): Promise<void> {
    if (!this.webview || typeof this.webview.executeJavaScript !== 'function') {
      return Promise.resolve();
    }

    return runWebviewScript(
      this.webview,
      buildEnhancerSetTabActiveScript(active),
      active ? 'browse tab activate' : 'browse tab deactivate',
    ).then(() => undefined);
  }
}
