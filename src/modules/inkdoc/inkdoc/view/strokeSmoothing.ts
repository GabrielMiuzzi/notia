// @ts-nocheck
import type { InkDocPoint } from "../types";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const clonePoint = (point: InkDocPoint): InkDocPoint => ({
	x: point.x,
	y: point.y,
	pressure: point.pressure,
	tiltX: point.tiltX,
	tiltY: point.tiltY
});

export const stabilizePoint = (
	last: InkDocPoint | null,
	next: InkDocPoint,
	stabilizer: number
): InkDocPoint => {
	if (!last) {
		return clonePoint(next);
	}
	const amount = clamp01(stabilizer);
	const blend = 1 - amount * 0.8;
	return {
		x: last.x + (next.x - last.x) * blend,
		y: last.y + (next.y - last.y) * blend,
		pressure:
			typeof next.pressure === "number" && typeof last.pressure === "number"
				? last.pressure + (next.pressure - last.pressure) * blend
				: next.pressure,
		tiltX: typeof next.tiltX === "number" ? next.tiltX : last.tiltX,
		tiltY: typeof next.tiltY === "number" ? next.tiltY : last.tiltY
	};
};

export const smoothStrokePoints = (points: InkDocPoint[], smoothing: number): InkDocPoint[] => {
	if (points.length < 3) {
		return points.map(clonePoint);
	}
	const amount = clamp01(smoothing);
	if (amount <= 0.01) {
		return points.map(clonePoint);
	}
	const radius = Math.max(1, Math.round(amount * 4));
	const output: InkDocPoint[] = [];
	for (let i = 0; i < points.length; i++) {
		let sumX = 0;
		let sumY = 0;
		let sumPressure = 0;
		let pressureCount = 0;
		let count = 0;
		for (let offset = -radius; offset <= radius; offset++) {
			const point = points[i + offset];
			if (!point) {
				continue;
			}
			count += 1;
			sumX += point.x;
			sumY += point.y;
			if (typeof point.pressure === "number") {
				sumPressure += point.pressure;
				pressureCount += 1;
			}
		}
		const current = points[i];
		if (!current || count === 0) {
			continue;
		}
		output.push({
			x: sumX / count,
			y: sumY / count,
			pressure: pressureCount > 0 ? sumPressure / pressureCount : current.pressure,
			tiltX: current.tiltX,
			tiltY: current.tiltY
		});
	}
	return output.length > 0 ? output : points.map(clonePoint);
};
