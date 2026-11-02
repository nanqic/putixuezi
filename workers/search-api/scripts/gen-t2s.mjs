/**
 * 生成繁→简单字映射 src/t2s.js（供 Worker 把繁体查询转成简体再匹配）
 * 用 opencc-js 逐字转换 BMP 内的 CJK 字符，合并 台湾 / 香港 / OpenCC 标准繁体三种来源，只保留一对一且有变化的字
 * 用法：pnpm --dir workers/fayu-api --ignore-workspace t2s
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as OpenCC from 'opencc-js';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/t2s.js');
const RANGES = [
    [0x3400, 0x4dbf],
    [0x4e00, 0x9fff],
    [0xf900, 0xfaff],
];

const converters = ['tw', 'hk', 't'].map((from) => OpenCC.Converter({ from, to: 'cn' }));
const map = new Map();
for (const [lo, hi] of RANGES) {
    for (let cp = lo; cp <= hi; cp++) {
        const ch = String.fromCodePoint(cp);
        for (const convert of converters) {
            const out = convert(ch);
            if (out !== ch && [...out].length === 1 && !map.has(ch)) map.set(ch, out);
        }
    }
}

const pairs = [...map].map(([t, s]) => t + s).join('');
fs.writeFileSync(
    OUT,
    `// 由 scripts/gen-t2s.mjs 生成（opencc-js），勿手改。每两个字一组：繁体 + 简体\nexport default '${pairs}';\n`,
);
console.log(`t2s: ${map.size} 字 → ${path.relative(process.cwd(), OUT)}`);
