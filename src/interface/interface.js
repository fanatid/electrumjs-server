/**
 * @class Interface
 * @param {Blockchain} blockchain
 */
function Interface() {}

/**
 * @abstract
 * @return {Q.Promise}
 */
Interface.prototype.initialize = function() {}

/**
 * @abstract
 * @param {Client} Client
 */
Interface.prototype.newClient = function() { throw new Error('Not implemented yet') }


module.exports = Interface
