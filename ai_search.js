
window.lastAIPicks = [];

function scrapAIArticle(index) {
  const pick = window.lastAIPicks[index];
  if (!pick) return;
  if (!confirm("이 기사를 내 아카이브에 영구 저장하시겠습니까?")) return;
  
  let articles = [];
  try {
    articles = JSON.parse(localStorage.getItem('scraped_ai_articles') || '[]');
  } catch(e) {}
  
  if (!articles.find(a => a.url === pick.url)) {
    pick.scrapedAt = new Date().toISOString();
    pick.category = pick.category || "AI 딥서치";
    articles.push(pick);
    localStorage.setItem('scraped_ai_articles', JSON.stringify(articles));
    alert("아카이브에 저장되었습니다! 상단 '♥ MY ARCHIVE' 탭에서 확인하세요.");
  } else {
    alert("이미 저장된 기사입니다.");
  }
}

// AI Deep Search Logic with Deep Trawling, Multi-Language, and JP Domains

const BASE_TRACKED_DOMAINS = [
  "creativereview.co.uk", "filmshortage.com", "creativeboom.com", "graymonster.tistory.com", "hubbardbirchler.net", 
  "thecreativeindependent.com", "directorslibrary.com", "thestylewatcher.wordpress.com", "wepresent.wetransfer.com", 
  "andrew-townsend.com", "promonews.tv", "silvanderwoerd.com", "stashmedia.tv", "dailymotion.com", 
  "anothermag.com", "photoeditions.pub", "smadani.com", "nowness.com", "maxgoldmandp.com", "designspotter.com", 
  "thenationalgrid.com.au", "uglyd.com", "itsnicethat.com", "juxtapoz.com", "opendoors.gallery", 
  "honestart.tistory.com", "strba.ch", "designtwoply.com", "levineleavitt.com", "filmmakermagazine.com", 
  "cheimread.com", "vimeo.com", "motionographer.com", "abduzeedo.com", "hypebeast.kr", "adim21.co.kr", 
  "ignant.com", "lensculture.com", "coolhunting.com", "architecturaldigest.com",
  // Japanese Deep Insight Domains
  "tokyoartbeat.com", "spoon-tamago.com", "cinra.net", "bijutsutecho.com", 
  "architecturephoto.net", "japandesign.ne.jp", "pen-online.com"
];

const BLACKLIST_DOMAINS = [
  "wikipedia.org", "youtube.com", "facebook.com", "twitter.com", "x.com", "instagram.com", 
  "pinterest.com", "linkedin.com", "reddit.com", "tiktok.com", "naver.com", "daum.net", 
  "tistory.com", "yahoo.com", "amazon.com", "google.com", "apple.com"
];

function getCustomDomains() {
  try {
    return JSON.parse(localStorage.getItem('custom_tracked_domains') || '[]');
  } catch(e) { return []; }
}

function addCustomDomain(urlStr) {
  try {
    const url = new URL(urlStr);
    let domain = url.hostname.replace(/^www\./, '');
    if (BLACKLIST_DOMAINS.some(b => domain.endsWith(b))) return false;
    
    let custom = getCustomDomains();
    if (!BASE_TRACKED_DOMAINS.includes(domain) && !custom.includes(domain)) {
      custom.push(domain);
      localStorage.setItem('custom_tracked_domains', JSON.stringify(custom));
      console.log("새로운 고품질 매체가 엔진에 등록되었습니다: " + domain);
      return true;
    }
  } catch(e) { /* invalid url */ }
  return false;
}

function openSettings() {
  document.getElementById('settingsModal').style.display = 'flex';
  document.getElementById('openaiKeyInput').value = localStorage.getItem('openai_api_key') || '';
  document.getElementById('tavilyKeyInput').value = localStorage.getItem('tavily_api_key') || '';
}

function closeSettings() {
  document.getElementById('settingsModal').style.display = 'none';
}

function saveSettings() {
  localStorage.setItem('openai_api_key', document.getElementById('openaiKeyInput').value.trim());
  localStorage.setItem('tavily_api_key', document.getElementById('tavilyKeyInput').value.trim());
  closeSettings();
  alert('API 키가 브라우저에 안전하게 저장되었습니다!');
}

async function performAIDeepSearch() {
  const kw = currentSearchKeyword;
  if (!kw) return;

  const openaiKey = localStorage.getItem('openai_api_key');
  const tavilyKey = localStorage.getItem('tavily_api_key');

  if (!openaiKey || !tavilyKey) {
    alert('AI 검색을 위해 먼저 설정(우측 상단 ⚙️)에서 OpenAI 및 Tavily API 키를 모두 입력해주세요.');
    openSettings();
    return;
  }

  const container = document.getElementById('aiSearchContainer');
  const btn = document.getElementById('aiSearchBtn');
  const loader = document.getElementById('aiSearchLoader');
  const status = document.getElementById('aiSearchStatus');

  btn.style.display = 'none';
  loader.style.display = 'block';

  try {
    // 1. 다국어 자동 치환 및 국적 추론 (Query Expansion)
    status.innerText = "🌍 글로벌 딥서치를 위해 대상의 국적을 유추하고 검색어를 최적화 중입니다...";
    const expSys = `You are a multilingual AI assistant. Your task is to analyze the search query, determine its subject's nationality or origin, and expand the query to include its English translation AND its Native Language spelling.
Format the output as a clean, natural space-separated string of the keywords to maximize AI search engine results. Do NOT use OR operators or quotes.
Example 1: 장 뤽 고다르
Output 1: 장 뤽 고다르 Jean-Luc Godard
Example 2: 안도 다다오
Output 2: 안도 다다오 Tadao Ando 安藤忠雄
Example 3: 알바 알토
Output 3: 알바 알토 Alvar Aalto
Example 4: 핀 율
Output 4: 핀 율 Finn Juhl
Example 5: 파리 올림픽 디자인
Output 5: 파리 올림픽 디자인 Paris Olympics Design Design des Jeux Olympiques de Paris`;

    const expRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: expSys },
          { role: "user", content: kw }
        ]
      })
    });
    
    const expData = await expRes.json();
    let expandedKw = kw;
    if (expData.choices && expData.choices.length > 0) {
      expandedKw = expData.choices[0].message.content.trim();
    }
    console.log("최적화된 딥트롤링 검색어:", expandedKw);

    const allTrackedDomains = BASE_TRACKED_DOMAINS.concat(getCustomDomains());
    status.innerText = `🔍 1차 저인망 서치: 지정된 ${allTrackedDomains.length}개 매체를 샅샅이 뒤집니다...`;
    
    // 2. 1차 딥서치 (최대 20개)
    let tvlyRes1 = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavilyKey,
        query: expandedKw,
        include_domains: allTrackedDomains,
        search_depth: "advanced",
        include_images: true,
        max_results: 20
      })
    });
    let tvlyData1 = await tvlyRes1.json();
    let mergedResults = tvlyData1.results || [];
    
    // 3. 2차 글로벌 딥서치 조건부 실행 (1차 결과가 5개 미만이면 무조건 발동)
    if (mergedResults.length < 5) {
      status.innerText = `🌐 자료가 부족합니다(${mergedResults.length}건). 전 세계 웹을 향해 2차 저인망을 펼칩니다...`;
      
      let tvlyRes2 = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: expandedKw,
          search_depth: "advanced",
          include_images: true,
          max_results: 20
        })
      });
      let tvlyData2 = await tvlyRes2.json();
      let globalResults = tvlyData2.results || [];
      
      // 도메인 추출 및 자동 확장 (2차 검색 결과에서만)
      let addedCount = 0;
      globalResults.forEach(r => {
        if(addCustomDomain(r.url)) addedCount++;
      });
      if (addedCount > 0) {
        console.log(`새롭게 발견한 ${addedCount}개의 매체를 엔진에 편입했습니다.`);
      }

      // 결과 병합 (Merge) 및 중복 제거
      const seenUrls = new Set(mergedResults.map(r => r.url));
      globalResults.forEach(r => {
        if (!seenUrls.has(r.url)) {
          mergedResults.push(r);
          seenUrls.add(r.url);
        }
      });
    }

    if (mergedResults.length === 0) {
      status.innerText = "😭 전 세계 딥웹을 모두 뒤졌지만 관련 기사를 찾지 못했습니다.";
      return;
    }
    
    status.innerText = `🧠 딥트롤링 완료! 총 ${mergedResults.length}개의 원문 기사를 OpenAI가 선별 및 번역 중입니다...`;

    // 4. OpenAI 큐레이션
    const articles = mergedResults.map(r => `Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`).join('\n\n---\n\n');
    
    const sysPrompt = `You are a high-end creative editor. Review the provided search results and select the best ones (up to 6) to curate.
Format the output EXACTLY as a JSON object with a single key "topPicks" containing an array of objects.
Each object MUST have:
- title_ko: Catchy Korean title
- title: Original title (can be Japanese, English etc)
- summary: 2-3 sentence summary in Korean focusing on creative value
- why: Why is this inspiring? (in Korean, ending with ~점.)
- tags: Array of 3-5 Korean tags (e.g. ["사진", "건축"])
- url: Original URL
- creator_name: Name of artist/studio/brand (English or Native language)
- image_url: Image URL from the search result (if available)

Input Search Results:
${articles}`;

    const oaRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: sysPrompt }]
      })
    });

    const oaData = await oaRes.json();
    if (oaData.error) throw new Error(oaData.error.message);
    
    const curation = JSON.parse(oaData.choices[0].message.content);
    window.lastAIPicks = curation.topPicks;
    
    status.innerText = "✨ 방대한 자료 큐레이션 완료! 결과를 화면에 표시합니다.";
    renderAIResults(curation.topPicks);
    loader.style.display = 'none';

  } catch (err) {
    status.innerText = `❌ 오류 발생: ${err.message}`;
    console.error(err);
  }
}

function renderAIResults(picks) {
  let h = '<h3 style="margin:40px 40px 20px; font-size:16px; font-weight:700; color:var(--acc);">✨ AI 실시간 딥트롤링(Deep-Trawling) 큐레이션</h3>';
  h += '<div class="picks" style="margin-top:0;">';
  
  picks.forEach(function(p, i) {
    h += `<div class="pick" style="animation-delay:${i*0.1}s" onclick="window.open('${p.url}', '_blank')">`;
    if (p.image_url) {
      h += `<div class="pick-img-wrap"><img src="${p.image_url}" alt="image" onerror="this.parentElement.style.display='none'">`;
      h += `<div class="pick-img-overlay"><div class="overlay-text">READ ARTICLE</div></div></div>`;
    }
    h += `<div class="pick-meta">`;
    h += `<span class="pick-src">AI CURATED</span>`;
    h += `<span class="pick-date">JUST NOW</span>`;
    h += `</div>`;
    h += `<div class="pick-ko">${p.title_ko}</div>`;
    h += `<div style="font-size:11px; color:var(--dim); font-weight:500; font-family:'Playfair Display',serif;">${p.title}</div>`;
    if (p.creator_name) h += `<div style="font-size:10px; font-weight:600; margin-top:4px; text-transform:uppercase;">BY ${p.creator_name}</div>`;
    h += `<div class="pick-why">${p.why}</div>`;
    h += `<div style="font-size:12px; color:var(--text); line-height:1.6; margin-top:12px; opacity:0.8;">${p.summary}</div>`;
    if (p.tags && p.tags.length > 0) {
      h += `<div class="pick-bot">` + p.tags.map(t=>`<span class="chip">#${t}</span>`).join('') + `</div>`;
    }
    h += `<div style="margin-top:16px; padding-top:16px; border-top:1px solid rgba(0,0,0,0.05); text-align:right;"><button onclick="event.stopPropagation(); scrapAIArticle(${i})" style="padding:6px 12px; background:#f0f0f0; color:#333; border:none; border-radius:4px; font-size:11px; font-weight:700; cursor:pointer; transition:0.2s;" onmouseover="this.style.background='#ff3366'; this.style.color='#fff'" onmouseout="this.style.background='#f0f0f0'; this.style.color='#333'">❤️ 스크랩하기</button></div>`;
    h += `</div>`;
  });
  
  h += '</div>';
  
  const container = document.getElementById('aiSearchContainer');
  container.innerHTML = h;
}
