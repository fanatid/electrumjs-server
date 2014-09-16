/**
 * @class Transport
 * @param {Interface} interface
 */
function Transport() {}

/**
 * @abstract
 * @return {Q.Promise}
 */
Transport.prototype.initialize = function() {}


module.exports = Transport
