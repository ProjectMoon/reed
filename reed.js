var fs = require("fs"),
	redis = require("redis"),
	md = require("node-markdown").Markdown;

//the redis client.
var client;

//directory to look for markdown files in.
//can be changed by exports.open
var dir = __dirname; 

function endsWith(str, text) {
	return str.substr(-text.length) == text;
}

function redisInsert(key, date, processedData, post, callback) {
	processedData = JSON.stringify(processedData);
	client.zadd("blog:dates", date, key, function() {
		client.hset(key, "metadata", processedData, function() {
			client.hset(key, "post", post, callback);
		});
	});
}

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

var watched = {};
function loadFromFilesystem(filename, callback) {
	fs.readFile(filename, function(err, data) {
		if (typeof(data) !== "undefined") {
			var processed = preProcess(data.toString());
			var post = md(processed.markdown);
			
			var postDate = fs.statSync(filename).mtime.getTime();
			processed.lastModified = postDate;
			
			redisInsert("blog:" + filename, postDate, processed, post, function() {
				if (typeof callback !== "undefined")
					callback(null, processed, post);
			});
			
			if (watched[filename] !== true) {
				watched[filename] = true;
				fs.watchFile(filename, function(curr, prev) {
					loadFromFilesystem(filename);
				});
			}
		}
		else {
			if (typeof callback !== "undefined")
				callback(err);
		}
	});
}

exports.get = function(title, callback) {
	//convert to key/filename
	var filename = title.replace(" ", "-");
	filename += ".md";
	
	var key = "blog:" + filename;
	
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

exports.index = function(callback) {
	fs.readdir(dir, function(err, files) {
		if (typeof(files) !== "undefined") {
			var mdFilter = function(el, i, arr) {
				return endsWith(el, ".md");
			}
			
			var c = 0;
			files = files.filter(mdFilter);
			files.forEach(function(file) {
				loadFromFilesystem(file, function(err) {
					if (err != null) {
						console.log("indexing error: " + err);
					}
					else {
						if (c + 1 == files.length) {
							if (typeof(callback) !== "undefined") 
								callback();
							return;
						}
						
						c++;
					}
				});
			});
		}
	});
}

exports.list = function(callback) {
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

exports.open = function(directory) {
	if (typeof(directory) === "string") {
		dir = directory;
	}
	
	client = redis.createClient();
}

exports.close = function() {
	client.quit();
	
	for (file in watched) {
		if (watched[file] === true) {
			fs.unwatchFile(file);	
		}
	}
	
	watched = {};
}
