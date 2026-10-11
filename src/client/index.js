"use strict";

// Minecraft 26.3 (protocol 777) client: connection lifecycle, login,
// configuration and play states, and the packet loop.

const net = require("net");
const zlib = require("zlib");
const crypto = require("crypto");
const { EventEmitter } = require("events");

const { PROTOCOL, S_HANDSHAKE, S_LOGIN, S_CONFIG, S_PLAY, ID, Writer, Reader } = require("./protocol");
const { readTextComponent } = require("./nbt");

function offlineUuid(name) {
  const md5 = crypto.createHash("md5").update("OfflinePlayer:" + name).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5;
}

function uuidString(buf) {
  const h = buf.toString("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    h.slice(12, 16),
    h.slice(16, 20),
    h.slice(20),
  ].join("-");
}

// ============================================================
// CLIENT
// ============================================================
class PastedClient extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
    this.host = opts.host;
    this.port = opts.port;
    this.username = opts.username;
    this.version = "26.3";

    this.socket = null;
    this.state = S_HANDSHAKE;
    this.compressed = false;
    this.threshold = -1;
    this.buf = Buffer.alloc(0);
    this.connected = false;
    this.ended = false;

    this.entity = { position: { x: 0, y: 0, z: 0 } };
    this.players = {};
    this.maxPlayers = null;
    this.entityId = null;
    this.hasSpawned = false;

    this.moveTimer = null;
    this.tickTimer = null;
    this.teleportId = null;
  }

  trace(msg) {
    if (process.env.PASTED_TRACE) {
      process.stdout.write("[trace] " + msg + "\n");
    }
  }

  connect() {
    if (this.ended) return;
    this.socket = net.createConnection({ host: this.host, port: this.port });
    this.socket.setNoDelay(true);
    this.socket.on("connect", () => this.onConnect());
    this.socket.on("data", (d) => this.onData(d));
    this.socket.on("error", (e) => this.handleError(e));
    this.socket.on("close", () => this.onClose());
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.connected = false;
    this.stopTimers();
    try {
      if (this.socket) this.socket.destroy();
    } catch (e) {}
  }

  handleError(e) {
    this.emit("error", e);
  }

  onClose() {
    if (this.ended) return;
    this.connected = false;
    this.stopTimers();
    this.emit("end", "socketClosed");
  }

  stopTimers() {
    if (this.moveTimer) clearInterval(this.moveTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.moveTimer = null;
    this.tickTimer = null;
  }

  // ---------- send ----------
  rawSendPayload(packetId, payload, state) {
    if (!this.socket || this.ended) return;
    let body = Buffer.concat([this.varintBuf(packetId), payload]);

    if (this.compressed && this.threshold >= 0) {
      let out;
      if (body.length < this.threshold) {
        out = Buffer.concat([this.varintBuf(0), body]);
      } else {
        const deflated = zlib.deflateSync(body);
        out = Buffer.concat([this.varintBuf(body.length), deflated]);
      }
      this.socket.write(Buffer.concat([this.varintBuf(out.length), out]));
      this.trace("sent id=0x" + packetId.toString(16) + " state=" + state);
    } else {
      this.socket.write(Buffer.concat([this.varintBuf(body.length), body]));
      this.trace("sent id=0x" + packetId.toString(16) + " state=" + state);
    }
  }

  rawSend(packetId, payloadWriter, state) {
    this.rawSendPayload(
      packetId,
      payloadWriter ? payloadWriter.buffer() : Buffer.alloc(0),
      state,
    );
  }

  varintBuf(v) {
    const w = new Writer();
    w.varint(v);
    return w.buffer();
  }

  onConnect() {
    this.trace("tcp connected");
    this.sendHandshake();
  }

  sendHandshake() {
    const w = new Writer();
    w.varint(PROTOCOL);
    w.string(this.host);
    w.unsignedShort(this.port);
    w.varint(2); // next state: login
    this.state = S_LOGIN;
    this.rawSend(ID.hs_handshake, w, S_HANDSHAKE);
    this.sendHello();
  }

  sendHello() {
    const w = new Writer();
    w.string(this.username);
    w.uuid(offlineUuid(this.username));
    this.rawSend(ID.lo_hello, w, S_LOGIN);
  }

  sendLoginAck() {
    this.rawSend(ID.lo_ack, null, S_LOGIN);
  }

  sendClientInfo(state) {
    const w = new Writer();
    w.string("en_US"); // Locale
    w.byte(8); // View distance
    w.varint(0); // Chat mode: enabled
    w.byte(0); // Chat colors: false
    w.byte(0x7f); // Displayed skin parts
    w.varint(1); // Main hand: right
    w.byte(0); // Enable text filtering: false
    w.byte(1); // Allow server listings: true
    w.varint(0); // Particle status: all
    this.rawSend(state === S_CONFIG ? ID.cs_client_info : ID.ps_client_info, w, state);
  }

  sendKnownPacks(pairs) {
    const w = new Writer();
    w.varint(pairs.length);
    for (const [ns, id, ver] of pairs) {
      w.string(ns);
      w.string(id);
      w.string(ver);
    }
    this.rawSend(ID.cs_known_packs, w, S_CONFIG);
  }

  sendFinishConfig() {
    this.rawSend(ID.cs_finish, null, S_CONFIG);
  }

  // ---------- receive ----------
  onData(chunk) {
    this.trace("tcp data " + chunk.length + " bytes, state=" + this.state);
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      let consumed;
      try {
        consumed = this.parsePacket();
      } catch (e) {
        if (e instanceof RangeError) return; // incomplete, wait for more
        this.handleError(e);
        return;
      }
      if (consumed === 0) return;
      this.buf = this.buf.slice(consumed);
    }
  }

  // returns bytes consumed, or 0 when the packet is incomplete
  parsePacket() {
    let r = new Reader(this.buf, 0);
    let packetLen;
    try {
      packetLen = r.varint();
    } catch (e) {
      return 0;
    }
    if (this.buf.length < r.off + packetLen) return 0;

    const payloadStart = r.off;
    const payloadEnd = r.off + packetLen;
    let body;

    if (this.compressed && this.threshold >= 0) {
      const pr = new Reader(this.buf, payloadStart);
      const dataLen = pr.varint();
      if (dataLen === 0) {
        body = this.buf.slice(pr.off, payloadEnd);
      } else {
        const comp = this.buf.slice(pr.off, payloadEnd);
        body = zlib.inflateSync(comp, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
        if (body.length !== dataLen) {
          throw new Error(
            `compression length mismatch: got ${body.length}, want ${dataLen}`,
          );
        }
      }
    } else {
      body = this.buf.slice(payloadStart, payloadEnd);
    }

    const br = new Reader(body, 0);
    const packetId = br.varint();
    this.handlePacket(packetId, br);
    return payloadEnd;
  }

  handlePacket(id, r) {
    if (this.state === S_LOGIN) {
      this.handleLogin(id, r);
    } else if (this.state === S_CONFIG) {
      this.handleConfig(id, r);
    } else if (this.state === S_PLAY) {
      this.handlePlay(id, r);
    }
  }

  disconnectFromServer(reason) {
    this.connected = false;
    this.stopTimers();
    this.emit("kicked", reason);
    this.ended = true;
    try {
      if (this.socket) this.socket.destroy();
    } catch (e) {}
    this.emit("end", "kicked");
  }

  handleLogin(id, r) {
    this.trace("login pkt 0x" + id.toString(16));
    switch (id) {
      case ID.li_disconnect: {
        const reason = readTextComponent(r);
        this.disconnectFromServer({ text: reason || "unknown reason" });
        return;
      }
      case ID.li_encryption_request:
        this.disconnectFromServer({
          text: "Online-mode server requires Microsoft authentication; offline bot cannot log in",
        });
        return;
      case ID.li_login_success: {
        r.uuid(); // uuid
        r.string(); // username
        this.sendLoginAck();
        this.state = S_CONFIG;
        this.sendClientInfo(S_CONFIG);
        return;
      }
      case ID.li_set_compression: {
        this.threshold = r.varint();
        this.compressed = true;
        return;
      }
      default:
        return;
    }
  }

  handleConfig(id, r) {
    this.trace("config pkt 0x" + id.toString(16));
    switch (id) {
      case ID.ci_known_packs: {
        const count = r.varint();
        const packs = [];
        for (let i = 0; i < count; i++) {
          const ns = r.string();
          const idd = r.string();
          const ver = r.string();
          packs.push([ns, idd, ver]);
        }
        this.sendKnownPacks(packs);
        return;
      }
      case ID.ci_ping: {
        const pingId = r.int();
        const b = Buffer.alloc(4);
        b.writeInt32BE(pingId, 0);
        this.rawSendPayload(ID.cs_pong, b, S_CONFIG);
        return;
      }
      case ID.ci_keepalive: {
        const keepId = r.long();
        const w = new Writer();
        w.long(keepId);
        this.rawSend(ID.cs_keepalive, w, S_CONFIG);
        return;
      }
      case ID.ci_disconnect: {
        const reason = readTextComponent(r);
        this.disconnectFromServer({ text: reason || "unknown reason" });
        return;
      }
      case ID.ci_finish: {
        this.sendFinishConfig();
        this.state = S_PLAY;
        return;
      }
      default:
        return;
    }
  }

  onSpawn() {
    if (this.hasSpawned) return;
    this.hasSpawned = true;
    this.connected = true;
    this.emit("spawn");

    // Player Loaded: tells the server the client's terrain is loaded and it
    // may start ticking the player. Skipping this leaves us read-only.
    this.rawSendPayload(ID.ps_loaded, Buffer.alloc(0), S_PLAY);

    // Anti-AFK: periodic keepalive answer is handled in keep_alive.
    // Movement: vanish-based presence only â€” the position is repeated
    // verbatim so no deltas are ever computed.
    this.moveTimer = setInterval(() => this.sendMove(), 500);
    this.tickTimer = setInterval(() => this.sendTickEnd(), 50);
    this.sendMove();
    this.sendTickEnd();
  }

  handlePlay(id, r) {
    this.trace("play pkt 0x" + id.toString(16));
    switch (id) {
      case ID.pc_login: {
        this.entityId = r.int();
        r.boolean(); // hardcore
        const dims = r.varint();
        for (let i = 0; i < dims; i++) r.string();
        this.maxPlayers = r.varint();
        r.varint(); // view distance
        r.varint(); // simulation distance
        // remaining fields are unused by this client
        this.state = S_PLAY;
        this.onSpawn();
        return;
      }
      case ID.pc_keepalive: {
        const keepId = r.long();
        const w = new Writer();
        w.long(keepId);
        this.rawSend(ID.ps_keepalive, w, S_PLAY);
        return;
      }
      case ID.pc_ping: {
        // "Packet is not used by the vanilla server" per spec, but reply
        // with a Pong carrying the same Int when we do get one.
        const pingId = r.int();
        const b = Buffer.alloc(4);
        b.writeInt32BE(pingId, 0);
        this.rawSendPayload(ID.ps_pong, b, S_PLAY);
        return;
      }
      case ID.pc_sync_pos: {
        this.teleportId = r.varint();
        const x = r.double();
        const y = r.double();
        const z = r.double();
        const vy = r.double();
        const vz = r.double();
        const vx = r.double();
        const yaw = r.float();
        const pitch = r.float();
        r.int(); // teleport flags
        this.entity.position = { x, y, z };
        this.confirmTeleport(x, y, z, yaw, pitch);
        return;
      }
      case ID.pc_system_chat: {
        // varint (content type) + prefixed optional line + json payload
        try {
          r.varint();
          const text = readTextComponent(r);
          if (text) this.emit("chat", { text: String(text) });
        } catch (e) {}
        return;
      }
      case ID.pc_disconnect: {
        const reason = readTextComponent(r);
        this.disconnectFromServer({ text: reason || "unknown reason" });
        return;
      }
      default:
        return;
    }
  }

  confirmTeleport(x, y, z, yaw, pitch) {
    const w = new Writer();
    w.varint(this.teleportId);
    w.double(x);
    w.double(y);
    w.double(z);
    w.float(yaw);
    w.float(pitch);
    this.rawSend(ID.ps_confirm_teleport, w, S_PLAY);
    // vanilla also sends a pos+rot packet right after confirming
    const m = new Writer();
    m.double(x);
    m.double(y);
    m.double(z);
    m.float(yaw);
    m.float(pitch);
    m.byte(0x01); // on ground
    this.rawSend(ID.ps_move_pos_rot, m, S_PLAY);
  }

  sendMove() {
    if (!this.connected || this.ended) return;
    const p = this.entity.position;
    const w = new Writer();
    w.double(p.x);
    w.double(p.y);
    w.double(p.z);
    w.byte(0x01); // on ground, not against wall
    this.rawSend(ID.ps_move_pos, w, S_PLAY);
  }

  sendTickEnd() {
    if (!this.connected || this.ended) return;
    this.rawSend(ID.ps_tick_end, null, S_PLAY);
  }

  chat(message) {
    if (!this.connected || this.ended) return false;
    const text = String(message);

    // Slash-commands go out as chat_command, which is a bare string with no
    // signature fields at all â€” structurally unable to trip the server's
    // DecoderException the way an unsigned chat packet can.
    if (text.startsWith("/")) {
      const w = new Writer();
      w.string(text.slice(1)); // command excludes the leading /
      this.rawSend(ID.ps_chat_command, w, S_PLAY);
      return true;
    }

    // Unsigned chat. The server decodes exactly five fields after the
    // message: Timestamp, Salt, Signature (absent), Message Count,
    // Acknowledged (Fixed BitSet) and Checksum. Omitting the last two makes
    // netty read past the packet and drop the connection with
    // "Failed to decode packet 'serverbound/minecraft:chat'".
    const w = new Writer();
    w.string(text);
    w.long(Date.now()); // Timestamp (ms since epoch)
    w.long(0n); // Salt (no signature -> unused)
    w.byte(0); // Signature: absent
    w.varint(0); // Message Count: none seen
    // Acknowledged: Fixed BitSet(20) -> ceil(20/8) = 3 bytes, all zero because
    // we have acknowledged no last-seen signatures.
    w.bytes(Buffer.from([0x00, 0x00, 0x00]));
    // Checksum: Arrays.hashCode over the (empty) last-seen set yields 0, and
    // the spec says a 0 byte is written as 1.
    w.byte(1);
    this.rawSend(ID.ps_chat, w, S_PLAY);
    return true;
  }
}

function createClient(opts) {
  return new PastedClient(opts);
}

module.exports = { createClient, PastedClient, PROTOCOL };
