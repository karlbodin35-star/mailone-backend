const jwt = require('jsonwebtoken');
const supabase = require('./supabase');

// ── GENERATE TOKEN ───────────────────────────────────────────
function generateToken(userId) {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ── VERIFY TOKEN MIDDLEWARE ──────────────────────────────────
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token manquant. Connectez-vous.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Vérifier que l'utilisateur existe toujours
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, is_active, is_admin')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Utilisateur introuvable.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Compte suspendu. Contactez le support.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token invalide.' });
  }
}

// ── CHECK ACTIVE SUBSCRIPTION ────────────────────────────────
async function requireSubscription(req, res, next) {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', req.user.id)
    .in('status', ['trialing', 'active'])
    .single();

  if (!sub) {
    return res.status(403).json({
      error: 'Abonnement inactif.',
      code: 'NO_SUBSCRIPTION',
      redirect: '/account.html#plan'
    });
  }

  req.subscription = sub;
  next();
}

// ── ADMIN UNIQUEMENT ─────────────────────────────────────────
// (utilisé par /api/admin et /api/agents — outils internes MailOne)
function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }
  next();
}

module.exports = { generateToken, requireAuth, requireSubscription, requireAdmin };
