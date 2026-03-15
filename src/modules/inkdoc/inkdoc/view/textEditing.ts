// @ts-nocheck
import {
	INKDOC_TEXT_MIN_HEIGHT,
	INKDOC_TEXT_MIN_WIDTH,
	type CanvasPageState
} from "./constants";
import type { InkDocDocument, InkDocPage, InkDocTextBlock } from "../types";
import { restoreWikiLinkSourceForEditing } from "./wikiLinks";
import {
	findActiveWikiLinkContext,
	searchWikiLinkTargets
} from "../../../../engines/markdown/wikiLinkEngine";
import type { MarkdownWikiLinkTarget } from "../../../../types/views/markdownWikiLink";
import { closeManagedMenu, openManagedMenu } from "./contextMenus";

export type ActiveBlockEdit = {
	pageId: string;
	pageIndex: number;
	blockId: string;
};

export type TextEditingContext = {
	docData: InkDocDocument | null;
	canvasStates: Map<string, CanvasPageState>;
	textLayerDirty: Set<string>;
	zoomLevel: number;
	getCanvasSizePx: () => { widthPx: number; heightPx: number };
	renderStrokes: (ctx: CanvasRenderingContext2D, strokes: NonNullable<InkDocPage["strokes"]>, pageId: string) => void;
	saveDebounced: () => void;
	noteUserActivity: () => void;
	updateTextToolbarVisibility: () => void;
	getDefaultBlockColor: (page: InkDocPage) => string;
	getWikiLinkTargets: () => MarkdownWikiLinkTarget[];
	onLatexCommitted?: (page: InkDocPage, block: InkDocTextBlock) => void;
};

export type TextEditingAccessors = {
	getTextEditor: () => HTMLDivElement | null;
	setTextEditor: (value: HTMLDivElement | null) => void;
	getLatexEditor: () => HTMLTextAreaElement | null;
	setLatexEditor: (value: HTMLTextAreaElement | null) => void;
	getActiveTextEdit: () => ActiveBlockEdit | null;
	setActiveTextEdit: (value: ActiveBlockEdit | null) => void;
	getActiveLatexEdit: () => ActiveBlockEdit | null;
	setActiveLatexEdit: (value: ActiveBlockEdit | null) => void;
	isTextToolbarInteraction: () => boolean;
};

const escapeHtml = (value: string): string => {
	const div = document.createElement("div");
	div.textContent = value;
	return div.innerHTML;
};

const moveCaretToEnd = (editor: HTMLDivElement): void => {
	const range = document.createRange();
	range.selectNodeContents(editor);
	range.collapse(false);
	const selection = window.getSelection();
	if (!selection) {
		return;
	}
	selection.removeAllRanges();
	selection.addRange(range);
};

const getCurrentParagraphElement = (editor: HTMLDivElement): HTMLElement | null => {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return null;
	}
	const node = selection.anchorNode;
	if (!node) {
		return null;
	}
	const element = node instanceof HTMLElement ? node : node.parentElement;
	if (!element) {
		return null;
	}
	return element.closest("p, div, h1, h2, h3, h4, h5, h6, blockquote, pre, li");
};

const resolvePageByEdit = (
	docData: InkDocDocument | null,
	edit: ActiveBlockEdit
): InkDocPage | null => {
	if (!docData) {
		return null;
	}
	return docData.pages.find((entry) => entry.id === edit.pageId) ?? docData.pages[edit.pageIndex] ?? null;
};

const positionTextEditor = (
	context: TextEditingContext,
	canvas: HTMLCanvasElement,
	block: InkDocTextBlock,
	editor: HTMLElement
): void => {
	const { widthPx, heightPx } = context.getCanvasSizePx();
	const rect = canvas.getBoundingClientRect();
	const zoom = context.zoomLevel || 1;
	const scaleX = rect.width / zoom / widthPx;
	const scaleY = rect.height / zoom / heightPx;
	editor.style.left = `${block.x * scaleX}px`;
	editor.style.top = `${block.y * scaleY}px`;
	editor.style.width = `${Math.max(INKDOC_TEXT_MIN_WIDTH, block.w * scaleX)}px`;
	editor.style.height = `${Math.max(INKDOC_TEXT_MIN_HEIGHT, block.h * scaleY)}px`;
};

const autoResizeTextEditor = (editor: HTMLDivElement): void => {
	editor.style.height = "auto";
	editor.style.height = `${editor.scrollHeight}px`;
};

const autoResizeLatexEditor = (editor: HTMLTextAreaElement): void => {
	editor.style.height = "auto";
	editor.style.height = `${editor.scrollHeight}px`;
};

const getEditorTextOffset = (editor: HTMLDivElement): number | null => {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || !selection.anchorNode) {
		return null;
	}
	if (!editor.contains(selection.anchorNode)) {
		return null;
	}
	const range = document.createRange();
	range.selectNodeContents(editor);
	range.setEnd(selection.anchorNode, selection.anchorOffset);
	return range.toString().length;
};

const resolveTextNodePosition = (
	root: Node,
	offset: number
): { node: Node; offset: number } | null => {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let consumed = 0;
	while (true) {
		const current = walker.nextNode();
		if (!(current instanceof Text)) {
			break;
		}
		const length = current.nodeValue?.length ?? 0;
		if (offset <= consumed + length) {
			return { node: current, offset: Math.max(0, offset - consumed) };
		}
		consumed += length;
	}
	return { node: root, offset: root.childNodes.length };
};

const replaceEditorTextRange = (
	editor: HTMLDivElement,
	startOffset: number,
	endOffset: number,
	replacement: string
): void => {
	const start = resolveTextNodePosition(editor, startOffset);
	const end = resolveTextNodePosition(editor, endOffset);
	if (!start || !end) {
		return;
	}
	const range = document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset);
	range.deleteContents();
	const textNode = document.createTextNode(replacement);
	range.insertNode(textNode);
	range.setStart(textNode, textNode.nodeValue?.length ?? replacement.length);
	range.collapse(true);
	const selection = window.getSelection();
	if (!selection) {
		return;
	}
	selection.removeAllRanges();
	selection.addRange(range);
};

const WIKI_LINK_MENU_SELECTOR = ".inkdoc-text-wikilink-menu";

const closeWikiLinkSuggestionMenu = (menu: HTMLDivElement | null): void => {
	if (menu?.parentElement) {
		closeManagedMenu(menu.parentElement, WIKI_LINK_MENU_SELECTOR);
		return;
	}
	closeManagedMenu(document.body, WIKI_LINK_MENU_SELECTOR);
};

const buildWikiLinkReplacement = (target: MarkdownWikiLinkTarget): string => {
	const explicitReference = target.relativePathWithExtension || target.path;
	const visibleLabel = target.title.trim();
	if (!explicitReference) {
		return `[[${visibleLabel}]]`;
	}
	return visibleLabel
		? `[[${explicitReference}|${visibleLabel}]]`
		: `[[${explicitReference}]]`;
};

const refreshTextLayer = (
	context: TextEditingContext,
	pageId: string,
	page: InkDocPage
): void => {
	const state = context.canvasStates.get(pageId);
	if (!state) {
		return;
	}
	context.textLayerDirty.add(pageId);
	context.renderStrokes(state.ctx, page.strokes ?? [], page.id);
};

const commitTextEditor = (
	context: TextEditingContext,
	editor: HTMLDivElement,
	active: ActiveBlockEdit
): void => {
	const page = resolvePageByEdit(context.docData, active);
	if (!page) {
		return;
	}
	const block = page.textBlocks?.find((entry) => entry.id === active.blockId);
	if (!block) {
		return;
	}
	block.html = restoreWikiLinkSourceForEditing(editor.innerHTML);
	block.text = editor.innerText;
	const state = context.canvasStates.get(active.pageId);
	if (state) {
		context.textLayerDirty.add(active.pageId);
		const { widthPx, heightPx } = context.getCanvasSizePx();
		const canvasRect = state.canvas.getBoundingClientRect();
		const editorRect = editor.getBoundingClientRect();
		const scaleX = widthPx / canvasRect.width;
		const scaleY = heightPx / canvasRect.height;
		block.w = Math.max(INKDOC_TEXT_MIN_WIDTH, editorRect.width * scaleX);
		block.h = Math.max(INKDOC_TEXT_MIN_HEIGHT, editorRect.height * scaleY);
		context.renderStrokes(state.ctx, page.strokes ?? [], page.id);
	}
	context.onLatexCommitted?.(page, block);
	context.saveDebounced();
};

const commitLatexEditor = (
	context: TextEditingContext,
	editor: HTMLTextAreaElement,
	active: ActiveBlockEdit
): void => {
	const page = resolvePageByEdit(context.docData, active);
	if (!page) {
		return;
	}
	const block = page.textBlocks?.find((entry) => entry.id === active.blockId);
	if (!block) {
		return;
	}
	block.latex = editor.value;
	const state = context.canvasStates.get(active.pageId);
	if (state) {
		context.textLayerDirty.add(active.pageId);
		const { widthPx, heightPx } = context.getCanvasSizePx();
		const canvasRect = state.canvas.getBoundingClientRect();
		const editorRect = editor.getBoundingClientRect();
		const scaleX = widthPx / canvasRect.width;
		const scaleY = heightPx / canvasRect.height;
		block.w = Math.max(INKDOC_TEXT_MIN_WIDTH, editorRect.width * scaleX);
		block.h = Math.max(INKDOC_TEXT_MIN_HEIGHT, editorRect.height * scaleY);
		context.renderStrokes(state.ctx, page.strokes ?? [], page.id);
	}
	context.saveDebounced();
};

export const syncActiveTextBlockFromEditor = (
	context: TextEditingContext,
	accessors: TextEditingAccessors,
	render: boolean
): void => {
	const editor = accessors.getTextEditor();
	const active = accessors.getActiveTextEdit();
	if (!editor || !active || !context.docData) {
		return;
	}
	const page = resolvePageByEdit(context.docData, active);
	if (!page) {
		return;
	}
	const block = page.textBlocks?.find((entry) => entry.id === active.blockId);
	if (!block) {
		return;
	}
	block.html = restoreWikiLinkSourceForEditing(editor.innerHTML);
	block.text = editor.innerText;
	if (render) {
		context.textLayerDirty.add(active.pageId);
		const state = context.canvasStates.get(active.pageId);
		if (state) {
			context.renderStrokes(state.ctx, page.strokes ?? [], page.id);
		}
	}
};

export const applyEditorCommand = (
	context: TextEditingContext,
	accessors: TextEditingAccessors,
	command: string,
	value?: string
): void => {
	const editor = accessors.getTextEditor();
	if (!editor) {
		return;
	}
	editor.focus();
	document.execCommand("styleWithCSS", false, "true");
	document.execCommand(command, false, value);
	syncActiveTextBlockFromEditor(context, accessors, false);
};

const applyBlockStyleFromString = (
	context: TextEditingContext,
	accessors: TextEditingAccessors,
	style: string
): void => {
	const editor = accessors.getTextEditor();
	if (!editor) {
		return;
	}
	editor.style.cssText = `${editor.style.cssText}; ${style}`;
	syncActiveTextBlockFromEditor(context, accessors, false);
};

export const applySelectionStyle = (
	context: TextEditingContext,
	accessors: TextEditingAccessors,
	style: string
): void => {
	const editor = accessors.getTextEditor();
	if (!editor) {
		return;
	}
	editor.focus();
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		applyBlockStyleFromString(context, accessors, style);
		return;
	}
	const range = selection.getRangeAt(0);
	if (range.collapsed) {
		applyBlockStyleFromString(context, accessors, style);
		return;
	}
	const span = document.createElement("span");
	span.setAttribute("style", style);
	try {
		range.surroundContents(span);
	} catch {
		const html = escapeHtml(range.toString());
		document.execCommand("insertHTML", false, `<span style="${style}">${html}</span>`);
	}
	syncActiveTextBlockFromEditor(context, accessors, false);
};

export const applyTextTransform = (
	context: TextEditingContext,
	accessors: TextEditingAccessors,
	value: "uppercase" | "lowercase" | "capitalize"
): void => {
	applySelectionStyle(context, accessors, `text-transform: ${value};`);
};

export const applyBlockStyle = (
	context: TextEditingContext,
	accessors: TextEditingAccessors,
	styles: Partial<CSSStyleDeclaration>
): void => {
	const editor = accessors.getTextEditor();
	if (!editor) {
		return;
	}
	Object.assign(editor.style, styles);
	syncActiveTextBlockFromEditor(context, accessors, false);
};

export const applyParagraphStyle = (
	context: TextEditingContext,
	accessors: TextEditingAccessors,
	styles: Partial<CSSStyleDeclaration>
): void => {
	const editor = accessors.getTextEditor();
	if (!editor) {
		return;
	}
	const paragraph = getCurrentParagraphElement(editor) ?? editor;
	Object.assign(paragraph.style, styles);
	syncActiveTextBlockFromEditor(context, accessors, false);
};

export const closeTextEditor = (
	context: TextEditingContext,
	accessors: TextEditingAccessors,
	commit: boolean
): void => {
	const editor = accessors.getTextEditor();
	const active = accessors.getActiveTextEdit();
	if (!editor || !active) {
		return;
	}
	const page = resolvePageByEdit(context.docData, active);
	accessors.setTextEditor(null);
	accessors.setActiveTextEdit(null);
	if (commit) {
		commitTextEditor(context, editor, active);
	} else if (page) {
		refreshTextLayer(context, active.pageId, page);
	}
	editor.remove();
	context.updateTextToolbarVisibility();
};

export const closeLatexEditor = (
	context: TextEditingContext,
	accessors: TextEditingAccessors,
	commit: boolean
): void => {
	const editor = accessors.getLatexEditor();
	const active = accessors.getActiveLatexEdit();
	if (!editor || !active) {
		return;
	}
	const page = resolvePageByEdit(context.docData, active);
	accessors.setLatexEditor(null);
	accessors.setActiveLatexEdit(null);
	if (commit) {
		commitLatexEditor(context, editor, active);
	} else if (page) {
		refreshTextLayer(context, active.pageId, page);
	}
	editor.remove();
	context.updateTextToolbarVisibility();
};

export const openTextEditor = (
	context: TextEditingContext,
	accessors: TextEditingAccessors,
	page: InkDocPage,
	index: number,
	block: InkDocTextBlock
): void => {
	const state = context.canvasStates.get(page.id);
	if (!state || block.type === "latex") {
		return;
	}
	closeTextEditor(context, accessors, true);
	const editor = state.pageEl.createDiv({ cls: "inkdoc-text-editor" });
	editor.contentEditable = "true";
	editor.spellcheck = true;
	editor.innerHTML = restoreWikiLinkSourceForEditing(block.html ?? escapeHtml(block.text ?? ""));
	editor.style.color = typeof block.color === "string" && block.color.trim().length > 0
		? block.color
		: context.getDefaultBlockColor(page);
	accessors.setTextEditor(editor);
	accessors.setActiveTextEdit({ pageId: page.id, pageIndex: index, blockId: block.id });
	refreshTextLayer(context, page.id, page);
	positionTextEditor(context, state.canvas, block, editor);
	autoResizeTextEditor(editor);
	let wikiLinkMenuEl: HTMLDivElement | null = null;
	let wikiLinkSelectionIndex = 0;
	let activeWikiLinkSuggestions: MarkdownWikiLinkTarget[] = [];
	let activeWikiLinkRange: { startOffset: number; endOffset: number } | null = null;

	const refreshWikiLinkMenu = () => {
		const caretOffset = getEditorTextOffset(editor);
		const rawText = editor.innerText ?? "";
		if (caretOffset === null) {
			activeWikiLinkSuggestions = [];
			activeWikiLinkRange = null;
			closeWikiLinkSuggestionMenu(wikiLinkMenuEl);
			wikiLinkMenuEl = null;
			return;
		}
		const contextMatch = findActiveWikiLinkContext(rawText, caretOffset);
		if (!contextMatch) {
			activeWikiLinkSuggestions = [];
			activeWikiLinkRange = null;
			closeWikiLinkSuggestionMenu(wikiLinkMenuEl);
			wikiLinkMenuEl = null;
			return;
		}
		const rawCandidate = rawText.slice(contextMatch.startOffset, contextMatch.endOffset);
		if (rawCandidate.endsWith("]]")) {
			activeWikiLinkSuggestions = [];
			activeWikiLinkRange = null;
			closeWikiLinkSuggestionMenu(wikiLinkMenuEl);
			wikiLinkMenuEl = null;
			return;
		}
		const suggestions = searchWikiLinkTargets(context.getWikiLinkTargets(), contextMatch.query);
		if (suggestions.length === 0) {
			activeWikiLinkSuggestions = [];
			activeWikiLinkRange = null;
			closeWikiLinkSuggestionMenu(wikiLinkMenuEl);
			wikiLinkMenuEl = null;
			return;
		}
		activeWikiLinkSuggestions = suggestions;
		activeWikiLinkRange = {
			startOffset: contextMatch.startOffset,
			endOffset: contextMatch.endOffset
		};
		wikiLinkSelectionIndex = Math.max(0, Math.min(wikiLinkSelectionIndex, suggestions.length - 1));
		const selection = window.getSelection();
		const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
		const rect = range?.getBoundingClientRect() ?? editor.getBoundingClientRect();
		closeWikiLinkSuggestionMenu(wikiLinkMenuEl);
		wikiLinkMenuEl = openManagedMenu(
			document.body,
			"inkdoc-text-wikilink-menu",
			rect.left,
			rect.bottom + 6,
			suggestions.map((target) => ({
				label:
					target.relativePath.toLowerCase() !== target.title.toLowerCase() || target.wikiLink.toLowerCase() !== target.title.toLowerCase()
						? `${target.title} - ${target.relativePath}`
						: target.title,
				onClick: () => {
					if (!activeWikiLinkRange) {
						return;
					}
					replaceEditorTextRange(
						editor,
						activeWikiLinkRange.startOffset,
						activeWikiLinkRange.endOffset,
						buildWikiLinkReplacement(target)
					);
					context.noteUserActivity();
					autoResizeTextEditor(editor);
					refreshWikiLinkMenu();
				}
			})),
			() => {
				activeWikiLinkSuggestions = [];
				activeWikiLinkRange = null;
				closeWikiLinkSuggestionMenu(wikiLinkMenuEl);
				wikiLinkMenuEl = null;
			}
		);
	};
	editor.addEventListener("input", () => {
		context.noteUserActivity();
		autoResizeTextEditor(editor);
		refreshWikiLinkMenu();
	});
	editor.addEventListener("pointerdown", (event) => {
		event.stopPropagation();
	});
	editor.addEventListener("mousedown", (event) => {
		event.stopPropagation();
	});
	editor.addEventListener("click", (event) => {
		event.stopPropagation();
		window.setTimeout(refreshWikiLinkMenu, 0);
	});
	editor.addEventListener("keydown", (event) => {
		context.noteUserActivity();
		event.stopPropagation();
		if (wikiLinkMenuEl && activeWikiLinkSuggestions.length > 0) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				wikiLinkSelectionIndex = (wikiLinkSelectionIndex + 1) % activeWikiLinkSuggestions.length;
				refreshWikiLinkMenu();
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				wikiLinkSelectionIndex =
					(wikiLinkSelectionIndex - 1 + activeWikiLinkSuggestions.length) % activeWikiLinkSuggestions.length;
				refreshWikiLinkMenu();
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				const target = activeWikiLinkSuggestions[wikiLinkSelectionIndex] ?? activeWikiLinkSuggestions[0];
				if (target && activeWikiLinkRange) {
					event.preventDefault();
					replaceEditorTextRange(
						editor,
						activeWikiLinkRange.startOffset,
						activeWikiLinkRange.endOffset,
						buildWikiLinkReplacement(target)
					);
					autoResizeTextEditor(editor);
					refreshWikiLinkMenu();
					return;
				}
			}
			if (event.key === "Escape") {
				event.preventDefault();
				activeWikiLinkSuggestions = [];
				activeWikiLinkRange = null;
				closeWikiLinkSuggestionMenu(wikiLinkMenuEl);
				wikiLinkMenuEl = null;
				return;
			}
		}
		if (event.key === "Tab") {
			event.preventDefault();
			applyEditorCommand(context, accessors, "insertText", "    ");
		}
		if (event.key === "Escape") {
			event.preventDefault();
			editor.blur();
		}
	});
	editor.addEventListener("blur", () => {
		closeWikiLinkSuggestionMenu(wikiLinkMenuEl);
		wikiLinkMenuEl = null;
		if (accessors.isTextToolbarInteraction()) {
			editor.focus();
			return;
		}
		closeTextEditor(context, accessors, true);
	});
	editor.focus();
	moveCaretToEnd(editor);
	refreshWikiLinkMenu();
	context.updateTextToolbarVisibility();
};

export const openLatexEditor = (
	context: TextEditingContext,
	accessors: TextEditingAccessors,
	page: InkDocPage,
	index: number,
	block: InkDocTextBlock
): void => {
	const state = context.canvasStates.get(page.id);
	if (!state || block.type !== "latex") {
		return;
	}
	closeLatexEditor(context, accessors, true);
	const editor = state.pageEl.createEl("textarea", { cls: "inkdoc-latex-editor" });
	editor.value = block.latex ?? "";
	editor.style.background = "transparent";
	editor.style.backgroundColor = "transparent";
	editor.style.color = typeof block.color === "string" && block.color.trim().length > 0
		? block.color
		: context.getDefaultBlockColor(page);
	accessors.setLatexEditor(editor);
	accessors.setActiveLatexEdit({ pageId: page.id, pageIndex: index, blockId: block.id });
	refreshTextLayer(context, page.id, page);
	positionTextEditor(context, state.canvas, block, editor);
	autoResizeLatexEditor(editor);
	editor.addEventListener("input", () => {
		context.noteUserActivity();
		autoResizeLatexEditor(editor);
	});
	editor.addEventListener("pointerdown", (event) => {
		event.stopPropagation();
	});
	editor.addEventListener("mousedown", (event) => {
		event.stopPropagation();
	});
	editor.addEventListener("click", (event) => {
		event.stopPropagation();
	});
	editor.addEventListener("keydown", (event) => {
		context.noteUserActivity();
		event.stopPropagation();
		if (event.key === "Escape") {
			event.preventDefault();
			editor.blur();
		}
	});
	editor.addEventListener("blur", () => {
		if (accessors.isTextToolbarInteraction()) {
			editor.focus();
			return;
		}
		closeLatexEditor(context, accessors, true);
	});
	editor.focus();
	context.updateTextToolbarVisibility();
};
