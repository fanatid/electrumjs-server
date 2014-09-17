var events = require('events')
var inherits = require('util').inherits


/**
 * @event IRCClient#addPeer
 * @type {Object}
 */

/**
 * @event IRCClient#removePeer
 * @type {Object}
 */

/**
 * @class IRCClient
 */
function IRCClient() {
  events.EventEmitter.call(this)
}

inherits(IRCClient, events.EventEmitter)

/**
 * @return {Q.Promise}
 */
IRCClient.prototype.initialize = function() {}


module.exports = IRCClient
