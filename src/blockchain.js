var events = require('events')
var inherits = require('util').inherits

var config = require('config')
var bitcoind = require('bitcoin')
var bitcoin = require('bitcoinjs-lib')
var bufferEqual = require('buffer-equal')
var _ = require('lodash')
var Q = require('q')
var Set = require('set')

var util = require('./util')


/**
 * @event Blockchain#newHeight
 */

/**
 * @event Blockchain#touchedAddress
 * @type {string}
 */

/**
 * @class Blockchain
 */
function Blockchain() {
  events.EventEmitter.call(this)

  this._isInialized = false
}

inherits(Blockchain, events.EventEmitter)

/**
 * @return {Q.Promise}
 */
Blockchain.prototype.initialize = function() {
  var self = this
  if (self._isInialized)
    return Q()

  self._isInialized = true
  self.network = bitcoin.networks[config.get('server.network')]

  var deferred = Q.defer()
  Q.spawn(function* () {
    try {
      /** create bitcoind client and check network */
      self.bitcoindClient = new bitcoind.Client({
        host: config.get('bitcoind.host'),
        port: config.get('bitcoind.port'),
        user: config.get('bitcoind.user'),
        pass: config.get('bitcoind.password')
      })
      self.bitcoind = Q.nbind(self.bitcoindClient.cmd, self.bitcoindClient)

      var bitcoindInfo = (yield self.bitcoind('getinfo'))[0]
      if (config.get('server.network') === 'testnet' && !bitcoindInfo.testnet)
        throw new Error('bitcoind and ewallet-server have different networks')

      /** create storage */
      switch (config.get('server.storage')) {
        case 'mongodb':
          var MongoStorage = require('./storage.mongo')
          self.storage = new MongoStorage()
          break

        case 'postgres':
          var PostgresStorage = require('./storage/postgres')
          self.storage = new PostgresStorage()
          break

        default:
          throw new Error('Unknow storage: ', config.get('server.storage'))
      }
      yield self.storage.initialize()

      /** load headers and set last block hash */
      self.headersCache = []
      self.chunksCache = []

      var headers = yield self.storage.getAllHeaders()
      headers.forEach(self.pushHeader.bind(self))

      self.updateLastBlockHash()

      /** sync storage with bitcoind */
      yield self.catchUp()
      /** catch up new blocks and get info from mempool */
      process.nextTick(self.mainIteration.bind(self))

      /** done */
      console.log('Blockchain ready, current height: ' + self.getBlockCount())
      deferred.resolve()

    } catch (error) {
      deferred.reject(error)

    }
  })

  return deferred.promise
}

/**
 * @param {string} header
 */
Blockchain.prototype.pushHeader = function(hexHeader) {
  this.headersCache.push(hexHeader)

  /** update chunks (2016 headers include) */
  if (this.chunksCache.length === 0) {
    this.chunksCache[0] = [hexHeader]
    return
  }

  if (this.chunksCache[this.chunksCache.length - 1].length === 322560) {
    this.chunksCache.push([hexHeader])
    return
  }

  this.chunksCache[this.chunksCache.length - 1] += hexHeader
}

/**
 */
Blockchain.prototype.popHeader = function() {
  this.headersCache.pop()

  /** update chunks */
  var lastChunkIndex = this.chunksCache.length - 1
  var lastChunk = this.chunksCache[lastChunkIndex]

  if (lastChunk.length === 160) {
    this.chunksCache.pop()
    return
  }

  this.chunksCache[lastChunkIndex] = lastChunk.slice(0, lastChunk.length - 160)
}

/**
 * @param {number} index
 * @return {string}
 * @throws {RangeError}
 */
Blockchain.prototype.getHeader = function(index) {
  if (index < 0 || index >= this.headersCache.length)
    throw new RangeError('Header not exists')

  return this.headersCache[index]
}

/**
 * @return {number}
 */
Blockchain.prototype.getBlockCount = function() {
  return this.headersCache.length
}

/**
 */
Blockchain.prototype.updateLastBlockHash = function() {
  var lastBlockHash = '0000000000000000000000000000000000000000000000000000000000000000'

  if (this.getBlockCount() > 0) {
    var hexHeader = this.getHeader(this.getBlockCount() - 1)
    var rawHeader = new Buffer(hexHeader, 'hex')
    var headerHash = util.hash256(rawHeader)
    lastBlockHash = util.hashEncode(headerHash)
  }

  this.lastBlockHash = lastBlockHash
}

/**
 * Sync storage with bitcoind
 * @return {Q.Promise}
 */
Blockchain.prototype.catchUp = function() {
  var self = this

  return Q.Promise(function(resolve, reject) {
    Q.spawn(function* () {
      var sigintReceived = false
      function onSIGINT() { sigintReceived = true; console.log('SIGINT received, please wait...') }
      process.addListener('SIGINT', onSIGINT)

      try {
        while (!sigintReceived) {
          var blockCount = (yield self.bitcoind('getblockcount'))[0]
          var blockHash = (yield self.bitcoind('getblockhash', blockCount))[0]
          if (self.lastBlockHash === blockHash)
            break

          blockHash = (yield self.bitcoind('getblockhash', self.getBlockCount()))[0]
          var fullBlock = yield util.getFullBlock(self.bitcoindClient, blockHash)
          if (self.lastBlockHash === fullBlock.previousblockhash) {
            yield self.importBlock(fullBlock)

          } else {
            fullBlock = yield util.getFullBlock(self.bitcoindClient, self.lastBlockHash)
            yield self.importBlock(fullBlock, true)

          }

          self.emit('newHeight')
        }

        if (!sigintReceived)
          resolve()

      } catch (error) {
        if (!sigintReceived)
          reject(error)

      }

      process.removeListener('SIGINT', onSIGINT)
      if (sigintReceived)
        process.exit()
    })
  })
}

/**
 * @param {Object} block
 * @param {boolean} [revert=false]
 * @return {Q.Promise}
 */
Blockchain.prototype.importBlock = function(block, revert) {
  var self = this

  if (_.isUndefined(revert))
    revert = false

  return Q.Promise(function(resolve, reject) {
    Q.spawn(function* () {
      try {
        var stat = {
          st: Date.now(),
          inputs: 0,
          outputs: 0,
          touchedAddress: new Set()
        }

        if (!revert) {
          var hexHeader = util.block2rawHeader(block).toString('hex')
          yield self.storage.pushHeader(block.height, hexHeader)
          self.pushHeader(hexHeader)

        } else {
          yield self.storage.popHeader()
          self.popHeader()

        }

        self.updateLastBlockHash()

        var address
        var currentHeight = self.getBlockCount() - 1

        for (var txIndex = 0; txIndex < block.tx.length; ++txIndex) {
          var tx = block.tx[txIndex]
          var txId = tx.getId()

          stat.inputs += tx.ins.length
          stat.outputs += tx.outs.length

          if (!revert) {
            for (var inIndex = 0; inIndex < tx.ins.length; ++inIndex) {
              var input = tx.ins[inIndex]
              var cTxId = util.hashEncode(input.hash)
              address = yield self.storage.getAddress(cTxId, input.index)
              if (address === null)
                continue

              yield self.storage.setSpent(cTxId, input.index, txId, inIndex, currentHeight)
              stat.touchedAddress.add(address)
            }

            for (var outIndex = 0; outIndex < tx.outs.length; ++outIndex) {
              var output = tx.outs[outIndex]
              var address = bitcoin.Address.fromOutputScript(output.script, self.network)
              if (address === null)
                continue

              yield self.storage.addCoin(address, txId, outIndex, output.value, currentHeight)
              stat.touchedAddress.add(address)
            }
          } else {
            for (var outIndex = 0; outIndex < tx.outs.length; ++outIndex) {
              address = yield self.storage.getAddress(txId, outIndex)
              if (address === null)
                continue

              yield self.storage.removeCoin(txId, outIndex)
              stat.touchedAddress.add(address)
            }

            for (var inIndex = 0; inIndex < tx.ins.length; ++inIndex) {
              var input = tx.ins[inIndex]
              var cTxId = util.hashEncode(input.hash)
              address = yield self.storage.getAddress(cTxId, input.index)
              if (address === null)
                continue

              yield self.storage.setUnspent(txId, input.index)
              stat.touchedAddress.add(address)
            }
          }
        }

        /** done */
        var msg = [
          (revert ? 'revert' : 'import') + ' block #' + block.height,
          block.tx.length + ' transactions',
          stat.inputs + '/' + stat.outputs,
          (Date.now() - stat.st) + 'ms'
        ]
        console.log(msg.join(', '))
        stat.touchedAddress.get().forEach(function(addr) { self.emit('touchedAddress', addr) })
        resolve()

      } catch (error) {
        reject(error)
      }
    })
  })
}

Blockchain.prototype.mainIteration = function() {
  var self = this

  Q.spawn(function* () {
    try {


    } catch (error) {
      console.error(error)

    }

    setTimeout(self.mainIteration.bind(self), 10*1000)
  })
}

/**
 * @param {string} address
 * @return {Q.Promise}
 */
Blockchain.prototype.getUnspentCoins = function(address) {
  return this.storage.getUnspentCoins(address)
}

/**
 * @param {string} txId
 * @param {number} outIndex
 * @return {Q.Promise}
 */
Blockchain.prototype.getAddress = function(txId, outIndex) {
  return this.storage.getAddress(txId, outIndex)
}

/**
 * @param {number} index
 * @return {string}
 * @throws {RangeError}
 */
Blockchain.prototype.getChunk = function(index) {
  if (index < 0 || index >= this.chunksCache.length)
    throw new RangeError('Chunk not exists')

  return this.chunksCache[index]
}

/**
 * @param {string} rawTx
 * @return {Q.Promise}
 */
Blockchain.prototype.sendRawTx = function(rawTx) {
  return this.bitcoind('sendrawtransaction', rawTx).spread(function(txId) { return txId })
}

/**
 * @param {string} txHash
 * @param {number} height
 * @return {Q.Promise}
 */
Blockchain.prototype.getMerkle = function(txHash, height) {
  // Todo: move to subprocess?
  var self = this

  var deferred = Q.defer()
  Q.spawn(function* () {
    try {
      var blockHash = (yield self.bitcoind('getblockhash', height))[0]
      var block = (yield self.bitcoind('getblock', blockHash))[0]

      var merkle = block.tx.map(util.hashDecode)
      var targetHash = util.hashDecode(txHash)
      var result = []
      while (merkle.length !== 1) {
        if (merkle.length % 2 === 1)
          merkle.push(merkle[merkle.length-1])

        var newMerkle = []
        for (var i = 0; i < merkle.length; i += 2) {
          var newHash = util.hash256(merkle[i] + merkle[i+1])
          newMerkle.push(newHash)

          if (bufferEqual(merkle[i], targetHash)) {
            result.push(util.hashEncode(merkle[i+1]))
            targetHash = newHash
          } else if (bufferEqual(merkle[i+1], targetHash)) {
            result.push(util.hashEncode(merkle[i]))
            targetHash = newHash
          }
        }
        merkle = newMerkle
      }

      deferred.resolve({ block_height: height, merkle: result, pos: block.tx.indexOf(txHash) })

    } catch (error) {
      deferred.reject(error)

    }
  })
  return deferred.promise
}

/**
 * @param {string} txHash
 * @return {Q.Promise}
 */
Blockchain.prototype.getRawTx = function(txHash) {
  return this.bitcoind('getrawtransaction', txHash, 0).spread(function(rawTx) { return rawTx })
}

/**
 * @param {number} nblocks
 * @return {Q.Promise}
 */
Blockchain.prototype.estimatefee = function(nblocks) {
  return this.bitcoind('estimatefee', nblocks).spread(function(fee) { return fee })
}


module.exports = Blockchain
