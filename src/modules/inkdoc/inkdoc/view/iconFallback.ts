// @ts-nocheck
import { setInkDocIcon } from "./iconEngine";

export type LegacyIconName =
	| "pen"
	| "highlighter"
	| "eraser"
	| "hand"
	| "latex"
	| "select"
	| "image"
	| "sticky"
	| "menu"
	| "drawerDown"
	| "drawerUp"
	| "delete"
	| "settings"
	| "palette"
	| "size"
	| "add"
	| "rotate"
	| "mirror";

const LEGACY_LUCIDE_ICON: Record<LegacyIconName, string> = {
	pen: "pencil",
	highlighter: "highlighter",
	eraser: "eraser",
	hand: "hand",
	latex: "sigma",
	select: "mouse-pointer-2",
	image: "image",
	sticky: "sticky-note",
	menu: "menu",
	drawerDown: "chevron-down",
	drawerUp: "chevron-up",
	delete: "trash",
	settings: "settings",
	palette: "palette",
	size: "stretch-vertical",
	add: "plus",
	rotate: "rotate-cw",
	mirror: "flip-horizontal"
};

const LEGACY_TEXT_FALLBACK: Record<LegacyIconName, string> = {
	pen: "P",
	highlighter: "H",
	eraser: "E",
	hand: "H",
	latex: "Σ",
	select: "S",
	image: "I",
	sticky: "N",
	menu: "☰",
	drawerDown: "▾",
	drawerUp: "▴",
	delete: "D",
	settings: "S",
	palette: "P",
	size: "R",
	add: "+",
	rotate: "R",
	mirror: "M"
};

export const setCompatibleIcon = (element: HTMLElement, name: string, textFallback = "?"): void => {
	setInkDocIcon(element, name, textFallback);
};

export const setLegacyIcon = (element: HTMLElement, name: LegacyIconName): void => {
	setInkDocIcon(element, LEGACY_LUCIDE_ICON[name], LEGACY_TEXT_FALLBACK[name]);
};
