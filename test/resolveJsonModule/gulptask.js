
const gulp = require('gulp');


module.exports = function resolveJsonModuleGulpTask(newTS, lib, output, reporter) {

	const tsProject = newTS.createProject(__dirname + '/tsconfig.json', {
		typescript: lib
	});
	
	const tsResult = tsProject.src()
		.pipe(tsProject(reporter))
		.on('error', () => {});

	return tsResult.js
		.pipe(gulp.dest(output + 'js'));

};
