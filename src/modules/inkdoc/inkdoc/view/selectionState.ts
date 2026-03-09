// @ts-nocheck
import type { InkDocPage, InkDocPoint } from "../types";
import { getImageBlockBounds, getRectFromPoints, getStrokeBounds, getTextBlockBounds, rectIntersects } from "./geometry";

export type SelectionMaps = {
	strokes: Map<string, Set<string>>;
	textBlocks: Map<string, Set<string>>;
	images: Map<string, Set<string>>;
};

export const clearSelectionForPage = (maps: SelectionMaps, pageId: string): void => {
	maps.strokes.set(pageId, new Set());
	maps.textBlocks.set(pageId, new Set());
	maps.images.set(pageId, new Set());
};

export const updateSelectionFromRectMaps = (
	maps: SelectionMaps,
	page: InkDocPage,
	start: InkDocPoint | null,
	current: InkDocPoint
): void => {
	if (!start) {
		return;
	}
	const rect = getRectFromPoints(start, current);
	const strokeHits = new Set<string>();
	for (const stroke of page.strokes ?? []) {
		if (rectIntersects(rect, getStrokeBounds(stroke))) {
			strokeHits.add(stroke.id);
		}
	}
	maps.strokes.set(page.id, strokeHits);

	const textHits = new Set<string>();
	for (const block of page.textBlocks ?? []) {
		if (rectIntersects(rect, getTextBlockBounds(block))) {
			textHits.add(block.id);
		}
	}
	maps.textBlocks.set(page.id, textHits);

	const imageHits = new Set<string>();
	for (const block of page.images ?? []) {
		if (rectIntersects(rect, getImageBlockBounds(block))) {
			imageHits.add(block.id);
		}
	}
	maps.images.set(page.id, imageHits);
};

export const getSelectionBoundsForPage = (
	maps: SelectionMaps,
	page: InkDocPage
): { left: number; top: number; right: number; bottom: number } | null => {
	const selectedStrokes = maps.strokes.get(page.id);
	const selectedText = maps.textBlocks.get(page.id);
	const selectedImages = maps.images.get(page.id);
	const hasSelection =
		Boolean(selectedStrokes && selectedStrokes.size > 0) ||
		Boolean(selectedText && selectedText.size > 0) ||
		Boolean(selectedImages && selectedImages.size > 0);
	if (!hasSelection) {
		return null;
	}
	let bounds: { left: number; top: number; right: number; bottom: number } | null = null;
	for (const stroke of page.strokes ?? []) {
		if (!selectedStrokes?.has(stroke.id)) {
			continue;
		}
		const next = getStrokeBounds(stroke);
		if (!bounds) {
			bounds = { ...next };
			continue;
		}
		bounds.left = Math.min(bounds.left, next.left);
		bounds.top = Math.min(bounds.top, next.top);
		bounds.right = Math.max(bounds.right, next.right);
		bounds.bottom = Math.max(bounds.bottom, next.bottom);
	}
	for (const block of page.textBlocks ?? []) {
		if (!selectedText?.has(block.id)) {
			continue;
		}
		const next = getTextBlockBounds(block);
		if (!bounds) {
			bounds = { ...next };
			continue;
		}
		bounds.left = Math.min(bounds.left, next.left);
		bounds.top = Math.min(bounds.top, next.top);
		bounds.right = Math.max(bounds.right, next.right);
		bounds.bottom = Math.max(bounds.bottom, next.bottom);
	}
	for (const block of page.images ?? []) {
		if (!selectedImages?.has(block.id)) {
			continue;
		}
		const next = getImageBlockBounds(block);
		if (!bounds) {
			bounds = { ...next };
			continue;
		}
		bounds.left = Math.min(bounds.left, next.left);
		bounds.top = Math.min(bounds.top, next.top);
		bounds.right = Math.max(bounds.right, next.right);
		bounds.bottom = Math.max(bounds.bottom, next.bottom);
	}
	return bounds;
};

export const hasAnySelectionMaps = (maps: SelectionMaps): boolean => {
	for (const selected of maps.strokes.values()) {
		if (selected.size > 0) {
			return true;
		}
	}
	for (const selected of maps.textBlocks.values()) {
		if (selected.size > 0) {
			return true;
		}
	}
	for (const selected of maps.images.values()) {
		if (selected.size > 0) {
			return true;
		}
	}
	return false;
};

export const getSelectionPageIdMaps = (maps: SelectionMaps): string | null => {
	for (const [pageId, selected] of maps.strokes.entries()) {
		if (selected.size > 0) {
			return pageId;
		}
	}
	for (const [pageId, selected] of maps.textBlocks.entries()) {
		if (selected.size > 0) {
			return pageId;
		}
	}
	for (const [pageId, selected] of maps.images.entries()) {
		if (selected.size > 0) {
			return pageId;
		}
	}
	return null;
};
