/**
 * FMO BUS – načítání zpráv z Discordu pro embed na webu
 * Cloudflare Worker (zdarma, nasazení cca 5 minut)
 *
 * NÁVOD
 * 1) https://discord.com/developers/applications → New Application → Bot → "Reset Token" a token zkopíruj.
 *    (Intents zapínat nemusíš. Bot ale musí být přidán na tvůj server: OAuth2 → URL Generator →
 *     scope "bot", oprávnění "View Channels" + "Read Message History" → otevři vygenerovaný odkaz.)
 * 2) https://dash.cloudflare.com → Workers & Pages → Create → Worker → vlož tento kód → Deploy.
 * 3) Settings → Variables and Secrets:
 *      DISCORD_TOKEN  = (token bota, typ Secret)
 *      ALLOW_ORIGIN   = https://tvoje-domena.cz   (adresa tvého webu; pro test může být *)
 *      ALLOW_GUILD    = ID tvého serveru           (volitelné, ochrana: worker pak čte jen tvůj server)
 * 4) Adresu workeru (např. https://fmo-discord.tvoje-jmeno.workers.dev) vlož do index.html
 *    do konstanty DISCORD_API na začátku skriptu.
 *
 * Ve webu pak stačí vložit odkaz na zprávu (pravý klik na zprávu → Kopírovat odkaz na zprávu)
 * a zpráva se načte i s autorem, textem a obrázkem.
 */
export default {
  async fetch(req, env) {
    const cors = {
      'access-control-allow-origin': env.ALLOW_ORIGIN || '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60'
    };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const u = new URL(req.url);
    const channel = u.searchParams.get('channel'), message = u.searchParams.get('message');
    if (!/^\d{5,25}$/.test(channel || '') || !/^\d{5,25}$/.test(message || '')) return json({ error: 'Neplatný odkaz na zprávu.' }, 400);
    if (!env.DISCORD_TOKEN) return json({ error: 'Worker nemá nastavený DISCORD_TOKEN.' }, 500);

    const headers = { Authorization: `Bot ${env.DISCORD_TOKEN}`, 'User-Agent': 'FMO-BUS-Embed (worker, 1.0)' };

    if (env.ALLOW_GUILD) {
      const ch = await fetch(`https://discord.com/api/v10/channels/${channel}`, { headers });
      if (!ch.ok) return json({ error: 'Kanál nelze načíst (je bot na serveru?).' }, ch.status);
      const chj = await ch.json();
      if (chj.guild_id !== env.ALLOW_GUILD) return json({ error: 'Tento server není povolen.' }, 403);
    }

    const r = await fetch(`https://discord.com/api/v10/channels/${channel}/messages/${message}`, { headers });
    if (r.status === 404) return json({ error: 'Zpráva nenalezena.' }, 404);
    if (r.status === 403) return json({ error: 'Bot nemá přístup do tohoto kanálu.' }, 403);
    if (!r.ok) return json({ error: 'Discord vrátil chybu ' + r.status }, 502);
    const m = await r.json();

    // zmínky <@id> nahradíme jmény
    let content = m.content || '';
    for (const x of m.mentions || []) content = content.replaceAll(`<@${x.id}>`, '@' + (x.global_name || x.username)).replaceAll(`<@!${x.id}>`, '@' + (x.global_name || x.username));

    const a = m.author || {};
    const avatar = a.avatar
      ? `https://cdn.discordapp.com/avatars/${a.id}/${a.avatar}.png?size=64`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(a.id || 0) >> 22n) % 6n)}.png`;

    return json({
      content,
      timestamp: m.timestamp,
      author: { name: a.global_name || a.username || 'Discord', avatar },
      attachments: (m.attachments || []).map(x => ({ url: x.url, filename: x.filename, content_type: x.content_type })),
      embeds: (m.embeds || []).map(e => ({ title: e.title, description: e.description, url: e.url, image: e.image && { url: e.image.url }, thumbnail: e.thumbnail && { url: e.thumbnail.url } }))
    });
  }
};
