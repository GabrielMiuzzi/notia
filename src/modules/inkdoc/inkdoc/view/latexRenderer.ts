// @ts-nocheck

const DISPLAY_BRACKET_PATTERN = /^\\\[\s*([\s\S]*?)\s*\\\]$/;
const INLINE_PAREN_PATTERN = /^\\\(\s*([\s\S]*?)\s*\\\)$/;
const DISPLAY_DOLLAR_PATTERN = /^\$\$\s*([\s\S]*?)\s*\$\$$/;
const INLINE_DOLLAR_PATTERN = /^\$\s*([\s\S]*?)\s*\$$/;
const LATEX_SEGMENT_PATTERN = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\n])+\$)/g;

type LatexSegment =
	| { type: "math"; content: string; displayMode: boolean }
	| { type: "text"; content: string };

const unwrapMathSegment = (value: string): { content: string; displayMode: boolean } | null => {
	const bracketMatch = value.match(DISPLAY_BRACKET_PATTERN);
	if (bracketMatch) {
		return { content: bracketMatch[1]?.trim() ?? "", displayMode: true };
	}
	const parenMatch = value.match(INLINE_PAREN_PATTERN);
	if (parenMatch) {
		return { content: parenMatch[1]?.trim() ?? "", displayMode: false };
	}
	const dollarMatch = value.match(DISPLAY_DOLLAR_PATTERN);
	if (dollarMatch) {
		return { content: dollarMatch[1]?.trim() ?? "", displayMode: true };
	}
	const inlineDollarMatch = value.match(INLINE_DOLLAR_PATTERN);
	if (inlineDollarMatch) {
		return { content: inlineDollarMatch[1]?.trim() ?? "", displayMode: false };
	}
	return null;
};

const parseLatexSegments = (value: string): LatexSegment[] => {
	const trimmed = value.trim();
	if (!trimmed) {
		return [];
	}
	const segments: LatexSegment[] = [];
	let lastIndex = 0;
	const matches = Array.from(trimmed.matchAll(LATEX_SEGMENT_PATTERN));
	if (matches.length === 0) {
		return [{ type: "math", content: trimmed, displayMode: true }];
	}
	for (const match of matches) {
		const raw = match[0];
		const start = match.index ?? 0;
		if (start > lastIndex) {
			const text = trimmed.slice(lastIndex, start);
			if (text.trim().length > 0) {
				segments.push({ type: "text", content: text });
			}
		}
		const math = unwrapMathSegment(raw);
		if (math && math.content.length > 0) {
			segments.push({ type: "math", content: math.content, displayMode: math.displayMode });
		}
		lastIndex = start + raw.length;
	}
	if (lastIndex < trimmed.length) {
		const text = trimmed.slice(lastIndex);
		if (text.trim().length > 0) {
			segments.push({ type: "text", content: text });
		}
	}
	if (segments.length === 0) {
		const unwrapped = unwrapMathSegment(trimmed);
		if (unwrapped && unwrapped.content.length > 0) {
			return [{ type: "math", content: unwrapped.content, displayMode: unwrapped.displayMode }];
		}
		return [{ type: "math", content: trimmed, displayMode: true }];
	}
	return segments;
};

export const renderLatexSegments = async (
	container: HTMLElement,
	value: string
): Promise<boolean> => {
	const trimmed = value.trim();
	if (!trimmed) {
		container.empty();
		return false;
	}
	container.empty();
	const segments = parseLatexSegments(trimmed);
	if (segments.length === 0) {
		return false;
	}
	try {
		const katexModule = await import("katex");
		const root = container.createDiv({ cls: "inkdoc-latex-render-root" });
		root.style.display = "flex";
		root.style.flexDirection = "column";
		root.style.alignItems = "stretch";
		root.style.gap = "0.45em";
		let renderedAny = false;
		for (const segment of segments) {
			if (segment.type === "text") {
				const text = root.createDiv({ cls: "inkdoc-markdown-render" });
				text.style.whiteSpace = "pre-wrap";
				text.textContent = segment.content.trim();
				renderedAny = true;
				continue;
			}
			const host = root.createDiv({
				cls: segment.displayMode
					? "inkdoc-markdown-render inkdoc-markdown-render--math"
					: "inkdoc-markdown-render inkdoc-markdown-render--math-inline"
			});
			host.innerHTML = katexModule.renderToString(segment.content, {
				throwOnError: false,
				displayMode: segment.displayMode
			});
			renderedAny = true;
		}
		return renderedAny;
	} catch {
		container.textContent = trimmed;
		return false;
	}
};
