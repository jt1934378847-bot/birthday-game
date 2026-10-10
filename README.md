# 生日副本 · 致我小小的朋友

> 12 关叙事闯关游戏，给朋友的生日礼物。
> 「生日快乐不是庆祝你生日，而是庆祝你存在。」

---

## 🚀 启动

任意一种本地静态服务器即可：

```bash
# 方式 1：Python（最简单）
python3 -m http.server 3000

# 方式 2：Node
npx serve .

# 方式 3：直接用 VSCode Live Server 插件
```

打开 `http://localhost:3000/`，用手机访问（移动端优先）。

**生日密钥**：`20261011`（8 位 YYYYMMDD）

---

## 📁 项目结构

```
birthday-game/
├── index.html        # 单页入口（包含 8 个 <template>）
├── styles.css        # 全部样式
├── config.js         # ⚙️ 所有文案 / 答案 / 音乐路径
├── app.js            # 状态机 + 12 关渲染
└── assets/
    ├── images/
    │   ├── me.png        # 制作人卡通形象（熊耳朵）
    │   ├── friend.png    # 寿星卡通形象（狗耳朵）
    │   └── (合照.jpg)    # 留作关卡 7 拼图用
    └── audio/
        ├── star-song.mp3       # 关卡 5：遇见你的时候所有星星都落到我头上
        ├── tomorrow-hello.mp3  # 关卡 6：明天，你好
        ├── birthday-song.mp3   # 关卡 8：生日快乐
        ├── letter-voice.m4a    # 结局信内嵌录音
        └── bgm.mp3             # 可选背景乐
```

---

## ✏️ 改文案

**99% 的修改都只需要编辑 `config.js`**，包含：
- 密码 `meta.password`
- 起始 / 恭喜 / 欢迎 / 结局文案
- 12 关的题目、选项、答案、提示、通关文案
- 生日信全文

---

## 🎵 添加音频

把音频文件直接拖到 `assets/audio/`，文件名对应 `config.js` 里的 `audio` 配置：

```js
audio: {
  starSong: "assets/audio/star-song.mp3",
  tomorrowHello: "assets/audio/tomorrow-hello.mp3",
  birthdaySong: "assets/audio/birthday-song.mp3",
  letterVoice: "assets/audio/letter-voice.m4a",   // 录音
  bgm: "assets/audio/bgm.mp3",
}
```

**音频缺失不会报错**，只是播放按钮不响应。
**首次播放**需要用户先点击一次屏幕（iOS Safari 限制）。

---

## 🖼️ 替换合照（关卡 7 拼图）

打开 `config.js`，找到 `puzzleImage` 字段，把内联 SVG 替换成你自己的合照：

```js
// 方式 A：换成 base64 内嵌图
puzzleImage: `<svg ...>...</svg>`

// 方式 B：换成外部图片
// 在 index.html 加 <img id="puzzle-pic" src="assets/images/photo.jpg" style="display:none">
// 在 app.js 的 render_puzzle 中改用 document.getElementById("puzzle-pic").src
```

推荐尺寸 600×600 或 1:1 比例。

---

## 🌐 部署

直接把这个目录扔到任何静态服务器：

- **GitHub Pages**：推到 repo，启用 Pages
- **Netlify / Vercel**：拖入目录即可
- **微信传输**：把整个目录 zip，部署到 [Tmp.link](https://tmp.link) 之类，生成短链发给朋友

---

## 🐛 调试技巧

打开浏览器控制台：

```js
// 直接跳到任意关卡
App.state.unlocked = new Array(12).fill(true);
App.pages.level(5);

// 跳到结局
App.state.completed = new Array(12).fill(true);
App.pages.ending();

// 看 12 关列表
CONFIG.levels.map(l => `${l.id}. [${l.type}] ${l.title}`)
```

---

## ❤️ 设计宗旨

> 这是一场「她」的冒险，也是一封「我」写给她的信。
> 12 关对应「朋友」二字共 12 画。
> 走完所有关卡，路会形成一个爱心轨迹回到起点——
> 起点站着「一个人」，终点解锁「我」。
> **她不是一个人走到这里，路的尽头有人等她。**
