// @ts-nocheck
export type PalmRejectionPointerSample = {
	pointerId: number;
	pointerType: string;
	isStylus: boolean;
};

export type PalmRejectionContext = {
	enabled: boolean;
	stylusAvailable: boolean;
};

const isTouchPointer = (sample: PalmRejectionPointerSample): boolean => sample.pointerType === "touch";

export class PalmRejectionController {
	private rejectedPointers = new Set<number>();

	shouldRejectPointerDown(
		sample: PalmRejectionPointerSample,
		context: PalmRejectionContext
	): boolean {
		this.rejectedPointers.delete(sample.pointerId);
		if (sample.isStylus) {
			return false;
		}
		if (!isTouchPointer(sample)) {
			return false;
		}
		if (!context.enabled || !context.stylusAvailable) {
			return false;
		}
		this.rejectedPointers.add(sample.pointerId);
		return true;
	}

	shouldRejectPointerMove(sample: PalmRejectionPointerSample): boolean {
		return this.rejectedPointers.has(sample.pointerId);
	}

	shouldRejectPointerUp(sample: PalmRejectionPointerSample): boolean {
		return this.rejectedPointers.delete(sample.pointerId);
	}
}
