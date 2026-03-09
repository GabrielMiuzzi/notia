// @ts-nocheck
import type { InkDocStrokeStyle } from "../types";

type StrokeStyleOption = {
	value: InkDocStrokeStyle;
	label: string;
};

export const INKDOC_STROKE_STYLE_OPTIONS: StrokeStyleOption[] = [
	{ value: "solid", label: "Continuo" },
	{ value: "dashed", label: "Guiones" },
	{ value: "dotted", label: "Punteado" },
	{ value: "long-dash", label: "Trazo largo" },
	{ value: "short-dash", label: "Trazo corto" },
	{ value: "dash-dot", label: "Guion punto" },
	{ value: "dash-double-dot", label: "Guion doble" },
	{ value: "sparse-dots", label: "Puntos aireados" },
	{ value: "dense-dots", label: "Puntos densos" },
	{ value: "chain", label: "Cadena" },
	{ value: "rail", label: "Riel" }
];

const INKDOC_STROKE_STYLE_VALUES = new Set<string>(
	INKDOC_STROKE_STYLE_OPTIONS.map((option) => option.value)
);

const getDashUnitPattern = (style: InkDocStrokeStyle): number[] => {
	if (style === "dashed") {
		return [4, 2.4];
	}
	if (style === "dotted") {
		return [1.2, 1.9];
	}
	if (style === "long-dash") {
		return [7, 3];
	}
	if (style === "short-dash") {
		return [2.6, 1.8];
	}
	if (style === "dash-dot") {
		return [4.2, 1.8, 1, 1.8];
	}
	if (style === "dash-double-dot") {
		return [4.2, 1.8, 1, 1.2, 1, 1.8];
	}
	if (style === "sparse-dots") {
		return [1.1, 3.2];
	}
	if (style === "dense-dots") {
		return [1.2, 1.1];
	}
	if (style === "chain") {
		return [5.5, 1.6, 2.1, 1.6];
	}
	if (style === "rail") {
		return [8, 1.3];
	}
	return [];
};

const getPdfDashPattern = (style: InkDocStrokeStyle): number[] => {
	if (style === "dashed") {
		return [2, 1];
	}
	if (style === "dotted") {
		return [0.3, 1.2];
	}
	if (style === "long-dash") {
		return [3.2, 1.2];
	}
	if (style === "short-dash") {
		return [1.3, 0.8];
	}
	if (style === "dash-dot") {
		return [2.2, 0.8, 0.35, 0.8];
	}
	if (style === "dash-double-dot") {
		return [2.2, 0.8, 0.35, 0.6, 0.35, 0.8];
	}
	if (style === "sparse-dots") {
		return [0.3, 2];
	}
	if (style === "dense-dots") {
		return [0.35, 0.75];
	}
	if (style === "chain") {
		return [2.6, 0.7, 0.8, 0.7];
	}
	if (style === "rail") {
		return [3.8, 0.6];
	}
	return [];
};

export const isInkDocStrokeStyle = (value: unknown): value is InkDocStrokeStyle =>
	typeof value === "string" && INKDOC_STROKE_STYLE_VALUES.has(value);

export const resolveInkDocStrokeStyle = (value: unknown): InkDocStrokeStyle =>
	isInkDocStrokeStyle(value) ? value : "solid";

export const applyStrokeStyleToCanvas = (
	ctx: CanvasRenderingContext2D,
	style: InkDocStrokeStyle,
	width: number
): void => {
	const units = getDashUnitPattern(style);
	if (units.length === 0) {
		ctx.setLineDash([]);
		return;
	}
	const base = Math.max(1, width);
	ctx.setLineDash(units.map((unit) => Math.max(1, unit * base)));
};

export const applyStrokeStyleToPdf = (pdf: any, style: InkDocStrokeStyle): void => {
	const pattern = getPdfDashPattern(style);
	pdf.setLineDashPattern(pattern, 0);
};

export const drawStrokePreview = (
	canvas: HTMLCanvasElement,
	style: InkDocStrokeStyle,
	color: string,
	width: number,
	isHighlighter = false
): void => {
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return;
	}
	const dpr = window.devicePixelRatio || 1;
	const cssWidth = Math.max(1, canvas.clientWidth || canvas.width);
	const cssHeight = Math.max(1, canvas.clientHeight || canvas.height);
	canvas.width = Math.round(cssWidth * dpr);
	canvas.height = Math.round(cssHeight * dpr);
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, cssWidth, cssHeight);
	ctx.lineWidth = Math.max(1, width);
	ctx.lineCap = isHighlighter ? "butt" : "round";
	ctx.lineJoin = isHighlighter ? "miter" : "round";
	ctx.globalAlpha = isHighlighter ? 0.35 : 1;
	ctx.globalCompositeOperation = isHighlighter ? "multiply" : "source-over";
	ctx.strokeStyle = color;
	applyStrokeStyleToCanvas(ctx, style, width);
	const padding = Math.max(6, width * 1.5);
	const centerY = cssHeight / 2;
	ctx.beginPath();
	ctx.moveTo(padding, centerY);
	ctx.lineTo(Math.max(padding + 2, cssWidth - padding), centerY);
	ctx.stroke();
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = "source-over";
};
