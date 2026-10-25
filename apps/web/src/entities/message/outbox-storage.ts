import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type OutboxContainer =
  | { readonly kind: "channel"; readonly id: string }
  | { readonly kind: "direct"; readonly id: string };

export type OutboxState = "queued" | "sending" | "auth-required" | "failed" | "unknown";

export interface PendingTextMessage {
  readonly localId: string;
  readonly userId: string;
  readonly clientNonce: string;
  readonly container: OutboxContainer;
  readonly text: string;
  readonly replyToId: string | null;
  readonly createdAt: string;
  readonly state: OutboxState;
  readonly attempt: number;
  readonly retryAt: number | null;
  readonly uncertain: boolean;
  readonly errorCode: string | null;
}

export interface OutboxStorage {
  list(userId: string): Promise<readonly PendingTextMessage[]>;
  put(item: PendingTextMessage): Promise<void>;
  remove(userId: string, localId: string): Promise<void>;
  clear(userId: string): Promise<void>;
}

interface StoredTextMessage extends Omit<PendingTextMessage, "text" | "replyToId"> {
  readonly iv: Uint8Array<ArrayBuffer>;
  readonly ciphertext: ArrayBuffer;
}

interface OutboxDatabase extends DBSchema {
  entries: {
    key: string;
    value: StoredTextMessage;
    indexes: { byUser: string };
  };
  keys: { key: string; value: CryptoKey };
}

export class IndexedDbOutboxStorage implements OutboxStorage {
  private database?: Promise<IDBPDatabase<OutboxDatabase>>;

  private connect(): Promise<IDBPDatabase<OutboxDatabase>> {
    return (this.database ??= openDB<OutboxDatabase>("voreli-message-outbox", 1, {
      upgrade(database) {
        const entries = database.createObjectStore("entries", { keyPath: "localId" });
        entries.createIndex("byUser", "userId");
        database.createObjectStore("keys");
      },
    }));
  }

  async list(userId: string): Promise<readonly PendingTextMessage[]> {
    const database = await this.connect();
    const stored = await database.getAllFromIndex("entries", "byUser", userId);
    if (stored.length === 0) return [];
    const key = await database.get("keys", userId);
    if (!key) throw new Error("The local outbox encryption key is missing");
    return Promise.all(stored.map((item) => this.decrypt(item, key)));
  }

  async put(item: PendingTextMessage): Promise<void> {
    const database = await this.connect();
    const key = await this.keyFor(database, item.userId);
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ text: item.text, replyToId: item.replyToId }),
    );
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    await database.put("entries", {
      localId: item.localId,
      userId: item.userId,
      clientNonce: item.clientNonce,
      container: item.container,
      createdAt: item.createdAt,
      state: item.state,
      attempt: item.attempt,
      retryAt: item.retryAt,
      uncertain: item.uncertain,
      errorCode: item.errorCode,
      iv,
      ciphertext,
    });
  }

  async remove(userId: string, localId: string): Promise<void> {
    const database = await this.connect();
    const item = await database.get("entries", localId);
    if (item?.userId === userId) await database.delete("entries", localId);
  }

  async clear(userId: string): Promise<void> {
    const database = await this.connect();
    const transaction = database.transaction(["entries", "keys"], "readwrite");
    let cursor = await transaction.objectStore("entries").index("byUser").openCursor(userId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await transaction.objectStore("keys").delete(userId);
    await transaction.done;
  }

  private async keyFor(database: IDBPDatabase<OutboxDatabase>, userId: string): Promise<CryptoKey> {
    const existing = await database.get("keys", userId);
    if (existing) return existing;
    const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    try {
      await database.add("keys", generated, userId);
      return generated;
    } catch (error: unknown) {
      const raced = await database.get("keys", userId);
      if (raced) return raced;
      throw error;
    }
  }

  private async decrypt(item: StoredTextMessage, key: CryptoKey): Promise<PendingTextMessage> {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: item.iv },
      key,
      item.ciphertext,
    );
    const decoded: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("text" in decoded) ||
      typeof decoded.text !== "string" ||
      !("replyToId" in decoded) ||
      (decoded.replyToId !== null && typeof decoded.replyToId !== "string")
    ) {
      throw new Error("The local outbox payload is invalid");
    }
    return {
      localId: item.localId,
      userId: item.userId,
      clientNonce: item.clientNonce,
      container: item.container,
      createdAt: item.createdAt,
      state: item.state,
      attempt: item.attempt,
      retryAt: item.retryAt,
      uncertain: item.uncertain,
      errorCode: item.errorCode,
      text: decoded.text,
      replyToId: decoded.replyToId,
    };
  }
}
