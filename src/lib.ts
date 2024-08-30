export function colorForString(input: string): string {
  const hash = hashStringCYRB53(input);
  const hue = hash % 360;
  return `hsl(${hue}, 100%, 35%)`;
}

export interface R2 {
  x: number;
  y: number;
}

export function sub(a: R2, b: R2): R2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function len(a: R2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function scale(a: R2, s: number): R2 {
  return { x: a.x * s, y: a.y * s };
}

export function dir(a: R2, b: R2): R2 {
  const ab = sub(b, a);
  return scale(ab, 1 / len(ab));
}

export function cssTranslatePx(a: R2): string {
  return `translate(${a.x}px, ${a.y}px)`;
}

export function assertNever(_value: never): never {
  throw new Error("assertNever");
}

export function classNames(...classes: unknown[]): string {
  return classes.filter(Boolean).join(" ");
}

export class ReadBuffer {
  private readonly initialOffset: number;

  constructor(
    private readonly view: Uint8Array,
    public offset = 0,
  ) {
    this.initialOffset = offset;
  }

  private canReadBytes(len: number): void {
    if (this.offset + len > this.view.byteLength) {
      throw new Error(
        `out-of-bounds read; requested=${len} offset=${this.offset} total=${this.view.byteLength}`,
      );
    }
  }

  readBytes(len: number): Uint8Array {
    this.canReadBytes(len);
    const out = new Uint8Array(this.view, this.offset, len);
    this.offset += len;
    return out;
  }

  readU8(): number {
    this.canReadBytes(1);
    return this.view[this.offset++];
  }

  readU32(): number {
    this.canReadBytes(4);
    return (
      // JS bitwise ops result in *signed* 32-bit ints...
      ((this.view[this.offset++] << 24) >>> 0) +
      (this.view[this.offset++] << 16) +
      (this.view[this.offset++] << 8) +
      this.view[this.offset++]
    );
  }

  consumedView(): Uint8Array {
    return new Uint8Array(
      this.view.buffer,
      this.view.byteOffset + this.initialOffset,
      this.offset - this.initialOffset,
    );
  }

  remainingBytes(): number {
    return this.view.byteLength - this.offset;
  }
}

// https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
export function hashStringCYRB53(str: string, seed: number = 0) {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// https://stackoverflow.com/a/43122214

export function popcount32(n: number): number {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0xf0f0f0f) * 0x1010101) >> 24;
}

export function popcount(n: number): number {
  let bits = 0;
  while (n !== 0) {
    bits += popcount32(n | 0);
    n /= 0x100000000;
  }
  return bits;
}

export function areMapsEqual<K, V>(left: ReadonlyMap<K, V>, right: ReadonlyMap<K, V>): boolean {
  if (left.size !== right.size) return false;
  for (const [k, v] of left.entries()) {
    if (right.get(k) !== v) return false;
  }
  return true;
}

export function areArraysEqual<T>(
  left: Array<T>,
  right: Array<T>,
  equalFn?: (left: T, right: T) => boolean,
): boolean {
  if (left.length !== right.length) return false;
  if (equalFn) {
    return left.every((x, i) => equalFn(x, right[i]));
  } else {
    return left.every((x, i) => x === right[i]);
  }
}

export function stringify(x: unknown): string {
  if (typeof x === "string" && x !== "") return x;
  if (x instanceof Error) return x.toString();
  if (typeof x === "function") return String(x);
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

export function escapeHTML(unsafe: string): string {
  return unsafe
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll(/  +/g, (m) => " &nbsp;".repeat(m.length - 1)); // otherwise HTML collapses consecutive spaces...
}

export function range(start: number, end: number): number[] {
  if (end <= start) {
    return [];
  }
  return Array(end - start)
    .fill(0)
    .map((_, i) => start + i);
}

export function jsonWithSortedKeys(value: unknown): string {
  return JSON.stringify(value, keySortingReplacer);
}

export function keySortingReplacer(this: unknown, _key: string, value: unknown): unknown {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return value;
  } else if (value.constructor === Object) {
    const keys = Object.keys(value);
    keys.sort();
    const sorted = {};
    for (const key of keys) {
      (sorted as any)[key] = (value as any)[key];
    }
    return sorted;
  } else {
    throw Error("unsupported object: " + value.constructor.name);
  }
}

export function hash(input: string) {
  // djb2 https://stackoverflow.com/a/77342581/252042
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    hash = ((hash << 5) + hash + c) | 0;
  }
  return hash;
}

export function time<T>(name: string, thunk: () => T): T {
  const start = Date.now();
  const out = thunk();
  const end = Date.now();
  console.log(`${name} ${((end - start) / 1000).toFixed(2)}s`);
  return out;
}

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

export function mapJSON(f: (n: JSONValue) => JSONValue, value: JSONValue): JSONValue {
  if (Array.isArray(value)) {
    return value.map((x) => mapJSON(f, x));
  }
  if (value?.constructor === Object) {
    return Object.fromEntries(
      Array.from(Object.entries(value)).map(([k, v]) => [k, mapJSON(f, v)]),
    );
  }
  return f(value);
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function base64urlToNumber(s: string): number {
  let out = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let d;
    if (c >= 48 && c <= 57) {
      // 0-9
      d = c - 48 + 52;
    } else if (c >= 65 && c <= 90) {
      // A-Z
      d = c - 65;
    } else if (c >= 97 && c <= 122) {
      // a-z
      d = c - 97 + 26;
    } else if (c === 45) {
      // -
      d = 62;
    } else if (c === 95) {
      // _
      d = 63;
    } else {
      throw Error(`invalid base64 character: ${s}`);
    }
    out = out * 64 + d;
  }
  return out;
}

export function numberToBase64url(n: number): string {
  const out = [];
  do {
    out.push(BASE64URL.charAt(n % 64));
    n = Math.floor(n / 64);
  } while (n > 0);
  out.reverse();
  return out.join("");
}

export function arrayBufferToDataUrl(data: ArrayBuffer): Promise<string> {
  const blob = new Blob([data]);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (_): void => {
      resolve(reader.result as string);
    };
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToArrayBuffer(url: string): Promise<ArrayBuffer> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (_): void => {
      resolve(reader.result as ArrayBuffer);
    };
    reader.readAsArrayBuffer(blob);
  });
}

export async function deflate(input: ArrayBuffer): Promise<ArrayBuffer> {
  // https://github.com/WICG/compression/pull/30
  const stream: ReadableStream<Uint8Array> = new Response(input).body!.pipeThrough(
    new CompressionStream("deflate"),
  );
  return new Response(stream).arrayBuffer();
}

export async function inflate(input: ArrayBuffer): Promise<ArrayBuffer> {
  const stream: ReadableStream<Uint8Array> = new Response(input).body!.pipeThrough(
    new DecompressionStream("deflate"),
  );
  return new Response(stream).arrayBuffer();
}

export function unreachable(x: never): never {
  console.error("unreachable", x);
  throw Error(`unreachable: ${x}`);
}

export function stringForError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error !== null && typeof error === "object" && "toString" in error) {
    return error.toString();
  }
  return JSON.stringify(error);
}

export function shuffle<T>(array: T[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = array[j];
    array[j] = array[i];
    array[i] = t;
  }
}

export function dot(a: number[], b: number[]): number {
  // Maybe implement an umerically-stable dot product?
  if (a.length != b.length) {
    throw Error(`length mismatch: ${a.length} != ${b.length}`);
  }
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out += a[i] * b[i];
  }
  return out;
}

export function h(
  tag: string,
  attrs: Record<string, unknown> = {},
  children: string | Array<string | HTMLElement> = "",
): HTMLElement {
  const tagParts = tag.split(/(?=[.#])/);
  const classNames = [];
  for (const part of tagParts) {
    if (part[0] === ".") classNames.push(part.substring(1));
    else if (part[0] === "#") attrs.id = part.substring(1);
  }
  if (classNames.length) {
    if (attrs["class"]) attrs.class = `${attrs.class} ${classNames.join(" ")}`;
    else attrs.class = classNames.join(" ");
  }
  const out = document.createElement(tagParts[0]);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k.startsWith("on")) {
      out.addEventListener(k.substring(2), v as any);
    } else if (typeof v === "boolean" && !v) {
      // e.g. disabled=false should be omitted
    } else {
      out.setAttribute(k, v as string);
    }
  }
  if (typeof children === "string") {
    out.appendChild(document.createTextNode(children));
  } else if (Array.isArray(children)) {
    for (const child of children) {
      out.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
  }
  return out;
}

function intToDigits(digits: string[]): (n: number) => string {
  const N = digits.length;
  return (n: number) => {
    const sub = [];
    do {
      sub.push(n % N);
      n = Math.floor(n / N);
    } while (n > 0);
    sub.reverse();
    return sub.map((i) => digits[i]).join("");
  };
}

function digitsToInt(digits: string[]): (s: string) => number {
  const N = digits.length;
  return (s: string) => {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const sub = digits.indexOf(s[i]);
      if (sub === -1) {
        throw Error("invalid digit: " + s[i]);
      }
      n = n * N + sub;
    }
    return n;
  };
}

export const intToSubs = intToDigits("₀₁₂₃₄₅₆₇₈₉".split(""));
export const intToSups = intToDigits("⁰¹²³⁴⁵⁶⁷⁸⁹".split(""));
export const intToLetters = intToDigits("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
export const lettersToInt = digitsToInt("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));

export function evaluateTemplate(template: string, values: Record<string, unknown>): string;
export function evaluateTemplate(
  template: string,
  evaluator: (expression: string) => string,
): string;
export function evaluateTemplate(
  template: string,
  valuesOrEvaluator: Record<string, unknown> | ((expression: string) => string),
) {
  const evaluator =
    typeof valuesOrEvaluator === "function"
      ? valuesOrEvaluator
      : (expression: string) => {
          // 󰱯
          const f = new Function(
            "__LOCALS__",
            `return (() => { with (__LOCALS__) { return (${expression}); } })()`,
          );
          return f(valuesOrEvaluator);
        };
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, expression) => {
    return evaluator(expression);
  });
}
