// @ts-nocheck
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { icons as lucideIcons, type LucideIcon } from "lucide-react";
import { getIcon, getIconIds } from "../../engines/platform/inkdocPlatform";

type MenuItemLike = {
	setIcon: (icon: string) => unknown;
};

const ICON_ALIASES: Record<string, string> = {
	"highlight-glyph": "highlighter",
	"up-and-down-arrows": "move-vertical",
	"hashtag": "sigma",
	"select-all-text": "text-select",
	"image-file": "image",
	documents: "sticky-note",
	"three-horizontal-bars": "menu",
	"down-chevron-glyph": "chevron-down",
	"up-chevron-glyph": "chevron-up",
	gear: "settings",
	"expand-vertically": "stretch-vertical",
	"plus-with-circle": "plus",
	reset: "rotate-cw",
	switch: "flip-horizontal",
	"cross-in-box": "x-square",
	"left-arrow-with-tail": "arrow-left",
	"right-arrow-with-tail": "arrow-right",
	"up-arrow-with-tail": "arrow-up",
	"down-arrow-with-tail": "arrow-down",
	"magnifying-glass": "search",
	"right-triangle": "chevron-right",
	"filled-pin": "bookmark-check"
};

let iconIdsCache: Set<string> | null = null;

const LUCIDE_NAME_ALIASES: Record<string, string> = {
	"trash": "Trash2",
	"x-square": "SquareX",
	"move-vertical": "MoveVertical",
	"text-select": "TextSelect",
	"bookmark-check": "BookmarkCheck",
	"flip-horizontal": "FlipHorizontal2",
	"file-text": "FileText",
	"file-down": "FileDown",
	"stretch-vertical": "StretchVertical",
	"sticky-note": "StickyNote",
	"mouse-pointer-2": "MousePointer2",
	"text-cursor-input": "TextCursorInput",
	"align-left": "TextAlignStart",
	"align-center": "TextAlignCenter",
	"align-right": "TextAlignEnd",
	"align-justify": "TextAlignJustify"
};

const getKnownIconIds = (): Set<string> => {
	if (iconIdsCache) {
		return iconIdsCache;
	}
	iconIdsCache = new Set([...getIconIds(), ...Object.keys(ICON_ALIASES), ...Object.keys(LUCIDE_NAME_ALIASES)]);
	return iconIdsCache;
};

const toLucideComponentName = (name: string): string => {
	const canonical = resolveCanonicalIconName(name);
	if (LUCIDE_NAME_ALIASES[canonical]) {
		return LUCIDE_NAME_ALIASES[canonical];
	}
	return canonical
		.split("-")
		.filter(Boolean)
		.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
		.join("");
};

const createLucideIconSvg = (name: string): SVGSVGElement | null => {
	const componentName = toLucideComponentName(name);
	const IconComponent = (lucideIcons as Record<string, LucideIcon | undefined>)[componentName];
	if (!IconComponent) {
		return null;
	}
	const markup = renderToStaticMarkup(
		React.createElement(IconComponent, {
			size: 24,
			strokeWidth: 2,
			"aria-hidden": "true"
		})
	);
	const template = document.createElement("template");
	template.innerHTML = markup.trim();
	const svg = template.content.firstElementChild;
	return svg instanceof SVGSVGElement ? svg : null;
};

const pushIconCandidateVariants = (target: string[], id: string): void => {
	if (!id || target.includes(id)) {
		return;
	}
	target.push(id);
	if (id.startsWith("lucide-")) {
		const withoutPrefix = id.slice("lucide-".length);
		if (withoutPrefix && !target.includes(withoutPrefix)) {
			target.push(withoutPrefix);
		}
		return;
	}
	const lucideName = `lucide-${id}`;
	if (!target.includes(lucideName)) {
		target.push(lucideName);
	}
};

const resolveCanonicalIconName = (name: string): string => ICON_ALIASES[name] ?? name;

const resolveIconCandidates = (name: string): string[] => {
	const candidates: string[] = [];
	// Keep icon choice deterministic across platforms:
	// always prefer the canonical cross-platform icon first.
	const canonical = resolveCanonicalIconName(name);
	pushIconCandidateVariants(candidates, canonical);
	if (canonical !== name) {
		pushIconCandidateVariants(candidates, name);
	}
	return candidates;
};

const hasRenderableVector = (svg: SVGSVGElement): boolean =>
	Boolean(svg.querySelector("path, circle, rect, line, polyline, polygon, ellipse, g, use"));

const createSvgElement = (): SVGSVGElement =>
	document.createElementNS("http://www.w3.org/2000/svg", "svg");

const createSvgChild = <K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string>
): SVGElementTagNameMap[K] => {
	const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
	for (const [key, value] of Object.entries(attrs)) {
		el.setAttribute(key, value);
	}
	return el;
};

const normalizeSvgIcon = (icon: SVGSVGElement): void => {
	icon.classList.add("svg-icon");
	icon.setAttribute("aria-hidden", "true");
	if (!icon.hasAttribute("stroke")) {
		icon.setAttribute("stroke", "currentColor");
	}
	if (!icon.hasAttribute("fill")) {
		icon.setAttribute("fill", "none");
	}
	if (!icon.hasAttribute("stroke-width")) {
		icon.setAttribute("stroke-width", "2");
	}
	if (!icon.hasAttribute("stroke-linecap")) {
		icon.setAttribute("stroke-linecap", "round");
	}
	if (!icon.hasAttribute("stroke-linejoin")) {
		icon.setAttribute("stroke-linejoin", "round");
	}
};

const clearTextFallback = (element: HTMLElement): void => {
	const host = element.querySelector<HTMLElement>(".inkdoc-icon-render-host");
	if (host) {
		host.remove();
	}
	const fallback = element.querySelector<HTMLElement>(".inkdoc-icon-text-fallback");
	if (fallback) {
		fallback.remove();
	}
	element.removeClass("is-icon-text-fallback");
};

const setTextFallbackText = (element: HTMLElement, value: string): void => {
	element.empty();
	element.addClass("is-icon-text-fallback");
	element.createSpan({ cls: "inkdoc-icon-text-fallback", text: value });
};

const getRenderHost = (element: HTMLElement): HTMLElement => {
	if (element.tagName !== "BUTTON") {
		return element;
	}
	const existing = element.querySelector<HTMLElement>(".inkdoc-icon-render-host");
	if (existing) {
		existing.empty();
		return existing;
	}
	return element.createSpan({ cls: "inkdoc-icon-render-host" });
};

const resolveSvgIcon = (name: string): SVGSVGElement | null => {
	const known = getKnownIconIds();
	const candidates = resolveIconCandidates(name);
	for (const id of candidates) {
		const icon = createLucideIconSvg(id) ?? (known.has(id) ? getIcon(id) : null);
		if (icon && hasRenderableVector(icon)) {
			return icon;
		}
	}
	return null;
};

export const setInkDocIcon = (element: HTMLElement, name: string, textFallback = "?"): void => {
	clearTextFallback(element);
	const icon = resolveSvgIcon(name);
	if (!icon) {
		setTextFallbackText(element, textFallback);
		return;
	}
	const host = getRenderHost(element);
	if (host === element) {
		element.empty();
	}
	const cloned = icon.cloneNode(true);
	if (cloned instanceof SVGSVGElement) {
		normalizeSvgIcon(cloned);
		host.appendChild(cloned);
		return;
	}
	setTextFallbackText(element, textFallback);
};

export const setInkDocMenuItemIcon = (item: MenuItemLike, name: string): void => {
	const known = getKnownIconIds();
	const candidates = resolveIconCandidates(name);
	for (const id of candidates) {
		if (known.has(id)) {
			item.setIcon(id);
			return;
		}
	}
	if (candidates[0]) {
		item.setIcon(candidates[0]);
	}
};
