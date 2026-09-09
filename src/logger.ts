import * as fs from 'fs';
import * as path from 'path';
import { types } from 'vortex-api';

const PREFIX = '[Mod Browser Carousel]';
let logFilePath: string = null;

export function initEnhancerLogger(api: types.IExtensionApi): string {
  try {
    const logsDir = path.join(process.env.APPDATA || api.getPath('userData'), 'Vortex', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    logFilePath = path.join(logsDir, 'mod-browser-carousel.log');
    appendLogLine('Logger initialized');
  } catch (err) {
    console.error(PREFIX, 'Failed to initialize log file', err);
  }
  return logFilePath;
}

export function getEnhancerLogPath(): string {
  return logFilePath;
}

function appendLogLine(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  console.error(PREFIX, line);
  if (!logFilePath) {
    return;
  }
  try {
    fs.appendFileSync(logFilePath, stamped);
  } catch (err) {
    console.error(PREFIX, 'Failed to write log file', err);
  }
}

function formatError(err: any): string {
  if (!err) {
    return '';
  }
  if (err instanceof Error) {
    return `${err.message}${err.stack ? `\n${err.stack}` : ''}`;
  }
  try {
    return JSON.stringify(err);
  } catch (jsonErr) {
    return String(err);
  }
}

export function logEnhancerInfo(message: string, detail?: any): void {
  const suffix = detail !== undefined ? ` ${safeStringify(detail)}` : '';
  appendLogLine(`INFO ${message}${suffix}`);
}

export function logEnhancerError(message: string, err?: any, detail?: any): void {
  const errText = formatError(err);
  const detailText = detail !== undefined ? ` detail=${safeStringify(detail)}` : '';
  appendLogLine(`ERROR ${message}${detailText}${errText ? `\n${errText}` : ''}`);
}

function safeStringify(value: any): string {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return String(value);
  }
}
