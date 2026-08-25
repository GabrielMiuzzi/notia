export type InkMathPoint = {
	x: number;
	y: number;
	pressure?: number;
	tiltX?: number;
	tiltY?: number;
};

export type InkMathStrokeStyle =
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

export type InkMathStrokeTool = "pen" | "highlighter";

export type InkMathBrushId =
	| "monoline"
	| "pencil-graphite"
	| "textured_pencil"
	| "soft-brush"
	| "airbrush_soft"
	| "ink-brush"
	| "marker"
	| "highlighter"
	| "eraser";

export type InkMathStroke = {
	id: string;
	points: InkMathPoint[];
	color: string;
	width: number;
	opacity?: number;
	style: InkMathStrokeStyle;
	tool?: InkMathStrokeTool;
	brushId?: string;
	smoothing?: number;
	stabilizer?: number;
};
