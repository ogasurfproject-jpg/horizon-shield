// blob_text.mjs  kv_table.mjs が大きい値を退避する Blob の面を、@azure/storage-blob の ContainerClient で満たす。
// 使う面: uploadText(name, text, meta) / downloadText(name) / deleteIfExists(name) / listOlderThan(prefix, ms)。
// 本文は UTF-8 で置く。meta.rk(指す entity の RowKey)を blob の metadata に持ち、掃除が持ち主を引けるようにする。

export function makeBlobText(container) {
  return {
    async uploadText(name, text, meta) {
      const buf = Buffer.from(String(text), "utf8");
      await container.getBlockBlobClient(name).uploadData(buf, {
        blobHTTPHeaders: { blobContentType: "text/plain; charset=utf-8" },
        metadata: meta && meta.rk ? { rk: String(meta.rk) } : undefined,
      });
    },
    async downloadText(name) {
      const buf = await container.getBlockBlobClient(name).downloadToBuffer();
      return buf.toString("utf8");
    },
    async deleteIfExists(name) {
      const r = await container.getBlockBlobClient(name).deleteIfExists();
      return { succeeded: !!(r && r.succeeded) };
    },
    async *listOlderThan(prefix, olderThanMs) {
      for await (const b of container.listBlobsFlat({ prefix, includeMetadata: true })) {
        const lm = b.properties && b.properties.lastModified ? new Date(b.properties.lastModified).getTime() : 0;
        if (lm < olderThanMs) yield { name: b.name, rk: (b.metadata && b.metadata.rk) || null, lastModified: lm };
      }
    },
  };
}
