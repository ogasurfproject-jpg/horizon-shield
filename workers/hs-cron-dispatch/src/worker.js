// hs-cron-dispatch: Cloudflare cron triggers that start time-bound GitHub workflows with workflow_dispatch (2026-11-04).
// The rules are in core.mjs (tested by node without the network). This file only wires them to Cloudflare:
// the scheduled handler, the public GET handler, and the log as one SQLite backed Durable Object (one instance, "log").
// 0.3.0: the same Durable Object keeps the queue of delayed retries ("retry:" keys) and its alarm calls them.
// Secret (owner only, never in this file or in GitHub): GH_DISPATCH_TOKEN, a fine-grained token for
// ogasurfproject-jpg/horizon-shield only, with the repository permission Actions: read and write and nothing else.
import { DurableObject } from "cloudflare:workers";
import { runCron, runRetries, handleFetch, utcDay, earliestDue, LOG_KEEP_DAYS } from "./core.mjs";

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
  // The retry queue: one key per job@slot. One alarm per object, so it is always set to the earliest due item.
  async queueRetry(item) {
    await this.ctx.storage.put("retry:" + item.key, item);
    await this.armAlarm();
  }
  // Due items are deleted before they are returned (and so before their call): an alarm that runs again calls nothing.
  async takeDueRetries(now) {
    const all = await this.ctx.storage.list({ prefix: "retry:" });
    const due = [...all.values()].filter((x) => x.due <= now).sort((a, b) => a.due - b.due);
    if (due.length) await this.ctx.storage.delete(due.map((x) => "retry:" + x.key));
    await this.armAlarm();
    return due;
  }
  async armAlarm() {
    const next = earliestDue([...(await this.ctx.storage.list({ prefix: "retry:" })).values()]);
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }
  async alarm() {
    try {
      const r = await runRetries({ store: this, token: (this.env.GH_DISPATCH_TOKEN || "").trim(), now: Date.now(), doFetch: fetch });
      console.log("hs-cron-dispatch: alarm " + JSON.stringify(r));
    } catch (e) {
      // Thrown again so Cloudflare runs the alarm again; items already taken are not in the queue and are not called twice.
      console.error("hs-cron-dispatch: alarm failed: " + String((e && e.message) || e));
      throw e;
    }
  }
}

function store(env) {
  const s = env.LOG.get(env.LOG.idFromName("log"));
  return {
    getDay: (d) => s.getDay(d), claim: (d, k, e) => s.claim(d, k, e), append: (d, e) => s.append(d, e),
    getMeta: (k) => s.getMeta(k), putMeta: (k, v) => s.putMeta(k, v),
    queueRetry: (it) => s.queueRetry(it), takeDueRetries: (now) => s.takeDueRetries(now)
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
