import { types } from 'vortex-api';
import { getActiveGameId } from './installedMods';
import { logEnhancerError, logEnhancerInfo } from './logger';

export interface NexusModFile {
  fileId: number;
  name: string;
  version: string;
  category: string;
  isPrimary: boolean;
  uploadedTimestamp: number;
}

const HARD_EXCLUDED_CATEGORIES = new Set([
  'OLD_VERSION',
  'OLDVERSION',
  'REMOVED',
]);

const RISKY_FILE_NAME = /\b(aio|all[\s-]?in[\s-]?one|patch|hotfix|beta|experimental)\b/i;

const MAX_FILE_CHOICES = 6;

function toNumber(value: any): number {
  const num = parseInt(String(value), 10);
  return isNaN(num) ? 0 : num;
}

function normalizeCategory(file: NexusModFile): string {
  return (file.category || '').toUpperCase().replace(/\s+/g, '_');
}

export function scoreInstallFile(file: NexusModFile): number {
  let score = 0;
  const category = normalizeCategory(file);

  if (file.isPrimary) {
    score += 200;
  }
  if (category === 'MAIN' || category === 'MAIN_FILE') {
    score += 100;
  } else if (category === 'UPDATE' || category === 'UPDATE_PATCH' || category === 'UPDATES') {
    score += 50;
  } else if (category === 'OPTIONAL' || category === 'MISCELLANEOUS' || category === 'MISC') {
    score += 5;
  } else if (!HARD_EXCLUDED_CATEGORIES.has(category)) {
    score += 20;
  }

  if (RISKY_FILE_NAME.test(file.name)) {
    score -= 100;
  }
  if (/\bold\b/i.test(file.name)) {
    score -= 60;
  }

  score += Math.min(file.uploadedTimestamp / 1e9, 15);
  return score;
}

export function isInstallCandidate(file: NexusModFile): boolean {
  return !HARD_EXCLUDED_CATEGORIES.has(normalizeCategory(file));
}

export function rankInstallFiles(files: NexusModFile[]): NexusModFile[] {
  const seen = new Set<number>();
  return files
    .filter((file) => {
      if (!isInstallCandidate(file) || seen.has(file.fileId)) {
        return false;
      }
      seen.add(file.fileId);
      return true;
    })
    .sort((a, b) => scoreInstallFile(b) - scoreInstallFile(a));
}

export function shouldPromptForFileChoice(candidates: NexusModFile[]): boolean {
  if (candidates.length === 0) {
    return false;
  }
  if (candidates.length === 1) {
    return RISKY_FILE_NAME.test(candidates[0].name);
  }

  const top = candidates[0];
  const topScore = scoreInstallFile(top);
  const secondScore = scoreInstallFile(candidates[1]);

  // Obvious MAIN / primary package — install without prompting even on large optional lists.
  if (isMainModFile(top) && !RISKY_FILE_NAME.test(top.name) && topScore - secondScore >= 25) {
    return false;
  }

  if (topScore - secondScore < 25) {
    return true;
  }
  if (RISKY_FILE_NAME.test(top.name)) {
    return true;
  }

  // Many similar-scored optionals — let the user pick.
  if (candidates.length >= 12 && topScore - secondScore < 50) {
    return true;
  }
  return false;
}

export function isMainModFile(file: NexusModFile): boolean {
  const category = normalizeCategory(file);
  if (HARD_EXCLUDED_CATEGORIES.has(category)) {
    return false;
  }
  return category === 'MAIN' || category === 'MAIN_FILE' || file.isPrimary;
}

export function pickMainFiles(files: NexusModFile[]): NexusModFile[] {
  return rankInstallFiles(files.filter(isMainModFile));
}

export function unwrapEmitAndAwait<T = any>(response: any): T {
  if (!Array.isArray(response)) {
    return response as T;
  }

  if (response.length === 1) {
    return response[0] as T;
  }

  for (let i = 0; i < response.length; i++) {
    if (response[i] != null) {
      return response[i] as T;
    }
  }

  return response as unknown as T;
}

export function normalizeModFiles(response: any): NexusModFile[] {
  const unwrapped = unwrapEmitAndAwait(response);
  let raw: any[] = [];

  if (Array.isArray(unwrapped)) {
    raw = unwrapped;
  } else if (unwrapped && Array.isArray(unwrapped.files)) {
    raw = unwrapped.files;
  } else if (unwrapped && Array.isArray(unwrapped.file_updates)) {
    raw = unwrapped.file_updates;
  }

  const normalized: NexusModFile[] = [];
  raw.forEach((entry) => {
    const fileId = toNumber(entry.file_id ?? entry.fileId ?? entry.id);
    if (!fileId) {
      return;
    }
    normalized.push({
      fileId,
      name: entry.name ?? entry.file_name ?? `File ${fileId}`,
      version: entry.version ?? entry.mod_version ?? '',
      category: entry.category_name ?? entry.category ?? '',
      isPrimary: !!entry.is_primary,
      uploadedTimestamp: toNumber(entry.uploaded_timestamp ?? entry.uploaded_time ?? entry.date ?? 0),
    });
  });

  return normalized;
}

function shortenLabel(text: string, maxLength: number): string {
  const trimmed = String(text || '').replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

function formatFileChoiceLabel(file: NexusModFile, index: number): string {
  const category = shortenLabel((file.category || 'Optional').replace(/_/g, ' '), 10);
  const version = file.version || '?';
  const name = shortenLabel(file.name, 22);
  return `${index + 1}. ${name} (${category}, v${version})`;
}

async function chooseInstallFileDialog(
  api: types.IExtensionApi,
  modId: number,
  files: NexusModFile[],
  riskyDefault: boolean,
): Promise<NexusModFile | null> {
  const choices = files.slice(0, MAX_FILE_CHOICES);
  const actions = [{ label: 'Cancel' }];
  const labelToFile = new Map<string, NexusModFile>();

  choices.forEach((file, index) => {
    const label = formatFileChoiceLabel(file, index);
    labelToFile.set(label, file);
    actions.push({ label });
  });

  const recommended = choices[0];
  const intro = riskyDefault
    ? [
      `Mod **${modId}** has a default file that may not install cleanly in Vortex (for example AIO or patch bundles).`,
      '',
      'Pick the full/main package instead if install fails:',
    ]
    : [
      `Mod **${modId}** has multiple install files.`,
      '',
      recommended
        ? `**Recommended:** ${recommended.name} (${recommended.category || 'Unknown'}, v${recommended.version || '?'})`
        : 'Pick the file you want Vortex to download:',
      '',
      'Numbered buttons match the list below:',
    ];

  const result = await api.showDialog(
    'question',
    'Choose file to install',
    {
      md: [
        ...intro,
        '',
        ...choices.map((file, index) =>
          `${index + 1}. **${file.name}** — ${file.category || 'Unknown'} — ${file.version || 'unknown version'}`,
        ),
        files.length > choices.length
          ? `\nShowing top ${choices.length} of ${files.length} candidates. Use the Nexus mod page for older files.`
          : '',
      ].join('\n'),
    },
    actions,
  );

  if (!result || result.action === 'Cancel') {
    return null;
  }

  return labelToFile.get(result.action) || null;
}

async function fetchModFiles(
  api: types.IExtensionApi,
  vortexGameId: string,
  modId: number,
): Promise<NexusModFile[]> {
  const response = await api.emitAndAwait('get-mod-files', vortexGameId, modId);
  const files = normalizeModFiles(response);
  logEnhancerInfo('get-mod-files', {
    modId,
    vortexGameId,
    responseType: Array.isArray(response) ? 'array' : typeof response,
    fileCount: files.length,
  });
  return files;
}

export async function installModFromBrowse(
  api: types.IExtensionApi,
  modId: number,
): Promise<boolean> {
  if (!Number.isFinite(modId) || modId <= 0) {
    throw new Error('Invalid mod id');
  }

  const vortexGameId = getActiveGameId(api);

  const files = await fetchModFiles(api, vortexGameId, modId);
  if (files.length === 0) {
    await api.showDialog(
      'error',
      'No files found',
      { md: 'Vortex could not retrieve downloadable files for this mod from Nexus.' },
      [{ label: 'OK' }],
    );
    return false;
  }

  const candidates = rankInstallFiles(files);
  if (candidates.length === 0) {
    await api.showDialog(
      'error',
      'No installable file',
      {
        md: 'No downloadable file was found for this mod. Open the mod page on Nexus and download manually.',
      },
      [{ label: 'OK' }],
    );
    return false;
  }

  let chosen = candidates[0];
  if (shouldPromptForFileChoice(candidates)) {
    const riskyDefault = RISKY_FILE_NAME.test(chosen.name);
    const picked = await chooseInstallFileDialog(api, modId, candidates, riskyDefault);
    if (!picked) {
      return false;
    }
    chosen = picked;
  }

  logEnhancerInfo('nexus-download', {
    vortexGameId,
    modId,
    fileId: chosen.fileId,
    fileName: chosen.name,
    category: chosen.category,
    score: scoreInstallFile(chosen),
  });

  // nexus-download is an onAsync handler — must use emitAndAwait, not events.emit.
  // Fire-and-forget so Browse cards are not blocked on load-order conflict dialogs.
  void api.emitAndAwait(
    'nexus-download',
    vortexGameId,
    String(modId),
    String(chosen.fileId),
  ).catch((err) => {
    logEnhancerError('nexus-download failed', err, {
      vortexGameId,
      modId,
      fileId: chosen.fileId,
    });
  });

  return true;
}

export async function safeInstallModFromBrowse(
  api: types.IExtensionApi,
  modId: number,
): Promise<boolean> {
  try {
    return await installModFromBrowse(api, modId);
  } catch (err) {
    logEnhancerError('installModFromBrowse failed', err, { modId });
    if (api.showDialog) {
      await api.showDialog(
        'error',
        'Download failed',
        {
          md: `Could not start the Nexus download.\n\n${(err && err.message) ? err.message : String(err)}`,
        },
        [{ label: 'OK' }],
      );
    }
    return false;
  }
}
