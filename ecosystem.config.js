module.exports = {
  apps: [
    {
      name: "tugofwarcounts",
      script: "./server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        ROOM_IDLE_MS: 600000,
        RECONNECT_GRACE_MS: 30000
      }
    }
  ]
};
