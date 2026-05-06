// @ts-nocheck
import { App, type TFile } from "../../engines/platform/inkdocPlatform";
import type { InkDocDocument, InkDocImageBlock, InkDocLatexStyle, InkDocPage, InkDocPoint, InkDocStroke, InkDocTextBlock } from "../types";
import { getPageSizeMm } from "./pageSizes";
import { renderPdfPageBackground } from "./pdfPageBackground";
import { applyStrokeStyleToPdf } from "./strokeStyles";
import { ensureInkDocDecorations, isDecorationVisibleOnPage } from "./documentDecorations";
import { renderLatexSegments } from "./latexRenderer";

const PX_TO_MM = 25.4 / 96;
const INKDOC_DEFAULT_LATEX_STYLE: Required<InkDocLatexStyle> = {
	fontSize: 16,
	letterSpacing: 0,
	lineHeight: 1.2,
	textAlign: "left" as const,
	paddingTop: 0,
	paddingBottom: 0,
	paddingLeft: 0,
	paddingRight: 0
};

export type PdfExportProgress = {
	currentPage: number;
	totalPages: number;
	phase: "rendering" | "assembling";
};

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

const STRIP_HTML_PATTERN = /<[^>]*>/g;

const parseHtmlToText = (block: InkDocTextBlock): string => {
	if (typeof block.html === "string" && block.html.length > 0) {
		return block.html.replace(STRIP_HTML_PATTERN, " ").replace(/\s+/g, " ").trim() || block.text || "";
	}
	return block.text || "";
};

const resolveLatexBlockColor = (block: InkDocTextBlock): string => {
	if (typeof block.color === "string" && block.color.trim().length > 0) {
		return normalizeHexColor(block.color);
	}
	return "#000000";
};

const resolveLatexStyle = (block: InkDocTextBlock): Required<InkDocLatexStyle> => {
	const s = block.latexStyle;
	return {
		fontSize: typeof s?.fontSize === "number" && Number.isFinite(s.fontSize) ? Math.max(10, s.fontSize) : INKDOC_DEFAULT_LATEX_STYLE.fontSize,
		letterSpacing: typeof s?.letterSpacing === "number" && Number.isFinite(s.letterSpacing) ? s.letterSpacing : INKDOC_DEFAULT_LATEX_STYLE.letterSpacing,
		lineHeight: typeof s?.lineHeight === "number" && Number.isFinite(s.lineHeight) ? Math.max(0.6, s.lineHeight) : INKDOC_DEFAULT_LATEX_STYLE.lineHeight,
		textAlign: (s?.textAlign === "center" || s?.textAlign === "right" || s?.textAlign === "left") ? s.textAlign : INKDOC_DEFAULT_LATEX_STYLE.textAlign,
		paddingTop: typeof s?.paddingTop === "number" && Number.isFinite(s.paddingTop) ? Math.max(0, s.paddingTop) : INKDOC_DEFAULT_LATEX_STYLE.paddingTop,
		paddingBottom: typeof s?.paddingBottom === "number" && Number.isFinite(s.paddingBottom) ? Math.max(0, s.paddingBottom) : INKDOC_DEFAULT_LATEX_STYLE.paddingBottom,
		paddingLeft: typeof s?.paddingLeft === "number" && Number.isFinite(s.paddingLeft) ? Math.max(0, s.paddingLeft) : INKDOC_DEFAULT_LATEX_STYLE.paddingLeft,
		paddingRight: typeof s?.paddingRight === "number" && Number.isFinite(s.paddingRight) ? Math.max(0, s.paddingRight) : INKDOC_DEFAULT_LATEX_STYLE.paddingRight
	};
};

const writeInvisibleText = (pdf: any, text: string, x: number, y: number, fontSizePt: number, maxWidthMm: number): void => {
	if (!text.trim()) {
		return;
	}
	pdf.internal.write("3 Tr");
	pdf.setFontSize(fontSizePt);
	pdf.text(text, x, y, {
		baseline: "top",
		maxWidth: maxWidthMm
	});
	pdf.internal.write("0 Tr");
};

const renderStrokeVector = (pdf: any, stroke: InkDocStroke): void => {
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

const renderHighlighterStroke = (pdf: any, stroke: InkDocStroke): void => {
	const points = stroke.points ?? [];
	if (points.length === 0) {
		return;
	}
	const alpha = typeof stroke.opacity === "number" ? Math.max(0.05, Math.min(1, stroke.opacity)) : 0.35;
	const { r, g, b } = hexToRgb(normalizeHexColor(stroke.color));
	try {
		pdf.setGState(new pdf.GState({ opacity: alpha, strokeOpacity: alpha }));
	} catch {
		// fallback: render without transparency
	}
	pdf.setDrawColor(r, g, b);
	pdf.setLineWidth(pxToMm(stroke.width || 1));
	applyStrokeStyleToPdf(pdf, stroke.style);
	const first = points[0];
	if (!first) {
		restorePdfOpacity(pdf);
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
	restorePdfOpacity(pdf);
};

const restorePdfOpacity = (pdf: any): void => {
	try {
		pdf.setGState(new pdf.GState({ opacity: 1, strokeOpacity: 1 }));
	} catch {
		// ignore
	}
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

const applyLatexStyleToWrapper = (wrapper: HTMLDivElement, block: InkDocTextBlock): void => {
	const style = resolveLatexStyle(block);
	const color = resolveLatexBlockColor(block);
	const justifyContent = style.textAlign === "right" ? "flex-end" : style.textAlign === "center" ? "center" : "flex-start";
	const alignItems = style.textAlign === "right" ? "flex-end" : style.textAlign === "center" ? "center" : "flex-start";
	wrapper.style.display = "flex";
	wrapper.style.flexDirection = "column";
	wrapper.style.justifyContent = justifyContent;
	wrapper.style.alignItems = alignItems;
	wrapper.style.width = `${Math.max(80, block.w)}px`;
	wrapper.style.minHeight = `${Math.max(28, block.h)}px`;
	wrapper.style.fontSize = `${style.fontSize}px`;
	wrapper.style.letterSpacing = `${style.letterSpacing}px`;
	wrapper.style.lineHeight = String(style.lineHeight);
	wrapper.style.textAlign = style.textAlign;
	wrapper.style.paddingTop = `${style.paddingTop}px`;
	wrapper.style.paddingBottom = `${style.paddingBottom}px`;
	wrapper.style.paddingLeft = `${style.paddingLeft}px`;
	wrapper.style.paddingRight = `${style.paddingRight}px`;
	wrapper.style.color = color;
	wrapper.style.background = "transparent";
	wrapper.style.boxSizing = "border-box";
	wrapper.style.overflow = "visible";
};

const getPageSizePx = (pageSize: string): { widthPx: number; heightPx: number } => {
	const { widthMm, heightMm } = getPageSizeMm(pageSize);
	const MM_TO_PX = 96 / 25.4;
	return {
		widthPx: Math.ceil(widthMm * MM_TO_PX),
		heightPx: Math.ceil(heightMm * MM_TO_PX)
	};
};

const renderPageLatexBatch = async (
	blocks: InkDocTextBlock[],
	html2canvas: any
): Promise<Array<{ block: InkDocTextBlock; dataUrl: string | null; measuredHeightPx: number }>> => {
	if (blocks.length === 0) {
		return [];
	}

	const results: Array<{ block: InkDocTextBlock; dataUrl: string | null; measuredHeightPx: number }> = [];

	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		const latex = block.latex?.trim() ?? "";
		if (!latex) {
			continue;
		}

		const host = document.body.createDiv({ cls: "inkdoc-export-latex-host" });
		host.style.position = "fixed";
		host.style.left = "-99999px";
		host.style.top = "0";
		// Allow natural height - use minHeight instead of fixed height, no overflow hidden
		const style = resolveLatexStyle(block);
		const color = resolveLatexBlockColor(block);
		const justifyContent = style.textAlign === "right" ? "flex-end" : style.textAlign === "center" ? "center" : "flex-start";
		const alignItems = style.textAlign === "right" ? "flex-end" : style.textAlign === "center" ? "center" : "flex-start";
		host.style.display = "flex";
		host.style.flexDirection = "column";
		host.style.justifyContent = justifyContent;
		host.style.alignItems = alignItems;
		host.style.width = `${Math.max(80, block.w)}px`;
		host.style.minHeight = `${Math.max(28, block.h)}px`;
		host.style.height = "auto";
		host.style.fontSize = `${style.fontSize}px`;
		host.style.letterSpacing = `${style.letterSpacing}px`;
		host.style.lineHeight = String(style.lineHeight);
		host.style.textAlign = style.textAlign;
		host.style.paddingTop = `${style.paddingTop}px`;
		host.style.paddingBottom = `${style.paddingBottom}px`;
		host.style.paddingLeft = `${style.paddingLeft}px`;
		host.style.paddingRight = `${style.paddingRight}px`;
		host.style.color = color;
		host.style.background = "transparent";
		host.style.boxSizing = "border-box";
		host.style.overflow = "visible";

		try {
			await renderLatexSegments(host, latex);

			const canvasResult = await html2canvas(host, {
				backgroundColor: null,
				scale: 2,
				useCORS: true,
				logging: false
			});

			// Measure actual rendered height
			const measuredHeightPx = Math.max(block.h, host.scrollHeight, canvasResult.height / 2);

			results.push({
				block,
				dataUrl: canvasResult.toDataURL("image/png"),
				measuredHeightPx
			});

			canvasResult.width = 0;
			canvasResult.height = 0;
		} catch {
			results.push({ block, dataUrl: null, measuredHeightPx: block.h });
		} finally {
			host.remove();
		}

		if (i % 2 === 1) {
			await yieldToMainThread();
		}
	}

	return results;
};

const renderImageBlock = (pdf: any, block: InkDocImageBlock): void => {
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

const yieldToMainThread = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));

const countLatexBlocks = (doc: InkDocDocument): number => {
	let count = 0;
	for (const page of doc.pages) {
		for (const block of page.textBlocks ?? []) {
			if (block.type === "latex" && block.latex?.trim()) {
				count++;
			}
		}
		if (doc.decorations) {
			for (const region of ["header", "footer"] as const) {
				const content = doc.decorations[region];
				if (content) {
					for (const block of content.textBlocks ?? []) {
						if (block.type === "latex" && block.latex?.trim()) {
							count++;
						}
					}
				}
			}
		}
	}
	return count;
};

const renderPage = async (
	pdf: any,
	app: App,
	sourcePath: string,
	doc: InkDocDocument,
	page: InkDocPage,
	pageIndex: number,
	pageWidthMm: number,
	pageHeightMm: number,
	html2canvas: any | null
): Promise<void> => {
	renderPdfPageBackground(pdf, page, pageWidthMm, pageHeightMm);
	const decorations = ensureInkDocDecorations(doc);
	const effectiveImages: InkDocImageBlock[] = [];
	const effectiveTextBlocks: InkDocTextBlock[] = [];
	if (isDecorationVisibleOnPage(doc, "header", pageIndex)) {
		effectiveImages.push(...(decorations.header.images ?? []));
		effectiveTextBlocks.push(...(decorations.header.textBlocks ?? []));
	}
	effectiveImages.push(...(page.images ?? []));
	effectiveTextBlocks.push(...(page.textBlocks ?? []));
	if (isDecorationVisibleOnPage(doc, "footer", pageIndex)) {
		effectiveImages.push(...(decorations.footer.images ?? []));
		effectiveTextBlocks.push(...(decorations.footer.textBlocks ?? []));
	}

	for (const stroke of page.strokes ?? []) {
		if (stroke.tool === "highlighter") {
			renderHighlighterStroke(pdf, stroke);
		} else {
			renderStrokeVector(pdf, stroke);
		}
	}

	for (const image of effectiveImages) {
		renderImageBlock(pdf, image);
	}

	const latexBlocks: InkDocTextBlock[] = [];
	const textBlocks: InkDocTextBlock[] = [];
	for (const block of effectiveTextBlocks) {
		if (block.type === "latex" && block.latex?.trim()) {
			latexBlocks.push(block);
		} else {
			textBlocks.push(block);
		}
	}

	for (const block of textBlocks) {
		renderTextBlock(pdf, block);
	}

	if (latexBlocks.length > 0 && html2canvas) {
		const results = await renderPageLatexBatch(latexBlocks, html2canvas);
		// Sort by vertical position to process in order and avoid overlap issues
		const sortedResults = [...results].sort((a, b) => a.block.y - b.block.y);
		for (const { block, dataUrl, measuredHeightPx } of sortedResults) {
			if (dataUrl) {
				// Use measured height instead of block.h to avoid clipping
				pdf.addImage(
					dataUrl,
					"PNG",
					pxToMm(block.x),
					pxToMm(block.y),
					pxToMm(block.w),
					pxToMm(measuredHeightPx),
					undefined,
					"FAST"
				);
			}
			const latex = block.latex?.trim() ?? "";
			if (latex) {
				const style = resolveLatexStyle(block);
				const fontSizePt = Math.max(6, Math.round(style.fontSize * 0.75));
				pdf.setFont("courier", "normal");
				writeInvisibleText(pdf, latex, pxToMm(block.x) + 1, pxToMm(block.y) + 1, fontSizePt, pxToMm(block.w) - 2);
			}
		}
	} else if (latexBlocks.length > 0) {
		for (const block of latexBlocks) {
			const latex = block.latex?.trim() ?? "";
			if (latex) {
				const style = resolveLatexStyle(block);
				const fontSizePt = Math.max(6, Math.round(style.fontSize * 0.75));
				pdf.setFont("courier", "normal");
				writeInvisibleText(pdf, latex, pxToMm(block.x) + 1, pxToMm(block.y) + 1, fontSizePt, pxToMm(block.w) - 2);
			}
		}
	}
};

const buildInkDocPdf = async (
	app: App,
	doc: InkDocDocument,
	sourceFile: TFile | null,
	onProgress?: (progress: PdfExportProgress) => void
): Promise<any> => {
	const { jsPDF } = await import("jspdf");
	const hasLatex = countLatexBlocks(doc) > 0;
	let html2canvas: any = null;
	if (hasLatex) {
		const html2canvasModule = await import("html2canvas");
		html2canvas = html2canvasModule.default;
	}
	const { widthMm, heightMm } = getPageSizeMm(doc.page.size);
	const orientation = widthMm > heightMm ? "landscape" : "portrait";
	const pdf = new jsPDF({
		orientation,
		unit: "mm",
		format: [widthMm, heightMm],
		compress: true
	});
	if (typeof pdf.GState === "function") {
		try {
			pdf.setGState(new pdf.GState({ opacity: 1, strokeOpacity: 1 }));
		} catch {
			// ignore
		}
	}
	const sourcePath = sourceFile?.path ?? "";
	const totalPages = doc.pages.length;
	for (const [index, page] of doc.pages.entries()) {
		onProgress?.({ currentPage: index + 1, totalPages, phase: "rendering" });
		if (index > 0) {
			pdf.addPage([widthMm, heightMm], orientation);
		}
		await renderPage(pdf, app, sourcePath, doc, page, index, widthMm, heightMm, html2canvas);
		await yieldToMainThread();
	}
	onProgress?.({ currentPage: totalPages, totalPages, phase: "assembling" });
	return pdf;
};

export const exportInkDocToPdfBytes = async (
	app: App,
	doc: InkDocDocument,
	sourceFile: TFile | null,
	onProgress?: (progress: PdfExportProgress) => void
): Promise<Uint8Array> => {
	const pdf = await buildInkDocPdf(app, doc, sourceFile, onProgress);
	const data = pdf.output("arraybuffer") as ArrayBuffer;
	return new Uint8Array(data);
};