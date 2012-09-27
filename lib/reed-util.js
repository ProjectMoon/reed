var	S = require('string');

exports.isMarkdownFilename = function(filename) {
	return S(filename).endsWith('.md') || S(filename).endsWith('.markdown');
}

exports.isMarkdown = function(filename, stats) {
	return stats.isFile() && (S(filename).endsWith('.md') || S(filename).endsWith('.markdown'));
}
