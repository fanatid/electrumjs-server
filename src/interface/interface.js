/**
 * @class Interface
 * @param {Blockchain} blockchain
 */
function Interface() {}

/**
 * @abstract
 * @param {Client} Client
 */
Interface.prototype.newClient = function() { throw new Error('Not implemented yet') }


module.exports = Interface
