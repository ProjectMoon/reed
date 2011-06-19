var fs = require("fs"),
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

//the redis client.
var client;

//directory to look for markdown files in.
//set by exports.open
var dir;

//if we are open, further calls to open() will be rejected.
//if we are ready, allow calls to the methods.
var open = false;
var ready = false;

function endsWith(str, text) {
	return str.substr(-text.length) == text;
}

function redisInsert(key, date, processedData, post, callback) {
	processedData = JSON.stringify(processedData);
	client.zadd("blog:dates", date, key, function(err) {
		client.hset(key, "metadata", processedData, function() {
			client.hset(key, "post", post, callback);
		});
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
		var name = match[1].toLowerCase(),
		value = match[2];
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

var watched = {};
function loadFromFilesystem(filename, callback) {
	fs.readFile(filename, function(err, data) {
		if (typeof(data) === "undefined") {
			if (typeof callback !== "undefined") callback(err);
			return;
		}
		
		var processed = preProcess(data.toString());
		var post = md(processed.markdown);
		
		var postDate = fs.statSync(filename).mtime.getTime();
		processed.lastModified = postDate;
		
		redisInsert("blog:" + filename, postDate, processed, post, function() {
			if (watched[filename] !== true) {
				reed.emit("add", processed, post);
			}
			
			watch(filename);
			
			if (typeof callback !== "undefined")
				callback(null, processed, post);
		});		
	});
}

function watch(filename) {
	if (watched[filename] !== true) {
		watched[filename] = true;
		fs.watchFile(filename, function(curr, prev) {
			loadFromFilesystem(filename, function(err, metadata, htmlContent) {
				if (err != null) {
					reed.emit("error", err);
				}
				else {
					reed.emit("update", metadata, htmlContent);
				}
			});
		});
	}
}

function findNewFiles(firstTime) {
	readMarkdown(dir, function(err, files) {
		if (typeof files === "undefined") {
			reed.emit("error", err);
			return;
		}
		
		var c = 0;
		files.forEach(function(file) {
			if (watched[file] !== true) {
				//new file?
				file = toFilename(file);
				reed.getMetadata(file, function(err, md) {
					fs.stat(file, function(err, stats) {
						if (err != null) {
							reed.emit("error", err);
							return;
						}
						
						if (md.lastModified !== stats.mtime.getTime()) {
							//new file!
							loadFromFilesystem(file, function(err) {
								if (err != null) {
									console.log("add error: " + err);
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
	filename = dir + "/" + filename;
	return filename;	
}

function toKey(title) {
	var filename = title.replace(" ", "-");
	if (!endsWith(filename, ".md")) filename += ".md";
	return "blog:" + filename;
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

reed.getMetadata = function(title, callback) {
	//convert to key/filename
	var filename = toFilename(title);
	var key = toKey(title);
	
	//first hit redis
	client.hget(key, "metadata", function(err, metadata) {
		metadata = JSON.parse(metadata);
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
			if (typeof callback !== "undefined")
				callback(null, JSON.parse(hash.metadata), hash.post);
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
			var file = files[x];
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
			var title = key.substring(5, key.length - 3); 
			title = title.replace("-", " ");
			titles.push(title);
		});
		
		if (typeof callback !== "undefined")
			callback(null, titles);
	});
}

reed.remove = function remove(title, callback) {
	if (!readyCheck(remove, arguments)) return;
	
	var key = toKey(title);
	client.del(key, function(err) {
		client.zrem("blog:dates", key, function(err) {
			callback(null);
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
		if (!err) {
			callback(null);
		}
		else {
			callback(err);
		}
	});
}

reed.open = function(directory) {
	if (open === true) {
		throw new Error("reed already open on " + dir);
	}
	else {
		open = true;
	}

	if (typeof(directory) !== "string") {
		throw new Error("Must specify directory to read from");
	}

	dir = directory;
	client = redis.createClient();
	
	fs.watchFile(dir, function(curr, prev) {
		findNewFiles();
	});
	
	process.nextTick(function() {
		findNewFiles(true);
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

//Export an event emitting object that also has the various control methods
//on it.
module.exports = reed;
