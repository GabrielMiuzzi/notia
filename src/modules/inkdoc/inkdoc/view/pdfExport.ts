// @ts-nocheck
import { App, MarkdownRenderer, type TFile } from "../../engines/platform/inkdocPlatform";
import type { InkDocDocument, InkDocImageBlock, InkDocPage, InkDocPoint, InkDocStroke, InkDocTextBlock } from "../types";
import { getPageSizeMm } from "./pageSizes";
import { renderPdfPageBackground } from "./pdfPageBackground";
import { applyStrokeStyleToCanvas, applyStrokeStyleToPdf } from "./strokeStyles";

const PX_TO_MM = 25.4 / 96;

export const resolvePdfName = (fileName: string): string => {
	const trimmed = fileName.trim();
	if (!trimmed) {
		return "InkDoc.pdf";
	}
	return trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`;
};

const pxToMm = (value: number): number => value * PX_TO_MM;

const normalizeHexColor = (color: string): string => {
	if (!color) {
		return "#000000";
	}
	const trimmed = color.trim();
	if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
		return trimmed;
	}
	const rgbMatch = trimmed.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
	if (rgbMatch) {
		const values = rgbMatch.slice(1, 4).map((value) =>
			Math.max(0, Math.min(255, Number.parseInt(value, 10) || 0))
		);
		const r = values[0] ?? 0;
		const g = values[1] ?? 0;
		const b = values[2] ?? 0;
		return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
	}
	return "#000000";
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
	const normalized = normalizeHexColor(hex).replace("#", "");
	return {
		r: Number.parseInt(normalized.slice(0, 2), 16) || 0,
		g: Number.parseInt(normalized.slice(2, 4), 16) || 0,
		b: Number.parseInt(normalized.slice(4, 6), 16) || 0
	};
};

const toRgba = (hex: string, alpha: number): string => {
	const { r, g, b } = hexToRgb(hex);
	const a = Math.max(0, Math.min(1, alpha));
	return `rgba(${r}, ${g}, ${b}, ${a})`;
};

const parseHtmlToText = (block: InkDocTextBlock): string => {
	if (typeof block.html === "string" && block.html.length > 0) {
		const temp = document.createElement("div");
		temp.innerHTML = block.html;
		return temp.innerText || temp.textContent || block.text || "";
	}
	return block.text || "";
};

const writeInvisibleText = (pdf: any, text: string, x: number, y: number): void => {
	if (!text.trim()) {
		return;
	}
	pdf.internal.write("3 Tr");
	pdf.text(text, x, y);
	pdf.internal.write("0 Tr");
};

const renderStroke = (pdf: any, stroke: InkDocStroke): void => {
	const points = stroke.points ?? [];
	if (points.length === 0) {
		return;
	}
	pdf.setDrawColor(normalizeHexColor(stroke.color));
	pdf.setLineWidth(pxToMm(stroke.width || 1));
	applyStrokeStyleToPdf(pdf, stroke.style);
	const first = points[0];
	if (!first) {
		return;
	}
	const deltas: [number, number][] = [];
	for (let i = 1; i < points.length; i++) {
		const prev = points[i - 1];
		const current = points[i];
		if (!prev || !current) {
			continue;
		}
		deltas.push([pxToMm(current.x - prev.x), pxToMm(current.y - prev.y)]);
	}
	pdf.setLineCap?.("round");
	pdf.setLineJoin?.("round");
	pdf.lines(deltas, pxToMm(first.x), pxToMm(first.y));
};

const getStrokeBounds = (points: InkDocPoint[], width: number): {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
} => {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const point of points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	const pad = Math.max(2, width / 2 + 2);
	return {
		minX: minX - pad,
		minY: minY - pad,
		maxX: maxX + pad,
		maxY: maxY + pad
	};
};

const renderHighlighterStroke = (pdf: any, stroke: InkDocStroke): void => {
	const points = stroke.points ?? [];
	if (points.length === 0) {
		return;
	}
	const width = Math.max(1, stroke.width || 1);
	const bounds = getStrokeBounds(points, width);
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX));
	canvas.height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY));
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return;
	}
	ctx.lineWidth = width;
	ctx.lineCap = "butt";
	ctx.lineJoin = "miter";
	applyStrokeStyleToCanvas(ctx, stroke.style, width);
	const alpha = typeof stroke.opacity === "number" ? Math.max(0.05, Math.min(1, stroke.opacity)) : 0.35;
	ctx.strokeStyle = toRgba(normalizeHexColor(stroke.color), alpha);
	ctx.beginPath();
	const first = points[0];
	if (!first) {
		return;
	}
	ctx.moveTo(first.x - bounds.minX, first.y - bounds.minY);
	for (let i = 1; i < points.length; i++) {
		const point = points[i];
		if (!point) {
			continue;
		}
		ctx.lineTo(point.x - bounds.minX, point.y - bounds.minY);
	}
	ctx.stroke();
	const data = canvas.toDataURL("image/png");
	pdf.addImage(
		data,
		"PNG",
		pxToMm(bounds.minX),
		pxToMm(bounds.minY),
		pxToMm(canvas.width),
		pxToMm(canvas.height),
		undefined,
		"FAST"
	);
};

const renderTextBlock = (pdf: any, block: InkDocTextBlock): void => {
	const text = parseHtmlToText(block);
	if (!text.trim()) {
		return;
	}
	const fontSizePt = 12;
	pdf.setFont("helvetica", "normal");
	pdf.setFontSize(fontSizePt);
	const maxWidth = Math.max(10, pxToMm(block.w) - 2);
	const wrapped = pdf.splitTextToSize(text, maxWidth);
	pdf.text(wrapped, pxToMm(block.x) + 1, pxToMm(block.y) + 4.2, {
		baseline: "top",
		maxWidth
	});
};

const toLatexCanvas = async (
	app: App,
	sourcePath: string,
	block: InkDocTextBlock
): Promise<HTMLCanvasElement | null> => {
	const latex = block.latex?.trim() ?? "";
	if (!latex) {
		return null;
	}
	const html2canvas = (await import("html2canvas")).default;
	const host = document.body.createDiv({
		cls: "inkdoc-export-latex-host"
	});
	host.style.position = "fixed";
	host.style.left = "-99999px";
	host.style.top = "0";
	host.style.width = `${Math.max(80, block.w)}px`;
	host.style.minHeight = `${Math.max(28, block.h)}px`;
	host.style.padding = "6px";
	host.style.background = "transparent";
	host.style.color = block.color || "#000000";
	try {
		await MarkdownRenderer.render(app, `$$${latex}$$`, host, sourcePath, null as any);
		return await html2canvas(host, {
			backgroundColor: null,
			scale: 2,
			useCORS: true,
			logging: false
		});
	} finally {
		host.remove();
	}
};

const renderLatexBlock = async (
	pdf: any,
	app: App,
	sourcePath: string,
	block: InkDocTextBlock
): Promise<void> => {
	const latex = block.latex?.trim() ?? "";
	if (!latex) {
		return;
	}
	const canvas = await toLatexCanvas(app, sourcePath, block);
	if (canvas) {
		const data = canvas.toDataURL("image/png");
		pdf.addImage(
			data,
			"PNG",
			pxToMm(block.x),
			pxToMm(block.y),
			pxToMm(block.w),
			pxToMm(block.h),
			undefined,
			"FAST"
		);
	}
	pdf.setFont("courier", "normal");
	pdf.setFontSize(9);
	writeInvisibleText(pdf, latex, pxToMm(block.x) + 1, pxToMm(block.y) + pxToMm(block.h / 2));
};

const renderImageBlock = async (pdf: any, block: InkDocImageBlock): Promise<void> => {
	if (!block.src) {
		return;
	}
	const format = block.src.startsWith("data:image/png") ? "PNG" : "JPEG";
	pdf.addImage(
		block.src,
		format,
		pxToMm(block.x),
		pxToMm(block.y),
		pxToMm(block.w),
		pxToMm(block.h),
		undefined,
		"FAST",
		block.rotation ?? 0
	);
};

const renderPage = async (
	pdf: any,
	app: App,
	sourcePath: string,
	page: InkDocPage,
	pageWidthMm: number,
	pageHeightMm: number
): Promise<void> => {
	renderPdfPageBackground(pdf, page, pageWidthMm, pageHeightMm);

	for (const stroke of page.strokes ?? []) {
		if (stroke.tool === "highlighter") {
			renderHighlighterStroke(pdf, stroke);
			continue;
		}
		renderStroke(pdf, stroke);
	}
	for (const image of page.images ?? []) {
		await renderImageBlock(pdf, image);
	}
	for (const block of page.textBlocks ?? []) {
		if (block.type === "latex") {
			await renderLatexBlock(pdf, app, sourcePath, block);
			continue;
		}
		renderTextBlock(pdf, block);
	}
};

const buildInkDocPdf = async (
	app: App,
	doc: InkDocDocument,
	sourceFile: TFile | null
): Promise<any> => {
	const { jsPDF } = await import("jspdf");
	const { widthMm, heightMm } = getPageSizeMm(doc.page.size);
	const orientation = widthMm > heightMm ? "landscape" : "portrait";
	const pdf = new jsPDF({
		orientation,
		unit: "mm",
		format: [widthMm, heightMm],
		compress: true
	});
	const sourcePath = sourceFile?.path ?? "";
	for (const [index, page] of doc.pages.entries()) {
		if (index > 0) {
			pdf.addPage([widthMm, heightMm], orientation);
		}
		await renderPage(pdf, app, sourcePath, page, widthMm, heightMm);
	}
	return pdf;
};

export const exportInkDocToPdfBytes = async (
	app: App,
	doc: InkDocDocument,
	sourceFile: TFile | null
): Promise<Uint8Array> => {
	const pdf = await buildInkDocPdf(app, doc, sourceFile);
	const data = pdf.output("arraybuffer") as ArrayBuffer;
	return new Uint8Array(data);
};
