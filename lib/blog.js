var	hound = require('hound'),
	events = require('events'),
	util = require('util'),
	path = require('path'),
	async = require('async'),
	ru = require('./reed-util'),
	redis = require('./blog-connector'),
	keyManager = require('./keymanager').KeyManager,
	FilesystemHelper = require('./filesystem-helper').FilesystemHelper;
	
//import the page connector constants for ease of use.
var upsertResult = redis.upsertResult;
	
//singleton to enable events.
//user code interacts with it through exports.on method.
function ReedBlog() { }
util.inherits(ReedBlog, events.EventEmitter);

var blog = new ReedBlog();

//redis configuration (default to start, but can change)
//set by parent reed module.
var cfg = {};

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
				if (err) return blog.emit('error', err);
				var title = keyManager.toTitle(filename);
				blog.emit('add', title);
			});
		}
	});

	watcher.on('change', function(filename, stats) {
		if (ru.isMarkdown(filename, stats)) {
			filename = path.resolve(process.cwd(), filename);
			console.log(filename);
			redis.updatePost(filename, function(err) {
				if (err) return blog.emit('error', err);
				var title = keyManager.toTitle(filename);
				blog.emit('update', title);
			});
		}
	});

	watcher.on('delete', function(filename) {
		if (ru.isMarkdownFilename(filename)) {
			filename = path.resolve(process.cwd(), filename);
			redis.removePost(filename, function(err) {
				if (err) return blog.emit('error', err);
				blog.emit('remove', filename);
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
						var title = keyManager.toTitle(filename);
						blog.emit('add', title);
					}
					else if (result == upsertResult.UPDATE) {
						var title = keyManager.toTitle(filename);
						blog.emit('update', title);
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
					blog.emit('remove', filename);
				});
				
				callback(null);
			});
		});
	});
}

//Connection methods.
blog.configure = function(config) {
	//selectively overwrite default config properties. this way the user
	//only needs to override what's necessary.
	for (prop in config) {
		if (config[prop]) {
			cfg[prop] = config[prop];
		}
	}
}

blog.open = function(directory) {
	if (open === true || ready === true) {
		throw new Error('reed already open on ' + dir);
	}

	if (typeof directory !== 'string') {
		throw new Error('Must specify directory to read from');
	}

	dir = directory;
	
	redis.open(cfg, function(err, success) {
		if (err) return blog.emit('error', err);
		
		fsh = new FilesystemHelper(directory);
		initDirectory(function(err) {
			if (err) return blog.emit('error', err);
			watch();
			open = true;
			ready = true;
			
			//handle any queued method calls.
			queue.forEach(function(queuedCall) {
				queuedCall();
			});
			
			queue = [];
			blog.emit('ready');
		});
	});
}

blog.close = function() {
	if (!open || !ready) {
		throw new Error('reed is not open.');
	}
	
	redis.close();
	watcher.clear();
	ready = false;
	open = false;
	queue = [];
}

//Data manipulation methods.
blog.get = function(title, callback) {
	if (!open) return queue.push(function() {
		blog.get(title, callback);
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

blog.getMetadata = function(title, callback) {
	if (!open) return queue.push(function() {
		blog.getMetadata(title, callback);
	});
	
	blog.get(title, function(err, metadata, post) {
		if (err) return callback(err);
		callback(null, metadata);
	});
}

blog.all = function(callback) {
	if (!open) return queue.push(function() {
		blog.all(callback);
	});
	
	blog.list(function(err, titles) {
		if (err) return callback(err);
		
		//create the series to load all posts asyncly in order.
		var getAllPosts = [];
		titles.forEach(function(title) {
			getAllPosts.push(function(cb) {
				blog.get(title, function(err, metadata, htmlContent) {
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

blog.list = function(callback) {
	if (!open) return queue.push(function() {
		blog.list(callback);
	});
	
	redis.listPosts(function(err, titles) {
		if (err) return callback(err);
		callback(null, titles);
	});
}

blog.remove = function(title, callback) {
	if (!open) return queue.push(function() {
		blog.remove(title, callback);
	});
	
	redis.removePostByTitle(title, function(err, filename) {
		if (err) return callback(err);
		
		fsh.remove(filename, function(err) {
			if (err) return callback(err);
			callback(null);
		});
	});
}

blog.removeAll = function(callback) {
	if (!open) return queue.push(function() {
		blog.removeAll(callback);
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
blog.index = function(callback) {
	console.log('index is deprecated and will be removed in the next version.');
}

blog.refresh = function() {
	console.log('refresh is deprecated and will be removed in the next version.');
}

//The module itself is an event-based object.
module.exports = blog;
