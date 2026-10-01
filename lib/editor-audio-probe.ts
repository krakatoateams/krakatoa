/**
 * Detect whether an Editor source video has an audio stream, by reading its
 * container header over HTTP Range requests (no FFmpeg, no new dependency).
 *
 * - MP4 / MOV (ISO-BMFF): walk top-level boxes to `moov`, then look for a
 *   `hdlr` box whose handler type is `soun`. Works for faststart and
 *   moov-at-end files.
 * - WebM / Matroska: the Tracks element sits in the file head; look for an
 *   audio CodecID (`A_…`).
 *
 * Safe default: anything undeterminable (unknown container, no Range support,
 * timeout, oversized moov) counts as silent, so a missing audio stream can
 * never fail the FFmpeg export. Runnable as `npx tsx lib/editor-audio-probe.ts`.
 */

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

// ponytail: WebM Tracks must sit in the first HEAD_BYTES (true for MediaRecorder/ffmpeg/libwebm
// output); follow the SeekHead if a muxer is found placing Tracks later. Misses count as silent.
const HEAD_BYTES = 256 * 1024;
const MAX_MOOV_BYTES = 32 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 64;
const PROBE_TIMEOUT_MS = 10_000;

const ascii = (bytes: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...bytes.subarray(start, start + len));

function indexOfBytes(hay: Uint8Array, needle: number[], from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const HDLR = [0x68, 0x64, 0x6c, 0x72]; // "hdlr"
const SOUN = [0x73, 0x6f, 0x75, 0x6e]; // "soun"
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const MKV_TRACKS = [0x16, 0x54, 0xae, 0x6b];

/**
 * `moov` payload has a `hdlr` (type + version/flags + pre_defined) → handler `soun`.
 * ponytail: byte scan, not a box-tree walk; a stray "hdlr…soun" byte run could false-positive.
 * Parse trak/mdia boxes if that ever shows up in practice.
 */
export function moovHasAudio(moov: Uint8Array): boolean {
  for (let i = indexOfBytes(moov, HDLR); i >= 0; i = indexOfBytes(moov, HDLR, i + 4)) {
    if (indexOfBytes(moov.subarray(i + 12, i + 16), SOUN) === 0) return true;
  }
  return false;
}

/** EBML vint width: leading zero bits of its first byte + 1 (clz32 counts 24 zeros above a byte). */
const vintWidth = (byte: number) => Math.clz32(byte) - 23;

/**
 * Matroska head: CodecID element (0x86 + EBML vint size) starting with `A_`,
 * scanned only within the Tracks element so frame data can't false-positive.
 */
export function webmHeadHasAudio(head: Uint8Array): boolean {
  const tracks = indexOfBytes(head, MKV_TRACKS);
  if (tracks < 0 || !head[tracks + 4]) return false;
  const sizeAt = tracks + 4;
  const width = vintWidth(head[sizeAt]);
  let size = head[sizeAt] & (0xff >> width);
  let unknown = size === 0xff >> width;
  for (let k = 1; k < width; k++) {
    size = size * 256 + head[sizeAt + k];
    unknown &&= head[sizeAt + k] === 0xff;
  }
  const end = unknown ? head.length : Math.min(head.length, sizeAt + width + size);
  for (let i = sizeAt + width; i < end - 3; i++) {
    if (head[i] !== 0x86 || head[i + 1] === 0) continue;
    const at = i + 1 + vintWidth(head[i + 1]);
    if (head[at] === 0x41 && head[at + 1] === 0x5f) return true;
  }
  return false;
}

/** Parse one ISO-BMFF box header; `size` 0 means "to end of file". */
export function readBoxHeader(
  bytes: Uint8Array
): { type: string; size: number; headerSize: number } | null {
  if (bytes.length < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size32 = view.getUint32(0);
  const type = ascii(bytes, 4, 4);
  if (size32 === 1) {
    if (bytes.length < 16) return null;
    return { type, size: Number(view.getBigUint64(8)), headerSize: 16 };
  }
  return { type, size: size32, headerSize: 8 };
}

async function fetchRange(
  fetchImpl: FetchLike,
  url: string,
  start: number,
  endInclusive: number,
  signal: AbortSignal
): Promise<Uint8Array | null> {
  const res = await fetchImpl(url, {
    headers: { Range: `bytes=${start}-${endInclusive}` },
    signal,
  });
  // A 200 would stream the whole file; only trust partial responses.
  if (res.status !== 206) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function probe(url: string, fetchImpl: FetchLike, signal: AbortSignal): Promise<boolean> {
  const head = await fetchRange(fetchImpl, url, 0, HEAD_BYTES - 1, signal);
  if (!head || head.length < 8) return false;
  if (indexOfBytes(head.subarray(0, 4), EBML_MAGIC) === 0) return webmHeadHasAudio(head);

  let offset = 0;
  for (let n = 0; n < MAX_TOP_LEVEL_BOXES; n++) {
    const inHead = offset + 16 <= head.length;
    const header = inHead
      ? head.subarray(offset, offset + 16)
      : await fetchRange(fetchImpl, url, offset, offset + 15, signal);
    const box = header ? readBoxHeader(header) : null;
    if (!box || !/^[\x20-\x7e]{4}$/.test(box.type)) return false;
    if (box.type === "moov") {
      if (box.size === 0 || box.size > MAX_MOOV_BYTES) return false;
      const moov =
        offset + box.size <= head.length
          ? head.subarray(offset, offset + box.size)
          : await fetchRange(fetchImpl, url, offset, offset + box.size - 1, signal);
      return moov ? moovHasAudio(moov) : false;
    }
    if (box.size < box.headerSize) return false; // size 0 (to EOF) or corrupt, no moov after it
    offset += box.size;
  }
  return false;
}

/** True only when the source verifiably has an audio stream; never throws. */
export async function sourceHasAudio(url: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  try {
    return await probe(url, fetchImpl, AbortSignal.timeout(PROBE_TIMEOUT_MS));
  } catch (e) {
    // Never log the URL: it carries a signed token.
    console.warn("[editor audio probe] failed, treating source as silent:", e instanceof Error ? e.name : "unknown");
    return false;
  }
}

/** Probe each distinct URL in parallel; returns the set that has audio. */
export async function probeAudioSources(
  urls: Iterable<string>,
  fetchImpl: FetchLike = fetch
): Promise<Set<string>> {
  const unique = [...new Set(urls)];
  const results = await Promise.all(unique.map((url) => sourceHasAudio(url, fetchImpl)));
  return new Set(unique.filter((_, i) => results[i]));
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`editor-audio-probe self-check: ${msg}`);
}

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const bytesOf = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

/** In-memory Range server; `honorRange: false` mimics a host that ignores Range. */
function fakeFetch(file: Uint8Array, honorRange = true): FetchLike {
  return async (_url, init) => {
    const range = new Headers(init.headers).get("range") ?? "";
    const m = /bytes=(\d+)-(\d+)/.exec(range);
    if (!honorRange || !m) return new Response(file.slice(), { status: 200 });
    const start = Number(m[1]);
    const end = Math.min(Number(m[2]), file.length - 1);
    return new Response(file.slice(start, end + 1), { status: 206 });
  };
}

export async function editorAudioProbeSelfCheck(): Promise<void> {
  const hdlr = (handler: string) => box("hdlr", concat(new Uint8Array(8), bytesOf(handler), new Uint8Array(12)));
  const trak = (handler: string) => box("trak", box("mdia", hdlr(handler)));
  const ftyp = box("ftyp", bytesOf("isom\0\0\0\0isomavc1"));

  const videoOnlyMoov = box("moov", trak("vide"));
  const avMoov = box("moov", concat(trak("vide"), trak("soun")));
  assert(!moovHasAudio(videoOnlyMoov), "video-only moov is silent");
  assert(moovHasAudio(avMoov), "moov with soun handler has audio");

  const faststart = concat(ftyp, avMoov, box("mdat", new Uint8Array(64)));
  assert(await sourceHasAudio("x", fakeFetch(faststart)), "faststart mp4 with audio");

  // moov after a large mdat → walked via extra range requests.
  const bigMdat = box("mdat", new Uint8Array(HEAD_BYTES + 1000));
  assert(await sourceHasAudio("x", fakeFetch(concat(ftyp, bigMdat, avMoov))), "moov-at-end mp4 with audio");
  assert(
    !(await sourceHasAudio("x", fakeFetch(concat(ftyp, bigMdat, videoOnlyMoov)))),
    "moov-at-end video-only mp4 is silent"
  );

  // QuickTime: no ftyp, hdlr component type `mhlr` then subtype `soun`.
  const movHdlr = box("hdlr", concat(new Uint8Array(4), bytesOf("mhlrsoun"), new Uint8Array(12)));
  const mov = concat(box("wide", new Uint8Array(0)), box("moov", box("trak", box("mdia", movHdlr))));
  assert(await sourceHasAudio("x", fakeFetch(mov)), "quicktime mov with audio");

  const trackEntry = (codec: string) =>
    concat(new Uint8Array([0xae, 0x80 | (5 + codec.length), 0x83, 0x81, 0x01, 0x86, 0x80 | codec.length]), bytesOf(codec));
  const webm = (codecs: string[], after: Uint8Array = new Uint8Array(0)) => {
    const entries = concat(...codecs.map(trackEntry));
    return concat(
      new Uint8Array(EBML_MAGIC),
      new Uint8Array([0x84, 0, 0, 0, 0]),
      new Uint8Array(MKV_TRACKS),
      new Uint8Array([0x80 | entries.length]),
      entries,
      after
    );
  };
  assert(await sourceHasAudio("x", fakeFetch(webm(["V_VP9", "A_OPUS"]))), "webm with opus");
  assert(!(await sourceHasAudio("x", fakeFetch(webm(["V_VP8"])))), "webm video-only is silent");
  // Cluster bytes after Tracks that happen to look like an audio CodecID must not count.
  const lookalike = webm(["V_VP8"], concat(new Uint8Array([0x1f, 0x43, 0xb6, 0x75, 0x86, 0x86]), bytesOf("A_OPUS")));
  assert(!webmHeadHasAudio(lookalike), "audio-looking bytes after Tracks are ignored");
  const wideSize = concat(
    new Uint8Array(EBML_MAGIC),
    new Uint8Array(MKV_TRACKS),
    new Uint8Array([0x40, 0x09, 0x86, 0x40, 0x06]),
    bytesOf("A_OPUS")
  );
  assert(webmHeadHasAudio(wideSize), "2-byte vint sizes for Tracks and CodecID");

  assert(!(await sourceHasAudio("x", fakeFetch(faststart, false))), "no Range support → silent default");
  assert(!(await sourceHasAudio("x", fakeFetch(bytesOf("garbage-bytes-here")))), "unknown container → silent");
  assert(
    !(await sourceHasAudio("x", async () => {
      throw new Error("network down");
    })),
    "network error → silent, never throws"
  );

  const set = await probeAudioSources(["a", "b", "a"], async (url, init) =>
    fakeFetch(url === "a" ? faststart : concat(ftyp, videoOnlyMoov))(url, init)
  );
  assert(set.has("a") && !set.has("b") && set.size === 1, "probeAudioSources dedupes and filters");
}

if (require.main === module) {
  editorAudioProbeSelfCheck().then(
    () => console.log("editorAudioProbeSelfCheck: ok"),
    (e) => {
      console.error(e);
      process.exit(1);
    }
  );
}
