// @ts-nocheck
import type { AirbrushSoftSettings, BrushPreset, TexturedPencilSettings } from "./brushRegistry";
import type { InkDocPoint, InkDocStroke } from "../types";
import { applyStrokeStyleToCanvas } from "./strokeStyles";
import { smoothStrokePoints } from "./strokeSmoothing";

export type StrokeRenderOptions = {
	stylusDynamicsEnabled?: boolean;
	quality?: "full" | "fast";
};

const STYLUS_DYNAMIC_BRUSH_IDS = new Set([
	"monoline",
	"marker",
	"pencil-graphite",
	"textured_pencil",
	"ink-brush"
]);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpPoint = (a: InkDocPoint, b: InkDocPoint, t: number): InkDocPoint => ({
	x: lerp(a.x, b.x, t),
	y: lerp(a.y, b.y, t),
	pressure:
		typeof a.pressure === "number" || typeof b.pressure === "number"
			? lerp(a.pressure ?? 0.5, b.pressure ?? 0.5, t)
			: undefined,
	tiltX:
		typeof a.tiltX === "number" || typeof b.tiltX === "number"
			? lerp(a.tiltX ?? 0, b.tiltX ?? 0, t)
			: undefined,
	tiltY:
		typeof a.tiltY === "number" || typeof b.tiltY === "number"
			? lerp(a.tiltY ?? 0, b.tiltY ?? 0, t)
			: undefined
});

const hashString = (value: string): number => {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
};

const hashNoise = (seed: number, x: number, y: number): number => {
	const n = Math.sin((x + seed * 0.00013) * 12.9898 + (y + seed * 0.00021) * 78.233) * 43758.5453;
	return n - Math.floor(n);
};

const fractalNoise = (seed: number, x: number, y: number, scale: number): number => {
	let amplitude = 0.5;
	let frequency = Math.max(0.1, scale);
	let sum = 0;
	let total = 0;
	for (let i = 0; i < 3; i++) {
		sum += hashNoise(seed + i * 977, x * frequency, y * frequency) * amplitude;
		total += amplitude;
		amplitude *= 0.5;
		frequency *= 2;
	}
	return total > 0 ? sum / total : 0.5;
};

const getAveragePressure = (points: InkDocPoint[]): number => {
	let total = 0;
	let count = 0;
	for (const point of points) {
		if (typeof point.pressure === "number") {
			total += clamp01(point.pressure);
			count += 1;
		}
	}
	return count > 0 ? total / count : 0.5;
};

const getAverageTiltIntensity = (points: InkDocPoint[]): number => {
	let total = 0;
	let count = 0;
	for (const point of points) {
		if (typeof point.tiltX === "number" || typeof point.tiltY === "number") {
			const x = Math.abs(point.tiltX ?? 0);
			const y = Math.abs(point.tiltY ?? 0);
			total += Math.min(1, Math.sqrt(x * x + y * y) / 75);
			count += 1;
		}
	}
	return count > 0 ? total / count : 0;
};

export const resolveStrokeRenderWidth = (stroke: InkDocStroke, brush: BrushPreset): number => {
	const base = Math.max(1, stroke.width || brush.defaultWidth);
	const points = stroke.points ?? [];
	const pressureFactor = brush.pressureAffectsWidth
		? 0.55 + getAveragePressure(points) * 0.9
		: 1;
	const tiltFactor = brush.tiltAffectsWidth ? 1 + getAverageTiltIntensity(points) * 0.6 : 1;
	return Math.max(brush.minWidth, Math.min(brush.maxWidth, base * pressureFactor * tiltFactor));
};

export const resolveStrokeRenderOpacity = (stroke: InkDocStroke, brush: BrushPreset): number => {
	const base = clamp01(typeof stroke.opacity === "number" ? stroke.opacity : brush.defaultOpacity);
	if (!brush.pressureAffectsOpacity) {
		return base;
	}
	const points = stroke.points ?? [];
	const pressure = getAveragePressure(points);
	return clamp01(base * (0.45 + pressure * 0.7));
};

const drawPath = (ctx: CanvasRenderingContext2D, points: InkDocPoint[]): void => {
	const first = points[0];
	if (!first) {
		return;
	}
	ctx.beginPath();
	ctx.moveTo(first.x, first.y);
	for (let i = 1; i < points.length; i++) {
		const point = points[i];
		if (!point) {
			continue;
		}
		ctx.lineTo(point.x, point.y);
	}
	ctx.stroke();
};

const drawSimplePreviewStroke = (
	ctx: CanvasRenderingContext2D,
	cssWidth: number,
	cssHeight: number,
	color: string,
	width: number,
	opacity: number,
	emphasize = false
): void => {
	ctx.save();
	ctx.globalAlpha = Math.max(0.08, Math.min(1, opacity));
	ctx.strokeStyle = color;
	const baseWidth = Math.max(1, width);
	const previewWidth = emphasize
		? Math.max(3, Math.min(cssHeight * 0.62, baseWidth * 2.4))
		: baseWidth;
	ctx.lineWidth = previewWidth;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.beginPath();
	ctx.moveTo(8, cssHeight * 0.65);
	ctx.quadraticCurveTo(cssWidth * 0.35, cssHeight * 0.2, cssWidth - 8, cssHeight * 0.55);
	ctx.stroke();
	ctx.restore();
};

const hasVisiblePreviewPixels = (
	ctx: CanvasRenderingContext2D,
	cssWidth: number,
	cssHeight: number
): boolean => {
	try {
		const probeW = Math.max(1, Math.min(cssWidth, 120));
		const probeH = Math.max(1, Math.min(cssHeight, 40));
		const image = ctx.getImageData(0, 0, probeW, probeH).data;
		for (let i = 3; i < image.length; i += 16) {
			if ((image[i] ?? 0) > 10) {
				return true;
			}
		}
		return false;
	} catch {
		return true;
	}
};

const drawRoughGraphiteStamp = (
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radiusX: number,
	radiusY: number,
	angle: number,
	alpha: number,
	settings: TexturedPencilSettings,
	seed: number,
	textureBoost = 1
): void => {
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(angle);
	const segments = 12;
	ctx.beginPath();
	for (let i = 0; i <= segments; i++) {
		const t = (i / segments) * Math.PI * 2;
		const rough = (fractalNoise(seed, Math.cos(t) * 0.8, Math.sin(t) * 0.8, settings.grainScale) - 0.5) * 2;
		const deform = 1 + rough * settings.edgeRoughness * 0.26;
		const rX = Math.max(0.6, radiusX * deform);
		const rY = Math.max(0.6, radiusY * deform);
		const px = Math.cos(t) * rX;
		const py = Math.sin(t) * rY;
		if (i === 0) {
			ctx.moveTo(px, py);
		} else {
			ctx.lineTo(px, py);
		}
	}
	ctx.closePath();
	const microOpacity = alpha * (0.86 + hashNoise(seed, x, y) * 0.24);
	ctx.globalAlpha = clamp01(microOpacity);
	ctx.fill();
	ctx.clip();
	ctx.globalCompositeOperation = "destination-out";
	const baseArea = Math.max(1, radiusX * radiusY);
	const dotCount = Math.max(
		5,
		Math.round(baseArea * 0.8 * settings.textureIntensity * Math.max(0.35, textureBoost))
	);
	const grainStep = Math.max(0.08, settings.grainScale);
	for (let i = 0; i < dotCount; i++) {
		const nx = (hashNoise(seed + 101, i * grainStep, baseArea) - 0.5) * 2;
		const ny = (hashNoise(seed + 211, baseArea, i * grainStep) - 0.5) * 2;
		const gx = nx * radiusX;
		const gy = ny * radiusY;
		const gAlpha = clamp01(
			settings.textureIntensity * textureBoost * (0.08 + hashNoise(seed + 307, i, baseArea) * 0.22)
		);
		ctx.globalAlpha = gAlpha;
		const size = 0.5 + hashNoise(seed + 409, i, baseArea) * 1.4;
		ctx.fillRect(gx, gy, size, size);
	}
	ctx.restore();
};

type StylusDynamics = {
	pressure: number;
	tilt: number;
	azimuth: number;
};

const resolveStylusDynamics = (point: InkDocPoint, fallbackAzimuth: number): StylusDynamics => {
	const pressure = clamp01(typeof point.pressure === "number" ? point.pressure : 0.5);
	const tiltX = typeof point.tiltX === "number" ? point.tiltX : 0;
	const tiltY = typeof point.tiltY === "number" ? point.tiltY : 0;
	const tilt = clamp01(Math.sqrt(tiltX * tiltX + tiltY * tiltY) / 70);
	const hasTiltVector = Math.abs(tiltX) > 0.1 || Math.abs(tiltY) > 0.1;
	return {
		pressure,
		tilt,
		azimuth: hasTiltVector ? Math.atan2(tiltY, tiltX) : fallbackAzimuth
	};
};

const renderTexturedPencil = (
	ctx: CanvasRenderingContext2D,
	stroke: InkDocStroke,
	points: InkDocPoint[],
	width: number,
	opacity: number,
	settings: TexturedPencilSettings,
	useStylusDynamics: boolean,
	brush: BrushPreset
): void => {
	if (points.length === 0) {
		return;
	}

	const seedBase = hashString(stroke.id);
	const baseWidth = Math.max(0.6, resolveConfiguredBaseSize(width, settings.baseSize, brush));

	if (points.length === 1) {
		const point = points[0];
		if (!point) {
			return;
		}
		ctx.save();
		ctx.globalCompositeOperation = "source-over";
		ctx.fillStyle = stroke.color;
		ctx.globalAlpha = clamp01(opacity * 0.85);
		ctx.beginPath();
		ctx.arc(point.x, point.y, Math.max(0.5, baseWidth * 0.3), 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
		return;
	}

	ctx.save();
	ctx.globalCompositeOperation = "source-over";
	ctx.strokeStyle = stroke.color;
	ctx.fillStyle = stroke.color;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	applyStrokeStyleToCanvas(ctx, stroke.style, baseWidth);

	let grainTick = 0;
	for (let i = 1; i < points.length; i++) {
		const prev = points[i - 1];
		const curr = points[i];
		if (!prev || !curr) {
			continue;
		}
		const dx = curr.x - prev.x;
		const dy = curr.y - prev.y;
		const direction = Math.atan2(dy, dx);
		const velocityN = resolveVelocityNormalized(prev, curr, baseWidth);
		const distance = Math.sqrt(dx * dx + dy * dy);
		const spacing = Math.max(0.9, baseWidth * 0.42);
		const steps = Math.max(1, Math.round(distance / spacing));

		let last = prev;
		for (let step = 1; step <= steps; step++) {
			const t = step / steps;
			const sample = lerpPoint(prev, curr, t);
			const dynamics = resolveStylusDynamics(sample, direction);
			const pressure = useStylusDynamics ? dynamics.pressure : 0.5;
			const tilt = useStylusDynamics ? dynamics.tilt : 0;
			const pressureSize = settings.pressureAffectsSize ? lerp(0.78, 1.2, pressure) : 1;
			const pressureForOpacity = settings.pressureAffectsOpacity ? pressure : 0.5;
			const progress = clamp01((i - 1 + t) / Math.max(1, points.length - 1));
			const dynamicWidth = resolveExpressiveWidth(
				baseWidth,
				Math.max(0.5, brush.minWidth),
				brush.maxWidth,
				pressure,
				tilt,
				velocityN,
				progress,
				brush.tiltAffectsWidth,
				brush.pressureResponse,
				brush.velocityInfluence,
				brush.taperStrength
			);
			const widthWithPressure = Math.max(0.45, dynamicWidth * pressureSize);
			const baseAlpha = resolveExpressiveOpacity(
				opacity,
				pressureForOpacity,
				velocityN,
				brush.pressureResponse,
				brush.velocityInfluence
			);

			ctx.lineWidth = widthWithPressure;
			ctx.globalAlpha = clamp01(baseAlpha * lerp(0.7, 1, settings.textureIntensity));
			ctx.beginPath();
			ctx.moveTo(last.x, last.y);
			ctx.lineTo(sample.x, sample.y);
			ctx.stroke();

			// Sparse grain over a continuous stroke; avoids "dot blobs" while keeping texture.
			grainTick += 1;
			if (grainTick % 3 === 0) {
				const jitterX = (hashNoise(seedBase + 101, grainTick, sample.x) - 0.5) * widthWithPressure * 0.45;
				const jitterY = (hashNoise(seedBase + 211, sample.y, grainTick) - 0.5) * widthWithPressure * 0.45;
				const grainSize = Math.max(0.35, widthWithPressure * 0.11);
				ctx.globalAlpha = clamp01(baseAlpha * settings.textureIntensity * 0.22);
				ctx.fillRect(sample.x + jitterX, sample.y + jitterY, grainSize, grainSize);
			}

			last = sample;
		}
	}
	ctx.restore();

	drawTexturePasses(ctx, points, baseWidth, opacity * 0.72, { ...brush, texture: "graphite" });
};

const renderDynamicGraphiteBrush = (
	ctx: CanvasRenderingContext2D,
	stroke: InkDocStroke,
	points: InkDocPoint[],
	width: number,
	opacity: number,
	brush: BrushPreset
): void => {
	if (points.length < 2) {
		return;
	}
	const settings: TexturedPencilSettings = {
		baseSize: width,
		pressureAffectsSize: true,
		pressureAffectsOpacity: true,
		textureIntensity: 0.6,
		edgeRoughness: 0.28,
		grainScale: 1.05,
		stabilization: 0.6
	};
	const seedBase = hashString(stroke.id);
	ctx.save();
	ctx.fillStyle = stroke.color;
	ctx.globalCompositeOperation = "source-over";
	let seedOffset = 0;
	for (let i = 1; i < points.length; i++) {
		const prev = points[i - 1];
		const curr = points[i];
		if (!prev || !curr) {
			continue;
		}
		const dx = curr.x - prev.x;
		const dy = curr.y - prev.y;
		const distance = Math.sqrt(dx * dx + dy * dy);
		const steps = Math.max(1, Math.round(distance / Math.max(0.6, width * 0.18)));
		const velocityN = resolveVelocityNormalized(prev, curr, width);
		for (let step = 0; step <= steps; step++) {
			const t = step / steps;
			const sample = lerpPoint(prev, curr, t);
			const dynamics = resolveStylusDynamics(sample, Math.atan2(dy, dx));
			const progress = clamp01((i - 1 + t) / Math.max(1, points.length - 1));
			const expressiveWidth = resolveExpressiveWidth(
				width,
				Math.max(0.6, width * 0.14),
				Math.max(width * 2.4, width + 8),
				dynamics.pressure,
				dynamics.tilt,
				velocityN,
				progress,
				true,
				brush.pressureResponse,
				brush.velocityInfluence,
				brush.taperStrength
			);
			const baseRadius = Math.max(0.5, expressiveWidth * 0.34);
			const major = baseRadius * (1 + dynamics.tilt * 1.35);
			const minor = Math.max(0.4, baseRadius * (1 - dynamics.tilt * 0.42));
			const alpha = resolveExpressiveOpacity(
				opacity * 0.98,
				dynamics.pressure,
				velocityN,
				brush.pressureResponse,
				brush.velocityInfluence
			);
			drawRoughGraphiteStamp(
				ctx,
				sample.x,
				sample.y,
				major,
				minor,
				dynamics.azimuth,
				alpha,
				settings,
				seedBase + seedOffset * 47,
				1 + dynamics.tilt * 0.5
			);
			seedOffset += 1;
		}
	}
	ctx.restore();
};

const getSegmentDistance = (a: InkDocPoint, b: InkDocPoint): number =>
	Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);

const resolveVelocityNormalized = (prev: InkDocPoint, curr: InkDocPoint, baseWidth: number): number => {
	const distance = getSegmentDistance(prev, curr);
	const widthRef = Math.max(1, baseWidth);
	return clamp01(distance / (widthRef * 1.45));
};

const resolveExpressivePressure = (pressure: number, response: number): number => {
	const exponent = Math.max(0.35, Math.min(1.3, response));
	return Math.pow(clamp01(pressure), exponent);
};

const resolveStrokeTaper = (progress: number): number => {
	const edge = Math.max(0, Math.min(1, Math.min(progress, 1 - progress) * 2));
	return 0.56 + 0.44 * Math.pow(edge, 0.45);
};

const resolveExpressiveWidth = (
	baseWidth: number,
	minWidth: number,
	maxWidth: number,
	pressure: number,
	tilt: number,
	velocityN: number,
	progress: number,
	tiltAffectsWidth: boolean,
	pressureResponse: number,
	velocityInfluence: number,
	taperStrength: number,
	calligraphyFactor = 1
): number => {
	const p = resolveExpressivePressure(pressure, pressureResponse);
	const pressureFactor = lerp(0.24, 1.25, p);
	const velocityRange = lerp(0.12, 0.45, clamp01(velocityInfluence));
	const velocityFactor = lerp(1 + velocityRange * 0.22, 1 - velocityRange, velocityN);
	const tiltFactor = tiltAffectsWidth ? lerp(1, 1.33, tilt) : 1;
	const taper = lerp(1, resolveStrokeTaper(progress), clamp01(taperStrength));
	const nextWidth =
		baseWidth *
		pressureFactor *
		velocityFactor *
		tiltFactor *
		calligraphyFactor *
		taper;
	return Math.max(minWidth, Math.min(maxWidth, nextWidth));
};

const resolveExpressiveOpacity = (
	baseOpacity: number,
	pressure: number,
	velocityN: number,
	pressureResponse: number,
	velocityInfluence: number
): number => {
	const p = resolveExpressivePressure(pressure, pressureResponse);
	const pressureFactor = lerp(0.72, 1.08, p);
	const velocityAlphaDrop = lerp(0.08, 0.28, clamp01(velocityInfluence));
	const velocityFactor = lerp(1, 1 - velocityAlphaDrop, velocityN);
	return clamp01(baseOpacity * pressureFactor * velocityFactor);
};

const resolveConfiguredBaseSize = (
	width: number,
	configuredBaseSize: number | undefined,
	brush: BrushPreset
): number => {
	const liveWidth = Math.max(0.25, width);
	const presetDefault = Math.max(0.25, brush.defaultWidth || liveWidth);
	if (!Number.isFinite(configuredBaseSize ?? NaN) || (configuredBaseSize ?? 0) <= 0) {
		return liveWidth;
	}
	const ratio = Math.max(0.25, Number(configuredBaseSize) / presetDefault);
	return liveWidth * ratio;
};

const renderAirbrushSoft = (
	ctx: CanvasRenderingContext2D,
	stroke: InkDocStroke,
	points: InkDocPoint[],
	width: number,
	opacity: number,
	settings: AirbrushSoftSettings,
	brush: BrushPreset
): void => {
	if (points.length < 1) {
		return;
	}
	ctx.save();
	ctx.globalCompositeOperation = stroke.tool === "highlighter" ? "multiply" : "source-over";
	const baseSize = Math.max(0.8, resolveConfiguredBaseSize(width, settings.baseSize, brush));
	const seed = hashString(stroke.id);
	for (let i = 0; i < points.length; i++) {
		const point = points[i];
		if (!point) {
			continue;
		}
		const prev = i > 0 ? points[i - 1] : point;
		const next = i < points.length - 1 ? points[i + 1] : point;
		if (!prev || !next) {
			continue;
		}
		const segmentSpeed = getSegmentDistance(prev, point) + getSegmentDistance(point, next);
		const velocityN = clamp01(segmentSpeed / Math.max(1, width));
		const pressure = clamp01(typeof point.pressure === "number" ? point.pressure : 0.5);
		const flowPressure = settings.pressureAffectsFlow ? lerp(0.6, 1, pressure) : 1;
		const flow = clamp01(settings.flow * flowPressure * (0.85 + hashNoise(seed + i * 19, point.x, point.y) * 0.25));
		const stampRadius = Math.max(1, baseSize * (0.8 + pressure * 0.35));
		const stampSpacing = Math.max(0.6, stampRadius * lerp(0.12, 0.4, velocityN) / Math.max(0.15, settings.density));
		const steps = Math.max(1, Math.round(Math.max(1, segmentSpeed) / stampSpacing));
		for (let step = 0; step < steps; step++) {
			const t = step / steps;
			const x = lerp(prev.x, point.x, t);
			const y = lerp(prev.y, point.y, t);
			const gradient = ctx.createRadialGradient(x, y, 0, x, y, stampRadius);
			const stampAlphaBase = clamp01(opacity * flow * (settings.buildUp ? 1 : 0.75));
			if (settings.falloffType === "linear") {
				gradient.addColorStop(0, `rgba(0,0,0,${stampAlphaBase})`);
				gradient.addColorStop(1, "rgba(0,0,0,0)");
			} else {
				gradient.addColorStop(0, `rgba(0,0,0,${stampAlphaBase})`);
				gradient.addColorStop(0.35, `rgba(0,0,0,${stampAlphaBase * 0.62})`);
				gradient.addColorStop(0.72, `rgba(0,0,0,${stampAlphaBase * 0.18})`);
				gradient.addColorStop(1, "rgba(0,0,0,0)");
			}
			ctx.fillStyle = gradient;
			ctx.save();
			ctx.globalCompositeOperation = "source-over";
			ctx.fillRect(x - stampRadius, y - stampRadius, stampRadius * 2, stampRadius * 2);
			ctx.restore();
		}
	}
	ctx.restore();
};

const renderDynamicInkBrush = (
	ctx: CanvasRenderingContext2D,
	stroke: InkDocStroke,
	points: InkDocPoint[],
	width: number,
	opacity: number,
	brush: BrushPreset
): void => {
	if (points.length < 2) {
		return;
	}
	ctx.save();
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.strokeStyle = stroke.color;
	ctx.globalCompositeOperation = brush.blendMode;
	applyStrokeStyleToCanvas(ctx, stroke.style, width);
	for (let i = 1; i < points.length; i++) {
		const prev = points[i - 1];
		const curr = points[i];
		if (!prev || !curr) {
			continue;
		}
		const dx = curr.x - prev.x;
		const dy = curr.y - prev.y;
		const distance = Math.sqrt(dx * dx + dy * dy);
		const direction = Math.atan2(dy, dx);
		const steps = Math.max(1, Math.round(distance / Math.max(0.7, width * 0.22)));
		const velocityN = resolveVelocityNormalized(prev, curr, width);
		let last = prev;
		for (let step = 1; step <= steps; step++) {
			const t = step / steps;
			const sample = lerpPoint(prev, curr, t);
			const dynamics = resolveStylusDynamics(sample, direction);
			const progress = clamp01((i - 1 + t) / Math.max(1, points.length - 1));
			const calligraphy = 0.42 + Math.abs(Math.sin(direction - dynamics.azimuth)) * 0.92;
			ctx.lineWidth = resolveExpressiveWidth(
				width,
				brush.minWidth,
				brush.maxWidth,
				dynamics.pressure,
				dynamics.tilt,
				velocityN,
				progress,
				brush.tiltAffectsWidth,
				brush.pressureResponse,
				brush.velocityInfluence,
				brush.taperStrength,
				calligraphy
			);
			ctx.globalAlpha = resolveExpressiveOpacity(
				opacity,
				dynamics.pressure,
				velocityN,
				brush.pressureResponse,
				brush.velocityInfluence
			);
			ctx.beginPath();
			ctx.moveTo(last.x, last.y);
			ctx.lineTo(sample.x, sample.y);
			ctx.stroke();
			last = sample;
		}
	}
	drawTexturePasses(ctx, points, width, opacity * 0.8, brush);
	ctx.restore();
};

const renderDynamicMonolineBrush = (
	ctx: CanvasRenderingContext2D,
	stroke: InkDocStroke,
	points: InkDocPoint[],
	width: number,
	opacity: number,
	brush: BrushPreset
): void => {
	if (points.length < 2) {
		renderDefaultBrush(ctx, stroke, points, width, opacity, brush);
		return;
	}
	ctx.save();
	ctx.lineCap = brush.cap;
	ctx.lineJoin = brush.join;
	ctx.strokeStyle = stroke.color;
	ctx.globalCompositeOperation = brush.blendMode;
	applyStrokeStyleToCanvas(ctx, stroke.style, width);
	for (let i = 1; i < points.length; i++) {
		const prev = points[i - 1];
		const curr = points[i];
		if (!prev || !curr) {
			continue;
		}
		const direction = Math.atan2(curr.y - prev.y, curr.x - prev.x);
		const velocityN = resolveVelocityNormalized(prev, curr, width);
		const steps = Math.max(1, Math.round(getSegmentDistance(prev, curr) / Math.max(0.7, width * 0.25)));
		let last = prev;
		for (let step = 1; step <= steps; step++) {
			const t = step / steps;
			const sample = lerpPoint(prev, curr, t);
			const dynamics = resolveStylusDynamics(sample, direction);
			const progress = clamp01((i - 1 + t) / Math.max(1, points.length - 1));
			ctx.lineWidth = resolveExpressiveWidth(
				width,
				brush.minWidth,
				brush.maxWidth,
				dynamics.pressure,
				dynamics.tilt,
				velocityN,
				progress,
				brush.tiltAffectsWidth,
				brush.pressureResponse,
				brush.velocityInfluence,
				brush.taperStrength
			);
			ctx.globalAlpha = resolveExpressiveOpacity(
				opacity,
				dynamics.pressure,
				velocityN,
				brush.pressureResponse,
				brush.velocityInfluence
			);
			ctx.beginPath();
			ctx.moveTo(last.x, last.y);
			ctx.lineTo(sample.x, sample.y);
			ctx.stroke();
			last = sample;
		}
	}
	ctx.restore();
};

const strokeHasStylusData = (points: InkDocPoint[]): boolean =>
	points.some(
		(point) =>
			typeof point.pressure === "number" ||
			typeof point.tiltX === "number" ||
			typeof point.tiltY === "number"
	);

const drawTexturePasses = (
	ctx: CanvasRenderingContext2D,
	points: InkDocPoint[],
	width: number,
	opacity: number,
	brush: BrushPreset
): void => {
	if (brush.texture === "graphite") {
		ctx.save();
		ctx.globalAlpha = Math.max(0.05, opacity * 0.25);
		ctx.lineWidth = Math.max(1, width * 0.45);
		ctx.setLineDash([Math.max(1, width * 0.6), Math.max(1, width * 0.8)]);
		drawPath(ctx, points);
		ctx.restore();
		return;
	}
	if (brush.texture === "soft") {
		ctx.save();
		ctx.globalAlpha = Math.max(0.08, opacity * 0.25);
		ctx.shadowBlur = Math.max(4, width * 0.9);
		ctx.shadowColor = ctx.strokeStyle as string;
		ctx.lineWidth = Math.max(1, width * 0.9);
		ctx.setLineDash([]);
		drawPath(ctx, points);
		ctx.restore();
		return;
	}
	if (brush.texture === "ink") {
		ctx.save();
		ctx.globalAlpha = Math.max(0.08, opacity * 0.2);
		ctx.lineWidth = Math.max(1, width * 0.35);
		ctx.setLineDash([Math.max(1, width * 0.2), Math.max(1, width * 0.35)]);
		drawPath(ctx, points);
		ctx.restore();
		return;
	}
	if (brush.texture === "marker") {
		ctx.save();
		ctx.globalAlpha = Math.max(0.06, opacity * 0.35);
		ctx.lineWidth = Math.max(1, width * 0.65);
		ctx.setLineDash([]);
		drawPath(ctx, points);
		ctx.restore();
	}
};

const renderDefaultBrush = (
	ctx: CanvasRenderingContext2D,
	stroke: InkDocStroke,
	points: InkDocPoint[],
	width: number,
	opacity: number,
	brush: BrushPreset
): void => {
	ctx.save();
	ctx.lineCap = brush.cap;
	ctx.lineJoin = brush.join;
	ctx.globalAlpha = opacity;
	ctx.globalCompositeOperation = brush.blendMode;
	ctx.strokeStyle = stroke.color;
	ctx.lineWidth = width;
	applyStrokeStyleToCanvas(ctx, stroke.style, width);
	drawPath(ctx, points);
	drawTexturePasses(ctx, points, width, opacity, brush);
	ctx.restore();
};

const renderFastUniversalBrush = (
	ctx: CanvasRenderingContext2D,
	stroke: InkDocStroke,
	points: InkDocPoint[],
	width: number,
	opacity: number,
	brush: BrushPreset
): void => {
	ctx.save();
	ctx.lineCap = brush.cap;
	ctx.lineJoin = brush.join;
	ctx.globalAlpha = opacity;
	ctx.globalCompositeOperation = brush.blendMode;
	ctx.strokeStyle = stroke.color;
	ctx.fillStyle = stroke.color;
	ctx.lineWidth = width;
	applyStrokeStyleToCanvas(ctx, stroke.style, width);
	if (points.length === 1) {
		const point = points[0];
		if (point) {
			ctx.beginPath();
			ctx.arc(point.x, point.y, Math.max(0.5, width * 0.5), 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
		return;
	}
	drawPath(ctx, points);
	ctx.restore();
};

export const renderStrokeWithBrush = (
	ctx: CanvasRenderingContext2D,
	stroke: InkDocStroke,
	brush: BrushPreset,
	options: StrokeRenderOptions = {}
): void => {
	const rawPoints = stroke.points ?? [];
	if (rawPoints.length === 0) {
		return;
	}
	const smoothing = typeof stroke.smoothing === "number" ? stroke.smoothing : brush.smoothing;
	const points = smoothStrokePoints(rawPoints, smoothing);
	const width = resolveStrokeRenderWidth(stroke, brush);
	const opacity = resolveStrokeRenderOpacity(stroke, brush);
	if (options.quality === "fast") {
		renderFastUniversalBrush(ctx, stroke, points, width, opacity, brush);
		return;
	}
	const usesPatternStyle = stroke.style !== "solid";
	if (usesPatternStyle && (brush.id === "pencil-graphite" || brush.id === "textured_pencil")) {
		renderDefaultBrush(ctx, stroke, points, width, opacity, brush);
		return;
	}
	const useStylusDynamics =
		options.stylusDynamicsEnabled !== false &&
		STYLUS_DYNAMIC_BRUSH_IDS.has(String(brush.id)) &&
		strokeHasStylusData(points);
	if (useStylusDynamics && brush.id === "pencil-graphite") {
		renderDynamicGraphiteBrush(ctx, stroke, points, width, opacity, brush);
		return;
	}
	if (useStylusDynamics && (brush.id === "monoline" || brush.id === "marker")) {
		renderDynamicMonolineBrush(ctx, stroke, points, width, opacity, brush);
		return;
	}
	if (useStylusDynamics && brush.id === "ink-brush") {
		renderDynamicInkBrush(ctx, stroke, points, width, opacity, brush);
		return;
	}
	if (brush.id === "textured_pencil" && brush.texturedPencil) {
		renderTexturedPencil(
			ctx,
			stroke,
			points,
			width,
			opacity,
			brush.texturedPencil,
			useStylusDynamics,
			brush
		);
		return;
	}
	if (brush.id === "airbrush_soft" && brush.airbrushSoft) {
		renderAirbrushSoft(ctx, stroke, points, width, opacity, brush.airbrushSoft, brush);
		return;
	}
	renderDefaultBrush(ctx, stroke, points, width, opacity, brush);
};

export const drawBrushPreview = (
	canvas: HTMLCanvasElement,
	brush: BrushPreset,
	color: string,
	width: number,
	opacity: number,
	smoothing: number,
	options: StrokeRenderOptions = {}
): void => {
	const dpr = window.devicePixelRatio || 1;
	const rect = canvas.getBoundingClientRect();
	const measuredWidth = Math.round(rect.width);
	const measuredHeight = Math.round(rect.height);
	const cachedCssWidth = Number(canvas.dataset.previewCssWidth ?? "0");
	const cachedCssHeight = Number(canvas.dataset.previewCssHeight ?? "0");
	const attrWidth = Number(canvas.getAttribute("width")) || canvas.width || 1;
	const attrHeight = Number(canvas.getAttribute("height")) || canvas.height || 1;
	const cssWidth = Math.max(1, measuredWidth || cachedCssWidth || attrWidth);
	const cssHeight = Math.max(1, measuredHeight || cachedCssHeight || attrHeight);
	canvas.dataset.previewCssWidth = String(cssWidth);
	canvas.dataset.previewCssHeight = String(cssHeight);
	canvas.width = Math.min(4096, Math.round(cssWidth * dpr));
	canvas.height = Math.min(2048, Math.round(cssHeight * dpr));
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return;
	}
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.scale(dpr, dpr);
	ctx.clearRect(0, 0, cssWidth, cssHeight);
	const isCoarsePointer = Boolean(window.matchMedia?.("(pointer: coarse)").matches);
	if (isCoarsePointer) {
		drawSimplePreviewStroke(ctx, cssWidth, cssHeight, color, width, opacity, true);
		return;
	}
	const points: InkDocPoint[] = [];
	const segmentCount = 44;
	for (let i = 0; i <= segmentCount; i++) {
		const t = i / segmentCount;
		const x = 8 + t * (cssWidth - 16);
		const y = cssHeight / 2 + Math.sin(t * Math.PI * 1.35) * (cssHeight * 0.22);
		points.push({ x, y, pressure: 0.2 + 0.8 * t, tiltX: 20 * t, tiltY: 10 * (1 - t) });
	}
	try {
		renderStrokeWithBrush(
			ctx,
			{
				id: `__preview__${brush.id}`,
				points,
				color,
				width,
				opacity,
				style: brush.style,
				tool: brush.tool === "highlighter" ? "highlighter" : "pen",
				brushId: brush.id,
				smoothing
			},
			brush,
			options
		);
	} catch {
		drawSimplePreviewStroke(ctx, cssWidth, cssHeight, color, width, opacity);
		return;
	}
	if (!hasVisiblePreviewPixels(ctx, cssWidth, cssHeight)) {
		ctx.clearRect(0, 0, cssWidth, cssHeight);
		drawSimplePreviewStroke(ctx, cssWidth, cssHeight, color, width, opacity);
	}
};
