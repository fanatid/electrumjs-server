var dns = require('dns')
var inherits = require('util').inherits

var config = require('config')
var irc = require('irc')
var _ = require('lodash')
var Q = require('q')

var IRCClient = require('./ircclient')
var electrumVersion = require('../version').interface.electrum
var logger = require('../logger').logger

var namesMap = { http: 'h', https: 'g', tcp: 't', ssl: 's', ws: 'w', wss: 'v' }
var portsMap = { h: 8081, g: 8082, t: 50001, s: 50002, w: 8783, v: 8886 }


function getRealName() {
  var realName = config.get('electrum.irc.reportHost') + ' v' + electrumVersion + ' '

  config.get('electrum.transport').forEach(function(transport) {
    var letter = namesMap[transport.type]

    if (!_.isUndefined(letter)) {
      if (portsMap[letter] === transport.port)
        realName += letter + ' '
      else
        realName += letter + transport.port + ' '
    }
  })

  return realName
}


/**
 * @event ElectrumIRCClient#addPeer
 * @type {Object}
 * @property {string} nick
 * @property {string} address
 * @property {string} host
 * @property {string} ports
 */

/**
 * @event ElectrumIRCClient#removePeer
 * @type {Object}
 * @property {string} nick
 */

/**
 * @class ElectrumIRCClient
 */
function ElectrumIRCClient() {
  IRCClient.call(this)

  this._isInialized = false

  // not throw exception, already validated in blockchain
  switch (config.get('server.network')) {
    case 'bitcoin':
      this.nickPrefix = 'E_'
      break

    case 'testnet':
      this.nickPrefix = 'ET_'
      break

    case 'litecoin':
      this.nickPrefix = 'EL_'
      break

    case 'litecoin_testnet':
      this.nickPrefix = 'ELT_'
      break
  }

  var nickName = this.nickPrefix + config.get('electrum.irc.nick')
  var channel = '#electrum'
  if (this.nickPrefix === 'EL_' || this.nickPrefix === 'ELT_')
    channel = '#electrum-ltc'

  this.client = new irc.Client('irc.freenode.net', nickName, {
    realName: getRealName(),
    port: 6667,
    autoConnect: false,
    channels: [channel]
  })
}

inherits(ElectrumIRCClient, IRCClient)

/**
 * @return {Q.Promise}
 */
ElectrumIRCClient.prototype.initialize = function() {
  var self = this
  if (self._isInialized)
    return Q()

  self._isInialized = true

  var deferred = Q.defer()

  self.client.connect()

  self.client.on('registered', function() {
    logger.info('Electrum IRC connected')
    deferred.resolve()
  })

  self.client.on('names#electrum', function(nicks) {
    Object.keys(nicks).forEach(function(nick) {
      if (nick.indexOf(self.nickPrefix) === 0)
        self.client.send('WHO', nick)
    })
  })

  self.client.on('join#electrum', function(nick) {
    if (nick.indexOf(self.nickPrefix) === 0)
      self.client.send('WHO', nick)
  })

  self.client.on('quit', function(nick) {
    self.emit('removePeer', { nick: nick })
  })

  self.client.on('kick#electrum', function(nick) {
    self.emit('removePeer', { nick: nick })
  })

  self.client.on('raw', function(message) {
    if (message.command !== 'rpl_whoreply')
      return

    var items = (message.args[7] || '').split(' ')
    dns.resolve(items[1], function(error, addresses) {
      if (error || addresses.length === 0) {
        logger.warn('dns.resolve address: %s | %s', addresses.toString(), error.stack)
        return
      }

      self.emit('addPeer', {
        nick: message.args[5],
        address: addresses[0],
        host: items[1],
        ports: items.slice(2)
      })
    })
  })

  self.client.on('error', function(error) {
    logger.error('ElectrumIRC error: %s', error.stack)
    deferred.reject(error)
  })

  return deferred.promise
}


module.exports = ElectrumIRCClient
