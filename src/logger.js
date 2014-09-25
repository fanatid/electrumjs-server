var config = require('config')
var winston = require('winston')


var logger = new winston.Logger({
  transports: [
    new winston.transports.Console({
      level: 'error',
      colorize: true,
      timestamp: true
    }),
  ]
})
logger.transports.console.level = config.get('server.loggerLevel')


module.exports.logger = logger
