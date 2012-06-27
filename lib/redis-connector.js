var	redis = require('redis');

//the redis client
var client;


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

function redisPostInsert(key, date, metadata, post, callback) {
	metadataString = JSON.stringify(metadata);
	client.zadd("blog:dates", date, key, function(err) {
		client.hset(key, "metadata", metadataString, function() {
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
	var key = toPagesKey(title);
		
	client.del(key, function(err) {
		if (err) {
			callback(err);
		}
		else {
			callback(null);
		}
	});
}

/*
 * Open a connection to redis.
 * 
 * cfg - the configuration to use.
 * callback - callback receives (error, success). success is true if the connection was
 *            opened or is already open.
 */
exports.open = function(cfg, callback) {
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
	
	//only take the props we are interested in. this way the user can specify only
	//host or only port, leaving the rest as defaults.
	for (prop in redisConf) {
		if (cfg[prop]) {
			redisConf[prop] = cfg[prop];
		}
	}
	
	client = redis.createClient(redisConf.port, redisConf.host);

	//authentication may cause redis to fail
	//this ensures we see the problem if it occurs
	client.on('error', function(errMsg) {
		callback(errMsg);
	});
		
	if (redisConf.password) {
		//if we are to auth we need to wait on callback before
		//starting to do work against redis
		client.auth(redisConf.password, function (err) {
			if (err) return callback(err);
			callback(null, true);
		});
		
	}
	else {
		//no auth, just start
		process.nextTick(function() {
			callback(null, true);
		});
	}
}

exports.insertPost = function(filename, callback) {
	fileProcessor.process(filename, function(err, metadata, post) {
		if (err) return callback(err);
		
		var key = toPostKey(filename);
		redisPostInsert(key, metadata, post, function(err) {
			if (err) return callback(err);
			callback(null);
		});
	});
}
