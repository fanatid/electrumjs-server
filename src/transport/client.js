var crypto = require('crypto')
var events = require('events')
var util = require('util')


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
 * @abstract
 * @param {Object} response
 */
Client.prototype.send = function() { throw new Error('Not implemented yet') }

/**
 * @return {string}
 */
Client.prototype.getId = function() {
	return this.clientId
}


module.exports = Client
