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

  this.blockchain = blockchain
  this._isInialized = false
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
  client.on('request', function(request) { this.newRequest(client, request)}.bind(this))
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
          throw new Error('Not implemented yet')

        case 'blockchain.headers.subscribe':
          throw new Error('Not implemented yet')

        case 'blockchain.address.subscribe':
          throw new Error('Not implemented yet')

        case 'blockchain.address.get_history':
          throw new Error('Not implemented yet')

        case 'blockchain.address.get_mempool':
          throw new Error('Not implemented yet')

        case 'blockchain.address.get_balance':
          throw new Error('Not implemented yet')

        case 'blockchain.address.get_proof':
          throw new Error('Not implemented yet')

        case 'blockchain.address.listunspent':
          result = yield self.blockchain.getUnspentCoins(params[0])
          break

        case 'blockchain.utxo.get_address':
          result = yield self.blockchain.getAddress(params[0], parseInt(params[1]))
          break

        case 'blockchain.block.get_header':
          var header = self.blockchain.getHeader(parseInt(params[0]))
          header = util.rawHeader2block(new Buffer(header, 'hex'))
          result = {
            block_height: parseInt(params[0]),
            version: header.version,
            prev_block_hash: header.previousblockhash,
            merkle_root: header.merkleroot,
            timestamp: header.time,
            bits: parseInt(header.bits, 16),
            nonce: header.nonce,
          }
          if (result.prev_block_hash === '0000000000000000000000000000000000000000000000000000000000000000')
            result.prev_block_hash = null
          break

        case 'blockchain.block.get_chunk':
          result = self.blockchain.getChunk(parseInt(params[0]))
          break

        case 'blockchain.transaction.broadcast':
          result = yield self.blockchain.sendRawTx(params[0])
          break

        case 'blockchain.transaction.get_merkle':
          result = yield self.blockchain.getMerkle(params[0], parseInt(params[1]))
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
      client.send({ id: requestId, error: error.message })

    }
  })
}


module.exports = Electrum
