import { crc32, deflateRawSync } from 'node:zlib'

// Minimal ZIP writer. A .tapestry is a zip, and the only entry phase 1 emits is
// root.json, so a full archiver dependency would be overkill. Node 22+ ships
// zlib.crc32, which is the only awkward part of writing a zip by hand.

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const END_SIG = 0x06054b50
const DEFLATED = 8

/**
 * @param {{name: string, data: Buffer|string}[]} entries
 * @returns {Buffer}
 */
export function makeZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const compressed = deflateRawSync(raw)
    const sum = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(DEFLATED, 8)
    local.writeUInt16LE(0, 10) // mod time — fixed, so output is reproducible
    local.writeUInt16LE(33, 12) // mod date — 1980-01-01
    local.writeUInt32LE(sum, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra field length
    locals.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_SIG, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8) // flags
    central.writeUInt16LE(DEFLATED, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(33, 14)
    central.writeUInt32LE(sum, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + compressed.length
  }

  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(END_SIG, 0)
  end.writeUInt16LE(0, 4) // disk number
  end.writeUInt16LE(0, 6) // disk with central dir
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...locals, centralBuf, end])
}
