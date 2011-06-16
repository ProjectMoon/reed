reed
====

A Markdown-based blogging core backed by Redis and the filesystem.

Features:

* Asynchronously turn all markdown (.md) files in a directory into a blog
  stored in the hyper-fast Redis database.
* Files are watched for changes and the Redis store is automatically updated.
* Transparently access Redis or the filesystem to find a blog post.

In the works:

* Comments

What is reed?
-------------
Reed is a (very) lightweight blogging **core** that turns markdown files in a
directory into a blog. It is **not** a fully featured blogging system. If you
are looking for that, check out Wheat or another blog engine.

Reed is intended for developers who want to integrate simple blogging
functionality into their node.js website or application. It makes as little
assumptions as possible about your environment in order to give maximum
flexibility.

How to use reed
----------------
First, install it:
`npm install reed`

Make sure Redis is also installed and running. Currently, reed only supports the
basic (non-authenticated) model for Redis. After Redis and reed are installed,
use it thus:
```js
var reed = require("reed");
reed.open(); //looks for .md files in "." by default.

reed.index(function() {
	reed.list(function(posts) {
		console.log(posts);
		reed.close();
	});
});
```

In the above example, .md files will be pulled out of the current directory and
indexed into the Redis database by the `index` function. After having indexed
them, we can `list` the titles in order of post/updated date (that is, last
modified date).

To retrieve an individual post and its associated metadata, use the `get`
function:
```js
reed.get("First Post", function(err, metadata, htmlContent) {
	console.log(JSON.stringify(metadata);
	console.log(htmlContent);
});
```

If retrieval of the post was successful, `err` will be null. `metadata` will be
an object containing a `markdown` property that stores the original markdown
text, a `lastModified` property that stores the last modified date as UNIX
epoch time, plus any user-defined information (see below). `htmlContent` will be
the post content, converted from markdown to HTML.

If the post could not be retrieved, `err` will be an object containing error
information (exactly what depends on the error thrown), and other two objects
will be `undefined`.

Note that the `get` function will hit the Redis database first, and then look
on the filesystem for a title. So, if you have a new post that has not yet
been indexed, it will get automagically added to the index via `get`.

### Article Naming and Metadata ###
Every article in the blog is a markdown file in the specified directory. The
filename is considered the "id" or "slug" of the article, and must be named
accordingly. Reed article ids must have no spaces. Instead, spaces are mapped
from `-`s:

> "the first post" -> the-first-post.md

#### Metadata ####
Like Wheat, articles support user-defined metadata at the top of the article.
These take the form of simple headers. They are transferred into the metadata
object as properties.

the-first-post.md:
```
Title: The First Post
Author: me
SomeOtherField: 123skidoo
```

The headers will be accessible thus:

* metadata.title
* metadata.author
* metadata.someotherfield

Field names can only alphabetical characters. So, "Some-Other-Field" is not a
valid article header.
