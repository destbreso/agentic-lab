// ============================================
// Qdrant Vector Store — Semantic Memory
// ============================================
// Extends the MemoryStore with vector search
// capabilities via Qdrant.

import type { MemoryStore, MemoryItem } from "../types/storage.js";

export interface QdrantConfig {
  url?: string;
  host?: string;
  port?: number;
  apiKey?: string;
  collectionName?: string;
  embeddingDimension?: number;
}

/** Qdrant point structure */
interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

/** Qdrant search result */
interface QdrantSearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

/** Embedding function type — user provides the embedding implementation */
export type EmbeddingFunction = (text: string) => Promise<number[]>;

/**
 * Every prefix of a namespace path: ["chat", "s1"] -> ["chat", "chat/s1"].
 * Stored on each point so a search for ["chat"] also finds ["chat", "s1"],
 * the same prefix rule the base stores apply to namespaces.
 */
export function namespacePrefixes(namespace: string[]): string[] {
  return namespace.map((_, i) => namespace.slice(0, i + 1).join("/"));
}

/**
 * Vector-enhanced Memory Store.
 * Wraps a base MemoryStore and adds semantic search via Qdrant.
 */
export class VectorMemoryStore implements MemoryStore {
  private baseUrl: string;
  private collectionName: string;
  private dimension: number;
  private headers: Record<string, string>;
  private embeddingFn: EmbeddingFunction;
  private baseStore: MemoryStore;
  private initialized = false;

  constructor(
    config: QdrantConfig,
    embeddingFn: EmbeddingFunction,
    baseStore: MemoryStore,
  ) {
    const host = config.host || "localhost";
    const port = config.port || 6333;
    this.baseUrl = config.url || `http://${host}:${port}`;
    this.collectionName = config.collectionName || "agentic_lab_memories";
    // 0 = not known yet: init() measures it from the embedding model.
    this.dimension = config.embeddingDimension ?? 0;
    this.headers = {
      "Content-Type": "application/json",
      ...(config.apiKey ? { "api-key": config.apiKey } : {}),
    };
    this.embeddingFn = embeddingFn;
    this.baseStore = baseStore;
  }

  /** The vector size in use (0 until init() has run without a configured size). */
  get vectorSize(): number {
    return this.dimension;
  }

  /**
   * Ensure the collection exists with the vector size the embedding model
   * produces. The size comes from the config or from embedding one probe
   * string. A collection created earlier with another size cannot hold these
   * vectors: an empty one is recreated with the right size, and one that
   * already holds points stops init with an explanation, instead of letting
   * every write and search fail later.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      if (!this.dimension) {
        let probe: number[];
        try {
          probe = await this.embeddingFn("dimension probe");
        } catch (error) {
          throw new Error(`the embedding model is not reachable (${(error as Error).message})`);
        }
        this.dimension = probe.length;
      }

      const res = await fetch(`${this.baseUrl}/collections/${this.collectionName}`, {
        headers: this.headers,
      });

      if (res.status === 404) {
        await this.createCollection();
      } else if (res.ok) {
        const info = (await res.json()) as {
          result?: {
            points_count?: number | null;
            config?: { params?: { vectors?: { size?: number } } };
          };
        };
        const size = info.result?.config?.params?.vectors?.size;
        if (typeof size === "number" && size !== this.dimension) {
          const points = info.result?.points_count ?? 0;
          if (points === 0) {
            // Nothing to lose: rebuild it with the size the model produces.
            await fetch(`${this.baseUrl}/collections/${this.collectionName}`, {
              method: "DELETE",
              headers: this.headers,
            });
            await this.createCollection();
          } else {
            throw new Error(
              `collection "${this.collectionName}" holds ${points} points of ${size}-dimension vectors, ` +
                `but the embedding model produces ${this.dimension}. Point QDRANT_COLLECTION at another ` +
                `collection, or delete this one so it is rebuilt with the right size`,
            );
          }
        }
      } else {
        throw new Error(`Qdrant answered ${res.status} ${res.statusText}`);
      }

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize Qdrant: ${(error as Error).message}`,
      );
    }
  }

  private async createCollection(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/collections/${this.collectionName}`, {
      method: "PUT",
      headers: this.headers,
      body: JSON.stringify({
        vectors: {
          size: this.dimension,
          distance: "Cosine",
        },
      }),
    });
    if (!res.ok) {
      throw new Error(
        `could not create collection "${this.collectionName}": ${res.status} ${res.statusText}`,
      );
    }
  }

  /** Store a memory with vector embedding */
  async put(
    namespace: string[],
    key: string,
    value: Record<string, unknown>,
  ): Promise<MemoryItem> {
    await this.init();

    // Store in base store first
    const item = await this.baseStore.put(namespace, key, value);

    // Generate embedding from the value
    const textContent = this.extractTextForEmbedding(value);
    if (textContent) {
      try {
        const vector = await this.embeddingFn(textContent);
        const pointId = crypto.randomUUID();

        // Upsert into Qdrant
        await fetch(
          `${this.baseUrl}/collections/${this.collectionName}/points`,
          {
            method: "PUT",
            headers: this.headers,
            body: JSON.stringify({
              points: [
                {
                  id: pointId,
                  vector,
                  payload: {
                    ...value,
                    namespace: namespace.join("/"),
                    namespace_prefixes: namespacePrefixes(namespace),
                    key,
                    memoryId: item.id,
                    text: textContent,
                  },
                },
              ],
            }),
          },
        );

        item.qdrantPointId = pointId;
      } catch {
        // Vector storage is best-effort — don't fail the whole operation
      }
    }

    return item;
  }

  /** Get a specific memory */
  async get(namespace: string[], key: string): Promise<MemoryItem | null> {
    return this.baseStore.get(namespace, key);
  }

  /** Search memories in a namespace */
  async search(
    namespace: string[],
    options?: { limit?: number },
  ): Promise<MemoryItem[]> {
    return this.baseStore.search(namespace, options);
  }

  /** Semantic search using vector similarity */
  async semanticSearch(
    namespace: string[],
    query: string,
    options?: { limit?: number },
  ): Promise<MemoryItem[]> {
    await this.init();

    const limit = options?.limit || 10;

    // Generate embedding for the query
    const queryVector = await this.embeddingFn(query);

    // Search in Qdrant
    const res = await fetch(
      `${this.baseUrl}/collections/${this.collectionName}/points/search`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          vector: queryVector,
          limit,
          // An empty namespace searches everything; otherwise the namespace and
          // everything under it. Points written before namespace_prefixes
          // existed still match their exact namespace.
          ...(namespace.length > 0
            ? {
                filter: {
                  should: [
                    { key: "namespace_prefixes", match: { value: namespace.join("/") } },
                    { key: "namespace", match: { value: namespace.join("/") } },
                  ],
                },
              }
            : {}),
          with_payload: true,
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`Qdrant search failed: ${res.statusText}`);
    }

    const data = (await res.json()) as { result: QdrantSearchResult[] };
    const results = data.result || [];

    // Fetch full memory items from the base store, each from its own
    // namespace (a hit can live below the searched one), once per item.
    const items: MemoryItem[] = [];
    const seen = new Set<string>();
    for (const result of results) {
      const key = result.payload.key as string;
      if (!key) continue;
      const hitNamespace =
        typeof result.payload.namespace === "string"
          ? result.payload.namespace.split("/").filter((s) => s.length > 0)
          : namespace;
      const item = await this.baseStore.get(hitNamespace, key);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }

    return items;
  }

  /** Delete a memory */
  async delete(namespace: string[], key: string): Promise<boolean> {
    // Delete from Qdrant by filter
    try {
      await fetch(
        `${this.baseUrl}/collections/${this.collectionName}/points/delete`,
        {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify({
            filter: {
              must: [
                { key: "namespace", match: { value: namespace.join("/") } },
                { key: "key", match: { value: key } },
              ],
            },
          }),
        },
      );
    } catch {
      /* best-effort */
    }

    return this.baseStore.delete(namespace, key);
  }

  /** Delete all memories in a namespace */
  async deleteNamespace(namespace: string[]): Promise<void> {
    // Delete from Qdrant by namespace
    try {
      await fetch(
        `${this.baseUrl}/collections/${this.collectionName}/points/delete`,
        {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify({
            filter: {
              must: [
                { key: "namespace", match: { value: namespace.join("/") } },
              ],
            },
          }),
        },
      );
    } catch {
      /* best-effort */
    }

    await this.baseStore.deleteNamespace(namespace);
  }

  /** Extract text from a value for embedding */
  private extractTextForEmbedding(value: Record<string, unknown>): string {
    // Try common text fields, then fall back to JSON stringification
    const textFields = [
      "text",
      "content",
      "description",
      "summary",
      "memory",
      "note",
    ];
    for (const field of textFields) {
      if (
        typeof value[field] === "string" &&
        (value[field] as string).length > 0
      ) {
        return value[field] as string;
      }
    }
    // Fall back to full JSON (capped)
    const json = JSON.stringify(value);
    return json.length > 8000 ? json.slice(0, 8000) : json;
  }
}

// -----------------------------------------------------------
// Embedding helpers — factory functions
// -----------------------------------------------------------

/** Create an OpenAI embedding function */
export function createOpenAIEmbedding(
  apiKey: string,
  model = "text-embedding-3-small",
): EmbeddingFunction {
  return async (text: string): Promise<number[]> => {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model,
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI embedding failed: ${res.statusText}`);
    }

    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  };
}

/** Create an Ollama embedding function */
export function createOllamaEmbedding(
  model = "nomic-embed-text",
  baseUrl = "http://localhost:11434",
): EmbeddingFunction {
  return async (text: string): Promise<number[]> => {
    const res = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text }),
    });

    if (!res.ok) {
      throw new Error(`Ollama embedding failed: ${res.statusText}`);
    }

    const data = (await res.json()) as { embeddings: number[][] };
    return data.embeddings[0];
  };
}
