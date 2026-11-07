import type { Design, Parameters, Point, Track, Via } from './geometry';

import { build, changedStage, check, connectivity, defaults, parameters } from './geometry';

export const mmToMil = (mm: number) => mm / 0.0254;

export const milToMm = (mil: number) => mil * 0.0254;

export interface RecordItem { id: string; kind: 'line' | 'pad' | 'via' | 'outline'; stage: number; owner: string; fingerprint: string }

export interface Session { format: 'strain-bridge-project'; version: 2; template: 'quadrant-orthogonal-tail-v3'; id: string; parameters: Parameters; board?: string; completed: number; records: RecordItem[]; manual: boolean; actual?: Design; draft?: Parameters }

export function newSession(p: Parameters): Session {
	// getRandomValues is available in embedded/insecure contexts where randomUUID is absent.
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
	const id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
	return { format: 'strain-bridge-project', version: 2, template: 'quadrant-orthogonal-tail-v3', id, parameters: p, completed: 0, records: [], manual: false };
}

export function validateSession(input: unknown): Session {
	const s = input as Session;

	if (s && (s as unknown as { version: number }).version === 1) {
		if (s.records?.length || s.completed || s.board)
			throw new Error('旧版已生成图形的配置请继续用旧版保管；新版尾部布局与阶段定义不同，请新建实例，现有 PCB 图形不会被删除。');
		const old = s.parameters as unknown as Record<string, number>;
		const migrated = { ...defaults, ...old, terminalMode: old.withPads ? 1 : 0 };
		return { ...newSession(parameters(migrated)), draft: parameters(migrated) };
	}
	if (!s || s.format !== 'strain-bridge-project' || s.version !== 2 || s.template !== 'quadrant-orthogonal-tail-v3' || !/^[a-f0-9]{16}$/.test(s.id) || !Array.isArray(s.records) || s.records.length > 10000 || !Number.isInteger(s.completed) || s.completed < 0 || s.completed > 4)
		throw new Error('配置格式或版本无效。');

	s.parameters = parameters(s.parameters);

	if (s.records.some(r => !r.id || !['line', 'pad', 'via', 'outline'].includes(r.kind) || !Number.isInteger(r.stage) || r.stage < 0 || r.stage > 4 || typeof r.fingerprint !== 'string'))

		throw new Error('配置图元关联无效。');

	if (s.draft)
		s.draft = parameters(s.draft);
	return s;
}

type Api = typeof eda;

const fp = (v: unknown) => JSON.stringify(v);

const net = (s: Session) => `SG_${s.id}`;

function coords(p: Point, s: Session): Point {
	return [mmToMil(p[0] + s.parameters.originX), mmToMil(-p[1] + s.parameters.originY)];
}

export class Adapter {
	constructor(private api: Api) {}
	async board(s: Session) {
		const board = await this.api.dmt_Pcb.getCurrentPcbInfo();

		if (!board)

			throw new Error('请先在 EDA 中打开一个 PCB 文档。');

		if (s.board && s.board !== board.uuid)

			throw new Error('当前 PCB 与配置关联不符，请切换回原 PCB。');

		return board.uuid;
	}

	async read(s: Session) {
		await this.board(s);

		if ((await this.api.pcb_PrimitiveArc.getAll(net(s), 1)).length || (await this.api.pcb_PrimitiveArc.getAll(net(s), 2)).length)

			throw new Error('本设计含新增圆弧。当前矩形模板暂不回读圆弧，请在 EDA 中人工完成检查与导出。');

		const old = new Map(s.records.map(r => [r.id, r]));

		const [front, back, pads, outlines, vias] = await Promise.all([this.api.pcb_PrimitiveLine.getAll(net(s), 1), this.api.pcb_PrimitiveLine.getAll(net(s), 2), this.api.pcb_PrimitivePad.getAll(1, net(s)), this.api.pcb_PrimitivePolyline.getAll('', 11), this.api.pcb_PrimitiveVia.getAll(net(s))]);
		const lines = [...front.map(line => ({ line, layer: 1 })), ...back.map(line => ({ line, layer: 2 }))];

		const records: RecordItem[] = [];

		const d = build(s.parameters);

		d.tracks = [];

		d.pads = [];
		d.vias = [];
		d.routingIssues = [];

		for (const { line, layer } of lines) {
			const t: Track = { a: [milToMm(line.getState_StartX()) - s.parameters.originX, -milToMm(line.getState_StartY()) + s.parameters.originY], b: [milToMm(line.getState_EndX()) - s.parameters.originX, -milToMm(line.getState_EndY()) + s.parameters.originY], width: milToMm(line.getState_LineWidth()), stage: old.get(line.getState_PrimitiveId())?.stage || 0, owner: old.get(line.getState_PrimitiveId())?.owner || 'manual', layer };

			d.tracks.push(t);

			records.push({ id: line.getState_PrimitiveId(), kind: 'line', stage: t.stage, owner: t.owner, fingerprint: fp(t) });
		}

		for (const via of vias) {
			if (via.getState_ViaType() !== 0)
				throw new Error('当前仅回读通孔；请在 EDA 中人工检查盲埋孔。');
			const r = old.get(via.getState_PrimitiveId());
			const value: Via = { center: [milToMm(via.getState_X()) - s.parameters.originX, -milToMm(via.getState_Y()) + s.parameters.originY], diameter: milToMm(via.getState_Diameter()), hole: milToMm(via.getState_HoleDiameter()), owner: r?.owner || 'manual', stage: r?.stage || 0 };
			d.vias.push(value);
			records.push({ id: via.getState_PrimitiveId(), kind: 'via', stage: value.stage, owner: value.owner, fingerprint: fp({ ...value, mask: via.getState_SolderMaskExpansion() }) });
		}

		for (const pad of pads) {
			const shape = pad.getState_Pad();

			if (Math.abs(pad.getState_Rotation() % 360) > 1e-6)

				throw new Error('当前模板暂不分析旋转后的端口焊盘，请在 EDA 中人工检查。');

			if (!shape || shape[0] !== 'RECT')

				throw new Error('发现非矩形端口焊盘，请在 EDA 中完成检查。');

			const value = { center: [milToMm(pad.getState_X()) - s.parameters.originX, -milToMm(pad.getState_Y()) + s.parameters.originY] as Point, width: milToMm(Number(shape[1])), height: milToMm(Number(shape[2])), name: pad.getState_PadNumber(), stage: 3 };

			d.pads.push(value);

			records.push({ id: pad.getState_PrimitiveId(), kind: 'pad', stage: 3, owner: value.name, fingerprint: fp({ ...value, rotation: pad.getState_Rotation(), mask: pad.getState_SolderMaskAndPasteMaskExpansion() }) });
		}

		for (const outline of outlines) {
			const r = old.get(outline.getState_PrimitiveId());

			if (r?.kind === 'outline') {
				const source = outline.getState_Polygon().getSource();

				const numbers = source.filter(x => typeof x === 'number') as number[];

				if (source.some(x => typeof x === 'string' && x !== 'L') || numbers.length < 8 || numbers.length % 2 !== 0)

					throw new Error('当前仅回读闭合直线多边形板框，圆弧板框请在 EDA 中人工检查。');

				const points: Point[] = [];

				for (let i = 0; i < numbers.length; i += 2) {
					points.push([milToMm(numbers[i]) - s.parameters.originX, -milToMm(numbers[i + 1]) + s.parameters.originY]);
				}

				if (Math.hypot(points[0][0] - points.at(-1)![0], points[0][1] - points.at(-1)![1]) > 1e-5)
					throw new Error('板框未闭合，请在 EDA 中修复。');

				d.outline = points;

				records.push({ ...r, fingerprint: fp(source) });
			}
		}

		if (s.completed >= 4 && !records.some(r => r.kind === 'outline')) {
			throw new Error('关联板框丢失，请在 EDA 中恢复后重新读取。');
		}

		const modified = records.length !== s.records.length || records.some(r => old.get(r.id)?.fingerprint !== r.fingerprint);

		s.manual ||= modified;

		s.records = records;

		s.actual = d;

		return { session: s, design: d, modified, issues: [...check(d, s.completed), ...(s.completed >= 2 ? connectivity(s.completed >= 3 ? d : { ...d, parameters: { ...d.parameters, terminalMode: 0 } }) : [])] };
	}

	async generate(s: Session, input: unknown, target: number, rebuild = false) {
		if (!Number.isInteger(target) || target < 1 || target > 4)

			throw new Error('无效生成阶段。');

		const p = parameters(input);

		const d = build(p);

		const issues = [...check(d, target), ...(target >= 2 ? connectivity({ ...d, tracks: d.tracks.filter(t => t.stage <= target), pads: target >= 3 ? d.pads : [], vias: target >= 3 ? d.vias : [], parameters: target >= 3 ? p : { ...p, terminalMode: 0 } }) : [])];

		if (issues.length)

			throw new Error(issues.join('\n'));

		const board = await this.board(s);
		const start = target === 2 ? 1 : target;
		const affected = changedStage(s.parameters, p);

		if (s.records.length) {
			await this.read(s);

			if (s.manual && !rebuild)

				throw new Error('已检测到手动修改：请继续人工完成，或另存配置后新建一个设计实例。现有图形已保留。');

			if (s.manual && rebuild) {
				if (s.records.some(r => r.stage === 0))

					throw new Error('存在新建或拆分后无法归属阶段的图元，已保留，请人工完成或新建实例。');

				const signature = (t: Track) => `${t.layer || 1}:${[t.a, t.b].map(p => p.map(x => Math.round(x * 1e4)).join(',')).sort().join('/')}:${Math.round(t.width * 1e4)}`;

				const actual = s.actual!.tracks.filter(t => t.stage < start).map(signature).sort();

				const expected = build(s.parameters).tracks.filter(t => t.stage < start).map(signature).sort();

				if (fp(actual) !== fp(expected))

					throw new Error('前序阶段包含手改。请保留现有图形人工完成，或选择更早的阶段明确重建。');

				if (start > 3 && (fp(s.actual!.pads) !== fp(build(s.parameters).pads) || fp(s.actual!.vias) !== fp(build(s.parameters).vias)))

					throw new Error('前序焊盘已修改，请先选择端口阶段明确重建，或人工完成板框。');
			}
		}

		if (s.completed >= affected && (!rebuild || start > affected))
			throw new Error(`参数改变影响了已生成阶段，请从“${affected === 1 ? '敏感栅与桥内互连' : '外部引出'}”明确重建。`);

		if (rebuild) {
			const selected = s.records.filter(r => r.stage >= start);

			for (const kind of ['line', 'pad', 'via', 'outline'] as const) {
				const ids = selected.filter(r => r.kind === kind).map(r => r.id);

				if (ids.length) {
					const api = kind === 'line' ? this.api.pcb_PrimitiveLine : kind === 'pad' ? this.api.pcb_PrimitivePad : kind === 'via' ? this.api.pcb_PrimitiveVia : this.api.pcb_PrimitivePolyline;

					if (!await api.delete(ids))

						throw new Error('部分旧图元删除失败，已停止重建，请回读检查。');

					s.records = s.records.filter(r => !ids.includes(r.id));
				}
			}

			s.completed = Math.min(s.completed, start - 1);
		}

		if (target <= s.completed)

			return { session: s, message: '该阶段已完成；如需替换，请使用重建操作。' };

		s.parameters = p;

		s.board = board;

		const created: RecordItem[] = [];

		try {
			for (let stage = s.completed + 1; stage <= target; stage++) {
				for (const t of d.tracks.filter(t => t.stage === stage)) {
					const a = coords(t.a, s);

					const b = coords(t.b, s);

					const line = await this.api.pcb_PrimitiveLine.create(net(s), t.layer === 2 ? 2 : 1, ...a, ...b, mmToMil(t.width), false);

					if (!line)

						throw new Error('EDA 未能创建走线。');

					created.push({ id: line.getState_PrimitiveId(), kind: 'line', stage, owner: t.owner, fingerprint: '' });
				}

				if (stage === 3) {
					for (const v of d.vias) {
						const via = await this.api.pcb_PrimitiveVia.create(net(s), ...coords(v.center, s), mmToMil(v.hole), mmToMil(v.diameter), 0, null, { topSolderMask: -mmToMil(v.diameter), bottomSolderMask: -mmToMil(v.diameter) });
						if (!via)
							throw new Error('EDA 未能创建过孔。');
						created.push({ id: via.getState_PrimitiveId(), kind: 'via', stage, owner: v.owner, fingerprint: '' });
					}
					for (const p of d.pads) {
						const c = coords(p.center, s);

						const pad = await this.api.pcb_PrimitivePad.create(1, p.name, ...c, 0, [EPCB_PrimitivePadShapeType.RECTANGLE, mmToMil(p.width), mmToMil(p.height), 0], net(s), null, 0, 0, 0, false, 0, undefined, { topSolderMask: s.parameters.terminalMode === 2 ? 0 : mmToMil(0.1), bottomSolderMask: 0, topPasteMask: -mmToMil(Math.max(p.width, p.height)), bottomPasteMask: 0 });

						if (!pad)

							throw new Error('EDA 未能创建焊盘。');

						created.push({ id: pad.getState_PrimitiveId(), kind: 'pad', stage, owner: p.name, fingerprint: '' });
					}
				}

				if (stage === 4) {
					if ((await this.api.pcb_PrimitivePolyline.getAll('', 11)).some(x => !s.records.some(r => r.id === x.getState_PrimitiveId())))

						throw new Error('当前 PCB 已有其他板框，请在独立 PCB 中生成或手动处理板框。');

					const poly: TPCB_PolygonSourceArray = [];

					d.outline.forEach((point, i) => {
						if (i)

							poly.push('L');

						poly.push(...coords(point, s));
					});

					const polygon = this.api.pcb_MathPolygon.createPolygon(poly);

					if (!polygon)

						throw new Error('板框多边形无效。');

					const outline = await this.api.pcb_PrimitivePolyline.create('', 11, polygon, mmToMil(0.05), false);

					if (!outline)

						throw new Error('板框创建失败。');

					created.push({ id: outline.getState_PrimitiveId(), kind: 'outline', stage, owner: 'board', fingerprint: '' });
				}
				s.completed = stage;
			}

			s.records.push(...created);

			s.completed = target;

			for (const r of s.records)

				r.fingerprint = '';

			await this.read(s);

			s.manual = false;

			if (!await this.api.pcb_Document.save())

				throw new Error('图形已生成，但 EDA 保存未成功，请手动保存并导出配置。');

			return { session: s, message: '已执行到所选阶段，图元可在 EDA 中手动编辑。' };
		}
		catch (error) {
			for (const r of created) {
				if (!s.records.some(x => x.id === r.id))

					s.records.push(r);
			}

			s.manual = true;

			throw error;
		}
	}

	async save(s: Session) {
		if (s.board) {
			await this.read(s);

			if (!await this.api.pcb_Document.save())

				throw new Error('EDA 工程未保存，配置尚未导出。');
		}

		await this.api.sys_FileSystem.saveFile(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }), `bridge-${s.id}.strain.json`);

		return s;
	}
}
