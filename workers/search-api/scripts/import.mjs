/**
 * 关键词搜索数据导入 D1，生成 out/import.sql（建表 + 清空旧数据 + 写入）后用 wrangler 执行
 * 由 hdcx 的 workers/fayu-api/scripts/import.mjs 移植：分块与 SQL 生成相同，文章改为读取 mkdocs 构建产物
 *   文章：site/ 下各页面 article 正文；分类 / 分组取自面包屑（nav.md-path），顺序同 mkdocs.yml 的 nav
 *   段落号：正文中符合 UNIT_SELECTOR 的叶子元素依次编号（从 1 起），
 *          docs/assets/javascripts/keyword-search.js 用同一规则定位 ?p= 段落，两边须保持一致
 *
 * 用法（workers/search-api 目录，须先在仓库根目录 mkdocs build）：
 *   npm run import              导入远程 D1
 *   npm run import -- --local   导入本地 D1（wrangler dev 用）
 *   npm run import -- --dry     只生成 SQL，不导入
 *   --site=<目录>               构建产物目录，默认仓库根目录的 site
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import { normalize } from '../src/normalize.js';

const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(WORKER_DIR, '../..');
const OUT_FILE = path.join(WORKER_DIR, 'out', 'import.sql');
const DB_NAME = 'putixuezi-search';
// 单块原文、规范化文本各自的字节上限（两者分表存放，每条 SQL 不超过 100KB）；块越大，每次搜索扫描的行数越少
const BLOCK_BYTES = 90_000;
// 段落单位：正文中这些元素里不再包含同类元素的（叶子），与前端 keyword-search.js 的 UNIT_SELECTOR 相同
const UNIT_SELECTOR = 'p, li, dt, dd, td, th, h2, h3, h4, h5, h6';
// 不参与搜索的页面（相对 site 的目录）
const SKIP = new Set(['', 'search', '404']);
// 超长段落按句拆成约 PIECE_CHARS 字的几份，沿用同一段落号
const MAX_UNIT_CHARS = 2000;
const PIECE_CHARS = 1500;

const sqlStr = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

// 与 hdcx rag/scripts/build-chunks.mjs 的 clean 相同：去控制字符、合并空白、去掉中文之间的空格
const clean = (s) =>
    s
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​﻿]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/(?<=[　-鿿＀-￯])\s(?=[　-鿿＀-￯])/g, '')
        .trim();

function parseArgs(argv = process.argv.slice(2)) {
    const args = {};
    for (const a of argv) {
        const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
        if (m) args[m[1]] = m[2] ?? true;
    }
    return args;
}

// mkdocs.yml nav 中各页面的顺序（页面目录 → 序号），用于导入顺序（同分数时的排序）
function navOrder() {
    const order = new Map();
    const yml = fs.readFileSync(path.join(ROOT, 'mkdocs.yml'), 'utf8');
    for (const m of yml.matchAll(/:\s*"?([^"\n]+?\.md)"?\s*$/gm)) {
        const dir = m[1].replace(/(^|\/)(index|README)\.md$/, '').replace(/\.md$/, '');
        if (!order.has(dir)) order.set(dir, order.size);
    }
    return order;
}

function listPages(siteDir) {
    const pages = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (!['assets', 'pagefind', 'search'].includes(e.name) || dir !== siteDir) walk(full);
            } else if (e.name === 'index.html') pages.push(full);
        }
    };
    walk(siteDir);
    return pages;
}

function splitLong(text) {
    if (text.length <= MAX_UNIT_CHARS) return [text];
    const pieces = [];
    let cur = '';
    for (const s of text.match(/[^。！？；]+[。！？；]*[”’」』）)]*|[。！？；]+/g) || [text]) {
        // 无标点的长句按 PIECE_CHARS 硬切
        for (let i = 0; i < s.length; i += PIECE_CHARS) {
            const part = s.slice(i, i + PIECE_CHARS);
            if (cur && cur.length + part.length > PIECE_CHARS) {
                pieces.push(cur);
                cur = '';
            }
            cur += part;
        }
    }
    if (cur) pieces.push(cur);
    return pieces;
}

// 只由一个页内锚点链接构成的列表项（文首「目录」），计入段落号但不索引，避免与正文标题重复命中
const isTocItem = (el) => {
    const links = el.querySelectorAll('a');
    return links.length === 1 && (links[0].getAttribute('href') || '').startsWith('#') && clean(links[0].text) === clean(el.text);
};

/** 文章：每个段落单位一条，marks 为段落号；conts 标记拆开的长段（与下一单位同属一段） */
export function loadArticles(siteDir) {
    const order = navOrder();
    const docs = [];
    for (const file of listPages(siteDir)) {
        const dir = path.relative(siteDir, path.dirname(file)).split(path.sep).join('/');
        if (SKIP.has(dir)) continue;
        // 每页都含完整导航（数 MB），只截取正文与面包屑两段解析，并复制字符串，避免整页 HTML 常驻内存
        const html = fs.readFileSync(file, 'utf8');
        const between = (open, close) => {
            const a = html.indexOf(open);
            const b = a < 0 ? -1 : html.indexOf(close, a);
            return b < 0 ? '' : html.slice(a, b + close.length);
        };
        const article = parse(between('<article class="md-content__inner', '</article>')).querySelector('article');
        if (!article) continue;
        article.querySelectorAll('a.headerlink').forEach((a) => a.remove());

        const own = (s) => (' ' + s).slice(1);
        const title = own(clean(article.querySelector('h1')?.text || dir));
        const crumbs = parse(between('<nav class="md-path"', '</nav>'))
            .querySelectorAll('.md-path__item')
            .map((li) => own(clean(li.text)))
            .slice(1);
        const cat = crumbs[0] || title;
        const d = {
            cat,
            grp: crumbs.length ? crumbs.join('/') : cat,
            grpLabel: crumbs.at(-1) || cat,
            title,
            url: `/${dir}/`,
            order: order.has(dir) ? order.get(dir) : Infinity,
            marks: [],
            texts: [],
            conts: [],
        };
        let p = 0;
        for (const el of article.querySelectorAll(UNIT_SELECTOR)) {
            if (el.querySelector(UNIT_SELECTOR)) continue;
            p++;
            const text = clean(el.text);
            if (!text || isTocItem(el)) continue;
            const pieces = splitLong(own(text));
            pieces.forEach((piece, k) => {
                d.marks.push(p);
                d.texts.push(piece);
                d.conts.push(k < pieces.length - 1);
            });
        }
        if (d.texts.length) docs.push(d);
    }
    return docs.sort((a, b) => a.order - b.order || a.url.localeCompare(b.url, 'zh-Hans-CN', { numeric: true }));
}

// 段落之间加换行（查询规范化后不含换行），使短语不跨段匹配；拆开的长段直接相连，允许跨份匹配
function toBlocks(d) {
    const blocks = [];
    let cur = null;
    d.texts.forEach((text, i) => {
        const norm = normalize(text) + (d.conts[i] ? '' : '\n');
        const textBytes = Buffer.byteLength(text) + String(d.marks[i]).length + 2;
        const normBytes = Buffer.byteLength(norm) + String(norm.length).length + 1;
        if (!cur || cur.textBytes + textBytes > BLOCK_BYTES || cur.normBytes + normBytes > BLOCK_BYTES) {
            cur = { seq: blocks.length, first: i, marks: [], texts: [], norms: [], textBytes: 0, normBytes: 0 };
            blocks.push(cur);
        }
        cur.marks.push(d.marks[i]);
        cur.texts.push(text);
        cur.norms.push(norm);
        cur.textBytes += textBytes;
        cur.normBytes += normBytes;
    });
    return blocks;
}

function buildSql(docs) {
    const hash = createHash('sha1');
    const out = [fs.readFileSync(path.join(WORKER_DIR, 'schema.sql'), 'utf8'), 'DELETE FROM block_norms;', 'DELETE FROM block_texts;', 'DELETE FROM docs;'];

    for (let i = 0; i < docs.length; i += 200) {
        const rows = docs.slice(i, i + 200).map((d, k) =>
            [i + k + 1, sqlStr(d.cat), sqlStr(d.grp), sqlStr(d.grpLabel), sqlStr(d.title), 'NULL', sqlStr(d.url), d.texts.length].join(', '),
        );
        const sql = `INSERT INTO docs (id, cat, grp, grp_label, title, series, url, units) VALUES\n(${rows.join('),\n(')});`;
        hash.update(sql);
        out.push(sql);
    }

    let blockCount = 0;
    docs.forEach((d, i) => {
        for (const b of toBlocks(d)) {
            const key = `${i + 1}, ${b.seq}`;
            const norms = `INSERT INTO block_norms (doc_id, seq, cat, norm, norm_lens) VALUES (${key}, ${sqlStr(d.cat)}, ${sqlStr(b.norms.join(''))}, ${sqlStr(b.norms.map((n) => n.length).join(','))});`;
            const texts = `INSERT INTO block_texts (doc_id, seq, first_unit, marks, texts) VALUES (${key}, ${b.first}, ${sqlStr(b.marks.join(','))}, ${sqlStr(b.texts.join('\n'))});`;
            hash.update(norms).update(texts);
            out.push(norms, texts);
            blockCount++;
        }
    });

    // 内容哈希含规范化结果，规范化规则变化也会换版本
    const version = hash.digest('hex').slice(0, 12);
    out.push(
        `INSERT OR REPLACE INTO meta (name, value) VALUES ('version', ${sqlStr(version)}), ('updated_at', ${sqlStr(new Date().toISOString())});`,
    );
    return { sql: out.join('\n') + '\n', version, blockCount };
}

function wrangler(args) {
    const res = spawnSync(process.execPath, [path.join(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...args], { cwd: WORKER_DIR, stdio: 'inherit' });
    if (res.status !== 0) throw new Error(`wrangler ${args.join(' ')} 失败（退出码 ${res.status}）`);
}

function main() {
    const args = parseArgs();
    const siteDir = path.resolve(ROOT, typeof args.site === 'string' ? args.site : 'site');
    if (!fs.existsSync(path.join(siteDir, 'index.html'))) throw new Error(`找不到 ${siteDir}，请先在仓库根目录执行 mkdocs build`);
    const docs = loadArticles(siteDir);
    const { sql, version, blockCount } = buildSql(docs);
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, sql);

    for (const [cat, list] of Object.entries(Object.groupBy(docs, (d) => d.cat))) {
        const units = list.reduce((n, d) => n + d.texts.length, 0);
        const chars = list.reduce((n, d) => n + d.texts.reduce((m, t) => m + t.length, 0), 0);
        console.log(`${cat.padEnd(14)} ${String(list.length).padStart(5)} 篇，${String(units).padStart(7)} 段，${(chars / 1e4).toFixed(0)} 万字`);
    }
    console.log(`共 ${docs.length} 篇，${blockCount} 块，版本 ${version}`);
    console.log(`SQL：${path.relative(ROOT, OUT_FILE)}（${(Buffer.byteLength(sql) / 1048576).toFixed(1)} MB）`);
    if (args.dry) return;

    const target = args.local ? '--local' : '--remote';
    wrangler(['d1', 'execute', DB_NAME, target, `--file=${path.relative(WORKER_DIR, OUT_FILE)}`, '--yes']);
    wrangler(['d1', 'execute', DB_NAME, target, '--command', 'SELECT COUNT(*) AS docs, SUM(units) AS units, (SELECT COUNT(*) FROM block_norms) AS blocks FROM docs']);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
