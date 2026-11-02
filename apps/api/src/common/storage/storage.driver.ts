import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { dirname, join, normalize, resolve, sep } from 'node:path';

/**
 * 存储驱动抽象。
 * 本地磁盘和兼容 S3 的对象存储共用此接口。
 */
export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  openRange(key: string, start: number, end: number, total: number): Promise<Readable>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** 键只允许 YYYY/MM/uuid.ext，从根上杜绝路径穿越 */
const KEY_PATTERN = /^\d{4}\/\d{2}\/[a-z0-9-]{8,64}\.[a-z0-9]{1,8}$/;

export function assertSafeKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`非法存储键: ${key}`);
  }
}

export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  private pathOf(key: string): string {
    assertSafeKey(key);
    const full = normalize(join(this.root, key));
    // 二次确认：解析后必须仍在根目录内
    if (!full.startsWith(this.root + sep) && full !== this.root) {
      throw new Error('存储路径越界');
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.pathOf(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key));
  }

  async openRange(key: string, start: number, end: number, total: number): Promise<Readable> {
    const path = this.pathOf(key), info = await stat(path);
    if (!info.isFile() || info.size !== total || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= total) throw Error('文件范围或大小不一致');
    return createReadStream(path, { start, end });
  }

  async remove(key: string): Promise<void> {
    const full = this.pathOf(key);
    if (existsSync(full)) await rm(full, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.pathOf(key));
  }

  /** 供静态回源使用（本项目走鉴权接口，不直接暴露） */
  createReadStream(key: string) {
    return createReadStream(this.pathOf(key));
  }
}
