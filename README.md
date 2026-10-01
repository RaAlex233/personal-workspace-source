# 个人工作台

React + TypeScript 前端。包含任务分类、月/周日程、任务开始/结束计时、时间树、周报占位页，以及本地 JSON 导入导出。

## 本地运行

需要 Node.js 20.19+。在本目录执行：

```bash
npm ci
npm run dev
```

生产构建：`npm run build`。请在包含 `package.json` 的项目目录中执行命令。项目使用 `package-lock.json` 锁定依赖，请勿在同一目录混用 pnpm 和 npm。若之前在此目录运行过 pnpm，需要先删除生成的 `node_modules` 目录，再执行 `npm ci`。

## 数据说明

当前没有后端。数据保存在当前浏览器的 IndexedDB 中，换设备或清理浏览器数据前请从“数据管理”导出备份。导入时可选择替换或按记录 ID 合并。数据格式带 `schemaVersion`，模型位于 `src/data.ts`；读写集中在同一文件，后续可替换为 Java API。

“开始”和“结束”记录单次计时，任务可以重复计时。结束计时不会自动完成任务；使用任务前的勾选按钮标记完成。
