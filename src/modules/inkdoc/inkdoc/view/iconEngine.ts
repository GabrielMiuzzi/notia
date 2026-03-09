// @ts-nocheck
import { getIcon, getIconIds } from "../../engines/platform/inkdocPlatform";
import { INKDOC_ICONS, type InkDocIconName } from "./icons";

type MenuItemLike = {
	setIcon: (icon: string) => unknown;
};

const ICON_ALIASES: Record<string, InkDocIconName> = {
	[INKDOC_ICONS.HIGHLIGHT_GLYPH]: INKDOC_ICONS.HIGHLIGHTER,
	[INKDOC_ICONS.UP_AND_DOWN_ARROWS]: INKDOC_ICONS.HAND,
	[INKDOC_ICONS.HASHTAG]: INKDOC_ICONS.SIGMA,
	[INKDOC_ICONS.SELECT_ALL_TEXT]: INKDOC_ICONS.MOUSE_POINTER_2,
	[INKDOC_ICONS.IMAGE_FILE]: INKDOC_ICONS.IMAGE,
	[INKDOC_ICONS.DOCUMENTS]: INKDOC_ICONS.STICKY_NOTE,
	[INKDOC_ICONS.THREE_HORIZONTAL_BARS]: INKDOC_ICONS.MENU,
	[INKDOC_ICONS.DOWN_CHEVRON_GLYPH]: INKDOC_ICONS.CHEVRON_DOWN,
	[INKDOC_ICONS.UP_CHEVRON_GLYPH]: INKDOC_ICONS.CHEVRON_UP,
	[INKDOC_ICONS.GEAR]: INKDOC_ICONS.SETTINGS,
	[INKDOC_ICONS.EXPAND_VERTICALLY]: INKDOC_ICONS.STRETCH_VERTICAL,
	[INKDOC_ICONS.PLUS_WITH_CIRCLE]: INKDOC_ICONS.PLUS,
	[INKDOC_ICONS.RESET]: INKDOC_ICONS.ROTATE_CW,
	[INKDOC_ICONS.SWITCH]: INKDOC_ICONS.FLIP_HORIZONTAL,
	[INKDOC_ICONS.CROSS_IN_BOX]: INKDOC_ICONS.X_SQUARE,
	[INKDOC_ICONS.LEFT_ARROW_WITH_TAIL]: INKDOC_ICONS.ARROW_LEFT,
	[INKDOC_ICONS.RIGHT_ARROW_WITH_TAIL]: INKDOC_ICONS.ARROW_RIGHT,
	[INKDOC_ICONS.UP_ARROW_WITH_TAIL]: INKDOC_ICONS.ARROW_UP,
	[INKDOC_ICONS.DOWN_ARROW_WITH_TAIL]: INKDOC_ICONS.ARROW_DOWN,
	[INKDOC_ICONS.MAGNIFYING_GLASS]: INKDOC_ICONS.SEARCH,
	[INKDOC_ICONS.RIGHT_TRIANGLE]: INKDOC_ICONS.CHEVRON_RIGHT,
	[INKDOC_ICONS.FILLED_PIN]: INKDOC_ICONS.LOCK
};

let iconIdsCache: Set<string> | null = null;

const getKnownIconIds = (): Set<string> => {
	if (iconIdsCache) {
		return iconIdsCache;
	}
	iconIdsCache = new Set(getIconIds());
	return iconIdsCache;
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

const createCustomIcon = (name: InkDocIconName): SVGSVGElement | null => {
	const svg = createSvgElement();
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("width", "24");
	svg.setAttribute("height", "24");
	switch (name) {
		case INKDOC_ICONS.PENCIL: {
			svg.appendChild(createSvgChild("path", { d: "M4 20l4-1 10-10-3-3L5 16l-1 4z" }));
			svg.appendChild(createSvgChild("path", { d: "M13 6l3 3" }));
			return svg;
		}
		case INKDOC_ICONS.HIGHLIGHTER: {
			svg.appendChild(createSvgChild("path", { d: "M5 15l4 4h8l2-2-4-4z" }));
			svg.appendChild(createSvgChild("path", { d: "M13 7l4 4" }));
			return svg;
		}
		case INKDOC_ICONS.ERASER: {
			svg.appendChild(
				createSvgChild("path", {
					d: "M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"
				})
			);
			svg.appendChild(createSvgChild("path", { d: "m5.082 11.09 8.828 8.828" }));
			return svg;
		}
		case INKDOC_ICONS.SCISSORS: {
			svg.appendChild(createSvgChild("circle", { cx: "6", cy: "7", r: "2.2" }));
			svg.appendChild(createSvgChild("circle", { cx: "6", cy: "17", r: "2.2" }));
			svg.appendChild(createSvgChild("path", { d: "M8 8l12-5" }));
			svg.appendChild(createSvgChild("path", { d: "M8 16l12 5" }));
			return svg;
		}
		case INKDOC_ICONS.HAND: {
			svg.appendChild(
				createSvgChild("path", {
					d: "M8 12V6a1 1 0 0 1 2 0v6M11 12V4a1 1 0 0 1 2 0v8M14 12V5a1 1 0 0 1 2 0v7M17 12V8a1 1 0 0 1 2 0v7a5 5 0 0 1-5 5h-2.5A4.5 4.5 0 0 1 7 15.5V12"
				})
			);
			return svg;
		}
		case INKDOC_ICONS.MOUSE_POINTER_2: {
			svg.appendChild(
				createSvgChild("path", {
					d: "M6 3l12 9-5 1 2 6-2.5 1-2.5-6-4 3z"
				})
			);
			return svg;
		}
		case INKDOC_ICONS.IMAGE: {
			svg.appendChild(
				createSvgChild("rect", {
					x: "3",
					y: "5",
					width: "18",
					height: "14",
					rx: "2",
					ry: "2"
				})
			);
			svg.appendChild(createSvgChild("circle", { cx: "9", cy: "10", r: "1.5" }));
			svg.appendChild(createSvgChild("path", { d: "M21 16l-5-5-6 6" }));
			return svg;
		}
		case INKDOC_ICONS.STICKY_NOTE: {
			svg.appendChild(
				createSvgChild("path", {
					d: "M6 3h9l5 5v13H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
				})
			);
			svg.appendChild(createSvgChild("path", { d: "M15 3v5h5" }));
			return svg;
		}
		case INKDOC_ICONS.MENU: {
			svg.appendChild(createSvgChild("path", { d: "M5 7h14M5 12h14M5 17h14" }));
			return svg;
		}
		case INKDOC_ICONS.TRASH: {
			svg.appendChild(createSvgChild("path", { d: "M4 7h16" }));
			svg.appendChild(createSvgChild("path", { d: "M9 7V5h6v2" }));
			svg.appendChild(createSvgChild("rect", { x: "6", y: "7", width: "12", height: "13", rx: "1.5" }));
			return svg;
		}
		case INKDOC_ICONS.SETTINGS: {
			svg.appendChild(
				createSvgChild("path", {
					d: "M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z"
				})
			);
			svg.appendChild(createSvgChild("path", { d: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" }));
			return svg;
		}
		case INKDOC_ICONS.PALETTE: {
			svg.appendChild(createSvgChild("path", { d: "M12 4a8 8 0 1 0 0 16h1.2a2.3 2.3 0 0 0 0-4.6H12a2 2 0 0 1 0-4h5a3 3 0 0 0 0-6h-5z" }));
			svg.appendChild(createSvgChild("circle", { cx: "7.5", cy: "10", r: "1" }));
			svg.appendChild(createSvgChild("circle", { cx: "10", cy: "7.5", r: "1" }));
			svg.appendChild(createSvgChild("circle", { cx: "14", cy: "7.5", r: "1" }));
			return svg;
		}
		case INKDOC_ICONS.STRETCH_VERTICAL: {
			svg.appendChild(createSvgChild("path", { d: "M12 4v16" }));
			svg.appendChild(createSvgChild("path", { d: "M9 7l3-3 3 3" }));
			svg.appendChild(createSvgChild("path", { d: "M9 17l3 3 3-3" }));
			return svg;
		}
		case INKDOC_ICONS.PLUS: {
			svg.appendChild(createSvgChild("path", { d: "M12 5v14M5 12h14" }));
			return svg;
		}
		case INKDOC_ICONS.CHEVRON_DOWN: {
			svg.appendChild(createSvgChild("path", { d: "M6 9l6 6 6-6" }));
			return svg;
		}
		case INKDOC_ICONS.CHEVRON_UP: {
			svg.appendChild(createSvgChild("path", { d: "M6 15l6-6 6 6" }));
			return svg;
		}
		case INKDOC_ICONS.ROTATE_CW: {
			svg.appendChild(createSvgChild("path", { d: "M20 12a8 8 0 1 1-2.3-5.7" }));
			svg.appendChild(createSvgChild("path", { d: "M20 5v6h-6" }));
			return svg;
		}
		case INKDOC_ICONS.FLIP_HORIZONTAL: {
			svg.appendChild(createSvgChild("path", { d: "M12 4v16" }));
			svg.appendChild(createSvgChild("path", { d: "M10 6L4 12l6 6V6z" }));
			svg.appendChild(createSvgChild("path", { d: "M14 6l6 6-6 6V6z" }));
			return svg;
		}
		default:
			return null;
	}
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
		const custom = createCustomIcon(id as InkDocIconName);
		if (custom && hasRenderableVector(custom)) {
			return custom;
		}
		if (!known.has(id)) {
			continue;
		}
		const icon = getIcon(id);
		if (icon && hasRenderableVector(icon)) {
			return icon;
		}
	}
	return null;
};

export const setInkDocIcon = (element: HTMLElement, name: string, textFallback = "?"): void => {
	clearTextFallback(element);
	// Keep LaTeX tool icon identical on all platforms.
	if (resolveCanonicalIconName(name) === INKDOC_ICONS.SIGMA) {
		setTextFallbackText(element, "Σ");
		return;
	}
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
