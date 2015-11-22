# ExpressRedisRateLimit

Rate limit middleware for express using redis in-memory store.


## Installation

    npm i --save express-redis-rate-limit


## Usage

ExpressRedisRateLimit takes two arguments: a redis client instance and an options object.

```javascript
var express = require('express'),
    redis = require('redis').createClient(),
    rateLimit = require('express-redis-rate-limit');

var app = express();
app.use(rateLimit(redis, {
  requestLimit: 10,
  timeWindow: 30
}));
```

### Options

**requestLimit**

type=`Integer` default=`60`

The number of requests allowed within time window.

**timeWindow**

type=`Number` default=`60`

The time frame for request limit in seconds.

**idMatcher**

type=`Regexp|Boolean` default=`/[a-z0-9]{24}$/`

A regular expression to match IDs within request. Set to false to stop behavior. Defaults to a MongoDB document ID matcher.

**idValue**

type=`String` default=`':id'`

A string to replace ID regexp matches.

**createKey**

type=`function`

default=
```javascript
function(req) {
  return 'RL/' + req.ip + '/' + req.method + req.url;
}
```

A function for creating cache keys. Accepts express request object.

**rateLimitMessage**

type=`function|Object`

default=
```javascript
function(ttl) {
  return {
    error: {
      message: "Rate limit reached. Try again in " + secondsHuman(ttl) + ".",
      timeout: ttl,
      type: 'RATE_LIMIT'
    }
  };
}
```

A function or object for creating rate limit response message objects. Functions accept TTL integer representing milliseconds until next request is allowed.

**internalErrorMessage**

type=`Object`

default=
```javascript
{
  error: {
    message: "Internal server error.",
    type: 'INTERNAL_SERVER_ERROR'
  }
}
```

An object returned in the event of an error.

### Headers

**X-RateLimit-Limit** - The maximum number of requests allowed within time window.

**X-RateLimit-Remaining** - The remaining number of requests allowed within time window.

**X-RateLimit-Window** - The total length of the time window in milliseconds.

**X-RateLimit-Reset** - The length of time remaining within time window in milliseconds.


## Run Tests

    npm test
