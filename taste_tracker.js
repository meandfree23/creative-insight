// taste_tracker.js
// 조용한 취향 추적기 (Silent Taste Tracker)
// 사용자가 북마크한 기사(savedArchives)의 빈도를 분석하여 Taste DNA를 생성합니다.

(function() {
    function analyzeTaste() {
        try {
            const saved = JSON.parse(localStorage.getItem('savedArchives') || '[]');
            if (saved.length === 0) return null;
            
            if (!window.allArticlesMap) return null;

            const tagCounts = {};
            const domainCounts = {};
            
            saved.forEach(url => {
                const article = window.allArticlesMap[url];
                if (article) {
                    // 카운트 태그
                    (article.tags || []).forEach(t => {
                        tagCounts[t] = (tagCounts[t] || 0) + 1;
                    });
                    // 카운트 도메인/카테고리
                    const dom = article.domain || article.category || 'ETC';
                    domainCounts[dom] = (domainCounts[dom] || 0) + 1;
                }
            });

            // 정렬 후 상위 추출
            const sortDict = (dict) => Object.entries(dict).sort((a,b) => b[1] - a[1]).map(x => x[0]);
            
            const dna = {
                last_updated: new Date().toISOString(),
                saved_count: saved.length,
                top_tags: sortDict(tagCounts).slice(0, 10),
                top_domains: sortDict(domainCounts).slice(0, 5)
            };
            
            localStorage.setItem('tasteDNA', JSON.stringify(dna));
            return dna;
        } catch (e) {
            console.error("Taste analysis failed:", e);
            return null;
        }
    }

    // 전역 함수로 노출
    window.generateTasteDNA = analyzeTaste;
    window.downloadTasteDNA = function() {
        const dna = analyzeTaste() || JSON.parse(localStorage.getItem('tasteDNA') || 'null');
        if (!dna) {
            alert('아직 저장된(북마크) 취향 데이터가 충분하지 않습니다.');
            return;
        }
        
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dna, null, 2));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", "taste_dna.json");
        dlAnchorElem.click();
    };

    // 북마크 클릭을 감지하기 위해 약간의 지연 후 주기적으로 스캔 (UI 방해 없음)
    setInterval(analyzeTaste, 10000); // 10초마다 갱신
})();

// Sync Modal 헬퍼 함수들 (누락된 기능 복구)
window.openSyncModal = function() {
    const modal = document.getElementById('syncModal');
    if (modal) {
        modal.style.display = 'flex';
    }
};

window.exportSyncCode = function() {
    const saved = localStorage.getItem('savedArchives') || '[]';
    const code = btoa(saved); // 간단한 Base64 인코딩
    document.getElementById('syncCodeInput').value = code;
    document.getElementById('syncMsg').innerText = "코드가 발급되었습니다. 복사해서 다른 기기에 붙여넣으세요.";
};

window.importSyncCode = function() {
    const code = document.getElementById('syncCodeInput').value.trim();
    if (!code) {
        document.getElementById('syncMsg').innerText = "코드를 입력해주세요.";
        return;
    }
    try {
        const decoded = atob(code);
        const arr = JSON.parse(decoded);
        if (Array.isArray(arr)) {
            localStorage.setItem('savedArchives', JSON.stringify(arr));
            document.getElementById('syncMsg').innerText = "동기화 완료! 페이지를 새로고침합니다.";
            setTimeout(() => location.reload(), 1500);
        } else {
            throw new Error("Invalid format");
        }
    } catch (e) {
        document.getElementById('syncMsg').innerText = "유효하지 않은 코드입니다.";
    }
};
