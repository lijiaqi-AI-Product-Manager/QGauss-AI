import type { Response } from 'express';
import type { WebSearchReport } from '../../common/llm/web-search';
import type { AgentActivity } from '../../common/llm/agent-activity';

type Packet = { seq: number; wire: string; bytes: number };
type Subscriber = { res: Response; blocked: boolean; dirty: boolean; close: () => void; drain: () => void; deadline?: NodeJS.Timeout };

/** One generation owns its output; HTTP connections only observe it. */
export class ChatRun {
  readonly controller = new AbortController();
  content = '';
  reasoning = '';
  webSearch?: WebSearchReport;
  agentActivity?:AgentActivity;
  seq = 0;
  cancelReason: string | null = null;
  private sealed = false;
  private finished = false;
  private meta: Record<string, unknown> = {};
  private done: Record<string, unknown> | null = null;
  private packets: Packet[] = [];
  private bufferedBytes = 0;
  private subscribers = new Set<Subscriber>();
  private orphanTimer?: NodeJS.Timeout;
  private heartbeat: NodeJS.Timeout;

  constructor(
    readonly userId: string,
    readonly conversationId: string,
    readonly messageId: string,
    private readonly detachedTimeoutMs: number,
    private readonly limits = { events: 512, bytes: 262_144, subscribers: 4 },
  ) {
    this.armOrphanTimeout();
    this.heartbeat = setInterval(() => {
      for (const sub of this.subscribers) if (!sub.blocked) this.send(sub, ': ping\n\n');
    }, 15_000);
    this.heartbeat.unref?.();
  }

  get signal() { return this.controller.signal; }

  cancel(reason = 'user_cancel') {
    if (this.sealed || this.finished) return false;
    if (!this.signal.aborted) {
      this.cancelReason = reason;
      this.controller.abort(new Error(reason));
    }
    return true;
  }

  seal() { this.sealed = true; if (this.orphanTimer) clearTimeout(this.orphanTimer); }

  snapshot() {
    return {
      ...this.meta, conversationId: this.conversationId, messageId: this.messageId,
      content: this.content, reasoning: this.reasoning,
      status: this.done?.status ?? this.meta.status ?? (this.content || this.reasoning ? 'STREAMING' : 'PENDING'),
      ...(this.done ?? {}), ...(this.webSearch?{webSearch:this.webSearch}:{}), ...(this.agentActivity?{agentActivity:this.agentActivity}:{}), seq: this.seq,
    };
  }

  emit(event: string, data: any) {
    if (this.finished || ((event === 'delta' || event === 'reasoning') && this.signal.aborted)) return;
    if (event === 'meta') {this.meta = data;if(data.agentActivity)this.agentActivity=data.agentActivity;}
    if (event === 'snapshot') { this.meta = { ...this.meta, ...data }; this.content = data.content ?? this.content; this.reasoning = data.reasoning ?? this.reasoning; }
    if (event === 'delta') this.content += data.v ?? '';
    if (event === 'reasoning') this.reasoning += data.v ?? '';
    if (event === 'search') this.webSearch = data;
    if (event === 'agent') this.agentActivity = data;
    if (event === 'done') this.done = data;
    const seq = ++this.seq;
    const wire = `id: ${seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const packet = { seq, wire, bytes: Buffer.byteLength(wire) };
    this.packets.push(packet);
    this.bufferedBytes += packet.bytes;
    while (this.packets.length > this.limits.events || this.bufferedBytes > this.limits.bytes) {
      this.bufferedBytes -= this.packets.shift()!.bytes;
    }
    for (const sub of this.subscribers) {
      if (sub.blocked) sub.dirty = true;
      else this.send(sub, wire);
    }
  }

  /** after=null requests replacement state; an expired cursor also receives a snapshot. */
  subscribe(res: Response, after: number | null) {
    if (res.destroyed || res.writableEnded) return;
    while (this.subscribers.size >= this.limits.subscribers) {
      const oldest = this.subscribers.values().next().value as Subscriber;
      this.end(oldest);
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    if (this.orphanTimer) clearTimeout(this.orphanTimer);
    const sub: Subscriber = { res, blocked: false, dirty: false, close: () => {}, drain: () => {} };
    sub.close = () => {
      this.subscribers.delete(sub);
      res.off('close', sub.close);
      res.off('error', sub.close);
      res.off('drain', sub.drain);
      if (sub.deadline) clearTimeout(sub.deadline);
      if (!this.subscribers.size && !this.finished && !this.sealed) this.armOrphanTimeout();
    };
    sub.drain = () => {
      sub.blocked = false;
      if (sub.dirty) { sub.dirty = false; this.sendSnapshot(sub); }
      if (this.finished && !sub.blocked) this.end(sub);
    };
    this.subscribers.add(sub);
    res.on('close', sub.close);
    res.on('error', sub.close);
    res.on('drain', sub.drain);
    const oldest = this.packets[0]?.seq ?? this.seq + 1;
    if (after === null || after > this.seq || after < oldest - 1) this.sendSnapshot(sub);
    else for (const packet of this.packets) if (packet.seq > after) {
      if (sub.blocked) { sub.dirty = true; break; }
      this.send(sub, packet.wire);
    }
    if (this.finished && !sub.blocked) this.end(sub);
  }

  finish() {
    this.finished = true;
    this.seal();
    clearInterval(this.heartbeat);
    for (const sub of this.subscribers) {
      if (!sub.blocked) this.end(sub);
      else {
        sub.deadline = setTimeout(() => { sub.close(); sub.res.destroy(); }, 5_000);
        sub.deadline.unref?.();
      }
    }
  }

  private sendSnapshot(sub: Subscriber) {
    this.send(sub, `id: ${this.seq}\nevent: snapshot\ndata: ${JSON.stringify(this.snapshot())}\n\n`);
  }

  private send(sub: Subscriber, wire: string) {
    try {
      if (sub.res.destroyed || sub.res.writableEnded) { sub.close(); return; }
      sub.blocked = sub.res.write(wire) === false;
    } catch { sub.close(); sub.res.destroy(); }
  }

  private end(sub: Subscriber) {
    try { sub.res.end(); } catch { sub.res.destroy(); }
    finally { sub.close(); }
  }

  private armOrphanTimeout() {
    if (this.orphanTimer) clearTimeout(this.orphanTimer);
    this.orphanTimer = setTimeout(() => this.cancel('detached_timeout'), this.detachedTimeoutMs);
    this.orphanTimer.unref?.();
  }
}
