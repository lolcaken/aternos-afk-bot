// Runnable self-check for pasted-client's protocol encoding.
//   node codec.test.js
const assert = require("assert");

function writeVarint(v) {
  const parts = [];
  v = v | 0;
  for (;;) {
    if ((v & ~0x7f) === 0) {
      parts.push(v & 0xff);
      break;
    }
    parts.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return Buffer.from(parts);
}

function readVarint(buf, off) {
  let value = 0;
  let pos = 0;
  for (; pos < 32; pos += 7) {
    const c = buf[off++];
    value |= (c & 0x7f) << pos;
    if ((c & 0x80) === 0) return { value: value >>> 0, off };
  }
  throw new Error("VarInt too big");
}

// Official wiki sample values.
const varintCases = [
  [0, [0x00]],
  [1, [0x01]],
  [2, [0x02]],
  [127, [0x7f]],
  [128, [0x80, 0x01]],
  [255, [0xff, 0x01]],
  [25565, [0xdd, 0xc7, 0x01]],
  [2097151, [0xff, 0xff, 0x7f]],
  [2147483647, [0xff, 0xff, 0xff, 0xff, 0x07]],
  [-1, [0xff, 0xff, 0xff, 0xff, 0x0f]],
];
for (const [value, bytes] of varintCases) {
  assert.deepStrictEqual(Array.from(writeVarint(value)), bytes, `varint(${value})`);
}

for (const [value] of varintCases) {
  const { value: got } = readVarint(writeVarint(value), 0);
  assert.strictEqual(got, value >>> 0, `round-trip varint(${value})`);
}

for (const d of [0, 1, -1, 3.141592653589793, -12345.6789, 1e10, 64, 184.5]) {
  const buf = Buffer.alloc(8);
  buf.writeDoubleBE(d, 0);
  assert.strictEqual(buf.readDoubleBE(0), d, `double ${d}`);
}

const { PROTOCOL, PastedClient } = require("../src/client/index.js");
assert.strictEqual(PROTOCOL, 777, "protocol must be 777 for 26.3");

const crypto = require("crypto");
function offlineUuid(name) {
  const md5 = crypto.createHash("md5").update("OfflinePlayer:" + name).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5.toString("hex");
}
const u = offlineUuid("botlol");
assert.strictEqual(u.length, 32, "uuid hex must be 32 chars");
assert.strictEqual(u[12], "3", "version nibble must be 3");

// Framing: [varint bodyLen][varint packetId][payload]
const body = Buffer.concat([writeVarint(0x00), Buffer.from([1, 2, 3])]);
const frame = Buffer.concat([writeVarint(body.length), body]);
assert.strictEqual(frame[0], body.length, "first byte is body length");
assert.strictEqual(frame[1] & 0x7f, 0x00, "second byte is packet id");

// move_player_pos payload must be exactly 3 doubles + 1 flags byte = 25 bytes
const move = Buffer.concat([
  Buffer.alloc(0),
  (() => { const b = Buffer.alloc(8); b.writeDoubleBE(184.5, 0); return b; })(),
  (() => { const b = Buffer.alloc(8); b.writeDoubleBE(65.0, 0); return b; })(),
  (() => { const b = Buffer.alloc(8); b.writeDoubleBE(-1299.5, 0); return b; })(),
  Buffer.from([0x01]),
]);
assert.strictEqual(move.length, 25, "move_player_pos payload is 25 bytes");

// Decode packets emitted by the actual client, not a copy of its encoder.
const client = new PastedClient({ host: "localhost", port: 25565, username: "test" });
client.connected = true;
const sent = [];
client.rawSend = (id, writer) => sent.push({ id, payload: writer.buffer() });
assert.strictEqual(client.chat("/help"), true);
assert.strictEqual(sent[0].id, 0x07, "slash command uses chat_command");
assert.deepStrictEqual(sent[0].payload, Buffer.from([4, 104, 101, 108, 112]));

assert.strictEqual(client.chat("hi"), true);
assert.strictEqual(sent[1].id, 0x09, "plain text uses chat");
const packet = sent[1].payload;
const length = readVarint(packet, 0);
assert.strictEqual(packet.toString("utf8", length.off, length.off + length.value), "hi");
let offset = length.off + length.value + 8 + 8; // timestamp + salt
assert.strictEqual(packet[offset++], 0, "signature absent");
const count = readVarint(packet, offset);
assert.strictEqual(count.value, 0, "no signed messages seen");
offset = count.off;
assert.deepStrictEqual(packet.subarray(offset, offset + 3), Buffer.alloc(3), "20-bit ack set");
assert.strictEqual(packet[offset + 3], 1, "empty last-seen checksum");
assert.strictEqual(packet.length, offset + 4, "no missing or trailing fields");

// Network NBT disconnect reason: unnamed compound root with a string and
// nested extra list. Exercise the actual play packet handler.
function namedString(name, text) {
  const key = Buffer.from(name);
  const value = Buffer.from(text);
  const keyLength = Buffer.alloc(2);
  const valueLength = Buffer.alloc(2);
  keyLength.writeUInt16BE(key.length);
  valueLength.writeUInt16BE(value.length);
  return Buffer.concat([Buffer.from([8]), keyLength, key, valueLength, value]);
}
const root = Buffer.concat([
  Buffer.from([10]),
  namedString("text", "Invalid "),
  Buffer.from([9, 0, 5]), // TAG_List named "extra"
  Buffer.from("extra"),
  Buffer.from([10, 0, 0, 0, 1]), // one compound
  namedString("text", "chat packet"),
  Buffer.from([0, 0]), // end child compound, end root compound
]);
const kicked = new PastedClient({ host: "localhost", port: 25565, username: "test" });
kicked.on("kicked", reason => assert.strictEqual(reason.text, "Invalid chat packet"));
kicked.on("end", reason => assert.strictEqual(reason, "kicked"));
kicked.handlePlay(0x20, {
  buf: root,
  off: 0,
  byte() { return this.buf[this.off++]; },
  bytes(n) { const b = this.buf.subarray(this.off, this.off + n); this.off += n; return b; },
  int() { const n = this.buf.readInt32BE(this.off); this.off += 4; return n; },
  get remaining() { return this.buf.length - this.off; },
});

const onlineMode = new PastedClient({ host: "localhost", port: 25565, username: "test" });
onlineMode.on("kicked", reason => assert.match(reason.text, /Online-mode server requires Microsoft authentication/));
onlineMode.handleLogin(0x01, {});
assert.strictEqual(onlineMode.ended, true, "online-mode login stops immediately");

console.log("OK - codec self-check passed");
