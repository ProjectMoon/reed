var	redis = require('redis');

var connections = 0;

//The redis connection.
var client;
var open = false;

exports.open = function(cfg, callback) {
	connections++;
	//already open?
	if (typeof client !== 'undefined' && open) {
		process.nextTick(function() {
			callback(null, client);
		});
	}
	
	client = redis.createClient(cfg.port, cfg.host);
	open = true;

	//authentication may cause redis to fail
	//this ensures we see the problem if it occurs
	client.on('error', function(errMsg) {
		connections--;
		open = false;
		callback(errMsg);
	});
		
	if (cfg.password) {
		//if we are to auth we need to wait on callback before
		//starting to do work against redis
		client.auth(cfg.password, function (err) {
			if (err) return callback(err);
			callback(null, client);
		});
		
	}
	else {
		//no auth, just start
		process.nextTick(function() {
			callback(null, client);
		});
	}
}

exports.close = function() {
	connections--;
	
	if (connections == 0) {
		client.quit();
		open = false;
	}
}
