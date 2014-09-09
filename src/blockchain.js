var config = require('config')
var bitcoind = require('bitcoin')
var bitcoin = require('bitcoinjs-lib')
var Q = require('q')

var util = require('./util')


/**
 * @callback Blockchain~constructor
 * @param {?Error} error
 */

/**
 * @class Blockchain
 * @param {Blockchain~constructor} readyCallback
 */
function Blockchain(readyCallback) {
  var self = this

  self.isTestnet = config.get('server.network') === 'testnet'
  self.network = self.isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin

  Q.spawn(function* () {
    try {
      /** create bitcoind client and check network */
      self.bitcoind = new bitcoind.Client({
        host: config.get('bitcoind.host'),
        port: config.get('bitcoind.port'),
        user: config.get('bitcoind.user'),
        pass: config.get('bitcoind.password')
      })

      var bitcoindInfo = (yield Q.ninvoke(self.bitcoind, 'cmd', 'getinfo'))[0]
      if (bitcoindInfo.testnet !== self.isTestnet)
        throw new Error('bitcoind and ewallet-server have different networks')

      /** create storage */
      var storage = config.get('server.storage')
      if (storage === 'mongodb') {
        self.storage = yield require('./storage/mongo').createMongoStorage()

      } else if (storage === 'postgres') {
        self.storage = yield require('./storage/postgres').createPostgresStorage()

      } else {
        throw new Error('storage ' + storage + ' not supported')

      }

      /** load headers and set last block hash */
      self.headersCache = []
      self.chunksCache = []

      var headers = yield self.storage.getAllHeaders()
      headers.forEach(self.pushHeader.bind(self))

      self.updateLastBlockHash()

      /** sync storage with bitcoind */
      yield self.catchUp()

      /** done */
      readyCallback(null)

    } catch (error) {
      readyCallback(error)

    }
  })
}

/**
 * Create new Blockchain
 * @return {Q.Promise}
 */
Blockchain.createBlockchain = function() {
  return Q.Promise(function(resolve, reject) {
    var blockchain

    function readyCallback(error) {
      if (error === null)
        resolve(blockchain)
      else
        reject(error)
    }

    blockchain = new Blockchain(readyCallback)
  })
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
 */
Blockchain.prototype.updateLastBlockHash = function() {
  var lastBlockHash = '0000000000000000000000000000000000000000000000000000000000000000'

  if (this.getBlockCount() > 0) {
    var hexHeader = this.getHeader(this.getBlockCount() - 1)
    var rawHeader = new Buffer(hexHeader, 'hex')
    var headerHash = util.hash256(rawHeader)
    lastBlockHash = Array.prototype.reverse.call(headerHash).toString('hex')
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
      var receiveSIGINT = false
      function onSIGINT() { receiveSIGINT = true }
      process.addListener('SIGINT', onSIGINT)

      try {
        while (!receiveSIGINT) {
          var blockCount = (yield Q.ninvoke(self.bitcoind, 'cmd', 'getblockcount'))[0]
          var blockHash = (yield Q.ninvoke(self.bitcoind, 'cmd', 'getblockhash', blockCount))[0]
          if (self.lastBlockHash === blockHash)
            break

          blockHash = (yield Q.ninvoke(self.bitcoind, 'cmd', 'getblockhash', self.getBlockCount()))[0]
          var fullBlock = yield util.getFullBlock(self.bitcoind, blockHash)
          if (self.lastBlockHash === fullBlock.previousblockhash) {
            yield self.importBlock(fullBlock)
            continue
          }

          fullBlock = yield util.getFullBlock(self.bitcoind, self.lastBlockHash)
          yield self.revertBlock(fullBlock)
        }

        if (!receiveSIGINT)
          resolve()

      } catch (error) {
        if (!receiveSIGINT)
          reject(error)

      }

      process.removeListener('SIGINT', onSIGINT)
      if (receiveSIGINT)
        process.exit()
    })
  })
}

/**
 * @param {Object} block
 * @return {Q.Promise}
 */
Blockchain.prototype.importBlock = function(block) {
  var self = this

  return Q.Promise(function(resolve, reject) {
    Q.spawn(function* () {
      try {
        /** add header to storage */
        var hexHeader = util.block2rawHeader(block).toString('hex')
        yield self.storage.pushHeader(block.height, hexHeader)

        /** add header to cache and update lastBlockCache */
        self.pushHeader(hexHeader)
        self.updateLastBlockHash()

        /** sort tx from block */
        var transactions = block.tx.map(function(txHex) { return bitcoin.Transaction.fromHex(txHex) })
        transactions = util.toposort(transactions)

        /** import transactions */
        var currentHeight = self.getBlockCount() - 1

        for (var txIndex = 0; txIndex < transactions.length; ++txIndex) {
          var tx = transactions[txIndex]
          var txId = tx.getId()

          /** import inputs */
          for (var inIndex = 0; inIndex < tx.ins.length; ++inIndex) {
            var input = tx.ins[inIndex]
            var cTxId = Array.prototype.reverse.call(new Buffer(input.hash)).toString('hex')
            var address = yield self.storage.getAddress(cTxId, input.index)
            if (address === null)
              continue

            yield self.storage.setSpent(cTxId, input.index, txId, inIndex, currentHeight)
          }

          /** import outputs */
          for (var outIndex = 0; outIndex < tx.outs.length; ++outIndex) {
            var output = tx.outs[outIndex]
            var address = bitcoin.Address.fromOutputScript(output.script, self.network)
            if (address === null)
              continue

            yield self.storage.addCoin(address, txId, outIndex, output.value, currentHeight)
          }
        }

        /** done */
        console.log('import block #' + block.height)
        resolve()

      } catch (error) {
        reject(error)
      }
    })
  })
}

/**
 * @param {Object} block
 * @return {Q.Promise}
 */
Blockchain.prototype.revertBlock = function(block) {
  var self = this

  return Q.Promise(function(resolve, reject) {
    Q.spawn(function* () {
      try {
        /** pop header from storage */
        yield self.storage.popHeader()

        /** pop header from cache and update lastBlockCache */
        self.popHeader()
        self.updateLastBlockHash()

        /** sort tx from block */
        var transactions = block.tx.map(function(txHex) { return bitcoin.Transaction.fromHex(txHex) })
        transactions = util.toposort(transactions).reverse()

        /** revert transactions */
        for (var txIndex = 0; txIndex < transactions.length; ++txIndex) {
          var tx = transactions[txIndex]
          var txId = tx.getId()

          /** revert outputs */
          for (var outIndex = 0; outIndex < tx.outs.length; ++outIndex)
            yield self.storage.removeCoin(txId, outIndex)

          /** revert inputs */
          for (var inIndex = 0; inIndex < tx.ins.length; ++inIndex)
            yield self.storage.setUnspent(txId, inIndex)
        }

        /** done */
        console.log('revert block #' + block.height)
        resolve()

      } catch (error) {
        reject(error)
      }
    })
  })
}

/**
 * @return {number}
 */
Blockchain.prototype.getBlockCount = function() {
  return this.headersCache.length
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
 * @param {number} index
 * @return {string}
 * @throws {RangeError}
 */
Blockchain.prototype.getChunk = function(index) {
  if (index < 0 || index >= this.chunksCache.length)
    throw new RangeError('Chunk not exists')

  return this.chunksCache[index]
}


module.exports = Blockchain
