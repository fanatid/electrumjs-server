var inherits = require('util').inherits

var config = require('config')
var _ = require('lodash')
var Q = require('q')

var Interface = require('./interface')
var TCPTransport = require('../transport/tcp')
var util = require('../util')

var electrumVersion = '0.9'
var serverBanner = (config.get('electrum.banner') || '').replace(/\\n/g,'\n')
var serverDonationAddress = config.get('electrum.donation_address') || ''


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
    clientAddresses: {}
  }
}

inherits(Electrum, Interface)

/**
 * @return {Q.Promise}
 */
Electrum.prototype.initialize = function() {
  var self = this
  if (self._isInialized)
    return Q()

  self._isInialized = true

  self.blockchain.on('newHeight', function() {
    var newHeight = self.blockchain.getBlockCount() - 1
    var numblocksObj = { id: null, method: 'blockchain.numblocks.subscribe', params: [newHeight] }
    Object.keys(self.subscribers.numblocks).forEach(function(clientId) {
      self.subscribers.numblocks[clientId].send(numblocksObj)
    })

    var newHeader = self.blockchain.getHeader(newHeight)
    var headersObj = { id: null, method: 'blockchain.headers.subscribe', params: [newHeader] }
    Object.keys(self.subscribers.headers).forEach(function(clientId) {
      self.subscribers.headers[clientId].send(headersObj)
    })
  })

  self.blockchain.on('touchedAddress', function(address) {
    self.getAddressStatus(address).then(function(status) {
      var addressObj = { id: null, method: 'blockchain.address.subscribe', params: [address, status] }
      var clients = self.subscribers.address[address] || []
      Object.keys(clients).forEach(function(clientId) {
        clients[clientId].send(addressObj)
      })

    }).catch(function(error) {
      console.error(error)

    })
  })

  var promises = config.get('electrum.transport').map(function(transport) {
    switch (transport.type) {
      case 'tcp':
        return new TCPTransport(self, transport.port, transport.host).initialize()

      default:
        throw new Error('Unknow transport: ', transport)
    }
  })

  return Q.all(promises).then(function() { console.log('Electrum interface created') })
}

/**
 * @param {Client} client
 */
Electrum.prototype.newClient = function(client) {
  var self = this

  client.on('request', function(request) { self.newRequest(client, request)})
  client.once('end', function() {
    var clientId = client.getId()

    delete self.subscribers.numblocks[clientId]
    delete self.subscribers.headers[clientId]
    var clientAddresses = self.subscribers.clientAddresses[clientId] || []
    clientAddresses.forEach(function(addr) { delete self.subscribers.address[addr][clientId] })
    delete self.subscribers.clientAddresses[clientId]
  })
}

/**
 * @param {Object} request
 */
Electrum.prototype.newRequest = function(client, request) {
  var self = this

  var requestId = request.id
  var method = request.method
  var params = request.params

  /** check vital fields */
  if (_.isUndefined(requestId) || _.isUndefined(method)) {
    client.send({ error: 'syntax error', request: request })
    return
  }

  /** process */
  Q.spawn(function* () {
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
          if (_.isUndefined(subscription))
            subscription = {}
          subscription[client.getId()] = client
          self.subscribers.address[params[0]] = subscription

          var addresses = self.subscribers.clientAddresses[client.getId()]
          if (_.isUndefined(addresses))
            addresses = []
          addresses.push(params[0])
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
          result = yield self.blockchain.getAddress(params[0], parseInt(params[1]))
          break

        case 'blockchain.block.get_header':
          result = yield self.getHeader(parseInt(params[0]))
          break

        case 'blockchain.block.get_chunk':
          result = self.blockchain.getChunk(parseInt(params[0]))
          break

        case 'blockchain.transaction.broadcast':
          result = yield self.blockchain.sendRawTx(params[0])
          break

        case 'blockchain.transaction.get_merkle':
          result = yield self.getMerkle(params[0], parseInt(params[1]))
          break

        case 'blockchain.transaction.get':
          result = yield self.blockchain.getRawTx(params[0])
          break

        case 'blockchain.estimatefee':
          result = yield self.blockchain.estimatefee(parseInt(params[0]))
          break

        case 'server.banner':
          result = serverBanner
          break

        case 'server.donation_address':
          result = serverDonationAddress
          break

        case 'server.peers.subscribe':
          throw new Error('Not implemented yet')

        case 'server.version':
          result = electrumVersion
          break

        default:
          throw new Error('Unknow method: ' + method)
      }

      client.send({ id: requestId, result: result })

    } catch (error) {
      console.error(error)
      client.send({ id: requestId, error: error.message })

    }
  })
}

/**
 * @param {string} address
 * @return {Q.Promise}
 */
Electrum.prototype.getAddressStatus = function(address) {
  return this.getHistory(address).then(function(history) {
    var status = history.map(function(entry) { return entry.tx_hash + ':' + entry.height + ':' }).join('')
    return util.sha256(status).toString('hex')
  })
}

/**
 * @param {string} address
 * @return {Q.Promise}
 */
Electrum.prototype.getHistory = function(address) {
  return this.blockchain.getCoins(address).then(function(coins) {
    var history = []
    coins.forEach(function(coin) {
      history.push([coin.cTxId, coin.cHeight])
      if (coin.sTxId !== null)
        history.push([coin.sTxId, coin.sHeight])
    })
    history = _.sortBy(_.uniq(history), function(entry) { return entry[1] === 0 ? Infinity : entry[1] })
    return history.map(function(entry) { return { tx_hash: entry[0], height: entry[1] } })
  })
}

/**
 * @param {string} address
 * @return {Q.Promise}
 */
Electrum.prototype.getBalance = function(address) {
  return this.blockchain.getCoins(address).then(function(coins) {
    var result = { confirmed: 0, unconfirmed: 0 }

    coins.forEach(function(coin) {
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
Electrum.prototype.getUnspentCoins = function(address) {
  return this.blockchain.getCoins(address).then(function(coins) {
    coins = coins.filter(function(coin) { return coin.cHeight !== 0 && coin.sTxId === null })
    coins = coins.map(function(coin) {
      return { tx_hash: coin.cTxId, tx_pos: coin.cIndex, value: coin.cValue, height: coin.cHeight }
    })
    return coins
  })
}

/**
 * @param {number} height
 * @return {Q.Promise}
 */
Electrum.prototype.getHeader = function(height) {
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
  if (result.prev_block_hash === '0000000000000000000000000000000000000000000000000000000000000000')
    result.prev_block_hash = null
  return result
}

/**
 * @param {string} txId
 * @param {number} height
 * @return {Q.Promise}
 */
Electrum.prototype.getMerkle = function(txId, height) {
  return this.blockchain.getMerkle(txId, height).then(function(merkle) {
    return {
      block_height: height,
      merkle: merkle.tree,
      pos: merkle.pos
    }
  })
}


module.exports = Electrum
