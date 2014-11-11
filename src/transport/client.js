var crypto = require('crypto')
var events = require('events')
var util = require('util')

var NotImplementedError = require('../errors').NotImplementedError


/**
 * @event Client#request
 * @type {Object}
 */

/**
 * @event Client#end
 */

/**
 * @class Client
 * @extends events.EventEmitter
 */
function Client() {
  events.EventEmitter.call(this)
  this.clientId = crypto.pseudoRandomBytes(16).toString('hex')
}

util.inherits(Client, events.EventEmitter)

/**
 * @return {string}
 */
Client.prototype.getId = function () {
  return this.clientId
}

/**
 * @abstract
 * @param {Object} response
 */
Client.prototype.send = function () {
  throw new NotImplementedError('Client.send')
}


module.exports = Client
