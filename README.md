# Presenter Hint Overlay

在 macOS 上显示 Google Docs 提词浮层。浮层始终置顶，平时不会挡住鼠标和键盘操作。

## 安装

需要先安装 Node.js，然后在项目目录运行：

```bash
npm install
```

## 运行

第一次运行时传入 Google Docs 链接：

```bash
npm run overlay -- --url='https://docs.google.com/document/d/文档ID/edit'
```

程序会记住这个链接，以后直接运行：

```bash
npm run overlay
```

Google Docs 文档需要设为“知道链接的人可查看”。建议把正文字号设为 20–28 磅。

## 快捷键

| 快捷键 | 作用 |
|---|---|
| `Cmd+Alt+Shift+O` | 隐藏或显示浮层 |
| `Cmd+Alt+Shift+↑` | 向上滚动 |
| `Cmd+Alt+Shift+↓` | 向下滚动 |
| `Cmd+Alt+Shift+←` | 向左滚动 |
| `Cmd+Alt+Shift+→` | 向右滚动 |
| `Cmd+Alt+Shift+M` | 进入或退出定位模式 |
| `Cmd+Alt+Shift+T` | 切换文档原色、黑字和白字 |
| `Cmd+Alt+Shift+Q` | 退出程序 |

进入定位模式后，可以拖动浮层；拖动右下角可以调整大小。再次按 `Cmd+Alt+Shift+M`，或者点击“锁定”即可恢复鼠标穿透。

## 配置

配置文件位于：

```text
~/Library/Application Support/presenter-hint-overlay/overlay-config.json
```

可以在这里修改快捷键、滚动距离、文字颜色和浮层位置。

屏幕共享时请只共享演示窗口，不要共享整个屏幕，否则观众也可能看到浮层。
