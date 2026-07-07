/**
 * Minimal ambient declarations for the Holepunch/Pear stack (no upstream types).
 * Kept intentionally loose — the P2P engine is the only consumer.
 */

declare module "corestore" {
  export default class Corestore {
    constructor(storage: string | unknown, opts?: Record<string, unknown>);
    ready(): Promise<void>;
    close(): Promise<void>;
    get(opts: unknown): unknown;
    namespace(name: string): Corestore;
    session(): Corestore;
    replicate(stream: unknown): unknown;
    primaryKey: Buffer;
  }
}

declare module "hyperswarm" {
  export default class Hyperswarm {
    constructor(opts?: Record<string, unknown>);
    join(topic: Buffer, opts?: { server?: boolean; client?: boolean }): unknown;
    on(event: string, handler: (...args: unknown[]) => void): this;
    flush(): Promise<void>;
    destroy(): Promise<void>;
    connections: Set<unknown>;
  }
}

declare module "hyperdrive" {
  export default class Hyperdrive {
    constructor(store: unknown, key?: Buffer | null);
    ready(): Promise<void>;
    close(): Promise<void>;
    key: Buffer;
    discoveryKey: Buffer;
    entry(path: string): Promise<unknown>;
    get(path: string): Promise<Buffer | null>;
    put(path: string, blob: Buffer, opts?: unknown): Promise<void>;
    createWriteStream(path: string, opts?: unknown): NodeJS.WritableStream;
    createReadStream(path: string, opts?: unknown): NodeJS.ReadableStream;
  }
}

declare module "autobase" {
  export default class Autobase {
    constructor(
      store: unknown,
      key: Buffer | null,
      opts: Record<string, unknown>,
    );
    static getLocalKey(
      store: unknown,
      opts?: Record<string, unknown>,
    ): Promise<Buffer>;
    ready(): Promise<void>;
    close(): Promise<void>;
    update(): Promise<void>;
    append(value: unknown, opts?: Record<string, unknown>): Promise<void>;
    on(event: string, handler: (...args: unknown[]) => void): this;
    key: Buffer;
    discoveryKey: Buffer;
    encryptionKey: Buffer | null;
    writable: boolean;
    local: { key: Buffer };
    view: any;
  }
}

declare module "hyperbee" {
  export default class Hyperbee {
    constructor(core: unknown, opts?: Record<string, unknown>);
    put(key: string, value: unknown): Promise<void>;
    get(key: string): Promise<{ seq: number; key: string; value: any } | null>;
    createReadStream(
      opts?: Record<string, unknown>,
    ): AsyncIterable<{ key: string; value: any }>;
  }
}

declare module "blind-pairing" {
  export default class BlindPairing {
    constructor(swarm: unknown, opts?: Record<string, unknown>);
    static createInvite(
      key: Buffer,
      opts?: Record<string, unknown>,
    ): {
      id: Buffer;
      invite: Buffer;
      publicKey: Buffer;
      expires: number;
      discoveryKey: Buffer;
    };
    addMember(opts: Record<string, unknown>): any;
    addCandidate(opts: Record<string, unknown>): any;
    close(): Promise<void>;
  }
}

declare module "serve-drive" {
  export default class ServeDrive {
    constructor(opts?: Record<string, unknown>);
    ready(): Promise<void>;
    close(): Promise<void>;
    getLink(path: string, opts?: Record<string, unknown>): string;
    port: number;
  }
}

declare module "z32" {
  const z32: {
    encode(buf: Uint8Array): string;
    decode(s: string): Buffer;
  };
  export default z32;
}

declare module "b4a" {
  const b4a: {
    from(input: string | Uint8Array | ArrayBuffer, enc?: string): Buffer;
    toString(buf: Uint8Array, enc?: string): string;
    isBuffer(value: unknown): boolean;
    equals(a: Uint8Array, b: Uint8Array): boolean;
  };
  export default b4a;
}

declare module "hypercore-crypto" {
  const crypto: {
    keyPair(seed?: Buffer): { publicKey: Buffer; secretKey: Buffer };
    discoveryKey(publicKey: Buffer): Buffer;
    randomBytes(n: number): Buffer;
  };
  export default crypto;
}
