var	redis = require('./redis-connector');

//singleton to enable events.
//user code interacts with it through exports.on method.
function ReedPages() { }
util.inherits(ReedPages, events.EventEmitter);

var pages = new ReedPages();

//states
var open = false;
var ready = false;

//methods queued because the connection isn't open
var queue = [];

pages.open = function(directory, callback) {
	if (open === true || ready === true) {
		throw new Error('reed pages already open on ' + dir);
	}

	if (typeof directory !== 'string') {
		throw new Error('Must specify directory to read from');
	}
	
	redis.open(function(err) {
		if (err) return callback(err);
		
		open = true;
		ready = true;
		
		queue.forEach(function(queuedMethod) {
			queuedMethod();
		});
		
		queue = [];
		callback(null);
	});
}

pages.close = function() {
	if (!open || !ready) {
		throw new Error('reed pages is not open.');
	}
	
	redis.close();
	open = false;
	ready = false;
	queue = [];
}

pages.get = function(title, callback) {
	if (!open) return queue.push(function() {
		pages.get(title, callback);
	});
	
	redis.getPage(title, function(err, found, metadata, page) {
		if (err) return callback(err);
		if (found) {
			callback (null, metadata, page);
		}
		else {
			callback(new Error('Could not find page: ' + title));
		}
	});
}

pages.remove = function(title, callback) {
	if (!open) return queue.push(function() {
		pages.remove(title, callback);
	});
	
	redis.removePage(title, function(err) {
		callback(err);
	});
}
