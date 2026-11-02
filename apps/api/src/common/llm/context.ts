/**
 * 上下文窗口管理
 *
 * 规则：
 *   1. system 消息永远保留（超长时优先截断它自己）
 *   2. 从最新往回收，直到 token 预算用完
 *   3. 保留原始顺序
 *   4. 最后一条消息单独就超预算时，截断内容（保留尾部）而不是丢弃
 *
 * token 目前是字符估算，接 tiktoken 后只需替换 estimateTokens。
 */

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** 识图消息附带的图片（data URL）；截断时原样保留 */
  images?: string[];
}

/** 一张图按固定 token 估算（各家口径不同，取中位偏保守） */
const IMAGE_TOKENS = 800;

function costOf(msg: ChatMsg) {
  return estimateTokens(msg.content) + (msg.images?.length ?? 0) * IMAGE_TOKENS;
}

export interface TruncateOptions {
  maxContext: number;
  maxOutput: number;
  /** 协议与工具调用预留 */
  reserve?: number;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    // CJK 统一表意文字 / 中日韩标点 / 全角字符：约 1 字 1 token
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3000 && c <= 0x303f) || (c >= 0xff00 && c <= 0xffef)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.ceil(cjk + other / 4);
}

function cutToFit(content: string, tokenBudget: number): string {
  // token → 字符的反向估算，中文更密集，取保守值 2 字符/token
  const chars = Math.max(64, Math.floor(tokenBudget * 2));
  return content.length <= chars ? content : content.slice(-chars);
}

export function truncateContext<T extends ChatMsg>(messages: T[], opts: TruncateOptions): ChatMsg[] {
  const reserve = opts.reserve ?? 64;
  // 模型 maxContext 配得过小时预算可能是 0：兜底给一个最小预算，
  // 保证至少把最后一条用户消息截断后带上，而不是发空 messages 让上游 400
  const budget = Math.max(512, opts.maxContext - opts.maxOutput - reserve);

  if (messages.length === 0) return [];

  const systems = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');

  let used = 0;
  const keptSystems: ChatMsg[] = [];
  for (const sys of systems) {
    const cost = estimateTokens(sys.content);
    if (used + cost <= budget) {
      keptSystems.push(sys);
      used += cost;
    }
  }

  // 预算被 system 吃光：截断 system 内容，至少留个开头
  if (keptSystems.length === 0 && systems.length > 0) {
    const head = cutToFit(systems[0].content, Math.max(32, budget * 0.8));
    keptSystems.push({ role: 'system', content: head });
    used += estimateTokens(keptSystems[0].content);
  }

  const picked: ChatMsg[] = [];
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const msg = rest[i];
    const cost = costOf(msg);

    if (used + cost <= budget) {
      picked.unshift(msg);
      used += cost;
      continue;
    }

    // 一条都还没放下：截断最后这条（保留尾部，用户的问题在最后），图片原样保留
    if (picked.length === 0) {
      const imageCost = (msg.images?.length ?? 0) * IMAGE_TOKENS;
      const room = Math.max(32, budget - used - imageCost);
      const truncated: ChatMsg = {
        role: msg.role,
        content: cutToFit(msg.content, room),
        ...(msg.images?.length ? { images: msg.images } : {}),
      };
      picked.unshift(truncated);
      used += costOf(truncated);
    }
    break;
  }

  return [...keptSystems, ...picked];
}
