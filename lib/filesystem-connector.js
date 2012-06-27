var	fs = require('fs');

function FilesystemConnector(directory) {
	this.dir = directory;
}

FilesystemConnector.prototype.exists = function(title, callback) {
	fs.exists(dir + title, callback);
}

FilesystemConnector.prototype.getFilename = function(title) {
	return dir + title;
}

exports.FilesystemConnector = FilesystemConnector;
