var express = require('express'),
    rateLimit = require('../..');

module.exports = mockApp;

function mockApp(cache, options) {
	var app = express();

	app.use(rateLimit(cache, options));

	app.get('/items', function(req, res, next) {
		res.json({ message: "Item Index" });
	});

	app.get('/items/:id', function(req, res, next) {
		res.json({ message: "Item " + req.params.id });
	});

	return app;
}
