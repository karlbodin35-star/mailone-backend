// ══════════════════════════════════════════════════════════════
// MAILONE — Équipe : gestion des sièges, chat interne, calendrier partagé
// ══════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { requireAuth, requireSubscription } = require('../lib/auth');
const { sanitize } = require('../lib/security');

// Nombre de sièges par plan — strict, pas un de plus
const PLAN_SEATS = { solo: 1, team: 10, enterprise: 50 };

// ── Helper : récupérer l'appartenance à une équipe ─────────
async function getUserTeam(userId) {
  const { data } = await supabase
    .from('team_members')
    .select('id, team_id, role, status, teams(id, name, max_seats, owner_id)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();
  return data || null;
}

// ── Helper : nombre de sièges actifs ───────────────────────
async function countActiveSeats(teamId) {
  const { count } = await supabase
    .from('team_members')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', teamId)
    .eq('status', 'active');
  return count || 0;
}

// ── GET /api/team — infos équipe + membres ─────────────────
router.get('/', requireAuth, requireSubscription, async (req, res) => {
  try {
    const membership = await getUserTeam(req.user.id);
    if (!membership) return res.json({ team: null, members: [] });

    const { data: members } = await supabase
      .from('team_members')
      .select('id, role, status, joined_at, invited_email, user_id, users(id, first_name, last_name, email)')
      .eq('team_id', membership.team_id)
      .order('joined_at', { ascending: true });

    const plan = req.subscription?.plan || 'solo';
    const maxSeats = PLAN_SEATS[plan] || 1;
    const activeSeats = (members || []).filter(m => m.status === 'active').length;

    res.json({
      team: {
        id: membership.team_id,
        name: membership.teams?.name,
        maxSeats,
        activeSeats,
        pendingInvites: (members || []).filter(m => m.status === 'invited').length,
        isOwner: membership.role === 'owner',
      },
      members: members || [],
    });
  } catch (err) {
    console.error('Team get error:', err);
    res.status(500).json({ error: 'Erreur chargement équipe.' });
  }
});

// ── POST /api/team/create — créer l'équipe (owner seulement) ──
router.post('/create', requireAuth, requireSubscription, async (req, res) => {
  try {
    const plan = req.subscription?.plan || 'solo';
    if (plan === 'solo') {
      return res.status(403).json({ error: 'Plan Solo : fonctionnalité équipe non disponible. Passez au plan Team ou Enterprise.' });
    }

    // Déjà dans une équipe ?
    const existing = await getUserTeam(req.user.id);
    if (existing) return res.json({ success: true, alreadyExists: true, teamId: existing.team_id });

    const maxSeats = PLAN_SEATS[plan] || 1;
    const teamName = sanitize(req.body.name) || `Équipe de ${req.user.first_name}`;

    const { data: team, error } = await supabase
      .from('teams')
      .insert({ owner_id: req.user.id, name: teamName, max_seats: maxSeats })
      .select()
      .single();

    if (error) throw error;

    await supabase.from('team_members').insert({
      team_id: team.id,
      user_id: req.user.id,
      role: 'owner',
      status: 'active',
      joined_at: new Date().toISOString(),
    });

    res.json({ success: true, team });
  } catch (err) {
    console.error('Team create error:', err);
    res.status(500).json({ error: 'Erreur création équipe.' });
  }
});

// ── POST /api/team/invite — inviter un membre (owner uniquement) ──
router.post('/invite', requireAuth, requireSubscription, async (req, res) => {
  try {
    const email = sanitize(req.body.email || '').toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email invalide.' });
    }

    const membership = await getUserTeam(req.user.id);
    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Seul le propriétaire peut inviter des membres.' });
    }

    const plan = req.subscription?.plan || 'solo';
    const maxSeats = PLAN_SEATS[plan] || 1;
    const activeSeats = await countActiveSeats(membership.team_id);

    // Enforcement strict : pas un siège de plus
    if (activeSeats >= maxSeats) {
      return res.status(403).json({
        error: `Limite de ${maxSeats} sièges atteinte. Retirez un membre pour libérer une place.`,
        code: 'SEATS_FULL',
        maxSeats,
        activeSeats,
      });
    }

    // Déjà invité ou membre ?
    const { data: existing } = await supabase
      .from('team_members')
      .select('id, status')
      .eq('team_id', membership.team_id)
      .eq('invited_email', email)
      .single();

    if (existing) {
      return res.status(409).json({
        error: existing.status === 'active' ? 'Cet email est déjà membre de l\'équipe.' : 'Une invitation est déjà en attente pour cet email.',
      });
    }

    // Est-ce que cet email correspond à un utilisateur existant ?
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    const inviteToken = crypto.randomBytes(24).toString('hex');

    if (existingUser) {
      // Ajouter directement comme membre invité (ils verront la notification à la connexion)
      await supabase.from('team_members').insert({
        team_id: membership.team_id,
        user_id: existingUser.id,
        invited_email: email,
        invite_token: inviteToken,
        role: 'member',
        status: 'invited',
      });
    } else {
      // Créer un slot d'invitation pour un futur inscrit
      await supabase.from('team_members').insert({
        team_id: membership.team_id,
        invited_email: email,
        invite_token: inviteToken,
        role: 'member',
        status: 'invited',
      });
    }

    const inviteUrl = `${process.env.FRONTEND_URL}/register.html?invite=${inviteToken}&email=${encodeURIComponent(email)}`;

    // Envoyer l'email d'invitation
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: process.env.EMAIL_FROM,
        to: email,
        subject: `${req.user.first_name} vous invite à rejoindre MailOne`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:32px">
            <h2 style="color:#0d9373">Invitation MailOne</h2>
            <p><strong>${req.user.first_name} ${req.user.last_name || ''}</strong> vous invite à rejoindre son équipe sur MailOne.</p>
            <p>MailOne est le gestionnaire de mails intelligent pour les artisans et PME — propulsé par l'IA.</p>
            <a href="${inviteUrl}" style="display:inline-block;margin:24px 0;padding:12px 28px;background:#0d9373;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">
              Rejoindre l'équipe →
            </a>
            <p style="color:#71717a;font-size:12px">Ce lien est valable 7 jours. Si vous n'attendiez pas cette invitation, ignorez cet email.</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('Invite email error:', emailErr.message);
    }

    res.json({ success: true, inviteUrl, pendingSeats: maxSeats - activeSeats - 1 });
  } catch (err) {
    console.error('Team invite error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'invitation.' });
  }
});

// ── GET /api/team/verify-invite/:token — valider une invitation ──
router.get('/verify-invite/:token', async (req, res) => {
  const { data } = await supabase
    .from('team_members')
    .select('id, invited_email, teams(id, name, owner_id, users(first_name, last_name))')
    .eq('invite_token', req.params.token)
    .eq('status', 'invited')
    .single();

  if (!data) return res.status(404).json({ error: 'Invitation invalide ou expirée.' });

  res.json({
    valid: true,
    email: data.invited_email,
    teamName: data.teams?.name,
    inviterName: `${data.teams?.users?.first_name || ''} ${data.teams?.users?.last_name || ''}`.trim(),
  });
});

// ── POST /api/team/accept-invite — accepter une invitation (utilisateur connecté) ──
router.post('/accept-invite', requireAuth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requis.' });

    const { data: invite } = await supabase
      .from('team_members')
      .select('id, team_id, invited_email, teams(max_seats)')
      .eq('invite_token', token)
      .eq('status', 'invited')
      .single();

    if (!invite) return res.status(404).json({ error: 'Invitation invalide ou expirée.' });

    // Vérifier le siège une dernière fois avant d'activer
    const activeSeats = await countActiveSeats(invite.team_id);
    if (activeSeats >= (invite.teams?.max_seats || 1)) {
      return res.status(403).json({ error: 'L\'équipe est complète. Contactez le propriétaire.' });
    }

    await supabase
      .from('team_members')
      .update({
        user_id: req.user.id,
        status: 'active',
        joined_at: new Date().toISOString(),
        invite_token: null,
      })
      .eq('id', invite.id);

    res.json({ success: true, teamId: invite.team_id });
  } catch (err) {
    console.error('Accept invite error:', err);
    res.status(500).json({ error: 'Erreur acceptation invitation.' });
  }
});

// ── DELETE /api/team/members/:memberId — retirer un membre ──
router.delete('/members/:memberId', requireAuth, requireSubscription, async (req, res) => {
  try {
    const membership = await getUserTeam(req.user.id);
    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Seul le propriétaire peut retirer des membres.' });
    }

    // Vérifier que ce membre appartient bien à cette équipe
    const { data: target } = await supabase
      .from('team_members')
      .select('id, role')
      .eq('id', req.params.memberId)
      .eq('team_id', membership.team_id)
      .single();

    if (!target) return res.status(404).json({ error: 'Membre introuvable.' });
    if (target.role === 'owner') return res.status(403).json({ error: 'Impossible de retirer le propriétaire.' });

    await supabase.from('team_members').delete().eq('id', req.params.memberId);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur suppression membre.' });
  }
});

// ── GET /api/team/chat — messages récents ─────────────────
router.get('/chat', requireAuth, requireSubscription, async (req, res) => {
  try {
    const membership = await getUserTeam(req.user.id);
    if (!membership) return res.status(403).json({ error: 'Vous n\'êtes pas dans une équipe.' });

    const since = req.query.since; // timestamp ISO — polling diff
    let query = supabase
      .from('team_messages')
      .select('id, content, created_at, sender_id, users(id, first_name, last_name)')
      .eq('team_id', membership.team_id)
      .order('created_at', { ascending: false })
      .limit(60);

    if (since) query = query.gt('created_at', since);

    const { data: messages } = await query;
    res.json({ messages: (messages || []).reverse() });
  } catch (err) {
    console.error('Team chat get error:', err);
    res.status(500).json({ error: 'Erreur chargement messages.' });
  }
});

// ── POST /api/team/chat — envoyer un message ──────────────
router.post('/chat', requireAuth, requireSubscription, async (req, res) => {
  try {
    const content = sanitize(req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Message vide.' });
    if (content.length > 2000) return res.status(400).json({ error: 'Message trop long (2000 chars max).' });

    const membership = await getUserTeam(req.user.id);
    if (!membership) return res.status(403).json({ error: 'Vous n\'êtes pas dans une équipe.' });

    const { data: message, error } = await supabase
      .from('team_messages')
      .insert({ team_id: membership.team_id, sender_id: req.user.id, content })
      .select('id, content, created_at, sender_id, users(id, first_name, last_name)')
      .single();

    if (error) throw error;
    res.json({ success: true, message });
  } catch (err) {
    console.error('Team chat post error:', err);
    res.status(500).json({ error: 'Erreur envoi message.' });
  }
});

// ── GET /api/team/calendar — événements partagés ──────────
router.get('/calendar', requireAuth, requireSubscription, async (req, res) => {
  try {
    const membership = await getUserTeam(req.user.id);
    if (!membership) return res.status(403).json({ error: 'Vous n\'êtes pas dans une équipe.' });

    const { data: events } = await supabase
      .from('team_events')
      .select('*, users(first_name, last_name)')
      .eq('team_id', membership.team_id)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });

    res.json({ events: events || [] });
  } catch (err) {
    res.status(500).json({ error: 'Erreur chargement calendrier.' });
  }
});

// ── POST /api/team/calendar — partager un événement ───────
router.post('/calendar', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { title, date, startTime, endTime } = req.body;
    if (!title || !date || !startTime || !endTime) {
      return res.status(400).json({ error: 'Champs requis : title, date, startTime, endTime.' });
    }

    const membership = await getUserTeam(req.user.id);
    if (!membership) return res.status(403).json({ error: 'Vous n\'êtes pas dans une équipe.' });

    const { data: event, error } = await supabase
      .from('team_events')
      .insert({
        team_id: membership.team_id,
        creator_id: req.user.id,
        title: sanitize(title).slice(0, 200),
        date,
        start_time: startTime,
        end_time: endTime,
      })
      .select('*, users(first_name, last_name)')
      .single();

    if (error) throw error;
    res.json({ success: true, event });
  } catch (err) {
    console.error('Team calendar post error:', err);
    res.status(500).json({ error: 'Erreur partage événement.' });
  }
});

// ── DELETE /api/team/calendar/:eventId ────────────────────
router.delete('/calendar/:eventId', requireAuth, requireSubscription, async (req, res) => {
  try {
    const membership = await getUserTeam(req.user.id);
    if (!membership) return res.status(403).json({ error: 'Vous n\'êtes pas dans une équipe.' });

    // Seul le créateur ou le propriétaire peut supprimer
    const { data: ev } = await supabase
      .from('team_events')
      .select('creator_id')
      .eq('id', req.params.eventId)
      .eq('team_id', membership.team_id)
      .single();

    if (!ev) return res.status(404).json({ error: 'Événement introuvable.' });
    if (ev.creator_id !== req.user.id && membership.role !== 'owner') {
      return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres événements.' });
    }

    await supabase.from('team_events').delete().eq('id', req.params.eventId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur suppression événement.' });
  }
});

module.exports = router;
