import { routeLegacyTail } from './legacy-tail-router';
import { edgeClearance, inPolygon, pointDistance, rectangleDistance, segmentDistance, segmentInside } from './routing-math';
import { routeTail } from './tail-router';

/** Geometry is expressed in mm, x right / y down. EDA conversion lives in adapter.ts. */

export type Point = [number, number];

export interface Parameters {
	length: number;
	count: number;
	width: number;
	gap: number;
	thickness: number;
	quadrantGap: number;
	routingWidth: number;
	terminalMode: number;
	allowBack: number;
	leadWidth: number;
	leadGap: number;
	viaHole: number;
	viaDiameter: number;
	tailLength: number;
	tailWidth: number;
	contactPitch: number;
	contactWidth: number;
	contactLength: number;
	contactInset: number;
	padPitch: number;
	tailThickness: number;
	reinforcementLength: number;
	order0: number;
	order1: number;
	order2: number;
	order3: number;
	padWidth: number;
	padHeight: number;
	margin: number;
	originX: number;
	originY: number;
}

export interface Track { a: Point; b: Point; width: number; stage: number; owner: string; layer?: number }

export interface Pad { center: Point; width: number; height: number; name: string; stage: number }

export interface Via { center: Point; hole: number; diameter: number; owner: string; stage: number }

export interface Design { routerVersion?: 1 | 2; vias: Via[]; nodes: { name: string; point: Point }[]; routingIssues: string[]; tracks: Track[]; pads: Pad[]; outline: Point[]; arms: { name: string; center: Point; horizontal: boolean; terminals: Point[] }[]; parameters: Parameters }

export const defaults: Parameters = { length: 4.4, count: 21, width: 0.10, gap: 0.12, thickness: 18, quadrantGap: 0.3, routingWidth: 0.10, terminalMode: 0, allowBack: 1, leadWidth: 0.15, leadGap: 0.12, viaHole: 0.2, viaDiameter: 0.45, tailLength: 12, tailWidth: 2.5, contactPitch: 0.5, contactWidth: 0.35, contactLength: 2, contactInset: 0.3, padPitch: 1.5, tailThickness: 0.3, reinforcementLength: 3, order0: 0, order1: 3, order2: 2, order3: 1, padWidth: 1, padHeight: 1.4, margin: 0.6, originX: 0, originY: 0 };

export const stages = ['参数检查', '敏感栅与桥内互连', '敏感栅与桥内互连', '外部引出', '板框与覆盖膜开窗'];

export function parameters(input: unknown): Parameters {
	if (!input || typeof input !== 'object')

		throw new Error('缺少参数配置。');

	const p = Object.fromEntries(Object.keys(defaults).map(k => [k, (input as Record<string, unknown>)[k]])) as unknown as Parameters;

	for (const [key, value] of Object.entries(p)) {
		if (typeof value !== 'number' || !Number.isFinite(value))

			throw new Error(`参数 ${key} 必须是有限数值。`);
	}

	if (p.count < 5 || p.count > 101 || p.count % 2 !== 1)

		throw new Error('直栅条数应为 5～101 之间的奇数（紧凑互连模板）。');

	for (const k of ['length', 'width', 'gap', 'quadrantGap', 'routingWidth', 'padWidth', 'padHeight', 'margin'] as const) {
		if (p[k] <= 0 || p[k] > 100)

			throw new Error(`${k} 必须大于 0 且不超过 100 mm。`);
	}

	if (![18, 35].includes(p.thickness))

		throw new Error('当前铜厚档只提供 18 / 35 μm 铜厚。');

	if (![0, 1, 2].includes(p.terminalMode) || ![0, 1].includes(p.allowBack))
		throw new Error('引出方式或背面走线开关无效。');
	if (new Set([p.order0, p.order1, p.order2, p.order3]).size !== 4 || [p.order0, p.order1, p.order2, p.order3].some(v => ![0, 1, 2, 3].includes(v)))
		throw new Error('四个接点必须各选一个不同的桥路节点。');
	for (const key of ['leadWidth', 'leadGap', 'viaHole', 'viaDiameter', 'tailLength', 'tailWidth', 'contactPitch', 'contactWidth', 'contactLength', 'padPitch', 'tailThickness', 'reinforcementLength'] as const) {
		if (p[key] <= 0 || p[key] > 100)
			throw new Error(`${key} 必须大于 0 且不超过 100。`);
	}
	if (p.contactInset < 0 || p.contactInset > 10)
		throw new Error('接点距末端距离应为 0～10 mm。');

	return p;
}

export const coreKeys: (keyof Parameters)[] = ['length', 'count', 'width', 'gap', 'thickness', 'quadrantGap', 'routingWidth', 'originX', 'originY'];
export function changedStage(before: Parameters, after: Parameters): number {
	const changed = (Object.keys(defaults) as (keyof Parameters)[]).filter(k => before[k] !== after[k]);
	if (!changed.length)
		return 5;
	if (changed.some(k => coreKeys.includes(k)))
		return 1;
	// Margin influences the routing boundary, so existing leads must be regenerated.
	if (changed.some(k => k !== 'tailThickness' && k !== 'reinforcementLength'))
		return 3;
	return 5;
}

export function same(a: Point, b: Point, tolerance = 1e-6): boolean {
	return Math.hypot(a[0] - b[0], a[1] - b[1]) < tolerance;
}

export function length(t: Track): number {
	return Math.hypot(t.a[0] - t.b[0], t.a[1] - t.b[1]);
}

export function build(input: unknown, routerVersion: 1 | 2 = 2): Design {
	const p = parameters(input);

	const span = (p.count - 1) * (p.width + p.gap);

	// Place adjacent (90-degree rotated) copper envelopes exactly quadrantGap apart.
	const q = (p.length + span) / 2 + p.width;

	const side = q * 2 + p.quadrantGap;

	const x0 = (q - span) / 2;

	const y0 = (q - p.length) / 2;

	const transforms: Record<string, (v: Point) => Point> = {
		A: ([x, y]) => [y, q - x],
		B: ([x, y]) => [q + p.quadrantGap + x, y],
		C: ([x, y]) => [q - x, q + p.quadrantGap + q - y],
		D: ([x, y]) => [side - y, q + p.quadrantGap + x],
	};

	const base: Point[] = [[x0, y0]];

	for (let i = 0; i < p.count; i++) {
		const x = x0 + i * (p.width + p.gap);

		const y = i % 2 ? y0 : y0 + p.length;

		base.push([x, y]);

		if (i < p.count - 1)

			base.push([x + p.width + p.gap, y]);
	}

	const tracks: Track[] = [];

	const arms: Design['arms'] = [];

	const add = (points: Point[], width: number, stage: number, owner: string) => {
		for (let i = 1; i < points.length; i++) {
			if (!same(points[i - 1], points[i]))

				tracks.push({ a: points[i - 1], b: points[i], width, stage, owner });
		}
	};

	const terminals: Record<string, Point[]> = {};

	for (const name of ['A', 'B', 'C', 'D']) {
		const points = base.map(transforms[name]);

		add(points, p.width, 1, name);

		terminals[name] = [points[0], points.at(-1)!];

		arms.push({ name, center: transforms[name]([q / 2, q / 2]), horizontal: name === 'A' || name === 'D', terminals: terminals[name] });
	}

	// Opposite-corner terminals (odd grid count) connect adjacent grids directly.

	const a = terminals.A[1];
	const b = terminals.B[0];

	const bend: Point = a[1] <= b[1] ? [b[0], a[1]] : [a[0], b[1]];

	const rotate = ([x, y]: Point, turn: number): Point => turn === 0 ? [x, y] : turn === 1 ? [side - y, x] : turn === 2 ? [side - x, side - y] : [y, side - x];

	const nodes: Point[] = [];

	for (let turn = 0; turn < 4; turn++) {
		const points = [a, bend, b].map(p => rotate(p, turn));

		add(points, p.routingWidth, 2, ['A', 'B', 'D', 'C'][turn]);

		nodes.push(rotate(bend, turn));
	}

	const names = ['E+', 'OUT+', 'E-', 'OUT-'];
	const d: Design = { routerVersion, parameters: p, tracks, pads: [], arms, outline: [], vias: [], nodes: nodes.map((point, i) => ({ point, name: names[i] })), routingIssues: [] };
	const copperPoints = tracks.flatMap(t => [t.a, t.b]);
	const radius = Math.max(p.width, p.routingWidth) / 2;
	let left = Math.min(...copperPoints.map(p => p[0] - radius)) - p.margin;
	const top = Math.min(...copperPoints.map(p => p[1] - radius)) - p.margin;
	let right = Math.max(...copperPoints.map(p => p[0] + radius)) + p.margin;
	const coreBottom = Math.max(...copperPoints.map(p => p[1] + radius));
	const coreLeft = left + p.margin;
	const coreRight = right - p.margin;
	const bottom = coreBottom + (p.terminalMode ? p.tailLength : p.margin);
	if (!p.terminalMode) {
		d.outline = [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]];
		return d;
	}
	const lane = routerVersion === 1 ? Math.max(0.65, p.leadWidth + p.leadGap + p.viaDiameter) : Math.SQRT2 * (p.leadWidth + p.leadGap + 0.02);
	const startY = coreBottom + lane;
	const portWidth = p.terminalMode === 2 ? p.contactWidth : p.padWidth;
	const portHeight = p.terminalMode === 2 ? p.contactLength : p.padHeight;
	const pitch = p.terminalMode === 2 ? p.contactPitch : p.padPitch;
	const tailWidth = p.terminalMode === 2 ? p.tailWidth : Math.max(p.tailWidth, 3 * pitch + portWidth + 2 * p.margin);
	const cx = side / 2;
	const portY = bottom - p.contactInset - portHeight / 2;
	const order = [p.order0, p.order1, p.order2, p.order3];
	d.pads = order.map((n, i) => ({ center: [cx + (i - 1.5) * pitch, portY], width: portWidth, height: portHeight, name: names[n], stage: 3 }));
	if (pitch - portWidth < p.leadGap - 1e-6)
		d.routingIssues.push('接点之间的净间距不足，请增加节距或减小接点宽度。');
	if (3 * pitch + portWidth > tailWidth - 2 * 0.15)
		d.routingIssues.push('接点超出尾端边界或侧边留白不足 0.15 mm。');
	if (portY - portHeight / 2 < startY + 3 * lane)
		d.routingIssues.push('尾部长度不足，请增加尾部延伸长度。');
	if (p.viaDiameter < p.viaHole + 0.2)
		d.routingIssues.push('过孔外径至少应比孔径大 0.20 mm（当前设计约束）。');
	const escape = (i: number, points: Point[]) => {
		if (routerVersion === 1) {
			add(points, p.leadWidth, 3, names[i]);
			return;
		}
		const beveled: Point[] = [points[0]];
		for (let j = 1; j < points.length - 1; j++) {
			const a = points[j - 1];
			const b = points[j];
			const c = points[j + 1];
			const before = Math.hypot(b[0] - a[0], b[1] - a[1]);
			const after = Math.hypot(c[0] - b[0], c[1] - b[1]);
			const r = Math.min(p.leadWidth * 0.8, before / 4, after / 4);
			if (before > 1e-7 && after > 1e-7)
				beveled.push([b[0] + (a[0] - b[0]) * r / before, b[1] + (a[1] - b[1]) * r / before], [b[0] + (c[0] - b[0]) * r / after, b[1] + (c[1] - b[1]) * r / after]);
			else beveled.push(b);
		}
		beveled.push(points.at(-1)!);
		add(beveled, p.leadWidth, 3, names[i]);
	};
	const sourcePoints: Point[] = [
		[coreLeft - 2 * lane, startY],
		[coreRight + lane, startY],
		[nodes[2][0], startY],
		[coreLeft - lane, startY],
	];
	escape(0, [nodes[0], [nodes[0][0], top + p.margin - lane], [sourcePoints[0][0], top + p.margin - lane], sourcePoints[0]]);
	escape(1, [nodes[1], [sourcePoints[1][0], nodes[1][1]], sourcePoints[1]]);
	escape(2, [nodes[2], sourcePoints[2]]);
	escape(3, [nodes[3], [sourcePoints[3][0], nodes[3][1]], sourcePoints[3]]);
	left = Math.min(left, sourcePoints[0][0] - p.leadWidth / 2 - p.margin, cx - tailWidth / 2);
	right = Math.max(right, sourcePoints[1][0] + p.leadWidth / 2 + p.margin, cx + tailWidth / 2);
	const upper = Math.min(top, top + p.margin - lane - p.leadWidth / 2 - p.margin);
	const neckY = bottom - p.contactInset - portHeight - 1.4;
	const shoulderY = Math.max(startY + lane, neckY - 1.2);
	const tailLeft = cx - tailWidth / 2;
	const tailRight = cx + tailWidth / 2;
	d.outline = [[left, upper], [right, upper], [right, shoulderY], [tailRight, neckY], [tailRight, bottom], [tailLeft, bottom], [tailLeft, neckY], [left, shoulderY], [left, upper]];
	if (!d.routingIssues.length) {
		const routed = (routerVersion === 1 ? routeLegacyTail : routeTail)(d, sourcePoints.map((point, i) => ({ point, owner: names[i] })), startY);
		d.tracks.push(...routed.tracks);
		d.vias = routed.vias;
		d.routingIssues.push(...routed.issues);
	}
	return d;
}

export function distance(a: Track, b: Track): number {
	return segmentDistance(a.a, a.b, b.a, b.b);
}

export function check(d: Design, stage = 4): string[] {
	const p = d.parameters;

	const min = p.thickness === 18 ? 0.0889 : 0.1016;

	const errors: string[] = [];

	if (p.width < min || p.gap < min || p.routingWidth < min)

		errors.push(`当前铜厚要求线宽与净间距至少 ${min} mm。`);

	if (p.margin < 0.3)

		errors.push('铜到板边的预留至少 0.30 mm。');

	if (p.quadrantGap < min)

		errors.push(`相邻敏感栅间隔小于当前工艺下限 ${min} mm。`);

	const ts = d.tracks.filter(t => t.stage <= stage);

	let conflicts = 0;

	if (ts.some(t => t.width < min - 1e-6))

		errors.push('实际走线宽度小于当前工艺下限。');

	if (stage >= 4) {
		const xs = d.outline.map(p => p[0]);

		const ys = d.outline.map(p => p[1]);

		const left = Math.min(...xs);

		const right = Math.max(...xs);

		const top = Math.min(...ys);

		const bottom = Math.max(...ys);

		if (right - left > 234 || bottom - top > 490)

			errors.push('板框超出当前常规 FPC 尺寸档 234 × 490 mm。');

		const safe = (point: Point, r: number, clearance = 0.3) => inPolygon(point, d.outline) && edgeClearance(point, d.outline) >= r + clearance - 1e-6;
		if (ts.some(t => !segmentInside(t.a, t.b, d.outline, t.width / 2 + 0.3)))
			errors.push('实际走线超出板框或到板边距离不足 0.30 mm。');

		if (d.pads.some(v => [[-1, -1], [-1, 1], [1, -1], [1, 1]].some(([x, y]) => {
			const point: Point = [v.center[0] + x * v.width / 2, v.center[1] + y * v.height / 2];
			if (p.terminalMode !== 2)
				return !safe(point, 0);
			const remainingEdges = d.outline.slice(1).map((b, i) => ({ a: d.outline[i], b })).filter(e => Math.abs(e.a[1] - bottom) > 1e-6 || Math.abs(e.b[1] - bottom) > 1e-6);
			return (!inPolygon(point, d.outline) && edgeClearance(point, d.outline) > 1e-7) || remainingEdges.some(e => pointDistance(point, e.a, e.b) < 0.15 - 1e-6);
		}))) {
			errors.push('接点超出尾端边界或板边留白不足。');
		}
		if (d.vias.some(v => !safe(v.center, v.diameter / 2)))
			errors.push('过孔到板边距离不足 0.30 mm。');
	}

	for (let i = 0; i < ts.length; i++) {
		for (let j = i + 1; j < ts.length; j++) {
			const a = ts[i];

			const b = ts[j];

			if ((a.layer || 1) !== (b.layer || 1) || (a.stage === 3 && b.stage === 3 && a.owner === b.owner))
				continue;

			if ([a.a, a.b].some(x => same(x, b.a) || same(x, b.b)))

				continue;

			if (distance(a, b) - (a.width + b.width) / 2 < (a.stage === 3 && b.stage === 3 ? Math.max(min, p.leadGap) : min) - 1e-6) {
				// A short contiguous corner is a copper union, not a clearance gap.

				const localCorner = ts.some(t => t !== a && t !== b && length(t) < min + (a.width + b.width) / 2 && (([a.a, a.b].some(p => same(p, t.a)) && [b.a, b.b].some(p => same(p, t.b))) || ([a.a, a.b].some(p => same(p, t.b)) && [b.a, b.b].some(p => same(p, t.a)))));

				if (!localCorner) {
					conflicts++;
				}
			}
		}
	}

	if (conflicts)

		errors.push(`发现 ${conflicts} 处非连接线段的交叠或间距不足。`);

	// Pads may only touch routes attached to their junction.

	if (stage >= 3) {
		for (const pad of d.pads) {
			for (const t of ts) {
				if ((t.layer || 1) !== 1 || t.owner === pad.name || same(t.a, pad.center) || same(t.b, pad.center))

					continue;

				if (rectangleDistance(t.a, t.b, pad.center, pad.width, pad.height) < t.width / 2 + (t.stage === 3 ? Math.max(min, p.leadGap) : min) - 1e-6) {
					errors.push(`端口 ${pad.name} 与非本节点导体间距不足。`);

					break;
				}
			}
		}
	}

	if (stage >= 3) {
		errors.push(...d.routingIssues);
		if (p.terminalMode && (p.leadWidth < min || p.leadGap < min))
			errors.push('引出线宽或净间距小于当前铜厚约束。');
		if (d.vias.length && !p.allowBack)
			errors.push('背面走线已关闭，但实际图形仍有过孔。');
		if (!p.allowBack && ts.some(t => t.layer === 2))
			errors.push('背面走线已关闭，但实际图形仍有背面线。');
		for (let i = 0; i < d.vias.length; i++) {
			const v = d.vias[i];
			if (v.diameter < v.hole + 0.2 - 1e-6)
				errors.push('实际过孔环宽不足。');
			if (ts.some(t => t.owner !== v.owner && pointDistance(v.center, t.a, t.b) < (v.diameter + t.width) / 2 + p.leadGap - 1e-6))
				errors.push(`过孔 ${v.owner} 与其他节点导体间距不足。`);
			if (d.vias.slice(i + 1).some(b => Math.hypot(v.center[0] - b.center[0], v.center[1] - b.center[1]) < (v.diameter + b.diameter) / 2 + p.leadGap - 1e-6))
				errors.push('过孔间距不足。');
		}
	}

	return errors;
}

export function stats(d: Design) {
	return d.arms.map((a) => {
		const ts = d.tracks.filter(t => t.owner === a.name);

		return { name: a.name, length: ts.filter(t => t.stage === 1).reduce((s, t) => s + length(t), 0), resistance: ts.reduce((s, t) => s + 0.01724 * length(t) / (t.width * d.parameters.thickness), 0) };
	});
}

export function connectivity(input: Track[] | Design): string[] {
	const d = Array.isArray(input) ? undefined : input;
	const tracks = Array.isArray(input) ? input : input.tracks;
	const vias = d?.vias || [];
	const key = (p: Point, layer = 1) => `${p.map(x => Math.round(x * 1e4)).join(',')}:${layer}`;
	const graph = new Map<string, string[]>();
	const link = (a: string, b: string) => {
		if (a === b)
			return;
		graph.set(a, [...(graph.get(a) || []), b]);
		graph.set(b, [...(graph.get(b) || []), a]);
	};
	for (const t of tracks) link(key(t.a, t.layer || 1), key(t.b, t.layer || 1));
	for (const v of vias) link(key(v.center, 1), key(v.center, 2));
	if (!graph.size)
		return ['没有导体图形。'];
	const seen = new Set<string>();
	const queue = [graph.keys().next().value!];
	while (queue.length) {
		const a = queue.pop()!;
		if (seen.has(a))
			continue;
		seen.add(a);
		queue.push(...graph.get(a)!);
	}
	const issues: string[] = [];
	if (seen.size !== graph.size)
		issues.push('桥路导体存在断开或独立孤岛（顶底层仅通过过孔相连）。');
	const external = d && tracks.some(t => t.stage === 3);
	const junctions = new Set(external ? d.nodes.map(n => key(n.point)) : []);
	const ends = new Set(external ? d.pads.map(n => key(n.center)) : []);
	if ([...graph.entries()].some(([k, links]) => links.length !== (junctions.has(k) ? 3 : ends.has(k) ? 1 : 2)))
		issues.push('桥路存在非预期断点、支路或重复线段。');
	if (d?.parameters.terminalMode && (d.pads.length !== 4 || d.nodes.some(n => !d.pads.some(p => p.name === n.name))))
		issues.push('外部四个接点不完整。');
	if (external) {
		for (const node of d.nodes) {
			const branch = tracks.filter(t => t.stage === 3 && t.owner === node.name);
			const pad = d.pads.find(p => p.name === node.name);
			if (!pad || !branch.some(t => same(t.a, node.point) || same(t.b, node.point)) || !branch.some(t => (t.layer || 1) === 1 && (same(t.a, pad.center) || same(t.b, pad.center))))
				issues.push(`${node.name} 引出线路未连接到指定接点。`);
		}
	}
	return issues;
}

export function bounds(d: Design) {
	const xs = d.outline.map(p => p[0]);
	const ys = d.outline.map(p => p[1]);
	return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function svg(d: Design, stage = 4, layers = { front: true, back: true }) {
	const box = bounds(d);
	const text = Math.max(box.width, box.height) * 0.021;
	const visible = (layer = 1) => layer === 1 ? layers.front : layers.back;
	const opacity = (n: number) => stage > n && stage !== 4 ? '.5' : '1';
	const tracks = d.tracks.filter(t => t.stage <= stage && visible(t.layer)).map(t => `<path data-layer="${t.layer || 1}" data-stage="${t.stage}" d="M ${t.a.join(' ')} L ${t.b.join(' ')}" opacity="${opacity(t.stage)}" stroke="${t.layer === 2 ? '#f189ad' : t.stage === 1 ? (t.owner === 'A' || t.owner === 'D' ? '#edb367' : '#67c9c4') : t.stage === 3 ? '#88cfff' : '#b5a1e9'}" stroke-width="${t.width}" fill="none" stroke-linecap="round"/>`).join('');
	const pads = stage >= 3 && layers.front ? d.pads.map((p, i) => `<rect data-layer="1" x="${p.center[0] - p.width / 2}" y="${p.center[1] - p.height / 2}" width="${p.width}" height="${p.height}" fill="${d.parameters.terminalMode === 2 ? '#edc66e' : '#70c9a9'}"/><text x="${p.center[0]}" y="${p.center[1] + p.height / 2 + text * 1.2}" text-anchor="middle" font-size="${text * 0.8}" fill="#d0e3ee">${i + 1}</text>`).join('') : '';
	const holes = stage >= 3 && (layers.front || layers.back) ? d.vias.map(v => `<g data-via="true"><circle cx="${v.center[0]}" cy="${v.center[1]}" r="${v.diameter / 2}" fill="#ecb0cc"/><circle cx="${v.center[0]}" cy="${v.center[1]}" r="${v.hole / 2}" fill="#172a3b"/></g>`).join('') : '';
	const outline = stage >= 3 ? `<path d="M ${d.outline.map(p => p.join(' ')).join(' L ')}" stroke="#8ca6bf" stroke-width=".035" fill="none" stroke-dasharray=".15 .1" opacity="${stage === 4 ? 1 : 0.45}"/>` : '';
	const labels = layers.front ? d.arms.map(x => `<text x="${x.center[0]}" y="${x.center[1]}" text-anchor="middle" font-size="${text}" fill="#fff" stroke="#162736" stroke-width=".04" paint-order="stroke">${x.name} · ${x.horizontal ? '水平' : '竖直'}</text>`).join('') : '';
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.left - 0.7} ${box.top - 0.7} ${box.width + 1.4} ${box.height + 1.4}" aria-label="四象限设计与下方引出">${outline}${tracks}${pads}${holes}${labels}</svg>`;
}
