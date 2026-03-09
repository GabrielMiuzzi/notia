// @ts-nocheck
import type {
	InkDocDocument,
	InkDocImageBlock,
	InkDocPage,
	InkDocPoint,
	InkDocTextBlock
} from "../types";
import type { InkDocTool } from "./constants";
import {
	INKDOC_DEFAULT_LATEX_COLOR,
	INKDOC_IMAGE_MIN_HEIGHT,
	INKDOC_IMAGE_MIN_WIDTH,
	INKDOC_TEXT_HANDLE_SIZE,
	INKDOC_TEXT_MIN_HEIGHT,
	INKDOC_TEXT_MIN_WIDTH,
	INKDOC_TEXT_RESIZE_HANDLE_SIZE,
	createTextBlockId
} from "./constants";

const resolvePage = (
	docData: InkDocDocument | null,
	page: InkDocPage,
	index: number
): InkDocPage | null => {
	if (!docData) {
		return page;
	}
	return docData.pages.find((entry) => entry.id === page.id) ?? docData.pages[index] ?? null;
};

export const ensureTextBlocks = (
	docData: InkDocDocument | null,
	page: InkDocPage,
	index: number
): InkDocTextBlock[] => {
	const target = resolvePage(docData, page, index);
	if (!target) {
		page.textBlocks = page.textBlocks ?? [];
		return page.textBlocks;
	}
	if (!target.textBlocks) {
		target.textBlocks = [];
	}
	page.textBlocks = target.textBlocks;
	return target.textBlocks;
};

export const ensureImageBlocks = (
	docData: InkDocDocument | null,
	page: InkDocPage,
	index: number
): InkDocImageBlock[] => {
	const target = resolvePage(docData, page, index);
	if (!target) {
		page.images = page.images ?? [];
		return page.images;
	}
	if (!target.images) {
		target.images = [];
	}
	page.images = target.images;
	return target.images;
};

export const getBlockType = (block: InkDocTextBlock): "text" | "latex" => {
	return block.type === "latex" ? "latex" : "text";
};

export const isBlockCompatibleWithTool = (block: InkDocTextBlock, tool: InkDocTool): boolean => {
	const type = getBlockType(block);
	if (tool === "latex") {
		return type === "latex";
	}
	if (tool === "text") {
		return type === "text";
	}
	return true;
};

export const getTextBlockById = (
	docData: InkDocDocument | null,
	page: InkDocPage,
	index: number,
	blockId: string
): InkDocTextBlock | null => {
	const blocks = ensureTextBlocks(docData, page, index);
	return blocks.find((block) => block.id === blockId) ?? null;
};

export const findTextBlockHit = (
	docData: InkDocDocument | null,
	page: InkDocPage,
	index: number,
	point: InkDocPoint
): InkDocTextBlock | null => {
	const blocks = ensureTextBlocks(docData, page, index);
	for (let i = blocks.length - 1; i >= 0; i--) {
		const block = blocks[i];
		if (!block) {
			continue;
		}
		const w = Math.max(INKDOC_TEXT_MIN_WIDTH, block.w);
		const h = Math.max(INKDOC_TEXT_MIN_HEIGHT, block.h);
		if (point.x >= block.x && point.x <= block.x + w && point.y >= block.y && point.y <= block.y + h) {
			return block;
		}
	}
	return null;
};

export const findImageBlockHit = (
	docData: InkDocDocument | null,
	page: InkDocPage,
	index: number,
	point: InkDocPoint
): InkDocImageBlock | null => {
	const blocks = ensureImageBlocks(docData, page, index);
	for (let i = blocks.length - 1; i >= 0; i--) {
		const block = blocks[i];
		if (!block) {
			continue;
		}
		const w = Math.max(INKDOC_IMAGE_MIN_WIDTH, block.w);
		const h = Math.max(INKDOC_IMAGE_MIN_HEIGHT, block.h);
		if (point.x >= block.x && point.x <= block.x + w && point.y >= block.y && point.y <= block.y + h) {
			return block;
		}
	}
	return null;
};

export const findTextBlockHandleHit = (
	docData: InkDocDocument | null,
	page: InkDocPage,
	index: number,
	point: InkDocPoint
): InkDocTextBlock | null => {
	const blocks = ensureTextBlocks(docData, page, index);
	for (let i = blocks.length - 1; i >= 0; i--) {
		const block = blocks[i];
		if (!block) {
			continue;
		}
		const handleLeft = block.x + 2;
		const handleTop = block.y + 2;
		const handleRight = handleLeft + INKDOC_TEXT_HANDLE_SIZE;
		const handleBottom = handleTop + INKDOC_TEXT_HANDLE_SIZE;
		if (
			point.x >= handleLeft &&
			point.x <= handleRight &&
			point.y >= handleTop &&
			point.y <= handleBottom
		) {
			return block;
		}
	}
	return null;
};

export const findTextBlockResizeHit = (
	docData: InkDocDocument | null,
	page: InkDocPage,
	index: number,
	point: InkDocPoint
): InkDocTextBlock | null => {
	const blocks = ensureTextBlocks(docData, page, index);
	for (let i = blocks.length - 1; i >= 0; i--) {
		const block = blocks[i];
		if (!block) {
			continue;
		}
		const w = Math.max(INKDOC_TEXT_MIN_WIDTH, block.w);
		const h = Math.max(INKDOC_TEXT_MIN_HEIGHT, block.h);
		const handleLeft = block.x + w - INKDOC_TEXT_RESIZE_HANDLE_SIZE - 2;
		const handleTop = block.y + h - INKDOC_TEXT_RESIZE_HANDLE_SIZE - 2;
		const handleRight = handleLeft + INKDOC_TEXT_RESIZE_HANDLE_SIZE;
		const handleBottom = handleTop + INKDOC_TEXT_RESIZE_HANDLE_SIZE;
		if (
			point.x >= handleLeft &&
			point.x <= handleRight &&
			point.y >= handleTop &&
			point.y <= handleBottom
		) {
			return block;
		}
	}
	return null;
};

export const addTextBlock = (
	docData: InkDocDocument | null,
	page: InkDocPage,
	index: number,
	point: InkDocPoint
): InkDocTextBlock => {
	const blocks = ensureTextBlocks(docData, page, index);
	const block: InkDocTextBlock = {
		id: createTextBlockId(),
		x: point.x,
		y: point.y,
		w: 180,
		h: 40,
		text: "",
		html: "",
		type: "text"
	};
	blocks.push(block);
	page.textBlocks = blocks;
	return block;
};

export const addLatexBlock = (
	docData: InkDocDocument | null,
	page: InkDocPage,
	index: number,
	point: InkDocPoint
): InkDocTextBlock => {
	const blocks = ensureTextBlocks(docData, page, index);
	const block: InkDocTextBlock = {
		id: createTextBlockId(),
		x: point.x,
		y: point.y,
		w: 180,
		h: 40,
		text: "",
		html: "",
		type: "latex",
		latex: "",
		color: INKDOC_DEFAULT_LATEX_COLOR
	};
	blocks.push(block);
	page.textBlocks = blocks;
	return block;
};
