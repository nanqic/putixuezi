/**
 * 关键词搜索 API（D1 数据库 putixuezi-search，表结构见 schema.sql）：站内全部文章
 * 由 hdcx 的 fayu-api 移植，去掉了视频字幕部分；normalize.js / search.js / t2s.js 与其相同
 * GET /search?q=菩提心 慈悲心&page=1&size=10&c=问答,论典讲解
 *   q：关键词，空格分隔为多个词（须在同一篇文章中都出现）
 *   c：分类筛选，取值为导航顶级栏目名（导入时取自页面面包屑），逗号分隔，不传为全部
 *   返回 { terms, total（文档数）, matches（关键词出现次数）, facets（各分类文档数，不受 c 影响）, results }
 * GET /meta：数据版本与各分类文档数
 *
 * 检索分两步：① SQL 用 instr / replace 在规范化文本上统计各文档每个词的出现次数，排序分页
 * ② 只取回当前页文档的前几个命中块，在 JS 中定位命中段落、计算高亮区间与片段
 */
import { parseTerms } from './normalize.js';
import { lineStarts, matchText, renderGroups, snippet } from './search.js';

const MAX_QUERY_CHARS = 50;
const MAX_TERMS = 6;
const MAX_PAGE_SIZE = 20;
const MAX_CATS = 20;
const META_TTL_MS = 60_000;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const json = (data, status = 200, headers = {}) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...headers } });

// 数据版本缓存在 isolate 内存，每分钟核对一次（读 2 行）
let metaCache = null;

async function getMeta(env) {
    if (metaCache && Date.now() - metaCache.checkedAt < META_TTL_MS) return metaCache;
    const { results } = await env.DB.prepare('SELECT name, value FROM meta').all();
    const info = Object.fromEntries(results.map((r) => [r.name, r.value]));
    metaCache = { version: info.version || '', updatedAt: info.updated_at || '', checkedAt: Date.now() };
    return metaCache;
}

const placeholders = (n, from) => Array.from({ length: n }, (_, i) => `?${from + i}`).join(', ');

/**
 * @param {{ terms: string[], cats: string[], page: number, pageSize: number }} query
 */
async function search(env, { terms, cats, page, pageSize }) {
    const anyTerm = terms.map((_, i) => `instr(norm, ?${i + 1}) > 0`).join(' OR ');

    // ① 各文档每个词的出现次数（扫描 block_norms 全表）；须每个词都出现
    const sums = terms.map((_, i) => `SUM((length(norm) - length(replace(norm, ?${i + 1}, ''))) / length(?${i + 1})) AS c${i}`);
    const { results: rows } = await env.DB.prepare(`SELECT doc_id AS id, cat, ${sums.join(', ')} FROM block_norms WHERE ${anyTerm} GROUP BY doc_id`)
        .bind(...terms)
        .all();

    const facets = {};
    const ranked = [];
    for (const r of rows) {
        const counts = terms.map((_, i) => r[`c${i}`]);
        if (counts.some((c) => !c)) continue;
        facets[r.cat] = (facets[r.cat] || 0) + 1;
        if (!cats.length || cats.includes(r.cat)) ranked.push({ id: r.id, count: counts.reduce((a, b) => a + b, 0) });
    }
    // 出现次数多的在前，相同时按导入顺序（导航顺序）
    ranked.sort((a, b) => b.count - a.count || a.id - b.id);
    const pageItems = ranked.slice((page - 1) * pageSize, page * pageSize);

    // ② 当前页文档的元数据与前 MAX_BLOCKS_PER_DOC 个命中块（一次往返）
    const results = [];
    if (pageItems.length) {
        const ids = pageItems.map((x) => x.id);
        const idList = placeholders(ids.length, terms.length + 1);
        const [{ results: docs }, { results: blocks }] = await env.DB.batch([
            env.DB.prepare(`SELECT id, cat, grp, grp_label, title, series, url FROM docs WHERE id IN (${placeholders(ids.length, 1)})`).bind(...ids),
            env.DB.prepare(
                `SELECT h.doc_id, h.norm, h.norm_lens, t.first_unit, t.marks, t.texts FROM (
                    SELECT doc_id, seq, norm, norm_lens, ROW_NUMBER() OVER (PARTITION BY doc_id ORDER BY seq) AS rn
                    FROM block_norms WHERE doc_id IN (${idList}) AND (${anyTerm})
                ) h JOIN block_texts t ON t.doc_id = h.doc_id AND t.seq = h.seq
                WHERE h.rn <= ${Number(env.MAX_BLOCKS_PER_DOC)} ORDER BY h.doc_id, h.seq`,
            ).bind(...terms, ...ids),
        ]);

        const docById = new Map(docs.map((d) => [d.id, d]));
        const near = Number(env.NEAR_CHARS);
        for (const { id, count } of pageItems) {
            const d = docById.get(id);
            if (!d) continue;
            const groups = [];
            let budget = Number(env.MAX_PARAS);
            for (const row of blocks) {
                if (row.doc_id !== id || budget <= 0) continue;
                const block = { norm: row.norm, lineStart: lineStarts(row.norm_lens.split(',').map(Number)), texts: row.texts.split('\n') };
                const marks = row.marks.split(',').map(Number);
                for (const g of renderGroups(block, matchText(block.norm, terms, near), terms, 0, budget)) {
                    budget -= g.length;
                    groups.push(g.map(({ i, hit, hl }) => ({ p: marks[i], ...snippet(block.texts[i], hl, Number(env.SNIPPET_CHARS)), ...(hit ? { hit } : {}) })));
                }
            }
            results.push({ type: 'article', cat: d.cat, group: d.grp, groupLabel: d.grp_label, title: d.title, url: d.url, count, groups });
        }
    }

    return {
        total: ranked.length,
        matches: ranked.reduce((n, x) => n + x.count, 0),
        facets,
        results,
    };
}

function parseQuery(raw, cats) {
    const q = (raw || '').replace(/\s+/g, ' ').trim();
    if (!q) return { error: '缺少关键词' };
    if (q.length > MAX_QUERY_CHARS) return { error: `关键词不能超过 ${MAX_QUERY_CHARS} 字` };
    const terms = parseTerms(q, MAX_TERMS);
    if (!terms.length) return { error: '关键词需包含文字或数字' };
    return { q, terms, cats };
}

// 带结果缓存的搜索：缓存键为规范化后的查询 + 数据版本，重新导入后自动失效
async function cachedSearch(env, ctx, query, page, pageSize) {
    const meta = await getMeta(env);
    const key = new URL('https://putixuezi-search-cache.internal/search');
    key.searchParams.set('v', meta.version);
    key.searchParams.set('t', query.terms.join('|'));
    key.searchParams.set('c', [...query.cats].sort().join(','));
    key.searchParams.set('p', String(page));
    key.searchParams.set('s', String(pageSize));
    const cacheKey = new Request(key.toString());
    const cached = await caches.default.match(cacheKey);
    if (cached) return { data: await cached.json(), hit: true };

    const started = Date.now();
    const data = { q: query.q, terms: query.terms, page, pageSize, ...(await search(env, { ...query, page, pageSize })) };
    data.tookMs = Date.now() - started;
    const res = new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${env.CACHE_TTL}` } });
    ctx.waitUntil(caches.default.put(cacheKey, res));
    return { data, hit: false };
}

export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
        if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

        // 数据库开启了读副本，经 Sessions API 才会就近读副本；否则每次查询都要回到亚太区的主库（国内访问常落在美国节点）
        env = { ...env, DB: env.DB.withSession('first-unconstrained') };

        const url = new URL(request.url);
        const clientCache = { 'Cache-Control': `public, max-age=${env.CLIENT_CACHE_TTL}` };

        try {
            if (url.pathname === '/meta') {
                const meta = await getMeta(env);
                const { results } = await env.DB.prepare('SELECT cat, COUNT(*) AS docs FROM docs GROUP BY cat').all();
                return json({ version: meta.version, updatedAt: meta.updatedAt, cats: Object.fromEntries(results.map((r) => [r.cat, r.docs])) }, 200, clientCache);
            }

            if (url.pathname === '/search') {
                const p = url.searchParams;
                const cats = [...new Set((p.get('c') || '').split(',').map((c) => c.trim()).filter((c) => c && c.length <= 30))].slice(0, MAX_CATS);
                const query = parseQuery(p.get('q'), cats);
                if (query.error) return json({ error: query.error }, 400);
                const page = Math.max(1, parseInt(p.get('page'), 10) || 1);
                const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(p.get('size'), 10) || Number(env.PAGE_SIZE)));
                const { data, hit } = await cachedSearch(env, ctx, query, page, pageSize);
                return json(data, 200, { ...clientCache, 'X-Cache': hit ? 'HIT' : 'MISS' });
            }

            return json({ name: 'putixuezi-search', endpoints: ['/search?q=&page=&size=&c=', '/meta'] });
        } catch (err) {
            console.error(err);
            // D1 免费额度（每天读 500 万行）用完时，到 UTC 0 点（北京时间 8 点）恢复
            if (/daily row read limit/i.test(String(err?.message))) {
                return json({ error: '今日搜索次数已达上限，北京时间 8 点后恢复' }, 503);
            }
            return json({ error: '搜索暂不可用，请稍后重试' }, 500);
        }
    },
};
