/* ============================================================
 * 生日闯关 · 主应用
 *
 * 模块结构（IIFE 避免全局污染）：
 *   - App.state         全局状态
 *   - App.utils         工具函数（DOM / 时间 / 字符串）
 *   - App.audio         音频管理
 *   - App.render        页面渲染（基于 <template>）
 *   - App.pages         各页面渲染：start / congrats / welcome /
 *                       map / level / interlude / ending / letter
 *   - App.levels        12 关具体实现
 *   - App.boot          启动
 * ============================================================ */

(function () {
  "use strict";

  const App = {};
  window.App = App;

  /* ============================================================
   * 0. 全局状态
   * ============================================================ */
  App.state = {
    page: null,              // 当前页面 ID
    unlocked: [true],        // 12 关解锁状态（index = 关卡 N - 1）
    completed: new Array(12).fill(false),
    currentLevel: 0,         // 1..12
    audioReady: false,       // 是否经过首次用户点击（解决移动端 autoplay 限制）
    waitTimer: null,
  };

  /* ============================================================
   * 0.4 进度持久化（localStorage）
   *    - 通关 / 解锁后立即保存
   *    - 刷新后恢复：已游玩则跳过密码屏直接回地图
   * ============================================================ */
  App.state.SAVE_KEY = "birthdayGameProgress";
  App.state.normalize = function (arr, n) {
    return Array.from({ length: n }, (_, i) => !!arr[i]);
  };
  App.state.save = function () {
    try {
      localStorage.setItem(App.state.SAVE_KEY, JSON.stringify({
        completed: App.state.normalize(App.state.completed, 12),
        unlocked: App.state.normalize(App.state.unlocked, 12),
      }));
    } catch (e) { /* 存储不可用时静默忽略 */ }
  };
  App.state.load = function () {
    try {
      const raw = localStorage.getItem(App.state.SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.completed) || !Array.isArray(data.unlocked)) return false;
      App.state.completed = App.state.normalize(data.completed, 12);
      App.state.unlocked = App.state.normalize(data.unlocked, 12);
      App.state.unlocked[0] = true; // 第 1 关永远解锁
      return true;
    } catch (e) {
      return false;
    }
  };

  /* ============================================================
   * 1. 工具函数
   * ============================================================ */
  App.utils = {
    $(sel, ctx = document) { return ctx.querySelector(sel); },
    $$(sel, ctx = document) { return Array.from(ctx.querySelectorAll(sel)); },

    /** 从 <template id="..."> 克隆一个节点 */
    tplClone(id) {
      const t = document.getElementById(id);
      if (!t) throw new Error(`Template not found: ${id}`);
      return t.content.firstElementChild.cloneNode(true);
    },

    /** 填入 data-bind="a.b.c" 标记的文本 */
    bindData(root, data) {
      App.utils.$$("[data-bind]", root).forEach((el) => {
        const path = el.dataset.bind.split(".");
        let val = data;
        for (const p of path) {
          if (val == null) break;
          val = val[p];
        }
        if (val != null) el.textContent = val;
      });
    },

    /** 创建带名字的命名空间代理，避免和 CONFIG.keywords 冲突 */
    pluck(obj, ...keys) {
      return Object.fromEntries(keys.map((k) => [k, obj?.[k]]));
    },

    /** 模糊匹配：text 中是否包含任一 keyword */
    fuzzyHit(text, keywords = []) {
      if (!text) return false;
      const t = String(text).toLowerCase().trim();
      return keywords.some((k) => t.includes(String(k).toLowerCase()));
    },

    /** 通用 delay */
    wait(ms) { return new Promise((r) => setTimeout(r, ms)); },

    /** 抖动 */
    shake(el) {
      el.classList.remove("shake");
      void el.offsetWidth;
      el.classList.add("shake");
    },

    /** 在路径中渲染 view，附带淡出旧内容 */
    setView(node) {
      const app = document.getElementById("app");
      app.innerHTML = "";
      app.appendChild(node);
    },

    /** 简单事件委托 */
    on(root, selector, event, handler) {
      root.addEventListener(event, (e) => {
        const tgt = e.target.closest(selector);
        if (tgt && root.contains(tgt)) handler(e, tgt);
      });
    },

    /**
     * 计算环形分布的 N 个点位置（百分比坐标）
     *   - startAngle 默认 90°（6 点钟方向）
     *   - 顺时针均分 360°
     *   - 半径 r（%）
     */
    ringPositions(n, opts = {}) {
      const r = opts.radius ?? CONFIG.map.ringRadius;
      const startA = ((opts.startAngle ?? CONFIG.map.startAngle) * Math.PI) / 180;
      const step = (2 * Math.PI) / n;
      return Array.from({ length: n }, (_, i) => {
        const a = startA + i * step;
        return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) };
      });
    },

    /**
     * 把多句文字按 "。" "！" "？" 拆成句子数组，每句保留句末标点
     *   - 句号跟随原句，不出现孤立的标点行、不以标点开头
     *   - 兼容 iOS 16.4 以下（不使用 lookbehind/lookahead）
     */
    sentenceList(text) {
      if (!text) return [];
      const segs = String(text).split(/([。！？]+)/);
      const out = [];
      for (let i = 0; i < segs.length; i += 2) {
        const s = ((segs[i] || "") + (segs[i + 1] || "")).trim();
        if (s && /[^\s。！？]+/.test(s)) out.push(s);
      }
      return out;
    },

    /**
     * 把多句文字按句拆成多个 <p>，每句一行（标点随句尾保留）
     */
    splitSentences(text) {
      return this.sentenceList(text)
        .map((s) => `<p>${s}</p>`)
        .join("");
    },

    /**
     * 题面去重：当 question 中出现 title 时，去掉该段及此前内容，
     * 仅保留增量部分，避免标题与题面同屏重复
     */
    trimTitlePrefix(text, title) {
      if (!title) return text;
      const pos = text.indexOf(title);
      if (pos < 0) return text;
      const rest = text.slice(pos + title.length).replace(/^[，。！？：、\s]+/, "");
      if (/^[。！？]+$/.test(rest)) return "";
      return rest;
    },
  };

  /* ============================================================
   * 2. 音频管理
   *    - 文件不存在时静默跳过
   *    - 首次用户交互后自动 resume
   * ============================================================ */
  App.audio = {
    elements: {},
    current: null,

    init() {
      Object.entries(CONFIG.audio).forEach(([k, src]) => {
        const a = new Audio();
        a.src = src;
        a.preload = "none";
        a.addEventListener("error", () => {
          // 静默忽略
        });
        App.audio.elements[k] = a;
      });
    },

    /** 第一次触摸时解锁 audio context（iOS 需要），随后启动背景乐 */
    unlock() {
      if (App.state.audioReady) return;
      App.state.audioReady = true;
      Object.values(App.audio.elements).forEach((a) => {
        try { a.load(); } catch (e) { /* 静默忽略加载失败 */ }
      });
    },

    play(key, opts = {}) {
      const a = App.audio.elements[key];
      if (!a || !a.src) return Promise.resolve(false);
      try {
        if (App.audio.current && App.audio.current !== a) {
          App.audio.current.pause();
          App.audio.current.currentTime = 0;
        }
        a.currentTime = opts.start || 0;
        App.audio.current = a;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
        return Promise.resolve(true);
      } catch (e) {
        return Promise.resolve(false);
      }
    },

    stop() {
      if (App.audio.current) {
        App.audio.current.pause();
        App.audio.current.currentTime = 0;
        App.audio.current = null;
      }
    },
  };

  /* ============================================================
   * 3. 页面渲染 - 起始 / 恭喜 / 欢迎
   * ============================================================ */
  App.pages = {};

  App.pages.start = function () {
    const root = App.utils.tplClone("tpl-start");
    App.utils.bindData(root, CONFIG.pages);

    const input = App.utils.$(".key-input", root);
    const errorEl = App.utils.$('[data-role="error"]', root);
    const submitBtn = App.utils.$('[data-action="submit-password"]', root);

    function submit() {
      App.audio.unlock();
      const v = (input.value || "").trim();
      if (v === CONFIG.meta.password) {
        errorEl.hidden = true;
        App.pages.congrats();
      } else {
        errorEl.hidden = false;
        errorEl.textContent =
          CONFIG.pages.start.errorShake +
          " — " +
          CONFIG.pages.start.errorSub;
        App.utils.shake(input);
      }
    }

    submitBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 8);
    });

    App.utils.setView(root);
    setTimeout(() => input.focus(), 300);
  };

  App.pages.congrats = function () {
    const root = App.utils.tplClone("tpl-congrats");
    App.utils.bindData(root, CONFIG.pages);

    const egg = App.utils.$('[data-role="egg"]', root);
    App.utils.on(root, '[data-action="enter"]', "click", () => {
      App.audio.unlock();
      App.pages.welcome();
    });
    App.utils.on(root, '[data-action="wait"]', "click", () => {
      egg.hidden = false;
      egg.textContent = CONFIG.pages.congrats.waitEgg;
      clearTimeout(App.state.waitTimer);
      App.state.waitTimer = setTimeout(() => App.pages.welcome(), 3000);
    });

    App.utils.setView(root);
  };

  App.pages.welcome = function () {
    const root = App.utils.tplClone("tpl-welcome");
    App.utils.bindData(root, CONFIG.pages);
    App.utils.on(root, '[data-action="to-map"]', "click", () => {
      App.audio.unlock();
      App.pages.map();
    });
    App.utils.setView(root);
  };

  /* ============================================================
   * 4. 大地图（v2 · 环形 · 嘉仪中央 · 只看到当前一步）
   * ============================================================ */
  App.pages.map = function () {
    const root = App.utils.tplClone("tpl-map");
    const progress = App.utils.$('[data-role="progress"]', root);
    const nodesBox = App.utils.$('[data-role="nodes"]', root);
    const decoBox = App.utils.$('[data-role="deco"]', root);
    const tipEl = App.utils.$('[data-role="tip"]', root);

    const done = App.state.completed.filter(Boolean).length;
    const allDone = done === 12;

    // 顶部进度
    progress.textContent = allDone
      ? CONFIG.pages.map.progressDone
      : CONFIG.pages.map.progressPart.replace("{done}", done);

    // 计算 12 节点环形位置
    const positions = App.utils.ringPositions(12);

    // 找出"当前关卡"（第一个未完成且已解锁的）
    let currentIdx = -1;
    for (let i = 0; i < 12; i++) {
      if (App.state.unlocked[i] && !App.state.completed[i]) {
        currentIdx = i;
        break;
      }
    }
    if (currentIdx === -1 && !allDone) currentIdx = 0;

    // 渲染 12 节点
    positions.forEach((pt, idx) => {
      const node = document.createElement("div");
      node.className = "node";
      node.style.left = pt.x + "%";
      node.style.top = pt.y + "%";

      const isCompleted = App.state.completed[idx];
      const isCurrent = idx === currentIdx;
      const isUnlocked = App.state.unlocked[idx];

      if (isCompleted) {
        node.classList.add("node-done");
        node.addEventListener("click", () => App.pages.level(idx + 1));
      } else if (isCurrent) {
        node.classList.add("node-current");
        // 节点里放数字
        const num = document.createElement("span");
        num.className = "num";
        num.textContent = idx + 1;
        node.appendChild(num);
        node.addEventListener("click", () => App.pages.level(idx + 1));
      } else {
        // 锁定节点：不可见（看不到后面要走多久）
        node.classList.add("node-locked");
      }
      nodesBox.appendChild(node);
    });

    // 装饰元素（云、星星、小花）
    const decoChars = ["✦", "✿", "❀", "✦", "✿", "✦", "❀", "✦"];
    const decoPositions = [
      { x: 14, y: 18 }, { x: 86, y: 22 }, { x: 10, y: 70 },
      { x: 88, y: 72 }, { x: 22, y: 88 }, { x: 80, y: 90 },
    ];
    decoPositions.forEach((p, i) => {
      const d = document.createElement("span");
      d.className = "deco";
      d.textContent = decoChars[i % decoChars.length];
      d.style.left = p.x + "%";
      d.style.top = p.y + "%";
      decoBox.appendChild(d);
    });

    // 底部提示
    if (allDone) {
      tipEl.textContent = CONFIG.pages.map.tipDone;
    } else if (done === 0) {
      tipEl.textContent = CONFIG.pages.map.tipStart;
    } else {
      tipEl.textContent = CONFIG.pages.map.tipStep.replace("{n}", currentIdx + 1);
    }

    App.utils.setView(root);

    // 全通关：揭示爱心轨迹 + 站在她身边 + 提供回结局入口
    if (allDone) {
      const trail = App.utils.$('[data-role="trail"]', root);
      if (trail) {
        trail.hidden = false;
        // 填入爱心路径
        const path = trail.querySelector(".trail-path");
        if (path) path.setAttribute("d", CONFIG.map.heartPath);
        // 触发动画（先 hidden=false 让 transition 生效）
        requestAnimationFrame(() => trail.classList.add("shown"));
      }
      // 从结局页"副本结算"来到这里后，可一键回到结局页
      const toEnding = App.utils.$('[data-action="to-ending"]', root);
      if (toEnding) {
        toEnding.hidden = false;
        toEnding.textContent = CONFIG.pages.map.returnButton;
        toEnding.addEventListener("click", () => App.pages.ending());
      }
    }
  };

  /* ============================================================
   * 5. 中场过场
   * ============================================================ */
  App.pages.interlude = function (levelIdx) {
    const root = App.utils.tplClone("tpl-interlude");
    const lvl = CONFIG.levels[levelIdx - 1];
    const passText = lvl.passText || "";
    App.utils.$('[data-role="pass-text"]', root).innerHTML =
      App.utils.splitSentences(passText);
    const bridgeText =
      (CONFIG.interludeByLevel && CONFIG.interludeByLevel[levelIdx]) ||
      lvl.bridge ||
      "";
    // 过渡文案中与过关语重复的句子不再重复展示，避免同屏文字反复出现
    const passList = App.utils.sentenceList(passText);
    const bridgeList = App.utils.sentenceList(bridgeText).filter(
      (s) => !passList.includes(s)
    );
    App.utils.$('[data-role="bridge-text"]', root).innerHTML = bridgeList
      .map((s) => `<p>${s}</p>`)
      .join("");

    // 解锁下一关
    if (levelIdx < 12) {
      App.state.unlocked[levelIdx] = true;
    }
    // 通关即保存进度（本地持久化，刷新后可恢复）
    App.state.save();

    App.utils.on(root, '[data-action="next"]', "click", () => {
      if (levelIdx >= 12) {
        App.pages.ending();
      } else {
        App.pages.map();
      }
    });

    App.utils.setView(root);
  };

  /* ============================================================
   * 6. 关卡外壳
   * ============================================================ */
  App.pages.level = function (levelIdx) {
    const lvl = CONFIG.levels[levelIdx - 1];
    if (!lvl) return App.pages.map();

    const root = App.utils.tplClone("tpl-level");
    const shell = App.utils.$('[data-role="level-shell"]', root);

    // 标题 + 介绍（每句话一行）；题面与标题重复时只保留增量部分
    const intro = document.createElement("div");
    intro.className = "level-intro";
    // endingNaming 关不渲染 question 到 intro 区（它是输入提示，不是描述）
    const introText = lvl.intro
      ? lvl.intro
      : (lvl.question && lvl.type !== "endingNaming"
         ? App.utils.trimTitlePrefix(lvl.question, lvl.title)
         : "");
    intro.innerHTML = `<h2>第 ${levelIdx} 关 · ${lvl.title}</h2>` +
      (introText ? App.utils.splitSentences(introText) : "");
    if (lvl.subtitle) {
      const sub = document.createElement("p");
      sub.className = "subtitle level-subtitle";
      sub.textContent = lvl.subtitle;
      intro.appendChild(sub);
    }
    shell.appendChild(intro);

    // 调度具体关卡渲染
    // 支持 hyphen 类型自动转 camelCase（either-or → eitherOr）
    const camelType = lvl.type.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const renderer = App.levels[`render_${camelType}`];
    if (typeof renderer === "function") {
      renderer(shell, lvl, levelIdx);
    } else {
      const err = document.createElement("p");
      err.textContent = `未实现的关卡类型: ${lvl.type}`;
      shell.appendChild(err);
    }

    App.utils.on(root, '[data-action="back-to-map"]', "click", () => {
      App.audio.stop();
      App.pages.map();
    });

    App.utils.setView(root);
  };

  /* ============================================================
   * 7. 结局 / 爱心轨迹
   * ============================================================ */
  App.pages.ending = function () {
    const root = App.utils.tplClone("tpl-ending");
    App.utils.bindData(root, CONFIG.pages);

    App.utils.on(root, '[data-action="open-letter"]', "click", () => {
      App.pages.letter();
    });
    App.utils.on(root, '[data-action="replay-trail"]', "click", () => {
      App.pages.map();
    });

    App.utils.setView(root);
    App.effects.playTrail();
  };

  App.effects = {
    /** 爱心轨迹收束动画 + 飘落花瓣 */
    playTrail() {
      // 重复 5 秒飘落
      let count = 0;
      const timer = setInterval(() => {
        const petal = document.createElement("div");
        petal.className = "trail-petal";
        petal.style.left = Math.random() * 100 + "vw";
        petal.style.animationDuration = 3 + Math.random() * 2 + "s";
        document.body.appendChild(petal);
        setTimeout(() => petal.remove(), 5500);
        if (++count > 40) clearInterval(timer);
      }, 120);
    },
  };

  /* ============================================================
   * 8. 生日信弹窗
   * ============================================================ */
  App.pages.letter = function () {
    // 防止重复打开
    if (document.querySelector(".modal-letter")) return;

    const tpl = App.utils.tplClone("tpl-letter");
    const tabsBox = App.utils.$('[data-role="tabs"]', tpl);
    const body = App.utils.$('[data-role="letter-body"]', tpl);

    // 电子信箱：三封信（生日信 + 两封过去的信）
    const LETTER_TABS = [
      { key: "birthday", label: "生日信" },
      { key: "old0",     label: "2025.2.5" },
      { key: "old1",     label: "2026.2.22" },
    ];
    let current = "birthday";

    function para(text, cls) {
      const p = document.createElement("p");
      if (cls) p.className = cls;
      p.textContent = text;
      return p;
    }

    function renderTabs() {
      tabsBox.innerHTML = "";
      LETTER_TABS.forEach((it) => {
        const btn = document.createElement("button");
        btn.className = "mailbox-tab" + (it.key === current ? " active" : "");
        btn.textContent = it.label;
        btn.addEventListener("click", () => {
          if (it.key === current) return;
          App.audio.stop();
          current = it.key;
          render();
        });
        tabsBox.appendChild(btn);
      });
    }

    function render() {
      renderTabs();
      body.innerHTML = "";
      if (current === "birthday") {
        renderBirthday();
      } else {
        renderOld(CONFIG.letters[current === "old0" ? 0 : 1]);
      }
    }

    function renderBirthday() {
      // 开场白
      body.appendChild(para(CONFIG.pages.letter.greeting, "greeting"));

      // 录音置上：开场白之后、正文之前
      const voice = document.createElement("button");
      voice.className = "voice-bar";
      voice.innerHTML = `
        <span class="vbtn">▶</span>
        <span class="vtext">${CONFIG.pages.letter.voiceButton}</span>
        <span class="vwave"><i></i><i></i><i></i><i></i><i></i></span>
      `;
      body.appendChild(voice);

      let playing = false;
      voice.addEventListener("click", () => {
        if (playing) {
          App.audio.stop();
          playing = false;
          voice.classList.remove("playing");
          voice.querySelector(".vbtn").textContent = "▶";
          voice.querySelector(".vtext").textContent = CONFIG.pages.letter.voiceButton;
        } else {
          App.audio.play("letterVoice");
          playing = true;
          voice.classList.add("playing");
          voice.querySelector(".vbtn").textContent = "■";
          voice.querySelector(".vtext").textContent = CONFIG.pages.letter.voiceStop;
          // 自动结束
          const a = App.audio.elements.letterVoice;
          if (a) {
            a.onended = () => {
              playing = false;
              voice.classList.remove("playing");
              voice.querySelector(".vbtn").textContent = "▶";
              voice.querySelector(".vtext").textContent = CONFIG.pages.letter.voiceButton;
            };
          }
        }
      });

      // 正文
      CONFIG.letter.body.forEach((line) => {
        body.appendChild(line ? para(line) : document.createElement("p"));
      });

      // 署名
      body.appendChild(para(CONFIG.pages.letter.signature, "signature"));
    }

    function renderOld(data) {
      body.appendChild(para(data.date + " · " + data.title, "letter-dateline"));
      data.body.forEach((line) => {
        body.appendChild(line ? para(line) : document.createElement("p"));
      });
    }

    render();

    // 关闭：停止录音
    App.utils.on(tpl, '[data-action="close-letter"]', "click", () => {
      App.audio.stop();
      tpl.remove();
    });

    document.body.appendChild(tpl);
  };

  /* ============================================================
   * 9. 关卡实现 - 12 个具体 renderer
   * ============================================================ */
  App.levels = {};

  /* ---------- 9.1 关卡 1 · 情绪消消乐（2-match：8 种词各 2 个 = 16 格）---------- */
  App.levels.render_match3 = function (shell, lvl) {
    const total = lvl.words.length;        // 16
    const cells = lvl.words.slice();
    // 洗牌
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const cols = 4;                        // 4×4 网格

    const board = document.createElement("div");
    board.className = "match3-board";
    board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    shell.appendChild(board);

    const progress = document.createElement("div");
    progress.className = "match3-progress";
    shell.appendChild(progress);

    let cleared = 0;
    let selected = [];                     // 当前已选中的 [idx, idx]
    const cellEls = [];

    function updateProgress() {
      progress.textContent = `已清空 ${cleared} / ${total} 个心结`;
      if (cleared >= total) {
        setTimeout(showStar, 400);
      }
    }

    function showStar() {
      const overlay = document.createElement("div");
      overlay.className = "match3-star";
      overlay.innerHTML = '<div class="star"></div>';
      document.body.appendChild(overlay);
      setTimeout(() => {
        overlay.remove();
        complete();
      }, 1500);
    }

    function handleClick(clickedIdx) {
      const cellEl = cellEls[clickedIdx];
      if (!cellEl || cellEl.classList.contains("clearing")) return;

      // 取消已选
      if (selected.includes(clickedIdx)) {
        cellEl.classList.remove("selected");
        selected = selected.filter((i) => i !== clickedIdx);
        return;
      }

      // 加入选中
      cellEl.classList.add("selected");
      selected.push(clickedIdx);

      // 选了 2 个 → 判定
      if (selected.length === 2) {
        const [i1, i2] = selected;
        if (cells[i1] === cells[i2]) {
          // 配对成功：清除
          setTimeout(() => {
            cellEls[i1].classList.add("clearing");
            cellEls[i2].classList.add("clearing");
            cleared += 2;
            selected = [];
            updateProgress();
          }, 250);
        } else {
          // 不匹配：取消两者
          setTimeout(() => {
            cellEls[i1].classList.remove("selected");
            cellEls[i2].classList.remove("selected");
            selected = [];
          }, 500);
        }
      }
    }

    cells.forEach((word, idx) => {
      const cell = document.createElement("div");
      cell.className = "match3-cell";
      cell.textContent = word;
      cell.addEventListener("click", () => handleClick(idx));
      board.appendChild(cell);
      cellEls.push(cell);
    });

    updateProgress();

    function complete() {
      App.state.completed[0] = true;
      App.pages.interlude(1);
    }
  };

  /* ---------- 9.2 关卡 2 · 选择题（最伤人的话） ---------- */
  App.levels.render_quiz = function (shell, lvl) {
    const list = document.createElement("div");
    list.className = "quiz-options";
    shell.appendChild(list);

    const feedback = document.createElement("div");
    feedback.className = "quiz-feedback";
    shell.appendChild(feedback);

    lvl.options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "quiz-option";
      btn.innerHTML = `<span class="opt-key">${opt.key}</span>${opt.text}`;
      btn.addEventListener("click", () => {
        if (opt.correct) {
          btn.classList.add("correct");
          feedback.classList.add("ok");
          feedback.classList.remove("no");
          feedback.textContent = lvl.feedback.right;
          setTimeout(() => complete(), 1600);
        } else {
          btn.classList.add("wrong");
          feedback.classList.add("no");
          feedback.classList.remove("ok");
          feedback.textContent = lvl.feedback.wrong;
          setTimeout(() => {
            btn.classList.remove("wrong");
          }, 700);
        }
      });
      list.appendChild(btn);
    });

    function complete() {
      App.state.completed[1] = true;
      App.pages.interlude(2);
    }
  };

  /* ---------- 9.3 关卡 3 · 翻牌 ---------- */
  App.levels.render_cards = function (shell, lvl) {
    // 12 张：每对 2 张，洗牌
    const allCards = [];
    lvl.pairs.forEach((pair, idx) => {
      pair.forEach((word) => allCards.push({ word, pairId: idx }));
    });
    for (let i = allCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allCards[i], allCards[j]] = [allCards[j], allCards[i]];
    }

    const board = document.createElement("div");
    board.className = "cards-board";
    shell.appendChild(board);

    let first = null;
    let lock = false;
    let matched = 0;

    allCards.forEach((card) => {
      const fc = document.createElement("div");
      fc.className = "flip-card";
      fc.innerHTML = `
        <div class="flip-inner">
          <div class="flip-face flip-back">✦</div>
          <div class="flip-face flip-front">${card.word}</div>
        </div>
      `;
      fc.addEventListener("click", () => {
        if (lock) return;
        if (fc.classList.contains("flipped") || fc.classList.contains("matched")) return;
        fc.classList.add("flipped");
        if (!first) {
          first = { el: fc, card };
        } else {
          lock = true;
          if (first.card.pairId === card.pairId) {
            setTimeout(() => {
              fc.classList.add("matched");
              first.el.classList.add("matched");
              first = null;
              lock = false;
              matched++;
              if (matched === lvl.pairs.length) {
                setTimeout(complete, 800);
              }
            }, 400);
          } else {
            setTimeout(() => {
              fc.classList.remove("flipped");
              first.el.classList.remove("flipped");
              first = null;
              lock = false;
            }, 900);
          }
        }
      });
      board.appendChild(fc);
    });

    function complete() {
      App.state.completed[2] = true;
      App.pages.interlude(3);
    }
  };

  /* ---------- 9.4 / 9.5 / 9.6 · 主观题（input） */
  App.levels.render_input = function (shell, lvl, levelIdx) {
    const block = document.createElement("div");
    block.className = "input-block";
    shell.appendChild(block);

    // 提示按钮（如配置了）
    if (lvl.hint && lvl.hint.text) {
      const btn = document.createElement("button");
      btn.className = "hint-btn";
      btn.textContent = lvl.hint.text;
      let used = 0;
      const max = lvl.hint.maxTimes || 999;
      btn.addEventListener("click", () => {
        if (used >= max) return;
        used++;
        // 第一次按：填入提示文本（可编辑），第二次：再显示
        const cur = block.querySelector(".text-input");
        if (cur) {
          cur.placeholder = lvl.hint.text.replace(/[()（）]/g, "");
        }
      });
      block.appendChild(btn);
    }

    const input = document.createElement("input");
    input.className = "text-input";
    input.placeholder = "把答案打在这里…";
    block.appendChild(input);

    const feedback = document.createElement("div");
    feedback.className = "quiz-feedback";
    block.appendChild(feedback);

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.style.marginTop = "8px";
    const submit = document.createElement("button");
    submit.className = "btn btn-primary";
    submit.textContent = "确认";
    actions.appendChild(submit);
    block.appendChild(actions);

    submit.addEventListener("click", trySubmit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") trySubmit();
    });

    function trySubmit() {
      const v = input.value.trim();
      if (App.utils.fuzzyHit(v, lvl.keywords)) {
        feedback.classList.add("ok");
        feedback.classList.remove("no");
        feedback.textContent = lvl.rightText;
        input.disabled = true;
        submit.disabled = true;
        setTimeout(() => complete(), 1800);
      } else {
        feedback.classList.add("no");
        feedback.classList.remove("ok");
        feedback.textContent = lvl.wrongText;
        App.utils.shake(input);
      }
    }

    function complete() {
      App.state.completed[levelIdx - 1] = true;
      App.pages.interlude(levelIdx);
    }
  };

  /* ---------- 9.5 / 9.6 · 歌名题（音乐关的音乐已删除，仅留装饰背景 + 答题）---------- */
  App.levels.render_music = function (shell, lvl, levelIdx) {
    // 装饰背景（保留视觉，去掉播放按钮和音乐）
    const stage = document.createElement("div");
    stage.className = "music-stage" + (lvl.title.includes("遇见") ? " star" : "");
    if (lvl.title.includes("遇见")) {
      stage.innerHTML = '<div class="starfield"></div>';
    } else {
      stage.innerHTML = '<div class="sun"></div>';
    }

    shell.appendChild(stage);

    // 答题区
    const block = document.createElement("div");
    block.className = "input-block";
    block.style.marginTop = "24px";
    shell.appendChild(block);

    const input = document.createElement("input");
    input.className = "text-input";
    input.placeholder = "把歌名打在这里…";
    block.appendChild(input);

    const feedback = document.createElement("div");
    feedback.className = "quiz-feedback";
    block.appendChild(feedback);

    const actions = document.createElement("div");
    actions.className = "actions";
    const submit = document.createElement("button");
    submit.className = "btn btn-primary";
    submit.textContent = "确认";
    actions.appendChild(submit);
    block.appendChild(actions);

    submit.addEventListener("click", trySubmit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") trySubmit();
    });

    function trySubmit() {
      const v = input.value.trim();
      if (App.utils.fuzzyHit(v, lvl.keywords)) {
        feedback.classList.add("ok");
        feedback.classList.remove("no");
        feedback.textContent = lvl.passText.split("。")[0] + "。";
        input.disabled = true;
        submit.disabled = true;
        setTimeout(() => complete(), 1800);
      } else {
        feedback.classList.add("no");
        feedback.classList.remove("ok");
        feedback.textContent = "再想想，是哪首歌呢？";
        App.utils.shake(input);
      }
    }

    function complete() {
      App.state.completed[levelIdx - 1] = true;
      App.pages.interlude(levelIdx);
    }
  };

  /* ---------- 9.7 关卡 7 · 拼图（支持内联 SVG / 真实图片 URL）---------- */
  App.levels.render_puzzle = function (shell, lvl, levelIdx) {
    const grid = lvl.grid || 3;
    const total = grid * grid;
    const board = document.createElement("div");
    board.className = "puzzle-board";
    board.style.gridTemplateColumns = `repeat(${grid}, 1fr)`;
    board.style.gridTemplateRows = `repeat(${grid}, 1fr)`;
    shell.appendChild(board);

    // 决定图片来源：优先 lvl.imageSrc（URL 路径），否则用内联 SVG
    let imageUrl;
    if (lvl.imageSrc) {
      imageUrl = lvl.imageSrc;
    } else {
      const svg = CONFIG.puzzleImage;
      imageUrl = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    }

    // 顺序：0..total-1，最终要 [0,1,...,total-1]
    let order = Array.from({ length: total }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const emptyIdx = total - 1;
    const emptyPos = order.indexOf(emptyIdx);
    if (emptyPos !== emptyIdx) {
      [order[emptyPos], order[emptyIdx]] = [order[emptyIdx], order[emptyPos]];
    }
    // 保证局面可解：空格固定在末尾时，8 数码可解当且仅当非空排列逆序数为偶数
    let inv = 0;
    for (let i = 0; i < total - 1; i++) {
      for (let j = i + 1; j < total - 1; j++) {
        if (order[i] > order[j]) inv++;
      }
    }
    if (inv % 2 === 1) {
      [order[0], order[1]] = [order[1], order[0]];
    }

    const tiles = [];

    // 完成浮层：定义在 doRender 之前，每次重渲染后重新挂载到最上层
    const overlay = document.createElement("div");
    overlay.className = "puzzle-overlay";
    overlay.innerHTML = '<div class="checkmark">✓</div>';

    function posToBg(p) {
      const row = Math.floor(p / grid);
      const col = p % grid;
      return `${(col * 100) / (grid - 1)}% ${(row * 100) / (grid - 1)}%`;
    }

    function doRender() {
      board.innerHTML = "";
      tiles.length = 0;
      order.forEach((val, idx) => {
        const tile = document.createElement("div");
        tile.className = "puzzle-tile";
        if (val === emptyIdx) {
          tile.classList.add("empty");
        } else {
          tile.style.backgroundImage = `url("${imageUrl}")`;
          tile.style.backgroundPosition = posToBg(val);
          tile.addEventListener("click", () => tryMove(idx));
        }
        board.appendChild(tile);
        tiles.push(tile);
      });
      board.appendChild(overlay); // ✓ 浮层保持在最上层
    }

    function tryMove(idx) {
      const empty = order.indexOf(emptyIdx);
      const er = Math.floor(empty / grid);
      const ec = empty % grid;
      const ir = Math.floor(idx / grid);
      const ic = idx % grid;
      const isAdj =
        (Math.abs(er - ir) === 1 && ec === ic) ||
        (Math.abs(ec - ic) === 1 && er === ir);
      if (!isAdj) return;
      [order[idx], order[empty]] = [order[empty], order[idx]];
      doRender();
      if (order.every((v, i) => v === i)) {
        setTimeout(complete, 400);
      }
    }

    // 预加载图片再渲染（避免 URL 加载延迟）
    const preload = new Image();
    preload.onload = doRender;
    preload.onerror = doRender;
    preload.src = imageUrl;

    function complete() {
      overlay.classList.add("shown");
      board.style.backgroundImage = `url("${imageUrl}")`;
      board.style.backgroundSize = "cover";
      board.style.backgroundPosition = "center";
      App.state.completed[levelIdx - 1] = true;
      setTimeout(() => App.pages.interlude(levelIdx), 1500);
    }
  };

  /* ---------- 9.8 / 9.9 · 主观题（带选项 + 自由输入） */
  App.levels.render_subjective = function (shell, lvl, levelIdx) {
    // 选项
    if (Array.isArray(lvl.options) && lvl.options.length) {
      const list = document.createElement("div");
      list.className = "quiz-options";
      shell.appendChild(list);
      lvl.options.forEach((opt) => {
        const btn = document.createElement("button");
        btn.className = "quiz-option";
        btn.textContent = opt.text;
        btn.addEventListener("click", () => {
          if (opt.correct) {
            btn.classList.add("correct");
            setTimeout(() => celebrate(), 1000);
          } else {
            btn.classList.add("wrong");
            setTimeout(() => btn.classList.remove("wrong"), 600);
          }
        });
        list.appendChild(btn);
      });
    }

    const block = document.createElement("div");
    block.className = "input-block";
    shell.appendChild(block);

    // 提示按钮
    if (Array.isArray(lvl.hints) && lvl.hints.length) {
      const hintBtn = document.createElement("button");
      hintBtn.className = "hint-btn";
      hintBtn.textContent = lvl.hints[0];
      let used = 0;
      const max = lvl.maxHints || 999;
      hintBtn.addEventListener("click", () => {
        if (used >= max) return;
        used++;
        const cur = block.querySelector(".text-input");
        if (cur) {
          cur.placeholder = (lvl.hints[used] || lvl.hints[lvl.hints.length - 1])
            .replace(/[()（）]/g, "");
        }
      });
      block.appendChild(hintBtn);
    }

    const input = document.createElement("input");
    input.className = "text-input";
    input.placeholder = "或者自己写一个答案…";
    block.appendChild(input);

    const feedback = document.createElement("div");
    feedback.className = "quiz-feedback";
    block.appendChild(feedback);

    const actions = document.createElement("div");
    actions.className = "actions";
    const submit = document.createElement("button");
    submit.className = "btn btn-primary";
    submit.textContent = "确认";
    actions.appendChild(submit);
    block.appendChild(actions);

    submit.addEventListener("click", trySubmit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") trySubmit();
    });

    function trySubmit() {
      const v = input.value.trim();
      if (App.utils.fuzzyHit(v, lvl.keywords)) {
        feedback.classList.add("ok");
        feedback.classList.remove("no");
        feedback.textContent = lvl.passText;
        input.disabled = true;
        submit.disabled = true;
        if (lvl.audioKey) App.audio.play(lvl.audioKey);
        setTimeout(() => complete(), 1800);
      } else {
        feedback.classList.add("no");
        feedback.classList.remove("ok");
        feedback.textContent = "再想想～";
        App.utils.shake(input);
      }
    }

    function celebrate() {
      feedback.classList.add("ok");
      feedback.classList.remove("no");
      feedback.textContent = lvl.passText;
      if (lvl.audioKey) App.audio.play(lvl.audioKey);
      setTimeout(() => complete(), 1800);
    }

    function complete() {
      App.state.completed[levelIdx - 1] = true;
      App.pages.interlude(levelIdx);
    }
  };

  /* ---------- 9.10 关卡 10 · 二选一（无对错） ---------- */
  App.levels.render_eitherOr = function (shell, lvl, levelIdx) {
    const grid = document.createElement("div");
    grid.className = "choices-grid";
    shell.appendChild(grid);

    lvl.options.forEach((opt) => {
      const card = document.createElement("div");
      card.className = "choice-card";
      card.innerHTML = `
        <span class="ic">${opt.key === "treasure" ? "🗺️" : "📘"}</span>
        ${opt.arrow ? `<div class="arrow">${opt.arrow}</div>` : ""}
        <div class="lb">${opt.label}</div>
        <div class="sb">${opt.sub}</div>
      `;
      card.addEventListener("click", () => {
        App.utils.$$(".choice-card", grid).forEach((c) => c.classList.remove("chosen"));
        card.classList.add("chosen");
        setTimeout(() => complete(), 1200);
      });
      grid.appendChild(card);
    });

    function complete() {
      App.state.completed[levelIdx - 1] = true;
      App.pages.interlude(levelIdx);
    }
  };

  /* ---------- 9.11 关卡 11 · 许愿池（卡牌洗牌 · 眼力追踪） ---------- */
  App.levels.render_wish = function (shell, lvl, levelIdx) {
    const status = document.createElement("div");
    status.className = "wish-status";
    shell.appendChild(status);

    const track = document.createElement("div");
    track.className = "wish-track";
    shell.appendChild(track);

    const reply = document.createElement("div");
    reply.className = "wish-reply";
    reply.hidden = true;
    shell.appendChild(reply);

    // 自定义愿望（可选，作为第 5 张卡加入桌面并直接选中）
    const custom = document.createElement("div");
    custom.className = "wish-custom";
    const ci = document.createElement("input");
    ci.className = "text-input";
    ci.placeholder = "或写下你自己的愿望…";
    const cb = document.createElement("button");
    cb.className = "btn btn-primary";
    cb.textContent = "投下";
    custom.appendChild(ci);
    custom.appendChild(cb);
    shell.appendChild(custom);

    // 卡牌数据：初始为 preset，自定义愿望追加为第 5 张
    let cards = lvl.presets.map((p) => ({ label: p.label, reply: p.reply }));
    let myIdx = -1;            // 玩家选定愿望的卡下标
    let phase = "pick";        // pick -> flip -> shuffle -> guess
    let busy = false;
    let els = [];              // 与 cards 一一对应的 DOM
    let finished = false;

    const GAP = 8;
    let step = 0;            // 每张卡占据的槽位宽度

    // 页面卸载 / 已通关后，异步流程立即中止
    function alive() { return track.isConnected && !finished; }

    // 按轨道内宽等分：innerW = track.clientWidth - padding(20)
    // 总占位 = n * w + (n-1) * GAP，令总占位 == innerW，解出 w
    function relayout() {
      const n = cards.length;
      const innerW = (track.clientWidth || 360) - 20;
      const totalGap = (n - 1) * GAP;
      let w = Math.max(52, (innerW - totalGap) / n);
      // 上限保护（防止卡片过宽导致文字溢出）
      w = Math.min(w, 120);
      step = w + GAP;
      cards.forEach((c, i) => {
        if (els[i]) els[i].style.width = `${w}px`;
      });
    }

    function place() {
      cards.forEach((c, i) => {
        if (els[i]) els[i].style.transform = `translateX(${c.slot * step}px)`;
      });
    }

    // buildCards 后立即同步测量，再经两轮 rAF 确认尺寸已稳定
    function buildCards() {
      track.innerHTML = "";
      els.length = 0;
      cards.forEach((c, i) => {
        c.slot = i;
        const el = document.createElement("div");
        el.className = "track-card" + (i === myIdx ? " mine" : "");
        el.innerHTML = `
          <div class="track-inner">
            <div class="tf-front"></div>
            <div class="tf-back">✦</div>
          </div>`;
        el.querySelector(".tf-front").textContent = c.label;
        el.addEventListener("click", () => onCardClick(i));
        track.appendChild(el);
        els.push(el);
      });
      // 第1次：DOM 已插入，CSS 可能尚未计算
      relayout();
      place();
      // 第2次：确保 CSS 已生效
      requestAnimationFrame(() => {
        if (!track.isConnected) return;
        relayout();
        place();
      });
    }

    // 左右相邻来回交换 slot，每次平移过渡
    async function shuffle(times) {
      for (let k = 0; k < times; k++) {
        if (!alive()) return;
        const i = Math.floor(Math.random() * (cards.length - 1));
        const a = cards[i];
        const b = cards[i + 1];
        const tmp = a.slot;
        a.slot = b.slot;
        b.slot = tmp;
        place();
        await App.utils.wait(420);
      }
    }

    // 翻背 -> 提示 -> 开洗
    function startFlip() {
      phase = "flip";
      busy = true;
      els.forEach((el) => el.classList.add("down"));
      status.textContent = "翻过去啦——现在盯紧它，位置要开始变了！";
      App.utils.wait(2600).then(() => {
        if (!alive()) return;
        phase = "shuffle";
        status.textContent = "盯住你的愿望，别眨眼 ✦";
        return shuffle(10);
      }).then(() => {
        if (!alive()) return;
        busy = false;
        phase = "guess";
        status.textContent = "你小小的朋友 指：我愿望已经许好了";
      });
    }

    async function onCardClick(i) {
      if (busy || finished) return;
      if (phase === "pick") {
        // 阶段 1：选定愿望（先看清全部卡片，再记下你选的那张）
        busy = true;
        myIdx = i;
        cards.forEach((c, j) => els[j].classList.toggle("mine", j === i));
        ci.disabled = true;
        cb.disabled = true;
        status.textContent = "好——再记一眼你的愿望，我要把它们全翻过去了！";
        await App.utils.wait(1400);
        if (!alive()) return;
        startFlip();
      } else if (phase === "guess") {
        // 阶段 2：任何一张卡都可以，都是愿望的回应
        busy = true;
        els[i].classList.remove("down");
        const c = cards[i];
        els[i].classList.add("success");
        status.textContent = "愿望被看见啦 ✨";
        reply.hidden = false;
        reply.textContent = c.reply;
        finished = true;
        setTimeout(() => complete(), 2400);
      }
    }

    function complete() {
      if (App.state.completed[levelIdx - 1]) return;
      App.state.completed[levelIdx - 1] = true;
      App.pages.interlude(levelIdx);
    }

    status.textContent = "先点一张卡，选定一个愿望";
    buildCards();

    // 自定义愿望：作为新卡加入并直接选中
    cb.addEventListener("click", () => {
      const v = ci.value.trim();
      if (!v || phase !== "pick" || busy || myIdx !== -1) return;
      cards.push({ label: v, reply: `愿望收到：「${v}」。会实现的。` });
      myIdx = cards.length - 1;
      buildCards();
      cards.forEach((c, j) => els[j].classList.toggle("mine", j === myIdx));
      ci.disabled = true;
      cb.disabled = true;
      status.textContent = "好，你的愿望上桌了——记好它，我要把它们全翻过去了！";
      App.utils.wait(1400).then(() => {
        if (!alive()) return;
        startFlip();
      });
    });
  };

  /* ---------- 9.12 关卡 12 · 模糊匹配答案（终局） ---------- */
  App.levels.render_endingNaming = function (shell, lvl, levelIdx) {
    const block = document.createElement("div");
    block.className = "input-block";
    block.style.marginTop = "16px";
    shell.appendChild(block);

    // 提示按钮
    if (Array.isArray(lvl.hints) && lvl.hints.length) {
      const hintBtn = document.createElement("button");
      hintBtn.className = "hint-btn";
      hintBtn.textContent = lvl.hints[0];
      let used = 0;
      hintBtn.addEventListener("click", () => {
        used++;
        const cur = block.querySelector(".text-input");
        if (cur) {
          cur.placeholder = (lvl.hints[used] || lvl.hints[lvl.hints.length - 1])
            .replace(/[()（）]/g, "");
        }
      });
      block.appendChild(hintBtn);
    }

    const input = document.createElement("input");
    input.className = "text-input";
    input.placeholder = "把数字打在这里…";
    block.appendChild(input);

    const feedback = document.createElement("div");
    feedback.className = "quiz-feedback";
    block.appendChild(feedback);

    const actions = document.createElement("div");
    actions.className = "actions";
    const submit = document.createElement("button");
    submit.className = "btn btn-primary";
    submit.textContent = "确认";
    actions.appendChild(submit);
    block.appendChild(actions);

    submit.addEventListener("click", trySubmit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") trySubmit();
    });

    function trySubmit() {
      const v = input.value.trim();
      if (App.utils.fuzzyHit(v, lvl.keywords)) {
        feedback.classList.add("ok");
        feedback.classList.remove("no");
        feedback.textContent = lvl.passText;
        input.disabled = true;
        submit.disabled = true;
        setTimeout(() => complete(), 1800);
      } else {
        feedback.classList.add("no");
        feedback.classList.remove("ok");
        feedback.textContent = "再想想～";
        App.utils.shake(input);
      }
    }

    function complete() {
      App.state.completed[levelIdx - 1] = true;
      // 终局关不经过过场页，这里直接保存进度
      App.state.save();
      // 直接进入结局
      setTimeout(() => App.pages.ending(), 600);
    }
  };

  /* ============================================================
   * 10. 启动
   * ============================================================ */
  App.boot = function () {
    App.audio.init();
    App.deco.init();

    // 恢复本地进度：已有存档则直接进入大地图，无需重新输入密码
    const hasProgress = App.state.load();
    if (hasProgress) {
      App.pages.map();
    } else {
      App.pages.start();
    }

    // 首次交互解锁音频（iOS Safari）
    ["click", "touchstart"].forEach((ev) => {
      document.addEventListener(ev, App.audio.unlock, { once: true });
    });
  };

  /* ============================================================
   * 11. 背景装饰层（漂浮的小花星星）
   * ============================================================ */
  App.deco = {
    init() {
      const layer = document.getElementById("decoLayer");
      if (!layer) return;
      const chars = ["✦", "✿", "❀", "✦", "❀", "✿", "✦"];
      const positions = [
        { x: 6,  y: 12 }, { x: 18, y: 28 }, { x: 88, y: 14 },
        { x: 76, y: 30 }, { x: 12, y: 56 }, { x: 92, y: 50 },
        { x: 22, y: 78 }, { x: 84, y: 82 }, { x: 50, y: 6 },
        { x: 8,  y: 90 }, { x: 95, y: 92 }, { x: 48, y: 94 },
      ];
      positions.forEach((p, i) => {
        const d = document.createElement("span");
        d.className = "deco-item";
        d.textContent = chars[i % chars.length];
        d.style.left = p.x + "%";
        d.style.top = p.y + "%";
        d.style.animationDelay = -(i * 0.6) + "s";
        layer.appendChild(d);
      });
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", App.boot);
  } else {
    App.boot();
  }
})();
