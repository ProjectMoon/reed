exports.endsWith = function(str, text) {
	return str.substr(-text.length) === text;
}

exports.startsWith = function(str, text) {
	return str.substr(0, text.length) === text;
}

exports.isMarkdownFilename = function(filename) {
	return exports.endsWith(file, '.md') || exports.endsWith(file, '.markdown');
}

exports.isMarkdown = function(file, stats) {
	return stats.isFile() && (exports.endsWith(file, '.md') || exports.endsWith(file, '.markdown'));
}
