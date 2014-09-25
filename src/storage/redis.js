var inherits = require('util').inherits

var base58check = require('bs58check')
var bufferEqual = require('buffer-equal')
var config = require('config')
var Q = require('q')
var redis = require('redis')

var logger = require('../logger').logger

var Storage = require('./storage')
var storageVersion = require('../version').storage.redis


/**
 * @param {Buffer} value
 * @return {Object}
 */
function* addressValue2CoinKeys(value) {
  while (value.length > 0) {
    yield value.slice(0, 36)
    value = value.slice(36)
  }
}


/**
 * @class RedisStorage
 */
function RedisStorage() {
  Storage.call(this)

  this._isInialized = false
}

inherits(RedisStorage, Storage)

/**
 * @return {Q.Promise}
 */
RedisStorage.prototype.initialize = function() {
  var self = this
  if (self._isInialized)
    return Q()

  self._isInialized = true

  var deferred = Q.defer()
  Q.spawn(function* () {
    try {
      var serverNetwork = config.get('server.network')

      /** create client */
      self.client = redis.createClient(config.get('redis.port'), config.get('redis.host'), {
        auth_pass: config.get('redis.password'),
        return_buffers: true
      })
      self.hset = Q.nbind(self.client.hset, self.client)
      self.hget = Q.nbind(self.client.hget, self.client)

      /** create storage structure */
      var info = yield Q.ninvoke(self.client, 'hgetall', 'info')
      if (info === null)
        yield Q.ninvoke(self.client, 'hmset', 'info',
          'version', new Buffer(storageVersion),
          'network', new Buffer(serverNetwork))

      /** check version */
      var dbVersion = yield self.hget('info', 'version')
      if (!bufferEqual(dbVersion, new Buffer(storageVersion)))
        throw new Error('Storage version is ' + storageVersion + ', whereas db version is ' + dbVersion)

      /** check network */
      var dbNetwork = yield self.hget('info', 'network')
      if (!bufferEqual(dbNetwork, new Buffer(serverNetwork)))
        throw new Error('Server network is ' + serverNetwork + ', whereas db network is ' + dbNetwork)

      /** done */
      logger.info('Storage (Redis) ready')
      deferred.resolve()

    } catch (error) {
      deferred.reject(error)

    }
  })

  return deferred.promise
}

/**
 * @param {string} header
 * @param {number} [height]
 * @return {Q.Promise}
 */
RedisStorage.prototype.pushHeader = function(header) {
  return Q.ninvoke(this.client, 'rpush', 'headers', new Buffer(header, 'hex'))
}

/**
 * @return {Q.Promise}
 */
RedisStorage.prototype.popHeader = function() {
  return Q.ninvoke(this.client, 'rpop', 'headers')
}

/**
 * @return {Q.Promise}
 */
RedisStorage.prototype.getAllHeaders = function() {
  return Q.ninvoke(this.client, 'lrange', 'headers', 0, 1000000).then(function(headers) {
    return headers.map(function(header) { return header.toString('hex') })
  })
}

/**
 * @param {string} address
 * @param {string} cTxId
 * @param {number} cIndex
 * @param {number} cValue
 * @param {number} cHeight
 * @return {Q.Promise}
 */
RedisStorage.prototype.addCoin = function(address, cTxId, cIndex, cValue, cHeight) {
  var self = this

  var addressBuf = base58check.decode(address)
  var cTxIdBuf = new Buffer(cTxId, 'hex')
  var cIndexBuf = new Buffer(4)
  cIndexBuf.writeUInt32BE(cIndex, 0)
  var cValueBuf = new Buffer(8)
  cValueBuf.writeUInt32BE(~~(cValue/4294967296), 0)
  cValueBuf.writeUInt32BE(cValue%4294967296, 4)
  var cHeightBuf = new Buffer(4)
  cHeightBuf.writeUInt32BE(cHeight, 0)

  var coinKey = Buffer.concat([cTxIdBuf, cIndexBuf])
  var coinValue = Buffer.concat([addressBuf, cValueBuf, cHeightBuf])

  var promise1 = self.hset('coins', coinKey, coinValue)
  var promise2 = self.hget('addrs', addressBuf).then(function(coins) {
    if (coins === null)
      coins = new Buffer(0)

    return self.hset('addrs', addressBuf, Buffer.concat([coins, coinKey]))
  })

  return Q.all([promise1, promise2])
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
RedisStorage.prototype.removeCoin = function(cTxId, cIndex) {
  var self = this

  var cTxIdBuf = new Buffer(cTxId, 'hex')
  var cIndexBuf = new Buffer(4)
  cIndexBuf.writeUInt32BE(cIndex, 0)

  var coinKey = Buffer.concat([cTxIdBuf, cIndexBuf])

  var deferred = Q.defer()
  Q.spawn(function* () {
    try {
      var coinValue = yield self.hget('coins', coinKey)
      if (coinValue === null)
        return

      var address = coinValue.slice(0, 21)
      var addressValue = yield self.hget('addrs', address)

      var newKeys = []
      for (var coinKey2 of addressValue2CoinKeys(addressValue)) {
        if (!bufferEqual(coinKey, coinKey2))
          newKeys.push(coinKey2)
      }
      if (newKeys.length > 0)
        yield self.hset('addrs', address, Buffer.concat(newKeys))

      yield Q.ninvoke(self.client, 'hdel', 'coins', coinKey)

      deferred.resolve()

    } catch(error) {
      deferred.reject(error)

    }
  })
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @param {string} sTxId
 * @param {number} sHeight
 * @return {Q.Promise}
 */
RedisStorage.prototype.setSpent = function(cTxId, cIndex, sTxId, sHeight) {
  var self = this

  var cTxIdBuf = new Buffer(cTxId, 'hex')
  var cIndexBuf = new Buffer(4)
  cIndexBuf.writeUInt32BE(cIndex, 0)
  var sTxIdBuf = new Buffer(sTxId, 'hex')
  var sHeightBuf = new Buffer(4)
  sHeightBuf.writeUInt32BE(sHeight, 0)

  var coinKey = Buffer.concat([cTxIdBuf, cIndexBuf])
  return self.hget('coins', coinKey).then(function(coinValue) {
    return self.hset('coins', coinKey, Buffer.concat([coinValue, sTxIdBuf, sHeightBuf]))
  })
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 */
RedisStorage.prototype.setUnspent = function(cTxId, cIndex) {
  var self = this

  var cTxIdBuf = new Buffer(cTxId, 'hex')
  var cIndexBuf = new Buffer(4)
  cIndexBuf.writeUInt32BE(cIndex, 0)

  var coinKey = Buffer.concat([cTxIdBuf, cIndexBuf])
  return self.hget('coins', coinKey).then(function(coinValue) {
    return self.hset('coins', coinKey, coinValue.slice(0, 33))
  })
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
RedisStorage.prototype.getAddress = function(cTxId, cIndex) {
  var cTxIdBuf = new Buffer(cTxId, 'hex')
  var cIndexBuf = new Buffer(4)
  cIndexBuf.writeUInt32BE(cIndex, 0)

  var coinKey = Buffer.concat([cTxIdBuf, cIndexBuf])
  return this.hget('coins', coinKey).then(function(coinValue) {
    if (coinValue === null)
      return null

    return base58check.encode(coinValue.slice(0, 21))
  })
}

/**
 * @param {string} address
 * @return {Q.Promise}
 */
RedisStorage.prototype.getCoins = function(address) {
  var self = this

  var deferred = Q.defer()
  Q.spawn(function* () {
    try {
      var addressValue = (yield self.hget('addrs', base58check.decode(address))) || new Buffer(0)

      var coins = []
      for (var coinKey of addressValue2CoinKeys(addressValue)) {
        var coinValue = yield self.hget('coins', coinKey)

        var coin = {
          cTxId: coinKey.slice(0, 32).toString('hex'),
          cIndex: coinKey.readUInt32BE(32),
          cValue: coinValue.readUInt32BE(21)*4294967296 + coinValue.readUInt32BE(25),
          cHeight: coinValue.readUInt32BE(29),
          sTxId: null,
          sHeight: null
        }
        if (coinValue.length > 33) {
          coin.sTxId = coinValue.slice(33, 65).toString('hex')
          coin.sHeight = coinValue.readUInt32BE(65)
        }
        coins.push(coin)
      }

      deferred.resolve(coins)

    } catch(error) {
      deferred.reject(error)

    }
  })
  return deferred.promise
}


module.exports = RedisStorage
