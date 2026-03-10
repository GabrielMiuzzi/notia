// @ts-nocheck
import type { InkDocTextLayoutPadding } from "../types";

const MIN_PADDING = 0;
const MAX_PADDING = 240;

export const DEFAULT_TEXT_LAYOUT_PADDING: InkDocTextLayoutPadding = {
	top: 24,
	right: 24,
	bottom: 38,
	left: 24
};

const clampPadding = (value: unknown, fallback: number): number => {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return fallback;
	}
	return Math.max(MIN_PADDING, Math.min(MAX_PADDING, Math.round(value)));
};

export const resolveInkDocTextLayoutPadding = (
	value?: Partial<InkDocTextLayoutPadding> | null
): InkDocTextLayoutPadding => {
	return {
		top: clampPadding(value?.top, DEFAULT_TEXT_LAYOUT_PADDING.top),
		right: clampPadding(value?.right, DEFAULT_TEXT_LAYOUT_PADDING.right),
		bottom: clampPadding(value?.bottom, DEFAULT_TEXT_LAYOUT_PADDING.bottom),
		left: clampPadding(value?.left, DEFAULT_TEXT_LAYOUT_PADDING.left)
	};
};
