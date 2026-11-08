import type { Point } from './geometry';

export function pointDistance(p: Point, a: Point, b: Point) {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
	return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
	const cross = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
	if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
		return 0;
	return Math.min(pointDistance(a, c, d), pointDistance(b, c, d), pointDistance(c, a, b), pointDistance(d, a, b));
}

export function inPolygon(p: Point, polygon: Point[]) {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const a = polygon[i];
		const b = polygon[j];
		if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0])
			inside = !inside;
	}
	return inside;
}

export function edgeClearance(p: Point, polygon: Point[]) {
	return Math.min(...polygon.slice(1).map((b, i) => pointDistance(p, polygon[i], b)));
}

export function segmentInside(a: Point, b: Point, polygon: Point[], clearance: number) {
	return inPolygon(a, polygon) && inPolygon(b, polygon) && polygon.slice(1).every((q, i) => segmentDistance(a, b, polygon[i], q) >= clearance - 1e-7);
}

export function rectangleDistance(a: Point, b: Point, center: Point, width: number, height: number) {
	if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 1e-10)
		return Math.hypot(Math.max(0, Math.abs(a[0] - center[0]) - width / 2), Math.max(0, Math.abs(a[1] - center[1]) - height / 2));
	const contains = (p: Point) => Math.abs(p[0] - center[0]) <= width / 2 && Math.abs(p[1] - center[1]) <= height / 2;
	if (contains(a) || contains(b))
		return 0;
	const corners: Point[] = [[center[0] - width / 2, center[1] - height / 2], [center[0] + width / 2, center[1] - height / 2], [center[0] + width / 2, center[1] + height / 2], [center[0] - width / 2, center[1] + height / 2]];
	return Math.min(...corners.map((p, i) => segmentDistance(a, b, p, corners[(i + 1) % 4])));
}

export function octile(a: Point, b: Point): Point[][] {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const diagonal = Math.min(Math.abs(dx), Math.abs(dy));
	const first: Point = [a[0] + Math.sign(dx) * diagonal, a[1] + Math.sign(dy) * diagonal];
	const last: Point = [b[0] - Math.sign(dx) * diagonal, b[1] - Math.sign(dy) * diagonal];
	return [[a, first, b], [a, last, b]].map(points => points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-8));
}
