// @ts-nocheck
export type InkMathStrokePoint = {
	x: number;
	y: number;
	pressure?: number;
	time?: number;
};

export type InkMathStroke = {
	mode: "draw" | "erase";
	points: InkMathStrokePoint[];
};

type RenderStrokeOptions = {
	drawColor: string;
	eraseColor?: string;
	lineWidth: number;
	eraserSize: number;
	useDestinationOutForErase?: boolean;
};

type StrokeBounds = {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
};

const OCR_BBOX_PADDING_PX = 48;
const OCR_EXPORT_SCALE = 2;
const OCR_BINARIZATION_THRESHOLD = 200;

const drawDot = (ctx: CanvasRenderingContext2D, point: InkMathStrokePoint, radius: number): void => {
	ctx.beginPath();
	ctx.arc(point.x, point.y, Math.max(0.2, radius), 0, Math.PI * 2);
	ctx.fill();
};

const drawPolyline = (
	ctx: CanvasRenderingContext2D,
	points: InkMathStrokePoint[],
	lineWidth: number,
	color: string
): void => {
	if (points.length === 0) {
		return;
	}
	if (points.length === 1) {
		const firstPoint = points[0];
		if (!firstPoint) {
			return;
		}
		ctx.fillStyle = color;
		drawDot(ctx, firstPoint, lineWidth * 0.5);
		return;
	}
	ctx.beginPath();
	ctx.moveTo(points[0]?.x ?? 0, points[0]?.y ?? 0);
	for (let index = 1; index < points.length; index += 1) {
		const point = points[index];
		if (!point) {
			continue;
		}
		ctx.lineTo(point.x, point.y);
	}
	ctx.strokeStyle = color;
	ctx.lineWidth = lineWidth;
	ctx.stroke();
};

const erasePolyline = (
	ctx: CanvasRenderingContext2D,
	points: InkMathStrokePoint[],
	eraserSize: number,
	useDestinationOutForErase: boolean,
	eraseColor: string
): void => {
	if (points.length === 0) {
		return;
	}
	const applyEraseDot = (point: InkMathStrokePoint): void => {
		ctx.beginPath();
		ctx.arc(point.x, point.y, eraserSize * 0.5, 0, Math.PI * 2);
		ctx.fill();
	};
	if (useDestinationOutForErase) {
		ctx.save();
		ctx.globalCompositeOperation = "destination-out";
		ctx.fillStyle = "#000000";
		for (const point of points) {
			applyEraseDot(point);
		}
		ctx.restore();
		return;
	}
	ctx.fillStyle = eraseColor;
	for (const point of points) {
		applyEraseDot(point);
	}
};

export const renderStrokesToContext = (
	ctx: CanvasRenderingContext2D,
	strokes: InkMathStroke[],
	options: RenderStrokeOptions
): void => {
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	for (const stroke of strokes) {
		if (!stroke.points.length) {
			continue;
		}
		if (stroke.mode === "draw") {
			drawPolyline(ctx, stroke.points, options.lineWidth, options.drawColor);
		} else {
			erasePolyline(
				ctx,
				stroke.points,
				options.eraserSize,
				options.useDestinationOutForErase === true,
				options.eraseColor ?? "#ffffff"
			);
		}
	}
};

const getStrokeBounds = (strokes: InkMathStroke[]): StrokeBounds | null => {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const stroke of strokes) {
		for (const point of stroke.points) {
			if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
				continue;
			}
			minX = Math.min(minX, point.x);
			minY = Math.min(minY, point.y);
			maxX = Math.max(maxX, point.x);
			maxY = Math.max(maxY, point.y);
		}
	}
	if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
		return null;
	}
	return { minX, minY, maxX, maxY };
};

export const createRecognitionImageBase64 = (
	strokes: InkMathStroke[],
	width: number,
	height: number,
	lineWidth: number,
	eraserSize: number
): string | null => {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || strokes.length === 0) {
		return null;
	}
	const bounds = getStrokeBounds(strokes);
	if (!bounds) {
		return null;
	}
	const brushMargin = Math.max(lineWidth, eraserSize) * 0.5;
	const minX = Math.max(0, bounds.minX - brushMargin);
	const minY = Math.max(0, bounds.minY - brushMargin);
	const maxX = Math.min(width, bounds.maxX + brushMargin);
	const maxY = Math.min(height, bounds.maxY + brushMargin);
	const cropWidth = Math.max(1, Math.ceil(maxX - minX));
	const cropHeight = Math.max(1, Math.ceil(maxY - minY));

	// Rebuild OCR image around ink bbox only, with fixed white margin.
	const baseWidth = cropWidth + OCR_BBOX_PADDING_PX * 2;
	const baseHeight = cropHeight + OCR_BBOX_PADDING_PX * 2;
	const baseCanvas = document.createElement("canvas");
	baseCanvas.width = Math.max(1, baseWidth);
	baseCanvas.height = Math.max(1, baseHeight);
	const baseCtx = baseCanvas.getContext("2d");
	if (!baseCtx) {
		return null;
	}
	baseCtx.fillStyle = "#ffffff";
	baseCtx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);

	const translatedStrokes: InkMathStroke[] = strokes.map((stroke) => ({
		mode: stroke.mode,
		points: stroke.points.map((point) => ({
			x: point.x - minX + OCR_BBOX_PADDING_PX,
			y: point.y - minY + OCR_BBOX_PADDING_PX,
			pressure: point.pressure,
			time: point.time
		}))
	}));

	renderStrokesToContext(baseCtx, translatedStrokes, {
		drawColor: "#000000",
		eraseColor: "#ffffff",
		lineWidth,
		eraserSize,
		useDestinationOutForErase: false
	});

	const scaledCanvas = document.createElement("canvas");
	scaledCanvas.width = Math.max(1, Math.round(baseCanvas.width * OCR_EXPORT_SCALE));
	scaledCanvas.height = Math.max(1, Math.round(baseCanvas.height * OCR_EXPORT_SCALE));
	const scaledCtx = scaledCanvas.getContext("2d");
	if (!scaledCtx) {
		return null;
	}
	scaledCtx.fillStyle = "#ffffff";
	scaledCtx.fillRect(0, 0, scaledCanvas.width, scaledCanvas.height);
	scaledCtx.imageSmoothingEnabled = true;
	scaledCtx.drawImage(baseCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
	const imageData = scaledCtx.getImageData(0, 0, scaledCanvas.width, scaledCanvas.height);
	const data = imageData.data;
	for (let index = 0; index < data.length; index += 4) {
		const r = data[index] ?? 255;
		const g = data[index + 1] ?? 255;
		const b = data[index + 2] ?? 255;
		const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
		const value = luminance >= OCR_BINARIZATION_THRESHOLD ? 255 : 0;
		data[index] = value;
		data[index + 1] = value;
		data[index + 2] = value;
		data[index + 3] = 255;
	}
	scaledCtx.putImageData(imageData, 0, 0);
	return scaledCanvas.toDataURL("image/png");
};
