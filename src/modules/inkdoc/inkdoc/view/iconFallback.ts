// @ts-nocheck
import { setInkDocIcon } from "./iconEngine";
import { INKDOC_ICONS, type InkDocIconName } from "./icons";

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

const LEGACY_LUCIDE_ICON: Record<LegacyIconName, InkDocIconName> = {
	pen: INKDOC_ICONS.PENCIL,
	highlighter: INKDOC_ICONS.HIGHLIGHTER,
	eraser: INKDOC_ICONS.ERASER,
	hand: INKDOC_ICONS.HAND,
	latex: INKDOC_ICONS.SIGMA,
	select: INKDOC_ICONS.MOUSE_POINTER_2,
	image: INKDOC_ICONS.IMAGE,
	sticky: INKDOC_ICONS.STICKY_NOTE,
	menu: INKDOC_ICONS.MENU,
	drawerDown: INKDOC_ICONS.CHEVRON_DOWN,
	drawerUp: INKDOC_ICONS.CHEVRON_UP,
	delete: INKDOC_ICONS.TRASH,
	settings: INKDOC_ICONS.SETTINGS,
	palette: INKDOC_ICONS.PALETTE,
	size: INKDOC_ICONS.STRETCH_VERTICAL,
	add: INKDOC_ICONS.PLUS,
	rotate: INKDOC_ICONS.ROTATE_CW,
	mirror: INKDOC_ICONS.FLIP_HORIZONTAL
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
