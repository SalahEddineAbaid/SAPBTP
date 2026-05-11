'use strict';
/**
 * SmartOrder — WebSocket Manager (CAP version)
 * Socket.io avec authentification XSUAA ou mock local
 */
const { Server } = require('socket.io');
const cds = require('@sap/cds');
const LOG = cds.log('socket-manager');

let io = null;

function initSocket(httpServer) {
  if (io) return io;

  const corsOrigin = process.env.WS_CORS_ORIGIN || process.env.FRONTEND_URL || '*';

  io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });

  // -----------------------------------------------------------------------
  // Middleware d'authentification Socket.io
  // -----------------------------------------------------------------------
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token
               || socket.handshake.headers?.authorization?.split(' ')[1];

    const isDev = process.env.NODE_ENV !== 'production';

    if (isDev && !token) {
      // Mode dev — utiliser le rôle passé dans auth
      const mockRole = socket.handshake.auth?.role || 'USER';
      socket.data.userId  = `dev-${mockRole}`;
      socket.data.role    = mockRole.toUpperCase();
      socket.join(socket.data.role);
      LOG.debug('WS mock auth — room=%s', socket.data.role);
      return next();
    }

    if (!token) {
      return next(new Error('Token manquant'));
    }

    try {
      // Authentification via CAP auth service
      const authInfo = await cds.auth.authenticate(token);
      const role = authInfo.is?.('ADMIN') ? 'ADMIN'
                 : authInfo.is?.('MANAGER') ? 'MANAGER'
                 : 'USER';

      socket.data.userId = authInfo.id || authInfo.attr?.username;
      socket.data.role   = role;
      socket.join(role);

      LOG.debug('WS auth OK — userId=%s room=%s', socket.data.userId, role);
      next();
    } catch (err) {
      LOG.warn('WS auth échouée : %s', err.message);
      next(new Error('Authentification WebSocket échouée'));
    }
  });

  // -----------------------------------------------------------------------
  // Gestion des connexions
  // -----------------------------------------------------------------------
  io.on('connection', (socket) => {
    LOG.info('WS connecté — userId=%s role=%s id=%s',
      socket.data.userId, socket.data.role, socket.id);

    // Envoyer les stats de connexion à l'admin
    const connectedCount = io.engine.clientsCount;
    io.to('ADMIN').emit('CONNECTION_STATS', {
      connected: connectedCount,
      timestamp: new Date().toISOString(),
    });

    // Client demande une connexion aux rooms supplémentaires
    socket.on('join_room', (room) => {
      if (['USER', 'MANAGER', 'ADMIN'].includes(room)) {
        socket.join(room);
        LOG.debug('WS join_room — %s rejoint %s', socket.data.userId, room);
      }
    });

    // Ping/Pong pour garder la connexion active
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });

    socket.on('disconnect', (reason) => {
      LOG.debug('WS déconnecté — %s (raison: %s)', socket.data.userId, reason);
    });

    socket.on('error', (err) => {
      LOG.error('WS erreur — %s : %s', socket.data.userId, err.message);
    });
  });

  LOG.info('✅ Socket.io initialisé — cors=%s', corsOrigin);
  return io;
}

function getIO() {
  return io;
}

/**
 * Émettre un événement à tous les clients d'un rôle donné
 * @param {string} room - 'USER' | 'MANAGER' | 'ADMIN'
 * @param {string} event - Nom de l'événement
 * @param {Object} data - Données à envoyer
 */
function emitToRoom(room, event, data) {
  if (!io) {
    LOG.warn('Socket.io non initialisé — événement ignoré : %s', event);
    return;
  }
  io.to(room).emit(event, { ...data, timestamp: new Date().toISOString() });
}

module.exports = { initSocket, getIO, emitToRoom };
