var	fs = require('fs'),
	parseMarkdown = require("node-markdown").Markdown;

//taken from wheat -- MIT license
function preProcess(markdown) {
	if (!(typeof markdown === 'string')) {
		markdown = markdown.toString();
	}
	
	var props = {};

	// Parse out headers
	var match;
	while(match = markdown.match(/^([a-z]+):\s*(.*)\s*\n/i)) {
		var name = match[1];
		name = name[0].toLowerCase() + name.substring(1);
		var value = match[2];
		markdown = markdown.substr(match[0].length);
		props[name] = value;
	}
	
	props.markdown = markdown;	
	return props;
}

//Callback receives:
// err
// postDate - string version of the post date (from getTime())
// metadata
// post content - the HTML
exports.process = function(filename, callback) {
	fs.readFile(filename, function(err, data) {
		if (err) return callback(err);
		
		if (typeof data === 'undefined') {
			return callback(new Error('No data for ' + filename));
		}
		
		var metadata = preProcess(data.toString());
		var post = parseMarkdown(metadata.markdown);
		
		fs.stat(filename, function(err, stats) {
			if (err) return callback(err);
			var postDate = stats.mtime.getTime();
			metadata.lastModified = postDate;
			callback(null, postDate, metadata, post);
		});
	});
}

exports.getLastModified = function(filename, callback) {
	fs.stat(filename, function(err, stats) {
		if (err) return callback(err);
		callback(null, stats.mtime);
	});
}
