var	async = require('async'),
	conn = require('./redis-connection'),
	fileProcessor = require('./file-processor'),
	keyManager = require('./keymanager').KeyManager;

//the redis client
var client;

exports.open = function(cfg, callback) {
	keyManager.open(cfg, function(err) {
		if (err) return callback(err, false);
		conn.open(cfg, function(err, redisClient) {
			if (err) return callback(err, false);
			client = redisClient;
			callback(err, false);
		});
	});
}

exports.close = function() {
	conn.close();
	keyManager.close();
}

exports.getPageFilenameForTitle = function(title, callback) {
	keyManager.toPagesFilenameFromTitle(title, function(err, filename) {
		if (err) return callback(err);
		callback(null, filename);
	});
}

exports.getPage = function(title, callback) {
	keyManager.toPagesFilenameFromTitle(title, function(err, filename) {
		if (err) return callback(err);
		exports.getPageByFilename(filename, callback);
	});
}

exports.getPageByFilename = function(filename, callback) {
	var key = keyManager.toPagesKeyFromFilename(filename);
	
	client.hgetall(key, function(err, hash) {
		if (typeof(hash) !== 'undefined' && hash != null && Object.keys(hash).length > 0) {
			var post = hash.post;
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
				
				callback(null, true, metadata, hash.post);
			}
		}
		else {
			callback(new Error('Page not found: ' + filename), false);
		}
	});
}

exports.insertPage = function(filename, callback) {
	fileProcessor.process(filename, function(err, postDate, metadata, post) {
		if (err) return callback(err);	
		
		var ptr = keyManager.toPagesPointer(filename);
		var key = keyManager.toPagesKeyFromFilename(filename);
		var title = keyManager.toTitle(filename);
		
		metadataString = JSON.stringify(metadata);
		client.sadd(keyManager.pagesIndex, filename, function(err) {
			client.set(ptr, filename, function(err) {
				client.hset(key, 'metadata', metadataString, function() {
					client.hset(key, 'post', post, callback);
				});
			});
		});	
	});
}

exports.updatePage = function(filename, callback) {
	exports.insertPage(filename, callback);
}

exports.removePage = function(filename, callback) {
	var ptr = keyManager.toPagesPointer(filename);
	var key = keyManager.toPagesKeyFromFilename(filename);
	var title = keyManager.toTitle(filename);

	client.del(ptr, function(err) {
		if (err) return callback(err);
		
		client.del(key, function(err) {
			if (err) return callback(err);
			
			client.srem(keyManager.pagesIndex, filename, function(err) {
				if (err) return callback(err);
				callback(null, filename);
			});
		});
	});
}

exports.cleanupPages = function(newIndex, callback) {
	var t1 = [], t2 = [];
	
	//create a temporary "new index" set in redis.
	newIndex.forEach(function(value) {
		t1.push(function(cb) {
			client.sadd(keyManager.pagesNewIndex, value, cb);
		});
	});

	async.parallel(t1, function(err) {
		if (err) return callback(err);
		
		client.sdiff(keyManager.pagesIndex, keyManager.pagesNewIndex, function(err, removedFilenames) {
			if (err) return callback(err);
			
			//remove all deleted keys from the index and system.
			removedFilenames.forEach(function(filename) {
				t2.push(function(cb) {
					exports.removePage(filename, function(err) {
						if (err) cb(err);
						client.srem(keyManager.pagesIndex, filename, cb);
					});
				});
			});
			
			async.parallel(t2, function(err) {
				if (err) return callback(err);
				
				client.del(keyManager.pagesNewIndex, function(err) {
					if (err) return callback(err);
					callback(null, removedFilenames);
				});
			});
		});
	});
}
