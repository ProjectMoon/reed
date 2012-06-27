var	hound = require('hound'),
	events = require('events'),
	util = require('util'),
	ru = require('reed_util'),
	redis = require('redis_connector'),
	FilesystemConnector = require('filesystem-connector');
	
//singleton to enable events.
//user code interacts with it through exports.on method.
function Reed() { }
util.inherits(Reed, events.EventEmitter);

var reed = new Reed();

//redis configuration
var cfg;

//directories to watch.
var dir;
var pagesDir;

//misc objects: file watcher, filesystem connector, etc.
var watcher;
var fsc;

//states
var open = false;
var ready = false;

//Private methods.
function watch() {
	watcher = hound.watch(dir);

	watcher.on('create', function(filename, stats) {
		if (ru.isMarkdown(filename, stats)) {
			redis.insertPost(filename, function(err, metadata, post) {
				if (err) return reed.emit('error', err);
				reed.emit('add', metadata, post);
			});
		}
	});

	watcher.on('change', function(filename, stats) {
		if (ru.isMarkdown(filename, stats)) {
			redis.updatePost(filename, function(err, metadata, post) {
				if (err) return reed.emit('error', err);
				reed.emit('update', metadata, post);				
			});
		}
	});

	watcher.on('delete', function(filename, stats) {
		if (ru.isMarkdown(filename, stats)) {
			redis.removePost(filename, function(err) {
				if (err) return reed.emit('error', err);
				reed.emit('remove', file);
			});
		}
	});
}

//Connection methods.
reed.open = function(directory) {
	if (open === true || ready === true) {
		throw new Error('reed already open on ' + dir);
	}

	if (typeof directory !== 'string') {
		throw new Error('Must specify directory to read from');
	}

	dir = directory;
	
	connector.open(cfg, function(err, success) {
		if (err) return reed.emit('error', err);
		fsc = new FilesystemConnector(directory);
		open = true;
		ready = true;
		reed.emit('ready');
	});
}

reed.configure = function(config) {
	cfg = config;
}

reed.close = function() {
	redis.close();
	watcher.clear();
	ready = false;
	open = false;
}

//Data manipulation methods.
reed.get = function(title, callback) {
	redis.getPost(title, function(err, found, metadata, post) {
		if (err) return callback(err);
		
		if (found) {
			callback(null, metadata, post);
		}
		else {
			fsc.exists(title, function(exists) {
				if (exists) {
					var filename = fsc.getFilename(title);
					redis.insertPost(filename, function(err, metadata, post) {
						if (err) return callback(err);
						callback(null, metadata, post);
					});
				}
				else {
					callback(new Error('Could not find post: ' + title));
				}
			});
		}
	});
}

reed.getMetadata = function(title, callback) {
	reed.get(title, function(err, metadata, post) {
		if (err) return callback(err);
		callback(null, metadata);
	});
}

reed.all = function(callback) {
	reed.list(function(err, titles) {
		if (err) return callback(err);
		
		//create the series to load all posts asyncly in order.
		var getAllPosts = [];
		titles.forEach(function(title) {
			getAllPosts.push(function(cb) {
				reed.get(title, function(err, metadata, htmlContent) {
					var post = {
						metadata: metadata,
						htmlContent: htmlContent
					};
					
					cb(err, post);
				});
			});
		});
		
		//get all the posts.
		async.series(getAllPosts, function(err, posts) {
			callback(null, posts);
		});
	});
}

reed.list = function(callback) {
	redis.listPosts(function(err, titles) {
		if (err) return callback(err);
		callback(null, titles);
	});
}

reed.remove = function(title, callback) {
	redis.removePost(title, function(err) {
		if (err) return callback(err);
		
		fsc.removePost(title, function(err) {
			if (err) return callback(err);
			callback(null);
		});
	});
}

reed.removeAll = function(callback) {
	redis.RemoveAllPosts(function(err) {
		if (err) return callback(err);
		
		fsc.removeAllPosts(function(err) {
			if (err) return callback(err);
			callback(null);
		});
	});
}

//Deprecated methods?
reed.index = function(callback) {
	
}

reed.refresh = function() {
	
}

//The module itself is an event-based object.
module.exports = reed;
