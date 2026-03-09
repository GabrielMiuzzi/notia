// @ts-nocheck
import type { InkDocPoint } from "../types";

export const VIEW_TYPE_INKDOC = "inkdoc-view";

export const INKDOC_STROKE_COLOR = "#ff2d2d";
export const INKDOC_STROKE_WIDTH = 2;
export const INKDOC_TEXT_HANDLE_SIZE = 16;
export const INKDOC_TEXT_RESIZE_HANDLE_SIZE = 14;
export const INKDOC_TEXT_MIN_WIDTH = 80;
export const INKDOC_TEXT_MIN_HEIGHT = 28;
export const INKDOC_TEXT_TOOLBAR_ID = "inkdoc-text-toolbar";
export const INKDOC_LATEX_TOOLBAR_ID = "inkdoc-latex-toolbar";
export const INKDOC_DEFAULT_LATEX_COLOR = "#000000";
export const INKDOC_LATEX_PALETTE = [
	"#000000",
	"#3b3b3b",
	"#ff2d2d",
	"#ff7a00",
	"#ffd400",
	"#2ecc71",
	"#2aa9ff",
	"#6c5ce7",
	"#1abc9c",
	"#00cec9",
	"#fd79a8",
	"#ffffff"
] as const;
export const INKDOC_IMAGE_MIN_WIDTH = 80;
export const INKDOC_IMAGE_MIN_HEIGHT = 60;
export const INKDOC_IMAGE_HANDLE_SIZE = 12;
export const INKDOC_STICKY_NOTE_MIN_WIDTH = 120;
export const INKDOC_STICKY_NOTE_MIN_HEIGHT = 90;
export const INKDOC_STICKY_NOTE_DEFAULT_WIDTH = 180;
export const INKDOC_STICKY_NOTE_DEFAULT_HEIGHT = 140;

export const createStrokeId = () =>
	`s_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
export const createTextBlockId = () =>
	`t_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
export const createImageBlockId = () =>
	`i_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
export const createStickyNoteId = () =>
	`n_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

export type InkDocViewState = {
	file?: string;
};

export type InkDocTool =
	| "pen"
	| "highlighter"
	| "eraser"
	| "select"
	| "text"
	| "latex"
	| "hand"
	| "image"
	| "sticky";

export type CanvasPageState = {
	pageEl: HTMLDivElement;
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	previewCanvas: HTMLCanvasElement;
	previewCtx: CanvasRenderingContext2D;
	isDrawing: boolean;
	currentStrokeId: string | null;
	selection: {
		isSelecting: boolean;
		isDragging: boolean;
		start: InkDocPoint | null;
		current: InkDocPoint | null;
		lastDragPoint: InkDocPoint | null;
	};
	text: {
		isDragging: boolean;
		draggingId: string | null;
		dragOffset: InkDocPoint | null;
		isResizing: boolean;
		resizingId: string | null;
		resizeStartPoint: InkDocPoint | null;
		resizeStartSize: { w: number; h: number } | null;
	};
	image: {
		isDragging: boolean;
		draggingId: string | null;
		dragOffset: InkDocPoint | null;
		isResizing: boolean;
		resizingId: string | null;
		resizeStartPoint: InkDocPoint | null;
		resizeStartSize: { w: number; h: number } | null;
		isRotating: boolean;
		rotatingId: string | null;
		rotateStartAngle: number | null;
		rotateBase: number | null;
		isSkewing: boolean;
		skewingId: string | null;
		skewStartPoint: InkDocPoint | null;
		skewStart: { x: number; y: number } | null;
	};
};
