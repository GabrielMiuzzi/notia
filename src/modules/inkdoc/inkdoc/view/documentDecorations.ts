// @ts-nocheck
import type {
	InkDocDocument,
	InkDocDocumentDecorationContent,
	InkDocDocumentDecorationRegion,
	InkDocDocumentDecorations,
	InkDocImageBlock,
	InkDocPageSize,
	InkDocTextBlock
} from "../types";
import {
	INKDOC_IMAGE_MIN_HEIGHT,
	INKDOC_IMAGE_MIN_WIDTH,
	INKDOC_TEXT_MIN_HEIGHT,
	INKDOC_TEXT_MIN_WIDTH
} from "./constants";
import { getPageSizeMm } from "./pageSizes";

export const INKDOC_DOCUMENT_DECORATION_DEFAULT_HEIGHT_PERCENT = 6;
export const INKDOC_DOCUMENT_DECORATION_MIN_HEIGHT_PERCENT = 2;
export const INKDOC_DOCUMENT_DECORATION_MAX_HEIGHT_PERCENT = 18;

const mmToPx = (mm: number): number => Math.max(1, Math.round((mm * 96) / 25.4));

const normalizeTextBlock = (block: Partial<InkDocTextBlock>, fallbackId: string): InkDocTextBlock => ({
	id: typeof block.id === "string" ? block.id : fallbackId,
	x: typeof block.x === "number" ? block.x : 0,
	y: typeof block.y === "number" ? block.y : 0,
	w: Math.max(INKDOC_TEXT_MIN_WIDTH, typeof block.w === "number" ? block.w : 180),
	h: Math.max(INKDOC_TEXT_MIN_HEIGHT, typeof block.h === "number" ? block.h : 40),
	text: typeof block.text === "string" ? block.text : "",
	html:
		typeof block.html === "string" && block.html.trim().length > 0
			? block.html
			: undefined,
	type: block.type === "latex" ? "latex" : "text",
	latex: typeof block.latex === "string" ? block.latex : "",
	color: typeof block.color === "string" && block.color.trim().length > 0 ? block.color : undefined
});

const normalizeImageBlock = (block: Partial<InkDocImageBlock>, fallbackId: string): InkDocImageBlock => ({
	id: typeof block.id === "string" ? block.id : fallbackId,
	x: typeof block.x === "number" ? block.x : 0,
	y: typeof block.y === "number" ? block.y : 0,
	w: Math.max(INKDOC_IMAGE_MIN_WIDTH, typeof block.w === "number" ? block.w : 200),
	h: Math.max(INKDOC_IMAGE_MIN_HEIGHT, typeof block.h === "number" ? block.h : 150),
	src: typeof block.src === "string" ? block.src : "",
	rotation: typeof block.rotation === "number" ? block.rotation : 0,
	skewX: typeof block.skewX === "number" ? block.skewX : 0,
	skewY: typeof block.skewY === "number" ? block.skewY : 0,
	flipX: block.flipX === true
});

const normalizeTextBlockInPlace = (
	block: Partial<InkDocTextBlock> | null | undefined,
	fallbackId: string
): InkDocTextBlock => {
	const normalized = normalizeTextBlock(block ?? {}, fallbackId);
	const target = (block ?? {}) as InkDocTextBlock;
	target.id = normalized.id;
	target.x = normalized.x;
	target.y = normalized.y;
	target.w = normalized.w;
	target.h = normalized.h;
	target.text = normalized.text;
	target.html = normalized.html;
	target.type = normalized.type;
	target.latex = normalized.latex;
	target.color = normalized.color;
	return target;
};

const normalizeImageBlockInPlace = (
	block: Partial<InkDocImageBlock> | null | undefined,
	fallbackId: string
): InkDocImageBlock => {
	const normalized = normalizeImageBlock(block ?? {}, fallbackId);
	const target = (block ?? {}) as InkDocImageBlock;
	target.id = normalized.id;
	target.x = normalized.x;
	target.y = normalized.y;
	target.w = normalized.w;
	target.h = normalized.h;
	target.src = normalized.src;
	target.rotation = normalized.rotation;
	target.skewX = normalized.skewX;
	target.skewY = normalized.skewY;
	target.flipX = normalized.flipX;
	return target;
};

const normalizeDecorationContent = (
	content: Partial<InkDocDocumentDecorationContent> | null | undefined,
	region: InkDocDocumentDecorationRegion
): InkDocDocumentDecorationContent => {
	const textBlocks = Array.isArray(content?.textBlocks)
		? content.textBlocks.map((block, index) =>
				normalizeTextBlock(block ?? {}, `${region}_t_${index + 1}`)
			)
		: [];
	const images = Array.isArray(content?.images)
		? content.images.map((image, index) =>
				normalizeImageBlock(image ?? {}, `${region}_i_${index + 1}`)
			)
		: [];
	return { textBlocks, images };
};

export const resolveInkDocDecorations = (
	value?: Partial<InkDocDocumentDecorations> | null
): InkDocDocumentDecorations => ({
	headerEnabled: value?.headerEnabled === true,
	footerEnabled: value?.footerEnabled === true,
	firstPageWithoutDecorations: value?.firstPageWithoutDecorations === true,
	headerHeightPercent: resolveDecorationHeightPercent(value?.headerHeightPercent),
	footerHeightPercent: resolveDecorationHeightPercent(value?.footerHeightPercent),
	header: normalizeDecorationContent(value?.header, "header"),
	footer: normalizeDecorationContent(value?.footer, "footer")
});

const ensureDecorationContentInPlace = (
	content: Partial<InkDocDocumentDecorationContent> | null | undefined,
	region: InkDocDocumentDecorationRegion
): InkDocDocumentDecorationContent => {
	const resolvedContent = (content ?? {}) as InkDocDocumentDecorationContent;
	const nextTextBlocks = Array.isArray(resolvedContent.textBlocks) ? resolvedContent.textBlocks : [];
	const nextImages = Array.isArray(resolvedContent.images) ? resolvedContent.images : [];
	resolvedContent.textBlocks = nextTextBlocks;
	resolvedContent.images = nextImages;
	for (let index = 0; index < nextTextBlocks.length; index += 1) {
		nextTextBlocks[index] = normalizeTextBlockInPlace(nextTextBlocks[index] ?? {}, `${region}_t_${index + 1}`);
	}
	for (let index = 0; index < nextImages.length; index += 1) {
		nextImages[index] = normalizeImageBlockInPlace(nextImages[index] ?? {}, `${region}_i_${index + 1}`);
	}
	return resolvedContent;
};

export const ensureInkDocDecorations = (doc: InkDocDocument): InkDocDocumentDecorations => {
	const decorations = (doc.decorations ?? {}) as InkDocDocumentDecorations;
	decorations.headerEnabled = decorations.headerEnabled === true;
	decorations.footerEnabled = decorations.footerEnabled === true;
	decorations.firstPageWithoutDecorations = decorations.firstPageWithoutDecorations === true;
	decorations.headerHeightPercent = resolveDecorationHeightPercent(decorations.headerHeightPercent);
	decorations.footerHeightPercent = resolveDecorationHeightPercent(decorations.footerHeightPercent);
	decorations.header = ensureDecorationContentInPlace(decorations.header, "header");
	decorations.footer = ensureDecorationContentInPlace(decorations.footer, "footer");
	doc.decorations = decorations;
	return decorations;
};

export const resolveDecorationHeightPercent = (value: unknown): number => {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return INKDOC_DOCUMENT_DECORATION_DEFAULT_HEIGHT_PERCENT;
	}
	return Math.max(
		INKDOC_DOCUMENT_DECORATION_MIN_HEIGHT_PERCENT,
		Math.min(INKDOC_DOCUMENT_DECORATION_MAX_HEIGHT_PERCENT, Number(value))
	);
};

export const getDocumentDecorationHeightPercent = (
	doc: InkDocDocument | null,
	region: InkDocDocumentDecorationRegion
): number => {
	const decorations = doc ? ensureInkDocDecorations(doc) : null;
	const rawValue = region === "header" ? decorations?.headerHeightPercent : decorations?.footerHeightPercent;
	return resolveDecorationHeightPercent(rawValue);
};

export const getDocumentDecorationBandHeightMm = (
	doc: InkDocDocument | null,
	region: InkDocDocumentDecorationRegion,
	pageSize: InkDocPageSize | undefined
): number => {
	const { heightMm } = getPageSizeMm(pageSize);
	return heightMm * (getDocumentDecorationHeightPercent(doc, region) / 100);
};

export const getDocumentDecorationBandHeightPx = (
	doc: InkDocDocument | null,
	region: InkDocDocumentDecorationRegion,
	pageSize: InkDocPageSize | undefined
): number => mmToPx(getDocumentDecorationBandHeightMm(doc, region, pageSize));

export const getDocumentDecorationBounds = (
	region: InkDocDocumentDecorationRegion,
	pageSize: InkDocPageSize | undefined,
	doc?: InkDocDocument | null
): { top: number; bottom: number; height: number } => {
	const { heightMm } = getPageSizeMm(pageSize);
	const pageHeightPx = mmToPx(heightMm);
	const height = getDocumentDecorationBandHeightPx(doc ?? null, region, pageSize);
	if (region === "header") {
		return { top: 0, bottom: height, height };
	}
	return {
		top: Math.max(0, pageHeightPx - height),
		bottom: pageHeightPx,
		height
	};
};

export const getDocumentBodyBounds = (
	doc: InkDocDocument | null,
	pageIndex = 0
): { top: number; bottom: number; height: number } => {
	const { heightMm } = getPageSizeMm(doc?.page.size);
	const pageHeightPx = mmToPx(heightMm);
	const headerVisible = isDecorationVisibleOnPage(doc, "header", pageIndex);
	const footerVisible = isDecorationVisibleOnPage(doc, "footer", pageIndex);
	const top = headerVisible ? getDocumentDecorationBounds("header", doc?.page.size, doc).bottom : 0;
	const bottom = footerVisible ? getDocumentDecorationBounds("footer", doc?.page.size, doc).top : pageHeightPx;
	return {
		top,
		bottom,
		height: Math.max(0, bottom - top)
	};
};

export const isDecorationVisibleOnPage = (
	doc: InkDocDocument | null,
	region: InkDocDocumentDecorationRegion,
	pageIndex: number
): boolean => {
	if (!doc) {
		return false;
	}
	const decorations = ensureInkDocDecorations(doc);
	const isEnabled = region === "header" ? decorations.headerEnabled : decorations.footerEnabled;
	if (!isEnabled) {
		return false;
	}
	return !(pageIndex === 0 && decorations.firstPageWithoutDecorations);
};

export const shiftFooterDecorationContent = (
	doc: InkDocDocument,
	previousPageSize: InkDocPageSize | undefined,
	nextPageSize: InkDocPageSize | undefined
): void => {
	const decorations = ensureInkDocDecorations(doc);
	const previousBounds = getDocumentDecorationBounds("footer", previousPageSize, doc);
	const nextBounds = getDocumentDecorationBounds("footer", nextPageSize, doc);
	const delta = nextBounds.top - previousBounds.top;
	if (delta === 0) {
		return;
	}
	for (const block of decorations.footer?.textBlocks ?? []) {
		block.y += delta;
	}
	for (const image of decorations.footer?.images ?? []) {
		image.y += delta;
	}
};
