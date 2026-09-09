import { types } from 'vortex-api';
import BrowseView from './BrowseView';
import {
  BROWSE_PAGE_ID,
  EXTENSION_DISPLAY_NAME,
  EXTENSION_NAMESPACE,
} from './extensionMeta';
import { initEnhancerLogger, logEnhancerInfo } from './logger';

export { BROWSE_PAGE_ID, EXTENSION_NAMESPACE, EXTENSION_DISPLAY_NAME, LEGACY_BROWSE_PAGE_IDS } from './extensionMeta';

function isOurBrowseExtension(namespace: string, name: string): boolean {
  const ns = namespace.toLowerCase();
  const label = name.toLowerCase();
  if (ns === EXTENSION_NAMESPACE || ns === 'strikeborn-mod-browser') {
    return true;
  }
  return label.indexOf('mod browser carousel') >= 0 ||
    label.indexOf('nexus vortex mod browser') >= 0;
}

function warnIfDuplicateBrowseExtensions(api: types.IExtensionApi) {
  const state = api.store.getState();
  const enabled: string[] = [];
  const installed = (state.session && state.session.extensions && state.session.extensions.installed) || {};

  Object.keys(installed).forEach((key) => {
    const ext = installed[key];
    const appState = state.app && state.app.extensions ? state.app.extensions[key] : null;
    if (!ext || !appState || appState.enabled !== true) {
      return;
    }

    const name = ext.name || '';
    const ns = ext.namespace || '';
    if (isOurBrowseExtension(ns, name)) {
      return;
    }
    const label = name.toLowerCase();
    const extNs = ns.toLowerCase();
    const isDuplicate =
      label.indexOf('builtin mod browser') >= 0 ||
      extNs === 'builtin-mod-browser' ||
      extNs === 'builtin-mod-browser-enhanced' ||
      extNs === 'strikeborn-mod-browser';
    if (isDuplicate) {
      enabled.push(name || key);
    }
  });

  if (enabled.length === 0) {
    return;
  }

  logEnhancerInfo('Duplicate Browse extensions detected', { enabled });
  api.sendNotification({
    type: 'warning',
    title: 'Duplicate Browse tab',
    message: 'Other Browse extensions are still enabled: ' + enabled.join(', ') +
      '. Disable them under Settings -> Extensions and keep only ' + EXTENSION_DISPLAY_NAME + '.',
  });
}

function main(context: types.IExtensionContext) {
  const logPath = initEnhancerLogger(context.api);
  logEnhancerInfo('Extension loaded', { logPath, namespace: EXTENSION_NAMESPACE });

  context.once(() => {
    try {
      warnIfDuplicateBrowseExtensions(context.api);
    } catch (err) {
      logEnhancerInfo('Duplicate Browse extension check skipped', { err: String(err) });
    }
  });

  context.registerMainPage('search', 'Browse', BrowseView, {
    id: BROWSE_PAGE_ID,
    group: 'per-game',
    props: () => ({ api: context.api, browsePageId: BROWSE_PAGE_ID }),
  });

  return true;
}

export default main;
