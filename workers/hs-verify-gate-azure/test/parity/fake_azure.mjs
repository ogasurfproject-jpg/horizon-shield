// fake_azure.mjs  手元だけの偽物。Azure Table Storage の TableClient(@azure/data-tables の使う面だけ)と
// Blob の container(テキストの upload / download / delete だけ)。網には出ない。
//
// Table Storage の縛りのうち、adapter の作りを決める物は偽物でも縛る(落とし穴を手元で踏むため):
//   PartitionKey / RowKey: 1 KiB(1024 字)まで、"/" "\" "#" "?" と制御文字(U+0000-001F、U+007F-009F)は使えない
//   文字列の property: 64 KiB まで(UTF-16 なので 32,768 字)
//   entity 全体: 1 MiB まで(ここでは文字列を UTF-16 の 2 byte で数え、名前と鍵も足す。概算)
//   property の数: PartitionKey、RowKey、Timestamp を入れて 255 まで
//   ETag: 書くたびに変わる。If-Match が合わなければ 412、無い entity の update は 404、create の重なりは 409
//   query: PartitionKey と RowKey の範囲(eq、ge、gt、lt)だけ。RowKey の文字列順で返す(Table と同じ)
// 縛りの数は learn.microsoft.com の「Understanding the Table service data model」の記述から写した。

export class RestError extends Error {
  constructor(statusCode, message) { super(message); this.statusCode = statusCode; this.name = "RestError"; }
}

const FORBIDDEN_KEY = /[\/\\#?\u0000-\u001f\u007f-\u009f]/;
const PROP_MAX_CHARS = 32 * 1024;            // 64 KiB / 2
const ENTITY_MAX_BYTES = 1024 * 1024;
const PROPS_MAX = 255;

function checkKey(name, v) {
  if (typeof v !== "string") throw new RestError(400, name + " must be a string");
  if (v.length > 1024) throw new RestError(400, name + " longer than 1 KiB");
  if (FORBIDDEN_KEY.test(v)) throw new RestError(400, name + " has a character Table Storage refuses");
}
function entityBytes(e) {
  let n = 0;
  for (const [k, v] of Object.entries(e)) {
    n += k.length * 2 + 8;
    if (typeof v === "string") n += v.length * 2 + 4;
    else n += 8;
  }
  return n;
}
function checkEntity(e) {
  checkKey("PartitionKey", e.partitionKey);
  checkKey("RowKey", e.rowKey);
  const props = Object.keys(e).filter((k) => k !== "partitionKey" && k !== "rowKey" && k !== "etag");
  if (props.length + 3 > PROPS_MAX) throw new RestError(400, "too many properties");
  for (const k of props) {
    const v = e[k];
    if (typeof v === "string" && v.length > PROP_MAX_CHARS) throw new RestError(413, "property " + k + " over 64 KiB");
  }
  if (entityBytes(e) > ENTITY_MAX_BYTES) throw new RestError(413, "entity over 1 MiB");
}

// filter の形は adapter が作る物だけ受ける: "PartitionKey eq 'p' and RowKey ge 'a' and RowKey lt 'b'"(gt も可)
function parseFilter(f) {
  const out = [];
  for (const part of String(f || "").split(" and ")) {
    const m = /^(PartitionKey|RowKey) (eq|ge|gt|lt|le) '((?:[^']|'')*)'$/.exec(part.trim());
    if (!m) throw new RestError(400, "filter form not supported by the fake: " + part);
    out.push({ field: m[1] === "PartitionKey" ? "partitionKey" : "rowKey", op: m[2], v: m[3].replace(/''/g, "'") });
  }
  return out;
}
function match(e, conds) {
  for (const c of conds) {
    const x = e[c.field];
    if (c.op === "eq" && !(x === c.v)) return false;
    if (c.op === "ge" && !(x >= c.v)) return false;
    if (c.op === "gt" && !(x > c.v)) return false;
    if (c.op === "lt" && !(x < c.v)) return false;
    if (c.op === "le" && !(x <= c.v)) return false;
  }
  return true;
}

export class FakeTableClient {
  constructor(tableName) {
    this.tableName = tableName;
    this.rows = new Map();     // pk + "\u0000" + rk -> entity
    this.seq = 0;
    this.ops = { get: 0, upsert: 0, create: 0, update: 0, delete: 0, query_pages: 0 };
  }
  _k(pk, rk) { return pk + "\u0000" + rk; }
  _etag() { this.seq += 1; return "W/\"datetime'fake-" + this.seq + "'\""; }
  async getEntity(pk, rk) {
    this.ops.get++;
    const e = this.rows.get(this._k(pk, rk));
    if (!e) throw new RestError(404, "ResourceNotFound");
    return { ...e };
  }
  async createEntity(entity) {
    this.ops.create++;
    checkEntity(entity);
    const k = this._k(entity.partitionKey, entity.rowKey);
    if (this.rows.has(k)) throw new RestError(409, "EntityAlreadyExists");
    const etag = this._etag();
    this.rows.set(k, { ...entity, etag });
    return { etag };
  }
  async upsertEntity(entity, mode = "Merge") {
    this.ops.upsert++;
    const k = this._k(entity.partitionKey, entity.rowKey);
    const prev = this.rows.get(k);
    const next = mode === "Replace" || !prev ? { ...entity } : { ...prev, ...entity };
    delete next.etag;
    checkEntity(next);
    const etag = this._etag();
    this.rows.set(k, { ...next, etag });
    return { etag };
  }
  async updateEntity(entity, mode = "Merge", options = {}) {
    this.ops.update++;
    const k = this._k(entity.partitionKey, entity.rowKey);
    const prev = this.rows.get(k);
    if (!prev) throw new RestError(404, "ResourceNotFound");
    if (options.etag && options.etag !== "*" && options.etag !== prev.etag) throw new RestError(412, "UpdateConditionNotSatisfied");
    const next = mode === "Replace" ? { ...entity } : { ...prev, ...entity };
    delete next.etag;
    checkEntity(next);
    const etag = this._etag();
    this.rows.set(k, { ...next, etag });
    return { etag };
  }
  async deleteEntity(pk, rk, options = {}) {
    this.ops.delete++;
    const k = this._k(pk, rk);
    const prev = this.rows.get(k);
    if (!prev) throw new RestError(404, "ResourceNotFound");
    if (options.etag && options.etag !== "*" && options.etag !== prev.etag) throw new RestError(412, "UpdateConditionNotSatisfied");
    this.rows.delete(k);
    return {};
  }
  listEntities(options = {}) {
    const self = this;
    const conds = parseFilter(options.queryOptions && options.queryOptions.filter);
    const all = () => [...self.rows.values()].filter((e) => match(e, conds))
      .sort((a, b) => (a.partitionKey < b.partitionKey ? -1 : a.partitionKey > b.partitionKey ? 1 : a.rowKey < b.rowKey ? -1 : a.rowKey > b.rowKey ? 1 : 0));
    return {
      byPage({ maxPageSize = 1000, continuationToken } = {}) {
        return (async function* () {
          const rows = all();
          let i = continuationToken ? Number(continuationToken) : 0;
          const size = Math.min(maxPageSize, 1000);
          while (i < rows.length) {
            self.ops.query_pages++;
            const page = rows.slice(i, i + size).map((e) => ({ ...e }));
            i += size;
            page.continuationToken = i < rows.length ? String(i) : undefined;
            yield page;
          }
        })();
      },
    };
  }
}

export class FakeBlobContainer {
  constructor(name) { this.name = name; this.blobs = new Map(); this.ops = { upload: 0, download: 0, delete: 0 }; }
  async uploadText(blobName, text) { this.ops.upload++; this.blobs.set(blobName, String(text)); }
  async downloadText(blobName) {
    this.ops.download++;
    if (!this.blobs.has(blobName)) throw new RestError(404, "BlobNotFound");
    return this.blobs.get(blobName);
  }
  async deleteIfExists(blobName) { this.ops.delete++; return { succeeded: this.blobs.delete(blobName) }; }
}
