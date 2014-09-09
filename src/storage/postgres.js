var base58check = require('bs58check')
var config = require('config')
var _ = require('lodash')
var pg = require('pg')
var Q = require('q')

var util = require('../util')
var storageVersion = require('./version')


var SQL_INFO_EXISTS = '\
SELECT * \
FROM   pg_catalog.pg_class c \
JOIN   pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
WHERE  n.nspname = \'public\' \
AND    c.relname = \'info\' \
'

var SQL_INFO_CREATE_TABLE = '\
CREATE TABLE info ( \
  key   char(255) PRIMARY KEY, \
  value text NOT NULL \
)'

var SQL_HEADERS_CREATE_TABLE = '\
CREATE TABLE headers ( \
  height INTEGER PRIMARY KEY, \
  header char(160) NOT NULL \
)'

var SQL_HISTORY_CREATE_TABLE = '\
CREATE TABLE history ( \
  address BYTEA NOT NULL, \
  cTxId   BYTEA NOT NULL, \
  cIndex  BIGINT NOT NULL, \
  cValue  BIGINT NOT NULL, \
  cHeight INTEGER NOT NULL, \
  sTxId   BYTEA, \
  sIndex  BIGINT, \
  sHeight INTEGER, \
  PRIMARY KEY (cTxId, cIndex) \
)'

var SQL_HISTORY_CREATE_INDEX_ADDRESS = 'CREATE INDEX history_address_idx ON history (address)'


/**
 * @callback PostgresStorage~constructor
 * @param {?Error} error
 */

/**
 * @class PostgresStorage
 * @param {PostgresStorage~constructor} readyCallback
 */
function PostgresStorage(readyCallback) {
  var self = this

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
        yield self.query(SQL_HISTORY_CREATE_INDEX_ADDRESS)

      }

      /** check version */
      row = (yield self.query('SELECT value FROM info WHERE key = $1', ['version'])).rows[0]
      var dbVersion = JSON.parse(row.value)
      if (dbVersion !== storageVersion)
        throw new Error('Storage version is ' + storageVersion + ', whereas db version is ' + dbVersion)

      /** check network */
      row = (yield self.query('SELECT value FROM info WHERE key = $1', ['network'])).rows[0]
      var network = JSON.parse(row.value)
      if (network !== serverNetwork)
        throw new Error('Server network is ' + serverNetwork + ', whereas db network is ' + network)

      /** done */
      readyCallback(null)

    } catch (error) {
      readyCallback(error)

    }
  })
}

/**
 * Create new PostgresStorage
 * @return {Q.Promise}
 */
PostgresStorage.createPostgresStorage = function() {
  return Q.Promise(function(resolve, reject) {
    var postgresStorage

    function readyCallback(error) {
      if (error === null)
        resolve(postgresStorage)
      else
        reject(error)
    }

    postgresStorage = new PostgresStorage(readyCallback)
  })
}

/**
 * @param {number} height
 * @param {string} header
 * @return {Q.Promise}
 */
PostgresStorage.prototype.pushHeader = function(height, header) {
  return this.query('INSERT INTO headers (height, header) VALUES ($1, $2)', [height, header])
}

/**
 * @return {Q.Promise}
 */
PostgresStorage.prototype.popHeader = function() {
  return this.query('DELETE FROM headers WHERE height IN (SELECT height FROM headers ORDER BY height DESC LIMIT 1)')
}

/**
 * @return {Q.Promise}
 */
PostgresStorage.prototype.getAllHeaders = function() {
  return this.query('SELECT header FROM headers ORDER BY height').then(function(result) {
    return _.pluck(result.rows, 'header')
  })
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
PostgresStorage.prototype.getAddress = function(cTxId, cIndex) {
  var values = [new Buffer(cTxId, 'hex'), cIndex]
  return this.query('SELECT address FROM history WHERE cTxId = $1 AND cIndex = $2', values).then(function(result) {
    if (result.rowCount === 0)
      return null

    return base58check.encode(result.rows[0].address)
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
PostgresStorage.prototype.addCoin = function(address, cTxId, cIndex, cValue, cHeight) {
  var values = [base58check.decode(address), new Buffer(cTxId, 'hex'), cIndex, cValue, cHeight]
  return this.query(
    'INSERT INTO history (address, cTxId, cIndex, cValue, cHeight) VALUES ($1, $2, $3, $4, $5)', values)
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
PostgresStorage.prototype.removeCoin = function(cTxId, cIndex) {
  var values = [new Buffer(cTxId, 'hex'), cIndex]
  return this.query('DELETE FROM history WHERE cTxId=$1 AND cIndex=$2', values)
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @param {string} sTxId
 * @param {number} sIndex
 * @param {number} sHeight
 * @return {Q.Promise}
 */
PostgresStorage.prototype.setSpent = function(cTxId, cIndex, sTxId, sIndex, sHeight) {
  var values = [new Buffer(cTxId, 'hex'), cIndex, new Buffer(sTxId, 'hex'), sIndex, sHeight]
  return this.query('UPDATE history SET sTxId=$3, sIndex=$4, sHeight=$5 WHERE cTxId=$1 AND cIndex=$2', values)
}

/**
 * @param {string} sTxId
 * @param {number} sIndex
 */
PostgresStorage.prototype.setUnspent = function(sTxId, sIndex) {
  var values = [new Buffer(cTxId, 'hex'), cIndex, null, null, null]
  return this.query('UPDATE history SET sTxId=$3, sIndex=$4, sHeight=$5 WHERE cTxId=$1 AND cIndex=$2', values)
}


module.exports = PostgresStorage
