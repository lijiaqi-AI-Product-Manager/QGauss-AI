import { Injectable } from '@nestjs/common';
@Injectable()
export class VideoRunsService {
  private readonly requests = new Map<string, AbortController>();
  open(id: string) { const controller = new AbortController(); this.requests.set(id, controller); return controller; }
  close(id: string, controller: AbortController) { if (this.requests.get(id) === controller) this.requests.delete(id); }
  abort(id: string) { this.requests.get(id)?.abort(new Error('QGauss video stopped')); }
  abortAll() { for (const controller of this.requests.values()) controller.abort(new Error('QGauss video service stopping')); }
}
