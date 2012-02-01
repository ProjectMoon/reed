0.9.8
=====

* Fixed bug where pages API would not open unless the blog portion wasn't open.
* Fixed issue where pages would throw exceptions when creating Redis keys.
* All `lastModified` values will now be exposed as Date objects. They are still
  stored as Unix timestamp strings in Redis.
* The redis client will now only shut down if both pages and blog portions are
  closed. So, if both are open, close needs to be called on both to stop reed.
* Removed all page-related events because they did not fire in the same manner
  as the blog portion. Pages are for a different purpose than blog anyway.
* Added `reed.pages.remove` and `reed.pages.close` methods.
* Added unit tests for Pages API, using Vows.
* Added changelog file to the project to keep track of history.

0.9.6/0.9.7
===========

* Fixed a bug in would cause the library to crash if there was no metadata
  defined in articles.
* Added the ability to configure reed so that it can connect to redis running on
  different hosts/ports and use authentication. This is just a passthrough to
  the redis module's methods, so you can send in other options as well.

0.9.5
=====

* Added `reed.all` to get all posts in the system, ordered by date.
* Changed metadata properties to be camelCase instead of all lowercase.
* Clarified in readme that reed will not have comments functionality any time soon.
