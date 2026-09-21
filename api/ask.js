// api/ask.js
// Serverless endpoint powering CREATIVE INSIGHT's "Ask the Curator" chat widget.
// Grounds answers in the site's own curator_memory.json + recent daily archives,
// never fabricating facts outside that context. Free-tier Gemini API only.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server not configured (missing GEMINI_API_KEY)' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const question = ((body && body.question) || '').toString().trim().slice(0, 500);
  if (!question) {
    res.status(400).json({ error: 'Missing question' });
    return;
  }

  const SITE_BASE = 'https://meandfree23.github.io/creative-insight/';

  async function fetchJsonSafe(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  const [memory, manifest] = await Promise.all([
    fetchJsonSafe(SITE_BASE + 'data/curator_memory.json?v=' + Date.now()),
    fetchJsonSafe(SITE_BASE + 'data/manifest.json?v=' + Date.now())
  ]);

  let recentDays = [];
  if (manifest && Array.isArray(manifest.dates)) {
    const datesToLoad = manifest.dates.slice(0, 5);
    const loaded = await Promise.all(
      datesToLoad.map((d) => fetchJsonSafe(SITE_BASE + 'data/daily/' + d + '.json?v=' + Date.now()))
    );
    recentDays = loaded.filter(Boolean);
  }

  const compactPicks = [];
  recentDays.forEach((day) => {
    (day.topPicks || []).forEach((p) => {
      compactPicks.push({
        date: day.date,
        title: p.title,
        domain: p.domain,
        why: p.why,
        creator_insight: p.creator_insight,
        tags: p.tags,
        source: p.source
      });
    });
  });

  const contextPayload = {
    curator_memory_summary: memory
      ? {
          taste_profile: memory.taste_profile,
          recent_pipeline_health: (memory.pipeline_health_log || []).slice(-5),
          editorial_decisions: memory.editorial_decisions,
          open_questions: memory.open_questions_for_next_run
        }
      : null,
    recent_articles: compactPicks.slice(0, 60)
  };
  const contextBlock = JSON.stringify(contextPayload).slice(0, 12000);

  const systemPrompt = [
    '당신은 CREATIVE INSIGHT 사이트의 큐레이터 에이전트입니다.',
    '디자인, 영상연출, 브랜드 마케팅에 대해 거만하고 취향이 확고한 톤으로 답하되, 근거는 정확해야 합니다.',
    '아래 컨텍스트(최근 5일 아카이브 + 에이전트 기억)에 실제로 있는 내용만 근거로 답하세요. 컨텍스트에 없는 사실을 지어내지 마세요.',
    '컨텍스트에서 답을 찾을 수 없으면, 솔직하게 모른다고 말하고 아카이브를 직접 검색해보라고 안내하세요.',
    '답변은 한국어로, 3~6문장 정도로 간결하게 하세요.',
    '',
    '=== CONTEXT (JSON) ===',
    contextBlock
  ].join('\n');

  try {
    // Discover a currently-available free-tier model instead of hardcoding a name
    // that may be deprecated (mirrors the same fallback logic used in fetch_ideas.py).
    let modelName = 'flash-latest';
    try {
      const listRes = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey
      );
      const listJson = await listRes.json();
      const models = (listJson.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name);
      const preferredOrder = ['flash-latest', '3.6-flash', '3.5-flash', '3.1-flash-lite', 'pro-latest', '3.7-flash', 'flash'];
      let picked = null;
      for (const pref of preferredOrder) {
        picked = models.find((m) => m.includes(pref) && !m.includes('2.5'));
        if (picked) break;
      }
      if (!picked) picked = models.find((m) => !m.includes('2.5')) || models[0];
      if (picked) modelName = picked.replace('models/', '');
    } catch (e) {
      // fall through with default modelName
    }

    const geminiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + modelName + ':generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: systemPrompt + '\n\n=== 사용자 질문 ===\n' + question }] }
          ],
          generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
        })
      }
    );
    const geminiJson = await geminiRes.json();
    if (!geminiRes.ok) {
      res.status(502).json({ error: 'Gemini API error', detail: geminiJson });
      return;
    }
    const answer =
      (geminiJson.candidates &&
        geminiJson.candidates[0] &&
        geminiJson.candidates[0].content &&
        geminiJson.candidates[0].content.parts &&
        geminiJson.candidates[0].content.parts[0] &&
        geminiJson.candidates[0].content.parts[0].text) ||
      '답변을 생성하지 못했습니다.';
    res.status(200).json({ answer, model: modelName });
  } catch (e) {
    res.status(500).json({ error: 'Internal error', detail: String(e) });
  }
};
