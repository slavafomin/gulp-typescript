const gulp = require('gulp');
const rimraf = require('rimraf');
const fs = require('fs');
const path = require('path');
const mergeStream = require('merge-stream');
const ts = require('./release/main');

const plumber = require('gulp-plumber');
const diff = require('gulp-diff');

const tsVersions = {
	dev: './typescript/dev',
	release23: './typescript/2.3',
	release27: './typescript/2.7',
	release29: './typescript/2.9'
};

function findTSDefinition(location) {
	return path.join(path.dirname(require.resolve(location)), 'typescript.d.ts');
}

function createProject(options) {
	return ts.createProject('lib/tsconfig.json', options);
}

const tsProject = createProject();

const paths = {
	scripts: ['lib/**.ts'],
	definitionTypeScript: [findTSDefinition('typescript')],
	releaseBeta: 'release-2',
	release: 'release'
};

// const tests = fs.readdirSync(path.join(__dirname, 'test')).filter(function(dir) {
// 	return dir !== 'baselines' && dir !== 'output' && dir.substr(0, 1) !== '.';
// });

const tests = ['resolveJsonModule'];

// Clean
function clean(cb) {
	rimraf(paths.releaseBeta, cb);
}
gulp.task('clean-test', function(cb) {
	rimraf('test/output', cb);
});
gulp.task('clean-release', function(cb) {
	rimraf(paths.release, cb);
});

// Compile sources
const compile = gulp.series(clean, function compile() {
	return gulp.src(paths.scripts.concat(paths.definitionTypeScript))
		.pipe(tsProject())
		.pipe(gulp.dest(paths.releaseBeta));
});


// Type checking against multiple versions of TypeScript
function typecheckDev() {
	return gulp.src(paths.scripts.concat([
		'!definitions/typescript.d.ts',
		findTSDefinition(tsVersions.dev)
	])).pipe(createProject({ noEmit: true })());
}
function typecheck2_3() {
	return gulp.src(paths.scripts.concat([
		'!definitions/typescript.d.ts',
		findTSDefinition(tsVersions.release23)
	])).pipe(createProject({ noEmit: true })());
}

const typecheck = gulp.parallel(typecheckDev, typecheck2_3);

// Tests

// We run every test on multiple typescript versions:
const libs = [
	// ['2.7', require(tsVersions.release27)],
	// ['2.3', require(tsVersions.release23)],
	// ['2.9', require(tsVersions.release29)],
	['dev', require(tsVersions.dev)]
];

/**
 * Runs the tests in the directory `test/${name}/` with all the supported versions of TS
 *
 * This function loads the gulp task from the `gulptask.js` file in the corresponding directory.
 * Then, for each supported Typescript version, it executes it. The result is emitted in the
 * `test/output/${name}/${tsVersion}` directories. It consists of a `dts` directory, `js` directory and
 * `errors.txt`.
 *
 * @param name {string} Name of the test, corresponds to its directory name in `test/`
 */
async function runTest(name) {
	const testDir = path.posix.join('test', name);
	const outputDir = path.posix.join('test', 'output', name);

	const newGulpTs = require('./release-2/main');
	const testTask = require(`./${path.posix.join(testDir, 'gulptask.js')}`);

	const matchingLibs = testTask.match ? libs.filter(([, tsLib]) => testTask.match(tsLib)) : libs;
	if (matchingLibs.length === 0) return Promise.resolve();

	fs.mkdirSync(outputDir);
	return Promise.all(matchingLibs.map(([tsVersion, tsLib]) => {
		return new Promise((resolve, reject) => {
			const errors = [];
			let finishInfo;
			const reporter = {
				error (err) {
					// File names embedded in error output contain OS-dependent path separators, normalize from Windows to Posix
					if (path.sep === '\\') {
						const colonIndex = err.message.indexOf(':');
						if (colonIndex >= 0 && err.diagnostic && err.message.indexOf(path.sep) >= 0) {
							const detail = err.message.slice(colonIndex);
							const fileName = err.message.slice(0, colonIndex).replace(/\\/g, '/');
							err.message= `${fileName}${detail}`;
						}
					}
					errors.push(err);
				},
				finish(info) {
					finishInfo = info;
				}
			};
			const curOutputDir = path.posix.join(outputDir, tsVersion);
			fs.mkdirSync(curOutputDir);
			testTask(newGulpTs, tsLib, `${curOutputDir}/`, reporter).on('finish', () => {
				const result = [...errors, JSON.stringify(finishInfo, null, 4)].join('\n');
				fs.writeFileSync(path.posix.join(curOutputDir, 'errors.txt'), result);
				resolve();
			});
		});
	}));
}

gulp.task('test-run', gulp.series('clean-test', async function testRun() {
	fs.mkdirSync('test/output/');
	for (const testName of tests) {
		await runTest(testName);
	}
}));

/**
 * Executes all the test tasks and then compares their output against the expected output (defined in
 * `test/baseline`).
 */
gulp.task('test', gulp.series('test-run', function testVerify() {
	let failed = false;
	function onError(error) {
		failed = true;
	}
	return gulp.src('test/output/**/*.*')
		.pipe(plumber())
		.pipe(diff('test/baselines/'))
		.on('error', onError)
		.pipe(diff.reporter({ fail: true }))
		.on('error', onError)
		.on('finish', function() {
			if (failed) {
				throw new Error('Tests failed');
			}
		});
}));

// Accept new baselines
gulp.task('test-baselines-accept', function testBaselinesAccept(cb) {
	rimraf('test/baselines', function() {
		gulp.src('test/output/**').pipe(gulp.dest('test/baselines')).on('finish', cb);
	});
});

gulp.task('release', function release() {
	return gulp.src(paths.releaseBeta + '/**').pipe(gulp.dest(paths.release));
});

// Expose main tasks
gulp.task('scripts', compile);
gulp.task('default', gulp.series(compile, gulp.parallel(typecheck, 'test')));

gulp.task('watch', gulp.series('scripts', function watch() {
	gulp.watch(paths.scripts, compile);
}));
