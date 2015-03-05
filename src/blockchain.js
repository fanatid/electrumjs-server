var events = require('events')
var inherits = require('util').inherits

var config = require('config')
var bitcoind = require('bitcoin')
var bitcoin = require('bitcoinjs-lib')
var bufferEqual = require('buffer-equal')
var _ = require('lodash')
var Q = require('q')
var LRU = require('lru-cache')

var logger = require('./logger').logger
var networks = require('./networks')
var util = require('./util')


/**
 * @event Blockchain#newHeight
 * @param {number} height
 */

/**
 * @event Blockchain#touchedAddress
 * @param {string} address
 */

/**
 * @class Blockchain
 */
function Blockchain() {
  events.EventEmitter.call(this)

  this._isInialized = false

  // accelerate update mempool
  this._addressCache = LRU({
    max: 5000
  })
}

inherits(Blockchain, events.EventEmitter)

/**
 * @return {Q.Promise}
 */
Blockchain.prototype.initialize = function () {
  var self = this
  if (self._isInialized) { return Q() }

  self._isInialized = true

  var deferred = Q.defer()
  Q.spawn(function* initProcess() {
    try {
      self.network = networks[config.get('server.network')]
      if (_.isUndefined(self.network)) {
        throw new Error('Unknow server.network: ' + config.get('server.network'))
      }

      /** create bitcoind client and check network */
      self.bitcoindClient = new bitcoind.Client({
        host: config.get('bitcoind.host'),
        port: config.get('bitcoind.port'),
        user: config.get('bitcoind.user'),
        pass: config.get('bitcoind.password'),
        timeout: 60000
      })
      self.bitcoind = Q.nbind(self.bitcoindClient.cmd, self.bitcoindClient)

      var bitcoindInfo = (yield self.bitcoind('getinfo'))[0]
      var configNetwork = config.get('server.network')
      var configNetworkIsTestnet = configNetwork.indexOf('testnet', configNetwork.length - 7) !== -1
      if (configNetworkIsTestnet !== bitcoindInfo.testnet) {
        throw new Error('bitcoind and ewallet-server have different networks')
      }

      /** create storage */
      switch (config.get('server.storage')) {
        case 'mongo':
          var MongoStorage = require('./storage/mongo')
          self.storage = new MongoStorage()
          break

        case 'postgres':
          var PostgresStorage = require('./storage/postgres')
          self.storage = new PostgresStorage()
          break

        case 'redis':
          throw new Error('Redis not supported now...')
          var RedisStorage = require('./storage/redis')
          self.storage = new RedisStorage()
          break

        default:
          throw new Error('Unknow storage: ', config.get('server.storage'))
      }
      yield self.storage.initialize()

      /** load headers and set last block hash */
      self.chunksCache = []

      logger.verbose('Loading headers from storage...')
      var headers = yield self.storage.getAllHeaders()
      headers.forEach(self.pushHeader.bind(self))

      self.updateLastBlockHash()

      /** sync storage with bitcoind */
      self.syncStatus = {
        status: 'sync',
        progress: {
          count: self.getBlockCount(),
          total: self.getBlockCount()
        }
      }
      yield self.catchUp()
      self.syncStatus.status = 'finished'
      /** catch up new blocks and get info from mempool */
      self.mempool = {txIds: {}, spent: {}, addrs: {}, coins: {}}
      self.on('newHeight', function () {
        logger.verbose('clear mempool')
        self.mempool = {txIds: {}, spent: {}, addrs: {}, coins: {}}
      })
      process.nextTick(self.mainIteration.bind(self))

      /** done */
      logger.info('Blockchain ready, current height: %s', self.getBlockCount() - 1)
      deferred.resolve()

    } catch (error) {
      deferred.reject(error)

    }
  })

  return deferred.promise
}

/**
 * @param {string} hexHeader
 */
Blockchain.prototype.pushHeader = function (hexHeader) {
  /** update chunks (2016 headers include) */
  if (this.chunksCache.length === 0) {
    this.chunksCache[0] = hexHeader
    return
  }

  if (this.chunksCache[this.chunksCache.length - 1].length === 322560) {
    this.chunksCache.push(hexHeader)
    return
  }

  this.chunksCache[this.chunksCache.length - 1] += hexHeader
}

/**
 */
Blockchain.prototype.popHeader = function () {
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
 * @return {number}
 */
Blockchain.prototype.getBlockCount = function () {
  var chunksCacheLength = this.chunksCache.length

  var chunksCount = Math.max(0, chunksCacheLength - 1)
  var headersCount = (this.chunksCache[chunksCacheLength - 1] || '').length / 160

  return chunksCount * 2016 + headersCount
}

/**
 * @param {number} index
 * @return {string}
 * @throws {RangeError}
 */
Blockchain.prototype.getHeader = function (index) {
  var chunk = this.chunksCache[Math.floor(index / 2016)] || ''
  var header = chunk.slice((index % 2016) * 160, (index % 2016 + 1) * 160)
  if (header.length === 0) {
    throw new RangeError('Header not exists')
  }

  return header
}

/**
 * @param {number} index
 * @return {string}
 * @throws {RangeError}
 */
Blockchain.prototype.getChunk = function (index) {
  if (index < 0 || index >= this.chunksCache.length) {
    throw new RangeError('Chunk not exists')
  }

  return this.chunksCache[index]
}

/**
 */
Blockchain.prototype.updateLastBlockHash = function () {
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
Blockchain.prototype.catchUp = function () {
  var self = this

  var deferred = Q.defer()
  Q.spawn(function* syncProcess() {
    var sigintReceived = false
    function onSIGINT() {
      sigintReceived = true
      logger.warn('SIGINT received, please wait...')
    }
    process.addListener('SIGINT', onSIGINT)

    try {
      while (!sigintReceived) {
        var blockCount = (yield self.bitcoind('getblockcount'))[0]
        var blockHash = (yield self.bitcoind('getblockhash', blockCount))[0]
        if (self.lastBlockHash === blockHash) { break }

        blockHash = (yield self.bitcoind('getblockhash', self.getBlockCount()))[0]
        var fullBlock = yield util.getFullBlock(self.bitcoindClient, blockHash)
        if (self.lastBlockHash === fullBlock.previousblockhash) {
          yield self.importBlock(fullBlock)

        } else {
          fullBlock = yield util.getFullBlock(self.bitcoindClient, self.lastBlockHash)
          yield self.importBlock(fullBlock, true)

        }

        if (self.syncStatus.status === 'sync') {
          self.syncStatus.progress.count = self.getBlockCount()
          self.syncStatus.progress.total = blockCount
        }

        self.emit('newHeight', fullBlock.height)
      }

      if (!sigintReceived) { deferred.resolve() }

    } catch (error) {
      if (!sigintReceived) { deferred.reject(error) }

    }

    process.removeListener('SIGINT', onSIGINT)
    if (sigintReceived) { process.exit(0) }
  })

  return deferred.promise
}

/**
 * @param {Object} block
 * @param {boolean} [revert=false]
 * @return {Q.Promise}
 */
Blockchain.prototype.importBlock = function (block, revert) {
  var self = this

  var deferred = Q.defer()
  Q.spawn(function* importProcess() {
    try {
      var stat = {
        st: process.hrtime(),
        inputs: 0,
        outputs: 0,
        tAddresses: new util.Set()
      }
      if (self.syncStatus.status !== 'finished') {
        stat.tAddresses.add = function () {}
      }

      if (_.isUndefined(revert)) { revert = false }
      var isImport = !revert

      if (isImport) {
        var hexHeader = util.block2rawHeader(block).toString('hex')
        yield self.storage.pushHeader(hexHeader, block.height)
        self.pushHeader(hexHeader)
      } else {
        yield self.storage.popHeader()
        self.popHeader()
      }

      self.updateLastBlockHash()

      yield self.importTransactions(block.tx, isImport, stat)

      if (self.syncStatus.status === 'finished') {
        stat.tAddresses.get().forEach(function (addr) { self.emit('touchedAddress', addr) })
      }

      /** done */
      logger.info('%s block #%s, %s transactions, %s/%s, %sms',
        revert ? 'Revert' : 'Import', block.height, block.tx.length,
        stat.inputs, stat.outputs, util.spendTime(stat.st))
      deferred.resolve()

    } catch (error) {
      deferred.reject(error)

    }
  })
  return deferred.promise
}

/**
 * @param {bitcoinjs-lib.Transaction[]} transactions
 * @param {boolean} isImport
 * @param {Object} stat
 * @param {number} stat.inputs
 * @param {number} stat.outputs
 * @param {Set} stat.tAddresses
 * @return {Q.Promise}
 */
Blockchain.prototype.importTransactions = function (transactions, isImport, stat) {
  var self = this

  var deferred = Q.defer()
  Q.spawn(function* importProcess() {
    var touchAddress = stat.tAddresses.add.bind(stat.tAddresses)

    try {
      var currentHeight = self.getBlockCount() - 1
      var inIndex
      var outIndex
      var input
      var cTxId
      var addresses

      if (!isImport) { transactions.reverse() }

      for (var txIndex = 0; txIndex < transactions.length; ++txIndex) {
        var tx = transactions[txIndex]
        var txId = tx.getId()

        stat.inputs += tx.ins.length
        stat.outputs += tx.outs.length

        if (isImport) {
          for (inIndex = 0; inIndex < tx.ins.length; ++inIndex) {
            input = tx.ins[inIndex]
            cTxId = util.hashEncode(input.hash)
            yield self.storage.setSpent(cTxId, input.index, txId, currentHeight)

            if (self.syncStatus.status === 'finished') {
              addresses = yield self.storage.getAddresses(cTxId, input.index)
              addresses.forEach(touchAddress)
            }
          }

          for (outIndex = 0; outIndex < tx.outs.length; ++outIndex) {
            var output = tx.outs[outIndex]
            addresses = util.getAddressesFromOutputScript(output.script, self.network)
            for (var addressId = 0; addressId < addresses.length; ++addressId) {
              yield self.storage.addCoin(addresses[addressId], txId, outIndex, output.value, currentHeight)
            }

            if (self.syncStatus.status === 'finished') {
              addresses.forEach(touchAddress)
            }
          }

        } else {
          for (outIndex = 0; outIndex < tx.outs.length; ++outIndex) {
            yield self.storage.removeCoin(txId, outIndex)

            if (self.syncStatus.status === 'finished') {
              util.getAddressesFromOutputScript(tx.outs[outIndex].script, self.network).forEach(touchAddress)
            }
          }

          for (inIndex = 0; inIndex < tx.ins.length; ++inIndex) {
            input = tx.ins[inIndex]
            cTxId = util.hashEncode(input.hash)
            yield self.storage.setUnspent(txId, input.index)

            if (self.syncStatus.status === 'finished') {
              addresses = yield self.storage.getAddresses(cTxId, input.index)
              addresses.forEach(touchAddress)
            }
          }
        }
      }

      deferred.resolve()

    } catch (error) {
      deferred.reject(error)

    }
  })
  return deferred.promise
}

/**
 * @return {Q.Promise}
 */
Blockchain.prototype.updateMempool = function () {
  /**
   * mempool structure
   *  txIds: {txId: true}
   *  spent: {cTxId: {cIndex: sTxId}}
   *  addrs: {sTxId+sIndex: addresses}
   *  coins: {address: {cTxId: {cIndex: cValue}}}
   */

  var self = this
  var stat = {
    st: process.hrtime(),
    added: 0,
    tAddresses: new util.Set()
  }

  return self.bitcoind('getrawmempool').spread(function (mempoolTxIds) {
    var batch = _.chain(mempoolTxIds)
      .filter(function (txId) { return _.isUndefined(self.mempool.txIds[txId]) })
      .map(function (txId) { return {method: 'getrawtransaction', params: [txId]} })
      .value()

    if (batch.length === 0) {
      return Q.resolve([])
    }

    var deferred = Q.defer()
    var txs = []

    self.bitcoindClient.cmd(batch, function (error, rawTx) {
      if (error) { return deferred.reject(error) }

      try {
        txs.push(bitcoin.Transaction.fromHex(rawTx))
        if (txs.length === batch.length) { deferred.resolve(txs) }

      } catch (error) {
        deferred.reject(error)

      }
    })

    return deferred.promise

  }).then(function (txs) {
    txs.forEach(function (tx) {
      var txId = tx.getId()

      self.mempool.txIds[txId] = true
      stat.added += 1

      tx.ins.forEach(function (input) {
        var cTxId = util.hashEncode(input.hash)
        var cIndex = input.index

        self.mempool.spent[cTxId] = self.mempool.spent[cTxId] || {}
        self.mempool.spent[cTxId][cIndex] = txId

        stat.tAddresses.add([cTxId, cIndex].join(','))
      })

      tx.outs.forEach(function (output, outIndex) {
        var addrs = util.getAddressesFromOutputScript(output.script, self.network)

        self.mempool.addrs[txId + outIndex] = addrs
        addrs.forEach(function (addr) {
          self.mempool.coins[addr] = self.mempool.coins[addr] || {}
          self.mempool.coins[addr][txId] = self.mempool.coins[addr][txId] || {}
          self.mempool.coins[addr][txId][outIndex] = output.value

          stat.tAddresses.add(addr)
        })
      })
    })

  }).then(function () {
    var addAddressToStat = stat.tAddresses.add.bind(stat.tAddresses)

    var promises = stat.tAddresses.get().map(function (addr) {
      var items = addr.split(',')
      if (items.length === 1) { return }

      stat.tAddresses.remove(addr)
      if (!_.isUndefined(self.mempool.addrs[addr])) {
        return self.mempool.addrs[addr].forEach(addAddressToStat)
      }

      var addrs = self._addressCache.get(items[0] + ':' + items[1])
      if (typeof addrs !== 'undefined') {
        return addrs.forEach(addAddressToStat)
      }

      return self.storage.getAddresses(items[0], parseInt(items[1], 10)).then(function (addrs) {
        self._addressCache.set(items[0] + ':' + items[1], addrs)
        addrs.forEach(addAddressToStat)
      })
    })

    return Q.all(promises).then(function () {
      stat.tAddresses.get().forEach(function (addr) { self.emit('touchedAddress', addr) })

    }).then(function () {
      logger.verbose('Update mempool +%s, now %s, %sms',
        stat.added, Object.keys(self.mempool.txIds).length, util.spendTime(stat.st))

    })
  })
}

/**
 */
Blockchain.prototype.mainIteration = function () {
  var self = this

  Q.spawn(function* iteration() {
    var startTime = Date.now()

    try {
      yield self.catchUp()
      yield self.updateMempool()

    } catch (error) {
      logger.error('Blockchain.mainIteration error: %s', error.stack)

    }

    var sleepTime = Math.max(0, 5000 - (Date.now() - startTime))
    setTimeout(self.mainIteration.bind(self), sleepTime)
  })
}

/**
 * @param {string} txId
 * @param {number} outIndex
 * @return {Q.Promise}
 */
Blockchain.prototype.getAddresses = function (txId, outIndex) {
  if (!_.isUndefined(this.mempool.addrs[txId + outIndex])) {
    return Q(this.mempool.addrs[txId + outIndex])
  }

  return this.storage.getAddresses(txId, outIndex)
}

/**
 * @param {string} address
 * @return {Q.Promise}
 */
Blockchain.prototype.getCoins = function (address) {
  var self = this

  return self.storage.getCoins(address).then(function (coins) {
    // add unconfirmed coins
    var mempoolCoins = self.mempool.coins[address] || {}
    Object.keys(mempoolCoins).forEach(function (cTxId) {
      Object.keys(mempoolCoins[cTxId]).forEach(function (cIndex) {
        coins.push({
          cTxId: cTxId,
          cIndex: parseInt(cIndex),
          cValue: mempoolCoins[cTxId][cIndex],
          cHeight: 0,
          sTxId: null,
          sHeight: null
        })
      })
    })

    // fill unconfirmed spent coins
    coins.forEach(function (coin) {
      var sTxId = (self.mempool.spent[coin.cTxId] || {})[coin.cIndex]
      if (_.isUndefined(sTxId)) { return }

      coin.sTxId = sTxId
      coin.sHeight = 0
    })

    return coins
  })
}

/**
 * @param {string} txHash
 * @return {Q.Promise}
 */
Blockchain.prototype.getRawTx = function (txHash) {
  return this.bitcoind('getrawtransaction', txHash, 0).spread(function (rawTx) { return rawTx })
}

/**
 * @param {string} rawTx
 * @return {Q.Promise}
 */
Blockchain.prototype.sendRawTx = function (rawTx) {
  return this.bitcoind('sendrawtransaction', rawTx).spread(function (txId) { return txId })
}

/**
 * @param {string} txId
 * @param {number} [height]
 * @return {Q.Promise}
 */
Blockchain.prototype.getMerkle = function (txId, height) {
  var self = this

  var promise
  if (_.isNumber(height) && !_.isNaN(height)) {
    promise = self.bitcoind('getblockhash', height).spread(function (result) { return result })

  } else {
    promise = self.bitcoind('getrawtransaction', txId, 1).spread(function (info) {
      if (_.isUndefined(info.blockhash)) {
        var error = new Error()
        error.code = -1
        throw error
      }

      return info.blockhash
    })

  }

  return promise.then(function (blockHash) {
    return self.bitcoind('getblock', blockHash)

  }).spread(function (block) {
    var merkle = block.tx.map(util.hashDecode)
    var targetHash = util.hashDecode(txId)
    var result = []
    while (merkle.length !== 1) {
      if (merkle.length % 2 === 1) { merkle.push(_.last(merkle)) }

      var newMerkle = []
      for (var i = 0; i < merkle.length; i += 2) {
        var newHash = util.hash256(Buffer.concat([merkle[i], merkle[i + 1]]))
        newMerkle.push(newHash)

        if (bufferEqual(merkle[i], targetHash)) {
          result.push(util.hashEncode(merkle[i + 1]))
          targetHash = newHash
        } else if (bufferEqual(merkle[i + 1], targetHash)) {
          result.push(util.hashEncode(merkle[i]))
          targetHash = newHash
        }
      }
      merkle = newMerkle
    }

    return {height: block.height, tree: result, pos: block.tx.indexOf(txId)}

  }).catch(function (error) {
    if (error.code === -1) { throw new Error('BlockNotFound') }
    if (error.code === -5) { throw new Error('TransactionNotFound') }
    throw error
  })
}

/**
 * @param {number} nblocks
 * @return {Q.Promise}
 */
Blockchain.prototype.estimatefee = function (nblocks) {
  return this.bitcoind('estimatefee', nblocks).spread(function (fee) { return fee })
}


module.exports = Blockchain
