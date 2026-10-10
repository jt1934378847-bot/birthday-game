#!/bin/bash
# birthday-game Git 推送脚本
# 用法：在 macOS 终端执行

cd /Users/megalomaniac/birthday-game

# 1. 清理锁文件
rm -f .git/index.lock

# 2. 检查当前状态
echo "=== Git 状态 ==="
git status

# 3. 如果之前有失败的提交，先完成它或重置
# 如果看到 "Merge branch..." 的提示，说明有未完成的合并
# 这种情况下执行：git merge --abort 或 git reset --hard HEAD

# 4. 添加所有更改并提交
git add -A
git commit -m "init: birthday-game project" || echo "提交失败，可能是空提交或锁问题"

# 5. 重命名分支为 main
git branch -M main

# 6. 添加远程仓库（替换为你的用户名）
git remote remove origin 2>/dev/null
git remote add origin https://github.com/jt1934378847-bot/birthday-game.git

# 7. 推送（会提示输入用户名和密码/Token）
echo "=== 正在推送到 GitHub ==="
git push -u origin main

echo "=== 完成 ==="
