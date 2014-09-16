/**
 * @class Storage
 */
function Storage() {}

/**
 * @abstract
 * @return {Q.Promise}
 */
Storage.prototype.initialize = function() {}

/**
 * @abstract
 * @param {string} header
 * @param {number} [height]
 * @return {Q.Promise}
 */
Storage.prototype.pushHeader = function() {}

/**
 * @abstract
 * @return {Q.Promise}
 */
Storage.prototype.popHeader = function() {}

/**
 * @abstract
 * @return {Q.Promise}
 */
Storage.prototype.getAllHeaders = function() {}

/**
 * @abstract
 * @param {string} address
 * @param {string} cTxId
 * @param {number} cIndex
 * @param {number} cValue
 * @param {number} cHeight
 * @return {Q.Promise}
 */
Storage.prototype.addCoin = function(address, cTxId, cIndex, cValue, cHeight) {}

/**
 * @abstract
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
Storage.prototype.removeCoin = function(cTxId, cIndex) {}

/**
 * @abstract
 * @param {string} cTxId
 * @param {number} cIndex
 * @param {string} sTxId
 * @param {number} sIndex
 * @param {number} sHeight
 * @return {Q.Promise}
 */
Storage.prototype.setSpent = function(cTxId, cIndex, sTxId, sIndex, sHeight) {}

/**
 * @abstract
 * @param {string} sTxId
 * @param {number} sIndex
 */
Storage.prototype.setUnspent = function(cTxId, cIndex) {}

/**
 * @abstract
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
Storage.prototype.getAddress = function(cTxId, cIndex) {}

/**
 * @abstract
 * @param {string} address
 * @return {Q.Promise}
 */
Storage.prototype.getBalance = function(address) {}

/**
 * @abstract
 * @param {string} address
 * @return {Q.Promise}
 */
Storage.prototype.getCoins = function(address) {}

/**
 * @abstract
 * @param {string} address
 * @return {Q.Promise}
 */
Storage.prototype.getUnspentCoins = function(address) {}


module.exports = Storage
