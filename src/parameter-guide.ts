import type { Design, Parameters, Track } from './geometry';

const descriptions: Record<keyof Parameters, [string, string, string]> = {
	length: ['直栅长度 ℓ', '一条长直铜线从一个折返连接处，到另一个折返连接处的直线长度。', '它不是整片尺寸，也不是全部铜线加起来的长度。'],
	count: ['直栅条数 N', '数一个敏感栅里有多少条平行长直铜线，折返短边不计入条数。', '当前紧凑模板使用奇数条，让两个端点分处对角。图中只画 5 条帮助理解。'],
	width: ['线宽 w', '单条敏感栅铜线的宽度，从这一条铜线的一侧边缘量到另一侧边缘。', '与铜线之间的空隙是两个不同参数。示意图将细节放大显示。'],
	gap: ['净间距 s', '相邻铜线之间没有铜的空隙，从一条铜线的边缘量到下一条铜线的边缘。', '中心线之间的节距 = 线宽 w + 净间距 s。'],
	thickness: ['铜厚 t', '从侧面看，铜箔层自身的厚度。', '单位是 μm；它与顶视图中的线宽不同，也不是整张 FPC 的总厚度。'],
	quadrantGap: ['相邻敏感栅间隔 g', '相邻两个敏感栅主体最外侧铜边之间的距离，横向和纵向使用相同数值。', '不额外叠加净间距或隐藏边距。专门连接相邻栅的桥内互连线不计入栅体间隔。'],
	routingWidth: ['直接互连线宽 b', '相邻两个敏感栅之间，用来接桥的那一小段铜线的宽度。', '它不改变栅内长直铜线的线宽；放大图单独标出连接段。'],
	terminalMode: ['外部引出', '选择不引出、下方焊接焊盘或 FPC 金手指。', '接点位于下方尾端，通过独立引出线连接桥路节点。'],
	padWidth: ['焊盘宽度', '从顶视图看，矩形外部焊盘沿水平方向的尺寸。', '仅用于下方焊接焊盘模式。'],
	padHeight: ['焊盘高度', '从顶视图看，矩形外部焊盘沿竖直方向的尺寸。', '这里的“高度”是平面内尺寸，不是铜厚。仅用于下方焊接焊盘模式。'],
	allowBack: ['允许背面走线', '开启后引出可通过通孔切换到背面，敏感栅始终保持正面。', '关闭后若指定接点顺序无法布通，阻止生成，不改变顺序。'],
	leadWidth: ['引出线宽', '桥路节点到下方接点的导线铜宽。', '外部引出独立于敏感栅，不计入桥臂电阻。'],
	leadGap: ['引出线净间距', '不同桥路节点的引出导线之间最小铜边间隔。', '顶底层投影交叉不算连接，仅过孔可跨层导通。'],
	viaHole: ['过孔孔径', '过孔中间钻孔的直径。', '这是设计值，需与实际 FPC 加工能力核对。'],
	viaDiameter: ['过孔外径', '过孔外圈铜盘的直径。', '外径至少比孔径大 0.20 mm；过孔放在引出区。'],
	tailLength: ['尾部延伸长度', '从敏感栅主体最下方铜边，到尾部末端的纵向距离。', '包含引出布线区、斜肩及接点区域。'],
	tailWidth: ['尾端宽度', '插接尾端左右两条裁切边之间的距离。', '金手指模式使用该宽度；焊盘模式按接点布局自动加宽。'],
	contactPitch: ['接点节距', '相邻金手指铜接点中心之间的横向距离。', '四个接点的总铜宽为 3 × 节距 + 接点宽度。'],
	contactWidth: ['接点宽度', '每一根金手指接点的横向铜宽。', '接点宽度必须小于节距，并保留要求的净间距。'],
	contactLength: ['露铜长度', '每根金手指沿尾部插接方向的接触铜面长度。', '金手指铜面对应开窗，不额外扩张开窗。'],
	contactInset: ['接点距末端距离', '接点最前端到 FPC 尾部裁切末端的留白。', '接点必须留在板框内；此处单独检查接触区板边。'],
	padPitch: ['焊盘接点节距', '相邻焊接焊盘中心之间的横向距离。', '焊盘模式会根据接点总宽和板边预留自动加宽尾部。'],
	tailThickness: ['成品尾端厚度', '供后续制造使用的插接端成品总厚度备注。', '与铜厚不同；此输入不会自动修改 EDA 层叠。'],
	reinforcementLength: ['补强长度', '尾端需要补强区域的长度备注。', '随配置保存，实际材料与补强工艺需在制造流程设置。'],
	order0: ['1 号接点', '下方从左到右第 1 个接点连接的桥路节点。', '更改顺序时自动交换另一接点，保持四个节点各出现一次。'],
	order1: ['2 号接点', '下方从左到右第 2 个接点连接的桥路节点。', '更改顺序时自动交换另一接点，保持四个节点各出现一次。'],
	order2: ['3 号接点', '下方从左到右第 3 个接点连接的桥路节点。', '更改顺序时自动交换另一接点，保持四个节点各出现一次。'],
	order3: ['4 号接点', '下方从左到右第 4 个接点连接的桥路节点。', '更改顺序时自动交换另一接点，保持四个节点各出现一次。'],
	margin: ['铜到板边预留 m', '最外侧铜图形的边缘，到 FPC 裁切板框之间的留白距离。', '有焊盘时，焊盘也属于铜图形。该参数影响最终板框大小。'],
	originX: ['PCB 放置位置 X', '整个模板参考点相对 EDA 数据原点的水平偏移，正值向右。', '改变放置位置，不改变敏感栅的形状和尺寸。参考点不是板框角点。'],
	originY: ['PCB 放置位置 Y', '整个模板参考点相对 EDA 数据原点的竖直偏移，正值向上。', '这是 EDA 数据坐标的方向；屏幕上用于示意的绘图坐标不改变这一定义。'],
};

const hot = '#d85726';
const dim = (x1: number, y1: number, x2: number, y2: number, text: string, active = true) => `<g stroke="${active ? hot : '#8797a5'}" fill="none" stroke-width="1.5"><path d="M${x1} ${y1}L${x2} ${y2}" marker-start="url(#${active ? 'tip-hot' : 'tip-gray'})" marker-end="url(#${active ? 'tip-hot' : 'tip-gray'})"/></g><text x="${(x1 + x2) / 2 + (x1 === x2 ? -13 : 0)}" y="${(y1 + y2) / 2 + (y1 === y2 ? -9 : 0)}" text-anchor="middle" fill="${active ? hot : '#667d90'}" font-size="14" ${x1 === x2 ? `transform="rotate(-90 ${(x1 + x2) / 2 - 13} ${(y1 + y2) / 2})"` : ''}>${text}</text>`;

export function guide(key: keyof Parameters, p: Parameters) {
	const [title, explanation, note] = descriptions[key];
	let shapes = '';
	if (key === 'length' || key === 'count') {
		shapes = '<path d="M110 35V165H155V35H200V165H245V35H290V165" fill="none" stroke="#d9a253" stroke-width="10" stroke-linejoin="round"/>';
		shapes += dim(75, 35, 75, 165, '直栅长度 ℓ', key === 'length');
		shapes += [110, 155, 200, 245, 290].map((x, i) => `<text x="${x}" y="195" fill="${key === 'count' ? hot : '#718798'}" text-anchor="middle" font-size="15">${i + 1}</text>`).join('');
		shapes += '<text x="370" y="78" fill="#536d80" font-size="13">只数长直段</text><text x="370" y="105" fill="#7e91a1" font-size="12">折返短边不计数</text>';
	}
	else if (key === 'width' || key === 'gap') {
		shapes = '<rect x="165" y="35" width="35" height="140" fill="#d9a253"/><rect x="255" y="35" width="35" height="140" fill="#d9a253"/><path d="M182.5 28V185M272.5 28V185" stroke="#9a773b" stroke-dasharray="4 4"/>';
		shapes += dim(165, 85, 200, 85, 'w', key === 'width');
		shapes += dim(200, 133, 255, 133, 's', key === 'gap');
		shapes += '<text x="350" y="85" fill="#536d80" font-size="13">金色区域 = 铜</text><text x="350" y="114" fill="#536d80" font-size="13">白色空隙 = 无铜</text>';
	}
	else if (key === 'thickness') {
		shapes = '<rect x="105" y="55" width="310" height="25" fill="#b5d9ca"/><rect x="105" y="80" width="310" height="20" fill="#d9a253"/><rect x="105" y="100" width="310" height="55" fill="#ccd9e4"/><text x="120" y="73" fill="#467260" font-size="12">覆盖膜及胶层（示意）</text><text x="120" y="96" fill="#76511b" font-size="12">铜箔</text><text x="120" y="132" fill="#617c92" font-size="12">PI 基材</text>';
		shapes += dim(455, 80, 455, 100, '铜厚 t');
	}
	else if (key === 'quadrantGap') {
		shapes = [[105, 25, 'A'], [290, 25, 'B'], [105, 120, 'C'], [290, 120, 'D']].map(([x, y, t]) => `<rect x="${x}" y="${y}" width="145" height="65" rx="3" fill="#e5f1f1" stroke="#74a7a9"/><text x="${Number(x) + 72}" y="${Number(y) + 38}" text-anchor="middle" fill="#577a87" font-size="16">${t}</text>`).join('');
		shapes += dim(250, 60, 290, 60, 'g');
		shapes += dim(177, 90, 177, 120, 'g');
		shapes += '<text x="455" y="150" fill="#73889a" font-size="11">实线框</text><text x="455" y="168" fill="#73889a" font-size="11">= 栅体铜边界</text>';
	}
	else if (key === 'routingWidth') {
		shapes = '<rect x="80" y="55" width="125" height="100" rx="4" fill="#e9f1f5"/><rect x="355" y="55" width="125" height="100" rx="4" fill="#e9f1f5"/><text x="143" y="108" fill="#6b8597" font-size="14" text-anchor="middle">敏感栅 A</text><text x="418" y="108" fill="#6b8597" font-size="14" text-anchor="middle">相邻敏感栅 B</text><path d="M205 105H355" stroke="#b6a0dc" stroke-width="20"/>';
		shapes += dim(280, 95, 280, 115, '互连线宽 b');
	}
	else if (key === 'margin') {
		shapes = '<rect x="80" y="30" width="400" height="160" fill="none" stroke="#7794ab" stroke-width="2" stroke-dasharray="6 4"/><rect x="155" y="75" width="250" height="70" rx="3" fill="#d9a253"/><text x="280" y="116" text-anchor="middle" fill="#775622" font-size="14">最外侧铜图形</text><text x="380" y="25" fill="#6f899d" font-size="12">FPC 板框 / 裁切线</text>';
		shapes += dim(80, 115, 155, 115, 'm');
	}
	else if (key === 'originX' || key === 'originY') {
		shapes = '<path d="M65 180H470M65 180V20" fill="none" stroke="#8297a8" stroke-width="2"/><rect x="235" y="55" width="145" height="90" fill="#e6f1f2" stroke="#5d969e"/><circle cx="235" cy="95" r="4" fill="#d85726"/><text x="80" y="204" fill="#7d92a4" font-size="12">EDA 数据原点</text><text x="247" y="91" fill="#607d8f" font-size="12">模板参考点</text><text x="477" y="185" fill="#71899c">X</text><text x="50" y="20" fill="#71899c">Y</text>';
		shapes += key === 'originX' ? dim(65, 160, 235, 160, 'X 偏移') : dim(110, 180, 110, 95, 'Y 偏移');
	}
	else if (key === 'viaHole' || key === 'viaDiameter' || key === 'allowBack') {
		shapes = '<circle cx="205" cy="105" r="65" fill="#eab4cd"/><circle cx="205" cy="105" r="29" fill="#fbfcfd"/><text x="335" y="95" fill="#607d8f">外圈：铜盘</text><text x="335" y="125" fill="#607d8f">内圈：钻孔</text>';
		shapes += key === 'viaHole' ? dim(176, 105, 234, 105, '孔径') : dim(140, 190, 270, 190, '外径');
	}
	else if (key !== 'padWidth' && key !== 'padHeight') {
		shapes = '<path d="M150 25H360V75L315 110V195H195V110L150 75Z" fill="#e6eff4" stroke="#7895a9"/><rect x="207" y="140" width="13" height="42" fill="#d9a253"/><rect x="230" y="140" width="13" height="42" fill="#d9a253"/><rect x="253" y="140" width="13" height="42" fill="#d9a253"/><rect x="276" y="140" width="13" height="42" fill="#d9a253"/>';
		if (key === 'tailWidth')
			shapes += dim(195, 210, 315, 210, '尾端宽度');
		else if (key === 'tailLength')
			shapes += dim(390, 75, 390, 195, '尾部延伸长度');
		else if (key === 'contactLength')
			shapes += dim(345, 140, 345, 182, '露铜长度');
		else if (key === 'contactWidth')
			shapes += dim(253, 126, 266, 126, '接点宽度');
		else if (key === 'contactPitch' || key === 'padPitch')
			shapes += dim(213.5, 125, 236.5, 125, '中心节距');
		else if (key === 'contactInset')
			shapes += dim(345, 182, 345, 195, '距末端');
		else shapes += '<text x="410" y="105" fill="#607d8f" font-size="13">下方引出尾端</text>';
	}

	else {
		shapes = '<rect x="210" y="50" width="135" height="110" rx="3" fill="#77bca7"/><text x="277" y="108" text-anchor="middle" fill="#fff" font-size="15">外部焊盘</text>';
		shapes += dim(210, 190, 345, 190, '焊盘宽度', key !== 'padHeight');
		shapes += dim(385, 50, 385, 160, '焊盘高度', key === 'padHeight');
	}
	const unit = key === 'thickness' ? 'μm' : key === 'count' ? '条' : 'mm';
	const value = key === 'terminalMode' ? ['不引出', '焊接焊盘', 'FPC 金手指'][p.terminalMode] : key === 'allowBack' ? (p.allowBack ? '允许' : '不允许') : key.startsWith('order') ? ['E+', 'OUT+', 'E−', 'OUT−'][p[key]] : `${p[key]} ${unit}`;
	return { title, explanation, note, value, image: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 220" role="img" aria-label="${title}定义示意"><defs><marker id="tip-hot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="none" stroke="${hot}" stroke-width="1.5"/></marker><marker id="tip-gray" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="none" stroke="#8797a5" stroke-width="1.5"/></marker></defs>${shapes}</svg>` };
}

export function highlight(key: keyof Parameters, d: Design): string {
	const lines = d.tracks.filter(t => t.stage === 1 && t.owner === 'B');
	const first = lines[0];
	if (!first)
		return '';
	const trace = (t: Track) => `<path d="M${t.a.join(' ')}L${t.b.join(' ')}" fill="none" stroke="#fff184" stroke-width="${t.width + 0.035}"/>`;
	if (key === 'length' || key === 'width')
		return trace(first);
	if (key === 'count')
		return lines.filter(t => Math.abs(t.a[0] - t.b[0]) < 1e-6).map(trace).join('');
	if (key === 'gap') {
		const p = d.parameters;
		return `<rect x="${first.a[0] + first.width / 2}" y="${Math.min(first.a[1], first.b[1])}" width="${p.gap}" height="${Math.abs(first.a[1] - first.b[1])}" fill="#fff184" opacity=".8"/>`;
	}
	if (key === 'routingWidth')
		return d.tracks.filter(t => t.stage === 2).map(trace).join('');
	if (['terminalMode', 'padWidth', 'padHeight', 'contactPitch', 'contactWidth', 'contactLength', 'contactInset', 'padPitch', 'tailWidth'].includes(key) || key.startsWith('order'))
		return d.pads.map(p => `<rect x="${p.center[0] - p.width / 2}" y="${p.center[1] - p.height / 2}" width="${p.width}" height="${p.height}" fill="none" stroke="#fff184" stroke-width=".06"/>`).join('');
	if (['leadWidth', 'leadGap', 'tailLength', 'allowBack', 'viaHole', 'viaDiameter'].includes(key))
		return d.tracks.filter(t => t.stage === 3).map(trace).join('');
	if (key === 'margin')
		return `<path d="M${d.outline.map(p => p.join(' ')).join('L')}" fill="none" stroke="#fff184" stroke-width=".06"/>`;
	if (key === 'quadrantGap') {
		const box = (name: string) => {
			const ts = d.tracks.filter(t => t.stage === 1 && t.owner === name);
			return { left: Math.min(...ts.map(t => Math.min(t.a[0], t.b[0]) - t.width / 2)), right: Math.max(...ts.map(t => Math.max(t.a[0], t.b[0]) + t.width / 2)), top: Math.min(...ts.map(t => Math.min(t.a[1], t.b[1]) - t.width / 2)), bottom: Math.max(...ts.map(t => Math.max(t.a[1], t.b[1]) + t.width / 2)) };
		};
		const A = box('A');
		const B = box('B');
		const C = box('C');
		const D = box('D');
		const r = (x: number, y: number, w: number, h: number) => `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}"/>`;
		return `<g fill="#fff184" opacity=".35">${r(A.right, Math.max(A.top, B.top), B.left - A.right, Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top))}${r(C.right, Math.max(C.top, D.top), D.left - C.right, Math.min(C.bottom, D.bottom) - Math.max(C.top, D.top))}${r(Math.max(A.left, C.left), A.bottom, Math.min(A.right, C.right) - Math.max(A.left, C.left), C.top - A.bottom)}${r(Math.max(B.left, D.left), B.bottom, Math.min(B.right, D.right) - Math.max(B.left, D.left), D.top - B.bottom)}</g>`;
	}
	return '';
}
