// @ts-nocheck
export const INKDOC_A4_WIDTH_MM = 210;
export const INKDOC_A4_HEIGHT_MM = 297;
export const DEFAULT_PAGE_MARGIN_MM = 20;

export type InkDocCanvasData = Record<string, unknown>;
export type InkDocPageSize =
	| "A0"
	| "A1"
	| "A2"
	| "A3"
	| "A4"
	| "A5"
	| "Legal"
	| "Oficio"
	| "Letter";

export type InkDocPageBackground =
	| "plain"
	| "dotted"
	| "grid"
	| "ruled"
	| "ruled-right"
	| "ruled-left"
	| "ruled-legal"
	| "cornell"
	| "music"
	| "millimeter";

export type InkDocPageColors = {
	background: string;
	line: string;
	margin: string;
};

export type InkDocPage = {
	id: string;
	strokes?: InkDocStroke[];
	canvas?: InkDocCanvasData | null;
	text?: string;
	textBlocks?: InkDocTextBlock[];
	background?: InkDocPageBackground;
	colors?: InkDocPageColors;
	images?: InkDocImageBlock[];
};

export type InkDocPoint = {
	x: number;
	y: number;
	pressure?: number;
	tiltX?: number;
	tiltY?: number;
};

export type InkDocStroke = {
	id: string;
	points: InkDocPoint[];
	color: string;
	width: number;
	opacity?: number;
	style: InkDocStrokeStyle;
	tool?: InkDocStrokeTool;
	brushId?: string;
	smoothing?: number;
	stabilizer?: number;
};

export type InkDocStrokeStyle =
	| "solid"
	| "dashed"
	| "dotted"
	| "long-dash"
	| "short-dash"
	| "dash-dot"
	| "dash-double-dot"
	| "sparse-dots"
	| "dense-dots"
	| "chain"
	| "rail";
export type InkDocStrokeTool = "pen" | "highlighter";

export type InkDocBrushId =
	| "monoline"
	| "pencil-graphite"
	| "textured_pencil"
	| "soft-brush"
	| "airbrush_soft"
	| "ink-brush"
	| "marker"
	| "highlighter"
	| "eraser";

export type InkDocImageBlock = {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	src: string;
	rotation?: number;
	skewX?: number;
	skewY?: number;
	flipX?: boolean;
};

export type InkDocTextBlock = {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	text: string;
	html?: string;
	type?: "text" | "latex";
	latex?: string;
	color?: string;
};

export type InkDocStickyNote = {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	text: string;
	html?: string;
	color?: string;
	collapsed?: boolean;
	locked?: boolean;
	kind?: "normal" | "arrow-left" | "arrow-right" | "arrow-up" | "arrow-down";
};

export type InkDocDocument = {
	version: number;
	title: string;
	page: {
		size: InkDocPageSize;
		marginMm: number;
	};
	pages: InkDocPage[];
	stickyNotes?: InkDocStickyNote[];
};
