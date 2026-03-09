// @ts-nocheck
import type { InkDocDocument, InkDocPage, InkDocPoint, InkDocStroke, InkDocTextBlock, InkDocImageBlock } from "../types";
import type { CanvasPageState } from "./constants";
import { getSelectionBoundsForPage, getSelectionPageIdMaps, type SelectionMaps } from "./selectionState";

type SelectionBounds = { left: number; top: number; right: number; bottom: number };

export type SelectionMovementContext = {
	docData: InkDocDocument | null;
	canvasStates: Map<string, CanvasPageState>;
	selectionMaps: SelectionMaps;
	textLayerDirty: Set<string>;
	imageLayerDirty: Set<string>;
	getCanvasSizePx: () => { widthPx: number; heightPx: number };
	getPointerPosition: (canvas: HTMLCanvasElement, event: PointerEvent) => InkDocPoint;
	renderStrokes: (ctx: CanvasRenderingContext2D, strokes: InkDocStroke[], pageId: string) => void;
	saveDebounced: () => void;
};

const resolvePageByIdOrIndex = (
	docData: InkDocDocument | null,
	page: InkDocPage,
	index: number
): InkDocPage | null => {
	if (!docData) {
		return null;
	}
	return docData.pages.find((entry) => entry.id === page.id) ?? docData.pages[index] ?? null;
};

const renderPage = (context: SelectionMovementContext, page: InkDocPage): void => {
	const state = context.canvasStates.get(page.id);
	if (!state) {
		return;
	}
	context.renderStrokes(state.ctx, page.strokes ?? [], page.id);
};

const clampDeltaToPage = (
	bounds: SelectionBounds,
	widthPx: number,
	heightPx: number
): { dx: number; dy: number } => {
	let dx = 0;
	let dy = 0;
	if (bounds.left < 0) {
		dx = -bounds.left;
	}
	if (bounds.right + dx > widthPx) {
		dx = Math.min(dx, widthPx - bounds.right);
	}
	if (bounds.top < 0) {
		dy = -bounds.top;
	}
	if (bounds.bottom + dy > heightPx) {
		dy = Math.min(dy, heightPx - bounds.bottom);
	}
	return { dx, dy };
};

const getPageAtClientPoint = (
	context: SelectionMovementContext,
	clientX: number,
	clientY: number
): { page: InkDocPage; state: CanvasPageState } | null => {
	const { docData, canvasStates } = context;
	if (!docData) {
		return null;
	}
	for (const page of docData.pages) {
		const state = canvasStates.get(page.id);
		if (!state) {
			continue;
		}
		const rect = state.canvas.getBoundingClientRect();
		if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
			return { page, state };
		}
	}
	return null;
};

const clampSelectionToPage = (
	context: SelectionMovementContext,
	page: InkDocPage,
	index: number,
	bounds: SelectionBounds
): void => {
	const { widthPx, heightPx } = context.getCanvasSizePx();
	const { dx, dy } = clampDeltaToPage(bounds, widthPx, heightPx);
	if (dx === 0 && dy === 0) {
		return;
	}
	const target = resolvePageByIdOrIndex(context.docData, page, index);
	if (!target) {
		return;
	}
	const selectedStrokes = context.selectionMaps.strokes.get(page.id) ?? new Set<string>();
	const selectedBlocks = context.selectionMaps.textBlocks.get(page.id) ?? new Set<string>();
	const selectedImages = context.selectionMaps.images.get(page.id) ?? new Set<string>();
	if (selectedStrokes.size > 0 && target.strokes) {
		target.strokes = target.strokes.map((stroke) => {
			if (!selectedStrokes.has(stroke.id)) {
				return stroke;
			}
			return {
				...stroke,
				points: stroke.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
			};
		});
		page.strokes = target.strokes;
	}
	if (selectedBlocks.size > 0 && target.textBlocks) {
		target.textBlocks = target.textBlocks.map((block) => {
			if (!selectedBlocks.has(block.id)) {
				return block;
			}
			return {
				...block,
				x: block.x + dx,
				y: block.y + dy
			};
		});
		page.textBlocks = target.textBlocks;
	}
	if (selectedImages.size > 0 && target.images) {
		target.images = target.images.map((block) => {
			if (!selectedImages.has(block.id)) {
				return block;
			}
			return {
				...block,
				x: block.x + dx,
				y: block.y + dy
			};
		});
		page.images = target.images;
	}
	context.textLayerDirty.add(page.id);
	context.imageLayerDirty.add(page.id);
	renderPage(context, page);
	context.saveDebounced();
};

export const handleSelectionStart = (
	context: SelectionMovementContext,
	page: InkDocPage,
	point: InkDocPoint
): void => {
	const state = context.canvasStates.get(page.id);
	if (!state) {
		return;
	}
	if (!context.selectionMaps.strokes.has(page.id)) {
		context.selectionMaps.strokes.set(page.id, new Set());
	}
	if (!context.selectionMaps.textBlocks.has(page.id)) {
		context.selectionMaps.textBlocks.set(page.id, new Set());
	}
	state.selection.start = point;
	state.selection.current = point;
};

export const dragSelection = (
	context: SelectionMovementContext,
	page: InkDocPage,
	index: number,
	point: InkDocPoint
): void => {
	const state = context.canvasStates.get(page.id);
	if (!state || !state.selection.lastDragPoint) {
		return;
	}
	const dx = point.x - state.selection.lastDragPoint.x;
	const dy = point.y - state.selection.lastDragPoint.y;
	if (dx === 0 && dy === 0) {
		return;
	}
	state.selection.lastDragPoint = point;
	const selected = context.selectionMaps.strokes.get(page.id);
	const selectedBlocks = context.selectionMaps.textBlocks.get(page.id);
	const selectedImages = context.selectionMaps.images.get(page.id);
	const hasStrokeSelection = Boolean(selected && selected.size > 0);
	const hasBlockSelection = Boolean(selectedBlocks && selectedBlocks.size > 0);
	const hasImageSelection = Boolean(selectedImages && selectedImages.size > 0);
	if (!hasStrokeSelection && !hasBlockSelection && !hasImageSelection) {
		return;
	}
	const target = resolvePageByIdOrIndex(context.docData, page, index);
	if (!target) {
		return;
	}
	if (target.strokes && hasStrokeSelection) {
		target.strokes = target.strokes.map((stroke) => {
			if (!selected?.has(stroke.id)) {
				return stroke;
			}
			return {
				...stroke,
				points: stroke.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
			};
		});
		page.strokes = target.strokes;
	}
	if (target.textBlocks && hasBlockSelection) {
		target.textBlocks = target.textBlocks.map((block) => {
			if (!selectedBlocks?.has(block.id)) {
				return block;
			}
			return {
				...block,
				x: block.x + dx,
				y: block.y + dy
			};
		});
		page.textBlocks = target.textBlocks;
	}
	if (target.images && hasImageSelection) {
		target.images = target.images.map((block) => {
			if (!selectedImages?.has(block.id)) {
				return block;
			}
			return {
				...block,
				x: block.x + dx,
				y: block.y + dy
			};
		});
		page.images = target.images;
	}
	context.saveDebounced();
};

export const dropSelectionOnPage = (
	context: SelectionMovementContext,
	page: InkDocPage,
	index: number,
	event: PointerEvent
): void => {
	if (!context.docData) {
		return;
	}
	const sourceState = context.canvasStates.get(page.id);
	if (!sourceState || !sourceState.selection.lastDragPoint) {
		return;
	}
	const bounds = getSelectionBoundsForPage(context.selectionMaps, page);
	if (!bounds) {
		return;
	}
	const drop = getPageAtClientPoint(context, event.clientX, event.clientY);
	if (!drop || drop.page.id === page.id) {
		if (!drop) {
			clampSelectionToPage(context, page, index, bounds);
		}
		return;
	}
	const sourcePage = resolvePageByIdOrIndex(context.docData, page, index);
	const targetPage = context.docData.pages.find((entry) => entry.id === drop.page.id) ?? drop.page;
	if (!sourcePage || !targetPage) {
		return;
	}
	const sourcePoint = sourceState.selection.lastDragPoint;
	const targetPoint = context.getPointerPosition(drop.state.canvas, event);
	const dx = targetPoint.x - sourcePoint.x;
	const dy = targetPoint.y - sourcePoint.y;
	const selectedStrokes = context.selectionMaps.strokes.get(page.id) ?? new Set<string>();
	const selectedBlocks = context.selectionMaps.textBlocks.get(page.id) ?? new Set<string>();
	const selectedImages = context.selectionMaps.images.get(page.id) ?? new Set<string>();
	if (selectedStrokes.size === 0 && selectedBlocks.size === 0 && selectedImages.size === 0) {
		return;
	}
	const movedStrokeIds = new Set<string>();
	const movedBlockIds = new Set<string>();
	const movedImageIds = new Set<string>();
	if (sourcePage.strokes && sourcePage.strokes.length > 0) {
		const remaining: InkDocStroke[] = [];
		for (const stroke of sourcePage.strokes) {
			if (!selectedStrokes.has(stroke.id)) {
				remaining.push(stroke);
				continue;
			}
			movedStrokeIds.add(stroke.id);
			const moved: InkDocStroke = {
				...stroke,
				points: stroke.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
			};
			if (!targetPage.strokes) {
				targetPage.strokes = [];
			}
			targetPage.strokes.push(moved);
		}
		sourcePage.strokes = remaining;
		page.strokes = sourcePage.strokes;
	}
	if (sourcePage.textBlocks && sourcePage.textBlocks.length > 0) {
		const remainingBlocks: InkDocTextBlock[] = [];
		for (const block of sourcePage.textBlocks) {
			if (!selectedBlocks.has(block.id)) {
				remainingBlocks.push(block);
				continue;
			}
			movedBlockIds.add(block.id);
			const moved: InkDocTextBlock = {
				...block,
				x: block.x + dx,
				y: block.y + dy
			};
			if (!targetPage.textBlocks) {
				targetPage.textBlocks = [];
			}
			targetPage.textBlocks.push(moved);
		}
		sourcePage.textBlocks = remainingBlocks;
		page.textBlocks = sourcePage.textBlocks;
	}
	if (sourcePage.images && sourcePage.images.length > 0) {
		const remainingImages: InkDocImageBlock[] = [];
		for (const block of sourcePage.images) {
			if (!selectedImages.has(block.id)) {
				remainingImages.push(block);
				continue;
			}
			movedImageIds.add(block.id);
			const moved: InkDocImageBlock = {
				...block,
				x: block.x + dx,
				y: block.y + dy
			};
			if (!targetPage.images) {
				targetPage.images = [];
			}
			targetPage.images.push(moved);
		}
		sourcePage.images = remainingImages;
		page.images = sourcePage.images;
	}
	const { widthPx, heightPx } = context.getCanvasSizePx();
	const nextBounds = {
		left: bounds.left + dx,
		top: bounds.top + dy,
		right: bounds.right + dx,
		bottom: bounds.bottom + dy
	};
	const clampDx = clampDeltaToPage(nextBounds, widthPx, heightPx).dx;
	const clampDy = clampDeltaToPage(nextBounds, widthPx, heightPx).dy;
	if (clampDx !== 0 || clampDy !== 0) {
		if (movedStrokeIds.size > 0 && targetPage.strokes) {
			targetPage.strokes = targetPage.strokes.map((stroke) => {
				if (!movedStrokeIds.has(stroke.id)) {
					return stroke;
				}
				return {
					...stroke,
					points: stroke.points.map((p) => ({ x: p.x + clampDx, y: p.y + clampDy }))
				};
			});
		}
		if (movedBlockIds.size > 0 && targetPage.textBlocks) {
			targetPage.textBlocks = targetPage.textBlocks.map((block) => {
				if (!movedBlockIds.has(block.id)) {
					return block;
				}
				return {
					...block,
					x: block.x + clampDx,
					y: block.y + clampDy
				};
			});
		}
		if (movedImageIds.size > 0 && targetPage.images) {
			targetPage.images = targetPage.images.map((block) => {
				if (!movedImageIds.has(block.id)) {
					return block;
				}
				return {
					...block,
					x: block.x + clampDx,
					y: block.y + clampDy
				};
			});
		}
	}
	context.selectionMaps.strokes.set(page.id, new Set());
	context.selectionMaps.textBlocks.set(page.id, new Set());
	context.selectionMaps.images.set(page.id, new Set());
	context.selectionMaps.strokes.set(drop.page.id, movedStrokeIds);
	context.selectionMaps.textBlocks.set(drop.page.id, movedBlockIds);
	context.selectionMaps.images.set(drop.page.id, movedImageIds);
	context.textLayerDirty.add(page.id);
	context.textLayerDirty.add(drop.page.id);
	context.imageLayerDirty.add(page.id);
	context.imageLayerDirty.add(drop.page.id);
	renderPage(context, page);
	renderPage(context, targetPage);
	context.saveDebounced();
};

export const moveSelectionToPoint = (
	context: SelectionMovementContext,
	page: InkDocPage,
	index: number,
	point: InkDocPoint
): void => {
	if (!context.docData) {
		return;
	}
	const sourcePageId = getSelectionPageIdMaps(context.selectionMaps);
	if (!sourcePageId) {
		return;
	}
	const sourcePageIndex = context.docData.pages.findIndex((entry) => entry.id === sourcePageId);
	const sourcePage =
		context.docData.pages.find((entry) => entry.id === sourcePageId) ??
		context.docData.pages[sourcePageIndex];
	const targetPage = context.docData.pages.find((entry) => entry.id === page.id) ?? context.docData.pages[index];
	if (!sourcePage || !targetPage) {
		return;
	}
	const bounds = getSelectionBoundsForPage(context.selectionMaps, sourcePage);
	if (!bounds) {
		return;
	}
	let dx = point.x - bounds.left;
	let dy = point.y - bounds.top;
	const { widthPx, heightPx } = context.getCanvasSizePx();
	const nextBounds = {
		left: bounds.left + dx,
		top: bounds.top + dy,
		right: bounds.right + dx,
		bottom: bounds.bottom + dy
	};
	const clamp = clampDeltaToPage(nextBounds, widthPx, heightPx);
	dx += clamp.dx;
	dy += clamp.dy;
	const selectedStrokes = context.selectionMaps.strokes.get(sourcePageId) ?? new Set<string>();
	const selectedBlocks = context.selectionMaps.textBlocks.get(sourcePageId) ?? new Set<string>();
	const selectedImages = context.selectionMaps.images.get(sourcePageId) ?? new Set<string>();
	if (selectedStrokes.size === 0 && selectedBlocks.size === 0 && selectedImages.size === 0) {
		return;
	}
	if (sourcePageId === targetPage.id) {
		if (sourcePage.strokes && selectedStrokes.size > 0) {
			sourcePage.strokes = sourcePage.strokes.map((stroke) => {
				if (!selectedStrokes.has(stroke.id)) {
					return stroke;
				}
				return {
					...stroke,
					points: stroke.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
				};
			});
		}
		if (sourcePage.textBlocks && selectedBlocks.size > 0) {
			sourcePage.textBlocks = sourcePage.textBlocks.map((block) => {
				if (!selectedBlocks.has(block.id)) {
					return block;
				}
				return {
					...block,
					x: block.x + dx,
					y: block.y + dy
				};
			});
		}
		if (sourcePage.images && selectedImages.size > 0) {
			sourcePage.images = sourcePage.images.map((block) => {
				if (!selectedImages.has(block.id)) {
					return block;
				}
				return {
					...block,
					x: block.x + dx,
					y: block.y + dy
				};
			});
		}
		context.textLayerDirty.add(sourcePage.id);
		context.imageLayerDirty.add(sourcePage.id);
		renderPage(context, sourcePage);
		context.saveDebounced();
		return;
	}
	const movedStrokeIds = new Set<string>();
	const movedBlockIds = new Set<string>();
	const movedImageIds = new Set<string>();
	if (sourcePage.strokes && selectedStrokes.size > 0) {
		const remaining: InkDocStroke[] = [];
		for (const stroke of sourcePage.strokes) {
			if (!selectedStrokes.has(stroke.id)) {
				remaining.push(stroke);
				continue;
			}
			movedStrokeIds.add(stroke.id);
			const moved: InkDocStroke = {
				...stroke,
				points: stroke.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
			};
			if (!targetPage.strokes) {
				targetPage.strokes = [];
			}
			targetPage.strokes.push(moved);
		}
		sourcePage.strokes = remaining;
	}
	if (sourcePage.textBlocks && selectedBlocks.size > 0) {
		const remainingBlocks: InkDocTextBlock[] = [];
		for (const block of sourcePage.textBlocks) {
			if (!selectedBlocks.has(block.id)) {
				remainingBlocks.push(block);
				continue;
			}
			movedBlockIds.add(block.id);
			const moved: InkDocTextBlock = {
				...block,
				x: block.x + dx,
				y: block.y + dy
			};
			if (!targetPage.textBlocks) {
				targetPage.textBlocks = [];
			}
			targetPage.textBlocks.push(moved);
		}
		sourcePage.textBlocks = remainingBlocks;
	}
	if (sourcePage.images && selectedImages.size > 0) {
		const remainingImages: InkDocImageBlock[] = [];
		for (const block of sourcePage.images) {
			if (!selectedImages.has(block.id)) {
				remainingImages.push(block);
				continue;
			}
			movedImageIds.add(block.id);
			const moved: InkDocImageBlock = {
				...block,
				x: block.x + dx,
				y: block.y + dy
			};
			if (!targetPage.images) {
				targetPage.images = [];
			}
			targetPage.images.push(moved);
		}
		sourcePage.images = remainingImages;
	}
	context.selectionMaps.strokes.set(sourcePage.id, new Set());
	context.selectionMaps.textBlocks.set(sourcePage.id, new Set());
	context.selectionMaps.images.set(sourcePage.id, new Set());
	context.selectionMaps.strokes.set(targetPage.id, movedStrokeIds);
	context.selectionMaps.textBlocks.set(targetPage.id, movedBlockIds);
	context.selectionMaps.images.set(targetPage.id, movedImageIds);
	context.textLayerDirty.add(sourcePage.id);
	context.textLayerDirty.add(targetPage.id);
	context.imageLayerDirty.add(sourcePage.id);
	context.imageLayerDirty.add(targetPage.id);
	renderPage(context, sourcePage);
	renderPage(context, targetPage);
	context.saveDebounced();
};
