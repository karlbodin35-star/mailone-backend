const supabase = require('./supabase');

const GOOGLE_TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const GRAPH_TOKEN_URL   = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

async function getValidAccessToken(userId, provider) {
  const { data: conn } = await supabase
    .from('oauth_connections')
    .select('access_token, refresh_token, token_expiry')
    .eq('user_id', userId)
    .eq('provider', provider)
    .single();

  if (!conn) return null;

  const bufferMs = 5 * 60 * 1000;
  const isExpired = conn.token_expiry && new Date(conn.token_expiry) < new Date(Date.now() + bufferMs);

  if (!isExpired) return conn.access_token;
  if (!conn.refresh_token) return null;

  const isGmail = provider === 'gmail';
  const tokenUrl = isGmail ? GOOGLE_TOKEN_URL : GRAPH_TOKEN_URL;
  const body = isGmail
    ? new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: conn.refresh_token,
        grant_type:    'refresh_token',
      })
    : new URLSearchParams({
        client_id:     process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        refresh_token: conn.refresh_token,
        grant_type:    'refresh_token',
        scope:         'https://graph.microsoft.com/Mail.Read offline_access',
      });

  const res  = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await res.json();

  if (!res.ok || data.error) {
    console.error('Token refresh failed:', data.error_description || data.error);
    return null;
  }

  await supabase.from('oauth_connections').update({
    access_token: data.access_token,
    token_expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
    updated_at:   new Date().toISOString(),
  }).eq('user_id', userId).eq('provider', provider);

  return data.access_token;
}

async function fetchGmailEmails(accessToken, max = 30) {
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=${max}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) {
    const errBody = await listRes.json().catch(() => ({}));
    const reason  = errBody?.error?.message || errBody?.error?.status || listRes.status;
    console.error('[Gmail] list error:', listRes.status, reason);
    if (listRes.status === 403 && String(reason).includes('not been used')) {
      throw new Error('Gmail API non activée dans Google Cloud Console. Activez-la sur console.cloud.google.com → APIs & Services → Library → Gmail API.');
    }
    throw new Error(`Gmail API : ${listRes.status} — ${reason}`);
  }
  const listData = await listRes.json();
  const ids = (listData.messages || []).slice(0, max);
  if (!ids.length) return [];

  const emails = await Promise.all(ids.map(async ({ id }) => {
    try {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const msg = await r.json();
      const hdrs = Object.fromEntries((msg.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
      const from  = hdrs.from || '';
      const nameM  = from.match(/^"?([^"<]+)"?\s*</);
      const emailM = from.match(/<([^>]+)>/);
      return {
        id:          msg.id,
        sender:      nameM?.[1]?.trim() || emailM?.[1] || from,
        senderEmail: emailM?.[1] || from,
        subject:     hdrs.subject || '(sans objet)',
        date:        hdrs.date ? new Date(hdrs.date).toISOString() : new Date().toISOString(),
        body:        msg.snippet || '',
      };
    } catch { return null; }
  }));

  return emails.filter(Boolean);
}

async function fetchOutlookEmails(accessToken, max = 30) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=${max}&$select=id,subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime desc`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error('Graph API failed: ' + res.status);
  const data = await res.json();
  return (data.value || []).map(msg => ({
    id:          msg.id,
    sender:      msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Inconnu',
    senderEmail: msg.from?.emailAddress?.address || '',
    subject:     msg.subject || '(sans objet)',
    date:        msg.receivedDateTime || new Date().toISOString(),
    body:        msg.bodyPreview || '',
  }));
}

module.exports = { getValidAccessToken, fetchGmailEmails, fetchOutlookEmails };
