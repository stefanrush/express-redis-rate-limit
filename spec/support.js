var chai = require('chai');

chai.config.includeStack = true;

global.expect = chai.expect;

global.request = require('supertest');
