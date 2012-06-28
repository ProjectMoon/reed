var	hound = require('hound'),
	events = require('events'),
	util = require('util'),
	path = require('path'),
	async = require('async'),
	ru = require('./reed-util'),
	redis = require('./redis-connector'),
	FilesystemHelper = require('./filesystem-helper').FilesystemHelper;
	
//constants
var upsertResult = redis.upsertResult;
	
//singleton to enable events.
//user code interacts with it through exports.on method.
function Reed() { }
util.inherits(Reed, events.EventEmitter);

var reed = new Reed();

//redis configuration (default to start, but can change)
var cfg = {
	host: '127.0.0.1',
	port: 6379,
	password: null
};

//directory to watch
var dir;

//misc objects: file watcher, filesystem helper, etc.
var watcher;
var fsh;

//states
var open = false;
var ready = false;

//method queue for when methods are called without the redis connection open.
var queue = [];

//Private methods.
function watch() {
	watcher = hound.watch(dir);

	watcher.on('create', function(filename, stats) {
		if (ru.isMarkdown(filename, stats)) {
			filename = path.resolve(process.cwd(), filename);
			redis.insertPost(filename, function(err) {
				if (err) return reed.emit('error', err);
				var title = redis.keyManager.toTitle(filename);
				reed.emit('add', title);
			});
		}
	});

	watcher.on('change', function(filename, stats) {
		if (ru.isMarkdown(filename, stats)) {
			filename = path.resolve(process.cwd(), filename);
			console.log(filename);
			redis.updatePost(filename, function(err) {
				if (err) return reed.emit('error', err);
				var title = redis.keyManager.toTitle(filename);
				reed.emit('update', title);
			});
		}
	});

	watcher.on('delete', function(filename) {
		if (ru.isMarkdownFilename(filename)) {
			filename = path.resolve(process.cwd(), filename);
			redis.removePost(filename, function(err) {
				if (err) return reed.emit('error', err);
				reed.emit('remove', filename);
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
				redis.upsertPost(fullpath, function(err, result) {
					if (err) cb(err);
					if (result == upsertResult.NEW) {
						var title = redis.keyManager.toTitle(filename);
						reed.emit('add', title);
					}
					else if (result == upsertResult.UPDATE) {
						var title = redis.keyManager.toTitle(filename);
						reed.emit('update', title);
					}
					
					newIndex.push(fullpath);
					cb(null);
				});
			});
		});
		
		async.parallel(tasks, function(err) {
			if (err) return callback(err);
			
			redis.cleanup(newIndex, function(err, removedFilenames) {
				if (err) return callback(err);
				
				removedFilenames.forEach(function(filename) {
					reed.emit('remove', filename);
				});
				
				callback(null);
			});
		});
	});
}

//Connection methods.
reed.configure = function(config) {
	//selectively overwrite default config properties. this way the user
	//only needs to override what's necessary.
	for (prop in config) {
		if (config[prop]) {
			cfg[prop] = config[prop];
		}
	}
}

reed.open = function(directory) {
	if (open === true || ready === true) {
		throw new Error('reed already open on ' + dir);
	}

	if (typeof directory !== 'string') {
		throw new Error('Must specify directory to read from');
	}

	dir = directory;
	
	redis.open(cfg, function(err, success) {
		if (err) return reed.emit('error', err);
		
		fsh = new FilesystemHelper(directory);
		initDirectory(function(err) {
			if (err) return reed.emit('error', err);
			watch();
			open = true;
			ready = true;
			
			//handle any queued method calls.
			queue.forEach(function(queuedCall) {
				queuedCall();
			});
			
			queue = [];
			reed.emit('ready');
		});
	});
}

reed.close = function() {
	redis.close();
	watcher.clear();
	ready = false;
	open = false;
	queue = [];
}

//Data manipulation methods.
reed.get = function(title, callback) {
	if (!open) return queue.push(function() {
		reed.get(title, callback);
	});
	
	redis.getPost(title, function(err, found, metadata, post) {
		if (err) return callback(err);
		
		if (found) {
			callback(null, metadata, post);
		}
		else {
			callback(new Error('Could not find post: ' + title));
		}
	});
}

reed.getMetadata = function(title, callback) {
	if (!open) return queue.push(function() {
		reed.getMetadata(title, callback);
	});
	
	reed.get(title, function(err, metadata, post) {
		if (err) return callback(err);
		callback(null, metadata);
	});
}

reed.all = function(callback) {
	if (!open) return queue.push(function() {
			reed.all(callback);
	});
	
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
	if (!open) return queue.push(function() {
		reed.list(callback);
	});
	
	redis.listPosts(function(err, titles) {
		if (err) return callback(err);
		callback(null, titles);
	});
}

reed.remove = function(title, callback) {
	if (!open) return queue.push(function() {
		reed.remove(title, callback);
	});
	
	redis.removePostByTitle(title, function(err, filename) {
		if (err) return callback(err);
		
		fsh.remove(filename, function(err) {
			if (err) return callback(err);
			callback(null);
		});
	});
}

reed.removeAll = function(callback) {
	if (!open) return queue.push(function() {
		reed.removeAll(callback);
	});
	
	redis.removeAllPosts(function(err) {
		if (err) return callback(err);
		
		fsh.removeAllPosts(function(err) {
			if (err) return callback(err);
			callback(null);
		});
	});
}

//Deprecated methods
reed.index = function(callback) {
	console.log('index is deprecated and will be removed in the next version.');
}

reed.refresh = function() {
	console.log('refresh is deprecated and will be removed in the next version.');
}

//The module itself is an event-based object.
module.exports = reed;
