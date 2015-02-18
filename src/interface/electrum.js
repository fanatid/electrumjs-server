// jscs:disable requireCamelCaseOrUpperCaseIdentifiers
var inherits = require('util').inherits

var config = require('config')
var _ = require('lodash')
var Q = require('q')

var Interface = require('./interface')
var logger = require('../logger').logger
var ElectrumIRCClient = require('../peers/electrum')
var http = require('../transport/http')
var tcp = require('../transport/tcp')
var ws = require('../transport/ws')
var util = require('../util')

var electrumVersion = require('../version').interface.electrum
var serverBanner = (config.get('electrum.banner') || '').replace(/\\n/g, '\n')
var serverDonationAddress = config.get('electrum.donationAddress') || ''


/**
 * @class Electrum
 * @extends Interface
 * @param {Blockchain} blockchain
 */
function Electrum(blockchain) {
  Interface.call(this)

  this._isInialized = false

  this.blockchain = blockchain
  this.subscribers = {
    numblocks: {},
    headers: {},
    address: {},
    clientAddresses: {},
    peers: {}
  }
  this.peers = {}
}

inherits(Electrum, Interface)

/**
 * @return {Q.Promise}
 */
Electrum.prototype.initialize = function () {
  var self = this
  if (self._isInialized) { return Q() }

  self._isInialized = true

  self.blockchain.on('newHeight', function (newHeight) {
    var numblocksMsg = {id: null, method: 'blockchain.numblocks.subscribe', params: [newHeight]}
    self.broadcastMessage(_.values(self.subscribers.numblocks), numblocksMsg)

    var newHeader = self.blockchain.getHeader(newHeight)
    var headersMsg = {id: null, method: 'blockchain.headers.subscribe', params: [newHeader]}
    self.broadcastMessage(_.values(self.subscribers.headers), headersMsg)
  })

  self.blockchain.on('touchedAddress', function (address) {
    if (_.isUndefined(self.subscribers.address[address])) { return }

    self.getAddressStatus(address).then(function (status) {
      var addressMsg = {id: null, method: 'blockchain.address.subscribe', params: [address, status]}
      self.broadcastMessage(_.values(self.subscribers.address[address]), addressMsg)

    }).catch(function (error) {
      logger.error('Electrum.getAddressStatus error: %s', error.stack)

    })
  })

  var promises = config.get('electrum.transport').map(function (transport) {
    switch (transport.type) {
      case 'http':
        return new http.HTTPTransport(self, transport.port, transport.host).initialize()

      case 'tcp':
        return new tcp.TCPTransport(self, transport.port, transport.host).initialize()

      case 'ws':
        return new ws.WSTransport(self, transport.port, transport.host).initialize()

      default:
        throw new Error('Unknow transport: ', transport)
    }
  })

  if (config.get('electrum.irc.active') === 'yes') {
    var irc = new ElectrumIRCClient()
    var ircPromise = irc.initialize().then(function () {
      function broadcastPeerEvent(eventName, peerNick) {
        var peerMsg = {
          id: null,
          method: 'server.peers.subscribe',
          params: [eventName, self.peers[peerNick]]
        }
        self.broadcastMessage(_.values(self.subscribers.peers), peerMsg)
      }

      irc.on('addPeer', function (peer) {
        self.peers[peer.nick] = [peer.address, peer.host, peer.ports]
        broadcastPeerEvent('add', peer.nick)
      })

      irc.on('removePeer', function (peer) {
        broadcastPeerEvent('remove', peer.nick)
        delete self.peers[peer.nick]
      })
    })
    promises.push(ircPromise)
  }

  return Q.all(promises).then(function () {
    logger.info('Electrum interface ready')
  })
}

/**
 * @param {Client[]} clients
 * @param {Object} message
 * @param {?number} message.id
 * @param {string} message.method
 * @param {*[]} message.params
 */
Electrum.prototype.broadcastMessage = function (clients, message) {
  clients.forEach(function (client) { client.send(message) })
}

/**
 * @param {Client} client
 */
Electrum.prototype.newClient = function (client) {
  var self = this

  client.on('request', function (request) { self.newRequest(client, request)})
  client.once('end', function () {
    var clientId = client.getId()

    delete self.subscribers.numblocks[clientId]
    delete self.subscribers.headers[clientId]
    var clientAddresses = self.subscribers.clientAddresses[clientId] || []
    clientAddresses.forEach(function (addr) {
      delete self.subscribers.address[addr][clientId]
      if (Object.keys(self.subscribers.address[addr]).length === 0) {
        delete self.subscribers.address[addr]
      }
    })
    delete self.subscribers.clientAddresses[clientId]
    delete self.subscribers.peers[clientId]
  })
}

/**
 * @param {Client} client
 * @param {Object} request
 */
Electrum.prototype.newRequest = function (client, request) {
  var self = this

  var requestId = request.id
  var method = request.method
  var params = request.params

  /** check vital fields */
  if (_.isUndefined(requestId) || _.isUndefined(method)) {
    client.send({error: 'syntax error', request: request})
    return
  }

  /** process */
  Q.spawn(function* requestProcess() {
    try {
      var result

      switch (method) {
        case 'blockchain.numblocks.subscribe':
          result = self.blockchain.getBlockCount() - 1
          self.subscribers.numblocks[client.getId()] = client
          break

        case 'blockchain.headers.subscribe':
          var height = self.blockchain.getBlockCount() - 1
          result = self.blockchain.getHeader(height)
          self.subscribers.headers[client.getId()] = client
          break

        case 'blockchain.address.subscribe':
          result = yield self.getAddressStatus(params[0])

          var subscription = self.subscribers.address[params[0]]
          if (_.isUndefined(subscription)) { subscription = {} }
          subscription[client.getId()] = client
          self.subscribers.address[params[0]] = subscription

          var addresses = self.subscribers.clientAddresses[client.getId()]
          if (_.isUndefined(addresses)) { addresses = [] }
          if (addresses.indexOf(params[0]) === -1) { addresses.push(params[0]) }
          self.subscribers.clientAddresses[client.getId()] = addresses

          break

        case 'blockchain.address.get_history':
          result = yield self.getHistory(params[0])
          break

        case 'blockchain.address.get_mempool':
          throw new Error('Not implemented yet')

        case 'blockchain.address.get_balance':
          result = yield self.getBalance(params[0])
          break

        case 'blockchain.address.get_proof':
          throw new Error('Not implemented yet')

        case 'blockchain.address.listunspent':
          result = yield self.getUnspentCoins(params[0])
          break

        case 'blockchain.utxo.get_address':
          result = yield self.blockchain.getAddresses(params[0], parseInt(params[1], 10))
          result = result.length > 0 ? result[0] : null
          break

        case 'blockchain.block.get_header':
          result = yield self.getHeader(parseInt(params[0], 10))
          break

        case 'blockchain.block.get_chunk':
          result = self.blockchain.getChunk(parseInt(params[0], 10))
          break

        case 'blockchain.transaction.broadcast':
          result = yield self.blockchain.sendRawTx(params[0])
          break

        case 'blockchain.transaction.get_merkle':
          result = yield self.getMerkle(params[0], parseInt(params[1], 10))
          break

        case 'blockchain.transaction.get':
          result = yield self.blockchain.getRawTx(params[0])
          break

        case 'blockchain.estimatefee':
          result = yield self.blockchain.estimatefee(parseInt(params[0], 10))
          break

        case 'server.banner':
          result = serverBanner
          break

        case 'server.donation_address':
          result = serverDonationAddress
          break

        case 'server.peers.subscribe':
          result = _.values(self.peers)
          //self.subscribers.peers[client.getId()] = client
          break

        case 'server.version':
          result = electrumVersion
          break

        default:
          throw new Error('Unknow method: ' + method)
      }

      client.send({id: requestId, result: result})

    } catch (error) {
      logger.error('Electrum.newRequest error: %s\nraw request: %s',
        error.stack, JSON.stringify(request))

      client.send({id: requestId, error: error.message})
    }
  })
}

/**
 * @param {string} address
 * @return {Q.Promise}
 */
Electrum.prototype.getAddressStatus = function (address) {
  return this.getHistory(address).then(function (history) {
    var status = history.map(function (entry) {
      return entry.tx_hash + ':' + entry.height + ':'
    }).join('')

    return util.sha256(status).toString('hex')
  })
}

/**
 * @param {string} address
 * @return {Q.Promise}
 */
Electrum.prototype.getHistory = function (address) {
  return this.blockchain.getCoins(address).then(function (coins) {
    return _.chain(coins)
      .map(function (coin) {
        var result = [[coin.cTxId, coin.cHeight]]
        if (coin.sTxId !== null) { result.push([coin.sTxId, coin.sHeight]) }
        return result
      })
      .flatten(true)
      .uniq(function (o) { return o[0] + o[1] })
      .sortBy(function (o) { return o[1] === 0 ? Infinity : o[1] })
      .map(function (o) { return {tx_hash: o[0], height: o[1]} })
      .value()
  })
}

/**
 * @param {string} address
 * @return {Q.Promise}
 */
Electrum.prototype.getBalance = function (address) {
  return this.blockchain.getCoins(address).then(function (coins) {
    var result = {confirmed: 0, unconfirmed: 0}

    coins.forEach(function (coin) {
      // confirmed and not spend
      if (coin.cHeight !== 0 && coin.sHeight === null) {
        result.confirmed += coin.cValue
        return
      }

      // confirmed and spend not confirmed
      if (coin.cHeight !== 0 && coin.sHeight === 0) {
        result.unconfirmed -= coin.cValue
        return
      }

      // unconfirmed and not spend
      if (coin.cHeight === 0 && coin.sHeight === null) {
        result.unconfirmed += coin.cValue
        return
      }
    })

    return result
  })
}

/**
 * @param {string} address
 * @return {Q.Promise}
 */
Electrum.prototype.getUnspentCoins = function (address) {
  return this.blockchain.getCoins(address).then(function (coins) {
    // Not full electrum compatibility.. but it's right
    //coins = coins.filter(function(coin) { return coin.cHeight !== 0 && coin.sTxId === null })
    coins = coins.filter(function (coin) { return coin.sTxId === null })
    coins = coins.map(function (coin) {
      return {tx_hash: coin.cTxId, tx_pos: coin.cIndex, value: coin.cValue, height: coin.cHeight}
    })
    return coins
  })
}

/**
 * @param {number} height
 * @return {Q.Promise}
 */
Electrum.prototype.getHeader = function (height) {
  var header = this.blockchain.getHeader(height)
  header = util.rawHeader2block(new Buffer(header, 'hex'))
  var result = {
    block_height: height,
    version: header.version,
    prev_block_hash: header.previousblockhash,
    merkle_root: header.merkleroot,
    timestamp: header.time,
    bits: parseInt(header.bits, 16),
    nonce: header.nonce,
  }

  if (result.prev_block_hash === '0000000000000000000000000000000000000000000000000000000000000000') {
    result.prev_block_hash = null
  }

  return result
}

/**
 * @param {string} txId
 * @param {number} height
 * @return {Q.Promise}
 */
Electrum.prototype.getMerkle = function (txId, height) {
  return this.blockchain.getMerkle(txId, height).then(function (result) {
    return {
      block_height: result.height,
      merkle: result.tree,
      pos: result.pos
    }
  })
}


module.exports = Electrum
// jscs:enable requireCamelCaseOrUpperCaseIdentifiers
