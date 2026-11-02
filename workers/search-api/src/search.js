/**
 * 关键词匹配（纯函数，Worker 与本地脚本共用）
 *
 * 字幕条 / 段落按「块」存储：一个文档中连续的若干条，规范化文本（normalize.js）拼成一整串 norm，
 * 在整串上查找，因此词间空格、标点、繁简不影响匹配；视频中被切在相邻两条字幕里的一句话也能搜到
 * （文章段落之间有换行分隔，短语不跨段）。
 */
import { normalizeWithMap } from './normalize.js';

/**
 * @typedef {{ norm: string, lineStart: Int32Array, texts: string[] }} Block
 * lineStart[i]：第 i 条在 norm 中的起点，末尾多一项为 norm 长度
 */

/** 各条规范化长度 → 起点前缀和 */
export function lineStarts(lens) {
    const starts = new Int32Array(lens.length + 1);
    lens.forEach((n, i) => (starts[i + 1] = starts[i] + n));
    return starts;
}

// norm 中位置 pos 所在的条（块内下标，跳过规范化后为空的条）
function lineOf(b, pos) {
    let lo = 0;
    let hi = b.texts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (b.lineStart[mid] <= pos) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

// 不重叠的全部出现位置（与 SQL 中 replace 计数一致）
function occurrences(norm, term) {
    const list = [];
    for (let i = norm.indexOf(term); i >= 0; i = norm.indexOf(term, i + term.length)) list.push(i);
    return list;
}

// 多个词：滑动窗口找覆盖全部词且跨度 ≤ near 的最短区间，互不重叠
function nearMatches(occ, terms, near) {
    const events = occ.flatMap((list, t) => list.map((s) => ({ s, e: s + terms[t].length, t }))).sort((a, b) => a.s - b.s);
    const count = new Array(terms.length).fill(0);
    const matches = [];
    let have = 0;
    let l = 0;
    for (let r = 0; r < events.length; r++) {
        if (count[events[r].t]++ === 0) have++;
        while (have === terms.length) {
            while (count[events[l].t] > 1) count[events[l++].t]--;
            // 先按起点粗筛，避免高频词使窗口过长
            let end = 0;
            if (events[r].s - events[l].s <= near) for (let k = l; k <= r; k++) end = Math.max(end, events[k].e);
            if (end && end - events[l].s <= near) {
                matches.push(events.slice(l, r + 1).map((x) => [x.s, x.e]));
                count.fill(0);
                have = 0;
                l = r + 1;
            } else if (--count[events[l++].t] === 0) {
                have--;
            }
        }
    }
    return matches;
}

/**
 * 块内要展示的匹配：一处匹配 = 若干个出现位置 [起, 止)
 * 单个词为每次出现；多个词优先取在 near 字以内同时出现的位置，块内没有时退为各词各自的出现位置
 * @returns {{ occ: number[][], matches: [number, number][][] }}
 */
export function matchText(norm, terms, near) {
    const occ = terms.map((t) => occurrences(norm, t));
    const single = () =>
        occ.flatMap((list, t) => list.map((s) => [[s, s + terms[t].length]])).sort((a, b) => a[0][0] - b[0][0]);
    if (terms.length === 1) return { occ, matches: single() };
    const close = occ.every((o) => o.length) ? nearMatches(occ, terms, near) : [];
    return { occ, matches: close.length ? close : single() };
}

// 某条内的高亮区间（原文下标），含所有关键词在该条的出现（跨条的词各条各标一段）
function lineHighlights(b, i, occ, terms) {
    const ls = b.lineStart[i];
    const le = b.lineStart[i + 1];
    if (ls === le) return [];
    const local = [];
    occ.forEach((list, t) => {
        const len = terms[t].length;
        for (const s of list) {
            if (s >= le) break;
            if (s + len > ls) local.push([Math.max(s, ls) - ls, Math.min(s + len, le) - ls]);
        }
    });
    if (!local.length) return [];
    const { from, to } = normalizeWithMap(b.texts[i]);
    const ranges = local.filter(([x]) => x < from.length).map(([x, y]) => [from[x], to[Math.min(y, from.length) - 1]]).sort((p, q) => p[0] - q[0]);
    if (!ranges.length) return [];
    const merged = [ranges[0]];
    for (const [x, y] of ranges.slice(1)) {
        const last = merged.at(-1);
        if (x <= last[1]) last[1] = Math.max(last[1], y);
        else merged.push([x, y]);
    }
    return merged;
}

/**
 * 各处匹配 → 命中条 ± context 条，重叠或相邻的合并为一组；最多输出 budget 条
 * @param {Block} b
 * @returns {{ i: number, hit?: true, hl?: number[][] }[][]} i 为块内下标
 */
export function renderGroups(b, { occ, matches }, terms, context, budget) {
    const groups = [];
    for (const parts of matches) {
        const hit = new Set();
        for (const [s, e] of parts) for (let i = lineOf(b, s); i <= lineOf(b, e - 1); i++) hit.add(i);
        const from = Math.max(0, Math.min(...hit) - context);
        const to = Math.min(b.texts.length - 1, Math.max(...hit) + context);
        const last = groups.at(-1);
        if (last && from <= last.to + 1) {
            last.to = Math.max(last.to, to);
            hit.forEach((i) => last.hit.add(i));
        } else {
            groups.push({ from, to, hit });
        }
    }

    const out = [];
    let used = 0;
    for (const g of groups) {
        if (used >= budget) break;
        const lines = [];
        for (let i = g.from; i <= g.to && used < budget; i++, used++) {
            const hl = lineHighlights(b, i, occ, terms);
            lines.push({ i, ...(g.hit.has(i) ? { hit: true } : {}), ...(hl.length ? { hl } : {}) });
        }
        out.push(lines);
    }
    return out;
}

/**
 * 长段落截取以第一处高亮为中心的约 max 字，高亮区间随之平移；head / tail 表示前后被截断
 */
export function snippet(text, hl = [], max) {
    if (text.length <= max) return { text, ...(hl.length ? { hl } : {}) };
    const first = hl[0]?.[0] ?? 0;
    const to = Math.min(text.length, Math.max(0, first - Math.floor(max / 4)) + max);
    const from = Math.max(0, to - max);
    const ranges = hl.filter(([a, b]) => b > from && a < to).map(([a, b]) => [Math.max(a, from) - from, Math.min(b, to) - from]);
    return {
        text: text.slice(from, to),
        ...(ranges.length ? { hl: ranges } : {}),
        ...(from > 0 ? { head: true } : {}),
        ...(to < text.length ? { tail: true } : {}),
    };
}
