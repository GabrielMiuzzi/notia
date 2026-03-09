// @ts-nocheck
import type { InkDocDocument, InkDocPage } from "../types";
import { DEFAULT_PAGE_MARGIN_MM } from "../types";
import {
	INKDOC_DEFAULT_LATEX_COLOR,
	INKDOC_IMAGE_MIN_HEIGHT,
	INKDOC_IMAGE_MIN_WIDTH,
	INKDOC_STICKY_NOTE_DEFAULT_HEIGHT,
	INKDOC_STICKY_NOTE_DEFAULT_WIDTH,
	INKDOC_STICKY_NOTE_MIN_HEIGHT,
	INKDOC_STICKY_NOTE_MIN_WIDTH,
	INKDOC_TEXT_MIN_HEIGHT,
	INKDOC_TEXT_MIN_WIDTH
} from "./constants";
import { resolvePageColors, isInkDocPageBackground, DEFAULT_PAGE_BACKGROUND } from "./backgrounds";
import { isInkDocPageSize, resolvePageSize } from "./pageSizes";
import { resolveInkDocStrokeStyle } from "./strokeStyles";

export const parseInkDocRaw = (raw: string): InkDocDocument => {
	const parsed = JSON.parse(raw) as Partial<InkDocDocument>;
	const pages = Array.isArray(parsed.pages)
		? parsed.pages.map((page, index) => {
				const safePage = page as InkDocPage | undefined;
				const strokes = Array.isArray(safePage?.strokes) ? safePage.strokes : [];
				const rawBlocks = Array.isArray((safePage as InkDocPage | undefined)?.textBlocks)
					? (safePage as InkDocPage).textBlocks ?? []
					: [];
				const textBlocks = rawBlocks.map((block, blockIndex) => ({
					id:
						typeof block.id === "string"
							? block.id
							: `t_${index + 1}_${blockIndex + 1}`,
					x: typeof block.x === "number" ? block.x : 0,
					y: typeof block.y === "number" ? block.y : 0,
					w: Math.max(INKDOC_TEXT_MIN_WIDTH, typeof block.w === "number" ? block.w : 180),
					h: Math.max(INKDOC_TEXT_MIN_HEIGHT, typeof block.h === "number" ? block.h : 40),
					text: typeof block.text === "string" ? block.text : "",
					html: typeof block.html === "string" ? block.html : undefined,
					type: (block.type === "latex" ? "latex" : "text") as "latex" | "text",
					latex: typeof block.latex === "string" ? block.latex : "",
					color:
						block.type === "latex"
							? typeof block.color === "string" && block.color.trim().length > 0
								? block.color
								: INKDOC_DEFAULT_LATEX_COLOR
							: undefined
				}));
				const rawImages = Array.isArray((safePage as InkDocPage | undefined)?.images)
					? (safePage as InkDocPage).images ?? []
					: [];
				const images = rawImages.map((image, imageIndex) => ({
					id:
						typeof image.id === "string"
							? image.id
							: `i_${index + 1}_${imageIndex + 1}`,
					x: typeof image.x === "number" ? image.x : 0,
					y: typeof image.y === "number" ? image.y : 0,
					w: Math.max(INKDOC_IMAGE_MIN_WIDTH, typeof image.w === "number" ? image.w : 200),
					h: Math.max(INKDOC_IMAGE_MIN_HEIGHT, typeof image.h === "number" ? image.h : 150),
					src: typeof image.src === "string" ? image.src : "",
					rotation: typeof image.rotation === "number" ? image.rotation : 0,
					skewX: typeof image.skewX === "number" ? image.skewX : 0,
					skewY: typeof image.skewY === "number" ? image.skewY : 0,
					flipX: image.flipX === true
				}));
				const background = isInkDocPageBackground(safePage?.background)
					? safePage.background
					: undefined;
				const colors = resolvePageColors(safePage?.colors);
				return {
					id: typeof safePage?.id === "string" ? safePage.id : `p${index + 1}`,
					strokes: strokes
						.filter((stroke): stroke is NonNullable<InkDocPage["strokes"]>[number] => Boolean(stroke))
						.map((stroke) => ({
							...stroke,
							points: Array.isArray(stroke.points)
								? stroke.points
										.filter((point) => Boolean(point))
										.map((point) => ({
											x: typeof point.x === "number" ? point.x : 0,
											y: typeof point.y === "number" ? point.y : 0,
											pressure:
												typeof point.pressure === "number"
													? Math.max(0, Math.min(1, point.pressure))
													: undefined,
											tiltX: typeof point.tiltX === "number" ? point.tiltX : undefined,
											tiltY: typeof point.tiltY === "number" ? point.tiltY : undefined
										}))
								: [],
							style: resolveInkDocStrokeStyle(stroke.style),
							tool: (stroke.tool === "highlighter" ? "highlighter" : "pen") as "highlighter" | "pen",
							opacity:
								typeof stroke.opacity === "number"
									? Math.max(0, Math.min(1, stroke.opacity))
									: undefined,
							brushId: typeof stroke.brushId === "string" ? stroke.brushId : undefined,
							smoothing:
								typeof stroke.smoothing === "number"
									? Math.max(0, Math.min(1, stroke.smoothing))
									: undefined,
							stabilizer:
								typeof stroke.stabilizer === "number"
									? Math.max(0, Math.min(1, stroke.stabilizer))
									: undefined
						})),
					canvas: typeof safePage?.canvas === "object" ? (safePage.canvas ?? null) : null,
					text: typeof safePage?.text === "string" ? safePage.text : undefined,
					textBlocks,
					images,
					background,
					colors
				};
			})
		: [
				{
					id: "p1",
					strokes: [],
					canvas: null,
					textBlocks: [],
					images: [],
					background: DEFAULT_PAGE_BACKGROUND,
					colors: resolvePageColors()
				}
			];
	const stickyNotes = Array.isArray(parsed.stickyNotes)
		? parsed.stickyNotes.map((note, index) => ({
				id:
					typeof note.id === "string"
						? note.id
						: `n_${index + 1}`,
				x: typeof note.x === "number" ? note.x : 0,
				y: typeof note.y === "number" ? note.y : 0,
				w: Math.max(
					INKDOC_STICKY_NOTE_MIN_WIDTH,
					typeof note.w === "number" ? note.w : INKDOC_STICKY_NOTE_DEFAULT_WIDTH
				),
				h: Math.max(
					INKDOC_STICKY_NOTE_MIN_HEIGHT,
					typeof note.h === "number" ? note.h : INKDOC_STICKY_NOTE_DEFAULT_HEIGHT
				),
				text: typeof note.text === "string" ? note.text : "",
				html: typeof note.html === "string" ? note.html : undefined,
				color:
					typeof note.color === "string" && note.color.trim().length > 0
						? note.color
						: "#ffe672",
				collapsed: note.collapsed === true,
				locked: note.locked === true,
				kind:
					note.kind === "arrow-left" ||
					note.kind === "arrow-right" ||
					note.kind === "arrow-up" ||
					note.kind === "arrow-down"
						? note.kind
						: ("normal" as const)
			}))
		: [];

	return {
		version: typeof parsed.version === "number" ? parsed.version : 1,
		title: typeof parsed.title === "string" ? parsed.title : "InkDoc sin título",
		page: {
			size: isInkDocPageSize(parsed.page?.size) ? parsed.page.size : resolvePageSize(),
			marginMm:
				typeof parsed.page?.marginMm === "number"
					? parsed.page.marginMm
					: DEFAULT_PAGE_MARGIN_MM
		},
		pages,
		stickyNotes
	};
};
