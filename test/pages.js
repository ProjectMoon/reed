var	vows = require('vows'),
	assert = require('assert'),
	events = require('events'),
	fs = require('fs'),
	path = require('path'),
	reed = require('../lib/reed');

var dir = __dirname + '/.pages/';
vows.describe('Pages System').addBatch({
	'Open Pages,': {
		topic: function() {
			var self = this;
			reed.pages.open(dir, function(err) {
				assert.isNull(err);
				self.callback();
			});
		},
		
		'then': {
			'get a page with metadata': { 
				topic: function() {
					reed.pages.get('page', this.callback);
				},
				
				'is working correctly': function(err, metadata, htmlContent) {
					assert.isNull(err);
					assert.isNotNull(htmlContent);
					assert.isNotNull(metadata);
				},
				
				'lastModified is a date': function(err, metadata, htmlContent) {
					assert.instanceOf(metadata.lastModified, Date);
				},
				
				'post content is a string': function(err, metadata, htmlContent) {
					assert.isString(htmlContent);
				},
				
				'has metadata': function(err, metadata, htmlContent) {
					assert.isNotNull(metadata);
					assert.isObject(metadata);
				}
			},
			
			'get a page with no custom metadata': {
				topic: function() {
					reed.pages.get('nometadata', this.callback);
				},
				
				'is working correctly': function(err, metadata, htmlContent) {
					assert.isNull(err);
					assert.isNotNull(htmlContent);
					assert.isNotNull(metadata);
				},
				
				'lastModified is a date': function(err, metadata, htmlContent) {
					assert.instanceOf(metadata.lastModified, Date);
				},
				
				'post content is a string': function(err, metadata, htmlContent) {
					assert.isString(htmlContent);
				},
				
				'has metadata': function(err, metadata, htmlContent) {
					assert.isNotNull(metadata);
					assert.isObject(metadata);
				},
				
				'has no custom metadata': function(err, metadata, htmlContent) {
					var valid = true;
					for (var prop in metadata) {
						if (prop !== 'lastModified' && prop !== 'id' && prop !== 'markdown') {
							valid = false;
							break;
						}
					}
					
					assert.isTrue(valid);
				}
			},
			
			'get a non-existant page': {
				topic: function() {
					reed.pages.get('does-not-exist', this.callback);
				},
				
				'is working correctly': function(err, metadata, htmlContent) {
					assert.isNotNull(err);
					assert.isUndefined(htmlContent);
					assert.isUndefined(metadata);
				}
			},
			
			'create a new page,': {
				topic: function() {
					var self = this;
					fs.writeFile(dir + 'newpage.md', 'This is a new page', function(err) {
						if (err) return self.callback(err);
						reed.pages.get('newpage', self.callback);
					});
				},
				
				'check for errors': function(err, metadata, htmlContent) {
					assert.isNull(err);
				},
				
				'delete the page': {
					topic: function() {
						reed.pages.remove('newpage', this.callback);
					},
					
					'check for removal errors': function(err, junk) {
						assert.isNull(err);
					},
					
					'no longer on filesystem': function(err) {
						assert.isFalse(path.existsSync(dir + 'newpage.md'));
					},
					
					'check removed from reed': {
						topic: function() {
							reed.pages.get('newpage', this.callback);
						},
						
						'is working correctly': function(err, metadata, htmlContent) {
							assert.isNotNull(err);
							assert.isUndefined(htmlContent);
							assert.isUndefined(metadata);
						}
					}
				},
				
				'close pages': {
					topic: function() {
						//simply here to make sure it doesn't hang or throw
						//exceptions.
						reed.pages.close();
					}
				}
			}
		}
	},
}).export(module);
