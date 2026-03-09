// @ts-nocheck
import type { InkDocPageSize } from "../types";

export const DEFAULT_PAGE_SIZE: InkDocPageSize = "A4";

export const PAGE_SIZE_OPTIONS: ReadonlyArray<{
	id: InkDocPageSize;
	label: string;
	widthMm: number;
	heightMm: number;
}> = [
	{ id: "A0", label: "A0", widthMm: 841, heightMm: 1189 },
	{ id: "A1", label: "A1", widthMm: 594, heightMm: 841 },
	{ id: "A2", label: "A2", widthMm: 420, heightMm: 594 },
	{ id: "A3", label: "A3", widthMm: 297, heightMm: 420 },
	{ id: "Legal", label: "Legal", widthMm: 215.9, heightMm: 355.6 },
	{ id: "Oficio", label: "Oficio", widthMm: 216, heightMm: 340 },
	{ id: "A4", label: "A4", widthMm: 210, heightMm: 297 },
	{ id: "Letter", label: "Letter", widthMm: 215.9, heightMm: 279.4 },
	{ id: "A5", label: "A5", widthMm: 148, heightMm: 210 },
];

export const isInkDocPageSize = (value: unknown): value is InkDocPageSize => {
	if (typeof value !== "string") {
		return false;
	}
	return PAGE_SIZE_OPTIONS.some((option) => option.id === value);
};

export const resolvePageSize = (value?: InkDocPageSize | null): InkDocPageSize => {
	if (value && isInkDocPageSize(value)) {
		return value;
	}
	return DEFAULT_PAGE_SIZE;
};

export const getPageSizeMm = (
	size?: InkDocPageSize | null
): { widthMm: number; heightMm: number } => {
	const resolved = resolvePageSize(size);
	const option = PAGE_SIZE_OPTIONS.find((entry) => entry.id === resolved);
	if (!option) {
		return { widthMm: 210, heightMm: 297 };
	}
	return { widthMm: option.widthMm, heightMm: option.heightMm };
};
