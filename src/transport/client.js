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
}

util.inherits(Client, events.EventEmitter)

/**
 * @abstract
 * @param {Object} response
 */
Client.prototype.send = function() { throw new Error('Not implemented yet') }


module.exports = Client
