module.exports = {
	randomString: function(length, includeAlphas) {
		var output = '',
		    max = includeAlphas ? 36 : 10;
		for (var n = 0; n < length; n++) {
			var char = Math.floor(Math.random() * max);
			output += char >= 10 ? String.fromCharCode(char + 55) : '' + char; 
		}
		return output;
	},
	flushCache: function(cache, callback) {
		cache.flushdb(function() {
			cache.quit(callback);
		});
	}
};
