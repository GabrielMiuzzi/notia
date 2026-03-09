// @ts-nocheck
import type { InkDocPage } from "../types";
import { resolvePageBackground, resolvePageColors } from "./backgrounds";

const PX_TO_MM = 25.4 / 96;

type PdfLike = {
	setFillColor: (r: number, g: number, b: number) => void;
	rect: (x: number, y: number, w: number, h: number, style: string) => void;
	setDrawColor: (r: number, g: number, b: number) => void;
	setLineWidth: (width: number) => void;
	line: (x1: number, y1: number, x2: number, y2: number) => void;
	circle?: (x: number, y: number, radius: number, style?: string) => void;
};

const pxToMm = (value: number): number => value * PX_TO_MM;

const parseColor = (color: string): { r: number; g: number; b: number } => {
	if (!color) {
		return { r: 0, g: 0, b: 0 };
	}
	const trimmed = color.trim();
	const hexMatch = trimmed.match(/^#([0-9a-f]{6})$/i);
	if (hexMatch) {
		const raw = hexMatch[1] ?? "000000";
		return {
			r: Number.parseInt(raw.slice(0, 2), 16) || 0,
			g: Number.parseInt(raw.slice(2, 4), 16) || 0,
			b: Number.parseInt(raw.slice(4, 6), 16) || 0
		};
	}
	const rgbMatch = trimmed.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
	if (rgbMatch) {
		return {
			r: Math.max(0, Math.min(255, Number.parseInt(rgbMatch[1] || "0", 10))),
			g: Math.max(0, Math.min(255, Number.parseInt(rgbMatch[2] || "0", 10))),
			b: Math.max(0, Math.min(255, Number.parseInt(rgbMatch[3] || "0", 10)))
		};
	}
	return { r: 0, g: 0, b: 0 };
};

const fillPage = (
	pdf: PdfLike,
	widthMm: number,
	heightMm: number,
	color: { r: number; g: number; b: number }
): void => {
	pdf.setFillColor(color.r, color.g, color.b);
	pdf.rect(0, 0, widthMm, heightMm, "F");
};

const drawHorizontalLines = (
	pdf: PdfLike,
	widthMm: number,
	heightMm: number,
	stepPx: number,
	offsetPx: number = 0
): void => {
	const stepMm = pxToMm(stepPx);
	const offsetMm = pxToMm(offsetPx);
	for (let y = offsetMm; y <= heightMm + 0.0001; y += stepMm) {
		pdf.line(0, y, widthMm, y);
	}
};

const drawVerticalLines = (
	pdf: PdfLike,
	widthMm: number,
	heightMm: number,
	stepPx: number
): void => {
	const stepMm = pxToMm(stepPx);
	for (let x = 0; x <= widthMm + 0.0001; x += stepMm) {
		pdf.line(x, 0, x, heightMm);
	}
};

const drawDotted = (pdf: PdfLike, widthMm: number, heightMm: number): void => {
	const stepMm = pxToMm(16);
	const radiusMm = pxToMm(0.75);
	if (!pdf.circle) {
		drawVerticalLines(pdf, widthMm, heightMm, 16);
		return;
	}
	for (let y = 0; y <= heightMm + 0.0001; y += stepMm) {
		for (let x = 0; x <= widthMm + 0.0001; x += stepMm) {
			pdf.circle(x, y, radiusMm, "F");
		}
	}
};

const drawMarginLine = (
	pdf: PdfLike,
	heightMm: number,
	widthMm: number,
	centerPx: number,
	fromRight: boolean = false
): void => {
	const xMm = fromRight ? widthMm - pxToMm(centerPx) : pxToMm(centerPx);
	pdf.line(xMm, 0, xMm, heightMm);
};

const drawCornellGuides = (pdf: PdfLike, widthMm: number, heightMm: number): void => {
	drawMarginLine(pdf, heightMm, widthMm, 90.5);
	const topGuideMm = pxToMm(80.5);
	const bottomGuideMm = heightMm - pxToMm(79.5);
	pdf.line(0, topGuideMm, widthMm, topGuideMm);
	pdf.line(0, bottomGuideMm, widthMm, bottomGuideMm);
};

const drawMusicLines = (pdf: PdfLike, widthMm: number, heightMm: number): void => {
	const groupStepMm = pxToMm(68);
	const offsetsMm = [0, 10, 20, 30, 40].map(pxToMm);
	const baseOffsetMm = pxToMm(18);
	for (let base = baseOffsetMm; base <= heightMm + 0.0001; base += groupStepMm) {
		for (const offset of offsetsMm) {
			const y = base + offset;
			if (y > heightMm + 0.0001) {
				continue;
			}
			pdf.line(0, y, widthMm, y);
		}
	}
};

export const renderPdfPageBackground = (
	pdf: PdfLike,
	page: InkDocPage,
	widthMm: number,
	heightMm: number
): void => {
	const background = resolvePageBackground(page.background);
	const colors = resolvePageColors(page.colors);
	const bg = parseColor(colors.background);
	const line = parseColor(colors.line);
	const margin = parseColor(colors.margin);
	const normalLineWidth = pxToMm(1);

	fillPage(pdf, widthMm, heightMm, bg);

	if (background === "plain") {
		return;
	}

	pdf.setDrawColor(line.r, line.g, line.b);
	pdf.setFillColor(line.r, line.g, line.b);
	pdf.setLineWidth(normalLineWidth);

	if (background === "dotted") {
		drawDotted(pdf, widthMm, heightMm);
		return;
	}
	if (background === "grid") {
		drawVerticalLines(pdf, widthMm, heightMm, 20);
		drawHorizontalLines(pdf, widthMm, heightMm, 20);
		return;
	}
	if (background === "ruled") {
		drawHorizontalLines(pdf, widthMm, heightMm, 24);
		return;
	}
	if (background === "music") {
		drawMusicLines(pdf, widthMm, heightMm);
		return;
	}
	if (background === "millimeter") {
		drawVerticalLines(pdf, widthMm, heightMm, 8);
		drawHorizontalLines(pdf, widthMm, heightMm, 8);
		pdf.setDrawColor(margin.r, margin.g, margin.b);
		drawVerticalLines(pdf, widthMm, heightMm, 40);
		drawHorizontalLines(pdf, widthMm, heightMm, 40);
		return;
	}

	drawHorizontalLines(pdf, widthMm, heightMm, 24);
	pdf.setDrawColor(margin.r, margin.g, margin.b);
	if (background === "ruled-right") {
		drawMarginLine(pdf, heightMm, widthMm, 47.5, true);
		return;
	}
	if (background === "ruled-left") {
		drawMarginLine(pdf, heightMm, widthMm, 48.5);
		return;
	}
	if (background === "ruled-legal") {
		drawMarginLine(pdf, heightMm, widthMm, 80.5);
		return;
	}
	if (background === "cornell") {
		drawCornellGuides(pdf, widthMm, heightMm);
	}
};
