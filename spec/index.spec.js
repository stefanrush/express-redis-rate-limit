var async = require('async'),
    mockApp = require('./mock/app'),
    mockCache = require('./mock/cache'),
    helpers = require('./helpers');

var OK = 200,
    RL = 429,
    CN = 9;

describe('ExpressRedisRateLimit', function() {
	it("survives stress test", function(done) {
		this.timeout(5000);

		var options = { requestLimit: 150 },
		    cache = mockCache(CN),
		    app = mockApp(cache, options),
		    requestCount = 0,
		    totalRequests = 300,
		    requestInterval = 5,
		    statusCode;

		async.whilst(function() {
			return requestCount < totalRequests;
		}, function(next) {
			statusCode = ++requestCount <= options.requestLimit ? OK : RL;
			setTimeout(function() {
				request(app)
					.get('/items')
					.expect(statusCode, next);
			}, requestInterval);
		}, function(error) {
			if (error) throw error;
			helpers.flushCache(cache, done);
		});
	});

	describe('options', function() {
		describe('.requestLimit', function() {
			it("should limit number of requests to its value", function(done) {
				var requestLimitTests = [1, 5, 10, 25];

				async.eachSeries(requestLimitTests, function(test, next) {
					var options = { requestLimit: test },
					    cache = mockCache(CN),
					    app = mockApp(cache, options),
					    requestCount = 0,
					    requestInterval = 10,
					    statusCode;

					async.whilst(function() {
						return requestCount <= test;
					}, function(nextRequest) {
						setTimeout(function() {
							statusCode = ++requestCount <= test ? OK : RL;
							request(app)
								.get('/items')
								.expect(statusCode, nextRequest);
						}, requestInterval);
					}, function(error) {
						if (error) throw error;
						helpers.flushCache(cache, next);
					});
				}, done);
			});
		});

		describe('.enforceRequestSpreading', function() {
			it("ensures requests are spread evenly throughout time window", function(done) {
				var enforceRequestSpreadingTests = [false, true];

				async.eachSeries(enforceRequestSpreadingTests, function(test, next) {
					var options = { requestLimit: 10, enforceRequestSpreading: test },
					    cache = mockCache(CN),
					    app = mockApp(cache, options),
					    requestCount = 0,
					    totalRequests = 9,
					    requestInterval = 10,
					    statusCode;

					async.whilst(function() {
						return requestCount <= totalRequests;
					}, function(nextRequest) {
						setTimeout(function() {
							statusCode = (++requestCount > 1 && test) ? RL : OK;
							request(app)
								.get('/items')
								.expect(statusCode, nextRequest);
						}, requestInterval);
					}, function(error) {
						if (error) throw error;
						helpers.flushCache(cache, next);
					});
				}, done);
			});
		});

		describe('.idMatcher', function() {
			it("should replace matching IDs in request keys", function(done) {
				var idMatcherTests = [
					{ matcher: false, includeAlphas: false },
					{ matcher: /\d+$/, includeAlphas: false },
					{ matcher: /[A-Z0-9]{20}$/, includeAlphas: true }
				];

				async.eachSeries(idMatcherTests, function(test, next) {
					var options = { requestLimit: 10, idMatcher: test.matcher },
					    cache = mockCache(CN),
					    app = mockApp(cache, options),
					    requestCount = 0,
					    totalRequests = 15,
					    requestInterval = 10,
					    statusCode,
					    id;

					async.whilst(function() {
						return requestCount <= totalRequests;
					}, function(nextRequest) {
						id = helpers.randomString(20, test.includeAlphas);
						
						requestCount++;

						if (options.idMatcher) {
							statusCode = requestCount <= options.requestLimit ? OK : RL;
						} else {
							statusCode = OK;
						}

						request(app)
							.get('/items/' + id)
							.expect(statusCode, nextRequest);
					}, function(error) {
						if (error) throw error;
						helpers.flushCache(cache, next);
					});
				}, done);
			});
		});

		describe('.rateLimitMessage()', function() {
			it("creates a custom rate limit message", function(done) {
				var rateLimitMessageTests = [
					function(ttl) { return { wait: ttl } },
					{ message: "Exceeded rate limit." }
				];

				async.eachSeries(rateLimitMessageTests, function(test, next) {
					var options = { requestLimit: 10, rateLimitMessage: test },
					    cache = mockCache(CN),
					    app = mockApp(cache, options),
					    requestCount = 0,
					    totalRequests = 15,
					    requestInterval = 10,
					    statusCode;

					async.whilst(function() {
						return requestCount <= totalRequests;
					}, function(nextRequest) {
						setTimeout(function() {
							statusCode = ++requestCount <= options.requestLimit ? OK : RL;
							request(app)
								.get('/items')
								.expect(statusCode)
								.expect(function(res) {
									if (statusCode === RL) {
										if (typeof test === 'function') {
											expect(res.body).to.have.key('wait');
											expect(res.body.wait).to.be.a('number');
										} else {
											expect(res.body).to.have.key('message');
											expect(res.body.message).to.a('string');
										}
									}
								}).end(nextRequest);
						}, requestInterval);
					}, function(error) {
						if (error) throw error;
						helpers.flushCache(cache, next);
					});
				}, done);
			});
		});
	});

	describe('headers', function() {
		describe('X-RateLimit-Limit', function() {
			it("equals the maximum number of requests allowed", function(done) {
				var options = { requestLimit: 10 },
				    cache = mockCache(CN),
				    app = mockApp(cache, options);

				request(app)
					.get('/items')
					.expect('X-RateLimit-Limit', options.requestLimit)
					.end(function() {
						helpers.flushCache(cache, done);
					});
			});
		});

		describe('X-RateLimit-Remaining', function() {
			it("equals the remaining number of requests allowed", function(done) {
				var options = { requestLimit: 10 },
				    cache = mockCache(CN),
				    app = mockApp(cache, options),
				    requestCount = 0,
				    totalRequests = 15,
				    remainingRequests;

				async.whilst(function() {
					return requestCount <= totalRequests;
				}, function(next) {
					remainingRequests = options.requestLimit - ++requestCount;
					if (remainingRequests < 0) remainingRequests = 0;
					request(app)
						.get('/items')
						.expect('X-RateLimit-Remaining', remainingRequests)
						.end(next);
				}, function(error) {
					if (error) throw error;
					helpers.flushCache(cache, done);
				});
			});
		});

		describe('X-RateLimit-Window', function() {
			it("equals the total length of the time window", function(done) {
				var options = { timeWindow: 10 },
				    cache = mockCache(CN),
				    app = mockApp(cache, options);

				request(app)
					.get('/items')
					.expect('X-RateLimit-Window', options.timeWindow)
					.end(function() {
						helpers.flushCache(cache, done);
					});
			});
		});

		describe('X-RateLimit-Reset', function() {
			it("equals the time remaining within time window", function(done) {
				var options = { timeWindow: 10 },
				    cache = mockCache(CN),
				    app = mockApp(cache, options),
				    requestCount = 0,
				    totalRequests = 15,
				    requestInterval = 10,
				    resetHeader,
				    previousReset;

				async.whilst(function() {
					return requestCount <= totalRequests;
				}, function(next) {
					setTimeout(function() {
						requestCount++;
						request(app)
							.get('/items')
							.expect(function(res) {
								resetHeader = parseInt(res.get('X-RateLimit-Reset'), 10);
								if (requestCount <= 1) {
									expect(resetHeader).to.eq(options.timeWindow * 1000);
								} else {
									expect(resetHeader).to.be.lt(previousReset);
								}
								previousReset = resetHeader;
							}).end(next);
						}, requestInterval);
				}, function(error) {
					if (error) throw error;
					helpers.flushCache(cache, done);
				});
			});
		});
	});
});
