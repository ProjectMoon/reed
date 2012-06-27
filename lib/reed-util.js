function endsWith(str, text) {
	return str.substr(-text.length) === text;
	return str.substr(-text.length) === text;
}

function startsWith(str, text) {
	return str.substr(0, text.length) === text;
}

exports.isMarkdown = function(file, stats) {
	return stats.isFile() && endsWith(file, '.md');
}
