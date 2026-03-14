// @ts-nocheck
import type { App } from './engines/platform/inkdocPlatform'
import {
  clampOcrDebounceMs,
  clampSyncDebounceMs,
  DEFAULT_INKMATH_SETTINGS,
  DEFAULT_SETTINGS as DEFAULT_PLUGIN_SETTINGS,
  normalizeServiceUrl,
} from './settings'

export interface InkDocPluginSettingsLike {
  syncDebounceMs: number
  inkmathServiceUrl: string
  inkmathDebounceMs: number
}

const DEFAULT_SETTINGS: InkDocPluginSettingsLike = {
  syncDebounceMs: DEFAULT_PLUGIN_SETTINGS.syncDebounceMs,
  inkmathServiceUrl: normalizeServiceUrl(DEFAULT_INKMATH_SETTINGS.serviceUrl),
  inkmathDebounceMs: clampOcrDebounceMs(DEFAULT_INKMATH_SETTINGS.ocrDebounceMs),
}

export class InkDocPlugin {
  readonly app: App
  private settings: InkDocPluginSettingsLike

  constructor(app: App, settings?: Partial<InkDocPluginSettingsLike>) {
    this.app = app
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(settings ?? {}),
    }
    this.settings.inkmathServiceUrl = normalizeServiceUrl(this.settings.inkmathServiceUrl)
    this.settings.syncDebounceMs = clampSyncDebounceMs(this.settings.syncDebounceMs)
    this.settings.inkmathDebounceMs = clampOcrDebounceMs(this.settings.inkmathDebounceMs)
  }

  getSyncDebounceMs(): number {
    return this.settings.syncDebounceMs
  }

  getInkMathServiceUrl(): string {
    return this.settings.inkmathServiceUrl
  }

  getInkMathDebounceMs(): number {
    return this.settings.inkmathDebounceMs
  }
}

export default InkDocPlugin
