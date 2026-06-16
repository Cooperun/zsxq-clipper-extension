import fs from 'node:fs';
import path from 'node:path';

// 读取 ~/zsxq-clips/.archived/*.md 已入库帖子,去 frontmatter,返回 [{text}]
// 取前 5 条以保持测试快速/低成本。
export function readArchiveSamples() {
  const dir = path.join(process.env.HOME, 'zsxq-clips', '.archived');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .slice(0, 5)
    .map(f => {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      // 去 YAML frontmatter(--- ... ---),截断到 1000 字
      const text = raw.replace(/^---[\s\S]*?---/, '').trim();
      return { text: text.slice(0, 1000) };
    });
}
