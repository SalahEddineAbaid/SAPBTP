/**
 * CRA Proxy Configuration
 * Sur BAS, le proxy simple (package.json "proxy") peut ne pas transmettre
 * correctement le header Authorization. Ce fichier force le passage de tous les headers.
 *
 * Configuration :
 *   REACT_APP_PROXY_TARGET  — override de la cible du proxy
 *     (ex: http://localhost:5000 pour passer par l'AppRouter)
 *     Valeur par défaut : http://localhost:4004 (backend direct)
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
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
