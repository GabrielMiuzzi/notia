// @ts-nocheck
import type { InkDocPageBackground, InkDocPageColors } from "../types";

export const DEFAULT_PAGE_BACKGROUND: InkDocPageBackground = "plain";
export const DEFAULT_PAGE_COLORS: InkDocPageColors = {
	background: "rgb(255, 255, 255)",
	line: "rgba(100, 116, 139, 0.35)",
	margin: "rgba(71, 85, 105, 0.55)"
};

export const PAGE_COLOR_PRESETS: ReadonlyArray<{
	id: string;
	label: string;
	colors: InkDocPageColors;
}> = [
	{
		id: "paper-cream",
		label: "Papel crema",
		colors: {
			background: "rgb(252, 246, 223)",
			line: "rgba(106, 122, 140, 0.35)",
			margin: "rgba(78, 93, 112, 0.55)"
		}
	},
	{
		id: "paper-cream-bordeaux",
		label: "Crema bordeaux",
		colors: {
			background: "rgb(252, 246, 223)",
			line: "rgba(106, 122, 140, 0.35)",
			margin: "rgba(130, 28, 54, 0.65)"
		}
	},
	{
		id: "paper-warm",
		label: "Papel cálido",
		colors: {
			background: "rgb(250, 238, 214)",
			line: "rgba(132, 102, 84, 0.35)",
			margin: "rgba(110, 82, 66, 0.6)"
		}
	},
	{
		id: "paper-blue",
		label: "Cuaderno azul",
		colors: {
			background: "rgb(232, 242, 255)",
			line: "rgba(67, 112, 173, 0.35)",
			margin: "rgba(44, 84, 142, 0.6)"
		}
	},
	{
		id: "dark-slate",
		label: "Oscuro pizarra",
		colors: {
			background: "rgb(28, 34, 43)",
			line: "rgba(162, 182, 209, 0.35)",
			margin: "rgba(198, 218, 244, 0.65)"
		}
	},
	{
		id: "dark-sepia",
		label: "Oscuro sepia",
		colors: {
			background: "rgb(35, 29, 24)",
			line: "rgba(210, 175, 138, 0.3)",
			margin: "rgba(227, 191, 153, 0.6)"
		}
	}
];

export const PAGE_BACKGROUND_OPTIONS: ReadonlyArray<{
	id: InkDocPageBackground;
	label: string;
}> = [
	{ id: "plain", label: "Liso" },
	{ id: "dotted", label: "Punteada" },
	{ id: "grid", label: "Cuadriculada" },
	{ id: "ruled", label: "Rayada" },
	{ id: "ruled-right", label: "Rayada con margen derecho" },
	{ id: "ruled-left", label: "Rayada con margen izquierdo" },
	{ id: "ruled-legal", label: "Rayada con margen legal" },
	{ id: "cornell", label: "Cornell" },
	{ id: "music", label: "Pentagramas" },
	{ id: "millimeter", label: "Milimetrada" }
];

export const isInkDocPageBackground = (value: unknown): value is InkDocPageBackground => {
	if (typeof value !== "string") {
		return false;
	}
	return PAGE_BACKGROUND_OPTIONS.some((option) => option.id === value);
};

export const resolvePageBackground = (
	value?: InkDocPageBackground | null
): InkDocPageBackground => {
	if (value && isInkDocPageBackground(value)) {
		return value;
	}
	return DEFAULT_PAGE_BACKGROUND;
};

const isColorString = (value: unknown): value is string => {
	return typeof value === "string" && value.trim().length > 0;
};

const clampRgb = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const parseColorToRgb = (value: string): { r: number; g: number; b: number } => {
	const rgbMatch = value.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
	if (rgbMatch) {
		return {
			r: clampRgb(Number(rgbMatch[1])),
			g: clampRgb(Number(rgbMatch[2])),
			b: clampRgb(Number(rgbMatch[3]))
		};
	}
	const hexMatch = value.match(/^#([0-9a-f]{6})$/i);
	if (hexMatch) {
		const hex = hexMatch[1] ?? "ffffff";
		return {
			r: parseInt(hex.slice(0, 2), 16),
			g: parseInt(hex.slice(2, 4), 16),
			b: parseInt(hex.slice(4, 6), 16)
		};
	}
	return { r: 255, g: 255, b: 255 };
};

const toLinear = (channel: number): number => {
	const normalized = channel / 255;
	return normalized <= 0.03928
		? normalized / 12.92
		: Math.pow((normalized + 0.055) / 1.055, 2.4);
};

export const getContrastInkColor = (background: string): string => {
	const { r, g, b } = parseColorToRgb(background);
	const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
	return luminance > 0.48 ? "rgb(25, 30, 37)" : "rgb(242, 246, 252)";
};

export const getContrastPageTextColor = (
	value?: Partial<InkDocPageColors> | null
): string => {
	const colors = resolvePageColors(value);
	return getContrastInkColor(colors.background);
};

export const resolvePageColors = (value?: Partial<InkDocPageColors> | null): InkDocPageColors => {
	return {
		background: isColorString(value?.background) ? value.background : DEFAULT_PAGE_COLORS.background,
		line: isColorString(value?.line) ? value.line : DEFAULT_PAGE_COLORS.line,
		margin: isColorString(value?.margin) ? value.margin : DEFAULT_PAGE_COLORS.margin
	};
};

export const setPageBackgroundAttribute = (
	pageEl: HTMLElement,
	value?: InkDocPageBackground | null
): void => {
	pageEl.dataset.inkdocBackground = resolvePageBackground(value);
};

export const setPageColorVariables = (
	pageEl: HTMLElement,
	value?: Partial<InkDocPageColors> | null
): void => {
	const colors = resolvePageColors(value);
	const uiInk = getContrastInkColor(colors.background);
	pageEl.style.setProperty("--inkdoc-page-bg", colors.background);
	pageEl.style.setProperty("--inkdoc-page-line", colors.line);
	pageEl.style.setProperty("--inkdoc-page-line-strong", colors.margin);
	pageEl.style.setProperty("--inkdoc-page-ui-ink", uiInk);
	pageEl.style.setProperty(
		"--inkdoc-object-outline",
		`color-mix(in srgb, ${uiInk} 62%, transparent)`
	);
	pageEl.style.setProperty(
		"--inkdoc-object-outline-strong",
		`color-mix(in srgb, ${uiInk} 88%, transparent)`
	);
};
