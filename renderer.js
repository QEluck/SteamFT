// 元素引用
const $ = (id) => document.getElementById(id);
const apiKey = $('apiKey');
const steamId = $('steamId');
const intervalMin = $('intervalMin');
const fSummary = $('fSummary');
const fOwned = $('fOwned');
const fRecent = $('fRecent');
const btnFetch = $('btnFetch');
const btnStart = $('btnStart');
const btnStop = $('btnStop');
const btnSave = $('btnSave');
const configMsg = $('configMsg');
const errorMsg = $('errorMsg');
const monitorStatus = $('monitorStatus');
const lastUpdate = $('lastUpdate');

// 在线状态映射
const STATE_MAP = {
  0: '离线',
  1: '在线',
  2: '忙碌',
  3: '离开',
  4: '休眠',
  5: '期待交易',
  6: '期待游玩'
};

// 从表单读取配置
function readConfig() {
  return {
    apiKey: apiKey.value.trim(),
    steamId: steamId.value.trim(),
    intervalMin: Math.max(1, parseInt(intervalMin.value) || 5),
    features: {
      summary: fSummary.checked,
      ownedGames: fOwned.checked,
      recentGames: fRecent.checked
    }
  };
}

// 将配置回填到表单
function fillConfig(cfg) {
  apiKey.value = cfg.apiKey || '';
  steamId.value = cfg.steamId || '';
  intervalMin.value = cfg.intervalMin || 5;
  fSummary.checked = !!cfg.features?.summary;
  fOwned.checked = !!cfg.features?.ownedGames;
  fRecent.checked = !!cfg.features?.recentGames;
}

function setMsg(text, ok = true) {
  configMsg.textContent = text;
  configMsg.className = 'msg ' + (ok ? 'ok' : 'err');
  setTimeout(() => { configMsg.textContent = ''; configMsg.className = 'msg'; }, 3000);
}

function showError(msg) {
  errorMsg.textContent = '错误：' + msg;
  errorMsg.classList.remove('hidden');
  monitorStatus.className = 'badge badge-err';
  monitorStatus.textContent = '错误';
}
function clearError() {
  errorMsg.classList.add('hidden');
  errorMsg.textContent = '';
}

// 分钟 -> 可读时长
function fmtMinutes(min) {
  min = Math.round(min);
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d} 天 ${hh} 小时` : `${d} 天`;
}

function fmtTimestamp(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('zh-CN');
}

// 渲染玩家信息
function renderSummary(s) {
  const sec = $('summarySection');
  if (!s) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  const stateText = STATE_MAP[s.personastate] ?? `未知 (${s.personastate})`;
  const stateColor = s.personastate === 0 ? '#8f98a0' : '#a3d36b';
  let html = `
    <div class="player">
      <img src="${s.avatarfull || s.avatar || ''}" alt="avatar" />
      <div>
        <div class="pname">${escapeHtml(s.personaname || '')}</div>
        <div class="pstate" style="color:${stateColor}">状态：${stateText}</div>
        ${s.realname ? `<div class="pstate">真实姓名：${escapeHtml(s.realname)}</div>` : ''}
        ${s.timecreated ? `<div class="pstate">账号创建：${fmtTimestamp(s.timecreated * 1000)}</div>` : ''}
        ${s.lastlogoff ? `<div class="pstate">上次离线：${fmtTimestamp(s.lastlogoff * 1000)}</div>` : ''}
        ${s.profileurl ? `<a class="plink" href="${s.profileurl}" target="_blank">查看 Steam 主页 →</a>` : ''}
      </div>
    </div>`;
  $('summaryContent').innerHTML = html;
}

// 渲染拥有的游戏
function renderOwnedGames(o, delta) {
  const sec = $('ownedSummarySection');
  if (!o) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  $('statTotalGames').textContent = o.totalCount ?? '—';
  $('statTotalTime').textContent = fmtMinutes(o.totalMinutes || 0);

  // 渲染增量统计与增量排行
  renderDelta(delta);

  const list = $('ownedList');
  const keyword = ($('ownedFilter').value || '').trim().toLowerCase();
  const games = keyword
    ? o.games.filter(g => (g.name || '').toLowerCase().includes(keyword))
    : o.games;

  // appid -> 增量信息，便于在游戏项里标注
  const deltaMap = {};
  if (delta && delta.games) {
    for (const d of delta.games) deltaMap[d.appid] = d;
  }

  if (!games.length) {
    list.innerHTML = '<div class="muted">无匹配的游戏</div>';
    return;
  }
  list.innerHTML = games.map(g => {
    const d = deltaMap[g.appid];
    const deltaTag = d
      ? `<span class="delta-tag">+${fmtMinutes(d.delta)}${d.isNew ? ' 新入库' : ''}</span>`
      : '';
    return `
    <div class="game-item">
      <div class="gname">${escapeHtml(g.name || '(未命名)')} ${deltaTag}</div>
      <div class="gtime">总时长：<strong>${fmtMinutes(g.playtimeForever || 0)}</strong></div>
      ${g.playtime2weeks ? `<div class="gtime">近两周：${fmtMinutes(g.playtime2weeks)}</div>` : ''}
    </div>`;
  }).join('');
}

// 渲染增量统计卡片 + 增量排行
function renderDelta(delta) {
  const statDelta = $('statDelta');
  const statDeltaLabel = $('statDeltaLabel');
  const rank = $('deltaRank');
  const rankList = $('deltaRankList');

  if (!delta) {
    // 首次监控，没有快照可对比
    statDelta.textContent = '—';
    statDeltaLabel.textContent = '首次监控，暂无对比';
    rank.classList.add('hidden');
    rankList.innerHTML = '';
    return;
  }

  statDelta.textContent = '+' + fmtMinutes(delta.totalDelta || 0);
  const lastTime = delta.lastSnapshotTime ? fmtTimestamp(delta.lastSnapshotTime) : '—';
  statDeltaLabel.textContent = `比上次增加（上次：${lastTime}）`;

  if (delta.games && delta.games.length) {
    rank.classList.remove('hidden');
    const top = delta.games.slice(0, 8);
    rankList.innerHTML = top.map(d => `
      <div class="delta-item">
        <span class="dname">${escapeHtml(d.name || '(未命名)')}${d.isNew ? ' <em>(新入库)</em>' : ''}</span>
        <span class="ddelta">+${fmtMinutes(d.delta)}</span>
      </div>`).join('');
  } else {
    rank.classList.add('hidden');
    rankList.innerHTML = '';
  }
}

// 渲染最近游戏
function renderRecent(r) {
  const sec = $('recentSection');
  if (!r) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  $('statRecentCount').textContent = r.totalCount ?? '—';
  const list = $('recentList');
  if (!r.games?.length) {
    list.innerHTML = '<div class="muted">近 2 周没有游戏记录</div>';
    return;
  }
  list.innerHTML = r.games.map(g => `
    <div class="game-item">
      <div class="gname">${escapeHtml(g.name || '(未命名)')}</div>
      <div class="gtime">近两周：<strong>${fmtMinutes(g.playtime2weeks || 0)}</strong></div>
      <div class="gtime">总时长：${fmtMinutes(g.playtimeForever || 0)}</div>
    </div>`).join('');
}

// 渲染数据
function renderData(data) {
  clearError();
  if (data.summaryError) {
    showError('玩家信息获取失败：' + data.summaryError);
  } else {
    renderSummary(data.summary);
  }
  if (data.ownedGamesError) {
    showError('拥有的游戏获取失败：' + data.ownedGamesError);
  } else {
    renderOwnedGames(data.ownedGames, data.delta);
  }
  if (data.recentGamesError) {
    showError('最近游戏获取失败：' + data.recentGamesError);
  } else {
    renderRecent(data.recentGames);
  }
  lastUpdate.textContent = '最后更新：' + fmtTimestamp(data.timestamp);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 设置监控 UI 状态
function setMonitoringUI(on) {
  if (on) {
    monitorStatus.className = 'badge badge-on';
    monitorStatus.textContent = '监控中';
    btnStart.disabled = true;
    btnStop.disabled = false;
  } else {
    monitorStatus.className = 'badge badge-off';
    monitorStatus.textContent = '未启动';
    btnStart.disabled = false;
    btnStop.disabled = true;
  }
}

// 事件绑定
btnSave.addEventListener('click', async () => {
  const ok = await window.api.saveConfig(readConfig());
  setMsg(ok ? '配置已保存' : '保存失败', ok);
});

btnFetch.addEventListener('click', async () => {
  const cfg = readConfig();
  if (!cfg.apiKey || !cfg.steamId) {
    setMsg('请先填写 API Key 和 Steam ID', false);
    return;
  }
  if (!cfg.features.summary && !cfg.features.ownedGames && !cfg.features.recentGames) {
    setMsg('请至少选择一个功能', false);
    return;
  }
  btnFetch.disabled = true;
  btnFetch.textContent = '获取中...';
  try {
    const data = await window.api.fetchOnce(cfg);
    renderData(data);
  } catch (e) {
    showError(e.message);
  } finally {
    btnFetch.disabled = false;
    btnFetch.textContent = '立即获取一次';
  }
});

btnStart.addEventListener('click', async () => {
  const cfg = readConfig();
  if (!cfg.apiKey || !cfg.steamId) {
    setMsg('请先填写 API Key 和 Steam ID', false);
    return;
  }
  if (!cfg.features.summary && !cfg.features.ownedGames && !cfg.features.recentGames) {
    setMsg('请至少选择一个功能', false);
    return;
  }
  await window.api.startMonitor(cfg);
  setMonitoringUI(true);
  setMsg('监控已启动，每 ' + cfg.intervalMin + ' 分钟刷新', true);
});

btnStop.addEventListener('click', async () => {
  await window.api.stopMonitor();
  setMonitoringUI(false);
  setMsg('监控已停止', true);
});

// 游戏列表过滤
$('ownedFilter').addEventListener('input', () => {
  // 若已渲染过，则触发重渲染（保存上一次 owned 数据和增量）
  if (lastOwnedData) renderOwnedGames(lastOwnedData, lastDelta);
});

let lastOwnedData = null;
let lastDelta = null;
const _renderOwned = renderOwnedGames;
renderOwnedGames = function (o, delta) {
  lastOwnedData = o;
  lastDelta = delta || null;
  _renderOwned(o, delta);
};

// 接收主进程推送
window.api.onData((data) => {
  renderData(data);
  setMonitoringUI(true);
  // 每次拉取都刷新历史下拉列表
  loadHistoryList();
});
window.api.onError((msg) => {
  showError(msg);
});

// ============ 历史对比 ============
const histFrom = $('histFrom');
const histTo = $('histTo');
const histCount = $('histCount');
const compareResult = $('compareResult');

async function loadHistoryList() {
  let list = [];
  try { list = await window.api.listHistory(); } catch (e) { return; }
  // 倒序显示（最新在前）
  const sorted = [...list].sort((a, b) => b.timestamp - a.timestamp);
  const opt = (r) =>
    `<option value="${escapeHtml(r.id)}">${fmtTimestamp(r.timestamp)} · ${fmtMinutes(r.totalMinutes || 0)} · ${r.gameCount} 款</option>`;
  const empty = '<option value="">（无历史）</option>';
  histFrom.innerHTML = sorted.length ? sorted.map(opt).join('') : empty;
  histTo.innerHTML   = sorted.length ? sorted.map(opt).join('') : empty;
  histCount.textContent = list.length ? `共 ${list.length} 条历史记录` : '暂无历史记录';
  // 默认：to=最新，from=倒数第二条（若存在）
  if (sorted.length >= 1) histTo.selectedIndex = 0;
  if (sorted.length >= 2) histFrom.selectedIndex = 1; else histFrom.selectedIndex = 0;
}

$('btnRefreshHist').addEventListener('click', loadHistoryList);

$('btnClearHist').addEventListener('click', async () => {
  if (!confirm('确定清空所有历史记录？此操作不可撤销。')) return;
  await window.api.clearHistory();
  await loadHistoryList();
  compareResult.innerHTML = '';
});

$('btnCompare').addEventListener('click', async () => {
  const a = histFrom.value, b = histTo.value;
  if (!a || !b) { compareResult.innerHTML = '<div class="muted">请选择两个时间点</div>'; return; }
  if (a === b) { compareResult.innerHTML = '<div class="muted">选择了相同的时间点，无法对比</div>'; return; }
  $('btnCompare').disabled = true;
  $('btnCompare').textContent = '对比中...';
  try {
    const cmp = await window.api.compareHistory(a, b);
    renderCompareResult(cmp);
  } catch (e) {
    compareResult.innerHTML = `<div class="msg err">对比失败：${escapeHtml(e.message)}</div>`;
  } finally {
    $('btnCompare').disabled = false;
    $('btnCompare').textContent = '对比';
  }
});

function renderCompareResult(cmp) {
  if (!cmp || cmp.error) {
    compareResult.innerHTML = `<div class="muted">${cmp ? cmp.error : '无结果'}</div>`;
    return;
  }
  const fromT = fmtTimestamp(cmp.from.timestamp);
  const toT   = fmtTimestamp(cmp.to.timestamp);
  const totalDelta = cmp.totalDelta || 0;
  const playedDelta = cmp.playedDelta || 0;
  let html = `
    <div class="cmp-meta">
      <div><span class="muted">从</span> <strong>${fromT}</strong> · ${fmtMinutes(cmp.from.totalMinutes || 0)} · ${cmp.from.gameCount} 款</div>
      <div><span class="muted">到</span> <strong>${toT}</strong> · ${fmtMinutes(cmp.to.totalMinutes || 0)} · ${cmp.to.gameCount} 款</div>
    </div>
    <div class="cmp-stats">
      <div class="cmp-stat"><div class="cmp-stat-val">${totalDelta >= 0 ? '+' : ''}${fmtMinutes(totalDelta)}</div><div class="cmp-stat-label">总时长变化</div></div>
      <div class="cmp-stat"><div class="cmp-stat-val">+${fmtMinutes(playedDelta)}</div><div class="cmp-stat-label">实际增加</div></div>
      <div class="cmp-stat"><div class="cmp-stat-val">${cmp.games.length}</div><div class="cmp-stat-label">有增量的游戏</div></div>
      <div class="cmp-stat"><div class="cmp-stat-val">${cmp.removed.length}</div><div class="cmp-stat-label">不再拥有</div></div>
    </div>
  `;
  if (cmp.games.length) {
    html += `<h3>增量排行（前 12）</h3><div class="delta-list">`;
    html += cmp.games.slice(0, 12).map(d => `
      <div class="delta-item">
        <span class="dname">${escapeHtml(d.name || '(未命名)')}${d.isNew ? ' <em>(新入库)</em>' : ''}</span>
        <span class="ddelta">+${fmtMinutes(d.delta)}</span>
      </div>`).join('');
    html += `</div>`;
  } else {
    html += `<div class="muted">该时间段内没有游戏时长增加</div>`;
  }
  if (cmp.removed.length) {
    html += `<h3>不再拥有的游戏（${cmp.removed.length}，前 12）</h3><div class="delta-list">`;
    html += cmp.removed.slice(0, 12).map(d => `
      <div class="delta-item">
        <span class="dname">${escapeHtml(d.name || '(未命名)')}</span>
        <span class="ddelta" style="color:#8f98a0">曾有 ${fmtMinutes(d.pt)}</span>
      </div>`).join('');
    html += `</div>`;
  }
  compareResult.innerHTML = html;
}

// 初始化：加载配置
(async function init() {
  const cfg = await window.api.loadConfig();
  fillConfig(cfg);
  setMonitoringUI(false);
  // 启动时加载一次历史列表
  loadHistoryList();
})();
