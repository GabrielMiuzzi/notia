// @ts-nocheck
import { App, Modal, requestUrl } from "../../engines/platform/inkdocPlatform";
import {
	INKDOC_OCR_DEBOUNCE_MAX_MS,
	INKDOC_OCR_DEBOUNCE_MIN_MS,
	clampOcrDebounceMs,
	normalizeServiceUrl
} from "settings";
import type { InkDocPoint } from "../types";
import { renderInkMathLatexPreview } from "./inkmath/latexPreview";
import { stabilizePoint } from "./strokeSmoothing";
import {
	createRecognitionImageBase64,
	type InkMathStroke,
	type InkMathStrokePoint
} from "./inkmath/strokeRaster";
import { setInkDocIcon } from "./iconEngine";
import { setCompatibleIcon } from "./iconFallback";
import { INKDOC_ICONS, type InkDocIconName } from "./icons";
import { PalmRejectionController } from "./palmRejection";
import { getInkDocBuildInfo } from "./buildInfo";
import { attachInkDocModalEngine } from "./modalEngine";

type InkMathPoint = { x: number; y: number };
type ClientPoint = { x: number; y: number };
type ExpandDirection = "left" | "right" | "up" | "down";
type OcrStatus = "idle" | "debouncing" | "requesting" | "error";
type OcrTimelineStatus = "requesting" | "ok" | "canceled" | "error";

type OcrTimelineEntry = {
	requestId: number;
	status: OcrTimelineStatus;
	timeMs: number | null;
	coldStart: boolean;
	device: string | null;
	gpuName: string | null;
};

type RecognizeResponse = {
	latex: string;
	time_ms: number;
	cold_start: boolean;
	device: string;
	gpu_name?: string | null;
};

type InkMathModalOptions = {
	backgroundColor?: string;
	inkColor?: string;
	serviceUrl?: string;
	initialOcrDebounceMs?: number;
	onAccept?: (latex: string) => void;
};

const INITIAL_CANVAS_WIDTH = 640;
const INITIAL_CANVAS_HEIGHT = 270;
const GROW_STEP = 240;
const ERASER_SIZE = 18;
const CANVAS_LINE_WIDTH = 4.4;
const OCR_LINE_WIDTH = 6;
const INKMATH_DRAW_STABILIZER = 0.72;
const MAX_TIMELINE_ENTRIES = 16;
const HEALTH_TIMEOUT_MS = 5000;
const HEALTH_CACHE_MS = 3000;

export class InkMathModal extends Modal {
	private canvasShellEl: HTMLDivElement | null = null;
	private canvasEl: HTMLCanvasElement | null = null;
	private toolRowEl: HTMLDivElement | null = null;
	private drawToolButtonEl: HTMLButtonElement | null = null;
	private eraseToolButtonEl: HTMLButtonElement | null = null;
	private stabilizationToggleButtonEl: HTMLButtonElement | null = null;
	private stylusDynamicsToggleButtonEl: HTMLButtonElement | null = null;
	private latexPreviewEl: HTMLDivElement | null = null;
	private latexPreviewContentEl: HTMLDivElement | null = null;
	private latexEditButtonEl: HTMLButtonElement | null = null;
	private latexManualEditorEl: HTMLTextAreaElement | null = null;
	private latexManualActionsEl: HTMLDivElement | null = null;
	private logsCardEl: HTMLDivElement | null = null;
	private logsBodyEl: HTMLDivElement | null = null;
	private telemetryCardEl: HTMLDivElement | null = null;
	private telemetryStatusEl: HTMLDivElement | null = null;
	private telemetryDebounceValueEl: HTMLDivElement | null = null;
	private telemetryDebounceBarFillEl: HTMLDivElement | null = null;
	private telemetryTimelineEl: HTMLDivElement | null = null;
	private telemetryBackendMessageEl: HTMLDivElement | null = null;
	private actionsEl: HTMLDivElement | null = null;
	private latexInvalidIconEl: HTMLSpanElement | null = null;
	private buildStampEl: HTMLDivElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private readonly backgroundColor: string;
	private readonly inkColor: string;
	private readonly onAccept: ((latex: string) => void) | null;
	private readonly serviceUrl: string;
	private readonly ocrDebounceMs: number;
	private currentLatex: string;
	private logicalWidth = INITIAL_CANVAS_WIDTH;
	private logicalHeight = INITIAL_CANVAS_HEIGHT;
	private dpr = 1;
	private activePointerId: number | null = null;
	private lastPoint: InkMathPoint | null = null;
	private lastClientPoint: ClientPoint | null = null;
	private pointerMode: "draw" | "erase" = "draw";
	private selectedTool: "draw" | "erase" = "draw";
	private lastStabilizedDrawPoint: InkDocPoint | null = null;
	private stylusAvailable = false;
	private isStrokeStabilizationEnabled = true;
	private isStylusDynamicsEnabled = true;
	private palmRejection = new PalmRejectionController();
	private strokes: InkMathStroke[] = [];
	private activeStroke: InkMathStroke | null = null;
	private status: OcrStatus = "idle";
	private debounceTimer: number | null = null;
	private requestIdSequence = 0;
	private latestRequestId = 0;
	private activeAbortController: AbortController | null = null;
	private readonly timeline: OcrTimelineEntry[] = [];
	private readonly sourcePath: string;
	private lastHealthCheckAtMs = 0;
	private backendHealthy = false;
	private backendErrorMessage: string | null = null;
	private hasPendingInkChangedLog = false;
	private logsCollapsed = true;
	private telemetryCollapsed = true;
	private showLatexInvalidAlert = false;
	private isManualLatexEditing = false;
	private detachShell: (() => void) | null = null;

	constructor(app: App, options: InkMathModalOptions = {}) {
		super(app);
		this.backgroundColor = options.backgroundColor ?? "rgb(255, 255, 255)";
		this.inkColor = options.inkColor ?? getOppositeColor(this.backgroundColor);
		this.onAccept = options.onAccept ?? null;
		this.serviceUrl = normalizeServiceUrl(options.serviceUrl ?? "");
		this.ocrDebounceMs = clampOcrDebounceMs(options.initialOcrDebounceMs ?? 1000);
		this.currentLatex = "";
		this.sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
	}

	onOpen(): void {
		this.detachShell = attachInkDocModalEngine(this, { tone: "inkmath", size: "xl" });
		this.titleEl.setText("InkMath");
		this.modalEl.addClass("inkdoc-inkmath-modal-shell");
		this.contentEl.addClass("inkdoc-inkmath-modal");
		this.contentEl.createEl("p", {
			cls: "inkdoc-background-intro",
			text: "Dibuja en el canvas. Usa las flechas para expandir el área manualmente."
		});
		const buildInfo = getInkDocBuildInfo();
		this.buildStampEl = this.contentEl.createDiv({
			cls: "inkdoc-build-stamp",
			text: `Build: ${buildInfo.stamp}`
		});
		this.createLatexPreview();
		this.setLatexInvalidAlert(false);
		void this.renderLatexPreview();

		this.canvasShellEl = this.contentEl.createDiv({ cls: "inkdoc-inkmath-canvas-shell" });
		this.canvasEl = this.canvasShellEl.createEl("canvas", { cls: "inkdoc-inkmath-canvas" });
		this.applyGridBackground();
		this.canvasEl.addEventListener("pointerdown", this.onPointerDown);
		this.canvasEl.addEventListener("pointermove", this.onPointerMove);
		this.canvasEl.addEventListener("pointerup", this.onPointerUp);
		this.canvasEl.addEventListener("pointercancel", this.onPointerUp);
		this.canvasEl.addEventListener("pointerleave", this.onPointerUp);
		this.canvasEl.addEventListener("contextmenu", this.onCanvasContextMenu);
		this.createCanvasExpandControls();
		this.resizeCanvas(this.logicalWidth, this.logicalHeight);
		this.createToolRow();

		this.createLogsCard();
		this.createTelemetryCard();
		this.createActionsRow();
		this.syncSectionWidthsWithCanvas();
		this.appendLog(`InkMath listo. OCR: ${this.serviceUrl}/v1/inkmath/recognize`);
		this.appendLog(`Debounce OCR: ${this.ocrDebounceMs} ms.`);
		this.appendLog(`Build: ${buildInfo.stamp}`);
		this.updateTelemetryUi();
		void this.ensureBackendHealthy("startup", true);
	}

	onClose(): void {
		if (this.canvasEl) {
			this.canvasEl.removeEventListener("pointerdown", this.onPointerDown);
			this.canvasEl.removeEventListener("pointermove", this.onPointerMove);
			this.canvasEl.removeEventListener("pointerup", this.onPointerUp);
			this.canvasEl.removeEventListener("pointercancel", this.onPointerUp);
			this.canvasEl.removeEventListener("pointerleave", this.onPointerUp);
			this.canvasEl.removeEventListener("contextmenu", this.onCanvasContextMenu);
		}
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		this.activeAbortController?.abort();
		this.activeAbortController = null;
		this.activePointerId = null;
		this.lastPoint = null;
		this.lastClientPoint = null;
		this.pointerMode = "draw";
		this.selectedTool = "draw";
		this.lastStabilizedDrawPoint = null;
		this.strokes = [];
		this.activeStroke = null;
		this.timeline.length = 0;
		this.latexPreviewEl = null;
		this.latexPreviewContentEl = null;
		this.latexEditButtonEl = null;
		this.latexManualEditorEl = null;
		this.latexManualActionsEl = null;
		this.logsCardEl = null;
		this.logsBodyEl = null;
		this.telemetryCardEl = null;
		this.telemetryStatusEl = null;
		this.telemetryDebounceValueEl = null;
		this.telemetryDebounceBarFillEl = null;
		this.telemetryTimelineEl = null;
		this.telemetryBackendMessageEl = null;
		this.actionsEl = null;
		this.latexInvalidIconEl = null;
		this.buildStampEl = null;
		this.ctx = null;
		this.canvasShellEl = null;
		this.canvasEl = null;
		this.toolRowEl = null;
		this.drawToolButtonEl = null;
		this.eraseToolButtonEl = null;
		this.stabilizationToggleButtonEl = null;
		this.stylusDynamicsToggleButtonEl = null;
		this.lastHealthCheckAtMs = 0;
		this.backendHealthy = false;
		this.backendErrorMessage = null;
		this.hasPendingInkChangedLog = false;
		this.logsCollapsed = true;
		this.telemetryCollapsed = true;
		this.showLatexInvalidAlert = false;
		this.isManualLatexEditing = false;
		this.stylusAvailable = false;
		this.isStrokeStabilizationEnabled = true;
		this.isStylusDynamicsEnabled = true;
		this.detachShell?.();
		this.detachShell = null;
		this.modalEl.removeClass("inkdoc-inkmath-modal-shell");
		this.contentEl.empty();
	}

	private createLatexPreview(): void {
		const preview = this.contentEl.createDiv({ cls: "inkdoc-inkmath-latex-preview" });
		this.latexPreviewEl = preview;
		this.latexPreviewContentEl = preview.createDiv({ cls: "inkdoc-inkmath-latex-preview-content" });
		const editButton = preview.createEl("button", {
			cls: "inkdoc-inkmath-latex-edit-button",
			attr: {
				type: "button",
				"aria-label": "Editar LaTeX manualmente",
				title: "Editar LaTeX manualmente"
			}
		});
		setInkDocIcon(editButton, INKDOC_ICONS.PENCIL, "E");
		editButton.addEventListener("click", () => {
			if (this.isManualLatexEditing) {
				this.closeManualLatexEditor(true);
				return;
			}
			this.openManualLatexEditor();
		});
		this.latexEditButtonEl = editButton;
	}

	private async renderLatexPreview(): Promise<void> {
		if (!this.latexPreviewContentEl || this.isManualLatexEditing) {
			return;
		}
		const latex = this.currentLatex.trim();
		if (!latex) {
			this.renderPreviewPlaceholder();
			return;
		}
		const rendered = await renderInkMathLatexPreview(
			this.app,
			this.latexPreviewContentEl,
			this.sourcePath,
			this,
			latex
		);
		if (!rendered) {
			this.appendLog("LaTeX recibido pero inválido para render.");
		}
	}

	private renderPreviewPlaceholder(): void {
		if (!this.latexPreviewContentEl) {
			return;
		}
		this.latexPreviewContentEl.empty();
		if (this.latexInvalidIconEl) {
			this.latexInvalidIconEl = null;
		}
		this.latexPreviewContentEl.createDiv({
			cls: "inkdoc-inkmath-latex-placeholder",
			text: "Sin LaTeX reconocido todavía."
		});
	}

	private async applyRecognizedLatexIfValid(latex: string): Promise<boolean> {
		const trimmed = latex.trim();
		if (!trimmed || !this.latexPreviewEl) {
			return false;
		}
		const probe = document.createElement("div");
		const isValid = await renderInkMathLatexPreview(this.app, probe, this.sourcePath, this, trimmed);
		if (!isValid) {
			this.setLatexInvalidAlert(true);
			return false;
		}
		this.currentLatex = trimmed;
		this.setLatexInvalidAlert(false);
		await this.renderLatexPreview();
		return true;
	}

	private setLatexInvalidAlert(visible: boolean): void {
		this.showLatexInvalidAlert = visible;
		if (!this.latexPreviewEl) {
			return;
		}
		if (!this.latexInvalidIconEl || this.latexInvalidIconEl.parentElement !== this.latexPreviewEl) {
			this.latexInvalidIconEl = this.latexPreviewEl.createSpan({
				cls: "inkdoc-inkmath-latex-invalid-icon"
			});
			setCompatibleIcon(this.latexInvalidIconEl, INKDOC_ICONS.CROSS_IN_BOX, "!");
		}
		this.latexInvalidIconEl.toggleClass("is-visible", this.showLatexInvalidAlert);
	}

	private openManualLatexEditor(): void {
		if (!this.latexPreviewContentEl) {
			return;
		}
		this.isManualLatexEditing = true;
		this.latexPreviewEl?.addClass("is-manual-editing");
		this.latexEditButtonEl?.addClass("is-active");
		this.latexPreviewContentEl.empty();
		this.latexManualEditorEl = this.latexPreviewContentEl.createEl("textarea", {
			cls: "inkdoc-inkmath-latex-manual-editor"
		});
		this.latexManualEditorEl.value = this.currentLatex;
		this.latexManualActionsEl = this.latexPreviewContentEl.createDiv({
			cls: "inkdoc-inkmath-latex-manual-actions"
		});
		const cancelButton = this.latexManualActionsEl.createEl("button", {
			cls: "inkdoc-inkmath-latex-manual-action",
			text: "Cancelar",
			attr: { type: "button" }
		});
		const applyButton = this.latexManualActionsEl.createEl("button", {
			cls: "inkdoc-inkmath-latex-manual-action is-primary",
			text: "Aplicar",
			attr: { type: "button" }
		});
		cancelButton.addEventListener("click", () => {
			this.closeManualLatexEditor(true);
		});
		applyButton.addEventListener("click", () => {
			void this.applyManualLatexEditorValue();
		});
		this.latexManualEditorEl.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				this.closeManualLatexEditor(true);
				return;
			}
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "enter") {
				event.preventDefault();
				void this.applyManualLatexEditorValue();
			}
		});
		this.latexManualEditorEl.focus();
		this.latexManualEditorEl.setSelectionRange(
			this.latexManualEditorEl.value.length,
			this.latexManualEditorEl.value.length
		);
	}

	private closeManualLatexEditor(restorePreview: boolean): void {
		this.isManualLatexEditing = false;
		this.latexPreviewEl?.removeClass("is-manual-editing");
		this.latexEditButtonEl?.removeClass("is-active");
		this.latexManualEditorEl = null;
		this.latexManualActionsEl = null;
		if (restorePreview) {
			void this.renderLatexPreview();
		}
	}

	private async applyManualLatexEditorValue(): Promise<void> {
		const editor = this.latexManualEditorEl;
		if (!editor) {
			return;
		}
		const nextLatex = editor.value.trim();
		if (!nextLatex) {
			this.currentLatex = "";
			this.setLatexInvalidAlert(false);
			this.closeManualLatexEditor(false);
			this.renderPreviewPlaceholder();
			return;
		}
		const probe = document.createElement("div");
		const isValid = await renderInkMathLatexPreview(this.app, probe, this.sourcePath, this, nextLatex);
		if (!isValid) {
			this.setLatexInvalidAlert(true);
			this.appendLog("LaTeX manual inválido; corrige la fórmula antes de aplicar.");
			return;
		}
		this.currentLatex = nextLatex;
		this.setLatexInvalidAlert(false);
		this.closeManualLatexEditor(true);
	}

	private onPointerDown = (event: PointerEvent): void => {
		if (!this.canvasEl || (event.button !== 0 && event.button !== 2)) {
			return;
		}
		const palmSample = this.toPalmRejectionSample(event);
		if (
			this.palmRejection.shouldRejectPointerDown(palmSample, {
				enabled: true,
				stylusAvailable: this.stylusAvailable
			})
		) {
			return;
		}
		this.updateStylusAvailabilityFromEvent(event, palmSample.isStylus);
		this.activePointerId = event.pointerId;
		this.pointerMode = event.button === 2 ? "erase" : this.selectedTool;
		this.canvasEl.setPointerCapture(event.pointerId);
		event.preventDefault();
		const rawPoint = this.ensureCanvasCapacity(this.getPoint(event));
		const point = this.getStabilizedPoint(rawPoint);
		this.lastPoint = point;
		this.lastClientPoint = { x: event.clientX, y: event.clientY };
		if (this.pointerMode === "erase") {
			this.activeStroke = null;
			const erased = this.eraseStrokeAtPoint(point);
			if (erased) {
				this.onInkChanged();
			}
		} else {
			const stroke: InkMathStroke = {
				mode: "draw",
				points: [this.createStrokePoint(point, event)]
			};
			this.strokes.push(stroke);
			this.activeStroke = stroke;
			this.lastStabilizedDrawPoint = { x: point.x, y: point.y };
			this.drawDot(point, stroke.points[0]?.pressure);
			this.onInkChanged();
		}
	};

	private onPointerMove = (event: PointerEvent): void => {
		if (this.palmRejection.shouldRejectPointerMove(this.toPalmRejectionSample(event))) {
			return;
		}
		if (
			!this.ctx ||
			!this.canvasEl ||
			this.activePointerId !== event.pointerId ||
			!this.lastPoint
		) {
			return;
		}
		event.preventDefault();
		const rawPoint = this.ensureCanvasCapacity(this.getPoint(event));
		const point = this.getStabilizedPoint(rawPoint);
		if (point.x === this.lastPoint.x && point.y === this.lastPoint.y) {
			return;
		}
		if (this.pointerMode === "erase") {
			const erased = this.eraseStrokeAlongSegment(this.lastPoint, point);
			if (erased) {
				this.onInkChanged();
			}
		} else {
			if (!this.activeStroke) {
				return;
			}
			const strokePoint = this.createStrokePoint(point, event);
			this.activeStroke.points.push(strokePoint);
			this.ctx.beginPath();
			this.ctx.moveTo(this.lastPoint.x, this.lastPoint.y);
			this.ctx.lineTo(point.x, point.y);
			this.ctx.lineWidth = this.getDrawLineWidth(strokePoint.pressure);
			this.ctx.stroke();
			this.onInkChanged();
		}
		this.lastPoint = point;
	};

	private onPointerUp = (event: PointerEvent): void => {
		if (this.palmRejection.shouldRejectPointerUp(this.toPalmRejectionSample(event))) {
			return;
		}
		if (!this.canvasEl || this.activePointerId !== event.pointerId) {
			return;
		}
		if (this.canvasEl.hasPointerCapture(event.pointerId)) {
			this.canvasEl.releasePointerCapture(event.pointerId);
		}
		this.activePointerId = null;
		this.lastPoint = null;
		this.lastClientPoint = null;
		this.pointerMode = this.selectedTool;
		this.lastStabilizedDrawPoint = null;
		this.activeStroke = null;
	};

	private onCanvasContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
	};

	private createStrokePoint(point: InkMathPoint, event: PointerEvent): InkMathStrokePoint {
		const isStylus = isLikelyStylusEvent(event);
		const rawPressure = Number.isFinite(event.pressure) ? event.pressure : 0;
		const pressure =
			this.isStylusDynamicsEnabled && isStylus ? clamp(rawPressure, 0, 1) : undefined;
		return {
			x: point.x,
			y: point.y,
			pressure,
			time: Date.now()
		};
	}

	private getStabilizedPoint(point: InkMathPoint): InkMathPoint {
		if (this.pointerMode !== "draw") {
			this.lastStabilizedDrawPoint = null;
			return point;
		}
		if (!this.isStrokeStabilizationEnabled) {
			this.lastStabilizedDrawPoint = { x: point.x, y: point.y };
			return point;
		}
		const stabilized = stabilizePoint(
			this.lastStabilizedDrawPoint,
			{ x: point.x, y: point.y },
			INKMATH_DRAW_STABILIZER
		);
		this.lastStabilizedDrawPoint = stabilized;
		return {
			x: clamp(stabilized.x, 0, this.logicalWidth),
			y: clamp(stabilized.y, 0, this.logicalHeight)
		};
	}

	private onInkChanged(): void {
		if (!this.hasPendingInkChangedLog) {
			this.appendLog("INK_CHANGED");
			this.hasPendingInkChangedLog = true;
		}
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		this.setStatus("debouncing");
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			void this.requestRecognition();
		}, this.ocrDebounceMs);
		this.updateTelemetryUi();
	}

	private async requestRecognition(): Promise<void> {
		this.hasPendingInkChangedLog = false;
		const isHealthy = await this.ensureBackendHealthy("pre-recognize");
		if (!isHealthy) {
			return;
		}
		const imageBase64 = this.createRecognitionImageBase64();
		if (!imageBase64) {
			this.setStatus("idle");
			this.updateTelemetryUi();
			return;
		}

		if (this.activeAbortController) {
			this.activeAbortController.abort();
			this.markTimelineAsCanceled(this.latestRequestId);
		}

		const requestId = ++this.requestIdSequence;
		this.latestRequestId = requestId;
		const abortController = new AbortController();
		this.activeAbortController = abortController;
		this.pushTimelineEntry({
			requestId,
			status: "requesting",
			timeMs: null,
			coldStart: false,
			device: null,
			gpuName: null
		});
		this.setStatus("requesting");
		this.appendLog(`Request #${requestId} enviada.`);
		this.updateTelemetryUi();

		try {
			const payload = await this.sendRecognizeRequest(imageBase64, abortController.signal);
			if (requestId !== this.latestRequestId) {
				return;
			}

			const timeMs = Number(payload.time_ms);
			const safeTimeMs = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
			const latex = typeof payload.latex === "string" ? payload.latex.trim() : "";
			const coldStart = payload.cold_start === true;
			const device = typeof payload.device === "string" ? payload.device : "unknown";
			const gpuName = typeof payload.gpu_name === "string" ? payload.gpu_name : null;
			this.updateTimelineEntry(requestId, {
				status: "ok",
				timeMs: safeTimeMs,
				coldStart,
				device,
				gpuName
			});
			if (latex.length > 0) {
				const applied = await this.applyRecognizedLatexIfValid(latex);
				if (!applied) {
					this.appendLog("LaTeX descartado por formato inválido; se mantiene el anterior.");
				}
			} else {
				this.appendLog("Request sin LaTeX usable; se mantiene el valor anterior.");
			}

			const baseLog = `OCR #${requestId}: ${Math.round(safeTimeMs)}ms | device=${device} | cold_start=${coldStart}`;
			this.appendLog(gpuName ? `${baseLog} | gpu=${gpuName}` : baseLog);

			this.setStatus("idle");
		} catch (error) {
			if (abortController.signal.aborted) {
				this.markTimelineAsCanceled(requestId);
				this.appendLog(`Request #${requestId} cancelada por nueva entrada.`);
				this.setStatus(this.debounceTimer !== null ? "debouncing" : "idle");
			} else {
				const message = error instanceof Error ? error.message : String(error);
				this.updateTimelineEntry(requestId, {
					status: "error",
					timeMs: null,
					coldStart: false,
					device: null,
					gpuName: null
				});
				this.appendLog(`Error OCR #${requestId}: ${message}`);
				this.setStatus("error");
			}
		} finally {
			if (this.activeAbortController === abortController) {
				this.activeAbortController = null;
			}
			this.updateTelemetryUi();
		}
	}

	private async sendRecognizeRequest(
		imageBase64: string,
		abortSignal: AbortSignal
	): Promise<Partial<RecognizeResponse>> {
		const url = `${this.serviceUrl}/v1/inkmath/recognize`;
		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					image_base64: imageBase64,
					options: {}
				}),
				signal: abortSignal
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			return (await response.json()) as Partial<RecognizeResponse>;
		} catch (error) {
			if (abortSignal.aborted) {
				throw error;
			}
			const fallback = await requestUrl({
				url,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					image_base64: imageBase64,
					options: {}
				}),
				throw: false
			});
			if (fallback.status < 200 || fallback.status >= 300) {
				throw new Error(`HTTP ${fallback.status}`);
			}
			return fallback.json as Partial<RecognizeResponse>;
		}
	}

	private createRecognitionImageBase64(): string | null {
		// OCR image is always rebuilt from strokes: white background + black ink, no grid/background styling.
		return createRecognitionImageBase64(
			this.strokes,
			this.logicalWidth,
			this.logicalHeight,
			OCR_LINE_WIDTH,
			ERASER_SIZE
		);
	}

	private createDebugRecognitionImageBase64(): string {
		const generated = this.createRecognitionImageBase64();
		if (generated) {
			return generated;
		}
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(this.logicalWidth));
		canvas.height = Math.max(1, Math.round(this.logicalHeight));
		const ctx = canvas.getContext("2d");
		if (ctx) {
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
		}
		return canvas.toDataURL("image/png");
	}

	private openDebugPreview(): void {
		const imageBase64 = this.createDebugRecognitionImageBase64();
		new InkMathImageDebugModal(this.app, imageBase64).open();
	}

	private async ensureBackendHealthy(reason: string, force: boolean = false): Promise<boolean> {
		const now = Date.now();
		if (!force && now - this.lastHealthCheckAtMs < HEALTH_CACHE_MS) {
			return this.backendHealthy;
		}
		this.lastHealthCheckAtMs = now;
		const timeoutController = new AbortController();
		const timeoutId = window.setTimeout(() => timeoutController.abort(), HEALTH_TIMEOUT_MS);
		try {
			const payload = await this.sendHealthCheck(timeoutController.signal);
			if (payload.status && payload.status !== "ok") {
				throw new Error(`status=${payload.status}`);
			}
			const wasUnhealthy = !this.backendHealthy;
			this.backendHealthy = true;
			this.backendErrorMessage = null;
			if (wasUnhealthy) {
				this.appendLog("Backend /health OK.");
			}
			if (this.status === "error") {
				this.setStatus(this.debounceTimer !== null ? "debouncing" : "idle");
			}
			this.updateTelemetryUi();
			return true;
		} catch (error) {
			this.backendHealthy = false;
			const detail = error instanceof Error ? error.message : String(error);
			const nextMessage = `Backend sin respuesta en /health (${reason}): ${detail}`;
			if (this.backendErrorMessage !== nextMessage) {
				this.appendLog(nextMessage);
			}
			this.backendErrorMessage = nextMessage;
			this.setStatus("error");
			this.updateTelemetryUi();
			return false;
		} finally {
			window.clearTimeout(timeoutId);
		}
	}

	private async sendHealthCheck(abortSignal: AbortSignal): Promise<{ status?: string }> {
		const url = `${this.serviceUrl}/health`;
		try {
			const response = await fetch(url, {
				method: "GET",
				cache: "no-store",
				signal: abortSignal
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			return (await response.json()) as { status?: string };
		} catch (error) {
			if (abortSignal.aborted) {
				throw error;
			}
			const fallback = await requestUrl({
				url,
				method: "GET",
				throw: false
			});
			if (fallback.status < 200 || fallback.status >= 300) {
				throw new Error(`HTTP ${fallback.status}`);
			}
			return fallback.json as { status?: string };
		}
	}

	private getPoint(event: PointerEvent): InkMathPoint {
		if (!this.canvasEl) {
			return { x: 0, y: 0 };
		}
		const rect = this.canvasEl.getBoundingClientRect();
		return {
			x: clamp(event.clientX - rect.left, 0, this.logicalWidth),
			y: clamp(event.clientY - rect.top, 0, this.logicalHeight)
		};
	}

	private ensureCanvasCapacity(point: InkMathPoint): InkMathPoint {
		return {
			x: clamp(point.x, 0, this.logicalWidth),
			y: clamp(point.y, 0, this.logicalHeight)
		};
	}

	private createCanvasExpandControls(): void {
		if (!this.canvasShellEl) {
			return;
		}
		const makeButton = (direction: ExpandDirection, icon: InkDocIconName, label: string): void => {
			const button = this.canvasShellEl?.createEl("button", {
				cls: `inkdoc-inkmath-canvas-expand is-${direction}`,
				attr: { type: "button", "aria-label": label, title: label }
			});
			if (button) {
				setCompatibleIcon(button, icon, "+");
			}
			button?.addEventListener("click", () => {
				this.expandCanvas(direction);
			});
		};
		makeButton("up", INKDOC_ICONS.UP_ARROW_WITH_TAIL, "Expandir arriba");
		makeButton("down", INKDOC_ICONS.DOWN_ARROW_WITH_TAIL, "Expandir abajo");
		makeButton("left", INKDOC_ICONS.LEFT_ARROW_WITH_TAIL, "Expandir izquierda");
		makeButton("right", INKDOC_ICONS.RIGHT_ARROW_WITH_TAIL, "Expandir derecha");
	}

	private createToolRow(): void {
		const toolRow = this.contentEl.createDiv({ cls: "inkdoc-inkmath-tools" });
		this.toolRowEl = toolRow;

		const createToolButton = (
			tool: "draw" | "erase",
			icon: InkDocIconName,
			label: string,
			fallback: string
		): HTMLButtonElement => {
			const button = toolRow.createEl("button", {
				cls: "inkdoc-inkmath-tool-button",
				attr: { type: "button", "aria-label": label, title: label }
			});
			const iconEl = button.createSpan({ cls: "inkdoc-inkmath-tool-icon" });
			setCompatibleIcon(iconEl, icon, fallback);
			button.createSpan({ cls: "inkdoc-inkmath-tool-label", text: label });
			button.addEventListener("click", () => {
				this.setSelectedTool(tool);
			});
			return button;
		};

		this.drawToolButtonEl = createToolButton("draw", INKDOC_ICONS.PENCIL, "Lápiz", "P");
		this.eraseToolButtonEl = createToolButton("erase", INKDOC_ICONS.ERASER, "Borrador", "E");
		this.stabilizationToggleButtonEl = this.createToggleToolButton(
			toolRow,
			"Estabilización",
			INKDOC_ICONS.SWITCH,
			"S"
		);
		this.stabilizationToggleButtonEl.addEventListener("click", () => {
			this.isStrokeStabilizationEnabled = !this.isStrokeStabilizationEnabled;
			this.updateInkMathAdvancedToolTogglesUi();
		});
		this.stylusDynamicsToggleButtonEl = this.createToggleToolButton(
			toolRow,
			"Stylus dinámico",
			INKDOC_ICONS.WAND_2,
			"D"
		);
		this.stylusDynamicsToggleButtonEl.addEventListener("click", () => {
			if (!this.stylusAvailable) {
				return;
			}
			this.isStylusDynamicsEnabled = !this.isStylusDynamicsEnabled;
			this.updateInkMathAdvancedToolTogglesUi();
		});
		this.setSelectedTool(this.selectedTool);
		this.updateInkMathAdvancedToolTogglesUi();
	}

	private setSelectedTool(tool: "draw" | "erase"): void {
		this.selectedTool = tool;
		if (this.activePointerId === null) {
			this.pointerMode = tool;
		}
		this.drawToolButtonEl?.toggleClass("is-active", tool === "draw");
		this.eraseToolButtonEl?.toggleClass("is-active", tool === "erase");
	}

	private createToggleToolButton(
		toolRow: HTMLDivElement,
		label: string,
		icon: InkDocIconName,
		fallback: string
	): HTMLButtonElement {
		const button = toolRow.createEl("button", {
			cls: "inkdoc-inkmath-tool-button inkmath-toggle",
			attr: { type: "button", "aria-label": label, title: label }
		});
		const iconEl = button.createSpan({ cls: "inkdoc-inkmath-tool-icon" });
		setCompatibleIcon(iconEl, icon, fallback);
		button.createSpan({ cls: "inkdoc-inkmath-tool-label", text: label });
		return button;
	}

	private updateInkMathAdvancedToolTogglesUi(): void {
		if (this.stabilizationToggleButtonEl) {
			this.stabilizationToggleButtonEl.classList.toggle("is-active", this.isStrokeStabilizationEnabled);
			this.stabilizationToggleButtonEl.title = `Estabilización: ${
				this.isStrokeStabilizationEnabled ? "ON" : "OFF"
			}`;
		}
		if (this.stylusDynamicsToggleButtonEl) {
			this.stylusDynamicsToggleButtonEl.classList.toggle(
				"is-active",
				this.stylusAvailable && this.isStylusDynamicsEnabled
			);
			this.stylusDynamicsToggleButtonEl.disabled = !this.stylusAvailable;
			this.stylusDynamicsToggleButtonEl.title = this.stylusAvailable
				? `Stylus dinámico: ${this.isStylusDynamicsEnabled ? "ON" : "OFF"}`
				: "Stylus dinámico: requiere stylus detectado";
		}
	}

	private updateStylusAvailabilityFromEvent(event: PointerEvent, isStylus: boolean): void {
		if (!isStylus || this.stylusAvailable) {
			return;
		}
		this.stylusAvailable = true;
		this.updateInkMathAdvancedToolTogglesUi();
		this.appendLog(`Stylus detectado (${event.pointerType || "unknown"}). Palm rejection activado.`);
	}

	private toPalmRejectionSample(event: PointerEvent): {
		pointerId: number;
		pointerType: string;
		isStylus: boolean;
	} {
		return {
			pointerId: event.pointerId,
			pointerType: event.pointerType || "mouse",
			isStylus: isLikelyStylusEvent(event)
		};
	}

	private expandCanvas(direction: ExpandDirection): void {
		let deltaWidth = 0;
		let deltaHeight = 0;
		let shiftX = 0;
		let shiftY = 0;
		if (direction === "left") {
			deltaWidth = GROW_STEP;
			shiftX = GROW_STEP;
		} else if (direction === "right") {
			deltaWidth = GROW_STEP;
		} else if (direction === "up") {
			deltaHeight = GROW_STEP;
			shiftY = GROW_STEP;
		} else if (direction === "down") {
			deltaHeight = GROW_STEP;
		}
		if (shiftX !== 0 || shiftY !== 0) {
			for (const stroke of this.strokes) {
				for (const point of stroke.points) {
					point.x += shiftX;
					point.y += shiftY;
				}
			}
			if (this.lastPoint) {
				this.lastPoint = {
					x: this.lastPoint.x + shiftX,
					y: this.lastPoint.y + shiftY
				};
			}
			if (this.lastStabilizedDrawPoint) {
				this.lastStabilizedDrawPoint = {
					...this.lastStabilizedDrawPoint,
					x: this.lastStabilizedDrawPoint.x + shiftX,
					y: this.lastStabilizedDrawPoint.y + shiftY
				};
			}
		}
		this.resizeCanvas(this.logicalWidth + deltaWidth, this.logicalHeight + deltaHeight);
	}

	private resizeCanvas(nextWidth: number, nextHeight: number): void {
		if (!this.canvasEl) {
			return;
		}
		this.logicalWidth = Math.max(1, Math.round(nextWidth));
		this.logicalHeight = Math.max(1, Math.round(nextHeight));
		this.dpr = Math.max(1, window.devicePixelRatio || 1);
		this.canvasEl.style.width = `${this.logicalWidth}px`;
		this.canvasEl.style.height = `${this.logicalHeight}px`;
		this.canvasEl.width = Math.max(1, Math.round(this.logicalWidth * this.dpr));
		this.canvasEl.height = Math.max(1, Math.round(this.logicalHeight * this.dpr));
		const nextCtx = this.canvasEl.getContext("2d");
		if (!nextCtx) {
			this.ctx = null;
			return;
		}
		nextCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		nextCtx.lineCap = "round";
		nextCtx.lineJoin = "round";
		nextCtx.lineWidth = CANVAS_LINE_WIDTH;
		nextCtx.strokeStyle = this.inkColor;
		this.ctx = nextCtx;
		this.redrawCanvasFromStrokes();
		this.syncSectionWidthsWithCanvas();
	}

	private redrawCanvasFromStrokes(): void {
		if (!this.ctx || !this.canvasEl) {
			return;
		}
		this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
		for (const stroke of this.strokes) {
			this.redrawDrawStroke(stroke);
		}
	}

	private redrawDrawStroke(stroke: InkMathStroke): void {
		if (!this.ctx || stroke.mode !== "draw" || stroke.points.length === 0) {
			return;
		}
		if (stroke.points.length === 1) {
			const first = stroke.points[0];
			if (!first) {
				return;
			}
			this.drawDot({ x: first.x, y: first.y }, first.pressure);
			return;
		}
		for (let index = 1; index < stroke.points.length; index += 1) {
			const previous = stroke.points[index - 1];
			const current = stroke.points[index];
			if (!previous || !current) {
				continue;
			}
			this.ctx.beginPath();
			this.ctx.moveTo(previous.x, previous.y);
			this.ctx.lineTo(current.x, current.y);
			this.ctx.lineWidth = this.getDrawLineWidth(current.pressure);
			this.ctx.strokeStyle = this.inkColor;
			this.ctx.stroke();
		}
	}

	private getDrawLineWidth(pressure: number | undefined): number {
		if (!this.stylusAvailable || !this.isStylusDynamicsEnabled || typeof pressure !== "number") {
			return CANVAS_LINE_WIDTH;
		}
		const normalized = clamp(pressure, 0, 1);
		return clamp(
			CANVAS_LINE_WIDTH * (0.45 + normalized * 1.15),
			CANVAS_LINE_WIDTH * 0.45,
			CANVAS_LINE_WIDTH * 1.7
		);
	}

	private drawDot(point: InkMathPoint, pressure: number | undefined): void {
		if (!this.ctx) {
			return;
		}
		this.ctx.save();
		this.ctx.fillStyle = this.inkColor;
		this.ctx.beginPath();
		this.ctx.arc(point.x, point.y, this.getDrawLineWidth(pressure) * 0.5, 0, Math.PI * 2);
		this.ctx.fill();
		this.ctx.restore();
	}

	private eraseAtPoint(point: InkMathPoint): void {
		if (!this.ctx) {
			return;
		}
		this.ctx.save();
		this.ctx.globalCompositeOperation = "destination-out";
		this.ctx.beginPath();
		this.ctx.arc(point.x, point.y, ERASER_SIZE / 2, 0, Math.PI * 2);
		this.ctx.fill();
		this.ctx.restore();
	}

	private eraseStrokeAtPoint(point: InkMathPoint): boolean {
		return this.eraseStrokeAlongSegment(point, point);
	}

	private eraseStrokeAlongSegment(from: InkMathPoint, to: InkMathPoint): boolean {
		const radius = ERASER_SIZE * 0.5;
		const previousLength = this.strokes.length;
		this.strokes = this.strokes.filter((stroke) => {
			if (stroke.mode !== "draw") {
				return false;
			}
			if (stroke.points.length === 0) {
				return false;
			}
			return !this.strokeIntersectsEraserPath(stroke, from, to, radius);
		});
		const changed = this.strokes.length !== previousLength;
		if (changed) {
			this.redrawCanvasFromStrokes();
		}
		return changed;
	}

	private strokeIntersectsEraserPath(
		stroke: InkMathStroke,
		from: InkMathPoint,
		to: InkMathPoint,
		radius: number
	): boolean {
		for (const point of stroke.points) {
			if (distancePointToSegment(point.x, point.y, from.x, from.y, to.x, to.y) <= radius) {
				return true;
			}
		}
		return false;
	}

	private eraseSegment(from: InkMathPoint, to: InkMathPoint): void {
		if (!this.ctx) {
			return;
		}
		const deltaX = to.x - from.x;
		const deltaY = to.y - from.y;
		const distance = Math.hypot(deltaX, deltaY);
		const steps = Math.max(1, Math.ceil(distance / (ERASER_SIZE * 0.35)));
		for (let index = 0; index <= steps; index += 1) {
			const t = index / steps;
			this.eraseAtPoint({
				x: from.x + deltaX * t,
				y: from.y + deltaY * t
			});
		}
	}

	private applyGridBackground(): void {
		if (!this.canvasEl) {
			return;
		}
		const minor = getOppositeColorWithAlpha(this.backgroundColor, 0.14);
		const major = getOppositeColorWithAlpha(this.backgroundColor, 0.22);
		this.canvasEl.style.backgroundColor = this.backgroundColor;
		this.canvasEl.style.backgroundImage = [
			`linear-gradient(${minor} 1px, transparent 1px)`,
			`linear-gradient(90deg, ${minor} 1px, transparent 1px)`,
			`linear-gradient(${major} 1px, transparent 1px)`,
			`linear-gradient(90deg, ${major} 1px, transparent 1px)`
		].join(", ");
		this.canvasEl.style.backgroundSize = "20px 20px, 20px 20px, 100px 100px, 100px 100px";
		this.canvasEl.style.backgroundPosition = "0 0, 0 0, 0 0, 0 0";
	}

	private createLogsCard(): void {
		const logsCard = this.contentEl.createDiv({ cls: "inkdoc-inkmath-logs-card" });
		const header = logsCard.createDiv({ cls: "inkdoc-inkmath-card-header" });
		header.createDiv({ cls: "inkdoc-inkmath-logs-title", text: "Logs" });
		const collapseButton = header.createEl("button", {
			cls: "inkdoc-inkmath-card-toggle",
			attr: { type: "button", "aria-label": "Colapsar logs", title: "Colapsar/expandir logs" }
		});
		setCompatibleIcon(collapseButton, INKDOC_ICONS.DOWN_CHEVRON_GLYPH, "v");
		collapseButton.addEventListener("click", () => {
			this.logsCollapsed = !this.logsCollapsed;
			this.updateCardCollapseUi();
		});
		this.logsCardEl = logsCard;
		this.logsBodyEl = logsCard.createDiv({ cls: "inkdoc-inkmath-logs-body" });
		this.updateCardCollapseUi();
	}

	private createTelemetryCard(): void {
		const telemetryCard = this.contentEl.createDiv({ cls: "inkdoc-inkmath-telemetry-card" });
		const cardHeader = telemetryCard.createDiv({ cls: "inkdoc-inkmath-card-header" });
		cardHeader.createDiv({ cls: "inkdoc-inkmath-logs-title", text: "Telemetría OCR" });
		const collapseButton = cardHeader.createEl("button", {
			cls: "inkdoc-inkmath-card-toggle",
			attr: { type: "button", "aria-label": "Colapsar telemetría OCR", title: "Colapsar/expandir telemetría OCR" }
		});
		setCompatibleIcon(collapseButton, INKDOC_ICONS.DOWN_CHEVRON_GLYPH, "v");
		collapseButton.addEventListener("click", () => {
			this.telemetryCollapsed = !this.telemetryCollapsed;
			this.updateCardCollapseUi();
		});

		const header = telemetryCard.createDiv({ cls: "inkdoc-inkmath-telemetry-header" });
		this.telemetryStatusEl = header.createDiv({ cls: "inkdoc-inkmath-ocr-status is-idle", text: "Idle" });
		this.telemetryDebounceValueEl = header.createDiv({
			cls: "inkdoc-inkmath-telemetry-debounce-value",
			text: "500 ms"
		});

		const debounceTrack = telemetryCard.createDiv({ cls: "inkdoc-inkmath-telemetry-debounce-track" });
		this.telemetryDebounceBarFillEl = debounceTrack.createDiv({
			cls: "inkdoc-inkmath-telemetry-debounce-fill"
		});
		this.telemetryBackendMessageEl = telemetryCard.createDiv({
			cls: "inkdoc-inkmath-telemetry-backend",
			text: "Backend: verificando /health..."
		});

		this.telemetryTimelineEl = telemetryCard.createDiv({ cls: "inkdoc-inkmath-telemetry-timeline" });
		this.telemetryCardEl = telemetryCard;
		this.updateCardCollapseUi();
	}

	private createActionsRow(): void {
		const actions = this.contentEl.createDiv({ cls: "inkdoc-inkmath-actions" });
		this.actionsEl = actions;
		const debugButton = actions.createEl("button", {
			cls: "inkdoc-inkmath-action inkmath-debug-eye",
			attr: { type: "button", "aria-label": "Ver imagen OCR", title: "Ver imagen OCR (debug)" }
		});
		setCompatibleIcon(debugButton, INKDOC_ICONS.MAGNIFYING_GLASS, "O");
		const rightGroup = actions.createDiv({ cls: "inkdoc-inkmath-actions-right" });
		const cancelButton = rightGroup.createEl("button", {
			cls: "inkdoc-inkmath-action",
			text: "Cancelar",
			attr: { type: "button" }
		});
		const acceptButton = rightGroup.createEl("button", {
			cls: "inkdoc-inkmath-action is-primary",
			text: "Aceptar",
			attr: { type: "button" }
		});
		debugButton.addEventListener("click", () => {
			this.openDebugPreview();
		});
		cancelButton.addEventListener("click", () => {
			this.close();
		});
		acceptButton.addEventListener("click", () => {
			const latex = this.currentLatex.trim();
			if (latex) {
				this.onAccept?.(latex);
			} else {
				this.appendLog("Aceptar sin LaTeX válido: no se aplican cambios.");
			}
			this.close();
		});
	}

	private appendLog(message: string): void {
		if (!this.logsBodyEl) {
			return;
		}
		this.logsBodyEl.createDiv({
			cls: "inkdoc-inkmath-log-line",
			text: `[${new Date().toLocaleTimeString()}] ${message}`
		});
		this.logsBodyEl.scrollTop = this.logsBodyEl.scrollHeight;
	}

	private setStatus(nextStatus: OcrStatus): void {
		this.status = nextStatus;
	}

	private pushTimelineEntry(entry: OcrTimelineEntry): void {
		this.timeline.push(entry);
		if (this.timeline.length > MAX_TIMELINE_ENTRIES) {
			this.timeline.splice(0, this.timeline.length - MAX_TIMELINE_ENTRIES);
		}
	}

	private markTimelineAsCanceled(requestId: number): void {
		const entry = this.timeline.find((item) => item.requestId === requestId);
		if (!entry) {
			return;
		}
		entry.status = "canceled";
	}

	private updateTimelineEntry(
		requestId: number,
		patch: Pick<OcrTimelineEntry, "status" | "timeMs" | "coldStart" | "device" | "gpuName">
	): void {
		const entry = this.timeline.find((item) => item.requestId === requestId);
		if (!entry) {
			return;
		}
		entry.status = patch.status;
		entry.timeMs = patch.timeMs;
		entry.coldStart = patch.coldStart;
		entry.device = patch.device;
		entry.gpuName = patch.gpuName;
	}

	private updateTelemetryUi(): void {
		if (!this.telemetryStatusEl || !this.telemetryDebounceValueEl || !this.telemetryDebounceBarFillEl) {
			return;
		}
		this.telemetryStatusEl.className = `inkdoc-inkmath-ocr-status is-${this.status}`;
		this.telemetryStatusEl.textContent = statusLabelByKey[this.status];

		this.telemetryDebounceValueEl.textContent = `${this.ocrDebounceMs} ms`;
		const fraction =
			(this.ocrDebounceMs - INKDOC_OCR_DEBOUNCE_MIN_MS) /
			(INKDOC_OCR_DEBOUNCE_MAX_MS - INKDOC_OCR_DEBOUNCE_MIN_MS);
		const safeFraction = Math.max(0, Math.min(1, fraction));
		this.telemetryDebounceBarFillEl.style.width = `${(safeFraction * 100).toFixed(2)}%`;
		if (this.telemetryBackendMessageEl) {
			this.telemetryBackendMessageEl.className = `inkdoc-inkmath-telemetry-backend ${
				this.backendHealthy ? "is-ok" : "is-error"
			}`;
			this.telemetryBackendMessageEl.textContent = this.backendHealthy
				? "Backend: online"
				: (this.backendErrorMessage ?? "Backend: verificando /health...");
		}

		this.renderTimeline();
	}

	private renderTimeline(): void {
		if (!this.telemetryTimelineEl) {
			return;
		}
		this.telemetryTimelineEl.empty();
		if (this.timeline.length === 0) {
			this.telemetryTimelineEl.createDiv({
				cls: "inkdoc-inkmath-telemetry-empty",
				text: "Sin requests aún."
			});
			return;
		}
		const maxTimeMs = Math.max(
			100,
			...this.timeline.map((entry) => (entry.timeMs && entry.timeMs > 0 ? entry.timeMs : 0))
		);
		const latestFirst = [...this.timeline].reverse();
		for (const entry of latestFirst) {
			const row = this.telemetryTimelineEl.createDiv({ cls: "inkdoc-inkmath-telemetry-row" });
			row.createDiv({ cls: "inkdoc-inkmath-telemetry-row-id", text: `#${entry.requestId}` });

			const barWrap = row.createDiv({ cls: "inkdoc-inkmath-telemetry-row-bar" });
			const bar = barWrap.createDiv({ cls: `inkdoc-inkmath-telemetry-row-fill is-${entry.status}` });
			const ratio = entry.timeMs ? Math.max(0.06, Math.min(1, entry.timeMs / maxTimeMs)) : 0.12;
			bar.style.width = `${(ratio * 100).toFixed(1)}%`;

			const text =
				entry.status === "requesting"
					? "en curso"
					: entry.status === "canceled"
						? "cancelada"
						: entry.status === "error"
							? "error"
							: `${Math.round(entry.timeMs ?? 0)}ms`;
			const meta = row.createDiv({ cls: "inkdoc-inkmath-telemetry-row-meta", text });
			if (entry.coldStart) {
				meta.createSpan({ cls: "inkdoc-inkmath-telemetry-cold", text: "cold" });
			}
		}
	}

	private syncSectionWidthsWithCanvas(): void {
		const widthPx = `${this.logicalWidth}px`;
		if (this.toolRowEl) {
			this.toolRowEl.style.width = widthPx;
			this.toolRowEl.style.maxWidth = widthPx;
		}
		if (this.logsCardEl) {
			this.logsCardEl.style.width = widthPx;
			this.logsCardEl.style.maxWidth = widthPx;
		}
		if (this.telemetryCardEl) {
			this.telemetryCardEl.style.width = widthPx;
			this.telemetryCardEl.style.maxWidth = widthPx;
		}
		if (this.latexPreviewEl) {
			this.latexPreviewEl.style.width = widthPx;
			this.latexPreviewEl.style.maxWidth = widthPx;
		}
		if (this.actionsEl) {
			this.actionsEl.style.width = widthPx;
			this.actionsEl.style.maxWidth = widthPx;
		}
	}

	private updateCardCollapseUi(): void {
		if (this.logsCardEl) {
			this.logsCardEl.classList.toggle("is-collapsed", this.logsCollapsed);
			const button = this.logsCardEl.querySelector<HTMLButtonElement>(".inkdoc-inkmath-card-toggle");
			if (button) {
				setCompatibleIcon(
					button,
					this.logsCollapsed ? INKDOC_ICONS.RIGHT_TRIANGLE : INKDOC_ICONS.DOWN_CHEVRON_GLYPH,
					">"
				);
				button.setAttribute("aria-label", this.logsCollapsed ? "Expandir logs" : "Colapsar logs");
				button.title = this.logsCollapsed ? "Expandir logs" : "Colapsar logs";
			}
		}
		if (this.telemetryCardEl) {
			this.telemetryCardEl.classList.toggle("is-collapsed", this.telemetryCollapsed);
			const button = this.telemetryCardEl.querySelector<HTMLButtonElement>(".inkdoc-inkmath-card-toggle");
			if (button) {
				setCompatibleIcon(
					button,
					this.telemetryCollapsed ? INKDOC_ICONS.RIGHT_TRIANGLE : INKDOC_ICONS.DOWN_CHEVRON_GLYPH,
					">"
				);
				button.setAttribute(
					"aria-label",
					this.telemetryCollapsed ? "Expandir telemetría OCR" : "Colapsar telemetría OCR"
				);
				button.title = this.telemetryCollapsed ? "Expandir telemetría OCR" : "Colapsar telemetría OCR";
			}
		}
	}
}

const statusLabelByKey: Record<OcrStatus, string> = {
	idle: "Idle",
	debouncing: "Debouncing",
	requesting: "Requesting",
	error: "Error"
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const isLikelyStylusEvent = (event: PointerEvent): boolean => {
	if (event.pointerType === "pen") {
		return true;
	}
	if (event.pointerType === "mouse") {
		return false;
	}
	const width = Number.isFinite(event.width) ? event.width : 0;
	const height = Number.isFinite(event.height) ? event.height : 0;
	const pressure = Number.isFinite(event.pressure) ? event.pressure : 0;
	const twist = Number.isFinite((event as unknown as { twist?: number }).twist)
		? Number((event as unknown as { twist?: number }).twist)
		: 0;
	const smallContact = width > 0 && height > 0 && width <= 3.5 && height <= 3.5;
	const variablePressure = pressure > 0 && pressure < 1 && Math.abs(pressure - 0.5) > 0.01;
	return smallContact && (variablePressure || twist !== 0);
};

const clampRgb = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const parseColorToRgb = (value: string): { r: number; g: number; b: number } => {
	const rgbMatch = value.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
	if (rgbMatch) {
		return {
			r: clampRgb(Number(rgbMatch[1])),
			g: clampRgb(Number(rgbMatch[2])),
			b: clampRgb(Number(rgbMatch[3]))
		};
	}
	const hexMatch = value.match(/^#([0-9a-f]{6})$/i);
	if (hexMatch) {
		const hex = hexMatch[1] ?? "ffffff";
		return {
			r: parseInt(hex.slice(0, 2), 16),
			g: parseInt(hex.slice(2, 4), 16),
			b: parseInt(hex.slice(4, 6), 16)
		};
	}
	return { r: 255, g: 255, b: 255 };
};

const getOppositeColor = (background: string): string => {
	const rgb = parseColorToRgb(background);
	return `rgb(${255 - rgb.r}, ${255 - rgb.g}, ${255 - rgb.b})`;
};

const getOppositeColorWithAlpha = (background: string, alpha: number): string => {
	const rgb = parseColorToRgb(background);
	const safeAlpha = Math.max(0, Math.min(1, alpha));
	return `rgba(${255 - rgb.r}, ${255 - rgb.g}, ${255 - rgb.b}, ${safeAlpha})`;
};

const distancePointToSegment = (
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number
): number => {
	const abx = bx - ax;
	const aby = by - ay;
	const apx = px - ax;
	const apy = py - ay;
	const abLengthSquared = abx * abx + aby * aby;
	if (abLengthSquared <= 1e-6) {
		return Math.hypot(px - ax, py - ay);
	}
	const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLengthSquared));
	const closestX = ax + abx * t;
	const closestY = ay + aby * t;
	return Math.hypot(px - closestX, py - closestY);
};

class InkMathImageDebugModal extends Modal {
	private readonly imageBase64: string;
	private detachShell: (() => void) | null = null;

	constructor(app: App, imageBase64: string) {
		super(app);
		this.imageBase64 = imageBase64;
	}

	onOpen(): void {
		this.detachShell = attachInkDocModalEngine(this, { tone: "debug", size: "md" });
		this.titleEl.setText("InkMath OCR Debug");
		this.contentEl.empty();
		this.contentEl.createEl("p", {
			text: "Previsualización exacta de la imagen enviada al backend (blanco + negro)."
		});
		const image = this.contentEl.createEl("img", {
			attr: {
				src: this.imageBase64,
				alt: "InkMath OCR debug preview"
			}
		});
		image.style.display = "block";
		image.style.maxWidth = "100%";
		image.style.border = "1px solid var(--background-modifier-border)";
		image.style.borderRadius = "8px";
		image.style.background = "#ffffff";
	}

	onClose(): void {
		this.detachShell?.();
		this.detachShell = null;
		this.contentEl.empty();
	}
}
