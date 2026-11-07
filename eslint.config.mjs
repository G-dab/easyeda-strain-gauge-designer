import antfu from '@antfu/eslint-config';

export default antfu({
	stylistic: {
		indent: 'tab',
		quotes: 'single',
		semi: true,
	},

	typescript: true,

	ignores: ['build/dist/', 'coverage/', 'dist/', 'node_modules/', '.cache/', 'iframe/app.js', '.eslintcache', 'debug.log'],

	rules: {
		// This project uses the built-in Node test runner, not Vitest.
		'test/no-import-node-test': 'off',
		'no-console': ['warn', { allow: ['log', 'warn', 'error'] }],
	},
});
