var	util = require('util'),
	events = require('events'),
	blog = require('./blog'),
	pages = require('./pages');

//default redis configuration.	
var cfg = {
	host: '127.0.0.1',
	port: 6379,
	password: null
};

blog.configure(cfg);
pages.configure(cfg);
pages.on('error', function(err) {
	blog.emit('error', err);
});

module.exports = blog;
module.exports.pages = pages;
