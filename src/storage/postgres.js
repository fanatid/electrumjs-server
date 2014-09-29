var inherits = require('util').inherits

var base58check = require('bs58check')
var config = require('config')
var _ = require('lodash')
var pg = require('pg')
var QueryStream = require('pg-query-stream')
var Q = require('q')

var logger = require('../logger').logger

var Storage = require('./storage')
var storageVersion = require('../version').storage.postgres


var SQL_INFO_EXISTS = [
  'SELECT ',
  '   * ',
  ' FROM pg_catalog.pg_class c ',
  '   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace ',
  ' WHERE ',
  '   n.nspname = \'public\'',
  '   AND c.relname = \'info\'',
].join('')

var SQL_INFO_CREATE_TABLE = [
  'CREATE TABLE ',
  ' info ( ',
  '   key char(255) PRIMARY KEY, ',
  '   value text NOT NULL ',
  ' )'
].join('')

var SQL_HEADERS_CREATE_TABLE = [
  'CREATE TABLE ',
  ' headers ( ',
  '   height INTEGER PRIMARY KEY, ',
  '   header char(160) NOT NULL ',
  ' )'
].join('')

var SQL_HISTORY_CREATE_TABLE = [
  'CREATE TABLE ',
  ' history ( ',
  '   address BYTEA NOT NULL, ',
  '   cTxId   BYTEA NOT NULL, ',
  '   cIndex  BIGINT NOT NULL, ',
  '   cValue  BIGINT NOT NULL, ',
  '   cHeight INTEGER NOT NULL, ',
  '   sTxId   BYTEA, ',
  '   sHeight INTEGER ',
  ' ) '
].join('')


/**
 * @class PostgresStorage
 */
function PostgresStorage() {
  Storage.call(this)

  this._isInialized = false
}

inherits(PostgresStorage, Storage)

/**
 * @return {Q.Promise}
 */
PostgresStorage.prototype.initialize = function() {
  var self = this
  if (self._isInialized)
    return Q()

  self._isInialized = true

  var deferred = Q.defer()
  Q.spawn(function* () {
    try {
      var row
      var serverNetwork = config.get('server.network')

      /** connect to db */
      self.client = new pg.Client(config.get('postgres.url'))
      yield Q.ninvoke(self.client, 'connect')
      self.query = Q.nbind(self.client.query, self.client)

      /** create tables */
      if ((yield self.query(SQL_INFO_EXISTS)).rowCount === 0) {
        yield self.query(SQL_INFO_CREATE_TABLE)
        yield self.query('INSERT INTO info (key, value) VALUES ($1, $2)', ['version', JSON.stringify(storageVersion)])
        yield self.query('INSERT INTO info (key, value) VALUES ($1, $2)', ['network', JSON.stringify(serverNetwork)])

        yield self.query(SQL_HEADERS_CREATE_TABLE)

        yield self.query(SQL_HISTORY_CREATE_TABLE)
        yield self.query('CREATE INDEX history_address_idx ON history (address)')
        yield self.query('CREATE INDEX history_ctxid_cindex_idx ON history (cTxId, cIndex)')
        yield self.query('CREATE INDEX history_cheight_idx ON history (cHeight)')
        yield self.query('CREATE INDEX history_sheight_idx ON history (sHeight)')

      }

      /** check version */
      row = (yield self.query('SELECT value FROM info WHERE key = $1', ['version'])).rows[0]
      var dbVersion = JSON.parse(row.value)
      if (dbVersion !== storageVersion)
        throw new Error('Storage version is ' + storageVersion + ', whereas db version is ' + dbVersion)

      /** check network */
      row = (yield self.query('SELECT value FROM info WHERE key = $1', ['network'])).rows[0]
      var dbNetwork = JSON.parse(row.value)
      if (dbNetwork !== serverNetwork)
        throw new Error('Server network is ' + serverNetwork + ', whereas db network is ' + dbNetwork)

      /** done */
      logger.info('Storage (PostgreSQL) ready')
      deferred.resolve()

    } catch (error) {
      deferred.reject(error)

    }
  })

  return deferred.promise
}

/**
 * @param {string} header
 * @param {number} height
 * @return {Q.Promise}
 */
PostgresStorage.prototype.pushHeader = function(header, height) {
  var sql = 'INSERT INTO headers (height, header) VALUES ($1, $2)'
  var params = [height, header]

  return this.query(sql, params)
}

/**
 * @return {Q.Promise}
 */
PostgresStorage.prototype.popHeader = function() {
  var sql = 'DELETE FROM headers WHERE height IN (SELECT height FROM headers ORDER BY height DESC LIMIT 1)'

  return this.query(sql)
}

/**
 * @return {Q.Promise}
 */
PostgresStorage.prototype.getAllHeaders = function() {
  var sql = 'SELECT header FROM headers ORDER BY height'
  var stream = this.client.query(new QueryStream(sql))

  var headers = []
  stream.on('data', function(row) { headers.push(row.header) })

  var deferred = Q.defer()
  stream.on('error', function(error) { deferred.reject(error) })
  stream.on('end', function() { deferred.resolve(headers) })
  return deferred.promise
}

/**
 * @param {string} address
 * @param {string} cTxId
 * @param {number} cIndex
 * @param {number} cValue
 * @param {number} cHeight
 * @return {Q.Promise}
 */
PostgresStorage.prototype.addCoin = function(address, cTxId, cIndex, cValue, cHeight) {
  var sql = 'INSERT INTO history (address, cTxId, cIndex, cValue, cHeight) VALUES ($1, $2, $3, $4, $5)'
  var params = [base58check.decode(address), new Buffer(cTxId, 'hex'), cIndex, cValue, cHeight]

  return this.query(sql, params)
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
PostgresStorage.prototype.removeCoin = function(cTxId, cIndex) {
  var sql = 'DELETE FROM history WHERE cTxId=$1 AND cIndex=$2'
  var params = [new Buffer(cTxId, 'hex'), cIndex]

  return this.query(sql, params)
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @param {string} sTxId
 * @param {number} sHeight
 * @return {Q.Promise}
 */
PostgresStorage.prototype.setSpent = function(cTxId, cIndex, sTxId, sHeight) {
  var sql = 'UPDATE history SET sTxId=$3, sHeight=$4 WHERE cTxId=$1 AND cIndex=$2'
  var params = [new Buffer(cTxId, 'hex'), cIndex, new Buffer(sTxId, 'hex'), sHeight]

  return this.query(sql, params)
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
PostgresStorage.prototype.setUnspent = function(cTxId, cIndex) {
  var sql = 'UPDATE history SET sTxId=$3, sHeight=$4 WHERE cTxId=$1 AND cIndex=$2'
  var params = [new Buffer(cTxId, 'hex'), cIndex, null, null]

  return this.query(sql, params)
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
PostgresStorage.prototype.getAddresses = function(cTxId, cIndex) {
  var sql = 'SELECT address FROM history WHERE cTxId = $1 AND cIndex = $2'
  var params = [new Buffer(cTxId, 'hex'), cIndex]
  var stream = this.client.query(new QueryStream(sql, params))

  var addresses = []
  stream.on('data', function(row) { addresses.push(base58check.encode(row.address)) })

  var deferred = Q.defer()
  stream.on('error', function(error) { deferred.reject(error) })
  stream.on('end', function() { deferred.resolve(addresses.length > 0 ? addresses : null) })
  return deferred.promise
}

/**
 * @param {number} height
 * @return {Q.Promise}
 */
PostgresStorage.prototype.getTouchedAddresses = function(height) {
  var sql = 'SELECT DISTINCT address FROM history WHERE cHeight = $1 OR sHeight = $1'
  var params = [height]
  var stream = this.client.query(new QueryStream(sql, params))

  var addresses = []
  stream.on('data', function(row) { addresses.push(base58check.encode(row.address)) })

  var deferred = Q.defer()
  stream.on('error', function(error) { deferred.reject(error) })
  stream.on('end', function() { deferred.resolve(addresses) })
  return deferred.promise
}

/**
 * @param {string} address
 * @return {Q.Promise}
 */
PostgresStorage.prototype.getCoins = function(address) {
  var sql = 'SELECT * FROM history WHERE address = $1'
  var params = [base58check.decode(address)]
  var stream = this.client.query(new QueryStream(sql, params))

  var coins = []
  stream.on('data', function(row) {
    var coin = {
      cTxId: row.ctxid.toString('hex'),
      cIndex: parseInt(row.cindex),
      cValue: parseInt(row.cvalue),
      cHeight: row.cheight,
      sTxId: null,
      sHeight: null
    }

    if (row.stxid !== null)
      coin = _.extend(coin, { sTxId: row.stxid.toString('hex'), sHeight: row.sheight })

    coins.push(coin)
  })

  var deferred = Q.defer()
  stream.on('error', function(error) { deferred.reject(error) })
  stream.on('end', function() { deferred.resolve(coins) })
  return deferred.promise
}


module.exports = PostgresStorage
