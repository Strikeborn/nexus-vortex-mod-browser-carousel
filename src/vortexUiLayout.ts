import { logEnhancerError } from './logger';

const RELOCATED_ATTR = 'data-vortex-enhanced-relocated';
const SLOT_ID = 'vortex-enhanced-notifications-slot';

let layoutStarted = false;
let relocateTimer: any = null;

function findBrowseNavRow(sidebar: HTMLElement): Element | null {
  const labels = sidebar.querySelectorAll('.menu-label');
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const text = (label.textContent || '').trim();
    if (text === 'Browse') {
      const row = label.closest('.page-button') || label.parentElement;
      return row ? row.parentElement : label.parentElement;
    }
  }
  return null;
}

function findNotificationWrapper(): HTMLElement | null {
  const button = document.getElementById('notifications-button')
    || document.getElementById('notification-button');
  if (!button) {
    return null;
  }

  let node: HTMLElement | null = button.parentElement;
  while (node && node !== document.body) {
    if (node.parentElement && node.parentElement.classList.contains('application-icons-group')) {
      return node;
    }
    node = node.parentElement;
  }

  return button.parentElement;
}

function ensureNotificationSlot(sidebar: HTMLElement, afterRow: Element): HTMLElement {
  let slot = document.getElementById(SLOT_ID) as HTMLElement | null;
  if (!slot) {
    slot = document.createElement('div');
    slot.id = SLOT_ID;
    slot.className = 'vortex-enhanced-notifications-slot';
  }

  if (slot.parentElement !== sidebar) {
    if (afterRow.nextSibling) {
      sidebar.insertBefore(slot, afterRow.nextSibling);
    } else {
      sidebar.appendChild(slot);
    }
  }

  return slot;
}

function relocateNotificationControl(): boolean {
  const sidebar = document.getElementById('main-nav-container');
  const wrapper = findNotificationWrapper();
  if (!sidebar || !wrapper) {
    return false;
  }

  if (wrapper.getAttribute(RELOCATED_ATTR) === 'true') {
    return true;
  }

  const browseRow = findBrowseNavRow(sidebar);
  if (!browseRow) {
    return false;
  }

  const slot = ensureNotificationSlot(sidebar, browseRow);
  slot.appendChild(wrapper);
  wrapper.setAttribute(RELOCATED_ATTR, 'true');
  return true;
}

function injectLayoutStyles(): void {
  if (document.getElementById('vortex-enhanced-layout-styles')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'vortex-enhanced-layout-styles';
  style.textContent = [
    '.vortex-enhanced-notifications-slot {',
    '  display: flex;',
    '  justify-content: center;',
    '  align-items: center;',
    '  padding: 6px 0;',
    '  margin: 4px 0;',
    '  box-shadow: 0 3px 0 0 rgba(221, 221, 221, 0.12);',
    '}',
    '#main-nav-sidebar.sidebar-compact .vortex-enhanced-notifications-slot {',
    '  padding: 4px 0;',
    '}',
    '.vortex-enhanced-notifications-slot > div {',
    '  display: flex;',
    '  justify-content: center;',
    '  width: 100%;',
    '}',
    '.vortex-enhanced-notifications-slot #notifications-button,',
    '.vortex-enhanced-notifications-slot #notification-button {',
    '  background: transparent;',
    '  border: none;',
    '  color: inherit;',
    '  padding: 6px;',
    '}',
    'body > div[style*="position: fixed"] div.custom-toast {',
    '  max-width: 220px;',
    '}',
  ].join('\n');
  document.head.appendChild(style);
}

export function startVortexUiLayout(): void {
  if (layoutStarted || typeof document === 'undefined') {
    return;
  }
  layoutStarted = true;

  try {
    injectLayoutStyles();
  } catch (err) {
    logEnhancerError('startVortexUiLayout injectLayoutStyles', err);
  }

  let attempts = 0;
  if (relocateTimer) {
    clearInterval(relocateTimer);
  }

  relocateTimer = setInterval(() => {
    attempts += 1;
    try {
      if (relocateNotificationControl() || attempts >= 30) {
        clearInterval(relocateTimer);
        relocateTimer = null;
      }
    } catch (err) {
      logEnhancerError('relocateNotificationControl', err);
      clearInterval(relocateTimer);
      relocateTimer = null;
    }
  }, 1000);
}
