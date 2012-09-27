var	async = require('async'),
	conn = require('./redis-connection'),
	fileProcessor = require('./file-processor'),
	keyManager = require('./keymanager').KeyManager;

//the redis client
var client;

//constants
exports.upsertResult = {
	UPDATE: 0,
	NEW: 1,
	NONE: 2
};

/*
 * Open a connection to redis.
 * 
 * cfg - the configuration to use.
 * callback - callback receives (error, success). success is true if the connection was
 *            opened or is already open.
 */
exports.open = function(cfg, callback) {
	keyManager.open(cfg, function(err) {
		if (err) return callback(err);
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

exports.listPosts = function(callback) {
	client.zrevrange(keyManager.blogDates, 0, -1, function(err, titles) {
		if (err) return callback(err);
		callback(null, titles);
	});
}

exports.getPost = function(title, callback) {
	keyManager.toPostFilenameFromTitle(title, function(err, filename) {
		if (err) return callback(err);
		if (filename == null) return callback(new Error('Post not found: ' + title));
		exports.getPostByFilename(filename, callback);
	});
}

exports.getPostByFilename = function(filename, callback) {
	var key = keyManager.toPostKeyFromFilename(filename);
	
	client.hgetall(key, function(err, hash) {
		if (typeof hash !== "undefined" && hash != null && Object.keys(hash).length > 0) {
			var post = hash.post;
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
		else {
			callback(new Error('Post not found: ' + filename), false);
		}
	});	
}

exports.insertPost = function(filename, callback) {
	fileProcessor.process(filename, function(err, postDate, metadata, post) {
		if (err) return callback(err);	
		
		var ptr = keyManager.toPostPointer(filename);
		var key = keyManager.toPostKeyFromFilename(filename);
		var title = keyManager.toTitle(filename);
		
		metadataString = JSON.stringify(metadata);
		client.sadd(keyManager.blogIndex, filename, function(err) {
			client.zadd(keyManager.blogDates, postDate, title, function(err) {
				client.set(ptr, filename, function(err) {
					client.hset(key, 'metadata', metadataString, function() {
						client.hset(key, 'post', post, callback);
					});
				});
			});
		});
	});
}

exports.upsertPost = function(filename, callback) {
	var returnValue;
	exports.getPostByFilename(filename, function(err, found, metadata, post) {
		if (found) {
			//compare last modified times.
			fileProcessor.getLastModified(filename, function(err, lastModified) {
				if (err) return callback(err);
				
				if (lastModified.getTime() > metadata.lastModified.getTime()) {
					exports.updatePost(filename, function(err) {
						if (err) return callback(err);
						callback(null, exports.upsertResult.UPDATE);
					});
				}
				else {
					//no need to do anything at all.
					process.nextTick(function() {
						callback(null, exports.upsertResult.NONE);
					});
				}
			});
		}
		else {
			//brand new.
			exports.insertPost(filename, function(err) {
				if (err) return callback(err);
				callback(null, exports.upsertResult.NEW);
			});
		}
	});
}

exports.updatePost = function(filename, callback) {
	//for now this can delegate to insert since redis does insert/overwrite.
	//might need it later if there need to be special rules for updates.
	exports.insertPost(filename, callback);
}

exports.removePost = function(filename, callback) {
	var ptr = keyManager.toPostPointer(filename);
	var key = keyManager.toPostKeyFromFilename(filename);
	var title = keyManager.toTitle(filename);

	client.del(ptr, function(err) {
		if (err) return callback(err);
		
		client.del(key, function(err) {
			if (err) return callback(err);
			
			client.zrem(keyManager.blogDates, title, function(err) {
				if (err) return callback(err);
				
				client.srem(keyManager.blogIndex, filename, function(err) {
					if (err) return callback(err);
					callback(null, filename);
				});
			});
		});
	});
}

exports.removePostByTitle = function(title, callback) {
	keyManager.toPostFilenameFromTitle(title, function(err, filename) {
		if (err) return callback(err);
		exports.removePost(filename, callback);
	});
}

exports.removeAllPosts = function(callback) {
	exports.listPosts(function(err, titles) {
		if (err) return callback(err);
		
		//stuff that's easy to delete.
		var tran = client.multi();
		tran.del(keyManager.blogDates);
		tran.del(keyManager.blogIndex);
		tran.del(keyManager.blogNewIndex);
		
		//Need to acquire all of the post filenames asyncly from redis,
		//so use the async library to (readably) get them all into the multi.
		var tasks = [];		
		titles.forEach(function(title) {
			tasks.push(function(cb) {
				keyManager.toPostFilenameFromTitle(title, function(err, filename) {
					var key = keyManager.toPostKeyFromFilename(filename);
					var ptr = keyManager.toPostPointer(filename);
					tran.del(key);
					tran.del(ptr);
					cb(err);
				});
			});
		});
		
		async.parallel(tasks, function(err) {
			if (err) return callback(err);
			tran.exec(function(err, replies) {
				if (err) return callback(err);
				callback(null);
			});
		});
	});
}

exports.cleanup = function(newIndex, callback) {
	var t1 = [], t2 = [];
	
	//create a temporary "new index" set in redis.
	newIndex.forEach(function(value) {
		t1.push(function(cb) {
			client.sadd(keyManager.blogNewIndex, value, cb);
		});
	});

	async.parallel(t1, function(err) {
		if (err) return callback(err);
		
		client.sdiff(keyManager.blogIndex, keyManager.blogNewIndex, function(err, removedFilenames) {
			if (err) return callback(err);
			
			//remove all deleted keys from the index and system.
			removedFilenames.forEach(function(filename) {
				t2.push(function(cb) {
					exports.removePost(filename, function(err) {
						if (err) cb(err);
						client.srem(keyManager.blogIndex, filename, cb);
					});
				});
			});
			
			async.parallel(t2, function(err) {
				if (err) return callback(err);
				
				client.del(keyManager.blogNewIndex, function(err) {
					if (err) return callback(err);
					callback(null, removedFilenames);
				});
			});
		});
	});
}
