// @ts-nocheck
import type { InkDocImageBlock, InkDocPoint, InkDocStroke, InkDocTextBlock } from "../types";
import {
	INKDOC_IMAGE_MIN_HEIGHT,
	INKDOC_IMAGE_MIN_WIDTH,
	INKDOC_TEXT_MIN_HEIGHT,
	INKDOC_TEXT_MIN_WIDTH
} from "./constants";

export type RectBounds = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

export function pointInRect(point: InkDocPoint, rect: RectBounds): boolean {
	return (
		point.x >= rect.left &&
		point.x <= rect.right &&
		point.y >= rect.top &&
		point.y <= rect.bottom
	);
}

export function getRectFromPoints(a: InkDocPoint, b: InkDocPoint): RectBounds {
	return {
		left: Math.min(a.x, b.x),
		top: Math.min(a.y, b.y),
		right: Math.max(a.x, b.x),
		bottom: Math.max(a.y, b.y)
	};
}

export function getStrokeBounds(stroke: InkDocStroke): RectBounds {
	const points = stroke.points;
	if (points.length === 0) {
		return { left: 0, top: 0, right: 0, bottom: 0 };
	}
	let left = points[0]?.x ?? 0;
	let right = left;
	let top = points[0]?.y ?? 0;
	let bottom = top;
	for (const point of points) {
		left = Math.min(left, point.x);
		right = Math.max(right, point.x);
		top = Math.min(top, point.y);
		bottom = Math.max(bottom, point.y);
	}
	return { left, top, right, bottom };
}

export function getTextBlockBounds(block: InkDocTextBlock): RectBounds {
	const w = Math.max(INKDOC_TEXT_MIN_WIDTH, block.w);
	const h = Math.max(INKDOC_TEXT_MIN_HEIGHT, block.h);
	return {
		left: block.x,
		top: block.y,
		right: block.x + w,
		bottom: block.y + h
	};
}

export function getImageBlockBounds(block: InkDocImageBlock): RectBounds {
	const w = Math.max(INKDOC_IMAGE_MIN_WIDTH, block.w);
	const h = Math.max(INKDOC_IMAGE_MIN_HEIGHT, block.h);
	return {
		left: block.x,
		top: block.y,
		right: block.x + w,
		bottom: block.y + h
	};
}

export function rectIntersects(a: RectBounds, b: RectBounds): boolean {
	return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

export function distanceToSegment(p: InkDocPoint, a: InkDocPoint, b: InkDocPoint): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	if (dx === 0 && dy === 0) {
		const px = p.x - a.x;
		const py = p.y - a.y;
		return Math.hypot(px, py);
	}
	const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
	const clamped = Math.max(0, Math.min(1, t));
	const projX = a.x + clamped * dx;
	const projY = a.y + clamped * dy;
	return Math.hypot(p.x - projX, p.y - projY);
}

export function strokeHitsPoint(
	stroke: InkDocStroke,
	point: InkDocPoint,
	radius: number
): boolean {
	const points = stroke.points;
	if (points.length === 0) {
		return false;
	}
	for (let i = 0; i < points.length; i++) {
		const start = points[i];
		if (!start) {
			continue;
		}
		const end = points[i + 1] ?? start;
		if (distanceToSegment(point, start, end) <= radius) {
			return true;
		}
	}
	return false;
}
