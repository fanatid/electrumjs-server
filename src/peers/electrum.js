var dns = require('dns')
var inherits = require('util').inherits

var config = require('config')
var irc = require('irc')
var Q = require('q')

var IRCClient = require('./ircclient')
var electrumVersion = require('../version').interface.electrum


function getRealName() {
  var realName = config.get('electrum.irc.reportHost') + ' v' + electrumVersion + ' '

  function addPort(letter, number) {
    if ({'t':'50001', 's':'50002', 'h':'8081', 'g':'8082'}[letter] === number)
      realName += letter + ' '
    else
      realName += letter + number + ' '
  }

  config.get('electrum.transport').forEach(function(transport) {
    switch (transport.type) {
      case 'tcp':
        addPort('t', transport.port)
        break
      case 'tcpSSL':
        addPort('s', transport.port)
        break
      case 'http':
        addPort('h', transport.port)
        break
      case 'httpSSL':
        addPort('g', transport.port)
        break
      default:
        break
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
    console.log('Electrum IRC connected')
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
        console.error('dns.resolve error: ', error, '(addresses: ' + addresses + ')')
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
    console.error('ElectrumIRC error:', error)
    deferred.reject(error)
  })

  return deferred.promise
}


module.exports = ElectrumIRCClient
