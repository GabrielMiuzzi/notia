// @ts-nocheck
import { Crepe } from "@milkdown/crepe";

export type InkDocPageMarkdownRuntime = {
	pageId: string;
	layerEl: HTMLDivElement;
	setEditable: (editable: boolean) => void;
	focus: (position?: "start" | "end") => void;
	dispose: () => void;
};

type CreateInkDocPageMarkdownRuntimeOptions = {
	pageId: string;
	pageEl: HTMLDivElement;
	initialMarkdown: string;
	onMarkdownChange: (nextMarkdown: string) => void;
	onRequestNextPage?: () => void;
};

const resolveProseMirrorElement = (layerEl: HTMLElement): HTMLElement | null => {
	return layerEl.querySelector<HTMLElement>(".milkdown .ProseMirror");
};

export const createInkDocPageMarkdownRuntime = (
	options: CreateInkDocPageMarkdownRuntimeOptions
): InkDocPageMarkdownRuntime => {
	const layerEl = options.pageEl.createDiv({ cls: "inkdoc-page-markdown-layer" });
	const editorRootEl = layerEl.createDiv({ cls: "inkdoc-page-markdown-editor-root" });
	let isDisposed = false;
	let isReady = false;
	let isEditable = false;

	const setSelectionToPosition = (
		proseMirror: HTMLElement,
		position: "start" | "end"
	): void => {
		const selection = window.getSelection();
		if (!selection) {
			return;
		}
		const range = document.createRange();
		range.selectNodeContents(proseMirror);
		range.collapse(position !== "start");
		selection.removeAllRanges();
		selection.addRange(range);
	};

	const isCollapsedSelectionAtEditorEnd = (proseMirror: HTMLElement): boolean => {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) {
			return false;
		}
		const range = selection.getRangeAt(0);
		if (!range.collapsed || !proseMirror.contains(range.endContainer)) {
			return false;
		}
		const endRange = document.createRange();
		endRange.selectNodeContents(proseMirror);
		endRange.collapse(false);
		return range.compareBoundaryPoints(Range.START_TO_END, endRange) === 0;
	};

	const isCaretNearEditorBottom = (proseMirror: HTMLElement, thresholdPx = 18): boolean => {
		const editorRect = proseMirror.getBoundingClientRect();
		if (editorRect.height <= 0) {
			return false;
		}
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) {
			return false;
		}
		const range = selection.getRangeAt(0);
		if (!range.collapsed || !proseMirror.contains(range.endContainer)) {
			return false;
		}
		const caretRect = range.getBoundingClientRect();
		const caretBottom =
			Number.isFinite(caretRect.bottom) && caretRect.bottom > 0
				? caretRect.bottom
				: editorRect.bottom;
		return caretBottom >= editorRect.bottom - thresholdPx;
	};

	const handleEditorKeyDown = (event: KeyboardEvent): void => {
		if (
			!isEditable ||
			event.defaultPrevented ||
			event.isComposing ||
			event.key !== "Enter" ||
			event.shiftKey ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey
		) {
			return;
		}
		const proseMirror = resolveProseMirrorElement(layerEl);
		if (!proseMirror) {
			return;
		}
		if (
			!isCollapsedSelectionAtEditorEnd(proseMirror) ||
			!isCaretNearEditorBottom(proseMirror) ||
			typeof options.onRequestNextPage !== "function"
		) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		options.onRequestNextPage();
	};

	const applyEditableState = (): void => {
		layerEl.classList.toggle("is-editable", isEditable);
		const proseMirror = resolveProseMirrorElement(layerEl);
		if (!proseMirror) {
			return;
		}
		if (isEditable) {
			proseMirror.setAttribute("contenteditable", "true");
			proseMirror.removeAttribute("aria-readonly");
		} else {
			proseMirror.setAttribute("contenteditable", "false");
			proseMirror.setAttribute("aria-readonly", "true");
			(proseMirror as HTMLElement).blur();
		}
	};

	const crepe = new Crepe({
		root: editorRootEl,
		defaultValue: options.initialMarkdown ?? "",
		features: {
			[Crepe.Feature.Toolbar]: false,
			[Crepe.Feature.BlockEdit]: true
		}
	});

	crepe.on((listener) => {
		listener.markdownUpdated((_ctx, markdown) => {
			if (isDisposed) {
				return;
			}
			options.onMarkdownChange(markdown);
		});
	});

	void crepe.create().then(() => {
		if (isDisposed) {
			return;
		}
		isReady = true;
		editorRootEl.addEventListener("keydown", handleEditorKeyDown, true);
		applyEditableState();
	});

	return {
		pageId: options.pageId,
		layerEl,
		setEditable: (editable: boolean) => {
			isEditable = editable;
			if (!isReady) {
				layerEl.classList.toggle("is-editable", editable);
				return;
			}
			applyEditableState();
		},
		focus: (position = "end") => {
			if (!isEditable) {
				return;
			}
			const proseMirror = resolveProseMirrorElement(layerEl);
			if (!proseMirror) {
				return;
			}
			proseMirror.focus();
			setSelectionToPosition(proseMirror, position);
		},
		dispose: () => {
			if (isDisposed) {
				return;
			}
			isDisposed = true;
			editorRootEl.removeEventListener("keydown", handleEditorKeyDown, true);
			void crepe.destroy();
			layerEl.remove();
		}
	};
};
