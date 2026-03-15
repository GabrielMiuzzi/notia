// @ts-nocheck
import { ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf } from "./engines/platform/inkdocPlatform";
import type InkDocPlugin from "./main";
import type {
	InkDocDocument,
	InkDocImageBlock,
	InkDocPageBackground,
	InkDocPageColors,
	InkDocPage,
	InkDocPageSize,
	InkDocPoint,
	InkDocStroke,
	InkDocStrokeStyle,
	InkDocTextBlock
} from "./inkdoc/types";
import { INKDOC_DEFAULT_LATEX_COLOR, INKDOC_IMAGE_MIN_HEIGHT, INKDOC_IMAGE_MIN_WIDTH, INKDOC_LATEX_PALETTE, INKDOC_STROKE_COLOR, INKDOC_STROKE_WIDTH, INKDOC_TEXT_MIN_HEIGHT, INKDOC_TEXT_MIN_WIDTH, VIEW_TYPE_INKDOC, createImageBlockId, createStrokeId } from "./inkdoc/view/constants";
import type { CanvasPageState, InkDocTool, InkDocViewState } from "./inkdoc/view/constants";
import {
	resolvePageBackground,
	setPageBackgroundAttribute,
	setPageColorVariables,
	resolvePageColors,
	getContrastPageTextColor,
	DEFAULT_PAGE_BACKGROUND
} from "./inkdoc/view/backgrounds";
import { PageBackgroundModal } from "./inkdoc/view/PageBackgroundModal";
import { PagePaletteModal } from "./inkdoc/view/PagePaletteModal";
import { PageSizeModal } from "./inkdoc/view/PageSizeModal";
import { applyWikiLinksToElement } from "./inkdoc/view/wikiLinks";
import { syncInkDocWikiLinksToMetadata } from "./inkdoc/view/wikiLinkIndex";
import { PdfExportModal } from "./inkdoc/view/PdfExportModal";
import { InkMathModal } from "./inkdoc/view/InkMathModal";
import { closeInkDocToolsMenu, openInkDocToolsMenu } from "./inkdoc/view/toolsMenu";
import { closeManagedMenu, openManagedMenu } from "./inkdoc/view/contextMenus";
import { getPageSizeMm, resolvePageSize } from "./inkdoc/view/pageSizes";
import { parseInkDocRaw } from "./inkdoc/view/documentParser";
import {
	getImageFileFromDragEvent,
	hasFileDragData,
	loadImageSize,
	pickImageFile,
	readFileAsDataUrl
} from "./inkdoc/view/imageFiles";
import {
	addLatexBlock,
	addTextBlock,
	ensureImageBlocks,
	ensureTextBlocks,
	findImageBlockHit as findImageBlockHitInPage,
	findTextBlockHandleHit as findTextBlockHandleHitInPage,
	findTextBlockHit as findTextBlockHitInPage,
	findTextBlockResizeHit as findTextBlockResizeHitInPage,
	getBlockType as getTextBlockType,
	getTextBlockById as getTextBlockByIdInPage,
	isBlockCompatibleWithTool as isTextBlockCompatibleWithTool
} from "./inkdoc/view/pageBlocks";
import {
	clearSelectionForPage,
	getSelectionBoundsForPage,
	getSelectionPageIdMaps,
	hasAnySelectionMaps,
	updateSelectionFromRectMaps
} from "./inkdoc/view/selectionState";
import {
	dragSelection as dragSelectionBlocks,
	dropSelectionOnPage as dropSelectionOnPageBlocks,
	handleSelectionStart as handleSelectionStartBlocks,
	moveSelectionToPoint as moveSelectionToPointBlocks,
	type SelectionMovementContext
} from "./inkdoc/view/selectionMovement";
import {
	applyBlockStyle as applyBlockStyleToEditor,
	applyEditorCommand as applyEditorCommandToEditor,
	applyParagraphStyle as applyParagraphStyleToEditor,
	applySelectionStyle as applySelectionStyleToEditor,
	applyTextTransform as applyTextTransformToEditor,
	closeLatexEditor as closeLatexEditorInstance,
	closeTextEditor as closeTextEditorInstance,
	openLatexEditor as openLatexEditorInstance,
	openTextEditor as openTextEditorInstance,
	type ActiveBlockEdit,
	type TextEditingAccessors,
	type TextEditingContext
} from "./inkdoc/view/textEditing";
import { getRectFromPoints, pointInRect, strokeHitsPoint } from "./inkdoc/view/geometry";
import {
	resolveInkDocStrokeStyle
} from "./inkdoc/view/strokeStyles";
import { BrushRegistry, type BrushPreset } from "./inkdoc/view/brushRegistry";
import { InputController, type PointerSample } from "./inkdoc/view/InputController";
import {
	drawBrushPreview,
	renderStrokeWithBrush,
	resolveStrokeRenderWidth,
	type StrokeRenderOptions
} from "./inkdoc/view/strokeRenderers";
import { stabilizePoint } from "./inkdoc/view/strokeSmoothing";
import { setCompatibleIcon, setLegacyIcon, type LegacyIconName } from "./inkdoc/view/iconFallback";
import { DocumentSyncEngine } from "./inkdoc/view/documentSyncEngine";
import {
	createStickyNoteAtPoint,
	createStickyNotesRuntime,
	disposeStickyNotesRuntime,
	renderStickyNotesLayer,
	type StickyNotesRuntime
} from "./inkdoc/view/stickyNotes";
import {
	createObjectHoverMenuController,
	startWindowPointerInteraction
} from "./inkdoc/view/objectBehavior";
import {
	confirmObjectCreation as openObjectCreationPrompt,
	type InkDocCreatableObject
} from "./inkdoc/view/objectCreationPrompt";
import { createInkDocSubmenuEngine, type InkDocSubmenuEngine } from "./inkdoc/view/submenuEngine";
import type { MarkdownWikiLinkTarget } from "../../types/views/markdownWikiLink";

type InkDocPencilSubmenu = "brushes" | "stroke" | "colors" | "stylus";
type InkDocTextSubmenu = "format" | "font" | "colors" | "paragraph" | "insert";
type InkDocLatexSubmenu = "colors";

export class InkDocView extends ItemView {
	private plugin: InkDocPlugin;
	private file: TFile | null = null;
	private toolbarEl: HTMLDivElement | null = null;
	private pagesEl: HTMLDivElement | null = null;
	private pagesContentEl: HTMLDivElement | null = null;
	private docData: InkDocDocument | null = null;
	private lastSavedContent: string | null = null;
	private saveDebounced: () => void;
	private syncEngine: DocumentSyncEngine;
	private activeTool: InkDocTool = "pen";
	private strokeWidth = INKDOC_STROKE_WIDTH;
	private strokeStyle: InkDocStrokeStyle = "solid";
	private strokeColor = INKDOC_STROKE_COLOR;
	private strokeOpacity = 1;
	private strokeSmoothing = 0.35;
	private strokeStabilizer = 0.75;
	private isStrokeStabilizationEnabled = true;
	private isStylusDynamicsEnabled = true;
	private brushRegistry = new BrushRegistry();
	private activeBrushId = "monoline";
	private stylusAvailable = false;
	private strokeEraserMode: "point" | "stroke" = "point";
	private recentStrokeColors: string[] = [];
	private readonly strokePaletteColors: string[] = [
		"#000000",
		"#3b3b3b",
		"#ff2d2d",
		"#ff7a00",
		"#ffd400",
		"#2ecc71",
		"#2aa9ff",
		"#6c5ce7",
		"#1abc9c",
		"#00cec9",
		"#fd79a8",
		"#ffffff"
	];
	private canvasStates = new Map<string, CanvasPageState>();
	private canvasCleanups = new Map<string, () => void>();
	private pencilMenuEl: HTMLDivElement | null = null;
	private pencilSubmenuEngine: InkDocSubmenuEngine | null = null;
	private activePencilSubmenu: InkDocPencilSubmenu | null = null;
	private selectedStrokes = new Map<string, Set<string>>();
	private selectedTextBlocks = new Map<string, Set<string>>();
	private selectedImages = new Map<string, Set<string>>();
	private textEditorEl: HTMLDivElement | null = null;
	private stickyTextEditorEl: HTMLDivElement | null = null;
	private textMenuEl: HTMLDivElement | null = null;
	private textSubmenuEngine: InkDocSubmenuEngine | null = null;
	private activeTextSubmenu: InkDocTextSubmenu | null = null;
	private latexMenuEl: HTMLDivElement | null = null;
	private latexSubmenuEngine: InkDocSubmenuEngine | null = null;
	private activeLatexSubmenu: InkDocLatexSubmenu | null = null;
	private isTextToolbarInteraction = false;
	private latexColor = INKDOC_DEFAULT_LATEX_COLOR;
	private textLayerByPage = new Map<string, HTMLDivElement>();
	private textLayerDirty = new Set<string>();
	private imageLayerByPage = new Map<string, HTMLDivElement>();
	private imageLayerDirty = new Set<string>();
	private stickyNotesRuntime: StickyNotesRuntime = createStickyNotesRuntime();
	private isStickyNoteInteracting = false;
	private pendingPageRenders = new Map<string, number>();
	private pendingPageRenderQuality = new Map<string, "full" | "fast">();
	private latexEditorEl: HTMLTextAreaElement | null = null;
	private activeLatexEdit: ActiveBlockEdit | null = null;
	private imagePointerCleanup: (() => void) | null = null;
	private zoomLevel = 1;
	private isPanning = false;
	private panStart: { x: number; y: number } | null = null;
	private panScrollStart: { left: number; top: number } | null = null;
	private activeTextEdit: ActiveBlockEdit | null = null;
	private isMobileFastRenderEnabled = Boolean(window.matchMedia?.("(pointer: coarse)")?.matches);
	private isLowLatencyModeEnabled = false;
	private isObjectCreationPromptOpen = false;
	private toolbarDragCreateCleanup: (() => void) | null = null;
	private toolbarDragCreateSession: {
		tool: InkDocCreatableObject;
		pointerId: number;
		startX: number;
		startY: number;
	} | null = null;
	private pendingObjectCreationClick: {
		tool: InkDocCreatableObject;
		pageId: string;
		point: InkDocPoint;
		atMs: number;
	} | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: InkDocPlugin) {
		super(leaf);
		this.plugin = plugin;
		const initial = this.getActiveBrushPreset();
		this.strokeWidth = initial.defaultWidth;
		this.strokeOpacity = initial.defaultOpacity;
		this.strokeStyle = initial.style;
		this.strokeSmoothing = initial.smoothing;
		this.strokeStabilizer = initial.stabilizer;
		this.recentStrokeColors = this.createRandomRecentStrokeColors(12);
		this.syncEngine = new DocumentSyncEngine({
			debounceMs: this.plugin.getSyncDebounceMs(),
			minimumSaveIdleMs: 1000,
			isInteractionActive: () => this.hasActiveInteraction(),
			save: () => this.saveToFile(),
			reload: () => this.loadAndRender()
		});
		this.saveDebounced = () => {
			this.syncEngine.requestSaveAfterActivity();
		};
	}

	public setSyncDebounceMs(value: number): void {
		this.syncEngine.setDebounceMs(value);
	}

	getViewType(): string {
		return VIEW_TYPE_INKDOC;
	}

	getDisplayText(): string {
		return "InkDoc";
	}

	getIcon(): string {
		return "file-text";
	}

	async onOpen() {
		this.buildLayout();
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!this.file || file.path !== this.file.path) {
					return;
				}
				this.syncEngine.onVaultModify();
			})
		);
	}

	async onClose() {
		await this.saveToFile();
		this.syncEngine.dispose();
		if (this.imagePointerCleanup) {
			this.imagePointerCleanup();
			this.imagePointerCleanup = null;
		}
		if (this.toolbarDragCreateCleanup) {
			this.toolbarDragCreateCleanup();
			this.toolbarDragCreateCleanup = null;
		}
		this.toolbarDragCreateSession = null;
		this.pencilSubmenuEngine?.dispose();
		this.pencilSubmenuEngine = null;
		this.textSubmenuEngine?.dispose();
		this.textSubmenuEngine = null;
		this.latexSubmenuEngine?.dispose();
		this.latexSubmenuEngine = null;
		this.closeTextBlockMenu();
		this.closeImageBlockMenu();
		closeInkDocToolsMenu(this.contentEl);
		this.closeTextEditor(false);
		this.closeLatexEditor(false);
		this.stickyTextEditorEl = null;
		this.disposeCanvases();
		disposeStickyNotesRuntime(this.stickyNotesRuntime);
		this.contentEl.empty();
	}

	getState(): InkDocViewState {
		return {
			file: this.file?.path
		};
	}

	async setState(state: InkDocViewState): Promise<void> {
		if (state.file) {
			const abstractFile = this.app.vault.getAbstractFileByPath(state.file);
			if (abstractFile instanceof TFile) {
				this.file = abstractFile;
				await this.loadAndRender();
				return;
			}
		}
		this.renderError("No se pudo abrir el archivo InkDoc.");
	}

	private buildLayout(): void {
		this.contentEl.empty();
		const root = this.contentEl.createDiv({ cls: "inkdoc-view" });
		this.toolbarEl = root.createDiv({ cls: "inkdoc-toolbar" });
		const pencilButton = this.toolbarEl.createEl("button", {
			cls: "inkdoc-toolbar-icon",
			attr: { "aria-label": "Lápiz", title: "Lápiz" }
		});
		const pencilIcon = pencilButton.createSpan({ cls: "inkdoc-toolbar-icon-glyph" });
		setCompatibleIcon(pencilIcon, "pencil", "P");
		pencilButton.dataset.tool = "pen";
		pencilButton.addEventListener("click", () => {
			this.setActiveTool("pen");
			this.updatePencilMenuVisibility();
		});

		const handButton = this.toolbarEl.createEl("button", {
			cls: "inkdoc-toolbar-icon",
			attr: { "aria-label": "Mano", title: "Mano" }
		});
		const handIcon = handButton.createSpan({ cls: "inkdoc-toolbar-icon-glyph" });
		setCompatibleIcon(handIcon, "hand", "H");
		handButton.dataset.tool = "hand";
		handButton.addEventListener("click", () => {
			this.setActiveTool("hand");
			this.closePencilMenu();
		});

		const textButton = this.toolbarEl.createEl("button", {
			cls: "inkdoc-toolbar-icon",
			attr: { "aria-label": "Texto", title: "Texto" }
		});
		textButton.dataset.tool = "text";
		const textIcon = textButton.createSpan({ cls: "inkdoc-toolbar-icon-glyph" });
		setCompatibleIcon(textIcon, "type", "T");
		this.registerToolbarDragCreate(textButton, "text");
		textButton.addEventListener("click", () => {
			this.setActiveTool("text");
			this.closePencilMenu();
		});

		const latexButton = this.toolbarEl.createEl("button", {
			cls: "inkdoc-toolbar-icon",
			attr: { "aria-label": "LaTeX", title: "LaTeX" }
		});
		const latexIcon = latexButton.createSpan({ cls: "inkdoc-toolbar-icon-glyph" });
		setCompatibleIcon(latexIcon, "sigma", "Σ");
		latexButton.dataset.tool = "latex";
		this.registerToolbarDragCreate(latexButton, "latex");
		latexButton.addEventListener("click", () => {
			this.setActiveTool("latex");
			this.closePencilMenu();
		});

		const selectButton = this.toolbarEl.createEl("button", {
			cls: "inkdoc-toolbar-icon",
			attr: { "aria-label": "Seleccionar", title: "Seleccionar" }
		});
		const selectIcon = selectButton.createSpan({ cls: "inkdoc-toolbar-icon-glyph" });
		setCompatibleIcon(selectIcon, "mouse-pointer-2", "S");
		selectButton.dataset.tool = "select";
		selectButton.addEventListener("click", () => {
			this.setActiveTool("select");
			this.closePencilMenu();
		});

		const imageButton = this.toolbarEl.createEl("button", {
			cls: "inkdoc-toolbar-icon",
			attr: { "aria-label": "Imagen", title: "Imagen" }
		});
		const imageIcon = imageButton.createSpan({ cls: "inkdoc-toolbar-icon-glyph" });
		setCompatibleIcon(imageIcon, "image", "I");
		imageButton.dataset.tool = "image";
		this.registerToolbarDragCreate(imageButton, "image");
		imageButton.addEventListener("click", () => {
			this.setActiveTool("image");
			this.closePencilMenu();
		});
		const stickyButton = this.toolbarEl.createEl("button", {
			cls: "inkdoc-toolbar-icon",
			attr: { "aria-label": "Sticky note", title: "Sticky note" }
		});
		stickyButton.dataset.tool = "sticky";
		const stickyIcon = stickyButton.createSpan({ cls: "inkdoc-toolbar-icon-glyph" });
		setCompatibleIcon(stickyIcon, "sticky-note", "N");
		this.registerToolbarDragCreate(stickyButton, "sticky");
		stickyButton.addEventListener("click", () => {
			this.setActiveTool("sticky");
			this.closePencilMenu();
		});

		const menuButton = this.toolbarEl.createEl("button", {
			cls: "inkdoc-toolbar-icon inkdoc-toolbar-menu-toggle",
			attr: { "aria-label": "Más opciones", title: "Más opciones" }
		});
		const menuIcon = menuButton.createSpan({ cls: "inkdoc-toolbar-icon-glyph" });
		setCompatibleIcon(menuIcon, "menu", "☰");
		menuButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			openInkDocToolsMenu(this.app, menuButton, () => {
				if (!this.docData) {
					new Notice("No hay documento para exportar.");
					return;
				}
				new PdfExportModal(this.app, this.docData, this.file).open();
			});
		});

		this.updateToolButtons();

		this.pagesEl = root.createDiv({ cls: "inkdoc-pages" });
		this.pagesContentEl = this.pagesEl.createDiv({ cls: "inkdoc-pages-content" });
		this.updateZoom();
			this.registerDomEvent(
				this.pagesEl,
				"wheel",
				(event: WheelEvent) => {
					if (this.activeTool !== "hand" || !event.ctrlKey) {
						return;
					}
					event.preventDefault();
				const target = this.pagesEl;
				const content = this.pagesContentEl;
			if (!target || !content) {
				return;
			}
			const rect = target.getBoundingClientRect();
			const pointerX = event.clientX - rect.left;
			const pointerY = event.clientY - rect.top;
			const startZoom = this.zoomLevel;
			const direction = event.deltaY > 0 ? -1 : 1;
			const nextZoom = this.clampZoom(startZoom * (direction > 0 ? 1.1 : 0.9));
			if (nextZoom === startZoom) {
				return;
			}
			const contentX = (target.scrollLeft + pointerX) / startZoom;
			const contentY = (target.scrollTop + pointerY) / startZoom;
			this.zoomLevel = nextZoom;
			this.updateZoom();
				target.scrollLeft = contentX * nextZoom - pointerX;
				target.scrollTop = contentY * nextZoom - pointerY;
			},
			{ passive: false }
		);
		this.registerDomEvent(this.pagesEl, "pointerdown", (event: PointerEvent) => {
			if (this.activeTool !== "sticky" || event.button !== 0) {
				return;
			}
			const target = event.target;
			if (target instanceof HTMLElement && target.closest(".inkdoc-sticky-note")) {
				return;
			}
			const hadStickyInteraction = Boolean(this.stickyTextEditorEl) || this.isStickyNoteInteracting;
			if (hadStickyInteraction) {
				this.stickyTextEditorEl?.blur();
				this.stickyTextEditorEl = null;
				this.isStickyNoteInteracting = false;
				this.renderStickyNotes();
				return;
			}
			const point = this.getClientPointOnPagesContent(event.clientX, event.clientY);
			if (!point) {
				return;
			}
			if (!this.shouldConfirmObjectCreationOnClick("sticky", "sticky-layer", point)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			void this.confirmAndCreateStickyNote(point);
		});
		this.registerDomEvent(this.pagesEl, "pointerdown", (event: PointerEvent) => {
			if (this.activeTool !== "hand" || event.button !== 0 || !this.pagesEl) {
				return;
			}
			this.isPanning = true;
			this.panStart = { x: event.clientX, y: event.clientY };
			this.panScrollStart = { left: this.pagesEl.scrollLeft, top: this.pagesEl.scrollTop };
			this.pagesEl.classList.add("is-panning");
			this.pagesEl.setPointerCapture(event.pointerId);
			event.preventDefault();
		});
		this.registerDomEvent(this.pagesEl, "pointermove", (event: PointerEvent) => {
			if (!this.isPanning || !this.panStart || !this.panScrollStart || !this.pagesEl) {
				return;
			}
			const dx = event.clientX - this.panStart.x;
			const dy = event.clientY - this.panStart.y;
			this.pagesEl.scrollLeft = this.panScrollStart.left - dx;
			this.pagesEl.scrollTop = this.panScrollStart.top - dy;
		});
		this.registerDomEvent(this.pagesEl, "pointerup", (event: PointerEvent) => {
			if (!this.isPanning || !this.pagesEl) {
				return;
			}
			this.isPanning = false;
			this.panStart = null;
			this.panScrollStart = null;
			this.pagesEl.classList.remove("is-panning");
			this.pagesEl.releasePointerCapture(event.pointerId);
		});
		this.registerDomEvent(this.pagesEl, "pointercancel", (event: PointerEvent) => {
			if (!this.isPanning || !this.pagesEl) {
				return;
			}
			this.isPanning = false;
			this.panStart = null;
			this.panScrollStart = null;
			this.pagesEl.classList.remove("is-panning");
			this.pagesEl.releasePointerCapture(event.pointerId);
		});
		this.registerDomEvent(window, "resize", () => {
			if (!this.pencilMenuEl) {
				this.renderStickyNotes();
				return;
			}
			window.requestAnimationFrame(() => {
				this.updatePencilMenuUI();
				this.updateLatexToolbarUI();
				this.renderStickyNotes();
			});
		});
		this.registerDomEvent(window, "mousedown", (event: MouseEvent) => {
			if (!this.pencilSubmenuEngine || !this.pencilSubmenuEngine.getActive()) {
				return;
			}
			const target = event.target;
			if (!(target instanceof Node) || this.pencilSubmenuEngine.containsTarget(target)) {
				return;
			}
			this.setActivePencilSubmenu(null);
		}, { capture: true });
		this.registerDomEvent(window, "mousedown", (event: MouseEvent) => {
			if (!this.textSubmenuEngine || !this.textSubmenuEngine.getActive()) {
				return;
			}
			const target = event.target;
			if (!(target instanceof Node) || this.textSubmenuEngine.containsTarget(target)) {
				return;
			}
			this.setActiveTextSubmenu(null);
		}, { capture: true });
		this.registerDomEvent(window, "keydown", (event: KeyboardEvent) => {
			if (event.key === "Escape" && this.activePencilSubmenu) {
				this.setActivePencilSubmenu(null);
			}
		});
		this.registerDomEvent(window, "keydown", (event: KeyboardEvent) => {
			if (event.key === "Escape" && this.activeTextSubmenu) {
				this.setActiveTextSubmenu(null);
			}
		});
		this.registerDomEvent(window, "mousedown", (event: MouseEvent) => {
			if (!this.latexSubmenuEngine || !this.latexSubmenuEngine.getActive()) {
				return;
			}
			const target = event.target;
			if (!(target instanceof Node) || this.latexSubmenuEngine.containsTarget(target)) {
				return;
			}
			this.setActiveLatexSubmenu(null);
		}, { capture: true });
		this.registerDomEvent(window, "keydown", (event: KeyboardEvent) => {
			if (event.key === "Escape" && this.activeLatexSubmenu) {
				this.setActiveLatexSubmenu(null);
			}
		});
		this.updateTextToolbarVisibility();
		this.updateLatexToolbarUI();
		this.buildPencilMenu(root);
		this.buildTextMenu(root);
		this.buildLatexMenu(root);
	}

	private buildPencilMenu(root: HTMLDivElement): void {
		const menu = root.createDiv({ cls: "inkdoc-pencil-floating" });
		menu.setAttr("aria-hidden", "true");
		this.pencilMenuEl = menu;
		this.pencilSubmenuEngine?.dispose();
		this.pencilSubmenuEngine = createInkDocSubmenuEngine(menu);
		this.activePencilSubmenu = null;

		const rail = menu.createDiv({ cls: "inkdoc-pencil-fab-rail" });
		const createRailButton = (
			submenu: InkDocPencilSubmenu,
			label: string,
			icon: string,
			fallback: string
		): HTMLButtonElement => {
			const button = rail.createEl("button", {
				cls: "inkdoc-pencil-fab",
				attr: { "aria-label": label, title: label }
			});
			button.dataset.pencilSubmenuTrigger = submenu;
			const glyph = button.createSpan({ cls: "inkdoc-pencil-fab-glyph" });
			setCompatibleIcon(glyph, icon, fallback);
			return button;
		};

		const brushesToggle = createRailButton("brushes", "Brushes", "pencil", "P");
		brushesToggle.addEventListener("click", () => this.togglePencilSubmenu("brushes"));

		const eraserQuickButton = rail.createEl("button", {
			cls: "inkdoc-pencil-fab",
			attr: { "aria-label": "Borrador rápido", title: "Borrador rápido" }
		});
		eraserQuickButton.dataset.role = "quick-eraser";
		const eraserQuickGlyph = eraserQuickButton.createSpan({ cls: "inkdoc-pencil-fab-glyph" });
		setCompatibleIcon(eraserQuickGlyph, "eraser", "E");
		eraserQuickButton.addEventListener("click", () => {
			this.setActiveBrush("eraser");
			this.setActivePencilSubmenu(null);
		});

		const strokeToggle = createRailButton("stroke", "Tamaño de trazo", "stretch-vertical", "R");
		strokeToggle.addEventListener("click", () => this.togglePencilSubmenu("stroke"));

		const colorsToggle = createRailButton("colors", "Paleta de color", "palette", "C");
		colorsToggle.addEventListener("click", () => this.togglePencilSubmenu("colors"));

		const settingsToggle = createRailButton("stylus", "Configuración de stylus", "settings", "S");
		settingsToggle.addEventListener("click", () => this.togglePencilSubmenu("stylus"));

		const flyouts = menu.createDiv({ cls: "inkdoc-pencil-flyouts" });

		const brushFlyout = flyouts.createDiv({
			cls: "inkdoc-pencil-flyout",
			attr: { "data-pencil-submenu": "brushes" }
		});
		const brushSection = brushFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-card-brushes" });
		brushSection.createDiv({ cls: "inkdoc-pencil-card-title", text: "Brushes" });
		const brushToolbar = brushSection.createDiv({ cls: "inkdoc-brush-toolbar" });
		const brushList = this.brushRegistry.list();
		const prioritized = ["monoline", "sketch-pro", "ink-pro", "shade-pro", "eraser"];
		const orderedBrushes = [
			...prioritized
				.map((id) => brushList.find((preset) => preset.id === id))
				.filter((preset): preset is BrushPreset => Boolean(preset)),
			...brushList.filter((preset) => !prioritized.includes(preset.id))
		];
		orderedBrushes.forEach((preset) => {
			const button = brushToolbar.createEl("button", {
				cls: "inkdoc-brush-button",
				attr: { "aria-label": preset.label, title: preset.label }
			});
			button.dataset.brushId = preset.id;
			const preview = button.createEl("canvas", { cls: "inkdoc-brush-button-preview" });
			preview.dataset.role = "brush-preset-preview";
			preview.width = 96;
			preview.height = 24;
			const meta = button.createDiv({ cls: "inkdoc-brush-button-meta" });
			const brushIcon = meta.createSpan({ cls: "inkdoc-brush-button-icon" });
			setLegacyIcon(brushIcon, this.getBrushIconName(preset.id));
			meta.createEl("span", { cls: "inkdoc-brush-button-label", text: preset.label });
			button.addEventListener("click", () => {
				this.setActiveBrush(preset.id);
			});
		});
		const brushStyleCard = brushFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-subcard" });
		brushStyleCard.createDiv({ cls: "inkdoc-pencil-subtitle", text: "Tipo de trazo" });
		const stylePresets = brushStyleCard.createDiv({ cls: "inkdoc-pencil-presets inkdoc-pencil-style-presets" });
		const styleOptions: Array<{ value: InkDocStrokeStyle; label: string }> = [
			{ value: "solid", label: "Continuo" },
			{ value: "dotted", label: "Punteado" },
			{ value: "dashed", label: "Líneas" }
		];
		styleOptions.forEach((option) => {
			const button = stylePresets.createEl("button", {
				cls: "inkdoc-pencil-preset",
				text: option.label
			});
			button.dataset.role = "stroke-style";
			button.dataset.style = option.value;
			button.addEventListener("click", () => {
				this.setStrokeStyle(option.value);
			});
		});
		const brushDynamicsCard = brushFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-subcard" });
		brushDynamicsCard.createDiv({ cls: "inkdoc-pencil-subtitle", text: "Dinámica" });
		const brushOpacityRow = brushDynamicsCard.createDiv({ cls: "inkdoc-pencil-slider-row" });
		brushOpacityRow.createEl("span", { text: "Opacidad", cls: "inkdoc-pencil-label" });
		const brushOpacitySlider = brushOpacityRow.createEl("input", {
			cls: "inkdoc-pencil-slider",
			type: "range"
		});
		brushOpacitySlider.min = "0.05";
		brushOpacitySlider.max = "1";
		brushOpacitySlider.step = "0.01";
		brushOpacitySlider.dataset.role = "opacity-slider";
		brushOpacitySlider.value = String(this.strokeOpacity);
		brushOpacitySlider.addEventListener("input", () => {
			const value = Number(brushOpacitySlider.value);
			if (Number.isFinite(value)) {
				this.setStrokeOpacity(value);
			}
		});
		const brushSmoothingRow = brushDynamicsCard.createDiv({ cls: "inkdoc-pencil-slider-row" });
		brushSmoothingRow.createEl("span", { text: "Suavizado", cls: "inkdoc-pencil-label" });
		const brushSmoothingSlider = brushSmoothingRow.createEl("input", {
			cls: "inkdoc-pencil-slider",
			type: "range"
		});
		brushSmoothingSlider.min = "0";
		brushSmoothingSlider.max = "1";
		brushSmoothingSlider.step = "0.01";
		brushSmoothingSlider.dataset.role = "smoothing-slider";
		brushSmoothingSlider.value = String(this.strokeSmoothing);
		brushSmoothingSlider.addEventListener("input", () => {
			const value = Number(brushSmoothingSlider.value);
			if (Number.isFinite(value)) {
				this.setStrokeSmoothing(value);
			}
		});
		const proDynamicsCard = brushFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-subcard" });
		proDynamicsCard.createDiv({ cls: "inkdoc-pencil-subtitle", text: "Ajuste Pro (brush activo)" });
		const pressureResponseRow = proDynamicsCard.createDiv({ cls: "inkdoc-pencil-slider-row" });
		pressureResponseRow.createEl("span", { text: "Curva presión", cls: "inkdoc-pencil-label" });
		const pressureResponseSlider = pressureResponseRow.createEl("input", {
			cls: "inkdoc-pencil-slider",
			type: "range"
		});
		pressureResponseSlider.min = "0.35";
		pressureResponseSlider.max = "1.3";
		pressureResponseSlider.step = "0.01";
		pressureResponseSlider.dataset.role = "pro-pressure-response";
		pressureResponseSlider.addEventListener("input", () => {
			const value = Number(pressureResponseSlider.value);
			if (Number.isFinite(value)) {
				this.updateActiveBrushDynamics({ pressureResponse: value });
			}
		});
		const velocityRow = proDynamicsCard.createDiv({ cls: "inkdoc-pencil-slider-row" });
		velocityRow.createEl("span", { text: "Velocidad", cls: "inkdoc-pencil-label" });
		const velocitySlider = velocityRow.createEl("input", {
			cls: "inkdoc-pencil-slider",
			type: "range"
		});
		velocitySlider.min = "0";
		velocitySlider.max = "1";
		velocitySlider.step = "0.01";
		velocitySlider.dataset.role = "pro-velocity-influence";
		velocitySlider.addEventListener("input", () => {
			const value = Number(velocitySlider.value);
			if (Number.isFinite(value)) {
				this.updateActiveBrushDynamics({ velocityInfluence: value });
			}
		});
		const taperRow = proDynamicsCard.createDiv({ cls: "inkdoc-pencil-slider-row" });
		taperRow.createEl("span", { text: "Taper", cls: "inkdoc-pencil-label" });
		const taperSlider = taperRow.createEl("input", {
			cls: "inkdoc-pencil-slider",
			type: "range"
		});
		taperSlider.min = "0";
		taperSlider.max = "1";
		taperSlider.step = "0.01";
		taperSlider.dataset.role = "pro-taper-strength";
		taperSlider.addEventListener("input", () => {
			const value = Number(taperSlider.value);
			if (Number.isFinite(value)) {
				this.updateActiveBrushDynamics({ taperStrength: value });
			}
		});

		const strokeFlyout = flyouts.createDiv({
			cls: "inkdoc-pencil-flyout",
			attr: { "data-pencil-submenu": "stroke" }
		});
		const strokePanel = strokeFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-panel-card" });
		strokePanel.createDiv({ cls: "inkdoc-pencil-card-title", text: "Tamaño de trazo" });

		const strokeCard = strokePanel.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-subcard inkdoc-pencil-panel" });
		strokeCard.createDiv({ cls: "inkdoc-pencil-subtitle", text: "Tamaños predefinidos" });
		const presets = strokeCard.createDiv({ cls: "inkdoc-pencil-presets" });
		const presetValues = [1, 2, 4, 8];
		presetValues.forEach((value) => {
			const button = presets.createEl("button", {
				cls: "inkdoc-pencil-preset inkdoc-pencil-size-preset",
				text: `${value}`
			});
			button.dataset.value = String(value);
			button.addEventListener("click", () => {
				this.setStrokeWidth(value);
			});
		});

		const slidersCard = strokePanel.createDiv({
			cls: "inkdoc-pencil-card inkdoc-pencil-main inkdoc-pencil-subcard inkdoc-pencil-panel"
		});
		slidersCard.createDiv({ cls: "inkdoc-pencil-subtitle", text: "Dinámica" });
		const sliderRow = slidersCard.createDiv({ cls: "inkdoc-pencil-slider-row" });
		sliderRow.createEl("span", { text: "Grosor", cls: "inkdoc-pencil-label" });
		const slider = sliderRow.createEl("input", {
			cls: "inkdoc-pencil-slider",
			type: "range"
		});
		slider.min = "1";
		slider.max = "12";
		slider.step = "1";
		slider.value = String(this.strokeWidth);
		slider.addEventListener("input", () => {
			const value = Number(slider.value);
			if (Number.isFinite(value)) {
				this.setStrokeWidth(value);
			}
		});

		const colorsFlyout = flyouts.createDiv({
			cls: "inkdoc-pencil-flyout",
			attr: { "data-pencil-submenu": "colors" }
		});
		const colorsTop = colorsFlyout.createDiv({ cls: "inkdoc-pencil-colors-top" });
		const palettesColumn = colorsTop.createDiv({ cls: "inkdoc-pencil-colors-column" });
		const paletteCard = palettesColumn.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-color-card" });
		paletteCard.createDiv({ cls: "inkdoc-pencil-subtitle", text: "Colores" });
		const palette = paletteCard.createDiv({ cls: "inkdoc-pencil-palette" });
		this.strokePaletteColors.forEach((color) => {
			const swatch = palette.createEl("button", { cls: "inkdoc-color-swatch" });
			swatch.style.background = color;
			swatch.dataset.color = color;
			swatch.addEventListener("click", () => {
				this.setStrokeColor(color);
			});
		});
		const recentCard = palettesColumn.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-color-card" });
		recentCard.createDiv({ cls: "inkdoc-pencil-subtitle", text: "Colores previos" });
		const recent = recentCard.createDiv({
			cls: "inkdoc-pencil-palette inkdoc-pencil-palette-recent"
		});
		recent.dataset.role = "recent-swatches";

		const rgbCard = colorsTop.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-rgb-card" });
		rgbCard.createDiv({ cls: "inkdoc-pencil-subtitle", text: "RGB" });
		const rgbContent = rgbCard.createDiv({ cls: "inkdoc-pencil-rgb-content" });
		const rgb = rgbContent.createDiv({ cls: "inkdoc-pencil-rgb" });
		const rInput = this.createRgbInput(rgb, "R");
		const gInput = this.createRgbInput(rgb, "G");
		const bInput = this.createRgbInput(rgb, "B");
		const colorPreview = rgbContent.createDiv({ cls: "inkdoc-pencil-preview-color" });
		colorPreview.dataset.role = "color-preview";

		const handleRgbChange = () => {
			const r = Number(rInput.value);
			const g = Number(gInput.value);
			const b = Number(bInput.value);
			if ([r, g, b].every((v) => Number.isFinite(v))) {
				this.setStrokeColor(`rgb(${r}, ${g}, ${b})`);
			}
		};
		rInput.addEventListener("input", handleRgbChange);
		gInput.addEventListener("input", handleRgbChange);
		bInput.addEventListener("input", handleRgbChange);

		const stylusFlyout = flyouts.createDiv({
			cls: "inkdoc-pencil-flyout",
			attr: { "data-pencil-submenu": "stylus" }
		});
		const stylusCard = stylusFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-panel-card" });
		stylusCard.createDiv({ cls: "inkdoc-pencil-card-title", text: "Configuración de stylus" });
		const stylusInfoCard = stylusCard.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-subcard" });
		const stylusBadge = stylusInfoCard.createDiv({ cls: "inkdoc-stylus-badge", text: "Stylus: no" });
		stylusBadge.dataset.role = "stylus-badge";
		const stylusCapabilities = stylusInfoCard.createDiv({
			cls: "inkdoc-stylus-capabilities",
			text: "Pressure/Tilt: desactivado"
		});
		stylusCapabilities.dataset.role = "stylus-capabilities";

		const stylusControls = stylusCard.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-subcard" });
		stylusControls.createDiv({ cls: "inkdoc-pencil-subtitle", text: "Pressure/Tilt y render" });
		const stylusControlRow = stylusControls.createDiv({ cls: "inkdoc-pencil-advanced-row" });
		const stabilizationToggle = stylusControlRow.createEl("button", {
			cls: "inkdoc-pencil-chip",
			text: "Estabilización: ON"
		});
		stabilizationToggle.dataset.role = "stabilization-toggle";
		stabilizationToggle.addEventListener("click", () => {
			this.isStrokeStabilizationEnabled = !this.isStrokeStabilizationEnabled;
			this.updatePencilMenuUI();
		});
		const stylusDynamicsButton = stylusControlRow.createEl("button", {
			cls: "inkdoc-pencil-chip",
			text: "Stylus dinámico: ON"
		});
		stylusDynamicsButton.dataset.role = "stylus-dynamics-toggle";
		stylusDynamicsButton.addEventListener("click", () => {
			this.isStylusDynamicsEnabled = !this.isStylusDynamicsEnabled;
			this.updatePencilMenuUI();
			this.renderAllCanvases();
		});
		const fastRenderToggle = stylusControlRow.createEl("button", {
			cls: "inkdoc-pencil-chip",
			text: "Fast render: OFF"
		});
		fastRenderToggle.dataset.role = "fast-render-toggle";
		fastRenderToggle.addEventListener("click", () => {
			this.isMobileFastRenderEnabled = !this.isMobileFastRenderEnabled;
			this.updatePencilMenuUI();
			this.renderAllCanvases();
		});
		const lowLatencyToggle = stylusControlRow.createEl("button", {
			cls: "inkdoc-pencil-chip",
			text: "Baja latencia: OFF"
		});
		lowLatencyToggle.dataset.role = "low-latency-toggle";
		lowLatencyToggle.addEventListener("click", () => {
			this.isLowLatencyModeEnabled = !this.isLowLatencyModeEnabled;
			this.updatePencilMenuUI();
			this.renderAllCanvases();
		});
		const stabilizerRow = stylusControls.createDiv({ cls: "inkdoc-pencil-slider-row" });
		stabilizerRow.createEl("span", { text: "Estabilizador", cls: "inkdoc-pencil-label" });
		const stabilizerSlider = stabilizerRow.createEl("input", {
			cls: "inkdoc-pencil-slider",
			type: "range"
		});
		stabilizerSlider.min = "0";
		stabilizerSlider.max = "1";
		stabilizerSlider.step = "0.01";
		stabilizerSlider.dataset.role = "stabilizer-slider";
		stabilizerSlider.value = String(this.strokeStabilizer);
		stabilizerSlider.addEventListener("input", () => {
			const value = Number(stabilizerSlider.value);
			if (Number.isFinite(value)) {
				this.setStrokeStabilizer(value);
			}
		});

		this.pencilSubmenuEngine.register("brushes", brushesToggle, brushFlyout);
		this.pencilSubmenuEngine.register("stroke", strokeToggle, strokeFlyout);
		this.pencilSubmenuEngine.register("colors", colorsToggle, colorsFlyout);
		this.pencilSubmenuEngine.register("stylus", settingsToggle, stylusFlyout);

		this.setActivePencilSubmenu(null);
		this.updatePencilMenuUI();
		this.updatePencilMenuVisibility();
	}

	private buildTextMenu(root: HTMLDivElement): void {
		const menu = root.createDiv({ cls: "inkdoc-pencil-floating inkdoc-text-floating" });
		menu.setAttr("aria-hidden", "true");
		menu.addEventListener("mousedown", () => this.markTextToolbarInteraction());
		this.textMenuEl = menu;
		this.textSubmenuEngine?.dispose();
		this.textSubmenuEngine = createInkDocSubmenuEngine(menu);
		this.activeTextSubmenu = null;

		const rail = menu.createDiv({ cls: "inkdoc-pencil-fab-rail" });
		const createRailButton = (
			submenu: InkDocTextSubmenu,
			label: string,
			icon: string,
			fallback: string
		): HTMLButtonElement => {
			const button = rail.createEl("button", {
				cls: "inkdoc-pencil-fab",
				attr: { "aria-label": label, title: label }
			});
			button.dataset.textSubmenuTrigger = submenu;
			const glyph = button.createSpan({ cls: "inkdoc-pencil-fab-glyph" });
			setCompatibleIcon(glyph, icon, fallback);
			button.addEventListener("click", () => this.toggleTextSubmenu(submenu));
			return button;
		};

		const formatToggle = createRailButton("format", "Formato", "bold", "B");
		const fontToggle = createRailButton("font", "Tipografía", "type", "T");
		const colorsToggle = createRailButton("colors", "Color", "palette", "C");
		const paragraphToggle = createRailButton("paragraph", "Párrafo", "align-left", "P");
		const insertToggle = createRailButton("insert", "Insertar", "plus", "+");

		const flyouts = menu.createDiv({ cls: "inkdoc-pencil-flyouts" });

		const formatFlyout = flyouts.createDiv({
			cls: "inkdoc-pencil-flyout inkdoc-text-flyout",
			attr: { "data-text-submenu": "format" }
		});
		const formatCard = formatFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-panel-card" });
		formatCard.createDiv({ cls: "inkdoc-pencil-card-title", text: "Formato" });
		const formatButtons = formatCard.createDiv({ cls: "inkdoc-text-action-grid" });
		this.createTextIconButton(formatButtons, "undo-2", "Deshacer", () => this.applyEditorCommand("undo"));
		this.createTextIconButton(formatButtons, "redo-2", "Rehacer", () => this.applyEditorCommand("redo"));
		this.createTextIconButton(formatButtons, "eraser", "Quitar formato", () =>
			this.applyEditorCommand("removeFormat")
		);
		this.createTextIconButton(formatButtons, "bold", "Negrita", () => this.applyEditorCommand("bold"));
		this.createTextIconButton(formatButtons, "italic", "Cursiva", () => this.applyEditorCommand("italic"));
		this.createTextIconButton(formatButtons, "underline", "Subrayado", () =>
			this.applyEditorCommand("underline")
		);
		this.createTextIconButton(formatButtons, "strikethrough", "Tachado", () =>
			this.applyEditorCommand("strikeThrough")
		);
		this.createTextIconButton(formatButtons, "highlighter", "Resaltar", () =>
			this.applySelectionStyle("background-image: linear-gradient(120deg, #ffeaa7 0%, #fab1a0 100%);")
		);
		this.createTextIconButton(formatButtons, "align-left", "Alinear izquierda", () =>
			this.applyEditorCommand("justifyLeft")
		);
		this.createTextIconButton(formatButtons, "align-center", "Alinear centro", () =>
			this.applyEditorCommand("justifyCenter")
		);
		this.createTextIconButton(formatButtons, "align-right", "Alinear derecha", () =>
			this.applyEditorCommand("justifyRight")
		);
		this.createTextIconButton(formatButtons, "superscript", "Superíndice", () =>
			this.applyEditorCommand("superscript")
		);
		this.createTextIconButton(formatButtons, "subscript", "Subíndice", () =>
			this.applyEditorCommand("subscript")
		);
		this.createTextIconButton(formatButtons, "a-arrow-up", "Mayúsculas", () =>
			this.applyTextTransform("uppercase")
		);
		this.createTextIconButton(formatButtons, "a-arrow-down", "Minúsculas", () =>
			this.applyTextTransform("lowercase")
		);
		this.createTextIconButton(formatButtons, "a-large-small", "Capitalizar", () =>
			this.applyTextTransform("capitalize")
		);
		this.createTextIconButton(formatButtons, "text-select", "Seleccionar todo", () =>
			this.applyEditorCommand("selectAll")
		);

		const listsCard = formatFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-subcard" });
		listsCard.createDiv({ cls: "inkdoc-pencil-subtitle", text: "Listas y sangría" });
		const listButtons = listsCard.createDiv({ cls: "inkdoc-text-action-grid" });
		this.createTextIconButton(listButtons, "list", "Viñetas", () =>
			this.applyEditorCommand("insertUnorderedList")
		);
		this.createTextIconButton(listButtons, "list-ordered", "Numeradas", () =>
			this.applyEditorCommand("insertOrderedList")
		);
		this.createTextIconButton(listButtons, "check-square", "Checklist", () =>
			this.applyEditorCommand("insertText", "☐ ")
		);
		this.createTextIconButton(listButtons, "indent", "Aumentar sangría", () =>
			this.applyEditorCommand("indent")
		);
		this.createTextIconButton(listButtons, "outdent", "Disminuir sangría", () =>
			this.applyEditorCommand("outdent")
		);
		this.createTextIconButton(listButtons, "text-cursor-input", "Tabulación", () =>
			this.applyEditorCommand("insertText", "    ")
		);
		this.createTextIconButton(listButtons, "quote", "Cita", () =>
			this.applyEditorCommand("formatBlock", "<blockquote>")
		);
		this.createTextIconButton(listButtons, "code-2", "Código", () =>
			this.applyEditorCommand("formatBlock", "<pre>")
		);

		const fontFlyout = flyouts.createDiv({
			cls: "inkdoc-pencil-flyout inkdoc-text-flyout",
			attr: { "data-text-submenu": "font" }
		});
		const fontCard = fontFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-panel-card" });
		fontCard.createDiv({ cls: "inkdoc-pencil-card-title", text: "Tipografía" });
		const fontGrid = fontCard.createDiv({ cls: "inkdoc-text-form-grid" });
		this.createTextSelectControl(fontGrid, "Estilo", [
			{ label: "Párrafo", value: "<p>" },
			{ label: "Título", value: "<h1>" },
			{ label: "Subtítulo", value: "<h2>" },
			{ label: "Encabezado 3", value: "<h3>" },
			{ label: "Cita", value: "<blockquote>" },
			{ label: "Código", value: "<pre>" }
		], (value) => this.applyEditorCommand("formatBlock", value));
		this.createTextSelectControl(fontGrid, "Fuente", [
			{ label: "Inter", value: "Inter" },
			{ label: "Georgia", value: "Georgia" },
			{ label: "Times New Roman", value: "Times New Roman" },
			{ label: "Courier New", value: "Courier New" },
			{ label: "Verdana", value: "Verdana" },
			{ label: "Tahoma", value: "Tahoma" }
		], (value) => this.applyEditorCommand("fontName", value));
		this.createTextSelectControl(fontGrid, "Tamaño", [
			{ label: "12", value: "12px" },
			{ label: "14", value: "14px" },
			{ label: "16", value: "16px" },
			{ label: "18", value: "18px" },
			{ label: "20", value: "20px" },
			{ label: "24", value: "24px" },
			{ label: "28", value: "28px" }
		], (value) => this.applySelectionStyle(`font-size: ${value};`));
		this.createTextSelectControl(fontGrid, "Espaciado letra", [
			{ label: "0", value: "0px" },
			{ label: "0.5", value: "0.5px" },
			{ label: "1", value: "1px" },
			{ label: "1.5", value: "1.5px" },
			{ label: "2", value: "2px" }
		], (value) => this.applySelectionStyle(`letter-spacing: ${value};`));
		this.createTextSelectControl(fontGrid, "Peso", [
			{ label: "Normal", value: "400" },
			{ label: "Medio", value: "500" },
			{ label: "SemiBold", value: "600" },
			{ label: "Bold", value: "700" },
			{ label: "ExtraBold", value: "800" }
		], (value) => this.applySelectionStyle(`font-weight: ${value};`));

		const colorsFlyout = flyouts.createDiv({
			cls: "inkdoc-pencil-flyout inkdoc-text-flyout",
			attr: { "data-text-submenu": "colors" }
		});
		const colorsCard = colorsFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-panel-card" });
		colorsCard.createDiv({ cls: "inkdoc-pencil-card-title", text: "Color" });
		const colorInputs = colorsCard.createDiv({ cls: "inkdoc-text-color-inputs" });
		const textColorInput = colorInputs.createEl("input", {
			type: "color",
			cls: "inkdoc-text-color-input"
		});
		textColorInput.value = "#000000";
		textColorInput.title = "Color de texto";
		textColorInput.addEventListener("input", () => this.applyEditorCommand("foreColor", textColorInput.value));
		const highlightColorInput = colorInputs.createEl("input", {
			type: "color",
			cls: "inkdoc-text-color-input"
		});
		highlightColorInput.value = "#ffeaa7";
		highlightColorInput.title = "Resaltado";
		highlightColorInput.addEventListener("input", () =>
			this.applyEditorCommand("hiliteColor", highlightColorInput.value)
		);
		const textPaletteCard = colorsFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-subcard" });
		textPaletteCard.createDiv({ cls: "inkdoc-pencil-subtitle", text: "Texto" });
		const textPalette = textPaletteCard.createDiv({ cls: "inkdoc-text-palette" });
		this.strokePaletteColors.forEach((color) => {
			const swatch = this.createTextSwatch(textPalette, color, `Texto ${color}`);
			swatch.addEventListener("click", () => {
				textColorInput.value = color;
				this.applyEditorCommand("foreColor", color);
			});
		});
		const highlightPaletteCard = colorsFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-subcard" });
		highlightPaletteCard.createDiv({ cls: "inkdoc-pencil-subtitle", text: "Resaltado" });
		const highlightPalette = highlightPaletteCard.createDiv({ cls: "inkdoc-text-palette is-highlight" });
		this.strokePaletteColors.forEach((color) => {
			const swatch = this.createTextSwatch(highlightPalette, color, `Resaltado ${color}`);
			swatch.addEventListener("click", () => {
				highlightColorInput.value = color;
				this.applyEditorCommand("hiliteColor", color);
			});
		});

		const paragraphFlyout = flyouts.createDiv({
			cls: "inkdoc-pencil-flyout inkdoc-text-flyout",
			attr: { "data-text-submenu": "paragraph" }
		});
		const paragraphCard = paragraphFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-panel-card" });
		paragraphCard.createDiv({ cls: "inkdoc-pencil-card-title", text: "Párrafo" });
		const paragraphButtons = paragraphCard.createDiv({ cls: "inkdoc-text-action-grid" });
		this.createTextIconButton(paragraphButtons, "align-left", "Alinear izquierda", () =>
			this.applyEditorCommand("justifyLeft")
		);
		this.createTextIconButton(paragraphButtons, "align-center", "Alinear centro", () =>
			this.applyEditorCommand("justifyCenter")
		);
		this.createTextIconButton(paragraphButtons, "align-right", "Alinear derecha", () =>
			this.applyEditorCommand("justifyRight")
		);
		this.createTextIconButton(paragraphButtons, "align-justify", "Justificar", () =>
			this.applyEditorCommand("justifyFull")
		);
		const spacingCard = paragraphFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-subcard" });
		spacingCard.createDiv({ cls: "inkdoc-pencil-subtitle", text: "Espaciado" });
		const spacingGrid = spacingCard.createDiv({ cls: "inkdoc-text-form-grid" });
		this.createTextSelectControl(spacingGrid, "Interlineado", [
			{ label: "1.0", value: "1.0" },
			{ label: "1.15", value: "1.15" },
			{ label: "1.5", value: "1.5" },
			{ label: "2.0", value: "2.0" }
		], (value) => this.applyBlockStyle({ lineHeight: value }));
		this.createTextSelectControl(spacingGrid, "Antes", [
			{ label: "0px", value: "0" },
			{ label: "4px", value: "4" },
			{ label: "8px", value: "8" },
			{ label: "12px", value: "12" },
			{ label: "16px", value: "16" }
		], (value) => this.applyParagraphStyle({ marginTop: `${value}px` }));
		this.createTextSelectControl(spacingGrid, "Después", [
			{ label: "0px", value: "0" },
			{ label: "4px", value: "4" },
			{ label: "8px", value: "8" },
			{ label: "12px", value: "12" },
			{ label: "16px", value: "16" }
		], (value) => this.applyParagraphStyle({ marginBottom: `${value}px` }));
		this.createTextSelectControl(spacingGrid, "Sangría primera línea", [
			{ label: "0px", value: "0" },
			{ label: "12px", value: "12" },
			{ label: "24px", value: "24" },
			{ label: "36px", value: "36" }
		], (value) => this.applyParagraphStyle({ textIndent: `${value}px` }));
		this.createTextSelectControl(spacingGrid, "Ancho bloque", [
			{ label: "Auto", value: "auto" },
			{ label: "45ch", value: "45ch" },
			{ label: "60ch", value: "60ch" },
			{ label: "75ch", value: "75ch" }
		], (value) => this.applyBlockStyle({ maxWidth: value }));

		const insertFlyout = flyouts.createDiv({
			cls: "inkdoc-pencil-flyout inkdoc-text-flyout",
			attr: { "data-text-submenu": "insert" }
		});
		const insertCard = insertFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-panel-card" });
		insertCard.createDiv({ cls: "inkdoc-pencil-card-title", text: "Insertar" });
		const insertButtons = insertCard.createDiv({ cls: "inkdoc-text-action-grid" });
		this.createTextIconButton(insertButtons, "link", "Insertar enlace", () => this.promptTextLink());
		this.createTextIconButton(insertButtons, "unlink-2", "Quitar enlace", () =>
			this.applyEditorCommand("unlink")
		);
		this.createTextIconButton(insertButtons, "separator-horizontal", "Separador", () =>
			this.insertEditorHtml("<hr />")
		);
		this.createTextIconButton(insertButtons, "table-2", "Tabla 2x2", () =>
			this.insertEditorHtml(
				"<table style=\"width:100%; border-collapse:collapse;\"><tr><td style=\"border:1px solid currentColor; padding:4px;\">&nbsp;</td><td style=\"border:1px solid currentColor; padding:4px;\">&nbsp;</td></tr><tr><td style=\"border:1px solid currentColor; padding:4px;\">&nbsp;</td><td style=\"border:1px solid currentColor; padding:4px;\">&nbsp;</td></tr></table><p></p>"
			)
		);
		this.createTextIconButton(insertButtons, "calendar", "Fecha", () =>
			this.applyEditorCommand("insertText", new Date().toLocaleDateString())
		);
		this.createTextIconButton(insertButtons, "clock-3", "Hora", () =>
			this.applyEditorCommand("insertText", new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
		);
		this.createTextIconButton(insertButtons, "quote", "Bloque cita", () =>
			this.insertEditorHtml("<blockquote><p>Escribe aqui</p></blockquote><p></p>")
		);
		this.createTextIconButton(insertButtons, "code-2", "Bloque código", () =>
			this.insertEditorHtml("<pre><code></code></pre><p></p>")
		);
		this.createTextIconButton(insertButtons, "list-checks", "Checklist", () =>
			this.insertEditorHtml("<ul><li>☐ </li></ul>")
		);
		this.createTextIconButton(insertButtons, "wrap-text", "Salto de línea", () =>
			this.applyEditorCommand("insertHTML", "<br />")
		);

		this.textSubmenuEngine.register("format", formatToggle, formatFlyout);
		this.textSubmenuEngine.register("font", fontToggle, fontFlyout);
		this.textSubmenuEngine.register("colors", colorsToggle, colorsFlyout);
		this.textSubmenuEngine.register("paragraph", paragraphToggle, paragraphFlyout);
		this.textSubmenuEngine.register("insert", insertToggle, insertFlyout);

		this.setActiveTextSubmenu(null);
		this.updateTextToolbarVisibility();
	}

	private buildLatexMenu(root: HTMLDivElement): void {
		const menu = root.createDiv({ cls: "inkdoc-pencil-floating inkdoc-latex-floating" });
		menu.setAttr("aria-hidden", "true");
		menu.addEventListener("mousedown", () => this.markTextToolbarInteraction());
		this.latexMenuEl = menu;
		this.latexSubmenuEngine?.dispose();
		this.latexSubmenuEngine = createInkDocSubmenuEngine(menu);
		this.activeLatexSubmenu = null;

		const rail = menu.createDiv({ cls: "inkdoc-pencil-fab-rail" });
		const colorToggle = rail.createEl("button", {
			cls: "inkdoc-pencil-fab",
			attr: { "aria-label": "Color de formula", title: "Color de formula" }
		});
		const colorGlyph = colorToggle.createSpan({ cls: "inkdoc-pencil-fab-glyph" });
		setCompatibleIcon(colorGlyph, "palette", "C");
		colorToggle.addEventListener("click", () => this.toggleLatexSubmenu("colors"));

		const flyouts = menu.createDiv({ cls: "inkdoc-pencil-flyouts" });
		const colorsFlyout = flyouts.createDiv({
			cls: "inkdoc-pencil-flyout inkdoc-latex-flyout",
			attr: { "data-latex-submenu": "colors" }
		});
		const colorsCard = colorsFlyout.createDiv({ cls: "inkdoc-pencil-card inkdoc-pencil-panel-card" });
		colorsCard.createDiv({ cls: "inkdoc-pencil-card-title", text: "Color de formula" });
		const controls = colorsCard.createDiv({ cls: "inkdoc-latex-color-inputs" });
		const colorInput = controls.createEl("input", {
			type: "color",
			cls: "inkdoc-text-color-input inkdoc-latex-color-input"
		});
		colorInput.value = this.latexColor;
		colorInput.title = "Color de formula";
		colorInput.addEventListener("input", () => this.applyLatexColor(colorInput.value));
		const preview = controls.createDiv({ cls: "inkdoc-pencil-preview-color", attr: { "data-role": "latex-color-preview" } });
		const palette = colorsCard.createDiv({
			cls: "inkdoc-latex-palette",
			attr: { "aria-label": "Paleta de LaTeX" }
		});
		for (const color of INKDOC_LATEX_PALETTE) {
			const swatch = palette.createEl("button", {
				cls: "inkdoc-latex-swatch",
				attr: {
					"aria-label": `Color de formula ${color}`,
					title: `Formula: ${color}`
				}
			});
			swatch.style.background = color;
			swatch.dataset.color = color;
			swatch.addEventListener("click", () => {
				colorInput.value = color;
				this.applyLatexColor(color);
			});
		}

		this.latexSubmenuEngine.register("colors", colorToggle, colorsFlyout);
		this.setActiveLatexSubmenu(null);
		this.updateLatexToolbarUI();
	}

	private updateTextToolbarVisibility(): void {
		if (!this.textMenuEl) {
			return;
		}
		const hasTextEditor = Boolean(this.textEditorEl) || Boolean(this.stickyTextEditorEl);
		const shouldShow = this.activeTool === "text" || hasTextEditor;
		this.textMenuEl.classList.toggle("is-open", shouldShow);
		this.textMenuEl.setAttr("aria-hidden", shouldShow ? "false" : "true");
		if (!shouldShow) {
			this.setActiveTextSubmenu(null);
		}
	}

	private updateLatexToolbarUI(): void {
		if (!this.latexMenuEl) {
			return;
		}
		const shouldShow = this.activeTool === "latex" || Boolean(this.latexEditorEl);
		this.latexMenuEl.classList.toggle("is-open", shouldShow);
		this.latexMenuEl.setAttr("aria-hidden", shouldShow ? "false" : "true");
		if (!shouldShow) {
			this.setActiveLatexSubmenu(null);
		}
		const picker = this.latexMenuEl.querySelector<HTMLInputElement>(".inkdoc-latex-color-input");
		if (picker) {
			picker.value = this.latexColor;
		}
		const swatches = this.latexMenuEl.querySelectorAll<HTMLButtonElement>(".inkdoc-latex-swatch");
		swatches.forEach((swatch) => {
			const isActive = swatch.dataset.color === this.latexColor;
			swatch.classList.toggle("is-active", isActive);
		});
		const preview = this.latexMenuEl.querySelector<HTMLDivElement>("[data-role='latex-color-preview']");
		if (preview) {
			preview.style.background = this.latexColor;
		}
	}

	private getPageDefaultTextColor(page: InkDocPage): string {
		return getContrastPageTextColor(page.colors);
	}

	private normalizeLatexForRender(value: string): string {
		const trimmed = value.trim();
		if (!trimmed) {
			return "";
		}
		const bracketMatch = trimmed.match(/^\\\[\s*([\s\S]*?)\s*\\\]$/);
		if (bracketMatch) {
			return bracketMatch[1]?.trim() ?? "";
		}
		const parenMatch = trimmed.match(/^\\\(\s*([\s\S]*?)\s*\\\)$/);
		if (parenMatch) {
			return parenMatch[1]?.trim() ?? "";
		}
		const dollarMatch = trimmed.match(/^\$\$\s*([\s\S]*?)\s*\$\$$/);
		if (dollarMatch) {
			return dollarMatch[1]?.trim() ?? "";
		}
		const inlineDollarMatch = trimmed.match(/^\$\s*([\s\S]*?)\s*\$$/);
		if (inlineDollarMatch) {
			return inlineDollarMatch[1]?.trim() ?? "";
		}
		return trimmed;
	}

	private getTextBlockColor(page: InkDocPage, block: InkDocTextBlock): string {
		if (typeof block.color === "string" && block.color.trim().length > 0) {
			return block.color;
		}
		return this.getPageDefaultTextColor(page);
	}

	private getLatexBlockColor(page: InkDocPage, block: InkDocTextBlock): string {
		if (typeof block.color === "string" && block.color.trim().length > 0) {
			return block.color;
		}
		return this.getPageDefaultTextColor(page);
	}

	private applyLatexColor(color: string): void {
		if (!color || color === this.latexColor) {
			return;
		}
		this.latexColor = color;
		this.updateLatexToolbarUI();
		const active = this.activeLatexEdit;
		if (!active || !this.docData) {
			return;
		}
		const page = this.docData.pages.find((entry) => entry.id === active.pageId) ?? this.docData.pages[active.pageIndex];
		const block = page?.textBlocks?.find((entry) => entry.id === active.blockId);
		if (!page || !block || this.getBlockType(block) !== "latex") {
			return;
		}
		block.color = color;
		if (this.latexEditorEl) {
			this.latexEditorEl.style.color = color;
		}
		this.textLayerDirty.add(page.id);
		const state = this.canvasStates.get(page.id);
		if (state) {
			this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
		}
		this.saveDebounced();
	}

	private updatePencilMenuVisibility(): void {
		if (!this.pencilMenuEl) {
			return;
		}
		const shouldShow = this.isStrokeTool(this.activeTool) || this.activeTool === "eraser";
		this.pencilMenuEl.classList.toggle("is-open", shouldShow);
		this.pencilMenuEl.setAttr("aria-hidden", shouldShow ? "false" : "true");
		if (shouldShow) {
			window.requestAnimationFrame(() => this.updatePencilMenuUI());
		} else {
			this.setActivePencilSubmenu(null);
		}
	}

	private applyEditorCommand(command: string, value?: string): void {
		applyEditorCommandToEditor(this.getTextEditingContext(), this.getTextEditingAccessors(), command, value);
	}

	private applySelectionStyle(style: string): void {
		applySelectionStyleToEditor(this.getTextEditingContext(), this.getTextEditingAccessors(), style);
	}

	private applyTextTransform(value: "uppercase" | "lowercase" | "capitalize"): void {
		applyTextTransformToEditor(this.getTextEditingContext(), this.getTextEditingAccessors(), value);
	}

	private applyBlockStyle(styles: Partial<CSSStyleDeclaration>): void {
		applyBlockStyleToEditor(this.getTextEditingContext(), this.getTextEditingAccessors(), styles);
	}

	private applyParagraphStyle(styles: Partial<CSSStyleDeclaration>): void {
		applyParagraphStyleToEditor(this.getTextEditingContext(), this.getTextEditingAccessors(), styles);
	}

	private escapeHtml(value: string): string {
		const div = document.createElement("div");
		div.textContent = value;
		return div.innerHTML;
	}

	private async loadAndRender(): Promise<void> {
		if (!this.file) {
			this.renderError("No hay archivo abierto.");
			return;
		}

		try {
			const raw = await this.app.vault.read(this.file);
			this.lastSavedContent = raw;
			const data = this.parseDoc(raw);
			if (!data) {
				return;
			}
			this.docData = data;
			syncInkDocWikiLinksToMetadata(this.app, this.file, data);
			await this.renderDoc(data);
		} catch (error) {
			console.error("Error al leer InkDoc:", error);
			this.renderError("No se pudo leer el archivo InkDoc.");
		}
	}

	private parseDoc(raw: string): InkDocDocument | null {
		try {
			return parseInkDocRaw(raw);
		} catch (error) {
			console.error("JSON inválido en InkDoc:", error);
			this.renderError("El archivo InkDoc tiene JSON inválido.");
			return null;
		}
	}

	private async renderDoc(doc: InkDocDocument): Promise<void> {
		if (!this.pagesEl) {
			this.buildLayout();
		}
		if (!this.pagesEl) {
			return;
		}

		this.closeTextBlockMenu();
		this.closeImageBlockMenu();
		closeInkDocToolsMenu(this.contentEl);
		this.closeTextEditor(false);
		this.disposeCanvases();
		const pagesEl = this.pagesEl;
		pagesEl.empty();
		this.pagesContentEl = pagesEl.createDiv({ cls: "inkdoc-pages-content" });
		this.updateZoom();
		const renderTarget = this.pagesContentEl ?? pagesEl;
		for (const [index, page] of doc.pages.entries()) {
			await this.renderPage(renderTarget, page, index);
		}
		const firstPage = doc.pages[0];
		if (firstPage) {
			this.latexColor = this.getPageDefaultTextColor(firstPage);
			this.updateLatexToolbarUI();
		}
		this.updatePageInputMode();
		this.renderStickyNotes();

	}

	private async renderPage(pagesEl: HTMLDivElement, page: InkDocPage, index: number): Promise<void> {
		const { widthMm, heightMm } = getPageSizeMm(this.docData?.page.size);
		const pageEl = pagesEl.createDiv({ cls: "inkdoc-page" });
		pageEl.style.width = `${widthMm}mm`;
		pageEl.style.height = `${heightMm}mm`;
		setPageBackgroundAttribute(pageEl, page.background);
		setPageColorVariables(pageEl, page.colors);

		const controlsEl = pageEl.createDiv({ cls: "inkdoc-page-controls" });
		if (index === 0) {
			controlsEl.addClass("is-first-page-controls");
		}
		const deleteButton = controlsEl.createEl("button", {
			cls: "inkdoc-page-delete",
			attr: { "aria-label": "Borrar página", title: "Borrar página" }
		});
		const deleteIcon = deleteButton.createSpan({ cls: "inkdoc-page-icon-glyph" });
		setCompatibleIcon(deleteIcon, "trash", "D");
		deleteButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.deletePage(index);
		});

		const settingsButton = controlsEl.createEl("button", {
			cls: "inkdoc-page-settings",
			attr: { "aria-label": "Configurar fondo", title: "Configurar fondo" }
		});
		const settingsIcon = settingsButton.createSpan({ cls: "inkdoc-page-icon-glyph" });
		setCompatibleIcon(settingsIcon, "settings", "S");
		settingsButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.openBackgroundModal(page, index);
		});

		const paletteButton = controlsEl.createEl("button", {
			cls: "inkdoc-page-palette",
			attr: { "aria-label": "Configurar colores", title: "Configurar colores" }
		});
		const paletteIcon = paletteButton.createSpan({ cls: "inkdoc-page-icon-glyph" });
		setCompatibleIcon(paletteIcon, "palette", "P");
		paletteButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.openPaletteModal(page, index);
		});

		if (index === 0) {
			const sizeButton = controlsEl.createEl("button", {
				cls: "inkdoc-page-size",
				attr: { "aria-label": "Configurar tamaño", title: "Configurar tamaño" }
			});
			const sizeIcon = sizeButton.createSpan({ cls: "inkdoc-page-icon-glyph" });
			setCompatibleIcon(sizeIcon, "stretch-vertical", "R");
			sizeButton.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.openPageSizeModal();
			});
		}

		if (index === (this.docData?.pages.length ?? 0) - 1) {
			const addButton = controlsEl.createEl("button", {
				cls: "inkdoc-page-add-bottom",
				attr: { "aria-label": "Agregar página", title: "Agregar página" }
			});
			const addIcon = addButton.createSpan({ cls: "inkdoc-page-icon-glyph" });
			setCompatibleIcon(addIcon, "plus", "+");
			addButton.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				void this.addNewPage();
			});
		}

		controlsEl.createDiv({
			cls: "inkdoc-page-index",
			text: `${index + 1}/${this.docData?.pages.length ?? 0}`
		});

		const canvasEl = pageEl.createEl("canvas", { cls: "inkdoc-page-canvas" });
		canvasEl.style.width = `${widthMm}mm`;
		canvasEl.style.height = `${heightMm}mm`;
		const previewCanvasEl = pageEl.createEl("canvas", { cls: "inkdoc-page-canvas inkdoc-page-canvas-preview" });
		previewCanvasEl.style.width = `${widthMm}mm`;
		previewCanvasEl.style.height = `${heightMm}mm`;
		const { widthPx, heightPx } = this.getCanvasSizePx();
		const dpr = window.devicePixelRatio || 1;
		canvasEl.width = Math.round(widthPx * dpr);
		canvasEl.height = Math.round(heightPx * dpr);
		previewCanvasEl.width = Math.round(widthPx * dpr);
		previewCanvasEl.height = Math.round(heightPx * dpr);

		const ctx = canvasEl.getContext("2d");
		const previewCtx = previewCanvasEl.getContext("2d");
		if (!ctx || !previewCtx) {
			return;
		}
		ctx.scale(dpr, dpr);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.strokeStyle = INKDOC_STROKE_COLOR;
		ctx.lineWidth = INKDOC_STROKE_WIDTH;
		previewCtx.scale(dpr, dpr);
		previewCtx.lineCap = "round";
		previewCtx.lineJoin = "round";
		previewCtx.strokeStyle = INKDOC_STROKE_COLOR;
		previewCtx.lineWidth = INKDOC_STROKE_WIDTH;

		this.canvasStates.set(page.id, {
			pageEl,
			canvas: canvasEl,
			ctx,
			previewCanvas: previewCanvasEl,
			previewCtx,
			isDrawing: false,
			currentStrokeId: null,
			selection: {
				isSelecting: false,
				isDragging: false,
				start: null,
				current: null,
				lastDragPoint: null
			},
			text: {
				isDragging: false,
				draggingId: null,
				dragOffset: null,
				isResizing: false,
				resizingId: null,
				resizeStartPoint: null,
				resizeStartSize: null
			},
			image: {
				isDragging: false,
				draggingId: null,
				dragOffset: null,
				isResizing: false,
				resizingId: null,
				resizeStartPoint: null,
				resizeStartSize: null,
				isRotating: false,
				rotatingId: null,
				rotateStartAngle: null,
				rotateBase: null,
				isSkewing: false,
				skewingId: null,
				skewStartPoint: null,
				skewStart: null
			}
		});
		this.textLayerDirty.add(page.id);
		this.imageLayerDirty.add(page.id);

		this.renderStrokes(ctx, page.strokes ?? [], page.id);
		this.registerCanvasEvents(page, index, ctx, widthPx, heightPx);
		this.registerImageDropEvents(pageEl, canvasEl, page, index);
	}

	private registerImageDropEvents(
		pageEl: HTMLDivElement,
		canvasEl: HTMLCanvasElement,
		page: InkDocPage,
		index: number
	): void {
		const clearDragState = () => {
			pageEl.classList.remove("is-dragover");
		};
		pageEl.addEventListener("dragenter", (event: DragEvent) => {
			if (!hasFileDragData(event)) {
				return;
			}
			event.preventDefault();
			pageEl.classList.add("is-dragover");
		});
		pageEl.addEventListener("dragover", (event: DragEvent) => {
			if (!hasFileDragData(event)) {
				return;
			}
			event.preventDefault();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = "copy";
			}
			pageEl.classList.add("is-dragover");
		});
		pageEl.addEventListener("dragleave", (event: DragEvent) => {
			const nextTarget = event.relatedTarget;
			if (nextTarget instanceof Node && pageEl.contains(nextTarget)) {
				return;
			}
			clearDragState();
		});
		pageEl.addEventListener("drop", (event: DragEvent) => {
			clearDragState();
			if (!hasFileDragData(event)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const file = getImageFileFromDragEvent(event);
			if (!file) {
				return;
			}
			const point = this.getClientPointOnCanvas(canvasEl, event.clientX, event.clientY);
			void this.insertImageFromFile(page, index, point, file);
		});
	}

	private renderStrokes(
		ctx: CanvasRenderingContext2D,
		strokes: InkDocStroke[],
		pageId: string,
		quality: "full" | "fast" = "full"
	): void {
		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		this.clearStrokePreview(pageId);
		const selected = this.selectedStrokes.get(pageId);
		for (const stroke of strokes) {
			const isSelected = selected?.has(stroke.id) ?? false;
			this.renderStroke(ctx, stroke, isSelected, { quality });
		}
		const page = this.docData?.pages.find((entry) => entry.id === pageId);
		if (page) {
			const selectedImages = this.selectedImages.get(pageId);
			this.renderImageLayer(
				page,
				this.activeTool === "select" || this.activeTool === "image",
				this.activeTool === "select" ? selectedImages ?? null : null
			);
			const selectedText = this.selectedTextBlocks.get(pageId);
			this.renderTextLayer(
				page,
				this.isTextLikeTool(),
				this.activeTool === "select" ? selectedText ?? null : null
			);
		}
		this.renderSelectionRect(ctx, pageId);
	}

	private clearStrokePreview(pageId: string): void {
		const state = this.canvasStates.get(pageId);
		if (!state) {
			return;
		}
		state.previewCtx.clearRect(0, 0, state.previewCtx.canvas.width, state.previewCtx.canvas.height);
	}

	private renderActiveStrokePreview(page: InkDocPage, strokeId: string): void {
		const state = this.canvasStates.get(page.id);
		if (!state) {
			return;
		}
		const stroke = page.strokes?.find((entry) => entry.id === strokeId);
		this.clearStrokePreview(page.id);
		if (!stroke) {
			return;
		}
		this.renderStroke(state.previewCtx, stroke, false, {
			quality: this.getInteractiveRenderQuality()
		});
	}

	private getInteractiveRenderQuality(): "full" | "fast" {
		return this.isMobileFastRenderEnabled || this.isLowLatencyModeEnabled ? "fast" : "full";
	}

	private requestPageRender(pageId: string, quality: "full" | "fast" = "full"): void {
		const existing = this.pendingPageRenders.get(pageId);
		if (typeof existing === "number") {
			const current = this.pendingPageRenderQuality.get(pageId) ?? "full";
			if (current === "fast" && quality === "full") {
				this.pendingPageRenderQuality.set(pageId, "full");
			}
			return;
		}
		const rafId = window.requestAnimationFrame(() => {
			this.pendingPageRenders.delete(pageId);
			const renderQuality = this.pendingPageRenderQuality.get(pageId) ?? "full";
			this.pendingPageRenderQuality.delete(pageId);
			if (!this.docData) {
				return;
			}
			const page = this.docData.pages.find((entry) => entry.id === pageId);
			const state = this.canvasStates.get(pageId);
			if (!page || !state) {
				return;
			}
			this.renderStrokes(state.ctx, page.strokes ?? [], page.id, renderQuality);
		});
		this.pendingPageRenders.set(pageId, rafId);
		this.pendingPageRenderQuality.set(pageId, quality);
	}

	private flushPageRender(pageId: string): void {
		const rafId = this.pendingPageRenders.get(pageId);
		if (typeof rafId === "number") {
			window.cancelAnimationFrame(rafId);
			this.pendingPageRenders.delete(pageId);
		}
		this.pendingPageRenderQuality.delete(pageId);
		if (!this.docData) {
			return;
		}
		const page = this.docData.pages.find((entry) => entry.id === pageId);
		const state = this.canvasStates.get(pageId);
		if (!page || !state) {
			return;
		}
		this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
	}

	private renderTextLayer(
		page: InkDocPage,
		showHandles: boolean,
		selectedBlocks: Set<string> | null
	): void {
		const state = this.canvasStates.get(page.id);
		if (!state) {
			return;
		}
		const shouldSkipUpdate =
			(this.isStrokeTool(this.activeTool) || this.activeTool === "eraser") &&
			!this.textLayerDirty.has(page.id);
		if (shouldSkipUpdate) {
			return;
		}
		const blocks = page.textBlocks ?? [];
		let layer = this.textLayerByPage.get(page.id) ?? null;
		if (!layer) {
			layer = state.pageEl.createDiv({ cls: "inkdoc-text-layer" });
			this.textLayerByPage.set(page.id, layer);
		}
		layer.empty();
		if (blocks.length === 0) {
			this.textLayerDirty.delete(page.id);
			return;
		}
		const { widthPx, heightPx } = this.getCanvasSizePx();
		const rect = state.canvas.getBoundingClientRect();
		const zoom = this.zoomLevel || 1;
		const scaleX = rect.width / zoom / widthPx;
		const scaleY = rect.height / zoom / heightPx;
		const pageIndex = this.docData?.pages.findIndex((entry) => entry.id === page.id) ?? 0;
		for (const block of blocks) {
			if (
				this.activeTextEdit &&
				this.activeTextEdit.pageId === page.id &&
				this.activeTextEdit.blockId === block.id
			) {
				continue;
			}
			if (
				this.activeLatexEdit &&
				this.activeLatexEdit.pageId === page.id &&
				this.activeLatexEdit.blockId === block.id
			) {
				continue;
			}
			const blockEl = layer.createDiv({ cls: "inkdoc-text-block" });
			blockEl.tabIndex = 0;
			blockEl.dataset.blockId = block.id;
			const blockType = this.getBlockType(block);
			const isActiveToolForBlock =
				(this.activeTool === "text" && blockType === "text") ||
				(this.activeTool === "latex" && blockType === "latex");
			if (blockType === "latex") {
				blockEl.classList.add("is-latex");
			}
			if (isActiveToolForBlock) {
				blockEl.classList.add("is-tool-active");
			}
			if (showHandles && this.isBlockCompatibleWithTool(block, this.activeTool)) {
				blockEl.classList.add("has-handles");
			}
			if (selectedBlocks?.has(block.id)) {
				blockEl.classList.add("is-selected");
			}
			blockEl.style.left = `${block.x * scaleX}px`;
			blockEl.style.top = `${block.y * scaleY}px`;
			blockEl.style.width = `${Math.max(INKDOC_TEXT_MIN_WIDTH, block.w * scaleX)}px`;
			blockEl.style.height = `${Math.max(INKDOC_TEXT_MIN_HEIGHT, block.h * scaleY)}px`;
			const content = blockEl.createDiv({ cls: "inkdoc-text-block-content" });
			if (this.getBlockType(block) === "latex") {
				void this.renderLatexBlock(page, content, block);
			} else {
				content.style.color = this.getTextBlockColor(page, block);
				content.innerHTML = block.html ?? this.escapeHtml(block.text ?? "");
				applyWikiLinksToElement(content, this.app, this.file);
			}
			const resizeHandle = blockEl.createDiv({ cls: "inkdoc-text-block-resize" });
			resizeHandle.textContent = "↘";

			const menuEl = blockEl.createDiv({ cls: "inkdoc-object-menu inkdoc-text-block-menu" });
			if (blockType === "latex") {
				const inkMathButton = menuEl.createEl("button", {
					cls: "inkdoc-object-menu-btn",
					attr: { type: "button", "aria-label": "InkMath", title: "InkMath" }
				});
				setCompatibleIcon(inkMathButton, "wand", "W");
				inkMathButton.addEventListener("click", (event) => {
					if (!isActiveToolForBlock) {
						return;
					}
					event.preventDefault();
					event.stopPropagation();
					this.openInkMathModalForLatexBlock(page, pageIndex, block.id);
				});
			}
			const deleteButton = menuEl.createEl("button", {
				cls: "inkdoc-object-menu-btn",
				attr: { type: "button", "aria-label": "Borrar bloque", title: "Borrar bloque" }
			});
			setCompatibleIcon(deleteButton, "trash", "D");
			deleteButton.addEventListener("click", (event) => {
				if (!isActiveToolForBlock) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				this.deleteTextBlock(page, pageIndex, block.id);
			});

			const menuController = createObjectHoverMenuController(blockEl, {
				setMenuVisible: (visible) => blockEl.classList.toggle("is-menu-visible", visible),
				isEnabled: () => isActiveToolForBlock
			});
			blockEl.addEventListener("pointerenter", menuController.handleHostPointerEnter);
			blockEl.addEventListener("pointerleave", menuController.handleHostPointerLeave);
			blockEl.addEventListener("focusin", menuController.handleHostFocusIn);
			blockEl.addEventListener("focusout", menuController.handleHostFocusOut);
			menuEl.addEventListener("pointerdown", (event) => {
				menuController.handleMenuPointerDown();
				event.stopPropagation();
			});
			menuEl.addEventListener("pointerenter", menuController.handleMenuPointerEnter);
			menuEl.addEventListener("pointerleave", menuController.handleMenuPointerLeave);
			blockEl.addEventListener("click", (event) => {
				const target = event.target;
				if (target instanceof HTMLElement && target.closest(".inkdoc-object-menu")) {
					return;
				}
				if (target instanceof HTMLElement && target.closest(".inkdoc-wikilink")) {
					return;
				}
				menuController.handleHostClick();
			});

			blockEl.addEventListener("dblclick", (event) => {
				if (!isActiveToolForBlock) {
					return;
				}
				const target = event.target;
				if (target instanceof HTMLElement && target.closest(".inkdoc-wikilink")) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				if (blockType === "latex") {
					this.openLatexEditor(page, pageIndex, block);
				} else {
					this.openTextEditor(page, pageIndex, block);
				}
			});

			blockEl.addEventListener("pointerdown", (event) => {
				if (event.button !== 0) {
					return;
				}
				const target = event.target;
				if (target instanceof HTMLElement && target.closest(".inkdoc-object-menu")) {
					return;
				}
				if (target instanceof HTMLElement && target.closest(".inkdoc-wikilink")) {
					return;
				}
				const canMove =
					this.activeTool === "select" ||
					(this.activeTool === "text" && blockType === "text") ||
					(this.activeTool === "latex" && blockType === "latex");
				if (!canMove) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				const startX = event.clientX;
				const startY = event.clientY;
				const startLeft = block.x;
				const startTop = block.y;
				startWindowPointerInteraction({
					onMove: (moveEvent) => {
						this.syncEngine.noteActivity();
						const currentZoom = Math.max(0.001, this.zoomLevel || 1);
						const dx = (moveEvent.clientX - startX) / currentZoom;
						const dy = (moveEvent.clientY - startY) / currentZoom;
						block.x = startLeft + dx;
						block.y = startTop + dy;
						this.textLayerDirty.add(page.id);
						this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
					},
					onEnd: () => {
						this.saveDebounced();
					}
				});
			});

			resizeHandle.addEventListener("pointerdown", (event) => {
				if (event.button !== 0) {
					return;
				}
				const blockType = this.getBlockType(block);
				const canResize =
					this.activeTool === "select" ||
					(this.activeTool === "text" && blockType === "text") ||
					(this.activeTool === "latex" && blockType === "latex");
				if (!canResize) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				const startX = event.clientX;
				const startY = event.clientY;
				const startW = Math.max(INKDOC_TEXT_MIN_WIDTH, block.w);
				const startH = Math.max(INKDOC_TEXT_MIN_HEIGHT, block.h);
				startWindowPointerInteraction({
					onMove: (moveEvent) => {
						this.syncEngine.noteActivity();
						const currentZoom = Math.max(0.001, this.zoomLevel || 1);
						const dx = (moveEvent.clientX - startX) / currentZoom;
						const dy = (moveEvent.clientY - startY) / currentZoom;
						block.w = Math.max(INKDOC_TEXT_MIN_WIDTH, startW + dx);
						block.h = Math.max(INKDOC_TEXT_MIN_HEIGHT, startH + dy);
						this.textLayerDirty.add(page.id);
						this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
					},
					onEnd: () => {
						this.saveDebounced();
					}
				});
			});
		}
		this.textLayerDirty.delete(page.id);
	}

	private renderImageLayer(
		page: InkDocPage,
		isInteractive: boolean,
		selectedBlocks: Set<string> | null
	): void {
		const state = this.canvasStates.get(page.id);
		if (!state) {
			return;
		}
		const shouldSkipUpdate =
			this.activeTool !== "select" &&
			this.activeTool !== "image" &&
			!this.imageLayerDirty.has(page.id);
		if (shouldSkipUpdate) {
			return;
		}
		const blocks = page.images ?? [];
		let layer = this.imageLayerByPage.get(page.id) ?? null;
		if (!layer) {
			layer = state.pageEl.createDiv({ cls: "inkdoc-image-layer" });
			this.imageLayerByPage.set(page.id, layer);
		}
		layer.classList.toggle("is-interactive", isInteractive);
		layer.empty();
		if (blocks.length === 0) {
			this.imageLayerDirty.delete(page.id);
			return;
		}
		const { widthPx, heightPx } = this.getCanvasSizePx();
		const rect = state.canvas.getBoundingClientRect();
		const zoom = this.zoomLevel || 1;
		const scaleX = rect.width / zoom / widthPx;
		const scaleY = rect.height / zoom / heightPx;
		const pageIndex = this.docData?.pages.findIndex((entry) => entry.id === page.id) ?? 0;
		for (const block of blocks) {
			const blockEl = layer.createDiv({ cls: "inkdoc-image-block" });
			blockEl.tabIndex = 0;
			const isImageToolActive = this.activeTool === "image";
			if (isImageToolActive) {
				blockEl.classList.add("is-tool-active");
			}
			const isSelected = selectedBlocks?.has(block.id) ?? false;
			if (isSelected) {
				blockEl.classList.add("is-selected");
			}
			blockEl.style.left = `${block.x * scaleX}px`;
			blockEl.style.top = `${block.y * scaleY}px`;
			blockEl.style.width = `${Math.max(INKDOC_IMAGE_MIN_WIDTH, block.w * scaleX)}px`;
			blockEl.style.height = `${Math.max(INKDOC_IMAGE_MIN_HEIGHT, block.h * scaleY)}px`;
			blockEl.style.transform = "";
			const rotation = block.rotation ?? 0;
			const skewX = block.skewX ?? 0;
			const skewY = block.skewY ?? 0;
			const flipX = block.flipX === true ? -1 : 1;
			const visualEl = blockEl.createDiv({ cls: "inkdoc-image-visual" });
			visualEl.style.transform = `rotate(${rotation}deg) skew(${skewX}deg, ${skewY}deg) scaleX(${flipX})`;
			visualEl.style.transformOrigin = "center";
			const img = visualEl.createEl("img", {
				cls: "inkdoc-image-content",
				attr: { src: block.src, alt: "Imagen" }
			});
			img.draggable = false;

			if (isInteractive) {
				const menuEl = blockEl.createDiv({ cls: "inkdoc-object-menu inkdoc-image-block-menu" });
				const deleteButton = menuEl.createEl("button", {
					cls: "inkdoc-object-menu-btn",
					attr: { type: "button", "aria-label": "Borrar imagen", title: "Borrar imagen" }
				});
				setCompatibleIcon(deleteButton, "trash", "D");
				const rotateButton = menuEl.createEl("button", {
					cls: "inkdoc-object-menu-btn",
					attr: { type: "button", "aria-label": "Rotar imagen", title: "Rotar imagen" }
				});
				setCompatibleIcon(rotateButton, "rotate-cw", "R");
				const mirrorButton = menuEl.createEl("button", {
					cls: "inkdoc-object-menu-btn",
					attr: { type: "button", "aria-label": "Invertir imagen", title: "Invertir imagen (espejo)" }
				});
				setCompatibleIcon(mirrorButton, "flip-horizontal", "M");
				deleteButton.addEventListener("click", (event) => {
					if (this.activeTool !== "image") {
						return;
					}
					event.preventDefault();
					event.stopPropagation();
					this.deleteImageBlock(page, pageIndex, block.id);
				});
				rotateButton.addEventListener("pointerdown", (event) => {
					if (this.activeTool !== "image") {
						return;
					}
					if (event.button !== 0) {
						return;
					}
					event.preventDefault();
					event.stopPropagation();
					this.startImageInteraction("rotate", page, block, event);
				});
				mirrorButton.addEventListener("click", (event) => {
					if (this.activeTool !== "image") {
						return;
					}
					event.preventDefault();
					event.stopPropagation();
					this.toggleImageMirror(page, block);
				});

				const menuController = createObjectHoverMenuController(blockEl, {
					setMenuVisible: (visible) => blockEl.classList.toggle("is-menu-visible", visible),
					isEnabled: () => this.activeTool === "image"
				});
				blockEl.addEventListener("pointerenter", menuController.handleHostPointerEnter);
				blockEl.addEventListener("pointerleave", menuController.handleHostPointerLeave);
				blockEl.addEventListener("focusin", menuController.handleHostFocusIn);
				blockEl.addEventListener("focusout", menuController.handleHostFocusOut);
				menuEl.addEventListener("pointerdown", (event) => {
					menuController.handleMenuPointerDown();
					event.stopPropagation();
				});
				menuEl.addEventListener("pointerenter", menuController.handleMenuPointerEnter);
				menuEl.addEventListener("pointerleave", menuController.handleMenuPointerLeave);
				blockEl.addEventListener("click", (event) => {
					const target = event.target;
					if (target instanceof HTMLElement && target.closest(".inkdoc-object-menu")) {
						return;
					}
					menuController.handleHostClick();
				});

				blockEl.addEventListener("contextmenu", (event) => {
					event.preventDefault();
					event.stopPropagation();
					if (this.activeTool === "select") {
						this.selectedImages.set(page.id, new Set([block.id]));
						this.selectedStrokes.set(page.id, new Set());
						this.selectedTextBlocks.set(page.id, new Set());
						this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
						const point = this.getMousePosition(state.canvas, event);
						this.openContextMenu(
							state.canvas,
							page,
							pageIndex,
							event.clientX,
							event.clientY,
							point
						);
						return;
					}
					if (this.activeTool === "image") {
						this.openImageBlockMenu(
							page,
							pageIndex,
							block.id,
							event.clientX,
							event.clientY
						);
					}
				});

				blockEl.addEventListener("pointerdown", (event) => {
					if (event.button !== 0) {
						return;
					}
					event.preventDefault();
					event.stopPropagation();
					if (this.activeTool === "select") {
						this.selectedImages.set(page.id, new Set([block.id]));
						this.selectedStrokes.set(page.id, new Set());
						this.selectedTextBlocks.set(page.id, new Set());
						this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
					}
					this.startImageInteraction("drag", page, block, event);
				});

				if (this.activeTool === "image" || isSelected) {
					const resizeHandle = blockEl.createDiv({
						cls: "inkdoc-image-handle is-resize",
						attr: { "aria-label": "Ajustar imagen", title: "Ajustar imagen" }
					});
					resizeHandle.textContent = "↘";
					resizeHandle.addEventListener("pointerdown", (event) => {
						if (event.button !== 0) {
							return;
						}
						event.preventDefault();
						event.stopPropagation();
						this.startImageInteraction("resize", page, block, event);
					});
				}
			}
		}
		this.imageLayerDirty.delete(page.id);
	}

	private async renderLatexBlock(
		page: InkDocPage,
		container: HTMLDivElement,
		block: InkDocTextBlock
	): Promise<void> {
		container.empty();
		container.style.color = this.getLatexBlockColor(page, block);
		const latex = this.normalizeLatexForRender(block.latex ?? "");
		if (!latex) {
			return;
		}
		try {
			const katexModule = await import("katex");
			const host = container.createDiv({
				cls: "inkdoc-markdown-render inkdoc-markdown-render--math"
			});
			host.innerHTML = katexModule.renderToString(latex, {
				throwOnError: false,
				displayMode: true
			});
		} catch (error) {
			console.error("Error al renderizar LaTeX:", error);
			container.textContent = latex;
		}
	}

	private renderStroke(
		ctx: CanvasRenderingContext2D,
		stroke: InkDocStroke,
		isSelected: boolean,
		options: StrokeRenderOptions = {}
	): void {
		if (stroke.points.length === 0) {
			return;
		}
		ctx.save();
		const brush = this.getBrushPresetByStroke(stroke);
		renderStrokeWithBrush(ctx, stroke, brush, {
			stylusDynamicsEnabled: this.isStylusDynamicsEnabled,
			quality: options.quality
		});
		if (isSelected) {
			ctx.save();
			ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
			ctx.lineWidth = resolveStrokeRenderWidth(stroke, brush) + 2;
			const first = stroke.points[0];
			if (!first) {
				ctx.restore();
				ctx.restore();
				return;
			}
			ctx.beginPath();
			ctx.moveTo(first.x, first.y);
			for (let i = 1; i < stroke.points.length; i++) {
				const point = stroke.points[i];
				if (!point) {
					continue;
				}
				ctx.lineTo(point.x, point.y);
			}
			ctx.stroke();
			ctx.restore();
		}
		ctx.restore();
	}

	private getCanvasSizePx(): { widthPx: number; heightPx: number } {
		const { widthMm, heightMm } = getPageSizeMm(this.docData?.page.size);
		return {
			widthPx: this.mmToPx(widthMm),
			heightPx: this.mmToPx(heightMm)
		};
	}

	private openBackgroundModal(page: InkDocPage, index: number): void {
		const current = resolvePageBackground(page.background);
		const modal = new PageBackgroundModal(this.app, current, (next) => {
			this.setPageBackground(page, index, next);
		});
		modal.open();
	}

	private setPageBackground(
		page: InkDocPage,
		index: number,
		background: InkDocPageBackground
	): void {
		if (!this.docData) {
			return;
		}
		const target =
			this.docData.pages.find((entry) => entry.id === page.id) ?? this.docData.pages[index];
		if (!target) {
			return;
		}
		target.background = background;
		page.background = background;
		const state = this.canvasStates.get(page.id);
		if (state) {
			setPageBackgroundAttribute(state.pageEl, background);
		}
		this.saveDebounced();
	}

	private openPaletteModal(page: InkDocPage, index: number): void {
		const background = resolvePageBackground(page.background);
		const colors = resolvePageColors(page.colors);
		const modal = new PagePaletteModal(this.app, background, colors, (next) => {
			this.setPageColors(page, index, next);
		});
		modal.open();
	}

	private setPageColors(page: InkDocPage, index: number, colors: InkDocPageColors): void {
		if (!this.docData) {
			return;
		}
		const target =
			this.docData.pages.find((entry) => entry.id === page.id) ?? this.docData.pages[index];
		if (!target) {
			return;
		}
		const resolved = resolvePageColors(colors);
		target.colors = resolved;
		page.colors = resolved;
		const state = this.canvasStates.get(page.id);
		if (state) {
			setPageColorVariables(state.pageEl, resolved);
		}
		if (this.activeTool === "latex") {
			this.latexColor = this.getPageDefaultTextColor(page);
			this.updateLatexToolbarUI();
		}
		this.textLayerDirty.add(page.id);
		this.saveDebounced();
	}

	private openPageSizeModal(): void {
		const current = resolvePageSize(this.docData?.page.size);
		const modal = new PageSizeModal(this.app, current, (next) => {
			void this.setDocumentPageSize(next);
		});
		modal.open();
	}

	private async setDocumentPageSize(size: InkDocPageSize): Promise<void> {
		if (!this.docData) {
			return;
		}
		this.docData.page.size = resolvePageSize(size);
		await this.renderDoc(this.docData);
		this.saveDebounced();
	}

	private mmToPx(mm: number): number {
		return Math.max(1, Math.round((mm * 96) / 25.4));
	}

	private resetPendingObjectCreationClick(): void {
		this.pendingObjectCreationClick = null;
	}

	private shouldConfirmObjectCreationOnClick(
		tool: InkDocCreatableObject,
		pageId: string,
		point: InkDocPoint
	): boolean {
		const pending = this.pendingObjectCreationClick;
		const now = Date.now();
		this.pendingObjectCreationClick = {
			tool,
			pageId,
			point: { ...point },
			atMs: now
		};
		if (!pending || pending.tool !== tool || pending.pageId !== pageId) {
			return false;
		}
		if (now - pending.atMs > 1600) {
			return false;
		}
		const dx = point.x - pending.point.x;
		const dy = point.y - pending.point.y;
		return Math.hypot(dx, dy) <= 28;
	}

	private registerCanvasEvents(
		page: InkDocPage,
		index: number,
		ctx: CanvasRenderingContext2D,
		widthPx: number,
		heightPx: number
	): void {
		const state = this.canvasStates.get(page.id);
		if (!state) {
			return;
		}
		let activePointerId: number | null = null;

		const handlePointerDown = (sample: PointerSample) => {
			this.syncEngine.noteActivity();
			const { point, event } = sample;
			if (this.activeTool === "sticky") {
				this.resetPendingObjectCreationClick();
				return;
			}
			if (this.activeTool === "image") {
				if (sample.button !== 0) {
					return;
				}
				if (!this.shouldConfirmObjectCreationOnClick("image", page.id, point)) {
					return;
				}
				void this.confirmAndOpenImagePicker(page, index, point);
				return;
			}
			if (this.isTextLikeTool()) {
				this.handleTextPointerDown(page, index, point, event);
				return;
			}
			if (activePointerId !== null && activePointerId !== sample.pointerId) {
				state.isDrawing = false;
				state.currentStrokeId = null;
				activePointerId = null;
			}
			if (this.isStrokeTool()) {
				state.isDrawing = true;
				activePointerId = sample.pointerId;
				const strokeId = createStrokeId();
				state.currentStrokeId = strokeId;
				state.canvas.setPointerCapture(event.pointerId);
				this.appendStrokePoint(page, index, strokeId, point, true, sample);
				this.renderActiveStrokePreview(page, strokeId);
				return;
			}
			if (this.activeTool === "eraser") {
				state.isDrawing = true;
				activePointerId = sample.pointerId;
				state.currentStrokeId = null;
				state.canvas.setPointerCapture(event.pointerId);
				this.eraseAtPoint(page, index, point, widthPx, heightPx);
				return;
			}
			if (this.activeTool === "select") {
				if (sample.button !== 0) {
					return;
				}
				state.isDrawing = true;
				activePointerId = sample.pointerId;
				const selectionBounds = this.getSelectionBounds(page);
				const isInsideSelection = selectionBounds ? pointInRect(point, selectionBounds) : false;
				if (!isInsideSelection) {
					const imageHit = this.findImageBlockHit(page, index, point);
					if (imageHit) {
						this.selectedImages.set(page.id, new Set([imageHit.id]));
						this.selectedStrokes.set(page.id, new Set());
						this.selectedTextBlocks.set(page.id, new Set());
						state.selection.isSelecting = true;
						state.selection.isDragging = true;
						state.selection.lastDragPoint = point;
						state.selection.start = null;
						state.selection.current = null;
						state.canvas.setPointerCapture(event.pointerId);
						this.renderStrokes(ctx, page.strokes ?? [], page.id);
						return;
					}
				}
				state.selection.isSelecting = true;
				state.selection.isDragging = isInsideSelection;
				state.selection.lastDragPoint = point;
				if (!isInsideSelection) {
					this.clearSelection(page.id);
					state.selection.start = point;
					state.selection.current = point;
				} else {
					state.selection.start = null;
					state.selection.current = null;
				}
				state.canvas.setPointerCapture(event.pointerId);
				this.renderStrokes(ctx, page.strokes ?? [], page.id);
				return;
			}
		};

		const handlePointerMove = (sample: PointerSample) => {
			this.syncEngine.noteActivity();
			const { point } = sample;
			if (this.isTextLikeTool()) {
				this.handleTextPointerMove(page, index, point);
				return;
			}
			if (this.isStrokeTool()) {
				if (activePointerId !== null && sample.pointerId !== activePointerId) {
					return;
				}
				if (!state.isDrawing || !state.currentStrokeId) {
					return;
				}
				this.appendStrokePoint(page, index, state.currentStrokeId, point, false, sample);
				this.renderActiveStrokePreview(page, state.currentStrokeId);
				return;
			}
			if (this.activeTool === "eraser" && state.isDrawing) {
				if (activePointerId !== null && sample.pointerId !== activePointerId) {
					return;
				}
				this.eraseAtPoint(page, index, point, widthPx, heightPx);
					this.requestPageRender(page.id, this.getInteractiveRenderQuality());
			}
			if (this.activeTool === "select" && state.selection.isSelecting) {
				if (activePointerId !== null && sample.pointerId !== activePointerId) {
					return;
				}
				if (state.selection.isDragging) {
					this.dragSelection(page, index, point);
				} else {
					state.selection.current = point;
					this.updateSelectionFromRect(page, state.selection.start, point);
				}
					this.requestPageRender(page.id, this.getInteractiveRenderQuality());
			}
		};

		const handlePointerUp = (sample: PointerSample) => {
			this.syncEngine.noteActivity();
			const { event } = sample;
			if (
				(this.isStrokeTool() || this.activeTool === "eraser" || this.activeTool === "select") &&
				activePointerId !== null &&
				sample.pointerId !== activePointerId
			) {
				return;
			}
			state.isDrawing = false;
			state.currentStrokeId = null;
			activePointerId = null;
			if (this.isTextLikeTool()) {
				this.handleTextPointerUp(page);
				return;
			}
			if (this.isStrokeTool()) {
				this.flushPageRender(page.id);
			} else {
				this.clearStrokePreview(page.id);
				this.flushPageRender(page.id);
			}
			this.saveDebounced();
			if (
				(this.isStrokeTool() || this.activeTool === "eraser") &&
				state.canvas.hasPointerCapture(event.pointerId)
			) {
				state.canvas.releasePointerCapture(event.pointerId);
			}
			if (this.activeTool === "select") {
				if (state.selection.isDragging) {
					this.dropSelectionOnPage(page, index, event);
				}
				state.selection.isSelecting = false;
				state.selection.isDragging = false;
				state.selection.lastDragPoint = null;
				state.selection.start = null;
				state.selection.current = null;
				if (state.canvas.hasPointerCapture(event.pointerId)) {
					state.canvas.releasePointerCapture(event.pointerId);
				}
				this.renderStrokes(ctx, page.strokes ?? [], page.id);
			}
		};

		const handleContextMenu = (event: MouseEvent) => {
			event.preventDefault();
			const openTextMenu = this.contentEl.querySelector<HTMLDivElement>(".inkdoc-text-context-menu");
			if (openTextMenu) {
				this.closeTextBlockMenu();
				return;
			}
			const point = this.getMousePosition(state.canvas, event);
			if (this.isTextLikeTool()) {
				this.openTextBlockMenu(page, index, point, event.clientX, event.clientY);
				return;
			}
			const selected = this.selectedStrokes.get(page.id);
			const selectedBlocks = this.selectedTextBlocks.get(page.id);
			if (
				(!selected || selected.size === 0) &&
				(!selectedBlocks || selectedBlocks.size === 0) &&
				!this.hasAnySelection()
			) {
				this.closeContextMenu();
				return;
			}
			if (this.activeTool !== "select") {
				this.closeContextMenu();
				return;
			}
			this.openContextMenu(state.canvas, page, index, event.clientX, event.clientY, point);
		};
		const inputController = new InputController(
			state.canvas,
			(canvas, event) => this.getPointerPosition(canvas, event),
			{
				onPointerDown: handlePointerDown,
				onPointerMove: handlePointerMove,
				onPointerUp: handlePointerUp,
				onContextMenu: handleContextMenu,
				onStylusAvailabilityChange: (available) => {
					this.stylusAvailable = available;
					this.updatePencilMenuUI();
				}
			},
			{
				isPalmRejectionEnabled: () => this.isStrokeTool(),
				preferLowLatency: () => this.isLowLatencyModeEnabled
			}
		);
		inputController.attach();

		const cleanup = () => {
			inputController.dispose();
		};
		this.canvasCleanups.set(page.id, cleanup);
	}

	private appendStrokePoint(
		page: InkDocPage,
		index: number,
		strokeId: string,
		point: InkDocPoint,
		start: boolean,
		sample: PointerSample
	): void {
		if (!this.docData) {
			return;
		}
		const target =
			this.docData.pages.find((entry) => entry.id === page.id) ?? this.docData.pages[index];
		if (!target) {
			return;
		}
		if (!target.strokes) {
			target.strokes = [];
		}
		const activeBrush = this.getActiveBrushPreset();
		const normalizedPoint: InkDocPoint = {
			x: point.x,
			y: point.y,
			pressure:
				sample.isStylus && this.isStylusDynamicsEnabled ? sample.point.pressure : undefined,
			tiltX: sample.isStylus && this.isStylusDynamicsEnabled ? sample.point.tiltX : undefined,
			tiltY: sample.isStylus && this.isStylusDynamicsEnabled ? sample.point.tiltY : undefined
		};
		if (start) {
			const stroke: InkDocStroke = {
				id: strokeId,
				points: [normalizedPoint],
				color: this.strokeColor,
				width: this.strokeWidth,
				opacity: this.strokeOpacity,
				style: resolveInkDocStrokeStyle(this.strokeStyle || activeBrush.style),
				tool: activeBrush.tool === "highlighter" ? "highlighter" : "pen",
				brushId: activeBrush.id,
				smoothing: this.strokeSmoothing,
				stabilizer: this.isStrokeStabilizationEnabled ? this.strokeStabilizer : 0
			};
			target.strokes.push(stroke);
			page.strokes = target.strokes;
			return;
		}
		const stroke = target.strokes.find((entry) => entry.id === strokeId);
		if (!stroke) {
			return;
		}
		const stabilizationAmount =
			typeof stroke.stabilizer === "number" ? stroke.stabilizer : this.strokeStabilizer;
		const effectiveStabilization = this.isLowLatencyModeEnabled
			? Math.min(stabilizationAmount, 0.24)
			: stabilizationAmount;
		if (effectiveStabilization <= 0) {
			stroke.points.push(normalizedPoint);
		} else {
			const last = stroke.points.length > 0 ? stroke.points[stroke.points.length - 1] ?? null : null;
			const stabilized = stabilizePoint(last, normalizedPoint, effectiveStabilization);
			stroke.points.push(stabilized);
		}
		page.strokes = target.strokes;
	}

	private getPointerPosition(canvas: HTMLCanvasElement, event: PointerEvent): InkDocPoint {
		const rect = canvas.getBoundingClientRect();
		const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
		const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
		const dpr = window.devicePixelRatio || 1;
		return {
			x: x / dpr,
			y: y / dpr
		};
	}

	private getMousePosition(canvas: HTMLCanvasElement, event: MouseEvent): InkDocPoint {
		const rect = canvas.getBoundingClientRect();
		const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
		const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
		const dpr = window.devicePixelRatio || 1;
		return { x: x / dpr, y: y / dpr };
	}

	private getClientPointOnCanvas(
		canvas: HTMLCanvasElement,
		clientX: number,
		clientY: number
	): InkDocPoint {
		const rect = canvas.getBoundingClientRect();
		const x = ((clientX - rect.left) / rect.width) * canvas.width;
		const y = ((clientY - rect.top) / rect.height) * canvas.height;
		const dpr = window.devicePixelRatio || 1;
		return {
			x: x / dpr,
			y: y / dpr
		};
	}

	private getClientPointOnPagesContent(clientX: number, clientY: number): { x: number; y: number } | null {
		if (!this.pagesContentEl) {
			return null;
		}
		const zoom = Math.max(0.001, this.zoomLevel || 1);
		const rect = this.pagesContentEl.getBoundingClientRect();
		const rawX = (clientX - rect.left) / zoom;
		const rawY = (clientY - rect.top) / zoom;
		const maxX = Math.max(0, rect.width / zoom);
		const maxY = Math.max(0, rect.height / zoom);
		return {
			x: Math.max(0, Math.min(maxX, rawX)),
			y: Math.max(0, Math.min(maxY, rawY))
		};
	}

	private createStickyNote(point: { x: number; y: number }) {
		const anchor = this.getStickyNotesAnchorOffset();
		const note = createStickyNoteAtPoint(this.docData, {
			x: point.x - anchor.x,
			y: point.y - anchor.y
		});
		if (!note) {
			return null;
		}
		this.saveDebounced();
		return note;
	}

	private registerToolbarDragCreate(
		button: HTMLButtonElement,
		tool: InkDocCreatableObject
	): void {
		button.addEventListener("pointerdown", (event) => {
			if (event.button !== 0) {
				return;
			}
			this.setActiveTool(tool);
			this.closePencilMenu();
			this.toolbarDragCreateSession = {
				tool,
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY
			};
			if (this.toolbarDragCreateCleanup) {
				this.toolbarDragCreateCleanup();
			}
			this.toolbarDragCreateCleanup = startWindowPointerInteraction({
				onMove: () => {},
				onEnd: (upEvent) => {
					const session = this.toolbarDragCreateSession;
					this.toolbarDragCreateSession = null;
					this.toolbarDragCreateCleanup = null;
					if (!session || upEvent.pointerId !== session.pointerId) {
						return;
					}
					const moved =
						Math.abs(upEvent.clientX - session.startX) >= 8 ||
						Math.abs(upEvent.clientY - session.startY) >= 8;
					if (!moved) {
						return;
					}
					void this.createObjectFromToolbarDragDrop(session.tool, upEvent.clientX, upEvent.clientY);
				}
			});
		});
	}

	private resolveCanvasDropTarget(
		clientX: number,
		clientY: number
	): { page: InkDocPage; pageIndex: number; point: InkDocPoint } | null {
		if (!this.docData) {
			return null;
		}
		for (let index = 0; index < this.docData.pages.length; index++) {
			const page = this.docData.pages[index];
			if (!page) {
				continue;
			}
			const state = this.canvasStates.get(page.id);
			if (!state) {
				continue;
			}
			const rect = state.canvas.getBoundingClientRect();
			if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
				continue;
			}
			return {
				page,
				pageIndex: index,
				point: this.getClientPointOnCanvas(state.canvas, clientX, clientY)
			};
		}
		return null;
	}

	private async createObjectFromToolbarDragDrop(
		tool: InkDocCreatableObject,
		clientX: number,
		clientY: number
	): Promise<void> {
		if (!this.docData) {
			return;
		}
		this.setActiveTool(tool);
		if (tool === "sticky") {
			const point = this.getClientPointOnPagesContent(clientX, clientY);
			if (!point) {
				return;
			}
			const note = this.createStickyNote(point);
			if (!note) {
				return;
			}
			this.renderStickyNotes();
			this.openStickyNoteEditor(note.id);
			return;
		}
		const target = this.resolveCanvasDropTarget(clientX, clientY);
		if (!target) {
			return;
		}
		if (tool === "image") {
			await this.openImagePicker(target.page, target.pageIndex, target.point);
			return;
		}
		this.closeTextEditor(true);
		this.closeLatexEditor(true);
		const block =
			tool === "latex"
				? this.createLatexBlock(target.page, target.pageIndex, target.point)
				: this.createTextBlock(target.page, target.pageIndex, target.point);
		const state = this.canvasStates.get(target.page.id);
		if (state) {
			this.renderStrokes(state.ctx, target.page.strokes ?? [], target.page.id);
		}
		if (tool === "latex") {
			this.openLatexEditor(target.page, target.pageIndex, block);
		} else {
			this.openTextEditor(target.page, target.pageIndex, block);
		}
	}

	private openStickyNoteEditor(noteId: string): void {
		window.requestAnimationFrame(() => {
			const noteEl = this.pagesContentEl?.querySelector<HTMLElement>(`.inkdoc-sticky-note[data-note-id="${noteId}"]`);
			if (!noteEl) {
				return;
			}
			noteEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
		});
	}

	private renderStickyNotes(): void {
		renderStickyNotesLayer(this.stickyNotesRuntime, {
			docData: this.docData,
			hostEl: this.pagesContentEl,
			isToolActive: () => this.activeTool === "sticky",
			getZoomLevel: () => this.zoomLevel,
			getAnchorOffset: () => this.getStickyNotesAnchorOffset(),
			saveDebounced: () => this.saveDebounced(),
			noteActivity: () => this.syncEngine.noteActivity(),
			onInteractionStateChange: (isActive) => {
				this.isStickyNoteInteracting = isActive;
			},
			onTextEditorChange: (editor) => {
				this.stickyTextEditorEl = editor;
				this.updateTextToolbarVisibility();
			},
			isToolbarInteraction: () => this.isTextToolbarInteraction
		});
	}

	private getStickyNotesAnchorOffset(): { x: number; y: number } {
		if (!this.docData || this.docData.pages.length === 0) {
			return { x: 0, y: 0 };
		}
		const firstPageId = this.docData.pages[0]?.id;
		if (!firstPageId) {
			return { x: 0, y: 0 };
		}
		const firstState = this.canvasStates.get(firstPageId);
		if (!firstState) {
			return { x: 0, y: 0 };
		}
		return {
			x: firstState.pageEl.offsetLeft,
			y: firstState.pageEl.offsetTop
		};
	}

	private setActiveTool(tool: InkDocTool): void {
		const previousTool = this.activeTool;
		const wasText = previousTool === "text";
		const wasLatex = previousTool === "latex";
		this.activeTool = tool;
		this.resetPendingObjectCreationClick();
		if (wasText && tool !== "text") {
			this.closeTextEditor(true);
			this.closeTextBlockMenu();
		}
		if (wasLatex && tool !== "latex") {
			this.closeLatexEditor(true);
		}
		if (previousTool !== tool && this.docData) {
			for (const page of this.docData.pages) {
				this.textLayerDirty.add(page.id);
				this.imageLayerDirty.add(page.id);
			}
		}
		if (tool === "pen" || tool === "highlighter" || tool === "eraser") {
			const currentBrush = this.getActiveBrushPreset();
			if (currentBrush.tool !== tool) {
				const fallback = this.brushRegistry
					.list()
					.find((preset) => preset.tool === tool);
				if (fallback) {
					this.activeBrushId = fallback.id;
					this.strokeWidth = fallback.defaultWidth;
					this.strokeOpacity = fallback.defaultOpacity;
					this.strokeStyle = fallback.style;
					this.strokeSmoothing = fallback.smoothing;
					this.strokeStabilizer = fallback.stabilizer;
				}
			}
		}
		this.updateToolButtons();
		this.updateHandToolState();
		this.updatePageInputMode();
		this.updatePencilMenuVisibility();
		this.updatePencilMenuUI();
		this.updateTextToolbarVisibility();
		this.renderAllCanvases();
		this.renderStickyNotes();
	}

	private updatePageInputMode(): void {
		for (const state of this.canvasStates.values()) {
			state.canvas.style.pointerEvents = "auto";
		}
	}

	private renderAllCanvases(): void {
		if (!this.docData) {
			return;
		}
		for (const page of this.docData.pages) {
			const state = this.canvasStates.get(page.id);
			if (!state) {
				continue;
			}
			this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
		}
	}

	private handleTextPointerDown(
		page: InkDocPage,
		index: number,
		point: InkDocPoint,
		event: PointerEvent
	): void {
		const state = this.canvasStates.get(page.id);
		if (!state) {
			return;
		}
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		const hadActiveEdit =
			this.activeTool === "text"
				? Boolean(this.activeTextEdit) || Boolean(this.textEditorEl)
				: Boolean(this.activeLatexEdit) || Boolean(this.latexEditorEl);
		if (this.activeTool === "text") {
			this.closeTextEditor(true);
		} else {
			this.closeLatexEditor(true);
		}
		if (hadActiveEdit) {
			return;
		}
		const resizeHit = this.findTextBlockResizeHit(page, index, point);
		if (resizeHit && this.isBlockCompatibleWithTool(resizeHit, this.activeTool)) {
			state.text.isResizing = true;
			state.text.resizingId = resizeHit.id;
			state.text.resizeStartPoint = point;
			state.text.resizeStartSize = { w: resizeHit.w, h: resizeHit.h };
			return;
		}
		const handleHit = this.findTextBlockHandleHit(page, index, point);
		if (handleHit && this.isBlockCompatibleWithTool(handleHit, this.activeTool)) {
			state.text.isDragging = true;
			state.text.draggingId = handleHit.id;
			state.text.dragOffset = { x: point.x - handleHit.x, y: point.y - handleHit.y };
			return;
		}
		const blockHit = this.findTextBlockHit(page, index, point);
		if (blockHit && this.isBlockCompatibleWithTool(blockHit, this.activeTool)) {
			state.text.isDragging = true;
			state.text.draggingId = blockHit.id;
			state.text.dragOffset = { x: point.x - blockHit.x, y: point.y - blockHit.y };
			return;
		}
		if (!this.shouldConfirmObjectCreationOnClick(this.activeTool, page.id, point)) {
			return;
		}
		void this.confirmAndCreateTextLikeBlock(page, index, point);
	}

	private async requestObjectCreationConfirmation(
		objectType: InkDocCreatableObject
	): Promise<boolean> {
		if (this.isObjectCreationPromptOpen) {
			return false;
		}
		this.isObjectCreationPromptOpen = true;
		try {
			return await openObjectCreationPrompt(this.app, objectType);
		} finally {
			this.isObjectCreationPromptOpen = false;
		}
	}

	private async confirmAndCreateStickyNote(point: { x: number; y: number }): Promise<void> {
		const shouldCreate = await this.requestObjectCreationConfirmation("sticky");
		this.resetPendingObjectCreationClick();
		if (!shouldCreate || this.activeTool !== "sticky") {
			return;
		}
		const note = this.createStickyNote(point);
		if (!note) {
			return;
		}
		this.renderStickyNotes();
	}

	private async confirmAndOpenImagePicker(
		page: InkDocPage,
		index: number,
		point: InkDocPoint
	): Promise<void> {
		const shouldCreate = await this.requestObjectCreationConfirmation("image");
		this.resetPendingObjectCreationClick();
		if (!shouldCreate || this.activeTool !== "image") {
			return;
		}
		await this.openImagePicker(page, index, point);
	}

	private async confirmAndCreateTextLikeBlock(
		page: InkDocPage,
		index: number,
		point: InkDocPoint
	): Promise<void> {
		const tool = this.activeTool;
		if (!this.isTextLikeTool(tool)) {
			return;
		}
		const shouldCreate = await this.requestObjectCreationConfirmation(tool);
		this.resetPendingObjectCreationClick();
		if (!shouldCreate || this.activeTool !== tool) {
			return;
		}
		const state = this.canvasStates.get(page.id);
		if (!state) {
			return;
		}
		const createdBlock =
			tool === "latex"
				? this.createLatexBlock(page, index, point)
				: this.createTextBlock(page, index, point);
		this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
		if (tool === "latex") {
			this.openLatexEditor(page, index, createdBlock);
			return;
		}
		this.openTextEditor(page, index, createdBlock);
	}

	private handleTextPointerMove(page: InkDocPage, index: number, point: InkDocPoint): void {
		const state = this.canvasStates.get(page.id);
		if (!state) {
			return;
		}
		if (state.text.isResizing && state.text.resizingId && state.text.resizeStartPoint && state.text.resizeStartSize) {
			const block = this.getTextBlockById(page, index, state.text.resizingId);
			if (!block) {
				return;
			}
			if (!this.isBlockCompatibleWithTool(block, this.activeTool)) {
				return;
			}
			const dx = point.x - state.text.resizeStartPoint.x;
			const dy = point.y - state.text.resizeStartPoint.y;
			block.w = Math.max(INKDOC_TEXT_MIN_WIDTH, state.text.resizeStartSize.w + dx);
			block.h = Math.max(INKDOC_TEXT_MIN_HEIGHT, state.text.resizeStartSize.h + dy);
			this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
			return;
		}
		if (!state.text.isDragging || !state.text.draggingId || !state.text.dragOffset) {
			return;
		}
		const block = this.getTextBlockById(page, index, state.text.draggingId);
		if (!block) {
			return;
		}
		if (!this.isBlockCompatibleWithTool(block, this.activeTool)) {
			return;
		}
		block.x = point.x - state.text.dragOffset.x;
		block.y = point.y - state.text.dragOffset.y;
		this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
	}

	private handleTextPointerUp(page: InkDocPage): void {
		const state = this.canvasStates.get(page.id);
		if (!state) {
			return;
		}
		if (state.text.isResizing) {
			state.text.isResizing = false;
			state.text.resizingId = null;
			state.text.resizeStartPoint = null;
			state.text.resizeStartSize = null;
			this.saveDebounced();
		}
		if (state.text.isDragging) {
			state.text.isDragging = false;
			state.text.draggingId = null;
			state.text.dragOffset = null;
			this.saveDebounced();
		}
	}

	private getTextBlocks(page: InkDocPage, index: number): InkDocTextBlock[] {
		return ensureTextBlocks(this.docData, page, index);
	}

	private getImageBlocks(page: InkDocPage, index: number): InkDocImageBlock[] {
		return ensureImageBlocks(this.docData, page, index);
	}

	private getBlockType(block: InkDocTextBlock): "text" | "latex" {
		return getTextBlockType(block);
	}

	private isBlockCompatibleWithTool(block: InkDocTextBlock, tool: InkDocTool): boolean {
		return isTextBlockCompatibleWithTool(block, tool);
	}

	private getTextBlockById(
		page: InkDocPage,
		index: number,
		blockId: string
	): InkDocTextBlock | null {
		return getTextBlockByIdInPage(this.docData, page, index, blockId);
	}

	private findTextBlockHit(
		page: InkDocPage,
		index: number,
		point: InkDocPoint
	): InkDocTextBlock | null {
		return findTextBlockHitInPage(this.docData, page, index, point);
	}

	private findImageBlockHit(
		page: InkDocPage,
		index: number,
		point: InkDocPoint
	): InkDocImageBlock | null {
		return findImageBlockHitInPage(this.docData, page, index, point);
	}

	private findTextBlockHandleHit(
		page: InkDocPage,
		index: number,
		point: InkDocPoint
	): InkDocTextBlock | null {
		return findTextBlockHandleHitInPage(this.docData, page, index, point);
	}

	private findTextBlockResizeHit(
		page: InkDocPage,
		index: number,
		point: InkDocPoint
	): InkDocTextBlock | null {
		return findTextBlockResizeHitInPage(this.docData, page, index, point);
	}

	private createTextBlock(page: InkDocPage, index: number, point: InkDocPoint): InkDocTextBlock {
		const block = addTextBlock(this.docData, page, index, point);
		this.textLayerDirty.add(page.id);
		this.saveDebounced();
		return block;
	}

	private createLatexBlock(page: InkDocPage, index: number, point: InkDocPoint): InkDocTextBlock {
		const block = addLatexBlock(this.docData, page, index, point);
		this.textLayerDirty.add(page.id);
		this.saveDebounced();
		return block;
	}

	private async createImageBlock(
		page: InkDocPage,
		index: number,
		point: InkDocPoint,
		src: string
	): Promise<InkDocImageBlock | null> {
		const imageSize = await loadImageSize(src);
		if (!imageSize) {
			return null;
		}
		const maxWidth = 260;
		const maxHeight = 200;
		const scale = Math.min(1, maxWidth / imageSize.width, maxHeight / imageSize.height);
		const w = Math.max(INKDOC_IMAGE_MIN_WIDTH, Math.round(imageSize.width * scale));
		const h = Math.max(INKDOC_IMAGE_MIN_HEIGHT, Math.round(imageSize.height * scale));
		const blocks = this.getImageBlocks(page, index);
		const block: InkDocImageBlock = {
			id: createImageBlockId(),
			x: point.x - w / 2,
			y: point.y - h / 2,
			w,
			h,
			src,
			rotation: 0,
			skewX: 0,
			skewY: 0,
			flipX: false
		};
		blocks.push(block);
		page.images = blocks;
		this.imageLayerDirty.add(page.id);
		this.saveDebounced();
		return block;
	}

	private openTextEditor(page: InkDocPage, index: number, block: InkDocTextBlock): void {
		openTextEditorInstance(this.getTextEditingContext(), this.getTextEditingAccessors(), page, index, block);
	}

	private toggleImageMirror(page: InkDocPage, block: InkDocImageBlock): void {
		block.flipX = !(block.flipX === true);
		this.imageLayerDirty.add(page.id);
		const state = this.canvasStates.get(page.id);
		if (state) {
			this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
		}
		this.saveDebounced();
	}

	private openLatexEditor(page: InkDocPage, index: number, block: InkDocTextBlock): void {
		this.latexColor = this.getLatexBlockColor(page, block);
		openLatexEditorInstance(this.getTextEditingContext(), this.getTextEditingAccessors(), page, index, block);
		this.updateLatexToolbarUI();
	}

	private openInkMathModalForLatexBlock(page: InkDocPage, pageIndex: number, blockId: string): void {
		const block = page.textBlocks?.find((entry) => entry.id === blockId);
		if (!block || this.getBlockType(block) !== "latex") {
			return;
		}
		const firstPage = this.docData?.pages[0];
		const firstPageColors = resolvePageColors(firstPage?.colors);
		new InkMathModal(this.app, {
			backgroundColor: firstPageColors.background,
			serviceUrl: this.plugin.getInkMathServiceUrl(),
			initialOcrDebounceMs: this.plugin.getInkMathDebounceMs(),
			onAccept: (latex) => {
				void this.applyInkMathLatexToBlock(page.id, pageIndex, blockId, latex);
			}
		}).open();
	}

	private async applyInkMathLatexToBlock(
		pageId: string,
		pageIndex: number,
		blockId: string,
		latex: string
	): Promise<void> {
		if (!this.docData) {
			return;
		}
		const page = this.docData.pages.find((entry) => entry.id === pageId) ?? this.docData.pages[pageIndex];
		if (!page) {
			return;
		}
		const block = page.textBlocks?.find((entry) => entry.id === blockId);
		if (!block || this.getBlockType(block) !== "latex") {
			return;
		}
		block.latex = latex;
		await this.fitLatexBlockToRender(page, block);
		this.textLayerDirty.add(page.id);
		const state = this.canvasStates.get(page.id);
		if (state) {
			this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
		}
		this.saveDebounced();
	}

	private async fitLatexBlockToRender(page: InkDocPage, block: InkDocTextBlock): Promise<void> {
		const latex = this.normalizeLatexForRender(block.latex ?? "");
		if (!latex) {
			return;
		}
		const host = document.createElement("div");
		const content = document.createElement("div");
		host.className = "inkdoc-text-block is-latex";
		content.className = "inkdoc-text-block-content";
		host.style.position = "fixed";
		host.style.left = "-10000px";
		host.style.top = "0";
		host.style.visibility = "hidden";
		host.style.pointerEvents = "none";
		host.style.width = "fit-content";
		host.style.height = "fit-content";
		content.style.width = "fit-content";
		content.style.height = "fit-content";
		content.style.overflow = "visible";
		content.style.color = this.getLatexBlockColor(page, block);
		host.appendChild(content);
		document.body.appendChild(host);
		try {
			const katexModule = await import("katex");
			const mathHost = content.createDiv({
				cls: "inkdoc-markdown-render inkdoc-markdown-render--math"
			});
			mathHost.innerHTML = katexModule.renderToString(latex, {
				throwOnError: false,
				displayMode: true
			});
			const rect = content.getBoundingClientRect();
			const measuredWidth = Math.ceil(rect.width);
			const measuredHeight = Math.ceil(rect.height);
			if (Number.isFinite(measuredWidth) && measuredWidth > 0) {
				block.w = Math.max(INKDOC_TEXT_MIN_WIDTH, measuredWidth);
			}
			if (Number.isFinite(measuredHeight) && measuredHeight > 0) {
				block.h = Math.max(INKDOC_TEXT_MIN_HEIGHT, measuredHeight);
			}
		} catch (error) {
			console.error("No se pudo ajustar tamaño de bloque LaTeX tras InkMath:", error);
		} finally {
			host.remove();
		}
	}

	private async handleLatexBlockCommitted(page: InkDocPage, block: InkDocTextBlock): Promise<void> {
		await this.fitLatexBlockToRender(page, block);
		this.textLayerDirty.add(page.id);
		const state = this.canvasStates.get(page.id);
		if (state) {
			this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
		}
		this.saveDebounced();
	}

	private closeTextEditor(commit: boolean): void {
		closeTextEditorInstance(this.getTextEditingContext(), this.getTextEditingAccessors(), commit);
	}

	private closeLatexEditor(commit: boolean): void {
		closeLatexEditorInstance(this.getTextEditingContext(), this.getTextEditingAccessors(), commit);
	}

	private setStrokeWidth(width: number): void {
		const brush = this.getActiveBrushPreset();
		const rounded = Math.max(1, Math.round(width));
		this.strokeWidth = Math.max(brush.minWidth, Math.min(brush.maxWidth, rounded));
		this.updatePencilMenuUI();
	}

	private setStrokeColor(color: string): void {
		this.strokeColor = color;
		this.pushRecentStrokeColor(color);
		this.updatePencilMenuUI();
	}

	private setStrokeOpacity(opacity: number): void {
		this.strokeOpacity = Math.max(0.05, Math.min(1, opacity));
		this.updatePencilMenuUI();
	}

	private setStrokeSmoothing(value: number): void {
		this.strokeSmoothing = Math.max(0, Math.min(1, value));
		this.updatePencilMenuUI();
	}

	private setStrokeStabilizer(value: number): void {
		this.strokeStabilizer = Math.max(0, Math.min(1, value));
		this.updatePencilMenuUI();
	}

	private setStrokeStyle(style: InkDocStrokeStyle): void {
		this.strokeStyle = resolveInkDocStrokeStyle(style);
		this.updatePencilMenuUI();
	}

	private getActiveBrushPreset(): BrushPreset {
		return this.brushRegistry.get(this.activeBrushId);
	}

	private getBrushPresetByStroke(stroke: InkDocStroke): BrushPreset {
		if (stroke.brushId) {
			return this.brushRegistry.get(stroke.brushId);
		}
		if (stroke.tool === "highlighter") {
			return this.brushRegistry.get("highlighter");
		}
		return this.brushRegistry.get("monoline");
	}

	private setActiveBrush(brushId: string): void {
		const preset = this.brushRegistry.get(brushId);
		this.activeBrushId = preset.id;
		const resolvedWidth = Number.isFinite(this.strokeWidth) ? this.strokeWidth : preset.defaultWidth;
		this.strokeWidth = Math.max(preset.minWidth, Math.min(preset.maxWidth, resolvedWidth));
		this.strokeOpacity = preset.defaultOpacity;
		this.strokeStyle = preset.style;
		this.strokeSmoothing = preset.smoothing;
		this.strokeStabilizer = preset.stabilizer;
		if (preset.tool === "eraser") {
			this.setActiveTool("eraser");
		} else if (preset.tool === "highlighter") {
			this.setActiveTool("highlighter");
		} else {
			this.setActiveTool("pen");
		}
		this.updatePencilMenuUI();
	}

	private updateActiveBrushDynamics(
		changes: Partial<Pick<BrushPreset, "pressureResponse" | "velocityInfluence" | "taperStrength">>
	): void {
		const active = this.getActiveBrushPreset();
		const next = this.brushRegistry.update(active.id, (current) => ({
			...current,
			pressureResponse:
				typeof changes.pressureResponse === "number"
					? Math.max(0.35, Math.min(1.3, changes.pressureResponse))
					: current.pressureResponse,
			velocityInfluence:
				typeof changes.velocityInfluence === "number"
					? Math.max(0, Math.min(1, changes.velocityInfluence))
					: current.velocityInfluence,
			taperStrength:
				typeof changes.taperStrength === "number"
					? Math.max(0, Math.min(1, changes.taperStrength))
					: current.taperStrength
		}));
		this.activeBrushId = next.id;
		this.updatePencilMenuUI();
		this.renderAllCanvases();
	}

	private pushRecentStrokeColor(color: string): void {
		const normalized = color.trim();
		if (!normalized) {
			return;
		}
		this.ensureRecentStrokeColors();
		this.recentStrokeColors = [normalized, ...this.recentStrokeColors.filter((entry) => entry !== normalized)]
			.slice(0, 12);
	}

	private updateToolButtons(): void {
		if (!this.toolbarEl) {
			return;
		}
		const buttons = this.toolbarEl.querySelectorAll<HTMLButtonElement>("button[data-tool]");
		buttons.forEach((button) => {
			const isActive = button.dataset.tool === this.activeTool;
			button.classList.toggle("is-active", isActive);
		});
	}

	private updateHandToolState(): void {
		if (!this.pagesEl) {
			return;
		}
		this.pagesEl.classList.toggle("is-hand-tool", this.activeTool === "hand");
		this.pagesEl.classList.toggle("is-select-tool", this.activeTool === "select");
		if (this.activeTool !== "hand") {
			this.pagesEl.classList.remove("is-panning");
			this.isPanning = false;
			this.panStart = null;
			this.panScrollStart = null;
		}
	}

	private handleSelectionStart(page: InkDocPage, point: InkDocPoint): void {
		handleSelectionStartBlocks(this.getSelectionMovementContext(), page, point);
	}

	private updateSelectionFromRect(page: InkDocPage, start: InkDocPoint | null, current: InkDocPoint): void {
		updateSelectionFromRectMaps(
			{
				strokes: this.selectedStrokes,
				textBlocks: this.selectedTextBlocks,
				images: this.selectedImages
			},
			page,
			start,
			current
		);
	}

	private dragSelection(page: InkDocPage, index: number, point: InkDocPoint): void {
		dragSelectionBlocks(this.getSelectionMovementContext(), page, index, point);
	}

	private dropSelectionOnPage(page: InkDocPage, index: number, event: PointerEvent): void {
		dropSelectionOnPageBlocks(this.getSelectionMovementContext(), page, index, event);
	}

	private moveSelectionToPoint(page: InkDocPage, index: number, point: InkDocPoint): void {
		moveSelectionToPointBlocks(this.getSelectionMovementContext(), page, index, point);
	}

	private getTextEditingContext(): TextEditingContext {
		return {
			docData: this.docData,
			canvasStates: this.canvasStates,
			textLayerDirty: this.textLayerDirty,
			zoomLevel: this.zoomLevel,
			getCanvasSizePx: () => this.getCanvasSizePx(),
			renderStrokes: (ctx, strokes, pageId) => this.renderStrokes(ctx, strokes, pageId),
			saveDebounced: () => this.saveDebounced(),
			noteUserActivity: () => this.syncEngine.noteActivity(),
			updateTextToolbarVisibility: () => this.updateTextToolbarVisibility(),
			getDefaultBlockColor: (page) => this.getPageDefaultTextColor(page),
			getWikiLinkTargets: () => this.getInkdocWikiLinkTargets(),
			onLatexCommitted: (page, block) => {
				void this.handleLatexBlockCommitted(page, block);
			}
		};
	}

	private getInkdocWikiLinkTargets(): MarkdownWikiLinkTarget[] {
		const files = this.app.vault.getFiles();
		const rootPath = this.app.vault.getRoot().path.replace(/\\/g, "/").replace(/\/+$/, "");
		const titleCounts = new Map<string, number>();
		const normalized = files.map((file) => {
			const normalizedPath = file.path.replace(/\\/g, "/");
			const relativePathWithExtension = rootPath && normalizedPath.startsWith(`${rootPath}/`)
				? normalizedPath.slice(rootPath.length + 1)
				: file.name;
			const title = file.name.replace(/\.[^./\\]+$/, "");
			const relativePath = relativePathWithExtension.replace(/\.[^./\\]+$/, "");
			const key = title.toLowerCase();
			titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
			return {
				path: file.path,
				name: file.name,
				title,
				relativePath,
				relativePathWithExtension
			};
		});

		return normalized.map((entry) => ({
			...entry,
			wikiLink: (titleCounts.get(entry.title.toLowerCase()) ?? 0) > 1
				? entry.relativePath
				: entry.title
		}));
	}

	private getTextEditingAccessors(): TextEditingAccessors {
		return {
			getTextEditor: () => this.stickyTextEditorEl ?? this.textEditorEl,
			setTextEditor: (value) => {
				this.textEditorEl = value;
			},
			getLatexEditor: () => this.latexEditorEl,
			setLatexEditor: (value) => {
				this.latexEditorEl = value;
			},
			getActiveTextEdit: () => this.activeTextEdit,
			setActiveTextEdit: (value) => {
				this.activeTextEdit = value;
			},
			getActiveLatexEdit: () => this.activeLatexEdit,
			setActiveLatexEdit: (value) => {
				this.activeLatexEdit = value;
			},
			isTextToolbarInteraction: () => this.isTextToolbarInteraction
		};
	}

	private getSelectionMovementContext(): SelectionMovementContext {
		return {
			docData: this.docData,
			canvasStates: this.canvasStates,
			selectionMaps: {
				strokes: this.selectedStrokes,
				textBlocks: this.selectedTextBlocks,
				images: this.selectedImages
			},
			textLayerDirty: this.textLayerDirty,
			imageLayerDirty: this.imageLayerDirty,
			getCanvasSizePx: () => this.getCanvasSizePx(),
			getPointerPosition: (canvas, event) => this.getPointerPosition(canvas, event),
			renderStrokes: (ctx, strokes, pageId) => this.renderStrokes(ctx, strokes, pageId),
			saveDebounced: () => this.saveDebounced()
		};
	}

	private clearSelection(pageId: string): void {
		clearSelectionForPage(
			{
				strokes: this.selectedStrokes,
				textBlocks: this.selectedTextBlocks,
				images: this.selectedImages
			},
			pageId
		);
	}

	private getSelectionBounds(page: InkDocPage): {
		left: number;
		top: number;
		right: number;
		bottom: number;
	} | null {
		return getSelectionBoundsForPage(
			{
				strokes: this.selectedStrokes,
				textBlocks: this.selectedTextBlocks,
				images: this.selectedImages
			},
			page
		);
	}

	private hasAnySelection(): boolean {
		return hasAnySelectionMaps({
			strokes: this.selectedStrokes,
			textBlocks: this.selectedTextBlocks,
			images: this.selectedImages
		});
	}

	private getSelectionPageId(): string | null {
		return getSelectionPageIdMaps({
			strokes: this.selectedStrokes,
			textBlocks: this.selectedTextBlocks,
			images: this.selectedImages
		});
	}

	private renderSelectionRect(ctx: CanvasRenderingContext2D, pageId: string): void {
		const state = this.canvasStates.get(pageId);
		if (!state || !state.selection.start || !state.selection.current) {
			return;
		}
		if (!state.selection.isSelecting || state.selection.isDragging) {
			return;
		}
		const rect = getRectFromPoints(state.selection.start, state.selection.current);
		ctx.save();
		ctx.strokeStyle = "rgba(88, 169, 255, 0.8)";
		ctx.lineWidth = 1;
		ctx.setLineDash([6, 4]);
		ctx.strokeRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
		ctx.restore();
	}

	private openContextMenu(
		canvas: HTMLCanvasElement,
		page: InkDocPage,
		index: number,
		clientX: number,
		clientY: number,
		point: InkDocPoint
	): void {
		this.closeContextMenu();
		const items: { label: string; onClick: () => void }[] = [
			{
				label: "Borrar selección",
				onClick: () => {
					this.deleteSelection(page, index);
					this.closeContextMenu();
				}
			}
		];
		if (this.hasAnySelection()) {
			items.push({
				label: "Mover acá",
				onClick: () => {
					this.moveSelectionToPoint(page, index, point);
					this.closeContextMenu();
				}
			});
		}
		openManagedMenu(this.contentEl, "", clientX, clientY, items, () => this.closeContextMenu());
	}

	private closeContextMenu(): void {
		closeManagedMenu(
			this.contentEl,
			".inkdoc-context-menu-host:not(.inkdoc-text-context-menu):not(.inkdoc-image-context-menu)"
		);
	}

	private openTextBlockMenu(
		page: InkDocPage,
		index: number,
		point: InkDocPoint,
		clientX: number,
		clientY: number
	): void {
		const existing = this.contentEl.querySelector<HTMLDivElement>(".inkdoc-text-context-menu");
		if (existing) {
			this.closeTextBlockMenu();
			return;
		}
		this.closeTextBlockMenu();
		this.closeContextMenu();
		const block = this.findTextBlockHit(page, index, point);
		if (!block) {
			return;
		}
		if (!this.isBlockCompatibleWithTool(block, this.activeTool)) {
			return;
		}
		if (this.activeTool === "latex") {
			this.closeLatexEditor(true);
		} else {
			this.closeTextEditor(true);
		}
		openManagedMenu(
			this.contentEl,
			"inkdoc-text-context-menu",
			clientX + 6,
			clientY + 6,
			[
				{
					label: "Borrar bloque",
					onClick: () => {
						this.deleteTextBlock(page, index, block.id);
						this.closeTextBlockMenu();
					}
				}
			],
			() => this.closeTextBlockMenu()
		);
	}

	private closeTextBlockMenu(): void {
		closeManagedMenu(this.contentEl, ".inkdoc-text-context-menu.inkdoc-context-menu-host");
	}

	private openImageBlockMenu(
		page: InkDocPage,
		index: number,
		blockId: string,
		clientX: number,
		clientY: number
	): void {
		const existing = this.contentEl.querySelector<HTMLDivElement>(".inkdoc-image-context-menu");
		if (existing) {
			this.closeImageBlockMenu();
			return;
		}
		this.closeImageBlockMenu();
		this.closeContextMenu();
		this.closeTextBlockMenu();
		openManagedMenu(
			this.contentEl,
			"inkdoc-image-context-menu",
			clientX + 6,
			clientY + 6,
			[
				{
					label: "Borrar elemento",
					onClick: () => {
						this.deleteImageBlock(page, index, blockId);
						this.closeImageBlockMenu();
					}
				}
			],
			() => this.closeImageBlockMenu()
		);
	}

	private closeImageBlockMenu(): void {
		closeManagedMenu(this.contentEl, ".inkdoc-image-context-menu.inkdoc-context-menu-host");
	}

	private deleteImageBlock(page: InkDocPage, index: number, blockId: string): void {
		if (!this.docData) {
			return;
		}
		const target =
			this.docData.pages.find((entry) => entry.id === page.id) ?? this.docData.pages[index];
		if (!target || !target.images) {
			return;
		}
		target.images = target.images.filter((block) => block.id !== blockId);
		page.images = target.images;
		const selected = this.selectedImages.get(page.id);
		if (selected?.has(blockId)) {
			selected.delete(blockId);
		}
		this.imageLayerDirty.add(page.id);
		const state = this.canvasStates.get(page.id);
		if (state) {
			this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
		}
		this.saveDebounced();
	}

	private deleteTextBlock(page: InkDocPage, index: number, blockId: string): void {
		if (!this.docData) {
			return;
		}
		const target =
			this.docData.pages.find((entry) => entry.id === page.id) ?? this.docData.pages[index];
		if (!target || !target.textBlocks) {
			return;
		}
		target.textBlocks = target.textBlocks.filter((block) => block.id !== blockId);
		page.textBlocks = target.textBlocks;
		this.textLayerDirty.add(page.id);
		const state = this.canvasStates.get(page.id);
		if (state) {
			this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
		}
		this.saveDebounced();
	}

	private deleteSelection(page: InkDocPage, index: number): void {
		if (!this.docData) {
			return;
		}
		const selected = this.selectedStrokes.get(page.id);
		const selectedBlocks = this.selectedTextBlocks.get(page.id);
		const selectedImages = this.selectedImages.get(page.id);
		const hasStrokeSelection = selected && selected.size > 0;
		const hasBlockSelection = selectedBlocks && selectedBlocks.size > 0;
		const hasImageSelection = selectedImages && selectedImages.size > 0;
		if (!hasStrokeSelection && !hasBlockSelection && !hasImageSelection) {
			return;
		}
		const target =
			this.docData.pages.find((entry) => entry.id === page.id) ?? this.docData.pages[index];
		if (!target) {
			return;
		}
		if (target.strokes && hasStrokeSelection) {
			target.strokes = target.strokes.filter((stroke) => !selected?.has(stroke.id));
			page.strokes = target.strokes;
		}
		if (target.textBlocks && hasBlockSelection) {
			target.textBlocks = target.textBlocks.filter((block) => !selectedBlocks?.has(block.id));
			page.textBlocks = target.textBlocks;
		}
		if (target.images && hasImageSelection) {
			target.images = target.images.filter((block) => !selectedImages?.has(block.id));
			page.images = target.images;
		}
		this.clearSelection(page.id);
		this.textLayerDirty.add(page.id);
		this.imageLayerDirty.add(page.id);
		const state = this.canvasStates.get(page.id);
		if (state) {
			this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
		}
		this.saveDebounced();
	}

	private closePencilMenu(): void {
		if (!this.pencilMenuEl) {
			return;
		}
		this.setActivePencilSubmenu(null);
		this.pencilMenuEl.classList.remove("is-open");
		this.pencilMenuEl.setAttr("aria-hidden", "true");
	}

	private togglePencilSubmenu(submenu: InkDocPencilSubmenu): void {
		const next = this.activePencilSubmenu === submenu ? null : submenu;
		this.setActivePencilSubmenu(next);
	}

	private setActivePencilSubmenu(submenu: InkDocPencilSubmenu | null): void {
		this.activePencilSubmenu = submenu;
		this.pencilSubmenuEngine?.setActive(submenu);
	}

	private updatePencilMenuUI(): void {
		if (!this.pencilMenuEl) {
			return;
		}
		const activeBrush = this.getActiveBrushPreset();
		const presetButtons = this.pencilMenuEl.querySelectorAll<HTMLButtonElement>(
			".inkdoc-pencil-preset"
		);
		presetButtons.forEach((button) => {
			const value = Number(button.dataset.value);
			if (Number.isNaN(value)) {
				return;
			}
			const isActive = value === this.strokeWidth;
			button.classList.toggle("is-active", isActive);
		});
		const styleButtons = this.pencilMenuEl.querySelectorAll<HTMLButtonElement>(
			"[data-role='stroke-style']"
		);
		styleButtons.forEach((button) => {
			const style = resolveInkDocStrokeStyle(button.dataset.style);
			const isActive = style === this.strokeStyle;
			button.classList.toggle("is-active", isActive);
		});

		const slider = this.pencilMenuEl.querySelector<HTMLInputElement>(
			".inkdoc-pencil-slider:not([data-role])"
		);
		if (slider) {
			slider.min = String(activeBrush.minWidth);
			slider.max = String(activeBrush.maxWidth);
			slider.value = String(this.strokeWidth);
		}

		const brushButtons = this.pencilMenuEl.querySelectorAll<HTMLButtonElement>(
			".inkdoc-brush-button"
		);
		brushButtons.forEach((button) => {
			const isActive = button.dataset.brushId === this.activeBrushId;
			button.classList.toggle("is-active", isActive);
			const preview = button.querySelector<HTMLCanvasElement>(".inkdoc-brush-button-preview");
			if (preview) {
				const preset = this.brushRegistry.get(button.dataset.brushId);
				drawBrushPreview(
					preview,
					preset,
					this.strokeColor,
					this.strokeWidth,
					isActive ? this.strokeOpacity : preset.defaultOpacity,
					isActive ? this.strokeSmoothing : preset.smoothing,
					{ stylusDynamicsEnabled: this.isStylusDynamicsEnabled }
				);
			}
		});

		const swatches = this.pencilMenuEl.querySelectorAll<HTMLButtonElement>(".inkdoc-color-swatch");
		swatches.forEach((swatch) => {
			const isActive = swatch.dataset.color === this.strokeColor;
			swatch.classList.toggle("is-active", isActive);
		});

		const colorPreview = this.pencilMenuEl.querySelector<HTMLDivElement>(
			".inkdoc-pencil-preview-color"
		);
		if (colorPreview) {
			colorPreview.style.background = this.strokeColor;
		}

		const recent = this.pencilMenuEl.querySelector<HTMLDivElement>("[data-role='recent-swatches']");
		if (recent) {
			this.ensureRecentStrokeColors();
			recent.empty();
			for (const color of this.recentStrokeColors.slice(0, 12)) {
				const swatch = recent.createEl("button", { cls: "inkdoc-color-swatch" });
				swatch.style.background = color;
				swatch.dataset.color = color;
				swatch.setAttr("aria-label", `Color reciente ${color}`);
				swatch.addEventListener("click", () => this.setStrokeColor(color));
				swatch.classList.toggle("is-active", color === this.strokeColor);
			}
		}

		const opacitySlider = this.pencilMenuEl.querySelector<HTMLInputElement>(
			"[data-role='opacity-slider']"
		);
		if (opacitySlider) {
			opacitySlider.value = String(this.strokeOpacity);
		}
		const smoothingSlider = this.pencilMenuEl.querySelector<HTMLInputElement>(
			"[data-role='smoothing-slider']"
		);
		if (smoothingSlider) {
			smoothingSlider.value = String(this.strokeSmoothing);
		}
		const pressureResponseSlider = this.pencilMenuEl.querySelector<HTMLInputElement>(
			"[data-role='pro-pressure-response']"
		);
		if (pressureResponseSlider) {
			pressureResponseSlider.value = String(activeBrush.pressureResponse ?? 0.78);
			pressureResponseSlider.disabled = activeBrush.tool === "eraser";
		}
		const velocityInfluenceSlider = this.pencilMenuEl.querySelector<HTMLInputElement>(
			"[data-role='pro-velocity-influence']"
		);
		if (velocityInfluenceSlider) {
			velocityInfluenceSlider.value = String(activeBrush.velocityInfluence ?? 0.46);
			velocityInfluenceSlider.disabled = activeBrush.tool === "eraser";
		}
		const taperStrengthSlider = this.pencilMenuEl.querySelector<HTMLInputElement>(
			"[data-role='pro-taper-strength']"
		);
		if (taperStrengthSlider) {
			taperStrengthSlider.value = String(activeBrush.taperStrength ?? 0.58);
			taperStrengthSlider.disabled = activeBrush.tool === "eraser";
		}
		const stabilizerSlider = this.pencilMenuEl.querySelector<HTMLInputElement>(
			"[data-role='stabilizer-slider']"
		);
		if (stabilizerSlider) {
			stabilizerSlider.value = String(this.strokeStabilizer);
			stabilizerSlider.disabled = !this.isStrokeStabilizationEnabled;
			stabilizerSlider.toggleAttribute("aria-disabled", !this.isStrokeStabilizationEnabled);
		}
		const stylusBadge = this.pencilMenuEl.querySelector<HTMLDivElement>("[data-role='stylus-badge']");
		if (stylusBadge) {
			stylusBadge.textContent = this.stylusAvailable ? "Stylus: sí" : "Stylus: no";
		}
		const stylusCapabilities = this.pencilMenuEl.querySelector<HTMLDivElement>(
			"[data-role='stylus-capabilities']"
		);
		if (stylusCapabilities) {
			const stylusPart = this.stylusAvailable
				? `Pressure/Tilt: ${this.isStylusDynamicsEnabled ? "activado" : "desactivado"}`
				: "Pressure/Tilt: desactivado";
			const latencyPart = this.isLowLatencyModeEnabled ? " | Latencia: baja" : "";
			stylusCapabilities.textContent = `${stylusPart}${latencyPart}`;
		}
		const stabilizationToggle = this.pencilMenuEl.querySelector<HTMLButtonElement>(
			"[data-role='stabilization-toggle']"
		);
		if (stabilizationToggle) {
			stabilizationToggle.textContent = `Estabilización: ${
				this.isStrokeStabilizationEnabled ? "ON" : "OFF"
			}`;
			stabilizationToggle.classList.toggle("is-active", this.isStrokeStabilizationEnabled);
		}
		const stylusDynamicsToggle = this.pencilMenuEl.querySelector<HTMLButtonElement>(
			"[data-role='stylus-dynamics-toggle']"
		);
		if (stylusDynamicsToggle) {
			stylusDynamicsToggle.textContent = `Stylus dinámico: ${
				this.isStylusDynamicsEnabled ? "ON" : "OFF"
			}`;
			stylusDynamicsToggle.classList.toggle(
				"is-active",
				this.isStylusDynamicsEnabled && this.stylusAvailable
			);
			stylusDynamicsToggle.disabled = !this.stylusAvailable;
		}
		const fastRenderToggle = this.pencilMenuEl.querySelector<HTMLButtonElement>(
			"[data-role='fast-render-toggle']"
		);
		if (fastRenderToggle) {
			fastRenderToggle.textContent = `Fast render: ${
				this.isMobileFastRenderEnabled ? "ON" : "OFF"
			}`;
			fastRenderToggle.classList.toggle("is-active", this.isMobileFastRenderEnabled);
		}
		const lowLatencyToggle = this.pencilMenuEl.querySelector<HTMLButtonElement>(
			"[data-role='low-latency-toggle']"
		);
		if (lowLatencyToggle) {
			lowLatencyToggle.textContent = `Baja latencia: ${
				this.isLowLatencyModeEnabled ? "ON" : "OFF"
			}`;
			lowLatencyToggle.classList.toggle("is-active", this.isLowLatencyModeEnabled);
		}
		const eraserMode = this.pencilMenuEl.querySelector<HTMLButtonElement>("[data-role='eraser-mode']");
		if (eraserMode) {
			eraserMode.textContent = `Modo borrador: ${this.strokeEraserMode}`;
			eraserMode.classList.toggle("is-active", this.activeTool === "eraser");
		}

		const rgbInputs = this.pencilMenuEl.querySelectorAll<HTMLInputElement>(
			".inkdoc-pencil-rgb-input"
		);
		if (rgbInputs.length === 3) {
			const [rInput, gInput, bInput] = Array.from(rgbInputs);
			if (rInput && gInput && bInput) {
				const rgb = this.parseRgb(this.strokeColor);
				if (rgb) {
					rInput.value = String(rgb.r);
					gInput.value = String(rgb.g);
					bInput.value = String(rgb.b);
				}
			}
		}

		const quickEraserButton = this.pencilMenuEl.querySelector<HTMLButtonElement>("[data-role='quick-eraser']");
		if (quickEraserButton) {
			const isEraserActive = activeBrush.id === "eraser" || this.activeTool === "eraser";
			quickEraserButton.classList.toggle("is-active", isEraserActive);
		}
	}

	private markTextToolbarInteraction(): void {
		this.isTextToolbarInteraction = true;
		window.setTimeout(() => {
			this.isTextToolbarInteraction = false;
		}, 0);
	}

	private toggleTextSubmenu(submenu: InkDocTextSubmenu): void {
		const next = this.activeTextSubmenu === submenu ? null : submenu;
		this.setActiveTextSubmenu(next);
	}

	private setActiveTextSubmenu(submenu: InkDocTextSubmenu | null): void {
		this.activeTextSubmenu = submenu;
		this.textSubmenuEngine?.setActive(submenu);
	}

	private toggleLatexSubmenu(submenu: InkDocLatexSubmenu): void {
		const next = this.activeLatexSubmenu === submenu ? null : submenu;
		this.setActiveLatexSubmenu(next);
	}

	private setActiveLatexSubmenu(submenu: InkDocLatexSubmenu | null): void {
		this.activeLatexSubmenu = submenu;
		this.latexSubmenuEngine?.setActive(submenu);
	}

	private createTextIconButton(
		container: HTMLDivElement,
		icon: string,
		label: string,
		onClick: () => void
	): HTMLButtonElement {
		const button = container.createEl("button", {
			cls: "inkdoc-text-toolbar-btn",
			attr: { "aria-label": label, title: label }
		});
		setCompatibleIcon(button, icon, label.charAt(0).toUpperCase());
		button.addEventListener("click", onClick);
		return button;
	}

	private createTextSelectControl(
		container: HTMLDivElement,
		label: string,
		options: Array<{ label: string; value: string }>,
		onChange: (value: string) => void
	): HTMLDivElement {
		const field = container.createDiv({ cls: "inkdoc-text-field" });
		field.createEl("span", { cls: "inkdoc-text-field-label", text: label });
		const select = field.createEl("select", { cls: "inkdoc-text-field-select" });
		options.forEach((option) => {
			const entry = select.createEl("option", { text: option.label });
			entry.value = option.value;
		});
		select.addEventListener("change", () => onChange(select.value));
		return field;
	}

	private createTextSwatch(
		container: HTMLDivElement,
		color: string,
		label: string
	): HTMLButtonElement {
		const swatch = container.createEl("button", {
			cls: "inkdoc-text-swatch",
			attr: { "aria-label": label, title: label }
		});
		swatch.style.background = color;
		return swatch;
	}

	private promptTextLink(): void {
		const url = window.prompt("URL del enlace", "https://");
		const normalized = url?.trim();
		if (!normalized) {
			return;
		}
		this.applyEditorCommand("createLink", normalized);
	}

	private insertEditorHtml(html: string): void {
		this.applyEditorCommand("insertHTML", html);
	}

	private isStrokeTool(tool: InkDocTool = this.activeTool): tool is "pen" | "highlighter" {
		return tool === "pen" || tool === "highlighter";
	}

	private isTextLikeTool(tool: InkDocTool = this.activeTool): tool is "text" | "latex" {
		return tool === "text" || tool === "latex";
	}

	private createRgbInput(container: HTMLDivElement, label: string): HTMLInputElement {
		const row = container.createDiv({ cls: "inkdoc-pencil-rgb-row" });
		row.createEl("span", { text: label, cls: "inkdoc-pencil-rgb-label" });
		const input = row.createEl("input", { cls: "inkdoc-pencil-rgb-input", type: "number" });
		input.min = "0";
		input.max = "255";
		input.step = "1";
		return input;
	}

	private getBrushIconName(brushId: string): LegacyIconName {
		switch (brushId) {
			case "monoline":
				return "pen";
			case "sketch-pro":
				return "pen";
			case "ink-pro":
				return "pen";
			case "shade-pro":
				return "highlighter";
			case "pencil-graphite":
				return "pen";
			case "textured_pencil":
				return "pen";
			case "soft-brush":
				return "highlighter";
			case "airbrush_soft":
				return "highlighter";
			case "ink-brush":
				return "pen";
			case "marker":
				return "highlighter";
			case "highlighter":
				return "highlighter";
			case "eraser":
				return "eraser";
			default:
				return "pen";
		}
	}

	private createRandomRecentStrokeColors(count: number): string[] {
		const pool = [...this.strokePaletteColors];
		for (let i = pool.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const current = pool[i];
			const target = pool[j];
			if (typeof current !== "string" || typeof target !== "string") {
				continue;
			}
			pool[i] = target;
			pool[j] = current;
		}
		return pool.slice(0, Math.max(1, Math.min(count, pool.length)));
	}

	private ensureRecentStrokeColors(): void {
		if (this.recentStrokeColors.length >= 12) {
			return;
		}
		const filled = [...this.recentStrokeColors];
		const seen = new Set(filled);
		for (const color of this.createRandomRecentStrokeColors(12)) {
			if (filled.length >= 12) {
				break;
			}
			if (seen.has(color)) {
				continue;
			}
			filled.push(color);
			seen.add(color);
		}
		this.recentStrokeColors = filled.slice(0, 12);
	}

	private parseRgb(color: string): { r: number; g: number; b: number } | null {
		const match = color.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)\)/i);
		if (match) {
			return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
		}
		if (color.startsWith("#") && color.length === 7) {
			const r = parseInt(color.slice(1, 3), 16);
			const g = parseInt(color.slice(3, 5), 16);
			const b = parseInt(color.slice(5, 7), 16);
			return { r, g, b };
		}
		return null;
	}

	private clampZoom(value: number): number {
		return Math.min(2.5, Math.max(0.5, value));
	}

	private updateZoom(): void {
		if (!this.pagesContentEl) {
			return;
		}
		this.pagesContentEl.style.setProperty("zoom", String(this.zoomLevel));
	}

	private eraseAtPoint(
		page: InkDocPage,
		index: number,
		point: InkDocPoint,
		widthPx: number,
		heightPx: number
	): void {
		if (!this.docData) {
			return;
		}
		const target =
			this.docData.pages.find((entry) => entry.id === page.id) ?? this.docData.pages[index];
		if (!target || !target.strokes) {
			return;
		}
		const radius =
			this.strokeEraserMode === "stroke"
				? Math.max(6, this.strokeWidth * 1.2)
				: Math.max(3, this.strokeWidth * 0.55);
		const remaining = target.strokes.filter((stroke) => !strokeHitsPoint(stroke, point, radius));
		if (this.strokeEraserMode === "point" && remaining.length === target.strokes.length) {
			return;
		}
		if (this.strokeEraserMode === "stroke") {
			const kept: InkDocStroke[] = [];
			for (const stroke of target.strokes) {
				const hit = strokeHitsPoint(stroke, point, radius);
				if (!hit) {
					kept.push(stroke);
				}
			}
			if (kept.length !== target.strokes.length) {
				target.strokes = kept;
				page.strokes = kept;
				const state = this.canvasStates.get(page.id);
				if (state) {
					this.renderStrokes(state.ctx, kept, page.id);
				}
				this.saveDebounced();
			}
			return;
		}
		if (remaining.length !== target.strokes.length) {
			target.strokes = remaining;
			page.strokes = remaining;
			const state = this.canvasStates.get(page.id);
			if (state) {
				this.renderStrokes(state.ctx, remaining, page.id);
			}
			this.saveDebounced();
		}
	}

	private renderError(message: string): void {
		this.disposeCanvases();
		this.contentEl.empty();
		const root = this.contentEl.createDiv({ cls: "inkdoc-view" });
		root.createDiv({ cls: "inkdoc-error", text: message });
	}

	private disposeCanvases(): void {
		for (const rafId of this.pendingPageRenders.values()) {
			window.cancelAnimationFrame(rafId);
		}
		this.pendingPageRenders.clear();
		this.pendingPageRenderQuality.clear();
		for (const [id, cleanup] of this.canvasCleanups.entries()) {
			cleanup();
			this.canvasCleanups.delete(id);
		}
		this.canvasStates.clear();
		for (const layer of this.textLayerByPage.values()) {
			layer.remove();
		}
		this.textLayerByPage.clear();
		this.textLayerDirty.clear();
		for (const layer of this.imageLayerByPage.values()) {
			layer.remove();
		}
		this.imageLayerByPage.clear();
		this.imageLayerDirty.clear();
		disposeStickyNotesRuntime(this.stickyNotesRuntime);
	}

	private async addNewPage(): Promise<void> {
		if (!this.docData) {
			return;
		}
		const nextIndex = this.docData.pages.length + 1;
		const templatePage = this.docData.pages[0];
		const inheritedBackground = resolvePageBackground(templatePage?.background);
		const inheritedColors = resolvePageColors(templatePage?.colors);
		this.docData.pages.push({
			id: `p${nextIndex}`,
			strokes: [],
			textBlocks: [],
			images: [],
			background: inheritedBackground,
			colors: inheritedColors
		});
		await this.renderDoc(this.docData);
		this.saveDebounced();
	}

	private async deletePage(index: number): Promise<void> {
		if (!this.docData) {
			return;
		}
		this.closeTextBlockMenu();
		this.closeImageBlockMenu();
		this.closeTextEditor(true);
		this.closeLatexEditor(true);
		this.docData.pages = this.docData.pages.filter((_, idx) => idx !== index);
		if (this.docData.pages.length === 0) {
			this.docData.pages.push({
				id: "p1",
				strokes: [],
				textBlocks: [],
				images: [],
				background: DEFAULT_PAGE_BACKGROUND,
				colors: resolvePageColors()
			});
		}
		this.docData.pages = this.docData.pages.map((page, idx) => ({
			...page,
			id: `p${idx + 1}`
		}));
		this.selectedStrokes.clear();
		this.selectedTextBlocks.clear();
		this.selectedImages.clear();
		await this.renderDoc(this.docData);
		this.saveDebounced();
	}

	private async openImagePicker(
		page: InkDocPage,
		index: number,
		point: InkDocPoint
	): Promise<void> {
		const file = await pickImageFile();
		if (!file) {
			return;
		}
		await this.insertImageFromFile(page, index, point, file);
	}

	private async insertImageFromFile(
		page: InkDocPage,
		index: number,
		point: InkDocPoint,
		file: File
	): Promise<void> {
		const dataUrl = await readFileAsDataUrl(file);
		if (!dataUrl) {
			return;
		}
		const block = await this.createImageBlock(page, index, point, dataUrl);
		if (!block) {
			return;
		}
		this.selectedImages.set(page.id, new Set([block.id]));
		this.selectedStrokes.set(page.id, new Set());
		this.selectedTextBlocks.set(page.id, new Set());
		const state = this.canvasStates.get(page.id);
		if (state) {
			this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
		}
	}

	private startImageInteraction(
		mode: "drag" | "resize" | "rotate",
		page: InkDocPage,
		block: InkDocImageBlock,
		event: PointerEvent
	): void {
		const state = this.canvasStates.get(page.id);
		if (!state) {
			return;
		}
		if (this.imagePointerCleanup) {
			this.imagePointerCleanup();
			this.imagePointerCleanup = null;
		}
		const startPoint = this.getPointerPosition(state.canvas, event);
		const startRect = { x: block.x, y: block.y, w: block.w, h: block.h };
		const startRotation = block.rotation ?? 0;
		const center = { x: block.x + block.w / 2, y: block.y + block.h / 2 };
		const startAngle = Math.atan2(startPoint.y - center.y, startPoint.x - center.x);
		this.imagePointerCleanup = startWindowPointerInteraction({
			onMove: (moveEvent) => {
				this.syncEngine.noteActivity();
				const point = this.getPointerPosition(state.canvas, moveEvent);
				const dx = point.x - startPoint.x;
				const dy = point.y - startPoint.y;
				if (mode === "drag") {
					block.x = startRect.x + dx;
					block.y = startRect.y + dy;
				} else if (mode === "resize") {
					block.w = Math.max(INKDOC_IMAGE_MIN_WIDTH, startRect.w + dx);
					block.h = Math.max(INKDOC_IMAGE_MIN_HEIGHT, startRect.h + dy);
				} else if (mode === "rotate") {
					const angle = Math.atan2(point.y - center.y, point.x - center.x);
					block.rotation = startRotation + ((angle - startAngle) * 180) / Math.PI;
				}
				this.imageLayerDirty.add(page.id);
				this.renderStrokes(state.ctx, page.strokes ?? [], page.id);
			},
			onEnd: () => {
				this.syncEngine.noteActivity();
				this.imagePointerCleanup = null;
				this.saveDebounced();
			}
		});
	}

	private async saveToFile(): Promise<void> {
		if (!this.file || !this.docData) {
			return;
		}
		try {
			const content = JSON.stringify(this.docData, null, 2);
			if (content === this.lastSavedContent) {
				return;
			}
			this.syncEngine.markNextModifyAsInternal();
			await this.app.vault.modify(this.file, content);
			this.lastSavedContent = content;
			syncInkDocWikiLinksToMetadata(this.app, this.file, this.docData);
		} catch (error) {
			console.error("Error al guardar InkDoc:", error);
		}
	}

	private hasActiveInteraction(): boolean {
		for (const state of this.canvasStates.values()) {
			if (state.isDrawing) {
				return true;
			}
			if (state.selection.isSelecting || state.selection.isDragging) {
				return true;
			}
			if (
				state.image.isDragging ||
				state.image.isResizing ||
				state.image.isRotating ||
				state.image.isSkewing
			) {
				return true;
			}
		}
		if (this.textEditorEl || this.latexEditorEl) {
			return true;
		}
		if (this.isStickyNoteInteracting) {
			return true;
		}
		const activeElement = document.activeElement;
		if (activeElement instanceof HTMLElement && activeElement.closest(".inkdoc-sticky-note")) {
			return true;
		}
		return this.isPanning;
	}
}
