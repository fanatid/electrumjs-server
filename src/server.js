var _ = require('lodash')
var Q = require('q')

/** config localtion */
process.env.NODE_CONFIG_DIR = _.isUndefined(process.env.NODE_CONFIG_DIR) ? './' : process.env.NODE_CONFIG_DIR
/** config filename */
process.env.NODE_ENV = _.isUndefined(process.env.NODE_ENV) ? 'config' : process.env.NODE_ENV
/** load config */
var config = require('config')

/** bitcoinjs-lib monkey patching */
require('./bitcoinjs-lib-patching')


var Blockchain = require('./blockchain')
var Electrum = require('./interface/electrum')


Q.spawn(function* () {
  try {
    if (!_.isUndefined(global.gc))
      setInterval(global.gc, 10*1000)

    var blockchain = new Blockchain()
    yield blockchain.initialize()

    var interfaces = []
    if (config.get('server.interface').indexOf('electrum') !== -1)
      interfaces.push(new Electrum(blockchain))

    if (interfaces.length === 0)
      throw new Error('Interfaces not found')

    yield Q.all(interfaces.map(function(obj) { return obj.initialize() }))
    console.log('Server ready')

  } catch (error) {
    console.log(error)
    process.kill(process.pid, 'SIGINT') // wait blockchain

  }
})
