// @ts-nocheck
import type { InkDocPoint } from "../types";
import { PalmRejectionController } from "./palmRejection";

export type PointerSample = {
	point: InkDocPoint;
	pointerId: number;
	pointerType: string;
	isStylus: boolean;
	hasPressure: boolean;
	hasTilt: boolean;
	button: number;
	buttons: number;
	event: PointerEvent;
};

type PointerHandlers = {
	onPointerDown: (sample: PointerSample) => void;
	onPointerMove: (sample: PointerSample) => void;
	onPointerUp: (sample: PointerSample) => void;
	onContextMenu?: (event: MouseEvent) => void;
	onStylusAvailabilityChange?: (available: boolean) => void;
};

type InputControllerOptions = {
	isPalmRejectionEnabled?: () => boolean;
	preferLowLatency?: () => boolean;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const normalizeStylusPressure = (rawPressure: number): number => {
	const clamped = clamp01(rawPressure);
	if (clamped <= 0) {
		return 0;
	}
	// Remove tiny hardware noise and bias the curve to keep low pressure controllable.
	const denoised = Math.max(0, (clamped - 0.035) / 0.965);
	return clamp01(Math.pow(denoised, 0.82));
};

const resolveTiltFromPointerEvent = (event: PointerEvent): { tiltX: number; tiltY: number; hasTilt: boolean } => {
	const nativeTiltX = Number.isFinite(event.tiltX) ? event.tiltX : 0;
	const nativeTiltY = Number.isFinite(event.tiltY) ? event.tiltY : 0;
	if (nativeTiltX !== 0 || nativeTiltY !== 0) {
		return { tiltX: nativeTiltX, tiltY: nativeTiltY, hasTilt: true };
	}
	const alt = (event as unknown as { altitudeAngle?: number }).altitudeAngle;
	const azi = (event as unknown as { azimuthAngle?: number }).azimuthAngle;
	if (!Number.isFinite(alt) || !Number.isFinite(azi)) {
		return { tiltX: 0, tiltY: 0, hasTilt: false };
	}
	const altitude = Number(alt);
	const azimuth = Number(azi);
	const tiltMagnitude = ((Math.PI / 2 - altitude) * 180) / Math.PI;
	const tiltX = Math.max(-90, Math.min(90, Math.sin(azimuth) * tiltMagnitude));
	const tiltY = Math.max(-90, Math.min(90, Math.cos(azimuth) * tiltMagnitude));
	return { tiltX, tiltY, hasTilt: Math.abs(tiltX) > 0.1 || Math.abs(tiltY) > 0.1 };
};

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

export class InputController {
	private stylusAvailable = false;
	private palmRejection = new PalmRejectionController();
	private activePointers = new Set<number>();

	constructor(
		private canvas: HTMLCanvasElement,
		private toCanvasPoint: (canvas: HTMLCanvasElement, event: PointerEvent) => InkDocPoint,
		private handlers: PointerHandlers,
		private options: InputControllerOptions = {}
	) {}

	private isPalmRejectionEnabled(): boolean {
		return this.options.isPalmRejectionEnabled?.() ?? false;
	}

	private preferLowLatency(): boolean {
		return this.options.preferLowLatency?.() ?? false;
	}

	private toSample(event: PointerEvent): PointerSample {
		const pointerType = event.pointerType || "mouse";
		const isStylus = isLikelyStylusEvent(event);
		if (isStylus && !this.stylusAvailable) {
			this.stylusAvailable = true;
			this.handlers.onStylusAvailabilityChange?.(true);
		}
		const point = this.toCanvasPoint(this.canvas, event);
		const rawPressure = Number.isFinite(event.pressure)
			? event.pressure
			: event.buttons !== 0
				? 0.5
				: 0;
		const hasPressure = isStylus ? rawPressure > 0 : rawPressure > 0 && Math.abs(rawPressure - 0.5) > 0.01;
		const pressure = isStylus
			? rawPressure <= 0
				? event.buttons !== 0
					? 0.18
					: 0
				: normalizeStylusPressure(rawPressure)
			: clamp01(rawPressure);
		const { tiltX, tiltY, hasTilt } = resolveTiltFromPointerEvent(event);
		point.pressure = pressure;
		point.tiltX = tiltX;
		point.tiltY = tiltY;
		return {
			point,
			pointerId: event.pointerId,
			pointerType,
			isStylus,
			hasPressure,
			hasTilt,
			button: event.button,
			buttons: event.buttons,
			event
		};
	}

	private handlePointerDown = (event: PointerEvent): void => {
		const sample = this.toSample(event);
		if (
			this.palmRejection.shouldRejectPointerDown(sample, {
				enabled: this.isPalmRejectionEnabled(),
				stylusAvailable: this.stylusAvailable
			})
		) {
			return;
		}
		this.activePointers.add(sample.pointerId);
		this.handlers.onPointerDown(sample);
	};

	private isPointerInContact(sample: PointerSample): boolean {
		if (sample.buttons !== 0 || sample.hasPressure) {
			return true;
		}
		if (!sample.isStylus) {
			return false;
		}
		const pressure = Number.isFinite(sample.event.pressure) ? sample.event.pressure : 0;
		return pressure > 0.001;
	}

	private dispatchPointerMoveSample(sample: PointerSample, allowSyntheticUp: boolean): void {
		if (this.palmRejection.shouldRejectPointerMove(sample)) {
			return;
		}
		if (!this.activePointers.has(sample.pointerId)) {
			return;
		}
		if (!this.isPointerInContact(sample)) {
			if (allowSyntheticUp) {
				this.activePointers.delete(sample.pointerId);
				this.handlers.onPointerUp(sample);
			}
			return;
		}
		this.handlers.onPointerMove(sample);
	}

	private handlePointerMove = (event: PointerEvent): void => {
		const coalesced =
			this.preferLowLatency() || typeof event.getCoalescedEvents !== "function"
				? []
				: event.getCoalescedEvents();
		if (coalesced.length > 0) {
			for (const entry of coalesced) {
				const sample = this.toSample(entry);
				this.dispatchPointerMoveSample(sample, false);
			}
		}
		const sample = this.toSample(event);
		this.dispatchPointerMoveSample(sample, true);
	};

	private handlePointerUp = (event: PointerEvent): void => {
		const sample = this.toSample(event);
		if (this.palmRejection.shouldRejectPointerUp(sample)) {
			this.activePointers.delete(sample.pointerId);
			return;
		}
		if (!this.activePointers.has(sample.pointerId)) {
			return;
		}
		this.activePointers.delete(sample.pointerId);
		this.handlers.onPointerUp(sample);
	};

	private handleContextMenu = (event: MouseEvent): void => {
		this.handlers.onContextMenu?.(event);
	};

	attach(): void {
		this.canvas.addEventListener("pointerdown", this.handlePointerDown);
		this.canvas.addEventListener("pointermove", this.handlePointerMove);
		this.canvas.addEventListener("pointerup", this.handlePointerUp);
		this.canvas.addEventListener("pointerleave", this.handlePointerUp);
		this.canvas.addEventListener("pointercancel", this.handlePointerUp);
		this.canvas.addEventListener("contextmenu", this.handleContextMenu);
	}

	dispose(): void {
		this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
		this.canvas.removeEventListener("pointermove", this.handlePointerMove);
		this.canvas.removeEventListener("pointerup", this.handlePointerUp);
		this.canvas.removeEventListener("pointerleave", this.handlePointerUp);
		this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
		this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
	}
}
