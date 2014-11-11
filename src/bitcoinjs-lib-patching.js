var assert = require('assert')

var bitcoin = require('bitcoinjs-lib')
var bufferutils = bitcoin.bufferutils
var opcodes = bitcoin.opcodes


/**
 * @param {Buffer} buffer
 * @param {number} offset
 * @param {number} size Only 1, 2, 4
 * @return {number}
 * @throws {RangeError}
 */
function readNumber(buffer, offset, size) {
  buffer = buffer.slice(offset, offset + size)
  if (buffer.length < size) {
    buffer = Buffer.concat([buffer, new Buffer([0, 0, 0, 0])])
  }

  switch (size) {
    case 1:
      return buffer.readUInt8(0)

    case 2:
      return buffer.readUInt16LE(0)

    case 4:
      return buffer.readUInt32LE(0)

    default:
      throw new RangeError('Wrong size')
  }
}

/**
 * Input script invalid
 *
 * Example:
 *  tx: b538afeb33dc482af0c2dfd33a0365ce1198e68355dd2022355a55840c59f545
 *  script: 03ec92000450ab31ff4e070000
 */
bufferutils.readPushDataInt = function (buffer, offset) {
  var opcode = buffer.readUInt8(offset)
  var number
  var size

  // ~6 bit
  if (opcode < opcodes.OP_PUSHDATA1) {
    number = opcode
    size = 1

  // 8 bit
  } else if (opcode === opcodes.OP_PUSHDATA1) {
    number = readNumber(buffer, offset + 1, 1)
    size = 2

  // 16 bit
  } else if (opcode === opcodes.OP_PUSHDATA2) {
    number = readNumber(buffer, offset + 1, 2)
    size = 3

  // 32 bit
  } else {
    assert.equal(opcode, opcodes.OP_PUSHDATA4, 'Unexpected opcode')

    number = readNumber(buffer, offset + 1, 4)
    size = 5
  }

  return {
    opcode: opcode,
    number: number,
    size: size
  }
}
