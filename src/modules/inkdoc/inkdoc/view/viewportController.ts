// @ts-nocheck
import type { InkDocPoint } from "../types";

type InkDocCanvasSizePx = {
	widthPx: number;
	heightPx: number;
};

type InkDocViewportPoint = {
	x: number;
	y: number;
};

type InkDocViewportScroll = {
	left: number;
	top: number;
};

type InkDocViewportControllerOptions = {
	onZoomChanged?: (zoomLevel: number) => void;
	minZoom?: number;
	maxZoom?: number;
};

const DEFAULT_MIN_ZOOM = 0.5;
const DEFAULT_MAX_ZOOM = 2.5;

export const getCanvasPointerPosition = (
	canvas: HTMLCanvasElement,
	event: PointerEvent,
	canvasSize: InkDocCanvasSizePx
): InkDocPoint => {
	const { widthPx, heightPx } = canvasSize;
	const localWidth = Math.max(1, canvas.clientWidth || widthPx);
	const localHeight = Math.max(1, canvas.clientHeight || heightPx);
	const isCanvasTarget = event.currentTarget === canvas || event.target === canvas;
	if (isCanvasTarget && Number.isFinite(event.offsetX) && Number.isFinite(event.offsetY)) {
		return {
			x: event.offsetX * (widthPx / localWidth),
			y: event.offsetY * (heightPx / localHeight)
		};
	}
	const rect = canvas.getBoundingClientRect();
	const scaleX = rect.width > 0 ? widthPx / rect.width : 1;
	const scaleY = rect.height > 0 ? heightPx / rect.height : 1;
	const x = (event.clientX - rect.left) * scaleX;
	const y = (event.clientY - rect.top) * scaleY;
	return { x, y };
};

export const getCanvasMousePosition = (
	canvas: HTMLCanvasElement,
	event: MouseEvent,
	canvasSize: InkDocCanvasSizePx
): InkDocPoint => {
	const { widthPx, heightPx } = canvasSize;
	const localWidth = Math.max(1, canvas.clientWidth || widthPx);
	const localHeight = Math.max(1, canvas.clientHeight || heightPx);
	const isCanvasTarget = event.currentTarget === canvas || event.target === canvas;
	if (isCanvasTarget && Number.isFinite(event.offsetX) && Number.isFinite(event.offsetY)) {
		return {
			x: event.offsetX * (widthPx / localWidth),
			y: event.offsetY * (heightPx / localHeight)
		};
	}
	const rect = canvas.getBoundingClientRect();
	const scaleX = rect.width > 0 ? widthPx / rect.width : 1;
	const scaleY = rect.height > 0 ? heightPx / rect.height : 1;
	const x = (event.clientX - rect.left) * scaleX;
	const y = (event.clientY - rect.top) * scaleY;
	return { x, y };
};

export const getCanvasClientPoint = (
	canvas: HTMLCanvasElement,
	clientX: number,
	clientY: number,
	canvasSize: InkDocCanvasSizePx
): InkDocPoint => {
	const rect = canvas.getBoundingClientRect();
	const { widthPx, heightPx } = canvasSize;
	const scaleX = rect.width > 0 ? widthPx / rect.width : 1;
	const scaleY = rect.height > 0 ? heightPx / rect.height : 1;
	const x = (clientX - rect.left) * scaleX;
	const y = (clientY - rect.top) * scaleY;
	return { x, y };
};

export const getPagesContentClientPoint = (
	pagesContentEl: HTMLDivElement | null,
	clientX: number,
	clientY: number
): { x: number; y: number } | null => {
	if (!pagesContentEl) {
		return null;
	}
	const rect = pagesContentEl.getBoundingClientRect();
	const rawX = clientX - rect.left;
	const rawY = clientY - rect.top;
	const maxX = Math.max(0, rect.width);
	const maxY = Math.max(0, rect.height);
	return {
		x: Math.max(0, Math.min(maxX, rawX)),
		y: Math.max(0, Math.min(maxY, rawY))
	};
};

export class InkDocViewportController {
	private zoomLevel = 1;
	private isPanning = false;
	private handPanPointerId: number | null = null;
	private handGesturePointers = new Map<number, InkDocViewportPoint>();
	private pinchStartDistance: number | null = null;
	private pinchStartZoom = 1;
	private pinchAnchorContent: InkDocViewportPoint | null = null;
	private panStart: InkDocViewportPoint | null = null;
	private panScrollStart: InkDocViewportScroll | null = null;
	private readonly onZoomChanged: (zoomLevel: number) => void;
	private readonly minZoom: number;
	private readonly maxZoom: number;

	constructor(options: InkDocViewportControllerOptions = {}) {
		this.onZoomChanged = options.onZoomChanged ?? (() => {});
		this.minZoom = options.minZoom ?? DEFAULT_MIN_ZOOM;
		this.maxZoom = options.maxZoom ?? DEFAULT_MAX_ZOOM;
	}

	public getZoomLevel(): number {
		return this.zoomLevel;
	}

	public isPanningActive(): boolean {
		return this.isPanning;
	}

	public applyZoomToPageElement(pageEl: HTMLDivElement): void {
		const widthMm = Number(pageEl.dataset.pageWidthMm ?? "0");
		const heightMm = Number(pageEl.dataset.pageHeightMm ?? "0");
		if (widthMm > 0) {
			pageEl.style.width = `${widthMm * this.zoomLevel}mm`;
		}
		if (heightMm > 0) {
			pageEl.style.height = `${heightMm * this.zoomLevel}mm`;
		}
	}

	public handleWheelZoom(pagesEl: HTMLDivElement, event: WheelEvent): boolean {
		const rect = pagesEl.getBoundingClientRect();
		const pointerX = event.clientX - rect.left;
		const pointerY = event.clientY - rect.top;
		const startZoom = this.zoomLevel;
		const direction = event.deltaY > 0 ? -1 : 1;
		const nextZoom = this.clampZoom(startZoom * (direction > 0 ? 1.1 : 0.9));
		if (nextZoom === startZoom) {
			return false;
		}
		const contentX = (pagesEl.scrollLeft + pointerX) / startZoom;
		const contentY = (pagesEl.scrollTop + pointerY) / startZoom;
		this.zoomLevel = nextZoom;
		this.onZoomChanged(this.zoomLevel);
		pagesEl.scrollLeft = contentX * nextZoom - pointerX;
		pagesEl.scrollTop = contentY * nextZoom - pointerY;
		return true;
	}

	public handleHandPointerDown(pagesEl: HTMLDivElement, event: PointerEvent): boolean {
		this.handGesturePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		pagesEl.setPointerCapture(event.pointerId);
		if (this.handGesturePointers.size >= 2) {
			this.beginHandPinchGesture(pagesEl);
		} else {
			this.isPanning = true;
			this.handPanPointerId = event.pointerId;
			this.panStart = { x: event.clientX, y: event.clientY };
			this.panScrollStart = { left: pagesEl.scrollLeft, top: pagesEl.scrollTop };
			pagesEl.classList.add("is-panning");
		}
		return true;
	}

	public handleHandPointerMove(pagesEl: HTMLDivElement, event: PointerEvent): boolean {
		if (this.handGesturePointers.has(event.pointerId)) {
			this.handGesturePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		}
		if (this.handGesturePointers.size >= 2 && this.pinchStartDistance && this.pinchAnchorContent) {
			this.updateHandPinchGesture(pagesEl);
			return true;
		}
		if (
			!this.isPanning ||
			this.handPanPointerId !== event.pointerId ||
			!this.panStart ||
			!this.panScrollStart
		) {
			return false;
		}
		const dx = event.clientX - this.panStart.x;
		const dy = event.clientY - this.panStart.y;
		pagesEl.scrollLeft = this.panScrollStart.left - dx;
		pagesEl.scrollTop = this.panScrollStart.top - dy;
		return true;
	}

	public finishHandGesturePointer(pagesEl: HTMLDivElement, pointerId: number): void {
		this.handGesturePointers.delete(pointerId);
		if (pagesEl.hasPointerCapture(pointerId)) {
			pagesEl.releasePointerCapture(pointerId);
		}
		if (this.handGesturePointers.size >= 2) {
			this.beginHandPinchGesture(pagesEl);
			return;
		}
		this.pinchStartDistance = null;
		this.pinchAnchorContent = null;
		this.isPanning = false;
		this.handPanPointerId = null;
		this.panStart = null;
		this.panScrollStart = null;
		pagesEl.classList.remove("is-panning");
		if (this.handGesturePointers.size === 1) {
			const remainingEntry = Array.from(this.handGesturePointers.entries())[0];
			if (!remainingEntry) {
				return;
			}
			const [remainingPointerId, remainingPoint] = remainingEntry;
			this.isPanning = true;
			this.handPanPointerId = remainingPointerId;
			this.panStart = { x: remainingPoint.x, y: remainingPoint.y };
			this.panScrollStart = { left: pagesEl.scrollLeft, top: pagesEl.scrollTop };
			pagesEl.classList.add("is-panning");
		}
	}

	public resetHandInteraction(pagesEl: HTMLDivElement | null): void {
		if (pagesEl) {
			pagesEl.classList.remove("is-panning");
		}
		this.isPanning = false;
		this.handPanPointerId = null;
		this.handGesturePointers.clear();
		this.pinchStartDistance = null;
		this.pinchAnchorContent = null;
		this.panStart = null;
		this.panScrollStart = null;
	}

	private clampZoom(value: number): number {
		return Math.min(this.maxZoom, Math.max(this.minZoom, value));
	}

	private getHandGesturePair(): [InkDocViewportPoint, InkDocViewportPoint] | null {
		if (this.handGesturePointers.size < 2) {
			return null;
		}
		const entries = Array.from(this.handGesturePointers.values());
		const first = entries[0];
		const second = entries[1];
		if (!first || !second) {
			return null;
		}
		return [first, second];
	}

	private beginHandPinchGesture(pagesEl: HTMLDivElement): void {
		const pair = this.getHandGesturePair();
		if (!pair) {
			return;
		}
		const [first, second] = pair;
		this.isPanning = false;
		this.handPanPointerId = null;
		this.panStart = null;
		this.panScrollStart = null;
		pagesEl.classList.remove("is-panning");
		this.pinchStartDistance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
		this.pinchStartZoom = this.zoomLevel;
		const rect = pagesEl.getBoundingClientRect();
		const midpointX = (first.x + second.x) * 0.5 - rect.left;
		const midpointY = (first.y + second.y) * 0.5 - rect.top;
		this.pinchAnchorContent = {
			x: (pagesEl.scrollLeft + midpointX) / Math.max(0.001, this.zoomLevel),
			y: (pagesEl.scrollTop + midpointY) / Math.max(0.001, this.zoomLevel)
		};
	}

	private updateHandPinchGesture(pagesEl: HTMLDivElement): void {
		if (!this.pinchStartDistance || !this.pinchAnchorContent) {
			return;
		}
		const pair = this.getHandGesturePair();
		if (!pair) {
			return;
		}
		const [first, second] = pair;
		const nextDistance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
		const nextZoom = this.clampZoom(this.pinchStartZoom * (nextDistance / this.pinchStartDistance));
		const rect = pagesEl.getBoundingClientRect();
		const midpointX = (first.x + second.x) * 0.5 - rect.left;
		const midpointY = (first.y + second.y) * 0.5 - rect.top;
		if (nextZoom !== this.zoomLevel) {
			this.zoomLevel = nextZoom;
			this.onZoomChanged(this.zoomLevel);
		}
		pagesEl.scrollLeft = this.pinchAnchorContent.x * this.zoomLevel - midpointX;
		pagesEl.scrollTop = this.pinchAnchorContent.y * this.zoomLevel - midpointY;
	}

	public dispose(): void {
		this.resetHandInteraction(null);
	}
}
