# 互联网英文文化交流平台 · GitHub Pages 发布包

这是一个可直接作为 GitHub Pages 仓库根目录的纯静态发布包。

## 发布方式

1. 在 GitHub 新建一个公开仓库。
2. 将本目录内的全部文件上传到仓库根目录，并提交到 `main` 分支。
3. 进入仓库的 `Settings` → `Pages`。
4. 在 `Build and deployment` 中选择 `Deploy from a branch`。
5. 选择 `main` 分支和 `/(root)`，然后保存。
6. GitHub Pages 发布完成后，通过仓库页面显示的 `github.io` 地址访问。

如果仓库名是 `username.github.io`，地址通常为：

```text
https://username.github.io/
```

如果仓库名是普通项目名，例如 `english-learning-platform`，地址通常为：

```text
https://username.github.io/english-learning-platform/
```

本包已经使用相对路径，以上两种地址均可使用。

## 公开版功能

- 全部课程、词汇卡、短语卡与间隔复习
- 三击查词与短语收集
- 浏览器英文朗读
- 麦克风录音、浏览器语音识别和内容匹配反馈
- PWA 离线缓存与移动端“添加到主屏幕”支持

## 不包含的本地功能

云端音素级发音评测需要安全的服务端代理，不能放进公开静态网站。本公开版不会显示密钥输入入口，避免任何人误把 Azure 或其他云端密钥暴露到浏览器中。

学习进度保存在每位学习者自己的浏览器中，不会跨设备同步。
