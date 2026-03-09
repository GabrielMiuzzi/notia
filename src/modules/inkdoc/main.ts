// @ts-nocheck
import type { App } from './engines/platform/inkdocPlatform'

export interface InkDocPluginSettingsLike {
  syncDebounceMs: number
  inkmathServiceUrl: string
  inkmathDebounceMs: number
}

const DEFAULT_SETTINGS: InkDocPluginSettingsLike = {
  syncDebounceMs: 380,
  inkmathServiceUrl: 'http://127.0.0.1:5001',
  inkmathDebounceMs: 500,
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
