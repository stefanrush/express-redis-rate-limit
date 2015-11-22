var redis = require('redis');

module.exports = mockCache;

function mockCache(number) {
	var cache = redis.createClient();

	cache.select(number || 0);

	cache.flushall();

	return cache;
}
