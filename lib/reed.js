var fs = require("fs"),
	path = require("path"),
	util = require("util"),
	events = require("events"),
	redis = require("redis"),
	async = require("async"),
	md = require("node-markdown").Markdown;

//singleton to enable events.
//user code interacts with it through exports.on method.
function Reed() { }
util.inherits(Reed, events.EventEmitter);

var reed = new Reed();

//the config object.
var cfg;

//the redis client.
var client;

//directory to look for markdown files in.
//set by exports.open and exports.pages.open
var dir;
var pagesDir;

//if we are open, further calls to open() will be rejected.
//if we are ready, allow calls to the methods.
var open = false;
var ready = false;
var pagesOpen = false;
var pagesReady = false;

function endsWith(str, text) {
	return str.substr(-text.length) === text;
	return str.substr(-text.length) === text;
}

function startsWith(str, text) {
	return str.substr(0, text.length) === text;
}

function redisInsert(key, date, processedData, post, callback) {
	processedData = JSON.stringify(processedData);
	client.zadd("blog:dates", date, key, function(err) {
		if (startsWith(key, "blog:") == false) {
			key = "blog:" + key;
		}
		client.hset(key, "metadata", processedData, function() {
			client.hset(key, "post", post, callback);
		});
	});
}

function redisPageInsert(key, date, processedData, post, callback) {
	processedData = JSON.stringify(processedData);
	
	if (startsWith(key, "page:") == false) {
		key = "page:" + key;
	}
	
	client.hset(key, "metadata", processedData, function() {
		client.hset(key, "post", post, callback);
	});
}

function redisDelete(title, callback) {
	var filename = toFilename(title);
	var key = toKey(title);
	
	client.del(key, function(err) {
		if (err) { callback(err); return; }
		client.zrem("blog:dates", filename, function(err) {
			if (err) {
				callback(err);
			}
			else {
				callback(null);
			}
		});
	});
}

function redisPageDelete(title, callback) {
	var key = toKey(title);
		
	client.del(key, function(err) {
		if (err) {
			callback(err);
		}
		else {
			callback(null);
		}
	});
}

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

function readMarkdown(directory, callback) {
	fs.readdir(directory, function(err, files) {
		if (typeof files === "undefined") {
			callback(err);
			return;
		}
		
		files = files.filter(function(el, i, arr) {
			return endsWith(el, ".md");
		});
		
		callback(null, files);
	});
}

function loadFromFilesystem(filename, callback) {
	fs.readFile(filename, function(err, data) {
		if (typeof(data) === "undefined") {
			if (typeof callback !== "undefined") callback(err);
			return;
		}
		
		var metadata = preProcess(data.toString());
		metadata.id = toID(filename);
		var post = md(metadata.markdown);
		
		var postDate = fs.statSync(filename).mtime.getTime();
		metadata.lastModified = postDate;
		
		redisInsert(filename, postDate, metadata, post, function() {
			if (watched[filename] !== true) {
				reed.emit("add", metadata, post);
			}
			
			watch(filename);
			
			if (typeof callback !== "undefined")
				callback(null, metadata, post);
		});		
	});
}

function loadPageFromFilesystem(filename, callback) {
	fs.readFile(filename, function(err, data) {
		if (typeof(data) === "undefined") {
			if (typeof callback !== "undefined") callback(err);
			return;
		}
		
		var metadata = preProcess(data.toString());
		metadata.id = toID(filename);
		var post = md(metadata.markdown);
		
		var postDate = fs.statSync(filename).mtime.getTime();
		metadata.lastModified = postDate;
		
		redisPageInsert(filename, postDate, metadata, post, function() {
			metadata.lastModified = new Date(metadata.lastModified);
			if (watched[filename] !== true) {
				reed.emit("addPage", metadata, post);
			}
			
			watchPage(filename);
			
			if (typeof callback !== "undefined")
				callback(null, metadata, post);
		});		
	});
}

var watched = {};
function watch(filename) {
	if (watched[filename] !== true) {
		watched[filename] = true;
		fs.watchFile(filename, function(curr, prev) {
			var exists = path.existsSync(filename);
			
			if (exists) {
				loadFromFilesystem(filename, function(err, metadata, htmlContent) {
					if (err != null) {
						reed.emit("error", err);
					}
					else {
						reed.emit("update", metadata, htmlContent);
					}
				});
			}
			else {
				redisDelete(filename, function(err) {
					delete watched[filename];
					fs.unwatchFile(filename);
					
					if (err) {
						reed.emit("error", err);
					}
					else {
						reed.emit("remove", filename);
					}
				});
			}
		});
	}
}

var watchedPages = {};
function watchPage(filename) {
	if (watchedPages[filename] !== true) {
		watchedPages[filename] = true;
		fs.watchFile(filename, function(curr, prev) {
			var exists = path.existsSync(filename);
			
			if (exists) {
				loadPageFromFilesystem(filename, function(err, metadata, htmlContent) {
					if (err != null) {
						reed.emit("error", err);
					}
					else {
						reed.emit("updatePage", metadata, htmlContent);
					}
				});
			}
			else {
				redisPageDelete(filename, function(err) {
					delete watched[filename];
					fs.unwatchFile(filename);
					
					if (err) {
						reed.emit("error", err);
					}
					else {
						reed.emit("removePage", filename);
					}
				});	
				}
		});
	}
}

function findNewFiles(firstTime) {
	readMarkdown(dir, function(err, files) {
		if (typeof files === "undefined") {
			reed.emit("error", err);
			return;
		}
		
		//if the directory is empty, we are automatically ready.
		if (files.length === 0) {
			ready = true;
			reed.emit("ready");
		}
			
		var c = 0;
		files.forEach(function(file) {
			file = toFilename(file);
			if (watched[file] !== true) {
				//new file?
				reed.getMetadata(file, function(err, md) {
					if (err != null) {
						reed.emit("error", err);
						return;
					}
					
					fs.stat(file, function(err, stats) {
						if (err != null) {
							reed.emit("error", err);
							return;
						}
						
						if (md.lastModified !== stats.mtime.getTime()) {
							//new file!
							loadFromFilesystem(file, function(err) {
								if (err != null) {
									reed.emit("error", err);
								}
								
								//emit ready event if we are done.
								if (firstTime && c + 1 === files.length) {
									ready = true;
									reed.emit("ready");
								}
								c++;
							});
						}
						else {
							watch(file);
							//emit ready event if we are done.
							if (firstTime && c + 1 === files.length) {
								ready = true;
								reed.emit("ready");
							}
							c++;
						}
					});
				});
			}
		}); //end foreach
	});
}

function toFilename(title) {
	var filename = title.replace(" ", "-");
	if (!endsWith(filename, ".md")) filename += ".md";
	if (!startsWith(filename, dir)) filename = dir + "/" + filename;
	return filename;
}

function toKey(title) {
	var filename = toFilename(title);
	return "blog:" + filename;
}

function toPagesFilename(title) {
	var filename = title.replace(" ", "-");
	if (!endsWith(filename, ".md")) filename += ".md";
	if (!startsWith(filename, pagesDir)) filename = pagesDir + "/" + filename;
	return filename;
}

function toPagesKey(title) {
	var filename = toPagesFilename(title);
	return "page:" + filename;
}

function toID(filename) {
	var start = filename.lastIndexOf("/") + 1;
	var id = filename.substring(start, filename.length - 3);
	return id;
}

function readyCheck(fn, args) {
	if (ready) {
		return true;
	}
	else {
		process.nextTick(function() {
			fn.apply(module, args);
		});
		
		return false;
	}
}

function pagesReadyCheck(fn, args) {
	if (pagesReady) {
		return true;
	}
	else {
		process.nextTick(function() {
			fn.apply(module, args);
		});
		
		return false;
	}
}

function openRedis(callback) {
	//already open?
	if (typeof client !== 'undefined') {
		process.nextTick(function() {
			callback(false);
		});
	}
	
	//declare all props that we want for redis
	var redisConf = {
		host: '127.0.0.1',
		port: 6379,
		password: null
	};
	
	if (cfg) {
		//only take the props we are interested in
		//this way the user can specify only
		//host or only port leaving the rest
		// as defaults
		for (prop in redisConf) {
			if (cfg[prop]) {
				redisConf[prop] = cfg[prop];
			}
		}
	}
	
	client = redis.createClient(redisConf.port, redisConf.host);

	//authentication may cause redis to fail
	//this ensures we see the problem if it occurs
	client.on('error', function(errMsg) {
		reed.emit('error', errMsg);
	});
		
	if (redisConf.password) {
		//if we are to auth we need to wait on callback before
		//starting to do work against redis
		client.auth(redisConf.password, function (err) {
			if (err) return reed.emit('error', err);
			callback(true);
		});
		
	}
	else {
		//no auth, just start
		process.nextTick(function() {
			callback(true);
		});
	}
}

reed.getMetadata = function(title, callback) {
	//convert to key/filename
	var filename = toFilename(title);
	var key = toKey(title);
		
	//first hit redis
	client.hget(key, "metadata", function(err, metadata) {
		try {
			metadata = JSON.parse(metadata);
		} 
		catch (parseErr) {
			//if we can't understand it we don't want it
			metadata = {};
		}
		if (typeof(metadata) !== "undefined" && metadata != null && Object.keys(metadata).length > 0) {
			if (typeof callback !== "undefined")
				callback(null, metadata);
		}
		else {
			//now hit filesystem.
			loadFromFilesystem(filename, callback);
		}
	});
}

reed.get = function get(title, callback) {
	if (!readyCheck(get, arguments)) return;
	
	//convert to key/filename
	var filename = toFilename(title);
	var key = toKey(title);
	
	//first hit redis
	client.hgetall(key, function(err, hash) {
		var post = hash.post;
		if (typeof(hash) !== "undefined" && Object.keys(hash).length > 0) {
			if (typeof callback !== "undefined") {
				var metadata = {};
				try {
					metadata = JSON.parse(hash.metadata);
				} 
				catch (parseErr) {
					//no good metadata - ignore
				}
				callback(null, metadata, hash.post);
			}
		}
		else {
			//now hit filesystem.
			loadFromFilesystem(filename, callback);
		}
	});
}

reed.index = function index(callback) {
	if (!readyCheck(index, arguments)) return;
	
	readMarkdown(dir, function(err, files) {
		if (typeof files === "undefined") {
			callback(err);
			return;
		}
		
		var mdFilter = function(el, i, arr) {
			return endsWith(el, ".md");
		}
		
		var c = 0;
		var skip = false;
		files = files.filter(mdFilter);
		for (var x = 0; x < files.length; x++) {
			if (skip) break; //probably shouldn't hit this, but who knows.
			var file = toFilename(files[x]);
			loadFromFilesystem(file, function(err) {
				if (skip) return; //SHOULD hit this though.
				if (err != null) {
					if (typeof(callback) !== "undefined") {
						skip = true;
						callback(err);
						return;
					}
				}
				else {
					if (c + 1 == files.length) {
						if (typeof(callback) !== "undefined") 
							callback(null);
						return;
					}
					
					c++;
				}
			});
		}
	});
}

reed.list = function list(callback) {
	if (!readyCheck(list, arguments)) return;
	
	var titles = [];
	client.zrevrange("blog:dates", 0, -1, function(err, keys) {
		keys.forEach(function(key) {
			//5 = "blog:", length - 3 = ".md"
			var title = key.substring(key.lastIndexOf('/') + 1, key.length - 3); 
			title = title.replace("-", " ");
			titles.push(title);
		});
		
		if (typeof callback !== "undefined")
			callback(null, titles);
	});
}

reed.all = function(callback) {
	reed.list(function(err, titles) {
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

reed.refresh = function refresh() {
	if (!readyCheck(refresh, arguments)) return;
	
	reed.list(function(err, titles) {
		if (err) { reed.emit("error", err); return; }
		
		//create async tasks.
		//this tabular monster is jut a fully async version of what happens
		//to watched files: if the file no longer exists, it is removed from
		//redis and a remove event is emitted.
		var tasks = [];
		titles.forEach(function(title) {
			tasks.push(function(callback) {
				path.exists(toFilename(title), function(exists) {
					if (!exists) {
						redisDelete(toFilename(title), function(err) {
							if (err) {
								callback(err);
							}
							else {
								//since the file was removed when reed was
								//not running, we must emit the remove event.
								reed.emit("remove", toFilename(title));
								callback(null);
							}
						});
					}
				});
			});
		});
		
		async.parallel(tasks, function(err) {
			if (err) {
				reed.emit("error", err);
			}
		});
	});
}

reed.remove = function remove(title, callback) {
	if (!readyCheck(remove, arguments)) return;
	
	var key = toKey(title);
	var filename = toFilename(title);
	redisDelete(key, function(err) {
		if (err) { callback(err); return; }
		fs.unlink(filename, function(unlinkErr) {
			//no need to emit a remove event here because
			//the file watching emits it for us when the
			//file is deleted.
			callback(unlinkErr);
		});
	});
}

reed.removeAll = function removeAll(callback) {
	if (!readyCheck(removeAll, arguments)) return;
	
	function delegate(key) {
		return function(callback) {
			client.del(key, function(err) {
				if (err != null) callback(err);
				else callback(null);
			});
		}
	}
	
	var funcs = [];
	for (file in watched) {
		funcs.push(delegate(toKey(file)));
	}
	
	funcs.push(delegate("blog:dates"));
	
	async.waterfall(funcs, function(err) {
		if (!err && typeof callback !== 'undefined') {
			callback(null);
		}
		else if (typeof callback !== 'undefined') {
			callback(err);
		}
	});
}

reed.configure = function(config) {
	cfg = config;
}

reed.open = function(directory) {
	if (open === true || ready === true) {
		throw new Error("reed already open on " + dir);
	}
	else {
		open = true;
	}

	if (typeof(directory) !== "string") {
		throw new Error("Must specify directory to read from");
	}

	dir = directory;

	openRedis(function() {
		fs.watchFile(dir, function(curr, prev) {
			findNewFiles();
		});
		
		reed.refresh();
		
		process.nextTick(function() {
			findNewFiles(true);
		});
	});
}

reed.close = function() {
	client.quit();
	
	for (file in watched) {
		if (watched[file] === true) {
			fs.unwatchFile(file);	
		}
	}
	
	watched = {};
	fs.unwatchFile(dir);
	open = false;
	ready = false;
}

//Pages functionality
reed.pages = {};
reed.pages.open = function(directory, callback) {
	if (pagesOpen === true || pagesReady === true) {
		throw new Error("reed already open on " + dir);
	}
	else {
		pagesOpen = true;
		pagesReady = true;
	}

	if (typeof(directory) !== "string") {
		throw new Error("Must specify directory to read from");
	}

	openRedis(function() {
		pagesDir = directory;
		reed.emit("pagesReady");
		if (typeof callback == 'function') {
			callback();
		}
	});
}

reed.pages.get = function getPage(title, callback) {
	if (!pagesReadyCheck(getPage, arguments)) return;
	
	//convert to key/filename
	var filename = toPagesFilename(title);
	var key = toPagesKey(title);
	
	//first hit redis
	client.hgetall(key, function(err, hash) {
		var post = hash.post;
		if (typeof(hash) !== "undefined" && Object.keys(hash).length > 0) {
			if (typeof callback !== "undefined") {
				var metadata = {};
				try {
					metadata = JSON.parse(hash.metadata);
				} 
				catch (parseErr) {
					//no good metadata - ignore
				}
				
				if (typeof metadata.lastModified !== 'undefined') {
					metadata.lastModified = new Date(metadata.lastModified);
				}
				callback(null, metadata, hash.post);
			}
		}
		else {
			//now hit filesystem.
			loadPageFromFilesystem(filename, callback);
		}
	});
}

//Export an event emitting object that also has the various control methods
//on it.
module.exports = reed;
