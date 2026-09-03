import { TextFileView, type WorkspaceLeaf } from "obsidian";
import {
  applyCollapsedPaths,
  collectCollapsedPaths,
  readCollapsed,
  writeCollapsed,
} from "./model/collapse-state";
import { parse } from "./model/parser";
import { serialize } from "./model/serializer";
import type { MindDoc } from "./model/types";
import { clear, el } from "./view/dom";

export const MINDMAP_VIEW_TYPE = "mindmap-view";

const SAVE_DEBOUNCE_MS = 400;

export class MindmapView extends TextFileView {
  private doc: MindDoc | null = null;
  private readonly root: HTMLElement;
  private saveTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.root = el("div", "mindmap-view", this.contentEl);
  }

  override getViewType(): string {
    return MINDMAP_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? "思维导图";
  }

  override getIcon(): string {
    return "git-fork";
  }

  getDoc(): MindDoc | null {
    return this.doc;
  }

  /** Obsidian 读取文件内容后调用。 */
  override setViewData(data: string, _clear: boolean): void {
    const fileName = this.file?.name ?? "未命名.md";
    const parsed = parse(data, fileName);
    this.doc = {
      ...parsed,
      root: applyCollapsedPaths(parsed.root, readCollapsed(parsed.frontmatter)),
    };
    this.render();
  }

  /** Obsidian 保存时调用，必须返回当前完整文件内容。 */
  override getViewData(): string {
    if (this.doc === null) return this.data;
    return serialize(this.withCollapsedInFrontmatter(this.doc));
  }

  override clear(): void {
    this.doc = null;
    clear(this.root);
  }

  /** 更新内存文档、重绘、防抖写回文件。 */
  applyDoc(next: MindDoc): void {
    this.doc = next;
    this.render();
    this.scheduleSave();
  }

  /** 把当前折叠状态写进 frontmatter 的副本，不改动内存文档。 */
  private withCollapsedInFrontmatter(doc: MindDoc): MindDoc {
    return {
      ...doc,
      frontmatter: writeCollapsed(doc.frontmatter, collectCollapsedPaths(doc.root)),
    };
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  override async onClose(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.save();
    }
  }

  /** Task 9 会用真实渲染替换这里的临时文本输出。 */
  private render(): void {
    clear(this.root);
    if (this.doc === null) return;

    const pre = el("pre", "mindmap-debug", this.root);
    const lines: string[] = [];
    const walk = (node: MindDoc["root"], depth: number): void => {
      lines.push(`${"  ".repeat(depth)}${node.id} ${node.text}`);
      if (!node.collapsed) node.children.forEach((c) => walk(c, depth + 1));
    };
    walk(this.doc.root, 0);
    pre.textContent = lines.join("\n");
  }
}
