import type { Session } from './adapter';

import type { Design, Parameters } from './geometry';

import { newSession, validateSession } from './adapter';

import { bounds, build, changedStage, check, connectivity, defaults, parameters, stages, stats, svg } from './geometry';
import { guide, highlight } from './parameter-guide';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const native = typeof eda !== 'undefined';

let session: Session & { draft?: Parameters } = newSession({ ...defaults });

let stage = 2;

let current: Design | undefined;

let zoom = 1;

let pan = [0, 0];

let drag: number[] | undefined;

let pending = false;
let selectedParameter: keyof Parameters = 'length';
let guideExpanded = false;
let parameterSelected = false;

const keys = Object.keys(defaults) as (keyof Parameters)[];
let lastOrder = [defaults.order0, defaults.order1, defaults.order2, defaults.order3];
let cached: { key: string; design: Design } | undefined;
function preview(p: Parameters) {
	const key = JSON.stringify(p);
	if (cached?.key !== key)
		cached = { key, design: build(p) };
	return cached.design;
}
function layerSelection() {
	return { front: $<HTMLInputElement>('showFront').checked, back: $<HTMLInputElement>('showBack').checked };
}
function fields() {
	const mode = Number($<HTMLSelectElement>('terminalMode').value);
	document.querySelectorAll<HTMLElement>('[data-stage-group]').forEach((el) => {
		const choice = el.dataset.terminal;
		el.hidden = Number(el.dataset.stageGroup) !== stage || (!!choice && (choice === 'any' ? mode === 0 : Number(choice) !== mode));
	});
	document.querySelectorAll<HTMLElement>('[data-back-settings]').forEach(el => el.hidden = !$<HTMLInputElement>('allowBack').checked);
}

function values() {
	return parameters(Object.fromEntries(keys.map(k => [k, k === 'allowBack' ? Number($<HTMLInputElement>(k).checked) : Number($<HTMLInputElement>(k).value)])));
}

function inputs(p: Parameters) {
	keys.forEach((k) => {
		if (k === 'allowBack')
			$<HTMLInputElement>(k).checked = Boolean(p[k]);
		else $<HTMLInputElement>(k).value = String(p[k]);
	});
	lastOrder = [p.order0, p.order1, p.order2, p.order3];
}

function message(text: string, error = false) {
	$('message').textContent = text;

	$('message').classList.toggle('error', error);
}

function download(text: string, name: string, type: string) {
	const u = URL.createObjectURL(new Blob([text], { type }));

	const a = document.createElement('a');

	a.href = u;

	a.download = name;

	a.click();

	setTimeout(() => URL.revokeObjectURL(u), 1000);
}

function render() {
	$('guideBody').hidden = !guideExpanded;
	$('toggleGuideText').textContent = guideExpanded ? '收起图解' : '展开图解';
	$('toggleGuide').setAttribute('aria-expanded', String(guideExpanded));
	document.querySelectorAll<HTMLElement>('.field').forEach(f => f.classList.toggle('parameter-active', guideExpanded && parameterSelected && !!f.querySelector(`#${selectedParameter}`)));
	fields();
	let invalid = false;

	try {
		const d = current || preview(values());

		const ss = stats(d);

		const issues = check(d, Math.min(stage, 4));

		if (current && session.completed >= 2)
			issues.push(...connectivity(d));
		invalid = issues.length > 0;

		const annotations = guideExpanded && parameterSelected && layerSelection().front ? highlight(selectedParameter, { ...d, tracks: d.tracks.filter(t => (t.layer || 1) === 1 || layerSelection().back) }) : '';
		$('drawing').innerHTML = svg(d, stage === 0 ? 2 : stage, layerSelection()).replace('</svg>', `<g pointer-events="none">${annotations}</g></svg>`);
		$('layerStatus').textContent = (d.tracks.some(t => t.layer === 2) ? `引出使用双面铜层 · ${d.vias.length} 个过孔` : '当前图形仅使用正面铜层') + (stage >= 3 && d.pads.length ? ` · 接点从左到右：${d.pads.map((p, i) => `${i + 1}=${p.name}`).join('，')}` : '');

		const help = guide(selectedParameter, d.parameters);
		$('guideTitle').textContent = help.title;
		$('guideValue').textContent = `当前设置：${help.value}`;
		$('guideDescription').textContent = help.explanation;
		$('guideNote').textContent = help.note;
		$('guideDrawing').innerHTML = help.image;

		$('drawing').style.transform = `translate(${pan[0]}px,${pan[1]}px) scale(${zoom})`;

		const box = bounds(d);
		$('size').textContent = `${box.width.toFixed(2)} × ${box.height.toFixed(2)}`;

		$('armLength').textContent = ss[0].length.toFixed(2);

		$('armStats').replaceChildren(...ss.map((s) => {
			const div = document.createElement('div');

			div.className = 'arm';

			const a = document.createElement('span');

			const b = document.createElement('b');

			a.textContent = `${s.name} 臂（含桥内互连）`;

			b.textContent = `${s.resistance.toFixed(3)} Ω`;

			div.append(a, b);

			return div;
		}));

		$('issues').replaceChildren(...(issues.length ? issues : ['通过当前几何与间距检查']).map((s) => {
			const div = document.createElement('div');

			div.className = issues.length ? 'issue' : 'pass';

			div.textContent = (issues.length ? '● ' : '✓ ') + s;

			return div;
		}));

		$('viewTitle').textContent = `${current ? '实际图形回读' : '参数预览'} / ${stages[stage]}`;
	}
	catch (e) {
		invalid = true;
		$('drawing').textContent = '请修正参数';

		$('issues').textContent = e instanceof Error ? e.message : String(e);
	}

	$('identity').textContent = `设计 ${session.id.slice(0, 6)}`;

	$('state').textContent = session.completed ? `已写入至「${stages[session.completed]}」${session.manual ? ' · 已检测到手改，保留实际图形' : ''}` : '尚未写入 PCB';

	try {
		const affected = changedStage(session.parameters, values());
		if (session.completed >= affected)
			$('state').textContent += `\n参数已改变：需从“${affected === 1 ? '敏感栅与桥内互连' : '外部引出'}”重建，现有 PCB 图形尚未替换。`;
	}
	catch { /* Invalid draft parameters are shown in the checks panel. */ }

	document.querySelectorAll<HTMLButtonElement>('.steps button[data-stage]').forEach(b => b.classList.toggle('active', Number(b.dataset.stage) === stage));

	$<HTMLButtonElement>('generate').disabled = pending || !native || stage === 0 || invalid;

	$('generate').textContent = '生成到所选阶段';

	$<HTMLButtonElement>('rebuild').disabled = pending || !native || stage < 1 || stage > 4 || !session.completed || invalid;

	$<HTMLButtonElement>('read').disabled = pending || !native || !session.board;
}

async function command(action: string) {
	if (pending)

		return;

	if (action !== 'open')

		session.draft = values();

	if (!native) {
		if (action === 'save') {
			if (!session.completed)

				session.parameters = values();

			download(JSON.stringify(session, null, 2), 'bridge.strain.json', 'application/json');

			message('已导出本地配置。');
		}

		return;
	}

	pending = true;

	document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#form input,#form select').forEach(x => x.disabled = true);

	render();

	message('正在执行，请稍候…');

	try {
		const r = await eda.sys_MessageBus.rpcCall('strain-bridge.command', { action, session, parameters: action === 'open' ? undefined : values(), stage }, 300000);

		if (r.session)

			session = validateSession(r.session);

		if (r.cancelled) {
			message('已取消。');

			return;
		}

		if (!r.ok)

			throw new Error(r.error);

		if (action === 'read') {
			current = r.design;

			stage = Math.max(2, Math.min(session.completed, 4));

			message(r.modified ? '实际图形已读取，检测到手动修改。' : '实际图形与已保存关联一致。');
		}

		else {
			if (action === 'open') {
				inputs(session.draft || session.parameters);

				current = session.actual;

				$('catalog').hidden = true;

				$('workspace').hidden = false;

				stage = Math.max(2, session.completed);
			}

			else {
				current = undefined;
			}

			message(r.message || '操作完成。');
		}
	}
	catch (e) {
		message(e instanceof Error ? e.message : String(e), true);
	}
	finally {
		pending = false;

		document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#form input,#form select').forEach(x => x.disabled = false);

		render();
	}
}

keys.forEach(k => $(k).addEventListener('input', () => {
	if (k.startsWith('order')) {
		const i = Number(k.at(-1));
		const value = Number($<HTMLSelectElement>(k).value);
		const duplicate = lastOrder.findIndex((n, j) => n === value && j !== i);
		if (duplicate >= 0)
			$<HTMLSelectElement>(`order${duplicate}`).value = String(lastOrder[i]);
		lastOrder = [0, 1, 2, 3].map(n => Number($<HTMLSelectElement>(`order${n}`).value));
	}
	current = undefined;

	render();
}));

$('form').onsubmit = e => e.preventDefault();

$('enter').onclick = () => {
	$('catalog').hidden = true;

	$('workspace').hidden = false;

	render();
};

$('back').onclick = () => {
	$('workspace').hidden = true;

	$('catalog').hidden = false;
};

[0, 2, 3, 4].forEach((i, number) => {
	const s = stages[i];
	const b = document.createElement('button');

	b.textContent = `${number + 1} ${s}`;

	b.dataset.stage = String(i);

	b.onclick = () => {
		stage = i;

		parameterSelected = false;
		selectedParameter = i === 0 ? 'thickness' : i === 2 ? 'length' : i === 3 ? 'terminalMode' : 'margin';
		render();
	};

	$('steps').append(b);
});

$('generate').onclick = () => {
	void command('generate').catch(e => message(String(e), true));
};

$('read').onclick = () => {
	void command('read').catch(e => message(String(e), true));
};

$('save').onclick = () => {
	void command('save').catch(e => message(String(e), true));
};

$('open').onclick = () => {
	if (native)

		void command('open');

	else

		$<HTMLInputElement>('upload').click();
};

$<HTMLInputElement>('upload').onchange = async () => {
	try {
		const f = $<HTMLInputElement>('upload').files?.[0];

		if (!f)

			return;

		if (f.size > 2_000_000)

			throw new Error('配置过大。');

		session = validateSession(JSON.parse(await f.text()));

		inputs(session.draft || session.parameters);

		current = session.actual;

		stage = Math.max(2, session.completed);

		$('catalog').hidden = true;

		$('workspace').hidden = false;

		render();

		message('配置已加载。');
	}
	catch (e) {
		message(String(e), true);
	}
	finally {
		$<HTMLInputElement>('upload').value = '';
	}
};

$('fresh').onclick = () => {
	if (session.records.length) {
		// This explicit action detaches the UI from the current project instance.

		// eslint-disable-next-line no-alert
		if (!window.confirm('新建独立实例并保留 PCB 中现有图形。请先保存当前配置。'))

			return;
	}

	session = newSession(values());

	current = undefined;

	render();

	message('已新建实例；生成位置请放在独立 PCB，或调整原点避免重叠。');
};

$('rebuild').onclick = () => $<HTMLDialogElement>('confirmation').showModal();

$('cancel').onclick = () => $<HTMLDialogElement>('confirmation').close();

$('confirm').onclick = () => {
	$<HTMLDialogElement>('confirmation').close();

	void command('rebuild').catch(e => message(String(e), true));
};

$('svg').onclick = () => {
	try {
		download(svg(current || preview(values()), stage === 0 ? 2 : stage, layerSelection()), 'bridge-preview.svg', 'image/svg+xml');
	}
	catch (e) {
		message(String(e), true);
	}
};

function transform() {
	$('drawing').style.transform = `translate(${pan[0]}px,${pan[1]}px) scale(${zoom})`;
}

$('fit').onclick = () => {
	zoom = 1;

	pan = [0, 0];

	transform();
};

$('plus').onclick = () => {
	zoom = Math.min(5, zoom * 1.2);

	transform();
};

$('minus').onclick = () => {
	zoom = Math.max(0.3, zoom / 1.2);

	transform();
};

$('canvas').addEventListener('wheel', (e) => {
	e.preventDefault();

	zoom = Math.max(0.3, Math.min(5, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));

	transform();
}, { passive: false });

$('drawing').onpointerdown = (e) => {
	drag = [e.clientX, e.clientY, ...pan];

	$('drawing').setPointerCapture(e.pointerId);
};

$('drawing').onpointermove = (e) => {
	if (drag) {
		pan = [drag[2] + e.clientX - drag[0], drag[3] + e.clientY - drag[1]];

		transform();
	}
};

$('drawing').onpointerup = () => drag = undefined;

inputs(defaults);

$('thumbnail').innerHTML = svg(build(defaults), 2);

$('notice').textContent = native ? '已连接 EDA：生成到指定阶段后，可最小化此窗口手动编辑 PCB。' : '浏览器预览：可调参数、保存配置和导出 SVG；写入 PCB 需在 EDA 插件内操作。';

render();

function selectParameter(key: keyof Parameters) {
	selectedParameter = key;
	parameterSelected = guideExpanded;
	render();
}
keys.forEach((key) => {
	const input = $(key);
	const label = input.closest('.field')?.querySelector('label');
	if (label) {
		label.htmlFor = key;
		label.addEventListener('click', () => selectParameter(key));
	}
	input.addEventListener('focus', () => selectParameter(key));
	input.addEventListener('click', () => selectParameter(key));
});
$('toggleGuide').onclick = () => {
	guideExpanded = !guideExpanded;
	parameterSelected = false;
	render();
};

$('showFront').onchange = render;
$('showBack').onchange = render;
