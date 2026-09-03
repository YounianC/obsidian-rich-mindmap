import { PluginSettingTab, Setting, type App } from "obsidian";
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
