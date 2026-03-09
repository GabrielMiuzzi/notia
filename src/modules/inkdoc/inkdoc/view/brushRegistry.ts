// @ts-nocheck
import type { InkDocBrushId, InkDocStrokeStyle, InkDocStrokeTool } from "../types";

export type BrushTexture = "none" | "graphite" | "soft" | "ink" | "marker" | "highlighter";
export type BrushBlendMode = GlobalCompositeOperation;
export type AirbrushFalloffType = "gaussian" | "linear";

export type TexturedPencilSettings = {
	baseSize: number;
	pressureAffectsSize: boolean;
	pressureAffectsOpacity: boolean;
	textureIntensity: number;
	edgeRoughness: number;
	grainScale: number;
	stabilization: number;
};

export type AirbrushSoftSettings = {
	baseSize: number;
	flow: number;
	density: number;
	pressureAffectsFlow: boolean;
	falloffType: AirbrushFalloffType;
	buildUp: boolean;
	stabilization: number;
};

export type BrushPreset = {
	id: InkDocBrushId | string;
	label: string;
	tool: InkDocStrokeTool | "eraser";
	defaultWidth: number;
	defaultOpacity: number;
	style: InkDocStrokeStyle;
	texture: BrushTexture;
	blendMode: BrushBlendMode;
	cap: CanvasLineCap;
	join: CanvasLineJoin;
	minWidth: number;
	maxWidth: number;
	pressureAffectsWidth: boolean;
	pressureAffectsOpacity: boolean;
	tiltAffectsWidth: boolean;
	tiltAffectsTexture: boolean;
	stabilizer: number;
	smoothing: number;
	pressureResponse: number;
	velocityInfluence: number;
	taperStrength: number;
	texturedPencil?: TexturedPencilSettings;
	airbrushSoft?: AirbrushSoftSettings;
};

export const DEFAULT_BRUSH_PRESETS: BrushPreset[] = [
	{
		id: "monoline",
		label: "Pen / Monoline",
		tool: "pen",
		defaultWidth: 3,
		defaultOpacity: 1,
		style: "solid",
		texture: "none",
		blendMode: "source-over",
		cap: "round",
		join: "round",
		minWidth: 1,
		maxWidth: 20,
		pressureAffectsWidth: true,
		pressureAffectsOpacity: false,
		tiltAffectsWidth: false,
		tiltAffectsTexture: false,
		stabilizer: 0.75,
		smoothing: 0.35,
		pressureResponse: 0.78,
		velocityInfluence: 0.46,
		taperStrength: 0.58
	},
	{
		id: "pencil-graphite",
		label: "Pencil / Graphite",
		tool: "pen",
		defaultWidth: 4,
		defaultOpacity: 0.7,
		style: "solid",
		texture: "graphite",
		blendMode: "source-over",
		cap: "round",
		join: "round",
		minWidth: 1,
		maxWidth: 24,
		pressureAffectsWidth: true,
		pressureAffectsOpacity: true,
		tiltAffectsWidth: true,
		tiltAffectsTexture: true,
		stabilizer: 0.65,
		smoothing: 0.45,
		pressureResponse: 0.74,
		velocityInfluence: 0.55,
		taperStrength: 0.64
	},
	{
		id: "textured_pencil",
		label: "Textured Pencil",
		tool: "pen",
		defaultWidth: 5,
		defaultOpacity: 0.72,
		style: "solid",
		texture: "graphite",
		blendMode: "source-over",
		cap: "round",
		join: "round",
		minWidth: 1,
		maxWidth: 24,
		pressureAffectsWidth: true,
		pressureAffectsOpacity: true,
		tiltAffectsWidth: true,
		tiltAffectsTexture: true,
		stabilizer: 0.62,
		smoothing: 0.45,
		pressureResponse: 0.72,
		velocityInfluence: 0.56,
		taperStrength: 0.68,
		texturedPencil: {
			baseSize: 5,
			pressureAffectsSize: true,
			pressureAffectsOpacity: true,
			textureIntensity: 0.72,
			edgeRoughness: 0.32,
			grainScale: 1.3,
			stabilization: 0.62
		}
	},
	{
		id: "soft-brush",
		label: "Soft Brush",
		tool: "pen",
		defaultWidth: 10,
		defaultOpacity: 0.45,
		style: "solid",
		texture: "soft",
		blendMode: "source-over",
		cap: "round",
		join: "round",
		minWidth: 2,
		maxWidth: 80,
		pressureAffectsWidth: true,
		pressureAffectsOpacity: true,
		tiltAffectsWidth: false,
		tiltAffectsTexture: false,
		stabilizer: 0.55,
		smoothing: 0.5,
		pressureResponse: 0.86,
		velocityInfluence: 0.34,
		taperStrength: 0.46
	},
	{
		id: "airbrush_soft",
		label: "Airbrush Soft",
		tool: "pen",
		defaultWidth: 18,
		defaultOpacity: 0.45,
		style: "solid",
		texture: "soft",
		blendMode: "source-over",
		cap: "round",
		join: "round",
		minWidth: 4,
		maxWidth: 96,
		pressureAffectsWidth: true,
		pressureAffectsOpacity: true,
		tiltAffectsWidth: false,
		tiltAffectsTexture: false,
		stabilizer: 0.58,
		smoothing: 0.52,
		pressureResponse: 0.82,
		velocityInfluence: 0.32,
		taperStrength: 0.42,
		airbrushSoft: {
			baseSize: 18,
			flow: 0.45,
			density: 0.78,
			pressureAffectsFlow: true,
			falloffType: "gaussian",
			buildUp: true,
			stabilization: 0.58
		}
	},
	{
		id: "ink-brush",
		label: "Ink Brush",
		tool: "pen",
		defaultWidth: 6,
		defaultOpacity: 0.95,
		style: "solid",
		texture: "ink",
		blendMode: "source-over",
		cap: "round",
		join: "round",
		minWidth: 1,
		maxWidth: 48,
		pressureAffectsWidth: true,
		pressureAffectsOpacity: true,
		tiltAffectsWidth: true,
		tiltAffectsTexture: false,
		stabilizer: 0.5,
		smoothing: 0.35,
		pressureResponse: 0.62,
		velocityInfluence: 0.64,
		taperStrength: 0.72
	},
	{
		id: "marker",
		label: "Marker",
		tool: "pen",
		defaultWidth: 12,
		defaultOpacity: 0.9,
		style: "solid",
		texture: "marker",
		blendMode: "source-over",
		cap: "butt",
		join: "bevel",
		minWidth: 4,
		maxWidth: 72,
		pressureAffectsWidth: true,
		pressureAffectsOpacity: false,
		tiltAffectsWidth: true,
		tiltAffectsTexture: true,
		stabilizer: 0.72,
		smoothing: 0.3,
		pressureResponse: 0.76,
		velocityInfluence: 0.48,
		taperStrength: 0.54
	},
	{
		id: "highlighter",
		label: "Highlighter",
		tool: "highlighter",
		defaultWidth: 14,
		defaultOpacity: 0.35,
		style: "solid",
		texture: "highlighter",
		blendMode: "multiply",
		cap: "butt",
		join: "miter",
		minWidth: 6,
		maxWidth: 80,
		pressureAffectsWidth: false,
		pressureAffectsOpacity: false,
		tiltAffectsWidth: true,
		tiltAffectsTexture: false,
		stabilizer: 0.7,
		smoothing: 0.25,
		pressureResponse: 1,
		velocityInfluence: 0.2,
		taperStrength: 0.34
	},
	{
		id: "sketch-pro",
		label: "Drawing Pro / Sketch",
		tool: "pen",
		defaultWidth: 4,
		defaultOpacity: 0.84,
		style: "solid",
		texture: "graphite",
		blendMode: "source-over",
		cap: "round",
		join: "round",
		minWidth: 0.8,
		maxWidth: 30,
		pressureAffectsWidth: true,
		pressureAffectsOpacity: true,
		tiltAffectsWidth: true,
		tiltAffectsTexture: true,
		stabilizer: 0.5,
		smoothing: 0.28,
		pressureResponse: 0.68,
		velocityInfluence: 0.58,
		taperStrength: 0.74
	},
	{
		id: "ink-pro",
		label: "Drawing Pro / Inking",
		tool: "pen",
		defaultWidth: 5,
		defaultOpacity: 0.96,
		style: "solid",
		texture: "ink",
		blendMode: "source-over",
		cap: "round",
		join: "round",
		minWidth: 0.9,
		maxWidth: 42,
		pressureAffectsWidth: true,
		pressureAffectsOpacity: true,
		tiltAffectsWidth: true,
		tiltAffectsTexture: false,
		stabilizer: 0.45,
		smoothing: 0.2,
		pressureResponse: 0.56,
		velocityInfluence: 0.66,
		taperStrength: 0.82
	},
	{
		id: "shade-pro",
		label: "Drawing Pro / Shade",
		tool: "pen",
		defaultWidth: 14,
		defaultOpacity: 0.52,
		style: "solid",
		texture: "soft",
		blendMode: "source-over",
		cap: "round",
		join: "round",
		minWidth: 2,
		maxWidth: 90,
		pressureAffectsWidth: true,
		pressureAffectsOpacity: true,
		tiltAffectsWidth: false,
		tiltAffectsTexture: false,
		stabilizer: 0.4,
		smoothing: 0.24,
		pressureResponse: 0.92,
		velocityInfluence: 0.26,
		taperStrength: 0.38
	},
	{
		id: "eraser",
		label: "Eraser",
		tool: "eraser",
		defaultWidth: 12,
		defaultOpacity: 1,
		style: "solid",
		texture: "none",
		blendMode: "destination-out",
		cap: "round",
		join: "round",
		minWidth: 4,
		maxWidth: 80,
		pressureAffectsWidth: false,
		pressureAffectsOpacity: false,
		tiltAffectsWidth: false,
		tiltAffectsTexture: false,
		stabilizer: 0.4,
		smoothing: 0.2,
		pressureResponse: 1,
		velocityInfluence: 0,
		taperStrength: 0
	}
];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const parseTexturedPencilSettings = (raw: unknown): TexturedPencilSettings | undefined => {
	if (!raw || typeof raw !== "object") {
		return undefined;
	}
	const value = raw as Partial<TexturedPencilSettings>;
	return {
		baseSize: Math.max(1, Number(value.baseSize ?? 4)),
		pressureAffectsSize: value.pressureAffectsSize !== false,
		pressureAffectsOpacity: value.pressureAffectsOpacity !== false,
		textureIntensity: clamp01(Number(value.textureIntensity ?? 0.7)),
		edgeRoughness: clamp01(Number(value.edgeRoughness ?? 0.3)),
		grainScale: Math.max(0.2, Number(value.grainScale ?? 1)),
		stabilization: clamp01(Number(value.stabilization ?? 0.6))
	};
};

const parseAirbrushSoftSettings = (raw: unknown): AirbrushSoftSettings | undefined => {
	if (!raw || typeof raw !== "object") {
		return undefined;
	}
	const value = raw as Partial<AirbrushSoftSettings>;
	return {
		baseSize: Math.max(1, Number(value.baseSize ?? 16)),
		flow: clamp01(Number(value.flow ?? 0.4)),
		density: clamp01(Number(value.density ?? 0.75)),
		pressureAffectsFlow: value.pressureAffectsFlow !== false,
		falloffType: value.falloffType === "linear" ? "linear" : "gaussian",
		buildUp: value.buildUp !== false,
		stabilization: clamp01(Number(value.stabilization ?? 0.55))
	};
};

const parseBrushPreset = (value: unknown): BrushPreset | null => {
	if (!value || typeof value !== "object") {
		return null;
	}
	const raw = value as Partial<BrushPreset>;
	if (typeof raw.id !== "string" || typeof raw.label !== "string") {
		return null;
	}
	const tool = raw.tool === "highlighter" || raw.tool === "eraser" ? raw.tool : "pen";
	const defaultWidth = Number.isFinite(raw.defaultWidth ?? NaN) ? Number(raw.defaultWidth) : 3;
	const defaultOpacity = Number.isFinite(raw.defaultOpacity ?? NaN)
		? clamp01(Number(raw.defaultOpacity))
		: 1;
	const style = typeof raw.style === "string" ? raw.style : "solid";
	const texture: BrushTexture =
		raw.texture === "graphite" ||
		raw.texture === "soft" ||
		raw.texture === "ink" ||
		raw.texture === "marker" ||
		raw.texture === "highlighter"
			? raw.texture
			: "none";
	return {
		id: raw.id,
		label: raw.label,
		tool,
		defaultWidth: Math.max(0.25, defaultWidth),
		defaultOpacity,
		style: style as InkDocStrokeStyle,
		texture,
		blendMode: typeof raw.blendMode === "string" ? raw.blendMode : "source-over",
		cap: raw.cap === "butt" || raw.cap === "square" ? raw.cap : "round",
		join: raw.join === "bevel" || raw.join === "miter" ? raw.join : "round",
		minWidth: Math.max(0.25, Number(raw.minWidth ?? 1)),
		maxWidth: Math.max(0.25, Number(raw.maxWidth ?? 64)),
		pressureAffectsWidth: raw.pressureAffectsWidth !== false,
		pressureAffectsOpacity: raw.pressureAffectsOpacity === true,
		tiltAffectsWidth: raw.tiltAffectsWidth === true,
		tiltAffectsTexture: raw.tiltAffectsTexture === true,
		stabilizer: clamp01(Number(raw.stabilizer ?? 0.5)),
		smoothing: clamp01(Number(raw.smoothing ?? 0.35)),
		pressureResponse: Math.max(0.35, Math.min(1.3, Number(raw.pressureResponse ?? 0.78))),
		velocityInfluence: clamp01(Number(raw.velocityInfluence ?? 0.46)),
		taperStrength: clamp01(Number(raw.taperStrength ?? 0.58)),
		texturedPencil: parseTexturedPencilSettings((raw as { texturedPencil?: unknown }).texturedPencil),
		airbrushSoft: parseAirbrushSoftSettings((raw as { airbrushSoft?: unknown }).airbrushSoft)
	};
};

export class BrushRegistry {
	private presets = new Map<string, BrushPreset>();
	private orderedIds: string[] = [];

	constructor(presets: BrushPreset[] = DEFAULT_BRUSH_PRESETS) {
		for (const preset of presets) {
			this.register(preset);
		}
	}

	static fromJson(json: string): BrushRegistry {
		try {
			const parsed = JSON.parse(json);
			if (!Array.isArray(parsed)) {
				return new BrushRegistry();
			}
			const presets = parsed
				.map((entry) => parseBrushPreset(entry))
				.filter((entry): entry is BrushPreset => Boolean(entry));
			if (presets.length === 0) {
				return new BrushRegistry();
			}
			return new BrushRegistry(presets);
		} catch {
			return new BrushRegistry();
		}
	}

	register(preset: BrushPreset): void {
		this.presets.set(preset.id, preset);
		if (!this.orderedIds.includes(preset.id)) {
			this.orderedIds.push(preset.id);
		}
	}

	list(): BrushPreset[] {
		return this.orderedIds
			.map((id) => this.presets.get(id))
			.filter((preset): preset is BrushPreset => Boolean(preset));
	}

	get(id: string | null | undefined): BrushPreset {
		const hit = id ? this.presets.get(id) : null;
		if (hit) {
			return hit;
		}
		const fallback = this.presets.get("monoline") ?? this.list()[0];
		if (!fallback) {
			return {
				id: "monoline",
				label: "Pen / Monoline",
				tool: "pen",
				defaultWidth: 3,
				defaultOpacity: 1,
				style: "solid",
				texture: "none",
				blendMode: "source-over",
				cap: "round",
				join: "round",
				minWidth: 1,
				maxWidth: 20,
				pressureAffectsWidth: true,
				pressureAffectsOpacity: false,
				tiltAffectsWidth: false,
				tiltAffectsTexture: false,
				stabilizer: 0.75,
				smoothing: 0.35,
				pressureResponse: 0.78,
				velocityInfluence: 0.46,
				taperStrength: 0.58
			};
		}
		return fallback;
	}

	update(id: string, updater: (current: BrushPreset) => BrushPreset): BrushPreset {
		const current = this.get(id);
		const next = updater(current);
		this.presets.set(id, next);
		if (!this.orderedIds.includes(id)) {
			this.orderedIds.push(id);
		}
		return next;
	}
}
