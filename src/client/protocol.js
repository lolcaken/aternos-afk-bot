"use strict";

// Protocol constants, packet ids, and the buffer reader/writer pair.
// See https://minecraft.wiki/w/Java_Edition_protocol/Packets

const PROTOCOL = 777;

// ---- state ids ----
const S_HANDSHAKE = 0;
const S_LOGIN = 1;
const S_CONFIG = 2;
const S_PLAY = 3;

// ---- packet ids ----
const ID = {
  // handshaking (serverbound)
  hs_handshake: 0x00,
  // login (serverbound)
  lo_hello: 0x00,
  lo_ack: 0x03,
  // login (clientbound)
  li_disconnect: 0x00,
  li_encryption_request: 0x01,
  li_login_success: 0x02,
  li_set_compression: 0x03,
  // configuration (serverbound)
  cs_client_info: 0x00,
  cs_finish: 0x03,
  cs_keepalive: 0x04,
  cs_pong: 0x05,
  cs_known_packs: 0x07,
  // configuration (clientbound)
  ci_custom_payload: 0x01,
  ci_disconnect: 0x02,
  ci_finish: 0x03,
  ci_keepalive: 0x04,
  ci_ping: 0x05,
  ci_known_packs: 0x0f,
  // play (serverbound)
  ps_confirm_teleport: 0x00,
  ps_chat_command: 0x07,
  ps_chat: 0x09,
  ps_tick_end: 0x0d,
  ps_client_info: 0x0e,
  ps_keepalive: 0x1c,
  ps_move_pos: 0x1e,
  ps_move_pos_rot: 0x1f,
  ps_loaded: 0x2c,
  ps_pong: 0x2d,
  // play (clientbound)
  pc_disconnect: 0x20,
  pc_keepalive: 0x2d,
  pc_login: 0x32,
  pc_ping: 0x3e,
  pc_system_chat: 0x7c,
  pc_sync_pos: 0x49,
};

// ---- buffer writer ----
class Writer {
  constructor() {
    this.parts = [];
  }
  byte(v) {
    this.parts.push(Buffer.from([v & 0xff]));
    return this;
  }
  bytes(b) {
    this.parts.push(b);
    return this;
  }
  string(s) {
    const b = Buffer.from(s, "utf8");
    this.varint(b.length).bytes(b);
    return this;
  }
  varint(v) {
    v = v | 0;
    let out = Buffer.alloc(5);
    let i = 0;
    for (; i < 5; i++) {
      if ((v & ~0x7f) === 0) {
        out[i] = v;
        out = out.slice(0, i + 1);
        break;
      }
      out[i] = (v & 0x7f) | 0x80;
      v >>>= 7;
    }
    if (i === 5) out = out.slice(0, 5);
    this.parts.push(out);
    return this;
  }
  unsignedShort(v) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(v & 0xffff, 0);
    this.parts.push(b);
    return this;
  }
  double(v) {
    const b = Buffer.alloc(8);
    b.writeDoubleBE(v, 0);
    this.parts.push(b);
    return this;
  }
  float(v) {
    const b = Buffer.alloc(4);
    b.writeFloatBE(v, 0);
    this.parts.push(b);
    return this;
  }
  long(v) {
    const b = Buffer.alloc(8);
    b.writeBigInt64BE(BigInt(v), 0);
    this.parts.push(b);
    return this;
  }
  uuid(b) {
    this.parts.push(b);
    return this;
  }
  buffer() {
    return Buffer.concat(this.parts);
  }
}

// ---- buffer reader ----
class Reader {
  constructor(buf, off = 0) {
    this.buf = buf;
    this.off = off;
  }
  get remaining() {
    return this.buf.length - this.off;
  }
  byte() {
    const v = this.buf[this.off++];
    if (v === undefined) throw new Error("reader underflow byte");
    return v;
  }
  varint() {
    let value = 0;
    let pos = 0;
    for (; pos < 32; pos += 7) {
      const c = this.byte();
      value |= (c & 0x7f) << pos;
      if ((c & 0x80) === 0) return value >>> 0;
    }
    throw new Error("VarInt too big");
  }
  string() {
    const len = this.varint();
    const s = this.buf.toString("utf8", this.off, this.off + len);
    this.off += len;
    return s;
  }
  bytes(n) {
    const b = this.buf.slice(this.off, this.off + n);
    this.off += n;
    return b;
  }
  short() {
    const v = this.buf.readInt16BE(this.off);
    this.off += 2;
    return v;
  }
  int() {
    const v = this.buf.readInt32BE(this.off);
    this.off += 4;
    return v;
  }
  long() {
    const v = this.buf.readBigInt64BE(this.off);
    this.off += 8;
    return v;
  }
  double() {
    const v = this.buf.readDoubleBE(this.off);
    this.off += 8;
    return v;
  }
  float() {
    const v = this.buf.readFloatBE(this.off);
    this.off += 4;
    return v;
  }
  boolean() {
    return this.byte() !== 0;
  }
  uuid() {
    return this.bytes(16);
  }
  // Skip n bytes of payload without interpreting them.
  skip(n) {
    this.off += n;
    return this;
  }
}

// Network NBT has an unnamed root. Unlike protocol Strings, NBT strings use
// unsigned-short lengths; lists and arrays use signed-int lengths.

module.exports = { PROTOCOL, S_HANDSHAKE, S_LOGIN, S_CONFIG, S_PLAY, ID, Writer, Reader };
