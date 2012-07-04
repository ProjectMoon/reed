var	redis = require('redis'),
	path = require('path'),
	async = require('async'),
	fileProcessor = require('./file-processor'),
	ru = require('./reed-util');

//the redis client
var client;
var connections = 0;

var keyManager = {
	toPostKeyFromFilename: function(filename) {
		if (!ru.startsWith(filename, 'blog:')) {
			return 'blog:' + filename;		
		}
		else {
			return filename;
		}
	},
	
	toPagesKeyFromFilename: function(filename) {
		if (!ru.startsWith(filename, 'page:')) {
			return 'page:' + filename;
		}
		else {
			return filename;
		}
	},
	
	toPostFilenameFromTitle: function(title, callback) {
		client.get('blogpointer:' + title, function(err, key) {
			if (err) return callback(err);
			callback(null, key);
		});
	},
	
	toPageFilenameFromTitle: function(title, callback) {
		client.get('pagepointer:' + title, function(err, key) {
			if (err) return callback(err);
			callback(null, key);
		});		
	},
	
	toTitle: function(filename) {
		var ext = path.extname(filename);
		var title = path.basename(filename, ext);
		return title;
	},
	
	toPostPointer: function(filename) {
		return 'blogpointer:' + keyManager.toTitle(filename);
	},
	
	toPagesPointer: function(filename) {
		return 'pagepointer:' + keyManager.toTitle(filename);
	}
};

//Misc exports
exports.upsertResult = {
	UPDATE: 0,
	NEW: 1,
	NONE: 2
};

exports.keyManager = keyManager;

/*
 * Open a connection to redis.
 * 
 * cfg - the configuration to use.
 * callback - callback receives (error, success). success is true if the connection was
 *            opened or is already open.
 */
exports.open = function(cfg, callback) {
	connections++;
	//already open?
	if (typeof client !== 'undefined') {
		process.nextTick(function() {
			callback(false);
		});
	}
	
	client = redis.createClient(cfg.port, cfg.host);

	//authentication may cause redis to fail
	//this ensures we see the problem if it occurs
	client.on('error', function(errMsg) {
		callback(errMsg);
	});
		
	if (cfg.password) {
		//if we are to auth we need to wait on callback before
		//starting to do work against redis
		client.auth(cfg.password, function (err) {
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

exports.close = function() {
	connections--;
	
	if (connections == 0) {
		client.quit();
	}
}

exports.listPosts = function(callback) {
	client.zrevrange("blog:dates", 0, -1, function(err, titles) {
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
		client.sadd('blog:index', filename, function(err) {
			client.zadd('blog:dates', postDate, title, function(err) {
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
			
			client.zrem('blog:dates', title, function(err) {
				if (err) return callback(err);
				
				client.srem('blog:index', filename, function(err) {
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
		tran.del('blog:dates');
		tran.del('blog:index');
		tran.del('blog:newindex');
		
		//Need to acquire all of the post filenames asyncly from redis,
		//so use the async library to (readably) get them all into the multi.
		var tasks = [];		
		titles.forEach(function(title) {
			tasks.push(function(cb) {
				keyManager.toPostFilenameFromTitle(title, function(err, filename) {
					var key = keyManager.toPagesKeyFromFilename(filename);
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
			client.sadd('blog:newindex', value, cb);
		});
	});

	async.parallel(t1, function(err) {
		if (err) return callback(err);
		
		client.sdiff('blog:index', 'blog:newindex', function(err, removedFilenames) {
			if (err) return callback(err);
			
			//remove all deleted keys from the index and system.
			removedFilenames.forEach(function(filename) {
				t2.push(function(cb) {
					exports.removePost(filename, function(err) {
						if (err) cb(err);
						client.srem('blog:index', filename, cb);
					});
				});
			});
			
			async.parallel(t2, function(err) {
				if (err) return callback(err);
				
				client.del('blog:newindex', function(err) {
					if (err) return callback(err);
					callback(null, removedFilenames);
				});
			});
		});
	});
}

/*
 * Pages methods
 */
exports.getPageFilenameForTitle = function(title, callback) {
	keyManager.toPageFilenameFromTitle(title, function(err, filename) {
		if (err) return callback(err);
		callback(null, filename);
	});
}

exports.getPage = function(title, callback) {
	keyManager.toPageFilenameFromTitle(title, function(err, filename) {
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
				
				callback(null, metadata, hash.post);
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
		client.sadd('pages:index', filename, function(err) {
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

exports.removePage = function(title, callback) {
	var ptr = keyManager.toPagesPointer(filename);
	var key = keyManager.toPagesKeyFromFilename(filename);
	var title = keyManager.toTitle(filename);

	client.del(ptr, function(err) {
		if (err) return callback(err);
		
		client.del(key, function(err) {
			if (err) return callback(err);
			
			client.srem('pages:index', filename, function(err) {
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
			client.sadd('pages:newindex', value, cb);
		});
	});

	async.parallel(t1, function(err) {
		if (err) return callback(err);
		
		client.sdiff('pages:index', 'pages:newindex', function(err, removedFilenames) {
			if (err) return callback(err);
			
			//remove all deleted keys from the index and system.
			removedFilenames.forEach(function(filename) {
				t2.push(function(cb) {
					exports.removePage(filename, function(err) {
						if (err) cb(err);
						client.srem('pages:index', filename, cb);
					});
				});
			});
			
			async.parallel(t2, function(err) {
				if (err) return callback(err);
				
				client.del('pages:newindex', function(err) {
					if (err) return callback(err);
					callback(null, removedFilenames);
				});
			});
		});
	});
}
