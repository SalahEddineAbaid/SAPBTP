const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  const proxyTarget = process.env.REACT_APP_PROXY_TARGET || 'http://localhost:4004';

  const proxyConfig = {
    target: proxyTarget,
    changeOrigin: true,
    onProxyReq: (proxyReq, req) => {
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
    },
    onProxyRes: (proxyRes, req) => {
      // Log warning when receiving 503 from proxy target
      if (proxyRes.statusCode === 503) {
        console.warn(`[PROXY] 503 from ${proxyTarget} for ${req.method} ${req.url}`);
      }
    },
  };

  app.use('/api', createProxyMiddleware(proxyConfig));
  app.use('/odata', createProxyMiddleware(proxyConfig));
};
