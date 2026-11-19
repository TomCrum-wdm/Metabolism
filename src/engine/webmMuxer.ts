// Pure-TypeScript WebM (EBML + VP8/VP9) Container Muxer & TAR Frame Archive Builder.
// Uses TimecodeScale = 100_000 ns (0.1 ms ticks) so high-FPS streams (e.g. 165 FPS = 6.06 ms,
// 240 FPS = 4.17 ms) retain sub-millisecond timing accuracy with zero timestamp collisions.

export type WebmVideoCodec = 'V_VP9' | 'V_VP8';

export interface WebmMuxerOptions {
  width: number;
  height: number;
  fps: number;
  codec?: WebmVideoCodec;
}

class ByteWriter {
  private buf: Uint8Array;
  private len = 0;

  constructor(initialCapacity = 16384) {
    this.buf = new Uint8Array(initialCapacity);
  }

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let next = this.buf.length * 2;
    while (next < this.len + extra) next *= 2;
    const copy = new Uint8Array(next);
    copy.set(this.buf.subarray(0, this.len));
    this.buf = copy;
  }

  public get length(): number {
    return this.len;
  }

  public writeByte(b: number): void {
    this.ensure(1);
    this.buf[this.len++] = b & 0xff;
  }

  public writeBytes(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }

  public writeAscii(text: string): void {
    this.ensure(text.length);
    for (let i = 0; i < text.length; i++) {
      this.buf[this.len++] = text.charCodeAt(i) & 0xff;
    }
  }

  public writeUintBE(value: number, byteCount: number): void {
    this.ensure(byteCount);
    let v = Math.floor(value);
    for (let i = byteCount - 1; i >= 0; i--) {
      this.buf[this.len + i] = v & 0xff;
      v = Math.floor(v / 256);
    }
    this.len += byteCount;
  }

  public writeInt16BE(value: number): void {
    this.ensure(2);
    const v = Math.round(value) & 0xffff;
    this.buf[this.len++] = (v >> 8) & 0xff;
    this.buf[this.len++] = v & 0xff;
  }

  public writeFloat64BE(value: number): void {
    this.ensure(8);
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.len, 8);
    view.setFloat64(0, value, false);
    this.len += 8;
  }

  public patchFloat64BE(offset: number, value: number): void {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + offset, 8);
    view.setFloat64(0, value, false);
  }

  public patchBytes(offset: number, data: Uint8Array): void {
    this.buf.set(data, offset);
  }

  public toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

function encodeVintLength(size: number): Uint8Array {
  // Choose shortest EBML VINT width (1..8 bytes) where value < 2^(7*w) - 1
  for (let w = 1; w <= 8; w++) {
    const maxVal = Math.pow(2, 7 * w) - 2;
    if (size <= maxVal) {
      const out = new Uint8Array(w);
      let v = size;
      for (let i = w - 1; i >= 0; i--) {
        out[i] = v & 0xff;
        v = Math.floor(v / 256);
      }
      out[0] |= 1 << (8 - w);
      return out;
    }
  }
  throw new Error('EBML size overflow');
}

function encodeEbmlId(id: number): Uint8Array {
  if (id <= 0xff) return new Uint8Array([id]);
  if (id <= 0xffff) return new Uint8Array([(id >> 8) & 0xff, id & 0xff]);
  if (id <= 0xffffff) return new Uint8Array([(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  return new Uint8Array([
    (id >>> 24) & 0xff,
    (id >>> 16) & 0xff,
    (id >>> 8) & 0xff,
    id & 0xff,
  ]);
}

function ebmlUintBytes(value: number): Uint8Array {
  if (value === 0) return new Uint8Array([0]);
  const bytes: number[] = [];
  let v = Math.floor(value);
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return new Uint8Array(bytes);
}

function ebmlElement(id: number, payload: Uint8Array): Uint8Array {
  const idBytes = encodeEbmlId(id);
  const lenBytes = encodeVintLength(payload.length);
  const out = new Uint8Array(idBytes.length + lenBytes.length + payload.length);
  out.set(idBytes, 0);
  out.set(lenBytes, idBytes.length);
  out.set(payload, idBytes.length + lenBytes.length);
  return out;
}

function ebmlUint(id: number, value: number): Uint8Array {
  return ebmlElement(id, ebmlUintBytes(value));
}

function ebmlString(id: number, text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return ebmlElement(id, bytes);
}

function ebmlFloat64(id: number, value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return ebmlElement(id, bytes);
}

function concatArrays(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export class WebmMuxer {
  private readonly width: number;
  private readonly height: number;
  private readonly fps: number;
  private readonly codec: WebmVideoCodec;
  /** 100_000 ns = 0.1 ms per tick for exact 165/240 FPS spacing */
  private readonly timecodeScaleNs = 100_000;
  private readonly writer = new ByteWriter(65536);

  private segmentDataStart = 0;
  private segmentSizeOffset = 0;
  private durationPayloadOffset = 0;

  private clusterOpen = false;
  private clusterStartTicks = 0;
  private clusterSizeOffset = 0;
  private clusterDataStart = 0;
  private lastTimestampUs = 0;
  private finalized = false;

  constructor(options: WebmMuxerOptions) {
    this.width = Math.max(2, Math.round(options.width));
    this.height = Math.max(2, Math.round(options.height));
    this.fps = Math.max(1, options.fps);
    this.codec = options.codec ?? 'V_VP9';
    this.writeHeader();
  }

  private writeHeader(): void {
    // EBML Header
    const ebmlBody = concatArrays([
      ebmlUint(0x4286, 1), // EBMLVersion
      ebmlUint(0x42f7, 1), // EBMLReadVersion
      ebmlUint(0x42f2, 4), // EBMLMaxIDLength
      ebmlUint(0x42f3, 8), // EBMLMaxSizeLength
      ebmlString(0x4282, 'webm'), // DocType
      ebmlUint(0x4287, 4), // DocTypeVersion
      ebmlUint(0x4285, 2), // DocTypeReadVersion
    ]);
    this.writer.writeBytes(ebmlElement(0x1a45dfa3, ebmlBody));

    // Segment ID + 8-byte VINT placeholder for Segment size
    this.writer.writeBytes(encodeEbmlId(0x18538067));
    this.segmentSizeOffset = this.writer.length;
    this.writer.writeBytes(new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
    this.segmentDataStart = this.writer.length;

    // Segment -> Info
    const infoHeaderAndScale = concatArrays([
      ebmlUint(0x2ad7b1, this.timecodeScaleNs),
      ebmlString(0x4d80, 'TerraSphere Director'),
      ebmlString(0x5741, 'TerraSphere WebmMuxer'),
    ]);
    const durBytes = ebmlFloat64(0x4489, 0);
    const infoBody = concatArrays([infoHeaderAndScale, durBytes]);
    const infoElem = ebmlElement(0x1549a966, infoBody);
    const infoPreLen =
      encodeEbmlId(0x1549a966).length + encodeVintLength(infoBody.length).length;
    const durHeaderLen = encodeEbmlId(0x4489).length + encodeVintLength(8).length;
    this.durationPayloadOffset =
      this.writer.length + infoPreLen + infoHeaderAndScale.length + durHeaderLen;
    this.writer.writeBytes(infoElem);

    // Segment -> Tracks
    const defaultDurationNs = Math.round(1_000_000_000 / this.fps);
    const videoInfo = concatArrays([
      ebmlUint(0xb0, this.width), // PixelWidth
      ebmlUint(0xba, this.height), // PixelHeight
    ]);
    const trackEntry = concatArrays([
      ebmlUint(0xd7, 1), // TrackNumber
      ebmlUint(0x73c5, 1), // TrackUID
      ebmlUint(0x83, 1), // TrackType: 1 = video
      ebmlUint(0x9c, 0), // FlagLacing: 0
      ebmlString(0x86, this.codec), // CodecID
      ebmlUint(0x23e383, defaultDurationNs), // DefaultDuration (ns)
      ebmlElement(0xe0, videoInfo), // Video settings
    ]);
    const tracks = ebmlElement(0x1654ae6b, ebmlElement(0xae, trackEntry));
    this.writer.writeBytes(tracks);
  }

  private openCluster(startTicks: number): void {
    this.clusterStartTicks = startTicks;
    this.writer.writeBytes(encodeEbmlId(0x1f43b675));
    this.clusterSizeOffset = this.writer.length;
    this.writer.writeBytes(new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
    this.clusterDataStart = this.writer.length;
    this.writer.writeBytes(ebmlUint(0xe7, startTicks)); // Cluster Timecode
    this.clusterOpen = true;
  }

  private closeCluster(): void {
    if (!this.clusterOpen) return;
    const clusterSize = this.writer.length - this.clusterDataStart;
    this.patchUint64Vint(this.clusterSizeOffset, clusterSize);
    this.clusterOpen = false;
  }

  private patchUint64Vint(offset: number, size: number): void {
    const out = new Uint8Array(8);
    let v = Math.floor(size);
    for (let i = 7; i >= 0; i--) {
      out[i] = v & 0xff;
      v = Math.floor(v / 256);
    }
    out[0] = (out[0] & 0x00) | 0x01; // 8-byte VINT marker bit
    this.writer.patchBytes(offset, out);
  }

  public addVideoChunk(
    data: Uint8Array,
    timestampUs: number,
    isKeyframe: boolean,
  ): void {
    if (this.finalized) throw new Error('WebmMuxer already finalized');
    const safeTsUs = Math.max(0, Math.round(timestampUs));
    if (safeTsUs > this.lastTimestampUs) {
      this.lastTimestampUs = safeTsUs;
    }
    const ticks = Math.round((safeTsUs * 1000) / this.timecodeScaleNs);
    const relTicks = ticks - this.clusterStartTicks;

    // Start new cluster on keyframes (after first cluster) or before int16 relative timecode limit
    if (!this.clusterOpen || (isKeyframe && relTicks > 2000) || relTicks > 28000 || relTicks < -28000) {
      this.closeCluster();
      this.openCluster(ticks);
    }

    const rel = ticks - this.clusterStartTicks;
    const blockPayloadLen = 4 + data.length;
    this.writer.writeBytes(encodeEbmlId(0xa3)); // SimpleBlock
    this.writer.writeBytes(encodeVintLength(blockPayloadLen));
    this.writer.writeByte(0x81); // Track number 1 as VINT
    this.writer.writeInt16BE(rel);
    this.writer.writeByte(isKeyframe ? 0x80 : 0x00); // Flags: keyframe
    this.writer.writeBytes(data);
  }

  public finalize(): Uint8Array {
    if (this.finalized) return this.writer.toUint8Array();
    this.closeCluster();

    const frameDurUs = Math.round(1_000_000 / this.fps);
    const totalTicks = ((this.lastTimestampUs + frameDurUs) * 1000) / this.timecodeScaleNs;
    this.writer.patchFloat64BE(this.durationPayloadOffset, Math.max(1, totalTicks));

    const segmentSize = this.writer.length - this.segmentDataStart;
    this.patchUint64Vint(this.segmentSizeOffset, segmentSize);
    this.finalized = true;
    return this.writer.toUint8Array();
  }
}

/**
 * Pure-TypeScript POSIX ustar .tar archive builder for lossless PNG frame-sequence fallback.
 */
export function buildTarArchive(
  entries: ReadonlyArray<{ name: string; data: Uint8Array }>,
): Uint8Array {
  let totalBytes = 1024; // 2 zero blocks EOF
  for (const e of entries) {
    const padded = Math.ceil(e.data.length / 512) * 512;
    totalBytes += 512 + padded;
  }
  const out = new Uint8Array(totalBytes);
  let offset = 0;

  for (const entry of entries) {
    const header = out.subarray(offset, offset + 512);
    const nameBytes = new TextEncoder().encode(entry.name.slice(0, 99));
    header.set(nameBytes, 0);

    const writeOctal = (pos: number, width: number, val: number) => {
      const str = Math.max(0, Math.floor(val)).toString(8).padStart(width - 1, '0');
      for (let i = 0; i < width - 1; i++) {
        header[pos + i] = str.charCodeAt(i);
      }
      header[pos + width - 1] = 0;
    };

    writeOctal(100, 8, 0o644); // mode
    writeOctal(108, 8, 0); // uid
    writeOctal(116, 8, 0); // gid
    writeOctal(124, 12, entry.data.length); // size
    writeOctal(136, 12, Math.floor(Date.now() / 1000)); // mtime

    // Checksum field initially spaces
    for (let i = 148; i < 156; i++) header[i] = 32;
    header[156] = '0'.charCodeAt(0); // regular file

    // ustar magic + version
    const magic = 'ustar\0';
    for (let i = 0; i < 6; i++) header[257 + i] = magic.charCodeAt(i);
    header[263] = '0'.charCodeAt(0);
    header[264] = '0'.charCodeAt(0);

    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    const chk = sum.toString(8).padStart(6, '0');
    for (let i = 0; i < 6; i++) header[148 + i] = chk.charCodeAt(i);
    header[154] = 0;
    header[155] = 32;

    offset += 512;
    out.set(entry.data, offset);
    offset += Math.ceil(entry.data.length / 512) * 512;
  }

  return out;
}
