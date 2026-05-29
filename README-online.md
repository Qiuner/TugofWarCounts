# 数学大拔河联机版

这是在原始单机项目旁边新增的一套公网可部署联机版，不覆盖原有 [TugofWarCounts.html](/E:/TugofWarCounts/TugofWarCounts.html:1)。

## 结构

- `server.js`
  - Node HTTP 服务
  - WebSocket 房间同步
  - 服务端判题、计时、胜负结算
  - 会话保持、掉线重连、房间过期清理
- `public/index.html`
  - 联机大厅和比赛界面
- `public/app.js`
  - 前端房间逻辑、答题输入、状态渲染、自动重连、分享链接
- `public/styles.css`
  - 联机版样式
- `ecosystem.config.js`
  - PM2 启动配置
- `deploy.nginx.conf`
  - Nginx 反向代理示例

## 启动

```bash
npm install
npm start
```

默认地址：

```text
http://localhost:3000
```

如果 `3000` 端口被占用，可以换端口：

```powershell
$env:PORT=3011
npm start
```

## 怎么实现公网双人对战

这套联机版采用“服务端权威”的实现方式：

- 两个用户都访问同一个网站
- 两个浏览器都连接到同一台 Node 服务器
- 服务端负责房间、题目、计时、判题、比分、绳子位置和胜负结算

不是浏览器互相直连，而是：

- 用户 A 浏览器
- WebSocket
- 你的服务器
- WebSocket
- 用户 B 浏览器

### 进入同一个房间的方式

1. 用户 A 打开网站后创建房间
2. 服务器生成一个 5 位房间号
3. 前端会生成一个可分享的房间链接
4. 用户 A 把这个链接发给用户 B
5. 用户 B 打开链接后，页面会自动带上房间号并加入同一房间
6. 房主点击开始，双方进入同一局比赛

### 服务端负责什么

- 创建和销毁房间
- 把房主分配到蓝队，把第二位玩家分配到红队
- 统一生成题目
- 校验答案
- 统一计时
- 统一更新拔河绳位置
- 广播房间状态给双方

### 前端负责什么

- 输入昵称
- 创建或加入房间
- 展示邀请链接
- 输入答案并提交
- 根据服务端状态刷新界面
- 自动尝试重连

## 当前能力

- 创建 2 人房间
- 房间号加入
- 分享房间链接加入
- 房主配置时长、题数、难度
- 服务端统一出题
- 服务端判题和计时
- 双端同步比分、绳子位置、胜负结果
- 浏览器刷新或掉线后，30 秒内可重连原座位
- 长时间无人房间自动清理

## 部署到服务器

最简单的生产部署方案：

1. 准备一台云服务器
2. 安装 Node.js 20+
3. 拉取仓库代码
4. 运行 `npm install`
5. 使用 PM2 启动服务
6. 使用 Nginx 做反向代理
7. 配置域名和 HTTPS

### PM2 启动

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

### 健康检查

服务端提供：

```text
/healthz
```

### Nginx

示例配置见：

- [deploy.nginx.conf](/E:/TugofWarCounts/deploy.nginx.conf:1)

部署时别忘了允许 WebSocket 升级头。

## Docker 部署

如果你想直接把项目打成镜像丢到自己的服务器，现在已经可以。

项目里新增了：

- [Dockerfile](/E:/TugofWarCounts/Dockerfile:1)
- [.dockerignore](/E:/TugofWarCounts/.dockerignore:1)

### 本地构建镜像

```bash
docker build -t tugofwarcounts:latest .
```

### 本地运行容器

```bash
docker run -d --name tugofwarcounts -p 3000:3000 tugofwarcounts:latest
```

启动后访问：

```text
http://localhost:3000
```

### 带环境变量运行

```bash
docker run -d \
  --name tugofwarcounts \
  -p 3000:3000 \
  -e PORT=3000 \
  -e ROOM_IDLE_MS=600000 \
  -e RECONNECT_GRACE_MS=30000 \
  tugofwarcounts:latest
```

### 服务器上的典型流程

1. 把项目拉到服务器
2. 执行 `docker build -t tugofwarcounts:latest .`
3. 执行 `docker run -d --name tugofwarcounts -p 3000:3000 tugofwarcounts:latest`
4. 用 Nginx 或 Caddy 反向代理到容器的 `3000` 端口
5. 配域名和 HTTPS

### 更新版本

```bash
docker stop tugofwarcounts
docker rm tugofwarcounts
docker build -t tugofwarcounts:latest .
docker run -d --name tugofwarcounts -p 3000:3000 tugofwarcounts:latest
```

## 推荐上线形态

- `Node.js` 跑 `server.js`
- `PM2` 做进程守护
- `Nginx` 做反向代理
- `HTTPS + WSS` 提供公网访问

用户最终访问：

```text
https://your-domain.com/public/index.html
```

或者你也可以直接把 `/` 指向首页，让用户只访问域名根路径。

## 环境变量

- `PORT`
  - 服务端端口，默认 `3000`
- `ROOM_IDLE_MS`
  - 房间空闲多久自动清理，默认 `600000`
- `RECONNECT_GRACE_MS`
  - 掉线后座位保留时间，默认 `30000`
- `CLEANUP_INTERVAL_MS`
  - 清理任务运行周期
- `HEARTBEAT_INTERVAL_MS`
  - WebSocket 心跳周期

## 当前限制

- 还没接入 Excel 自定义题库上传到服务端
- 还没有数据库持久化
- 还没有用户系统
- 还没有观战模式
- 还没有更细的限流和反作弊策略

## 建议下一步

1. 接入 Excel 上传并把题库同步到服务端
2. 增加基础限流和日志
3. 加 Redis 或数据库做房间持久化
4. 增加观战和战绩记录
