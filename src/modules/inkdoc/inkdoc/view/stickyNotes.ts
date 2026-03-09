// @ts-nocheck
import type { InkDocDocument, InkDocStickyNote } from "../types";
import {
	INKDOC_STICKY_NOTE_DEFAULT_HEIGHT,
	INKDOC_STICKY_NOTE_DEFAULT_WIDTH,
	INKDOC_STICKY_NOTE_MIN_HEIGHT,
	INKDOC_STICKY_NOTE_MIN_WIDTH,
	createStickyNoteId
} from "./constants";
import {
	createObjectHoverMenuController,
	startWindowPointerInteraction
} from "./objectBehavior";
import { setCompatibleIcon } from "./iconFallback";
import { INKDOC_ICONS } from "./icons";

const DEFAULT_STICKY_COLOR = "#ffe672";
const COLLAPSED_STICKY_HEIGHT = 4;
const DEFAULT_STICKY_KIND = "normal";
const STICKY_COLOR_OPTIONS = [
	"#ffe672",
	"#ffd4a3",
	"#c8f7ad",
	"#b9e4ff",
	"#e7c9ff",
	"#ffd1de",
	"#fff2b3",
	"#ffc9a9",
	"#b8f2c7",
	"#a8d8ff",
	"#d8c2ff",
	"#f9b5c4"
];
type StickyKind = "normal" | "arrow-left" | "arrow-right" | "arrow-up" | "arrow-down";

const STICKY_KIND_OPTIONS: Array<{ value: StickyKind; label: string }> = [
	{ value: "normal", label: "Sticky común" },
	{ value: "arrow-left", label: "Señalizadora izquierda" },
	{ value: "arrow-right", label: "Señalizadora derecha" },
	{ value: "arrow-up", label: "Señalizadora arriba" },
	{ value: "arrow-down", label: "Señalizadora abajo" }
];

export type StickyNotesRuntime = {
	layerEl: HTMLDivElement | null;
	cleanup: (() => void) | null;
};

export type StickyNotesRenderContext = {
	docData: InkDocDocument | null;
	hostEl: HTMLDivElement | null;
	isToolActive: () => boolean;
	getZoomLevel: () => number;
	getAnchorOffset: () => { x: number; y: number };
	saveDebounced: () => void;
	noteActivity: () => void;
	onInteractionStateChange: (isActive: boolean) => void;
	onTextEditorChange: (editor: HTMLDivElement | null) => void;
	isToolbarInteraction: () => boolean;
};

export const createStickyNotesRuntime = (): StickyNotesRuntime => ({
	layerEl: null,
	cleanup: null
});

export const disposeStickyNotesRuntime = (runtime: StickyNotesRuntime): void => {
	if (runtime.cleanup) {
		runtime.cleanup();
		runtime.cleanup = null;
	}
	if (runtime.layerEl) {
		runtime.layerEl.remove();
		runtime.layerEl = null;
	}
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

const ensureStickyDefaults = (note: InkDocStickyNote): InkDocStickyNote => {
	note.color = typeof note.color === "string" && note.color.trim().length > 0 ? note.color : DEFAULT_STICKY_COLOR;
	note.collapsed = note.collapsed === true;
	note.locked = note.locked === true;
	note.kind =
		note.kind === "arrow-left" ||
		note.kind === "arrow-right" ||
		note.kind === "arrow-up" ||
		note.kind === "arrow-down"
			? note.kind
			: DEFAULT_STICKY_KIND;
	note.w = Math.max(INKDOC_STICKY_NOTE_MIN_WIDTH, note.w);
	note.h = Math.max(INKDOC_STICKY_NOTE_MIN_HEIGHT, note.h);
	return note;
};

export const ensureStickyNotes = (docData: InkDocDocument | null): InkDocStickyNote[] => {
	if (!docData) {
		return [];
	}
	if (!Array.isArray(docData.stickyNotes)) {
		docData.stickyNotes = [];
	}
	for (const note of docData.stickyNotes) {
		ensureStickyDefaults(note);
	}
	return docData.stickyNotes;
};

export const createStickyNoteAtPoint = (
	docData: InkDocDocument | null,
	point: { x: number; y: number }
): InkDocStickyNote | null => {
	const notes = ensureStickyNotes(docData);
	if (!docData) {
		return null;
	}
	const note: InkDocStickyNote = {
		id: createStickyNoteId(),
		x: point.x - INKDOC_STICKY_NOTE_DEFAULT_WIDTH / 2,
		y: point.y - INKDOC_STICKY_NOTE_DEFAULT_HEIGHT / 2,
		w: INKDOC_STICKY_NOTE_DEFAULT_WIDTH,
		h: INKDOC_STICKY_NOTE_DEFAULT_HEIGHT,
		text: "",
		html: "",
		color: DEFAULT_STICKY_COLOR,
		collapsed: false,
		locked: false,
		kind: DEFAULT_STICKY_KIND
	};
	notes.push(note);
	return note;
};

export const renderStickyNotesLayer = (
	runtime: StickyNotesRuntime,
	context: StickyNotesRenderContext
): void => {
	const { docData, hostEl } = context;
	if (!docData || !hostEl) {
		context.onTextEditorChange(null);
		disposeStickyNotesRuntime(runtime);
		return;
	}
	context.onTextEditorChange(null);
	if (runtime.cleanup) {
		runtime.cleanup();
		runtime.cleanup = null;
	}
	if (!runtime.layerEl || runtime.layerEl.parentElement !== hostEl) {
		runtime.layerEl?.remove();
		runtime.layerEl = hostEl.createDiv({ cls: "inkdoc-sticky-layer" });
	}
	const anchor = context.getAnchorOffset();
	const notes = ensureStickyNotes(docData);
	runtime.layerEl.empty();
	const cleanups: Array<() => void> = [];
	for (const note of notes) {
		renderStickyNote(runtime.layerEl, note, context, anchor, cleanups);
	}
	runtime.cleanup = () => {
		for (const cleanup of cleanups) {
			cleanup();
		}
	};
};

const renderStickyNote = (
	layerEl: HTMLDivElement,
	note: InkDocStickyNote,
	context: StickyNotesRenderContext,
	anchor: { x: number; y: number },
	cleanups: Array<() => void>
): void => {
	ensureStickyDefaults(note);
	const noteEl = layerEl.createDiv({ cls: "inkdoc-sticky-note" });
	noteEl.dataset.noteId = note.id;
	noteEl.tabIndex = 0;

	const menuEl = noteEl.createDiv({ cls: "inkdoc-sticky-menu" });
	const colorButton = menuEl.createEl("button", {
		cls: "inkdoc-sticky-menu-btn is-color",
		attr: { "aria-label": "Color sticky", title: "Color sticky", type: "button" }
	});
	const colorPopover = menuEl.createDiv({ cls: "inkdoc-sticky-color-popover" });
	for (const color of STICKY_COLOR_OPTIONS) {
		const swatch = colorPopover.createEl("button", {
			cls: "inkdoc-sticky-color-option",
			attr: {
				type: "button",
				"aria-label": `Color ${color}`,
				title: `Color ${color}`
			}
		});
		swatch.style.background = color;
		swatch.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (note.locked) {
				return;
			}
			note.color = color;
			updateVisualState();
			context.noteActivity();
			context.saveDebounced();
			menuController.scheduleTouchMenuHide();
		});
	}

	const eyeButton = menuEl.createEl("button", {
		cls: "inkdoc-sticky-menu-btn",
		attr: { "aria-label": "Colapsar sticky", title: "Colapsar sticky", type: "button" }
	});
	setCompatibleIcon(eyeButton, INKDOC_ICONS.EXPAND_VERTICALLY, "O");

	const lockButton = menuEl.createEl("button", {
		cls: "inkdoc-sticky-menu-btn",
		attr: { "aria-label": "Bloquear sticky", title: "Bloquear sticky", type: "button" }
	});
	setCompatibleIcon(lockButton, INKDOC_ICONS.PIN, "L");

	const settingsButton = menuEl.createEl("button", {
		cls: "inkdoc-sticky-menu-btn",
		attr: { "aria-label": "Tipo de sticky", title: "Tipo de sticky", type: "button" }
	});
	setCompatibleIcon(settingsButton, INKDOC_ICONS.GEAR, "S");
	const deleteButton = menuEl.createEl("button", {
		cls: "inkdoc-sticky-menu-btn",
		attr: { "aria-label": "Borrar sticky", title: "Borrar sticky", type: "button" }
	});
	setCompatibleIcon(deleteButton, INKDOC_ICONS.TRASH, "D");
	const kindPopover = menuEl.createDiv({ cls: "inkdoc-sticky-kind-popover" });
	for (const option of STICKY_KIND_OPTIONS) {
		const optionButton = kindPopover.createEl("button", {
			cls: "inkdoc-sticky-kind-option",
			text: option.label,
			attr: { type: "button" }
		});
		optionButton.dataset.kind = option.value;
		optionButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (note.locked) {
				return;
			}
			note.kind = option.value;
			updateVisualState();
			context.noteActivity();
			context.saveDebounced();
			menuController.scheduleTouchMenuHide();
		});
	}

	const contentEl = noteEl.createDiv({ cls: "inkdoc-sticky-content" });
	contentEl.innerHTML = note.html ?? escapeHtml(note.text ?? "");

	const editor = noteEl.createDiv({ cls: "inkdoc-sticky-editor" });
	editor.contentEditable = "true";
	editor.spellcheck = true;
	editor.innerHTML = note.html ?? escapeHtml(note.text ?? "");

	const resizeHandle = noteEl.createDiv({
		cls: "inkdoc-sticky-resize",
		attr: { "aria-label": "Redimensionar sticky", title: "Redimensionar sticky" }
	});
	resizeHandle.textContent = "↘";

	let isEditing = false;
	let isMenuVisible = false;
	let isColorMenuOpen = false;
	let isKindMenuOpen = false;

	const setMenuVisible = (value: boolean) => {
		isMenuVisible = value;
		noteEl.classList.toggle("is-menu-visible", value);
		if (!value) {
			isColorMenuOpen = false;
			isKindMenuOpen = false;
			noteEl.classList.remove("is-color-menu-open");
			noteEl.classList.remove("is-kind-menu-open");
		}
	};

	const menuController = createObjectHoverMenuController(noteEl, {
		setMenuVisible,
		isMenuStickyOpen: () => isColorMenuOpen || isKindMenuOpen || isEditing,
		isEnabled: () => context.isToolActive()
	});
	cleanups.push(() => menuController.dispose());

	noteEl.addEventListener("pointerenter", menuController.handleHostPointerEnter);
	noteEl.addEventListener("pointerleave", menuController.handleHostPointerLeave);
	noteEl.addEventListener("focusin", menuController.handleHostFocusIn);
	noteEl.addEventListener("focusout", menuController.handleHostFocusOut);

	menuEl.addEventListener("pointerdown", (event) => {
		menuController.handleMenuPointerDown();
		event.stopPropagation();
	});
	menuEl.addEventListener("pointerenter", menuController.handleMenuPointerEnter);
	menuEl.addEventListener("pointerleave", menuController.handleMenuPointerLeave);

	const syncInteractionState = () => {
		const active = isEditing;
		context.onInteractionStateChange(active);
	};

	const setEditing = (value: boolean) => {
		if (note.locked && value) {
			return;
		}
		if (note.collapsed && value) {
			return;
		}
		isEditing = value;
		noteEl.classList.toggle("is-editing", value);
		syncInteractionState();
		if (value) {
			context.onTextEditorChange(editor);
			editor.focus();
			moveCaretToEnd(editor);
		} else {
			context.onTextEditorChange(null);
			editor.blur();
		}
	};

	const setCollapsed = (value: boolean) => {
		if (note.locked) {
			return;
		}
		note.collapsed = value;
		if (value && isEditing) {
			setEditing(false);
		}
		updateVisualState();
		context.noteActivity();
		context.saveDebounced();
	};

	const setLocked = (value: boolean) => {
		note.locked = value;
		if (value && isEditing) {
			setEditing(false);
		}
		updateVisualState();
		context.noteActivity();
		context.saveDebounced();
	};

	const updateVisualState = () => {
		const color = note.color ?? DEFAULT_STICKY_COLOR;
		const kind = note.kind ?? DEFAULT_STICKY_KIND;
		noteEl.style.setProperty("--inkdoc-sticky-note-color", color);
		noteEl.classList.toggle("is-collapsed", note.collapsed === true);
		noteEl.classList.toggle("is-locked", note.locked === true);
		noteEl.classList.toggle("is-kind-arrow-left", kind === "arrow-left");
		noteEl.classList.toggle("is-kind-arrow-right", kind === "arrow-right");
		noteEl.classList.toggle("is-kind-arrow-up", kind === "arrow-up");
		noteEl.classList.toggle("is-kind-arrow-down", kind === "arrow-down");
		colorButton.style.background = color;
		setCompatibleIcon(lockButton, note.locked ? INKDOC_ICONS.FILLED_PIN : INKDOC_ICONS.PIN, "L");
		lockButton.setAttr("aria-label", note.locked ? "Desbloquear sticky" : "Bloquear sticky");
		lockButton.setAttr("title", note.locked ? "Desbloquear sticky" : "Bloquear sticky");
		eyeButton.setAttr("title", note.collapsed ? "Expandir sticky" : "Colapsar sticky");
		eyeButton.setAttr("aria-label", note.collapsed ? "Expandir sticky" : "Colapsar sticky");
		kindPopover
			.querySelectorAll<HTMLButtonElement>(".inkdoc-sticky-kind-option")
			.forEach((option) => {
				const isActive = option.dataset.kind === kind;
				option.toggleClass("is-active", isActive);
			});
		const visualHeight = note.collapsed ? COLLAPSED_STICKY_HEIGHT : Math.max(INKDOC_STICKY_NOTE_MIN_HEIGHT, note.h);
		noteEl.style.left = `${anchor.x + note.x}px`;
		noteEl.style.top = `${anchor.y + note.y}px`;
		noteEl.style.width = `${Math.max(INKDOC_STICKY_NOTE_MIN_WIDTH, note.w)}px`;
		noteEl.style.height = `${visualHeight}px`;
		resizeHandle.toggleClass("is-hidden", note.collapsed === true || note.locked === true);
	};

	colorButton.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (note.locked) {
			return;
		}
		isColorMenuOpen = !isColorMenuOpen;
		if (isColorMenuOpen) {
			isKindMenuOpen = false;
		}
		noteEl.classList.toggle("is-color-menu-open", isColorMenuOpen);
		noteEl.classList.remove("is-kind-menu-open");
		setMenuVisible(true);
		menuController.scheduleTouchMenuHide();
	});

	eyeButton.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		setCollapsed(!(note.collapsed === true));
	});

	lockButton.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		setLocked(!(note.locked === true));
		menuController.scheduleTouchMenuHide();
	});

	settingsButton.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (note.locked) {
			return;
		}
		isKindMenuOpen = !isKindMenuOpen;
		if (isKindMenuOpen) {
			isColorMenuOpen = false;
		}
		noteEl.classList.toggle("is-kind-menu-open", isKindMenuOpen);
		noteEl.classList.remove("is-color-menu-open");
		setMenuVisible(true);
		menuController.scheduleTouchMenuHide();
	});

	deleteButton.addEventListener("click", (event) => {
		if (!context.isToolActive()) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const notes = ensureStickyNotes(context.docData);
		const next = notes.filter((entry) => entry.id !== note.id);
		if (context.docData) {
			context.docData.stickyNotes = next;
		}
		setMenuVisible(false);
		menuController.clearTouchMenuHide();
		context.onTextEditorChange(null);
		context.onInteractionStateChange(false);
		noteEl.remove();
		context.noteActivity();
		context.saveDebounced();
	});

	noteEl.addEventListener("click", (event) => {
		if (!context.isToolActive()) {
			return;
		}
		const target = event.target;
		if (target instanceof HTMLElement && target.closest(".inkdoc-sticky-menu")) {
			return;
		}
		menuController.handleHostClick();
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

	editor.addEventListener("input", () => {
		note.html = editor.innerHTML;
		note.text = editor.innerText;
		contentEl.innerHTML = note.html ?? "";
		context.noteActivity();
		context.saveDebounced();
	});

	editor.addEventListener("blur", () => {
		if (context.isToolbarInteraction()) {
			editor.focus();
			return;
		}
		if (isEditing) {
			setEditing(false);
			note.html = editor.innerHTML;
			note.text = editor.innerText;
			contentEl.innerHTML = note.html ?? "";
			context.saveDebounced();
		}
	});

	editor.addEventListener("keydown", (event) => {
		context.noteActivity();
		event.stopPropagation();
		if (event.key === "Escape") {
			event.preventDefault();
			editor.blur();
		}
	});

	noteEl.addEventListener("dblclick", (event) => {
		if (!context.isToolActive()) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		setEditing(true);
	});

	noteEl.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !isEditing) {
			event.preventDefault();
			setEditing(true);
		}
		if (event.key === "Escape" && isEditing) {
			event.preventDefault();
			setEditing(false);
		}
	});

	noteEl.addEventListener("pointerdown", (event) => {
		if (event.button !== 0 || isEditing || note.locked || !context.isToolActive()) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		context.noteActivity();
		context.onInteractionStateChange(true);
		const startX = event.clientX;
		const startY = event.clientY;
		const startLeft = note.x;
		const startTop = note.y;
		const cleanup = startWindowPointerInteraction({
			onMove: (moveEvent) => {
				context.noteActivity();
				const zoom = Math.max(0.001, context.getZoomLevel());
				const dx = (moveEvent.clientX - startX) / zoom;
				const dy = (moveEvent.clientY - startY) / zoom;
				note.x = startLeft + dx;
				note.y = startTop + dy;
				noteEl.style.left = `${anchor.x + note.x}px`;
				noteEl.style.top = `${anchor.y + note.y}px`;
			},
			onEnd: () => {
				context.noteActivity();
				context.onInteractionStateChange(false);
				context.saveDebounced();
			}
		});
		cleanups.push(cleanup);
	});

	resizeHandle.addEventListener("pointerdown", (event) => {
		if (event.button !== 0 || note.locked || note.collapsed || !context.isToolActive()) {
			return;
		}
		if (isEditing) {
			setEditing(false);
		}
		event.preventDefault();
		event.stopPropagation();
		context.noteActivity();
		context.onInteractionStateChange(true);
		const startX = event.clientX;
		const startY = event.clientY;
		const startW = Math.max(INKDOC_STICKY_NOTE_MIN_WIDTH, note.w);
		const startH = Math.max(INKDOC_STICKY_NOTE_MIN_HEIGHT, note.h);
		const cleanup = startWindowPointerInteraction({
			onMove: (moveEvent) => {
				context.noteActivity();
				const zoom = Math.max(0.001, context.getZoomLevel());
				const dx = (moveEvent.clientX - startX) / zoom;
				const dy = (moveEvent.clientY - startY) / zoom;
				note.w = Math.max(INKDOC_STICKY_NOTE_MIN_WIDTH, startW + dx);
				note.h = Math.max(INKDOC_STICKY_NOTE_MIN_HEIGHT, startH + dy);
				noteEl.style.width = `${note.w}px`;
				noteEl.style.height = `${note.h}px`;
			},
			onEnd: () => {
				context.noteActivity();
				context.onInteractionStateChange(false);
				context.saveDebounced();
			}
		});
		cleanups.push(cleanup);
	});

	updateVisualState();
};
