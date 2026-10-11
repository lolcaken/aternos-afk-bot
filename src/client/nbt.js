"use strict";

// Network NBT: unnamed-root tags with unsigned-short string lengths and
// signed-int list/array lengths. Used to decode text components, which is
// how the server reports kick and disconnect reasons.

function nbtString(r) {
  if (r.remaining < 2) throw new Error("truncated NBT string length");
  const length = r.buf.readUInt16BE(r.off);
  r.off += 2;
  if (r.remaining < length) throw new Error("truncated NBT string");
  return r.bytes(length).toString("utf8");
}

function nbtLength(r) {
  const length = r.int();
  if (length < 0 || length > 65536) throw new Error("invalid NBT length");
  return length;
}

function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object") {
    return textOf(value.text || "") + textOf(value.extra || []);
  }
  return "";
}

function readTextComponent(r) {
  try {
    return textOf(readTagValue(r, r.byte(), 0));
  } catch (e) {
    return "";
  }
}

function readTagValue(r, typeId, depth) {
  if (depth > 16) throw new Error("NBT nesting too deep");
  switch (typeId) {
    case 0x01: // Byte
      return r.byte();
    case 0x02: // Short
      return r.short();
    case 0x03: // Int
      return r.int();
    case 0x04: // Long
      return r.long();
    case 0x05: // Float
      return r.float();
    case 0x06: // Double
      return r.double();
    case 0x07: // Byte Array
      return r.bytes(nbtLength(r));
    case 0x08: // String
      return nbtString(r);
    case 0x09: { // List
      const elType = r.byte();
      const len = nbtLength(r);
      const out = [];
      for (let i = 0; i < len; i++) {
        out.push(readTagValue(r, elType, depth + 1));
      }
      return out;
    }
    case 0x0a: { // Compound
      const out = {};
      let count = 0;
      while (count++ < 256) {
        const childType = r.byte();
        if (childType === 0) return out;
        out[nbtString(r)] = readTagValue(r, childType, depth + 1);
      }
      throw new Error("NBT compound too large");
    }
    case 0x0b: {
      const len = nbtLength(r);
      const out = [];
      for (let i = 0; i < len; i++) out.push(r.int());
      return out;
    }
    case 0x0c: {
      const len = nbtLength(r);
      const out = [];
      for (let i = 0; i < len; i++) out.push(r.long());
      return out;
    }
    default:
      // Unknown type: bail out of the whole component rather than guess.
      throw new Error("unknown NBT tag 0x" + typeId.toString(16));
  }
}


module.exports = { readTextComponent };
