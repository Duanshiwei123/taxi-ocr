# 部署到 Cloudflare 完整指南

## 前置准备

### 1. 注册 Cloudflare 账号
- 访问 https://dash.cloudflare.com/sign-up
- 免费注册（无需信用卡）

### 2. 安装 Wrangler CLI
```bash
npm install -g wrangler
```

### 3. 登录 Cloudflare
```bash
wrangler login
# 浏览器会自动打开，授权即可
```

### 4. 获取 Account ID
登录 https://dash.cloudflare.com → 首页就能看到 **Account ID**，复制备用。

---

## 第一步：部署后端（Cloudflare Worker）

```bash
cd c:/Users/v_isweduan/CodeBuddy/20260529115600
```

### 1. 配置密钥（百度 OCR API Key）

```bash
# 设置百度 OCR API Key（替换成你的实际 Key）
wrangler secret put BAIDU_API_KEY
# 提示输入时，粘贴：SvxOgu11sRL76eYh5AX0z3rP

wrangler secret put BAIDU_SECRET_KEY
# 提示输入时，粘贴：VlubSseDX9x9uQHDH9mf4Kbn5n4zS772
```

### 2. 部署 Worker

```bash
wrangler deploy worker.js --name taxi-ocr-worker
```

部署成功后，会输出类似：
```
https://taxi-ocr-worker.<your-subdomain>.workers.dev
```

**复制这个 URL，下一步要用！**

---

## 第二步：修改前端 API 地址

编辑 `public/index.html`，找到 `API_BASE` 这一行（约第 638 行附近），改为：

```javascript
// 替换成你上一步部署的 Worker URL
const API_BASE = 'https://taxi-ocr-worker.<your-subdomain>.workers.dev';
```

---

## 第三步：部署前端（Cloudflare Pages）

### 方式A：通过 Git 自动部署（推荐）

1. 先把代码推到 GitHub：
```bash
cd c:/Users/v_isweduan/CodeBuddy/20260529115600
git init
git add .
git commit -m "init"
# 在 GitHub 创建一个新 repo，然后：
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

2. 登录 https://dash.cloudflare.com → **Pages** → **Create a project** → 连接 GitHub → 选择仓库

3. 构建配置：
   - Build command：**留空**（纯静态页面，无需构建）
   - Build output directory：`public`
   - Root directory：**留空**

4. 点击 **Save and Deploy**，等待部署完成

### 方式B：直接上传（无需 Git）

```bash
wrangler pages deploy public --project-name=taxi-ocr-frontend
```

---

## 第四步：验证

1. 打开 Cloudflare Pages 给你的域名（类似 `https://xxx.pages.dev`）
2. 上传一张发票图片，点击识别，确认能正常调用 Worker 后端
3. 检查浏览器控制台是否有跨域错误（若有，检查 Worker 的 CORS 配置）

---

## 常见问题

### Q：Worker 部署后调用报错 500
A：检查密钥是否正确设置：
```bash
wrangler secret list
```

### Q：前端访问 Worker 报 CORS 错误
A：Worker 代码中已配置了 `Access-Control-Allow-Origin: *`，如果还有问题，检查 `worker.js` 中的 CORS 响应头。

### Q：如何更新 Worker？
```bash
wrangler deploy worker.js
```

### Q：如何更新前端？
方式A（Git）：直接 `git push`，Pages 自动重新部署。
方式B（直接上传）：重新运行 `wrangler pages deploy public ...`
