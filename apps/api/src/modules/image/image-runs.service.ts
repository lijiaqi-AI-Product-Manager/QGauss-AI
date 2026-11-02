import { Injectable } from '@nestjs/common';

/** Single-instance handles only; durable task and billing state stay in the database. */
@Injectable()
export class ImageRunsService {
  private readonly active = new Map<string, AbortController>();

  open(id: string) {
    if (this.active.has(id)) throw new Error('图像任务已经在运行');
    const controller = new AbortController();
    this.active.set(id, controller);
    return controller;
  }

  close(id: string, controller: AbortController) {
    if (this.active.get(id) === controller) this.active.delete(id);
  }

  cancel(id: string) { this.active.get(id)?.abort(new Error('image task canceled')); }
  abortAll() { for (const controller of this.active.values()) controller.abort(new Error('image worker shutdown')); }
}
