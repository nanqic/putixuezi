/**
 * 检索用的文本规范化：字幕与查询走同一套规则，保证字面一致即可匹配
 * - 去掉空白与标点（语音转写的字幕词间常有空格，如“一 切众生”）
 * - 全角转半角、英文转小写
 * - 繁体转简体（单字映射，见 t2s.js）
 * 规范化后的字符与原文位置一一对应，用于把命中位置换算回原文做高亮
 */
import T2S_PAIRS from './t2s.js';

const T2S = new Map();
{
    const cps = [...T2S_PAIRS];
    for (let i = 0; i + 1 < cps.length; i += 2) T2S.set(cps[i], cps[i + 1]);
}

const KEEP = /[\p{L}\p{N}\p{M}]/u;
const slowCache = new Map();

// 单个字符（码点）规范化后的结果，可能为空串
function normChar(ch) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x4e00 && cp <= 0x9fff) return T2S.get(ch) || ch;
    if (cp < 0x80) {
        if ((cp >= 0x30 && cp <= 0x39) || (cp >= 0x61 && cp <= 0x7a)) return ch;
        if (cp >= 0x41 && cp <= 0x5a) return String.fromCharCode(cp + 32);
        return '';
    }
    let out = slowCache.get(ch);
    if (out === undefined) {
        out = '';
        for (const c of ch.normalize('NFKC').toLowerCase()) if (KEEP.test(c)) out += T2S.get(c) || c;
        slowCache.set(ch, out);
    }
    return out;
}

/** 规范化整段文本 */
export function normalize(text) {
    let out = '';
    for (const ch of text) out += normChar(ch);
    return out;
}

/**
 * 规范化并记录位置：map[i] 为规范化串第 i 个 UTF-16 单元对应的原文 [起, 止)
 * @returns {{ norm: string, from: number[], to: number[] }}
 */
export function normalizeWithMap(text) {
    let norm = '';
    const from = [];
    const to = [];
    let i = 0;
    for (const ch of text) {
        const out = normChar(ch);
        for (let k = 0; k < out.length; k++) {
            from.push(i);
            to.push(i + ch.length);
        }
        norm += out;
        i += ch.length;
    }
    return { norm, from, to };
}

const SEPARATORS = /[\s,，、;；|/／]+/;

/**
 * 查询拆词：空白与常见分隔符分词 → 规范化 → 去重 → 去掉被其他词包含的词（“菩提 菩提心”只留“菩提心”）
 * @returns {string[]}
 */
export function parseTerms(q, maxTerms) {
    const terms = [...new Set(q.split(SEPARATORS).map(normalize).filter(Boolean))];
    return terms
        .filter((t, i) => !terms.some((o, j) => j !== i && o.length > t.length && o.includes(t)))
        .slice(0, maxTerms);
}
