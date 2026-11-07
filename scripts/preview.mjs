import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../iframe/', import.meta.url));
const portFlag = process.argv.indexOf('--port');
const port = portFlag === -1 ? 8766 : Number(process.argv[portFlag + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
	throw new Error('Use --port with an integer between 1024 and 65535.');

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const server = http.createServer(async (request, response) => {
	try {
		const url = new URL(request.url || '/', 'http://127.0.0.1');
		const pathname = decodeURIComponent(url.pathname === '/' ? '/designer.html' : url.pathname);
		const file = path.resolve(root, `.${pathname}`);
		if (!file.startsWith(`${path.resolve(root)}${path.sep}`) || !['GET', 'HEAD'].includes(request.method || '')) {
			response.writeHead(403).end('Forbidden');
			return;
		}
		const content = await fs.readFile(file);
		response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
		response.end(request.method === 'HEAD' ? undefined : content);
	}
	catch {
		response.writeHead(404).end('Not found');
	}
});

server.on('error', (error) => {
	console.error(`Preview failed: ${error.message}. Try npm run preview -- --port ${port + 1}`);
	process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}/designer.html`));
process.on('SIGINT', () => server.close());
