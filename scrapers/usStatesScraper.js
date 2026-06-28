const axios = require('axios');
const levenshtein = require('fast-levenshtein');
const supabase = require('../lib/supabase');

const DELAY_MS = 2000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getSimilarity(a, b) {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein.get(s1, s2) / maxLen;
}

// ── State registry configs ────────────────────────────────────────────────────
//  type: 'api'     → JSON endpoint, use searchAPI()
//  type: 'html'    → server-rendered HTML, use searchHTML()
//  type: 'aspnet'  → ASP.NET WebForms (2-step GET→POST), use searchASPNET()
//  type: 'blocked' → CAPTCHA / login / payment wall — skipped, documented
//  type: 'skip'    → SPA requiring Puppeteer — deferred to next iteration

const STATES = [
  // ── JSON / REST API states ────────────────────────────────────────────────
  {
    code: 'WA', name: 'Washington', type: 'api',
    url: 'https://esos.wa.gov/api/BusinessSearch/SearchByName',
    params: (kw) => ({ name: kw, pageNumber: 1, pageSize: 20 }),
    extract: (json) => (json.businessEntities || []).map(e => ({ name: e.businessName || '', status: e.businessStatusDescription || '' }))
  },
  {
    code: 'CO', name: 'Colorado', type: 'api',
    url: 'https://data.colorado.gov/resource/4ykn-tg5h.json',
    params: (kw) => ({ '$q': kw, '$limit': 50 }),
    extract: (json) => (Array.isArray(json) ? json : []).map(e => ({ name: e.entityname || '', status: e.entitystatus || '' }))
  },
  {
    code: 'TX', name: 'Texas', type: 'api',
    url: 'https://data.texas.gov/resource/9cir-efmm.json',
    params: (kw) => ({ '$q': kw, '$limit': 50 }),
    extract: (json) => (Array.isArray(json) ? json : []).map(e => ({ name: e.taxpayer_name || e.legal_name || '', status: '' }))
  },
  {
    code: 'OR', name: 'Oregon', type: 'api',
    url: 'https://data.oregon.gov/resource/35kw-4x7n.json',
    params: (kw) => ({ '$q': kw, '$limit': 50 }),
    extract: (json) => (Array.isArray(json) ? json : []).map(e => ({ name: e.business_name || e.registry_name || '', status: e.registry_status || '' }))
  },

  // ── Simple HTML GET states ────────────────────────────────────────────────
  {
    code: 'AR', name: 'Arkansas', type: 'html',
    url: 'https://www.ark.org/corp-search/index.php',
    params: (kw) => ({ corp_name: kw, search_type: 'begins' }),
    extract: extractTableNames
  },
  {
    code: 'FL', name: 'Florida', type: 'html',
    method: 'POST',
    url: 'https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults',
    params: (kw) => ({ SearchTerm: kw, SearchType: 'SearchByName', SearchNameOrder: 'STARTS_WITH' }),
    extract: extractTableNames
  },
  {
    code: 'VA', name: 'Virginia', type: 'html',
    url: 'https://cis.scc.virginia.gov/EntitySearch/Index',
    params: (kw) => ({ entityName: kw }),
    extract: extractTableNames
  },
  {
    code: 'NC', name: 'North Carolina', type: 'html',
    url: 'https://www.sosnc.gov/divisions/business_registration/business_registration_basics',
    params: (kw) => ({ SearchTerms: kw }),
    extract: extractTableNames
  },
  {
    code: 'NH', name: 'New Hampshire', type: 'html',
    url: 'https://quickstart.sos.nh.gov/online/BusinessInquire',
    params: (kw) => ({ BusinessName: kw }),
    extract: extractTableNames
  },
  {
    code: 'VT', name: 'Vermont', type: 'html',
    url: 'https://bizfilings.vermont.gov/online/BusinessInquire',
    params: (kw) => ({ BusinessName: kw }),
    extract: extractTableNames
  },
  {
    code: 'NE', name: 'Nebraska', type: 'html',
    url: 'https://www.nebraska.gov/sos/corp/corpsearch.cgi',
    params: (kw) => ({ nav: 'search', searched: 'y', firstname: kw }),
    extract: extractTableNames
  },
  {
    code: 'MN', name: 'Minnesota', type: 'html',
    url: 'https://mblsportal.sos.state.mn.us/Business/Search',
    params: (kw) => ({ SearchValue: kw }),
    extract: extractTableNames
  },
  {
    code: 'HI', name: 'Hawaii', type: 'html',
    url: 'https://hbe.ehawaii.gov/documents/search.html',
    params: (kw) => ({ search: kw }),
    extract: extractTableNames
  },
  {
    code: 'ME', name: 'Maine', type: 'html',
    url: 'https://apps3.web.maine.gov/nei-sos-icrs/ICRS',
    params: (kw) => ({ MainPage: 'x', SearchInput: kw }),
    extract: extractTableNames
  },
  {
    code: 'NJ', name: 'New Jersey', type: 'html',
    url: 'https://www.njportal.com/DOR/BusinessNameSearch/Search/BusinessName',
    params: (kw) => ({ sN: kw }),
    extract: extractTableNames
  },
  {
    code: 'NY', name: 'New York', type: 'html',
    url: 'https://apps.dos.ny.gov/publicInquiry/EntitySearch',
    params: (kw) => ({ entityName: kw, searchType: 'Begins' }),
    extract: extractTableNames
  },
  {
    code: 'OH', name: 'Ohio', type: 'html',
    url: 'https://businesssearch.ohiosos.gov/',
    params: (kw) => ({ searchType: 'STARTS_WITH', searchValue: kw }),
    extract: extractTableNames
  },
  {
    code: 'IL', name: 'Illinois', type: 'html',
    url: 'https://apps.ilsos.gov/businessentitysearch/',
    params: (kw) => ({ search: kw }),
    extract: extractTableNames
  },
  {
    code: 'IN', name: 'Indiana', type: 'html',
    url: 'https://bsd.sos.in.gov/publicbusinesssearch',
    params: (kw) => ({ SearchKeyword: kw }),
    extract: extractTableNames
  },
  {
    code: 'WV', name: 'West Virginia', type: 'html',
    url: 'https://apps.wv.gov/SOS/BusinessEntitySearch/',
    params: (kw) => ({ EntityName: kw }),
    extract: extractTableNames
  },
  {
    code: 'RI', name: 'Rhode Island', type: 'html',
    url: 'https://business.sos.ri.gov/corpweb/trademarksearch/trademarksearch.aspx',
    params: (kw) => ({ txtSearch: kw }),
    extract: extractTableNames
  },
  {
    code: 'MS', name: 'Mississippi', type: 'html',
    url: 'https://corp.sos.ms.gov/corp/portal/c/page/corpBusinessIdSearch/portal.aspx',
    params: (kw) => ({ SearchKeyword: kw }),
    extract: extractTableNames
  },

  // ── ASP.NET WebForms (2-step GET → POST with ViewState) ───────────────────
  {
    code: 'MA', name: 'Massachusetts', type: 'aspnet',
    url: 'https://corp.sec.state.ma.us/corpweb/CorpSearch/CorpSearch.aspx',
    postFields: (kw, vs, ev) => ({
      __VIEWSTATE: vs, __EVENTVALIDATION: ev,
      SearchFld: kw, btnSearch: 'Search'
    }),
    extract: extractTableNames
  },
  {
    code: 'KS', name: 'Kansas', type: 'aspnet',
    url: 'https://www.sos.ks.gov/eforms/BusinessEntity/Search.aspx',
    postFields: (kw, vs, ev) => ({
      __VIEWSTATE: vs, __EVENTVALIDATION: ev,
      txtEntityName: kw, btnSearch: 'Search'
    }),
    extract: extractTableNames
  },
  {
    code: 'KY', name: 'Kentucky', type: 'aspnet',
    url: 'https://sosbes.sos.ky.gov/BusSearchNProfile/search.aspx',
    postFields: (kw, vs, ev) => ({
      __VIEWSTATE: vs, __EVENTVALIDATION: ev,
      txtEntityName: kw, btnSearch: 'Search'
    }),
    extract: extractTableNames
  },
  {
    code: 'MO', name: 'Missouri', type: 'aspnet',
    url: 'https://bsd.sos.mo.gov/BusinessEntity/BESearch.aspx?SearchType=0',
    postFields: (kw, vs, ev) => ({
      __VIEWSTATE: vs, __EVENTVALIDATION: ev,
      txtEntityName: kw, btnSearch: 'Search'
    }),
    extract: extractTableNames
  },
  {
    code: 'OK', name: 'Oklahoma', type: 'aspnet',
    url: 'https://www.sos.ok.gov/corp/corpinquiryfind.aspx',
    postFields: (kw, vs, ev) => ({
      __VIEWSTATE: vs, __EVENTVALIDATION: ev,
      txtEntityName: kw, btnSearch: 'Search'
    }),
    extract: extractTableNames
  },
  {
    code: 'SD', name: 'South Dakota', type: 'aspnet',
    url: 'https://sosenterprise.sd.gov/BusinessServices/Business/FilingSearch.aspx',
    postFields: (kw, vs, ev) => ({
      __VIEWSTATE: vs, __EVENTVALIDATION: ev,
      txtBusName: kw, btnSearch: 'Search'
    }),
    extract: extractTableNames
  },
  {
    code: 'WI', name: 'Wisconsin', type: 'aspnet',
    url: 'https://apps.dfi.wi.gov/apps/corpsearch/search.aspx',
    postFields: (kw, vs, ev) => ({
      __VIEWSTATE: vs, __EVENTVALIDATION: ev,
      SearchEntity: kw, btnSearch: 'Search'
    }),
    extract: extractTableNames
  },
  {
    code: 'AK', name: 'Alaska', type: 'aspnet',
    url: 'https://www.commerce.alaska.gov/cbp/main/search/entities',
    postFields: (kw, vs, ev) => ({
      __VIEWSTATE: vs, __EVENTVALIDATION: ev,
      EntityName: kw, btnSearch: 'Search'
    }),
    extract: extractTableNames
  },

  // ── Puppeteer/SPA states — deferred (document only for now) ──────────────
  { code: 'AL', name: 'Alabama',       type: 'skip',    reason: 'SPA portal, no direct GET' },
  { code: 'AZ', name: 'Arizona',       type: 'skip',    reason: 'Angular SPA (azcc.gov)' },
  { code: 'GA', name: 'Georgia',       type: 'skip',    reason: 'Angular SPA (ecorp.sos.ga.gov)' },
  { code: 'ID', name: 'Idaho',         type: 'skip',    reason: 'React SPA (sosbiz.idaho.gov)' },
  { code: 'MD', name: 'Maryland',      type: 'skip',    reason: 'React SPA (BusinessExpress)' },
  { code: 'MI', name: 'Michigan',      type: 'skip',    reason: 'Angular SPA (LARA portal)' },
  { code: 'MT', name: 'Montana',       type: 'skip',    reason: 'React/Angular SPA (biz.sosmt.gov)' },
  { code: 'NM', name: 'New Mexico',    type: 'skip',    reason: 'Enterprise SPA portal' },
  { code: 'ND', name: 'North Dakota',  type: 'skip',    reason: 'React SPA (firststop.sos.nd.gov)' },
  { code: 'NV', name: 'Nevada',        type: 'skip',    reason: 'SilverFlume SPA (esos.nv.gov)' },
  { code: 'SC', name: 'South Carolina',type: 'skip',    reason: 'Angular SPA (businessfilings.sc.gov)' },
  { code: 'TN', name: 'Tennessee',     type: 'skip',    reason: 'React SPA (tncab.tnsos.gov)' },
  { code: 'UT', name: 'Utah',          type: 'skip',    reason: 'SilverFlume-style SPA' },
  { code: 'CT', name: 'Connecticut',   type: 'skip',    reason: 'Salesforce SPA; Socrata dataset unverified' },
  { code: 'PA', name: 'Pennsylvania',  type: 'skip',    reason: 'Socrata dataset ID unverified' },
  { code: 'CA', name: 'California',    type: 'skip',    reason: 'CALICO API requires free developer key registration' },

  // ── Blocked states ────────────────────────────────────────────────────────
  { code: 'DE', name: 'Delaware',      type: 'blocked', reason: 'CAPTCHA on all automated queries' },
  { code: 'IA', name: 'Iowa',          type: 'blocked', reason: 'Public API costs $2,400/yr; HTML portal needs session tokens' },
  { code: 'LA', name: 'Louisiana',     type: 'blocked', reason: 'CAPTCHA required' },
  { code: 'WY', name: 'Wyoming',       type: 'blocked', reason: 'Restricts API access; session-heavy forms' },
];

// ── Generic HTML table name extractor ────────────────────────────────────────
// Grabs all text from <td> cells — works for most state SOS result tables
function extractTableNames(html) {
  const results = [];
  const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
  let match;
  while ((match = tdPattern.exec(html)) !== null) {
    const text = stripTags(match[1]);
    if (text && text.length > 1 && text.length < 200 && !/^\d+$/.test(text)) {
      results.push({ name: text, status: '' });
    }
  }
  return results;
}

// ── Search handlers ───────────────────────────────────────────────────────────
async function searchAPI(state, keyword) {
  try {
    const { data } = await axios.get(state.url, {
      params: state.params(keyword),
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    return state.extract(data);
  } catch (e) {
    console.log(`[US-STATES] [${state.code}] API error: ${e.message}`);
    return [];
  }
}

async function searchHTML(state, keyword) {
  try {
    const config = {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    };
    let response;
    if (state.method === 'POST') {
      const params = new URLSearchParams(state.params(keyword));
      response = await axios.post(state.url, params.toString(), {
        ...config,
        headers: { ...config.headers, 'Content-Type': 'application/x-www-form-urlencoded' }
      });
    } else {
      response = await axios.get(state.url, { ...config, params: state.params(keyword) });
    }
    return state.extract(response.data);
  } catch (e) {
    console.log(`[US-STATES] [${state.code}] HTML error: ${e.message}`);
    return [];
  }
}

async function searchASPNET(state, keyword) {
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    };

    // Step 1: GET page to extract __VIEWSTATE and __EVENTVALIDATION
    const getResp = await axios.get(state.url, { timeout: 15000, headers });
    const html1 = getResp.data;

    const vsMatch = html1.match(/id="__VIEWSTATE"\s+value="([^"]*)"/);
    const evMatch = html1.match(/id="__EVENTVALIDATION"\s+value="([^"]*)"/);
    const vs = vsMatch ? vsMatch[1] : '';
    const ev = evMatch ? evMatch[1] : '';

    const cookies = (getResp.headers['set-cookie'] || []).join('; ');

    // Step 2: POST with ViewState + search term
    const postData = new URLSearchParams(state.postFields(keyword, vs, ev));
    const postResp = await axios.post(state.url, postData.toString(), {
      timeout: 15000,
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies,
        'Referer': state.url,
      },
      maxRedirects: 5,
    });

    return state.extract(postResp.data);
  } catch (e) {
    console.log(`[US-STATES] [${state.code}] ASP.NET error: ${e.message}`);
    return [];
  }
}

// ── Duplicate check ───────────────────────────────────────────────────────────
async function isDuplicate(filingName, keyword, registry) {
  const { data } = await supabase
    .from('trademark_matches')
    .select('id')
    .eq('filing_name', filingName)
    .eq('matched_keyword', keyword)
    .eq('registry', registry)
    .limit(1);
  return data && data.length > 0;
}

// ── Main scraper ──────────────────────────────────────────────────────────────
async function runUSStatesScraper() {
  console.log('[US-STATES] Starting US state registry scan...');

  // Print blocked/skip report upfront
  const blocked = STATES.filter(s => s.type === 'blocked');
  const skipped = STATES.filter(s => s.type === 'skip');
  console.log(`[US-STATES] Blocked (${blocked.length}): ${blocked.map(s => `${s.code} (${s.reason})`).join(' | ')}`);
  console.log(`[US-STATES] Deferred SPA (${skipped.length}): ${skipped.map(s => s.code).join(', ')}`);

  const { data: logEntry } = await supabase
    .from('scan_logs')
    .insert([{ scan_type: 'trademark', started_at: new Date().toISOString() }])
    .select().single();
  const logId = logEntry?.id;

  const { data: keywords, error: kwError } = await supabase
    .from('keywords').select('*').eq('active', true);
  if (kwError || !keywords?.length) {
    console.log('[US-STATES] No active keywords.');
    return 0;
  }

  const activeStates = STATES.filter(s => ['api', 'html', 'aspnet'].includes(s.type));
  console.log(`[US-STATES] Scanning ${activeStates.length} states × ${keywords.length} keyword(s)...`);

  let totalFound = 0;
  let errorLog = null;
  const stateReport = [];

  for (const state of activeStates) {
    for (const kw of keywords) {
      try {
        let hits = [];
        if (state.type === 'api')    hits = await searchAPI(state, kw.term);
        if (state.type === 'html')   hits = await searchHTML(state, kw.term);
        if (state.type === 'aspnet') hits = await searchASPNET(state, kw.term);

        let stateMatches = 0;
        for (const hit of hits) {
          const name = hit.name || '';
          if (!name || name.length > 200) continue;
          const score = getSimilarity(kw.term, name);
          if (score < 0.8) continue;
          const dup = await isDuplicate(name, kw.term, `US-${state.code}`);
          if (dup) continue;

          await supabase.from('trademark_matches').insert([{
            registry: `US-${state.code}`,
            filing_name: name,
            filing_date: hit.filingDate || null,
            matched_keyword: kw.term,
            similarity_score: score,
            raw_data: hit,
            status: 'new'
          }]);
          totalFound++;
          stateMatches++;
          console.log(`[US-STATES] [${state.code}] Match: "${name}" (${score.toFixed(2)})`);
        }

        stateReport.push({ state: state.code, keyword: kw.term, results: hits.length, matches: stateMatches, status: 'ok' });
        console.log(`[US-STATES] [${state.code}] "${kw.term}" → ${hits.length} results, ${stateMatches} match(es)`);

      } catch (e) {
        stateReport.push({ state: state.code, keyword: kw.term, results: 0, matches: 0, status: `error: ${e.message}` });
        errorLog = e.message;
      }

      await sleep(DELAY_MS);
    }
  }

  // Print final report
  console.log('\n[US-STATES] ── FINAL REPORT ─────────────────────────');
  console.log('[US-STATES] State | Keyword | Results | Matches | Status');
  stateReport.forEach(r =>
    console.log(`[US-STATES] ${r.state.padEnd(5)} | ${r.keyword.padEnd(10)} | ${String(r.results).padEnd(8)} | ${String(r.matches).padEnd(8)} | ${r.status}`)
  );
  console.log(`[US-STATES] ── Total new matches: ${totalFound} ────────────────`);

  if (logId) {
    await supabase.from('scan_logs').update({
      completed_at: new Date().toISOString(),
      total_found: totalFound,
      error_log: errorLog
    }).eq('id', logId);
  }

  return totalFound;
}

module.exports = { runUSStatesScraper };
