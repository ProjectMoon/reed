var	fs = require('fs'),
	path = require('path'),
	async = require('async'),
	ru = require('./reed-util');

function FilesystemHelper(directory) {
	this.dir = directory;
}

FilesystemHelper.prototype.exists = function(filename, callback) {
	fs.exists(this.dir + filename, callback);
}

FilesystemHelper.prototype.readMarkdown = function(dir, callback) {
	fs.readdir(dir, function(err, files) {
		if (err) return callback(err);
		var self = this;
		var filenames = [];
		
		var tasks = [];
		files.forEach(function(file) {
			tasks.push(function(cb) {
				var fullpath = path.join(dir, file);
				fs.stat(fullpath, function(err, stats) {
					if (err) return callback(err);
					if (ru.isMarkdown(file, stats)) {
						filenames.push(file);
					}
					
					cb(null);
				});
			});
		});
		
		async.parallel(tasks, function(err) {
			if (err) return callback(err);
			callback(null, filenames);
		});
	});
}

FilesystemHelper.prototype.remove = function(filename, callback) {
	fs.unlink(filename, function(err) {
		if (typeof callback !== 'undefined') callback(err);
	});
}

FilesystemHelper.prototype.removeAll = function() {
	this.readMarkdown(this.dir, function(files) {
		files.forEach(function(filename) {
			this.remove(filename);
		});
	});
}

exports.FilesystemHelper = FilesystemHelper;
