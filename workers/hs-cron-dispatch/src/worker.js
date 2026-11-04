// hs-cron-dispatch: Cloudflare cron triggers that start time-bound GitHub workflows with workflow_dispatch (2026-11-04).
// The rules are in core.mjs (tested by node without the network). This file only wires them to Cloudflare:
// the scheduled handler, the public GET handler, and the log as one SQLite backed Durable Object (one instance, "log").
// Secret (owner only, never in this file or in GitHub): GH_DISPATCH_TOKEN, a fine-grained token for
// ogasurfproject-jpg/horizon-shield only, with the repository permission Actions: read and write and nothing else.
import { DurableObject } from "cloudflare:workers";
import { runCron, handleFetch, utcDay, LOG_KEEP_DAYS } from "./core.mjs";

export class DispatchLog extends DurableObject {
  async getDay(day) { return (await this.ctx.storage.get("day:" + day)) || null; }
  // Read, check and write with no other await in between: the object runs one call at a time, so two invocations of the
  // same cron minute cannot both claim a slot.
  async claim(day, slot, entry) {
    const k = "day:" + day;
    const x = (await this.ctx.storage.get(k)) || { day, slots: [], entries: [] };
    if (x.slots.includes(slot)) return false;
    x.slots.push(slot); x.entries.push(entry);
    await this.ctx.storage.put(k, x);
    await this.prune(day);
    return true;
  }
  async append(day, entry) {
    const k = "day:" + day;
    const x = (await this.ctx.storage.get(k)) || { day, slots: [], entries: [] };
    x.entries.push(entry);
    await this.ctx.storage.put(k, x);
  }
  async getMeta(key) { return (await this.ctx.storage.get("meta:" + key)) || null; }
  async putMeta(key, value) { await this.ctx.storage.put("meta:" + key, value); }
  async prune(today) {
    const cut = utcDay(Date.parse(today + "T00:00:00Z") - LOG_KEEP_DAYS * 86400000);
    const old = await this.ctx.storage.list({ prefix: "day:", end: "day:" + cut, limit: 50 });
    if (old.size) await this.ctx.storage.delete([...old.keys()]);
  }
}

function store(env) {
  const s = env.LOG.get(env.LOG.idFromName("log"));
  return {
    getDay: (d) => s.getDay(d), claim: (d, k, e) => s.claim(d, k, e), append: (d, e) => s.append(d, e),
    getMeta: (k) => s.getMeta(k), putMeta: (k, v) => s.putMeta(k, v)
  };
}

export default {
  async scheduled(controller, env, ctx) {
    const p = runCron({ store: store(env), token: (env.GH_DISPATCH_TOKEN || "").trim(), cron: controller.cron, scheduledTime: controller.scheduledTime, now: Date.now(), doFetch: fetch })
      .then((r) => console.log("hs-cron-dispatch: " + controller.cron + " " + JSON.stringify(r)))
      .catch((e) => console.error("hs-cron-dispatch: run failed: " + String((e && e.message) || e)));
    ctx.waitUntil(p);
  },
  async fetch(request, env) {
    return handleFetch({ request, store: store(env), token: (env.GH_DISPATCH_TOKEN || "").trim(), now: Date.now(), doFetch: fetch });
  }
};
