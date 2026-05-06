// ══════════════════════════════════════════════════════════════
// MAILONE BACKEND — Serveur principal
// ══════════════════════════════════════════════════════════════
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();

// ── SÉCURITÉ ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", 'data:', 'https:'],
      connectSrc:     ["'self'"],
      fontSrc:        ["'self'"],
      objectSrc:      ["'none'"],
      mediaSrc:       ["'none'"],
      frameSrc:       ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Headers de sécurité supplémentaires non couverts par Helmet
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});

// CORS — autoriser votre frontend
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  // En production : ajoutez votre domaine Vercel
  'https://mailone-site.vercel.app',
  // 'https://mailone.app', 'https://mailone-site.vercel.app',
  // 'https://www.mailone.app',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Autoriser les requêtes sans origin (Postman, mobile, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS non autorisé pour : ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ── RATE LIMITING ─────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 tentatives par IP
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requêtes/min
  message: { error: 'Trop de requêtes. Ralentissez.' },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // 20 requêtes IA/min
  message: { error: 'Trop de requêtes IA. Attendez 1 minute.' },
});

// ── BODY PARSERS ──────────────────────────────────────────────
// ⚠️ Le webhook Stripe nécessite le body RAW — il doit être avant express.json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Pour toutes les autres routes
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ── LOGS ──────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'MailOne Backend',
    version: '1.0.0',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ── ROUTES ────────────────────────────────────────────────────
app.use('/api/auth',     authLimiter, require('./routes/auth'));
app.use('/api/stripe',   apiLimiter,  require('./routes/stripe'));
app.use('/api/ai',       aiLimiter,   require('./routes/ai'));
app.use('/api/referral', apiLimiter,  require('./routes/referral'));
app.use('/api/team',     apiLimiter,  require('./routes/team'));
app.use('/api/support',  apiLimiter,  require('./routes/support'));
app.use('/api/cron',    require('./routes/cron'));     // Cron jobs — sécurisé par CRON_SECRET

// ── 404 ───────────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ error: `Route introuvable : ${req.method} ${req.originalUrl}` });
});

// ── GESTION D'ERREURS GLOBALE ─────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  if (err.message?.includes('CORS')) {
    return res.status(403).json({ error: 'Accès non autorisé (CORS).' });
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Erreur interne du serveur.'
      : err.message,
  });
});

// ── DÉMARRAGE ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 MailOne Backend démarré`);
  console.log(`   Port      : ${PORT}`);
  console.log(`   Env       : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Frontend  : ${process.env.FRONTEND_URL || 'non configuré'}`);
  console.log(`   Supabase  : ${process.env.SUPABASE_URL ? '✅ configuré' : '❌ manquant'}`);
  console.log(`   Stripe    : ${process.env.STRIPE_SECRET_KEY ? '✅ configuré' : '❌ manquant'}`);
  console.log(`   Resend    : ${process.env.RESEND_API_KEY ? '✅ configuré' : '❌ manquant'}`);
  console.log(`   Anthropic : ${process.env.ANTHROPIC_API_KEY ? '✅ configuré' : '❌ manquant'}`);
  console.log(`\n   Routes disponibles :`);
  console.log(`   POST /api/auth/register`);
  console.log(`   POST /api/auth/login`);
  console.log(`   GET  /api/auth/me`);
  console.log(`   POST /api/stripe/create-checkout-session`);
  console.log(`   POST /api/stripe/portal`);
  console.log(`   POST /api/stripe/webhook`);
  console.log(`   POST /api/ai/generate-reply`);
  console.log(`   POST /api/ai/analyze`);
  console.log(`   GET  /api/referral/my-code\n`);
});

module.exports = app;
