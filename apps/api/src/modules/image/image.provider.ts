import { Injectable, Logger } from '@nestjs/common';
import { safeFetch } from '../../common/net/safe-fetch';
import { imageFeatures } from './image-features';

export interface GeneratedImage {
  buffer: Buffer;
  mime: string;
}

export interface SourceImage {
  buffer: Buffer;
  mime: string;
}

export interface ImageProviderInput {
  prompt: string;
  negativePrompt?: string;
  size: string;
  n: number;
  /** 图生图：参考图 */
  sourceImage?: SourceImage;
  sourceImages?: SourceImage[];
  maskImage?: SourceImage;
  /**
   * 上游模型名（如 gpt-image-2.5）。
   * OpenAI 原生 /images/generations 可以不带，但多数中转网关必须带，
   * 不带会返回 400 model not register。
   */
  model?: string;
  quality?: string;
  ratio?: string;
  resolution?: string;
  seed?: number;
  shouldContinue?: () => Promise<boolean>;
  signal?: AbortSignal;
}

export interface ProviderResult {
  images: GeneratedImage[];
  /** 供应商回传的附加信息（如 revised_prompt） */
  meta?: Record<string, unknown>;
}

function imageRequestSignal(timeoutMs: number, signal?: AbortSignal) {
  // safeFetch returns after headers; this signal also bounds JSON and image-body consumption.
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

/**
 * 图像生成适配器
 *
 * MOCK      本地 SVG 占位，离线可跑通整条异步链路
 * OPENAI    /images/generations（b64_json）
 * GEMINI    Nano Banana：generateContent + inline_data
 */
@Injectable()
export class ImageProvider {
  private readonly logger = new Logger(ImageProvider.name);

  async generate(
    channel: { id: string; type: string; baseUrl: string; apiKey: string; timeoutMs: number },
    input: ImageProviderInput,
  ): Promise<ProviderResult> {
    input.signal?.throwIfAborted();
    const sources = input.sourceImages || (input.sourceImage ? [input.sourceImage] : []), features = imageFeatures(channel.type, input.model);
    if (sources.length > features.maxReferences || (input.maskImage && (!features.mask || !sources.length))) throw new Error('当前渠道不支持这组参考图或局部重绘设置');
    if (channel.type === 'MOCK' || channel.baseUrl.startsWith('mock://')) {
      return { images: await this.generateMock(input) };
    }
    if (channel.type === 'GEMINI') {
      if (input.quality && input.quality !== 'auto') throw new Error('此模型使用自动画质');
      const images: GeneratedImage[] = [];
      let meta: Record<string, unknown> | undefined;
      const count = Math.min(4, Math.max(1, input.n));
      while (images.length < count) {
        input.signal?.throwIfAborted();
        if (input.shouldContinue && !(await input.shouldContinue())) break;
        try {
          const result = await this.generateNanoBanana(channel, { ...input, n: 1, seed: input.seed === undefined ? undefined : (input.seed + images.length) >>> 0 });
          images.push(...result.images.slice(0, count - images.length));
          meta = result.meta;
        } catch (error) {
          if (input.signal?.aborted) throw error;
          if (!images.length) throw error;
          meta = { ...meta, partial: true, message: '部分图片未能完成，按实际成功张数结算' };
          break;
        }
      }
      return { images, meta };
    }
    return this.generateOpenAI(channel, input);
  }

  /** 供应商标识，写入任务记录 */
  static providerName(channelType: string): string {
    if (channelType === 'GEMINI') return 'nanoBanana';
    if (channelType === 'MOCK') return 'mock';
    return 'gptImage';
  }

  private async generateMock(input: ImageProviderInput): Promise<GeneratedImage[]> {
    const esc = (s: string) =>
      s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

    const tag = input.sourceImage ? 'img2img' : 'txt2img';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#eef2ff"/><stop offset="100%" stop-color="#dbeafe"/>
  </linearGradient></defs>
  <rect width="512" height="512" rx="24" fill="url(#g)"/>
  <text x="256" y="236" font-family="sans-serif" font-size="26" fill="#2f6bff" text-anchor="middle">QGauss AI</text>
  <text x="256" y="272" font-family="sans-serif" font-size="14" fill="#6b7280" text-anchor="middle">${esc(input.prompt.slice(0, 34))}</text>
  <text x="256" y="300" font-family="sans-serif" font-size="12" fill="#9aa3b2" text-anchor="middle">${esc(input.size)} · mock · ${tag}</text>
</svg>`;

    return Array.from({ length: Math.min(input.n, 4) }, () => ({
      buffer: Buffer.from(svg, 'utf8'),
      mime: 'image/svg+xml',
    }));
  }

  private async generateOpenAI(
    channel: { baseUrl: string; apiKey: string; timeoutMs: number },
    input: ImageProviderInput,
  ): Promise<ProviderResult> {
    const base = channel.baseUrl.replace(/\/+$/, '');
    // 有些中转站把整个入口写进 baseUrl（如 .../v1/api/generate），再拼
    // /images/generations 就 404。baseUrl 已经是「可提交的端点」时直接用。
    const sources = input.sourceImages || (input.sourceImage ? [input.sourceImage] : []), source = sources[0];
    const isEndpoint = /\/(generate|images\/(generations|edits)|image\/generations)$/i.test(base);
    if (source && /\/generate$/i.test(base)) throw new Error('参考图需要标准 Images API 基地址或 /images/edits 入口');
    const url = source
      ? /\/images\/generations$/i.test(base) ? base.replace(/generations$/i, 'edits') : /\/images\/edits$/i.test(base) ? base : `${base}/images/edits`
      : isEndpoint ? base : `${base}/images/generations`;
    const gptImage = /^(gpt-image|chatgpt-image)/i.test(input.model ?? '');
    const payload = {
      ...(input.model ? { model: input.model } : {}),
      prompt: input.negativePrompt ? `${input.prompt}\n\nNegative: ${input.negativePrompt}` : input.prompt,
      n: Math.min(input.n, 4),
      size: input.size,
      ...(input.quality ? { quality: input.quality } : {}),
      // GPT Image returns base64 by default and rejects this legacy parameter.
      ...(!gptImage ? { response_format: 'b64_json' } : {}),
    };
    let body: string | FormData = JSON.stringify(payload);
    if (source) {
      const form = new FormData();
      for (const [key, value] of Object.entries(payload)) form.append(key, String(value));
      sources.forEach((image, index) => form.append('image[]', new Blob([new Uint8Array(image.buffer)], { type: image.mime }), `reference-${index + 1}.` + (image.mime.split('/')[1] || 'png')));
      if (input.maskImage) form.append('mask', new Blob([new Uint8Array(input.maskImage.buffer)], { type: input.maskImage.mime }), 'QGauss-selection.png');
      body = form;
    }

    const res = await safeFetch(
      url,
      {
        method: 'POST',
        headers: {
          ...(!source ? { 'Content-Type': 'application/json' } : {}),
          ...(channel.apiKey ? { Authorization: `Bearer ${channel.apiKey}` } : {}),
        },
        body,
      },
      { timeoutMs: channel.timeoutMs, allowHttp: process.env.ALLOW_HTTP_UPSTREAM === '1', signal: imageRequestSignal(channel.timeoutMs, input.signal) },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`图像上游返回 ${res.status}: ${text.slice(0, 200)}`);
    }

    const json: any = await res.json();
    // 两种真实结构都见过：
    //   OpenAI 官方：{ data: [{ b64_json | url }] }
    //   中转站（grsai 等）：{ status, results: [{ url }] }
    const items = json?.data ?? json?.results ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('图像上游没有返回任何结果');
    }

    // b64 直接解；只有 url 的必须下载回来——本项目把图片落到自己的存储里，
    // 不能只存外链（外链会过期，且回源要经过第三方）。
    const images: Array<{ buffer: Buffer; mime: string }> = [];
    for (const item of items) {
      if (typeof item?.b64_json === 'string') {
        images.push({ buffer: Buffer.from(item.b64_json, 'base64'), mime: 'image/png' });
        continue;
      }
      if (typeof item?.url === 'string' && /^https?:\/\//i.test(item.url)) {
        const img = await safeFetch(
          item.url,
          { method: 'GET' },
          { timeoutMs: channel.timeoutMs, allowHttp: process.env.ALLOW_HTTP_UPSTREAM === '1', signal: imageRequestSignal(channel.timeoutMs, input.signal) },
        );
        if (!img.ok) throw new Error(`下载生成图失败 ${img.status}`);
        const buf = Buffer.from(await img.arrayBuffer());
        if (buf.length > 25 * 1024 * 1024) throw new Error('生成图超过 25MB，拒绝落盘');
        const ct = img.headers.get('content-type') ?? 'image/png';
        images.push({ buffer: buf, mime: ct.split(';')[0].trim() || 'image/png' });
        continue;
      }
      throw new Error('上游结果既没有 b64_json 也没有可下载的 url');
    }

    // revised_prompt 是 data[i] 上的字段，不在顶层
    const revised = items
      .map((item: any) => item?.revised_prompt)
      .filter((v: unknown): v is string => typeof v === 'string');
    return { images, meta: revised.length ? { revisedPrompt: revised } : undefined };
  }

  /**
   * Nano Banana（Gemini 图像模型）
   * POST {base}/models/{model}:generateContent
   * 返回 candidates[].content.parts[].inlineData.data（base64）
   */
  private async generateNanoBanana(
    channel: { baseUrl: string; apiKey: string; timeoutMs: number },
    input: ImageProviderInput,
  ): Promise<ProviderResult> {
    const model = input.model || process.env.NANO_BANANA_MODEL || 'gemini-2.5-flash-image';
    const base = channel.baseUrl.replace(/\/+$/, '');
    const url = `${base}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`;

    const parts: any[] = [{ text: input.negativePrompt ? `${input.prompt}\n\nNegative: ${input.negativePrompt}` : input.prompt }];
    for (const image of input.sourceImages || (input.sourceImage ? [input.sourceImage] : [])) {
      parts.push({
        inline_data: {
          mime_type: image.mime,
          data: image.buffer.toString('base64'),
        },
      });
    }

    const res = await safeFetch(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(channel.apiKey ? { 'x-goog-api-key': channel.apiKey } : {}),
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            ...(input.seed === undefined ? {} : { seed: input.seed }),
            imageConfig: { ...(input.ratio ? { aspectRatio: input.ratio } : {}), ...(!/gemini-2\.5-flash-image|flash-lite-image/i.test(model) && input.resolution ? { imageSize: input.resolution } : {}) },
          },
        }),
      },
      { timeoutMs: channel.timeoutMs, allowHttp: process.env.ALLOW_HTTP_UPSTREAM === '1', signal: imageRequestSignal(channel.timeoutMs, input.signal) },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`NanoBanana 返回 ${res.status}: ${text.slice(0, 200)}`);
    }

    const json: any = await res.json();
    const returned = json?.candidates?.[0]?.content?.parts ?? [];
    const images: GeneratedImage[] = [];

    for (const part of returned) {
      const inline = part?.inlineData ?? part?.inline_data;
      if (inline?.data) {
        images.push({
          buffer: Buffer.from(inline.data, 'base64'),
          mime: inline.mimeType ?? inline.mime_type ?? 'image/png',
        });
      }
    }

    if (images.length === 0) {
      throw new Error('NanoBanana 没有返回图片（可能被安全策略拦截）');
    }

    return { images, meta: { model } };
  }
}
