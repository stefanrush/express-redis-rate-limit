/**
 * @module express-redis-rate-limit
 * @license MIT
 * @author Stefan Rush
 */

/**
 * Module dependencies.
 * @private
 */
var async = require('async'),
    defaults = require('lodash/object/defaults'),
    pluralize = require('pluralize'),
    debug = require('debug')('er-ratelimit');

/**
 * Module exports.
 * @exports express-redis-rate-limit
 */
module.exports = ExpressRedisRateLimit;

/**
 * Rate limit middleware for express using redis in-memory store.
 * @class ExpressRedisRateLimit
 * @param {Object} cache - An instance of a redis client (ie. node_redis). It must be
 *        connected.
 * @param {Object} [options] - The configuration options. Defaults to 60 requests/minute.
 * @param {Integer} [options.requestLimit=60] - The number of requests allowed within time
 *        window.
 * @param {Number} [options.timeWindow=60] - The time frame for request limit in seconds.
 * @param {Regexp|Boolean} [options.idMatcher=/[a-z0-9]{24}$/] - A regular expression to
 *        match IDs within request. Set to false to stop behavior. Defaults to a MongoDB
 *        document ID matcher.
 * @param {String} [options.idValue=':id'] - A string to replace ID regexp matches.
 * @param {function} [options.createKey] - A function for creating cache keys. Accepts
 *        express request object.
 * @param {function|Object} [options.rateLimitMessage] - A function or object for creating
 *        rate limit response message objects. Functions accept TTL integer representing
 *        milliseconds until next request is allowed. A sensible default is provided.
 * @param {Object} [options.internalErrorMessage] - An object returned in the event of an
 *        error. A sensible default is provided.
 * @returns {function} The rate limit middleware.
 * @public
 */
function ExpressRedisRateLimit(cache, options) {
	var defaultOptions = {
		requestLimit: 60,
		timeWindow: 60,
		idMatcher: /[a-z0-9]{24}$/,
		idValue: ':id',
		createKey: function(req) {
			return 'RL/' + req.ip + '/' + req.method + req.url;
		},
		rateLimitMessage: function(ttl) {
			return {
				error: {
					message: "Rate limit reached. Try again in " + secondsHuman(ttl) + ".",
					timeout: ttl,
					type: 'RATE_LIMIT'
				}
			};
		},
		internalErrorMessage: {
			error: {
				message: "Internal server error.",
				type: 'INTERNAL_SERVER_ERROR'
			}
		}
	};

	/**
	 * Override default options with valid user options.
	 */
	options = defaults(validateOptions(options), defaultOptions);

	return rateLimit;

	/**
	 * The rate limit middleware. Renders rate limit message when limit is reached.
	 * Otherwise calls done to let request through.
	 * @param {Object} req - The express request object.
	 * @param {Object} res - The express response object.
	 * @param {function} done - The express next callback function.
	 * @memberof ExpressRedisRateLimit
	 */
	function rateLimit(req, res, done) {
		var key = replaceID(options.createKey(req));

		debug("    key: " + key);

		/**
		 * Process request and catch errors should one occur.
		 */
		async.waterfall([
			checkRequestExists,
			getRequestCount,
			getRequestTTL,
			incrRequestCount,
			setRequestTTL
		], rateLimitGate);

		/**
		 * Performs check for existence key in cache and passes result to next.
		 * @param {function} next - The callback function.
		 * @memberof ExpressRedisRateLimit
		 */
		function checkRequestExists(next) {
			cache.exists(key, function(error, reply) {
				if (error) next(error);
				next(null, !!parseInt(reply, 10));
			});
		}

		/**
		 * Retrieves and passes request count for key from cache when key exists. Otherwise
		 * passes 1 to next.
		 * @param {Boolean} exists - True when request key exists in database.
		 * @param {function} next - The callback function.
		 * @memberof ExpressRedisRateLimit
		 */
		function getRequestCount(exists, next) {
			debug(" exists: " + exists);

			if (exists) {
				cache.get(key, function(error, reply) {
					if (error) next(error);
					next(null, exists, parseInt(reply, 10) + 1);
				});
			} else {
				next(null, exists, 1);
			}
		}

		/**
		 * Retrieves and passes request time to live in milliseconds when key exists.
		 * Otherwise passes time limit as TTL. Also passes count.
		 * @param {Boolean} exists - True when request key exists in database.
		 * @param {Integer} count - The number of requests within time limit.
		 * @param {function} next - The callback function.
		 * @memberof ExpressRedisRateLimit
		 */
		function getRequestTTL(exists, count, next) {
			debug("  count: " + count);
			
			if (exists) {
				cache.pttl(key, function(error, reply) {
					if (error) next(error);
					next(null, count, parseInt(reply, 10));
				});
			} else {
				next(null, count, options.timeWindow * 1000);
			}
		}

		/**
		 * Increments request count if under request limit. Always passes TTL and at request
		 * limit boolean. 
		 * @param {Integer} count - The number of requests within time limit.
		 * @param {Integer} ttl - The time to live for request key in milliseconds.
		 * @param {function} next - The callback function.
		 * @memberof ExpressRedisRateLimit
		 */
		function incrRequestCount(count, ttl, next) {
			debug("    ttl: " + ttl);
			
			var atLimit = count > options.requestLimit;
			
			if (atLimit) {
				next(null, count, ttl, atLimit);
			} else {
				cache.incr(key, function(error, reply) {
					if (error) next(error);
					next(null, count, ttl, atLimit);
				});
			}
		}

		/**
		 * Sets request key TTL unless at limit. Always passes TTL and at request limit
		 * boolean.
		 * @param {Integer} count - The number of requests within time limit.
		 * @param {Integer} ttl - The time to live for request key in milliseconds.
		 * @param {Boolean} atLimit - True when rate limit is reached.
		 * @param {function} next - The callback function.
		 * @memberof ExpressRedisRateLimit
		 */
		function setRequestTTL(count, ttl, atLimit, next) {
			debug("atLimit: " + atLimit);
			
			if (atLimit) {
				next(null, count, ttl, atLimit);
			} else {
				cache.pexpire(key, ttl, function(error, reply) {
					if (error) next(error);
					next(null, count, ttl, atLimit);
				});
			}
		}

		/**
		 * Renders rate limit JSON if rate limit is reached. Otherwise lets request through.
		 * Also renders 500 error if should one occur.
		 * @param {Object} [error] - An error caught during async waterfall.
		 * @param {Integer} count - The number of requests within time limit.
		 * @param {Integer} ttl - The time to live for request key in milliseconds.
		 * @param {Boolean} atLimit - True when rate limit is reached.
		 * @memberof ExpressRedisRateLimit
		 */
		function rateLimitGate(error, count, ttl, atLimit) {
			if (error) {
				debug(error);
				return res.status(500).json(options.internalErrorMessage);
			}

			setRateLimitHeaders(count, ttl, atLimit);

			if (atLimit) {
				var responseJSON = typeof options.rateLimitMessage === 'function' ?
				                   options.rateLimitMessage(ttl) :
				                   options.rateLimitMessage;
				res.status(429).json(responseJSON);
			} else {
				done();
			}
		}

		/**
		 * Sets X-RateLimit headers for response.
		 * X-RateLimit-Limit - The maximum number of requests allowed within time window.
		 * X-RateLimit-Remaining - The remaining number of requests allowed within time
		 *                         window.
		 * X-RateLimit-Window - The total length of the time window in milliseconds.
		 * X-RateLimit-Reset - The length of time remaining within time window in
		 *                     milliseconds.
		 * @param {Integer} count - The number of requests within time limit.
		 * @param {Integer} ttl - The time to live for request key in milliseconds.
		 * @param {Boolean} atLimit - True when rate limit is reached.
		 * @memberof ExpressRedisRateLimit
		 */
		function setRateLimitHeaders(count, ttl, atLimit) {
			res.set({
				'X-RateLimit-Limit': options.requestLimit,
				'X-RateLimit-Remaining': requestsRemaining(count),
				'X-RateLimit-Window': options.timeWindow * 1000,
				'X-RateLimit-Reset': ttl
			});
		}

		/**
		 * Returns number of requests remaining within time window.
		 * @param {Integer} count - The number of requests within time limit.
		 * @memberof ExpressRedisRateLimit
		 */
		function requestsRemaining(count) {
			var remaining = options.requestLimit - count;
			if (remaining < 0) remaining = 0;
			return remaining;
		}

		/**
		 * Replaces IDs matching idMatcher in a request key with idValue. Returns key as-is
		 * if this option is disabled.
		 * @param {String} key - A request key.
		 * @returns {String} Valid configuration options.
		 * @memberof ExpressRedisRateLimit
		 */
		function replaceID(key) {
			if (options.idMatcher && options.idValue) {
				key = key.replace(options.idMatcher, options.idValue);
			}
			return key;
		}
	}
		
	/**
	 * Ensures validate configuation options by throwing errors on invalid options.
	 * @param {Object} options - The configuration options.
	 * @returns {Object} Valid configuration options.
	 * @memberof ExpressRedisRateLimit
	 */
	function validateOptions(options) {
		if (!options) return {};

		if (typeof options !== 'object') {
			throw new Error("Options must be an object.");
		}

		if (options.requestLimit && !(typeof options.requestLimit === 'number' &&
		                              options.requestLimit > 0)) {
			throw new Error("Request limit option must be a positive number.");
		}

		if (options.timeWindow && !(typeof options.timeWindow === 'number' &&
		                            options.timeWindow > 0)) {
			throw new Error("Time window option must be a positive number.");
		}

		if (options.idMatcher && typeof options.idMatcher !== 'object') {
			throw new Error("ID matcher option must be a regular expression.");
		}

		if (options.idMatcher && options.idValue && typeof options.idValue !== 'string') {
			throw new Error("ID value option must be a string.");
		}

		if (options.createKey && typeof options.createKey !== 'function') {
			throw new Error("Create key option must be a function.");
		}

		if (options.rateLimitMessage && !(typeof options.rateLimitMessage === 'function' ||
		                                  typeof options.rateLimitMessage === 'object')) {
			throw new Error("Rate limit message option must be a function or an object.");
		}

		if (options.internalErrorMessage &&
		    typeof options.internalErrorMessage !== 'object') {
			throw new Error("Internal error message option must be an object.");
		}

		return options;
	}

	/**
	 * Converts millisecond integer into human readable seconds string.
	 * @param {Integer} ms - A length of time in milliseconds.
	 * @returns {String} A human readable seconds string.
	 * @memberof ExpressRedisRateLimit
	 */
	function secondsHuman(ms) {
		return pluralize('second', Math.ceil(ms / 1000), true);
	}
}
