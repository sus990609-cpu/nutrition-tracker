# 每日营养管家 - 自托管镜像（零依赖，无需 npm install）
FROM node:20-alpine

# 生产模式；容器内必须监听 0.0.0.0 才能被宿主端口映射访问
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

WORKDIR /app

# 只拷贝运行所需文件（密钥通过运行时 -e / --env-file 注入，绝不进镜像）
COPY --chown=node:node package.json ./
COPY --chown=node:node server.js index.html app.js styles.css catalog.js manifest.webmanifest sw.js ./
COPY --chown=node:node assets ./assets

# 非 root 运行
USER node

EXPOSE 8080

# 使用 Node 20 内置 fetch 做健康检查（不带 Key 也能通过）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
