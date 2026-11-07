import fs from 'node:fs/promises';
import { build } from 'esbuild';

await build({ entryPoints: ['src/ui.ts'], outfile: 'iframe/app.js', bundle: true, platform: 'browser', target: 'es2022', format: 'iife' });

const html = await fs.readFile('src/designer.html', 'utf8');
const bundle = (await fs.readFile('iframe/app.js', 'utf8')).replace(/<\/script/gi, '<\\/script');
const diagnostics = `
window.addEventListener('error', function (event) {
 var el = document.getElementById('notice');
 if (el) el.textContent = '插件界面出错：' + (event.message || '脚本资源加载失败') + '。请将此提示反馈以便修复。';
});
window.addEventListener('unhandledrejection', function (event) {
 var el = document.getElementById('message');
 if (el) el.textContent = '插件操作出错：' + String(event.reason && event.reason.message || event.reason);
});
`;
if (!html.includes('<script src="app.js"></script>'))
	throw new Error('UI script placeholder is missing.');
await fs.writeFile('iframe/designer.html', html.replace('<script src="app.js"></script>', () => `<script>${diagnostics}</script><script>${bundle}</script>`));
