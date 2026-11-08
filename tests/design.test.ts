import assert from 'node:assert/strict';

import test from 'node:test';

import { Adapter, milToMm, mmToMil, newSession, validateSession } from '../src/adapter';

import { bounds, build, changedStage, check, connectivity, defaults, distance, parameters, stats, svg } from '../src/geometry';

import { rectangleDistance, segmentInside } from '../src/routing-math';

Object.assign(globalThis, { EPCB_PrimitivePadShapeType: { RECTANGLE: 'RECT' }, ESYS_Unit: { MILLIMETER: 'mm' } });

function fixture() {
	let count = 0;

	let board = 'board-1';

	let failure = 0;

	const vias = new Map<string, any>();

	const lines = new Map<string, any>();

	const pads = new Map<string, any>();

	const outlines = new Map<string, any>();

	const id = () => String(++count);

	const api = { pcb_PrimitiveArc: { getAll: async () => [] }, dmt_Pcb: { getCurrentPcbInfo: async () => ({ uuid: board }) }, pcb_Document: { save: async () => true }, pcb_PrimitiveLine: { create: async (net: string, layer: number, sx: number, sy: number, ex: number, ey: number, w: number) => {
		if (failure && count >= failure)

			return undefined;

		const key = id();

		const v = { sx, sy, ex, ey, w, net, layer };

		const obj = { v, getState_PrimitiveId: () => key, getState_StartX: () => v.sx, getState_StartY: () => v.sy, getState_EndX: () => v.ex, getState_EndY: () => v.ey, getState_LineWidth: () => v.w };

		lines.set(key, obj);

		return obj;
	}, getAll: async (net: string, layer: number) => [...lines.values()].filter(x => x.v.net === net && x.v.layer === layer), delete: async (ids: string[]) => {
		ids.forEach(id => lines.delete(id));

		return true;
	} }, pcb_PrimitiveVia: { create: async (net: string, x: number, y: number, hole: number, diameter: number, type: number, _rule: unknown, mask: unknown) => {
		const key = id();
		const v = { net, x, y, hole, diameter, type, mask };
		const obj = { v, getState_PrimitiveId: () => key, getState_X: () => v.x, getState_Y: () => v.y, getState_Diameter: () => v.diameter, getState_HoleDiameter: () => v.hole, getState_ViaType: () => v.type, getState_SolderMaskExpansion: () => v.mask };
		vias.set(key, obj);
		return obj;
	}, getAll: async (net: string) => [...vias.values()].filter(v => v.v.net === net), delete: async (ids: string[]) => {
		ids.forEach(id => vias.delete(id));
		return true;
	} }, pcb_PrimitivePad: { create: async (_l: number, name: string, x: number, y: number, _r: number, shape: any, net: string, ...rest: any[]) => {
		const key = id();

		const obj = { net, getState_PrimitiveId: () => key, getState_Pad: () => shape, getState_X: () => x, getState_Y: () => y, getState_PadNumber: () => name, getState_Rotation: () => 0, getState_SolderMaskAndPasteMaskExpansion: () => rest.at(-1) };

		pads.set(key, obj);

		return obj;
	}, getAll: async (_l: number, net: string) => [...pads.values()].filter(x => x.net === net), delete: async (ids: string[]) => {
		ids.forEach(id => pads.delete(id));

		return true;
	} }, pcb_PrimitivePolyline: { getAll: async () => [...outlines.values()], create: async (_net: string, _l: number, polygon: any) => {
		const key = id();

		const obj = { getState_PrimitiveId: () => key, getState_Polygon: () => polygon };

		outlines.set(key, obj);

		return obj;
	}, delete: async (ids: string[]) => {
		ids.forEach(id => outlines.delete(id));

		return true;
	} }, pcb_MathPolygon: { createPolygon: (source: any) => ({ getSource: () => source }) }, sys_FileSystem: { saveFile: async () => {} }, pcb_ManufactureData: { getGerberFile: async () => new Blob(['fixture']) } };

	return { adapter: new Adapter(api as any), lines, pads, outlines, vias, setBoard: (b: string) => board = b, setFailure: (n: number) => failure = n };
}

test('default bridge: no copper clearance violations; four matching arms form a cycle', () => {
	const d = build(defaults);

	assert.deepEqual(check(d), []);

	assert.deepEqual(connectivity(d.tracks), []);

	assert.equal(d.arms.filter(a => a.horizontal).length, 2);

	assert.equal(d.pads.length, 0);

	const s = stats(d);

	assert.ok(s.every(x => Math.abs(x.resistance - s[0].resistance) < 1e-9));

	assert.ok(Math.abs(s[0].length - (defaults.count * defaults.length + (defaults.count - 1) * (defaults.width + defaults.gap))) < 1e-9);
});

test('compact bridge connects neighboring grids without corner pads or outer detours', () => {
	const d = build(defaults);

	assert.equal(d.pads.length, 0);
	const grids = d.tracks.filter(t => t.stage === 1);
	const minX = Math.min(...grids.flatMap(t => [t.a[0], t.b[0]]));
	const maxX = Math.max(...grids.flatMap(t => [t.a[0], t.b[0]]));
	const minY = Math.min(...grids.flatMap(t => [t.a[1], t.b[1]]));
	const maxY = Math.max(...grids.flatMap(t => [t.a[1], t.b[1]]));
	for (const t of d.tracks.filter(t => t.stage === 2)) {
		for (const [x, y] of [t.a, t.b])assert.ok(x >= minX - 1e-8 && x <= maxX + 1e-8 && y >= minY - 1e-8 && y <= maxY + 1e-8);
	}
	assert.deepEqual(connectivity(d.tracks), []);
});

test('parameter sweep retains nonintersecting geometry and bridge continuity', () => {
	for (const count of [5, 13, 21, 41, 101]) {
		for (const length of [1, 4, 10]) {
			const d = build({ ...defaults, count, length });

			assert.deepEqual(check(d), [], JSON.stringify({ count, length }));

			assert.deepEqual(connectivity(d.tracks), []);
		}
	}
});

test('neighboring grid copper envelopes are exactly the requested gap apart', () => {
	for (const count of [5, 21, 101]) {
		for (const length of [1, 4.4, 10]) {
			const d = build({ ...defaults, count, length, quadrantGap: 0.1 });
			const box = (name: string) => {
				const ts = d.tracks.filter(t => t.stage === 1 && t.owner === name);
				return { left: Math.min(...ts.flatMap(t => [t.a[0] - t.width / 2, t.b[0] - t.width / 2])), right: Math.max(...ts.flatMap(t => [t.a[0] + t.width / 2, t.b[0] + t.width / 2])), top: Math.min(...ts.flatMap(t => [t.a[1] - t.width / 2, t.b[1] - t.width / 2])), bottom: Math.max(...ts.flatMap(t => [t.a[1] + t.width / 2, t.b[1] + t.width / 2])) };
			};
			const a = box('A');
			const b = box('B');
			const c = box('C');
			const e = box('D');
			for (const gap of [b.left - a.right, e.left - c.right, c.top - a.bottom, e.top - b.bottom]) {
				assert.ok(Math.abs(gap - 0.1) < 1e-8);
			}
			assert.deepEqual(check(d), []);
			assert.deepEqual(connectivity(d.tracks), []);
		}
	}
});

test('invalid parameters and narrower process rules are rejected', () => {
	for (const patch of [{ count: 4 }, { count: 102 }, { width: 0 }, { length: Number.NaN }, { thickness: 12 }])

		assert.throws(() => parameters({ ...defaults, ...patch }));

	assert.ok(check(build({ ...defaults, thickness: 35 })).length);

	assert.ok(check(build({ ...defaults, terminalMode: 1, padWidth: 8 })).length);
});

test('geometry checks detect a deleted track and a crossing copper shortcut', () => {
	const d = build(defaults);

	assert.ok(connectivity(d.tracks.slice(1)).length);

	assert.equal(distance({ a: [0, 0], b: [1, 1], width: 0.1, owner: '', stage: 1 }, { a: [0, 1], b: [1, 0], width: 0.1, owner: '', stage: 1 }), 0);

	d.tracks.push({ a: d.tracks[0].a, b: d.tracks[7].b, width: 0.1, owner: 'manual', stage: 0 });

	assert.ok(check(d).length);
});

test('coordinate conversion round trips mm, and stage execution is idempotent', async () => {
	assert.ok(Math.abs(milToMm(mmToMil(12.345)) - 12.345) < 1e-9);

	const f = fixture();

	const s = newSession({ ...defaults });

	await f.adapter.generate(s, defaults, 1);

	const count = f.lines.size;

	assert.equal(s.completed, 1);

	assert.equal(s.manual, false);

	await f.adapter.generate(s, defaults, 1);

	assert.equal(f.lines.size, count);

	await f.adapter.generate(s, defaults, 4);

	assert.equal(f.pads.size, 0);

	assert.equal(f.outlines.size, 1);

	assert.deepEqual((await f.adapter.read(s)).issues, []);

	assert.equal(s.manual, false);

	assert.deepEqual(validateSession(JSON.parse(JSON.stringify(s))).parameters, defaults);
});

test('manual edits and PCB switches never silently overwrite tracked geometry', async () => {
	const f = fixture();

	const s = newSession({ ...defaults });

	await f.adapter.generate(s, defaults, 1);

	const line = [...f.lines.values()][0];

	line.v.ex += 2;

	assert.equal((await f.adapter.read(s)).modified, true);

	const before = f.lines.size;

	await assert.rejects(f.adapter.generate(s, defaults, 2), /手动修改/);

	assert.equal(f.lines.size, before);

	f.setBoard('board-2');

	await assert.rejects(f.adapter.read(s), /关联不符/);
});

test('failed creation preserves successful IDs for recovery instead of losing ownership', async () => {
	const f = fixture();

	const s = newSession({ ...defaults });

	f.setFailure(5);

	await assert.rejects(f.adapter.generate(s, defaults, 1), /未能创建/);

	assert.equal(s.records.length, 5);

	assert.equal(f.lines.size, 5);

	assert.equal(s.manual, true);
});

test('merged bridge stage and tail rebuild keep bridge IDs stable', async () => {
	const f = fixture();
	const p = { ...defaults, terminalMode: 2 };
	const s = newSession(p);
	await f.adapter.generate(s, p, 4);
	const bridgeIds = s.records.filter(r => r.stage <= 2).map(r => r.id);
	const reordered = { ...p, order0: 1, order1: 0, order2: 3, order3: 2 };
	await assert.rejects(f.adapter.generate(s, reordered, 3), /重建/);
	await f.adapter.generate(s, reordered, 3, true);
	assert.deepEqual(s.records.filter(r => r.stage <= 2).map(r => r.id), bridgeIds);
	assert.ok(f.vias.size > 0);
	assert.ok([...f.lines.values()].some(t => t.v.layer === 2));
	assert.deepEqual((await f.adapter.read(s)).issues, []);
	assert.equal(f.outlines.size, 0);
	await f.adapter.generate(s, p, 3, true);
	assert.equal(f.vias.size, 0);
	assert.equal([...f.lines.values()].filter(t => t.v.layer === 2).length, 0);
	await f.adapter.generate(s, p, 4);
	assert.deepEqual((await f.adapter.read(s)).issues, []);
});

const permutations = (values: number[]): number[][] => values.length ? values.flatMap((x, i) => permutations(values.filter((_, j) => j !== i)).map(rest => [x, ...rest])) : [[]];

test('all 24 terminal orders route on two layers for pads and fingers', () => {
	for (const terminalMode of [1, 2]) {
		for (const order of permutations([0, 1, 2, 3])) {
			const p = { ...defaults, terminalMode, ...Object.fromEntries(order.map((v, i) => [`order${i}`, v])) };
			const d = build(p);
			assert.deepEqual(check(d), [], `${terminalMode}:${order}`);
			assert.deepEqual(connectivity(d), [], `${terminalMode}:${order}`);
			assert.equal(d.pads.length, 4);
			for (const t of d.tracks.filter(t => t.stage === 3)) {
				const dx = Math.abs(t.b[0] - t.a[0]);
				const dy = Math.abs(t.b[1] - t.a[1]);
				assert.ok(dx < 1e-7 || dy < 1e-7 || Math.abs(dx - dy) < 1e-7, `Non-octilinear copper: ${JSON.stringify(t)}`);
			}
			assert.ok(d.pads.every(v => v.center[1] > Math.max(...d.nodes.map(n => n.point[1]))));
			assert.deepEqual(stats(d), stats(build(defaults)));
			assert.ok(d.outline.length > 5);
		}
	}
});

test('front-only routing is honored and impossible orders block generation', async () => {
	const natural = build({ ...defaults, terminalMode: 2, allowBack: 0 });
	assert.deepEqual(check(natural), []);
	assert.equal(natural.vias.length, 0);
	assert.ok(natural.tracks.every(t => t.layer !== 2));
	const p = { ...defaults, terminalMode: 2, allowBack: 0, order0: 1, order1: 0, order2: 3, order3: 2 };
	assert.ok(build(p).routingIssues.length);
	const f = fixture();
	const s = newSession(p);
	await assert.rejects(f.adapter.generate(s, p, 3), /无法/);
	assert.equal(f.lines.size, 0);
});

test('layer projection alone does not connect separate copper layers', () => {
	const d = build({ ...defaults, terminalMode: 2, order0: 1, order1: 0, order2: 3, order3: 2 });
	assert.ok(d.vias.length > 0);
	assert.ok(connectivity({ ...d, vias: [] }).length > 0);
	assert.equal((svg(d, 4, { front: false, back: true }).match(/data-layer="1"/g) || []).length, 0);
	assert.equal((svg(d, 4, { front: true, back: false }).match(/data-layer="2"/g) || []).length, 0);
});

test('tail config round trips, legacy ungenerated config migrates and generated legacy stays protected', () => {
	const p = { ...defaults, terminalMode: 2, tailLength: 14 };
	const s = newSession(p);
	assert.deepEqual(validateSession(JSON.parse(JSON.stringify(s))), s);
	assert.equal(changedStage(p, { ...p, contactWidth: 0.3 }), 3);
	assert.equal(changedStage(p, { ...p, length: 5 }), 1);
	assert.equal(changedStage(p, { ...p, reinforcementLength: 4 }), 5);
	const legacy = { ...s, version: 1, template: 'quadrant-orthogonal-compact-v2' };
	assert.equal(validateSession(legacy).version, 2);
	assert.throws(() => validateSession({ ...legacy, completed: 2, board: 'existing' }), /旧版/);
});

test('invalid fingers, tail clearance and insufficient via annulus are rejected', () => {
	assert.deepEqual(check(build({ ...defaults, terminalMode: 2, contactInset: 0 })), []);
	for (const patch of [{ contactWidth: 0.6 }, { tailWidth: 1 }, { tailLength: 2 }, { viaDiameter: 0.25 }])
		assert.ok(check(build({ ...defaults, terminalMode: 2, ...patch })).length);
	assert.throws(() => parameters({ ...defaults, order1: defaults.order0 }), /接点/);
});

test('manual via edits are preserved', async () => {
	const f = fixture();
	const p = { ...defaults, terminalMode: 2, order0: 1, order1: 0, order2: 3, order3: 2 };
	const s = newSession(p);
	await f.adapter.generate(s, p, 4);
	const via = [...f.vias.values()][0];
	via.v.x += 0.4;
	await assert.rejects(f.adapter.generate(s, p, 4), /手动修改/);
	const before = f.vias.size;
	await assert.rejects(f.adapter.generate(s, p, 4, true), /前序/);
	assert.equal(f.vias.size, before);
});

test('partial tail failure keeps completed bridge stages and does not duplicate them on recovery', async () => {
	const f = fixture();
	const p = { ...defaults, terminalMode: 2 };
	const s = newSession(p);
	const coreCount = build(defaults).tracks.length;
	f.setFailure(coreCount + 2);
	await assert.rejects(f.adapter.generate(s, p, 4), /未能创建/);
	assert.equal(s.completed, 2);
	const bridgeIds = s.records.filter(r => r.stage <= 2).map(r => r.id);
	f.setFailure(0);
	await f.adapter.generate(s, p, 3, true);
	assert.deepEqual(s.records.filter(r => r.stage <= 2).map(r => r.id), bridgeIds);
	assert.equal(s.records.filter(r => r.stage <= 2).length, coreCount);
	assert.deepEqual((await f.adapter.read(s)).issues, []);
});

test('default routing uses compact 45-degree channels and a straight parallel tail', () => {
	const p = { ...defaults, terminalMode: 2 };
	const d = build(p);
	const old = build(p, 1);
	const routes = d.tracks.filter(t => t.stage === 3);
	assert.deepEqual(check(d), []);
	assert.equal(d.vias.length, 0);
	assert.ok(routes.length < old.tracks.filter(t => t.stage === 3).length / 2);
	assert.ok(bounds(d).width < bounds(old).width);
	assert.deepEqual(bounds(d), bounds(build({ ...p, viaDiameter: 0.8 })));
	const entry = d.outline[3][1];
	for (const pad of d.pads) {
		const tail = routes.filter(t => t.owner === pad.name && (t.a[1] > entry || t.b[1] > entry));
		assert.ok(tail.length);
		assert.ok(tail.every(t => Math.abs(t.a[0] - pad.center[0]) < 1e-7 && Math.abs(t.b[0] - pad.center[0]) < 1e-7));
	}
});

test('diagonal checks use exact rectangle and polygon distances', () => {
	assert.ok(rectangleDistance([-3, 0], [0, 3], [0, 0], 2, 2) > 0.7);
	assert.equal(rectangleDistance([-2, -2], [2, 2], [0, 0], 2, 2), 0);
	assert.equal(segmentInside([1, 5], [9, 5], [[0, 0], [10, 0], [10, 10], [5.01, 10], [5.01, 4], [5, 4], [5, 10], [0, 10], [0, 0]], 0.01), false);
});

test('generated 0.2.0 configurations retain old copper until tail is explicitly rebuilt', async () => {
	const f = fixture();
	const p = { ...defaults, terminalMode: 2 };
	const original = newSession(p);
	original.routerVersion = 1;
	await f.adapter.generate(original, p, 4);
	const serialized = JSON.parse(JSON.stringify(original));
	delete serialized.routerVersion;
	const s = validateSession(serialized);
	assert.equal(s.routerVersion, 1);
	const ids = s.records.map(r => r.id);
	const oldRoutes = s.actual!.tracks.filter(t => t.stage === 3);
	await f.adapter.generate(s, p, 4);
	assert.deepEqual(s.records.map(r => r.id), ids);
	assert.equal(s.routerVersion, 1);
	assert.deepEqual((await f.adapter.read(s)).issues, []);
	const bridgeIds = s.records.filter(r => r.stage <= 2).map(r => r.id);
	await f.adapter.generate(s, p, 3, true);
	assert.equal(s.routerVersion, 2);
	assert.deepEqual(s.records.filter(r => r.stage <= 2).map(r => r.id), bridgeIds);
	assert.ok(s.actual!.tracks.filter(t => t.stage === 3).length < oldRoutes.length);
	await f.adapter.generate(s, p, 4);
	assert.deepEqual((await f.adapter.read(s)).issues, []);
});
