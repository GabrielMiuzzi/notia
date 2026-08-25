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

export const INKMATH_OCR_DEBOUNCE_MIN_MS = 150;
export const INKMATH_OCR_DEBOUNCE_MAX_MS = 2200;

export const DEFAULT_INKMATH_SETTINGS: InkMathSettings = {
	modelAutoDownload: true,
	preferWebGpu: true,
	forceWasm: false,
	allowBackendFallback: true,
	qualityMode: "balanced",
	serviceUrl: "http://127.0.0.1:8767",
	ocrDebounceMs: 1000
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

export const clampOcrDebounceMs = (value: number): number => {
	const rounded = Math.round(value);
	if (!Number.isFinite(rounded)) {
		return DEFAULT_INKMATH_SETTINGS.ocrDebounceMs;
	}
	return Math.max(INKMATH_OCR_DEBOUNCE_MIN_MS, Math.min(INKMATH_OCR_DEBOUNCE_MAX_MS, rounded));
};
