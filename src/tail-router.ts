import type { Design, Point, Track, Via } from './geometry';

import { edgeClearance, inPolygon, octile, pointDistance, rectangleDistance, segmentDistance, segmentInside } from './routing-math';

export { edgeClearance, inPolygon, pointDistance } from './routing-math';

interface Source { point: Point; owner: string }
interface Result { tracks: Track[]; vias: Via[]; issues: string[] }
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const close = (a: Point, b: Point) => distance(a, b) < 1e-7;
function direction(a: Point, b: Point) {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	if (Math.abs(dy) < 1e-7)
		return dx > 0 ? 0 : 4;
	if (Math.abs(dx) < 1e-7)
		return dy > 0 ? 2 : -1;
	if (dy > 0 && Math.abs(Math.abs(dx) - dy) < 1e-7)
		return dx > 0 ? 1 : 3;
	return -1;
}

function compress(tracks: Track[]) {
	const result: Track[] = [];
	for (const t of tracks) {
		if (distance(t.a, t.b) < 1e-7)
			continue;
		const previous = result.at(-1);
		if (previous && previous.owner === t.owner && (previous.layer || 1) === (t.layer || 1) && close(previous.b, t.a) && direction(previous.a, previous.b) === direction(t.a, t.b))
			previous.b = t.b;
		else result.push({ ...t });
	}
	return result;
}

function pathTracks(points: Point[], owner: string, width: number, layer = 1): Track[] {
	return points.slice(1).flatMap((b, i) => close(points[i], b) ? [] : [{ a: points[i], b, owner, width, layer, stage: 3 }]);
}

function clear(t: Track, d: Design, others: Track[], vias: Via[]) {
	const p = d.parameters;
	const radius = t.width / 2;
	if (!segmentInside(t.a, t.b, d.outline, radius + 0.3))
		return false;
	if (others.some(b => b.owner !== t.owner && (b.layer || 1) === (t.layer || 1) && segmentDistance(t.a, t.b, b.a, b.b) < radius + b.width / 2 + p.leadGap - 1e-7))
		return false;
	if (vias.some(v => v.owner !== t.owner && pointDistance(v.center, t.a, t.b) < radius + v.diameter / 2 + p.leadGap - 1e-7))
		return false;
	return (t.layer || 1) !== 1 || !d.pads.some(v => v.name !== t.owner && rectangleDistance(t.a, t.b, v.center, v.width, v.height) < radius + p.leadGap - 1e-7);
}

function score(result: Result) {
	let bends = 0;
	for (let i = 1; i < result.tracks.length; i++) {
		const a = result.tracks[i - 1];
		const b = result.tracks[i];
		if (a.owner === b.owner && close(a.b, b.a) && direction(a.a, a.b) !== direction(b.a, b.b))
			bends++;
	}
	return [result.vias.length, bends, result.tracks.reduce((sum, t) => sum + distance(t.a, t.b), 0)];
}
function better(a: Result, b: Result) {
	const sa = score(a);
	const sb = score(b);
	for (let i = 0; i < sa.length; i++) {
		if (Math.abs(sa[i] - sb[i]) > 1e-7)
			return sa[i] < sb[i];
	}
	return false;
}

// Shortcuts are real copper segments, restricted to 0/45/90 degrees and checked
// over their complete swept width. Vias and the straight tail entry remain pinned.
function tidy(result: Result, d: Design, obstacles: Track[]) {
	const output: Track[] = [];
	let i = 0;
	while (i < result.tracks.length) {
		let end = i;
		const first = result.tracks[i];
		while (end + 1 < result.tracks.length && result.tracks[end + 1].owner === first.owner && (result.tracks[end + 1].layer || 1) === (first.layer || 1) && close(result.tracks[end].b, result.tracks[end + 1].a) && !result.vias.some(v => v.owner === first.owner && close(v.center, result.tracks[end].b))) end++;
		let cursor = i;
		while (cursor <= end) {
			let replacement: Track[] | undefined;
			let next = cursor;
			for (let j = end; j > cursor; j--) {
				const candidates = octile(result.tracks[cursor].a, result.tracks[j].b).map(points => pathTracks(points, first.owner, first.width, first.layer || 1));
				for (const candidate of candidates) {
					if (candidate.length <= j - cursor + 1 && candidate.every(t => clear(t, d, [...obstacles, ...result.tracks], result.vias))) {
						replacement = candidate;
						next = j;
						break;
					}
				}
				if (replacement)
					break;
			}
			output.push(...(replacement || [result.tracks[cursor]]));
			cursor = next + 1;
		}
		i = end + 1;
	}
	return { ...result, tracks: compress(output) };
}

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

function attempt(d: Design, sources: Source[], startY: number, landingY: number, order: number[], stubs: Track[]): Result {
	const p = d.parameters;
	const step = Math.max(0.08, Math.min(0.14, (p.leadWidth + p.leadGap) / 2));
	const left = Math.min(...d.outline.map(v => v[0])) + 0.3 + p.leadWidth / 2;
	const right = Math.max(...d.outline.map(v => v[0])) - 0.3 - p.leadWidth / 2;
	const axis = (a: number, b: number, exact: number[]) => [...new Set([...Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step), b, ...exact])].sort((a, b) => a - b);
	const xs = axis(left, right, [...sources.map(s => s.point[0]), ...d.pads.map(v => v.center[0])]);
	const ys = axis(startY, landingY, [startY, landingY]);
	const size = xs.length * ys.length;
	if (size > 100000)
		return { tracks: [], vias: [], issues: ['引出区域过大，请调整尾部空间后重新布线。'] };
	const lookup = (axis: number[]) => new Map(axis.map((v, i) => [Math.round(v * 1e7), i]));
	const xIndex = lookup(xs);
	const yIndex = lookup(ys);
	const index = (v: Point) => xIndex.get(Math.round(v[0] * 1e7))! + yIndex.get(Math.round(v[1] * 1e7))! * xs.length;
	const at = (id: number): Point => [xs[id % xs.length], ys[Math.floor((id % size) / xs.length)]];
	const tracks: Track[] = [];
	const vias: Via[] = [];
	const fixed = d.tracks.filter(t => t.stage === 3);
	const viaWeight = 1e8;
	const bendWeight = 10000;
	for (const slot of order) {
		const source = sources[slot];
		const pad = d.pads.find(v => v.name === source.owner)!;
		const landing: Point = [pad.center[0], landingY];
		const foreign = [...fixed, ...stubs, ...tracks].filter(t => t.owner !== source.owner);
		const foreignPads = d.pads.filter(v => v.name !== source.owner);
		const blocked = new Uint8Array(size * 2);
		const edgeCache = new Int8Array(size * 2 * 5).fill(-1);
		const viaBlocked = new Uint8Array(size);
		for (let i = 0; i < size; i++) {
			const point = at(i);
			const border = edgeClearance(point, d.outline);
			const inside = inPolygon(point, d.outline);
			const radius = p.leadWidth / 2 + p.leadGap + 0.005;
			for (let layer = 1; layer <= 2; layer++) {
				blocked[i + (layer - 1) * size] = Number(!inside || border < p.leadWidth / 2 + 0.3 - 1e-7 || foreign.some(t => (t.layer || 1) === layer && pointDistance(point, t.a, t.b) < radius + t.width / 2) || vias.some(v => v.owner !== source.owner && distance(point, v.center) < radius + v.diameter / 2) || (layer === 1 && foreignPads.some(v => rectangleDistance(point, point, v.center, v.width, v.height) < radius)));
			}
			const viaRadius = p.viaDiameter / 2 + p.leadGap + 0.015;
			viaBlocked[i] = Number(!inside || border < p.viaDiameter / 2 + 0.3 || foreign.some(t => pointDistance(point, t.a, t.b) < viaRadius + t.width / 2) || vias.some(v => distance(point, v.center) < viaRadius + v.diameter / 2));
		}
		const start = index(source.point) * 5 + 2;
		const goal = index(landing);
		const costs = new Float64Array(size * 2 * 5).fill(Number.POSITIVE_INFINITY);
		const parents = new Int32Array(size * 2 * 5).fill(-1);
		const heap = new Heap();
		const heuristic = (state: number) => {
			const id = Math.floor(state / 5);
			if (id === goal)
				return 0;
			const point = at(id);
			const dx = landing[0] - point[0];
			const dy = landing[1] - point[1];
			const previous = state % 5;
			const horizontal = dx > 0 ? 0 : 4;
			const diagonal = dx > 0 ? 1 : 3;
			const bends = Math.abs(dx) < 1e-7 ? (previous === 2 ? 0 : 1) : previous === horizontal || (dy >= Math.abs(dx) - 1e-7 && previous === diagonal) ? 1 : 2;
			return Math.max(Math.abs(dx), dy) + (Math.SQRT2 - 1) * Math.min(Math.abs(dx), dy) + bends * bendWeight + (id >= size ? viaWeight : 0);
		};
		costs[start] = 0;
		heap.push([heuristic(start), start]);
		let found = -1;
		while (heap.items.length) {
			const [priority, state] = heap.pop();
			if (priority > costs[state] + heuristic(state) + 1e-5)
				continue;
			const id = Math.floor(state / 5);
			const previous = state % 5;
			if (id === goal) {
				found = state;
				break;
			}
			const local = id % size;
			const x = local % xs.length;
			const y = Math.floor(local / xs.length);
			const point = at(id);
			const layer = id < size ? 1 : 2;
			const neighbors: [number, number, boolean][] = [];
			if (x + 1 < xs.length)
				neighbors.push([id + 1, 0, false]);
			if (y + 1 < ys.length)
				neighbors.push([id + xs.length, 2, false]);
			if (x > 0)
				neighbors.push([id - 1, 4, false]);
			for (const [sign, heading] of [[1, 1], [-1, 3]]) {
				const nx = xIndex.get(Math.round((point[0] + sign * step) * 1e7));
				const ny = yIndex.get(Math.round((point[1] + step) * 1e7));
				if (nx !== undefined && ny !== undefined && Math.abs(Math.abs(xs[nx] - point[0]) - (ys[ny] - point[1])) < 1e-7)
					neighbors.push([nx + ny * xs.length + (layer - 1) * size, heading, false]);
			}
			if (p.allowBack && !viaBlocked[local])
				neighbors.push([id < size ? id + size : id - size, previous, true]);
			for (const [n, heading, via] of neighbors) {
				if (blocked[n] || (previous === 0 && heading === 4) || (previous === 4 && heading === 0))
					continue;
				if (!via) {
					const key = id * 5 + heading;
					if (edgeCache[key] === -1)
						edgeCache[key] = Number(clear({ a: point, b: at(n), width: p.leadWidth, layer, owner: source.owner, stage: 3 }, d, foreign, vias));
					if (!edgeCache[key])
						continue;
				}
				const target = n * 5 + heading;
				const cost = costs[state] + (via ? viaWeight : distance(point, at(n)) + (previous === heading ? 0 : bendWeight)) + (n === goal && heading !== 2 ? bendWeight : 0);
				if (cost < costs[target] - 1e-6) {
					costs[target] = cost;
					parents[target] = state;
					heap.push([cost + heuristic(target), target]);
				}
			}
		}
		if (found === -1)
			return { tracks: [], vias: [], issues: [`${source.owner} 无法按当前顺序完成规整引出，请增加尾部空间、调整线距${p.allowBack ? '' : '或开启背面走线'}。`] };
		const path: number[] = [];
		for (let state = found; state !== -1; state = parents[state]) path.push(Math.floor(state / 5));
		path.reverse();
		for (let i = 1; i < path.length; i++) {
			const a = at(path[i - 1]);
			const b = at(path[i]);
			if (Math.abs(path[i] - path[i - 1]) === size)
				vias.push({ center: a, diameter: p.viaDiameter, hole: p.viaHole, stage: 3, owner: source.owner });
			else tracks.push({ a, b, layer: path[i] < size ? 1 : 2, width: p.leadWidth, owner: source.owner, stage: 3 });
		}
	}
	const result = tidy({ tracks: compress(tracks), vias, issues: [] }, d, [...fixed, ...stubs]);
	result.tracks.push(...stubs);
	if (result.tracks.some(t => !clear(t, d, [...fixed, ...result.tracks], result.vias)))
		return { tracks: [], vias: [], issues: ['规整化后间距不足，请调整尾部空间或引出参数。'] };
	return result;
}

export function routeTail(d: Design, sources: Source[], startY: number): Result {
	const p = d.parameters;
	const landingY = d.outline[3][1] - Math.max(0.6, p.viaDiameter + p.leadGap);
	const failure: Result = { tracks: [], vias: [], issues: ['尾部空间不足以完成规整引出，请增加尾部延伸长度。'] };
	if (landingY <= startY + p.leadGap)
		return failure;
	const stubs = d.pads.map(pad => ({ a: [pad.center[0], landingY] as Point, b: pad.center, owner: pad.name, width: p.leadWidth, layer: 1, stage: 3 }));
	const fixed = d.tracks.filter(t => t.stage === 3);
	let best: Result | undefined;
	// The natural order is a four-lane, exactly 45-degree funnel, not grid search.
	for (let mask = 0; mask < 16; mask++) {
		const tracks = sources.flatMap((source, i) => {
			const stub = stubs.find(t => t.owner === source.owner)!;
			return [...pathTracks(octile(source.point, stub.a)[(mask >> i) & 1], source.owner, p.leadWidth), stub];
		});
		const result = { tracks: compress(tracks), vias: [], issues: [] };
		if (result.tracks.every(t => clear(t, d, [...fixed, ...result.tracks], [])) && (!best || better(result, best)))
			best = result;
	}
	if (best)
		return best;
	if (!p.allowBack)
		return { ...failure, issues: ['当前接点顺序或尺寸无法在正面完成规整走线，请调整顺序、尾部空间或开启背面走线。'] };
	const permutations = (items: number[]): number[][] => items.length ? items.flatMap((n, i) => permutations(items.filter((_, j) => j !== i)).map(rest => [n, ...rest])) : [[]];
	const preferred = sources.map((s, i) => ({ i, distance: Math.abs(s.point[0] - d.pads.find(p => p.name === s.owner)!.center[0]) })).sort((a, b) => b.distance - a.distance).map(v => v.i);
	const spatial = sources.map((s, i) => ({ i, x: s.point[0] })).sort((a, b) => a.x - b.x).map(v => v.i);
	const ranks = spatial.map(i => d.pads.findIndex(p => p.name === sources[i].owner));
	const subsets = Array.from({ length: 16 }, (_, mask) => spatial.filter((_, i) => (mask >> i) & 1)).filter(items => items.every((n, i) => i === 0 || ranks[spatial.indexOf(items[i - 1])] < ranks[spatial.indexOf(n)]));
	const longest = Math.max(...subsets.map(items => items.length));
	const lowerBound = 2 * (4 - longest);
	const plans = subsets.filter(items => items.length === longest).map(items => [...items, ...preferred.filter(i => !items.includes(i))]);
	let attempts = 0;
	let lastFailure = failure;
	for (const order of [...plans, preferred, ...permutations([0, 1, 2, 3])]) {
		const candidate = attempt(d, sources, startY, landingY, order, stubs);
		if (candidate.issues.length)
			lastFailure = candidate;
		if (!candidate.issues.length && (!best || better(candidate, best)))
			best = candidate;
		// Compare multiple deterministic routes, bounded for interactive editing.
		if (best && (++attempts >= 6 || (attempts >= 2 && best.vias.length <= lowerBound)))
			break;
	}
	return best || lastFailure;
}
