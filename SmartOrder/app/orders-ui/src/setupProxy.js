/**
 * CRA Proxy Configuration
 * Sur BAS, le proxy simple (package.json "proxy") peut ne pas transmettre
 * correctement le header Authorization. Ce fichier force le passage de tous les headers.
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  const proxyConfig = {
    target: 'http://localhost:4004',
    changeOrigin: true,
    // Transmettre TOUS les headers (y compris Authorization)
    onProxyReq: (proxyReq, req) => {
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
    },
  };

  app.use('/api', createProxyMiddleware(proxyConfig));
  app.use('/odata', createProxyMiddleware(proxyConfig));
};
