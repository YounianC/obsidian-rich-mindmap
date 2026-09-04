import { setMindmapFlag } from "./collapse-state";

/**
 * 在 folderPath 下为新思维导图挑一个不重复的路径。
 * 规则与 Obsidian 自带「未命名 / 未命名 1 / 未命名 2」一致：先试无编号，再从 1 起递增。
 * folderPath 为 "/" 或 "" 时表示库根目录，返回的路径不带目录前缀。
 * exists 由调用方注入（通常是 vault.getAbstractFileByPath），保持本模块无 obsidian 依赖。
 *
 * basename 是**必需参数，不给默认值**：它跟随界面语言（见 i18n 的
 * `newFile.basename`），一旦在这里留一个中文默认值，调用方漏传时会静默用中文，
 * i18n 就形同虚设。本模块在纯函数层，不能自己去读语言。
 */
export function uniqueMindmapPath(
  folderPath: string,
  basename: string,
  exists: (path: string) => boolean,
): string {
  const prefix = folderPath === "/" || folderPath === "" ? "" : `${folderPath}/`;
  for (let n = 0; ; n++) {
    const base = n === 0 ? basename : `${basename} ${n}`;
    const path = `${prefix}${base}.md`;
    if (!exists(path)) return path;
  }
}

/**
 * 新思维导图的初始内容：`mindmap: true` frontmatter + 与文件名一致的一级标题。
 * 写 H1 是有意的——没有 H1 时根节点文字来自文件名且不会落盘，用户改不了根节点。
 * 末尾带换行，导图视图打开后不改动再切走不会产生 diff（写回归一化第 1 条）。
 */
export function newMindmapContent(title: string): string {
  return `---\n${setMindmapFlag(null, true)}\n---\n\n# ${title}\n`;
}
