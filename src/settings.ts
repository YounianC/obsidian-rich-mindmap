import {
  PluginSettingTab,
  Setting,
  type App,
  type SettingDefinitionItem,
} from "obsidian";
import type MindmapPlugin from "./main";

export interface MindmapSettings {
  /** 带 `mindmap: true` 的文件是否自动用思维导图视图打开 */
  autoOpen: boolean;
}

export const DEFAULT_SETTINGS: MindmapSettings = {
  autoOpen: true,
};

export class MindmapSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MindmapPlugin) {
    super(app, plugin);
  }

  /**
   * Obsidian ≥ 1.13 的声明式设置：能被设置面板的搜索索引到，读写由基类直接落到
   * `plugin.settings` 并持久化。定义非空时基类不会再调用下面的 display()。
   */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "自动以思维导图打开",
        desc: "文件 frontmatter 含 mindmap: true 时，打开即进入思维导图视图。",
        control: {
          type: "toggle",
          key: "autoOpen",
          defaultValue: DEFAULT_SETTINGS.autoOpen,
        },
      },
    ];
  }

  /** 1.13 之前的版本没有声明式 API，基类回退到这里手工渲染；内容要和上面保持一致。 */
  override display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName("自动以思维导图打开")
      .setDesc("文件 frontmatter 含 mindmap: true 时，打开即进入思维导图视图。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoOpen).onChange(async (value) => {
          this.plugin.settings.autoOpen = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
