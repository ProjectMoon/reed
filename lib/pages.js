var	util = require('util'),
	events = require('events'),
	path = require('path'),
	async = require('async'),
	hound = require('hound'),
	redis = require('./redis-connector'),
	FilesystemHelper = require('./filesystem-helper').FilesystemHelper;

//singleton to enable events.
//user code interacts with it through exports.on method.
function ReedPages() { }
util.inherits(ReedPages, events.EventEmitter);

var pages = new ReedPages();

//constants
var upsertResult = redis.upsertResult;

//directory to watch
var dir;

//redis configuration (default to start, but can change)
//set by parent reed module.
var cfg = {};

//states
var open = false;
var ready = false;

var fsh;

//methods queued because the connection isn't open
var queue = [];

function watch() {
	watcher = hound.watch(dir);

	watcher.on('create', function(filename, stats) {
		if (ru.isMarkdown(filename, stats)) {
			filename = path.resolve(process.cwd(), filename);
			redis.insertPage(filename, function(err) {
				if (err) return pages.emit('error', err);
			});
		}
	});

	watcher.on('change', function(filename, stats) {
		if (ru.isMarkdown(filename, stats)) {
			filename = path.resolve(process.cwd(), filename);
			console.log(filename);
			redis.updatePage(filename, function(err) {
				if (err) return pages.emit('error', err);
			});
		}
	});

	watcher.on('delete', function(filename) {
		if (ru.isMarkdownFilename(filename)) {
			filename = path.resolve(process.cwd(), filename);
			redis.removePage(filename, function(err) {
				if (err) return pages.emit('error', err);
			});
		}
	});
}

function initDirectory(callback) {
	fsh.readMarkdown(dir, function(err, files) {
		if (err) return callback(err);
		
		var newIndex = [];
		var tasks = [];
		files.forEach(function(filename) {
			tasks.push(function(cb) {
				var fullpath = path.resolve(dir, filename);
				redis.insertPage(fullpath, function(err, result) {
					if (err) cb(err);
					newIndex.push(fullpath);
					cb(null);
				});
			});
		});
		
		async.parallel(tasks, function(err) {
			if (err) return callback(err);
			
			redis.cleanupPages(newIndex, function(err, removedFilenames) {
				if (err) return callback(err);
				callback(null);
			});
		});
	});
}

pages.configure = function(config) {
	//selectively overwrite default config properties. this way the user
	//only needs to override what's necessary.
	for (prop in config) {
		if (config[prop]) {
			cfg[prop] = config[prop];
		}
	}
}

pages.open = function(directory, callback) {
	if (open === true || ready === true) {
		throw new Error('reed pages already open on ' + dir);
	}

	if (typeof directory !== 'string') {
		throw new Error('Must specify directory to read from');
	}
	
	dir = directory;
	redis.open(cfg, function(err, success) {
		if (err) return callback(err);
		
		fsh = new FilesystemHelper(directory);
		initDirectory(function(err) {
			if (err) return pages.emit('error', err);
			watch();
			open = true;
			ready = true;
			
			//handle any queued method calls.
			queue.forEach(function(queuedCall) {
				queuedCall();
			});
			
			queue = [];
			callback(null);
		});
	});
}

pages.close = function() {
	if (!open || !ready) {
		throw new Error('reed pages is not open.');
	}
	
	redis.close();
	open = false;
	ready = false;
	queue = [];
}

pages.get = function(title, callback) {
	if (!open) return queue.push(function() {
		pages.get(title, callback);
	});
	
	redis.getPage(title, function(err, found, metadata, page) {
		if (err) return callback(err);
		if (found) {
			callback (null, metadata, page);
		}
		else {
			callback(new Error('Could not find page: ' + title));
		}
	});
}

pages.remove = function(title, callback) {
	if (!open) return queue.push(function() {
		pages.remove(title, callback);
	});
	
	redis.removePage(title, function(err) {
		callback(err);
	});
}

//Export
module.exports = pages;
