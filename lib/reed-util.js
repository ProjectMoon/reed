exports.isMarkdownFilename = function(filename) {
	return exports.endsWith(file, '.md') || exports.endsWith(file, '.markdown');
}

exports.isMarkdown = function(file, stats) {
	return stats.isFile() && (exports.endsWith(file, '.md') || exports.endsWith(file, '.markdown'));
}
