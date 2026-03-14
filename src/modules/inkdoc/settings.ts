export type InkMathQualityMode = "auto" | "fast" | "balanced" | "accurate";

export type InkMathSettings = {
	modelAutoDownload: boolean;
	preferWebGpu: boolean;
	forceWasm: boolean;
	allowBackendFallback: boolean;
	qualityMode: InkMathQualityMode;
	serviceUrl: string;
	ocrDebounceMs: number;
};

export type InkDocPluginSettings = {
	syncDebounceMs: number;
	inkMath: InkMathSettings;
};

export const INKDOC_SYNC_DEBOUNCE_MIN_MS = 200;
export const INKDOC_SYNC_DEBOUNCE_MAX_MS = 5000;
export const INKDOC_OCR_DEBOUNCE_MIN_MS = 150;
export const INKDOC_OCR_DEBOUNCE_MAX_MS = 2200;

export const DEFAULT_INKMATH_SETTINGS: InkMathSettings = {
	modelAutoDownload: true,
	preferWebGpu: true,
	forceWasm: false,
	allowBackendFallback: true,
	qualityMode: "balanced",
	serviceUrl: "http://127.0.0.1:8767",
	ocrDebounceMs: 1000
};

export const DEFAULT_SETTINGS: InkDocPluginSettings = {
	syncDebounceMs: 1000,
	inkMath: DEFAULT_INKMATH_SETTINGS
};

export const normalizeServiceUrl = (value: string): string => {
	const raw = value.trim();
	if (!raw) {
		return DEFAULT_INKMATH_SETTINGS.serviceUrl;
	}
	try {
		const parsed = new URL(raw);
		if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
			return DEFAULT_INKMATH_SETTINGS.serviceUrl;
		}
		const normalized = `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, "");
		return normalized || DEFAULT_INKMATH_SETTINGS.serviceUrl;
	} catch {
		return DEFAULT_INKMATH_SETTINGS.serviceUrl;
	}
};

export const clampSyncDebounceMs = (value: number): number => {
	const rounded = Math.round(value);
	if (!Number.isFinite(rounded)) {
		return DEFAULT_SETTINGS.syncDebounceMs;
	}
	return Math.max(INKDOC_SYNC_DEBOUNCE_MIN_MS, Math.min(INKDOC_SYNC_DEBOUNCE_MAX_MS, rounded));
};

export const clampOcrDebounceMs = (value: number): number => {
	const rounded = Math.round(value);
	if (!Number.isFinite(rounded)) {
		return DEFAULT_INKMATH_SETTINGS.ocrDebounceMs;
	}
	return Math.max(INKDOC_OCR_DEBOUNCE_MIN_MS, Math.min(INKDOC_OCR_DEBOUNCE_MAX_MS, rounded));
};
