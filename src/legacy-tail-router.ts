import type { Design, Point, Track, Via } from './geometry';

import { edgeClearance, inPolygon, pointDistance } from './routing-math';

// Compatibility implementation for already generated 0.2.0 sessions.
class Heap {
	items: [number, number][] = [];
	push(item: [number, number]) {
		let i = this.items.length;
		this.items.push(item);
		while (i) {
			const parent = (i - 1) >> 1;
			if (this.items[parent][0] <= item[0])
				break;
			this.items[i] = this.items[parent];
			i = parent;
		}
		this.items[i] = item;
	}

	pop() {
		const result = this.items[0];
		const last = this.items.pop()!;
		if (this.items.length) {
			let i = 0;
			while (i * 2 + 1 < this.items.length) {
				let child = i * 2 + 1;
				if (child + 1 < this.items.length && this.items[child + 1][0] < this.items[child][0])
					child++;
				if (this.items[child][0] >= last[0])
					break;
				this.items[i] = this.items[child];
				i = child;
			}
			this.items[i] = last;
		}
		return result;
	}
}

function attempt(d: Design, sources: { point: Point; owner: string }[], startY: number, priority: number[]): { tracks: Track[]; vias: Via[]; issues: string[] } {
	const p = d.parameters;
	const clearance = p.leadGap;
	const step = Math.max(0.08, Math.min(0.16, (p.leadWidth + clearance) / 2));
	const left = Math.min(...d.outline.map(v => v[0]));
	const right = Math.max(...d.outline.map(v => v[0]));
	const bottom = Math.max(...d.pads.map(v => v.center[1]));
	const axis = (a: number, b: number, exact: number[]) => [...new Set([...Array.from({ length: Math.ceil((b - a) / step) + 1 }, (_, i) => Number(Math.min(b, a + i * step).toFixed(5))), ...exact])].sort((a, b) => a - b);
	const xs = axis(left + p.margin, right - p.margin, [...sources.map(s => s.point[0]), ...d.pads.map(s => s.center[0])]);
	const ys = axis(startY, bottom, [startY, ...d.pads.map(s => s.center[1])]);
	const size = xs.length * ys.length;
	if (size > 180000)
		return { tracks: [], vias: [], issues: ['引出区域过大，请缩短尾部或减小主体尺寸后重新布线。'] };
	const tracks: Track[] = [];
	const vias: Via[] = [];
	const at = (id: number): Point => [xs[id % xs.length], ys[Math.floor((id % size) / xs.length)]];
	const closest = (values: number[], value: number) => values.reduce((best, v, i) => Math.abs(v - value) < Math.abs(values[best] - value) ? i : best, 0);
	const index = (point: Point) => closest(xs, point[0]) + closest(ys, point[1]) * xs.length;
	const allEscapes = d.tracks.filter(t => t.stage === 3);
	const ordered = priority.map(i => sources[i]);
	for (const source of ordered) {
		const pad = d.pads.find(v => v.name === source.owner)!;
		const foreignTracks = [...allEscapes, ...tracks].filter(t => t.owner !== source.owner);
		const foreignPads = d.pads.filter(v => v.name !== source.owner);
		const blocked = new Uint8Array(size * 2);
		const viaBlocked = new Uint8Array(size);
		for (let i = 0; i < size; i++) {
			const point = at(i);
			const border = edgeClearance(point, d.outline);
			const inside = inPolygon(point, d.outline);
			for (let layer = 1; layer <= 2; layer++) {
				// Extra half-cell padding prevents a grid edge slipping through an obstacle.
				const radius = p.leadWidth / 2 + clearance + step / 2;
				blocked[i + (layer - 1) * size] = Number(!inside || border < p.leadWidth / 2 + 0.3 || foreignTracks.some(t => (t.layer || 1) === layer && pointDistance(point, t.a, t.b) < radius + t.width / 2) || vias.some(v => v.owner !== source.owner && Math.hypot(point[0] - v.center[0], point[1] - v.center[1]) < radius + v.diameter / 2) || (layer === 1 && foreignPads.some(v => Math.abs(point[0] - v.center[0]) < v.width / 2 + radius && Math.abs(point[1] - v.center[1]) < v.height / 2 + radius)));
			}
			const radius = p.viaDiameter / 2 + clearance + 0.015;
			viaBlocked[i] = Number(!inside || border < p.viaDiameter / 2 + 0.3 || point[1] > Math.min(...d.pads.map(v => v.center[1] - v.height / 2)) - p.viaDiameter || foreignTracks.some(t => pointDistance(point, t.a, t.b) < radius + t.width / 2) || vias.some(v => Math.hypot(point[0] - v.center[0], point[1] - v.center[1]) < radius + v.diameter / 2));
		}
		const start = index(source.point);
		const goal = index(pad.center);
		const costs = new Float64Array(size * 2).fill(Number.POSITIVE_INFINITY);
		const parents = new Int32Array(size * 2).fill(-1);
		const heap = new Heap();
		const heuristic = (id: number) => Math.abs(at(id)[0] - pad.center[0]) + Math.abs(at(id)[1] - pad.center[1]);
		costs[start] = 0;
		heap.push([heuristic(start), start]);
		let found = false;
		while (heap.items.length) {
			const [priority, id] = heap.pop();
			if (priority > costs[id] + heuristic(id) + 1e-8)
				continue;
			if (id === goal) {
				found = true;
				break;
			}
			const local = id % size;
			const x = local % xs.length;
			const y = Math.floor(local / xs.length);
			const next = [x > 0 ? id - 1 : -1, x + 1 < xs.length ? id + 1 : -1, y > 0 ? id - xs.length : -1, y + 1 < ys.length ? id + xs.length : -1];
			if (p.allowBack && !viaBlocked[local])
				next.push(id < size ? id + size : id - size);
			for (const n of next) {
				if (n < 0 || blocked[n] || (!p.allowBack && n >= size))
					continue;
				const via = Math.abs(n - id) === size;
				const a = at(id);
				const b = at(n);
				const cost = costs[id] + (via ? 6 : Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])) + (n >= size && !via ? 0.002 : 0);
				if (cost < costs[n] - 1e-9) {
					costs[n] = cost;
					parents[n] = id;
					heap.push([cost + heuristic(n), n]);
				}
			}
		}
		if (!found)
			return { tracks: [], vias: [], issues: [`${source.owner} 无法按当前顺序完成引出。请增加尾部空间、调整顺序${p.allowBack ? '或线距' : '或开启背面走线'}。`] };
		const path: number[] = [];
		for (let id = goal; id !== -1; id = parents[id])
			path.push(id);
		path.reverse();

		for (let i = 1; i < path.length; i++) {
			const a = at(path[i - 1]);
			const b = at(path[i]);
			if (Math.abs(path[i] - path[i - 1]) === size) {
				vias.push({ center: a, diameter: p.viaDiameter, hole: p.viaHole, stage: 3, owner: source.owner });
				continue;
			}
			const layer = path[i] < size ? 1 : 2;
			const last = tracks.at(-1);
			if (last?.owner === source.owner && last.layer === layer && Math.hypot(last.b[0] - a[0], last.b[1] - a[1]) < 1e-7 && Math.abs((last.b[0] - last.a[0]) * (b[1] - a[1]) - (last.b[1] - last.a[1]) * (b[0] - a[0])) < 1e-8)
				last.b = b;
			else
				tracks.push({ a, b, layer, width: p.leadWidth, owner: source.owner, stage: 3 });
		}
	}
	return { tracks, vias, issues: [] };
}

export function routeLegacyTail(d: Design, sources: { point: Point; owner: string }[], startY: number) {
	const permutations = (items: number[]): number[][] => items.length ? items.flatMap((n, i) => permutations(items.filter((_, j) => j !== i)).map(rest => [n, ...rest])) : [[]];
	const preferred = sources.map((s, i) => ({ i, distance: Math.abs(s.point[0] - d.pads.find(p => p.name === s.owner)!.center[0]) })).sort((a, b) => b.distance - a.distance).map(v => v.i);
	let result = attempt(d, sources, startY, preferred);
	if (!result.issues.length)
		return result;
	for (const order of permutations([0, 1, 2, 3])) {
		result = attempt(d, sources, startY, order);
		if (!result.issues.length)
			return result;
	}
	return result;
}
