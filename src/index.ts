import type { Session } from './adapter';

/**
 * 入口文件 / Entry File
 *
 * 本文件为默认扩展入口文件，如果你想要配置其它文件作为入口文件，
 * 请修改 `extension.json` 中的 `entry` 字段。
 * This is the default extension entry file. If you want to use another file as the entry,
 * please modify the `entry` field in `extension.json`.
 *
 * 请在此处使用 `export`  导出所有你希望在 `headerMenus` 中引用的方法，
 * 方法通过方法名与 `headerMenus` 关联。
 * Please use `export` here to export all methods you want to reference in `headerMenus`.
 * Methods are associated with `headerMenus` by their method names.
 *
 * 如需了解更多开发细节，请阅读：
 * https://prodocs.lceda.cn/cn/api/guide/
 * For more development details, please visit:
 * https://prodocs.easyeda.com/en/api/guide/
 */

import { Adapter, validateSession } from './adapter';

let busy = false;

export function activate(): void {}

export async function openDesigner(): Promise<void> {
	const adapter = new Adapter(eda);

	eda.sys_MessageBus.rpcService('strain-bridge.command', async (message: { action: string; session?: Session; parameters?: unknown; stage?: number }) => {
		if (busy)

			return { ok: false, error: '上一次操作仍在执行，请稍候。' };

		busy = true;

		let s: Session | undefined;

		try {
			if (message.action === 'open') {
				const file = await eda.sys_FileSystem.openReadFileDialog('.json', false);

				if (!file)

					return { ok: true, cancelled: true };

				if (file.size > 2_000_000)

					throw new Error('配置文件过大。');

				return { ok: true, session: validateSession(JSON.parse(await file.text())) };
			}

			s = validateSession(message.session);

			if (message.action === 'generate' || message.action === 'rebuild')

				return { ok: true, ...await adapter.generate(s, message.parameters, message.stage!, message.action === 'rebuild') };

			if (message.action === 'read')

				return { ok: true, ...await adapter.read(s) };

			if (message.action === 'save')

				return { ok: true, session: await adapter.save(s), message: 'EDA 已保存，请将配置文件与工程一起保管。' };

			throw new Error('未知操作。');
		}
		catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : String(e), session: s };
		}
		finally {
			busy = false;
		}
	});

	await eda.sys_IFrame.openIFrame('/iframe/designer.html', 1200, 820, 'strain-bridge-designer', { title: '应变片设计', maximizeButton: true, minimizeButton: true, grayscaleMask: false });
}
