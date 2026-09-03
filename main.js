const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

let mainWindow;
let timer = null;

// 配置文件路径
const configPath = path.join(app.getPath('userData'), 'config.json');
// 快照文件路径（记录上一次监控时的游戏时长，用于增量对比）
const snapshotPath = path.join(app.getPath('userData'), 'snapshot.json');

// 默认配置
const defaultConfig = {
  apiKey: '',
  steamId: '',
  intervalMin: 5,
  features: {
    summary: true,        // 玩家信息 & 在线状态
    ownedGames: true,     // 拥有的游戏 & 总时长
    recentGames: true     // 最近玩的游戏
  }
};

// 读取配置
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const cfg = JSON.parse(data);
      // 合并默认值，防止字段缺失
      return {
        ...defaultConfig,
        ...cfg,
        features: { ...defaultConfig.features, ...(cfg.features || {}) }
      };
    }
  } catch (e) {
    console.error('读取配置失败:', e);
  }
  return { ...defaultConfig };
}

// 保存配置
function saveConfig(cfg) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('保存配置失败:', e);
    return false;
  }
}

// 读取上次快照（appid -> { name, playtimeForever }）
function loadSnapshot() {
  try {
    if (fs.existsSync(snapshotPath)) {
      return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    }
  } catch (e) {
    console.error('读取快照失败:', e);
  }
  return null;
}

// 保存当前数据为新快照
function saveSnapshot(snap) {
  try {
    fs.writeFileSync(snapshotPath, JSON.stringify(snap, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存快照失败:', e);
  }
}

// 计算当前数据相对上次快照的增量
function computeDelta(current, lastSnap) {
  if (!lastSnap || !current.ownedGames) return null;
  const lastGames = lastSnap.games || {};
  const deltaGames = [];
  let playedDelta = 0;
  for (const g of current.ownedGames.games) {
    const last = lastGames[g.appid];
    let d = 0;
    let isNew = false;
    if (last) {
      d = (g.playtimeForever || 0) - (last.playtimeForever || 0);
    } else {
      // 上次快照里没有的游戏，整个时长算作新增
      d = g.playtimeForever || 0;
      isNew = true;
    }
    if (d > 0) {
      deltaGames.push({ appid: g.appid, name: g.name, delta: d, isNew });
      playedDelta += d;
    }
  }
  const totalDelta = (current.ownedGames.totalMinutes || 0) - (lastSnap.totalMinutes || 0);
  return {
    lastSnapshotTime: lastSnap.timestamp || null,
    totalDelta,                                  // 总时长增量（分钟）
    playedDelta,                                 // 实际有记录的增量（分钟）
    games: deltaGames.sort((a, b) => b.delta - a.delta)
  };
}

// 用当前拉取的数据更新快照
function updateSnapshot(data) {
  if (!data.ownedGames) return;
  const snap = {
    timestamp: data.timestamp,
    totalMinutes: data.ownedGames.totalMinutes,
    games: {}
  };
  for (const g of data.ownedGames.games) {
    snap.games[g.appid] = { name: g.name, playtimeForever: g.playtimeForever };
  }
  saveSnapshot(snap);
}

// ============ 历史记录（保存每次拉取的完整数据，便于任意对比） ============
const historyPath = path.join(app.getPath('userData'), 'history.json');
const HISTORY_LIMIT = 500;  // 最多保留多少条历史

function loadHistory() {
  try {
    if (fs.existsSync(historyPath)) {
      const obj = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      return { records: Array.isArray(obj.records) ? obj.records : [] };
    }
  } catch (e) {
    console.error('读取历史失败:', e);
  }
  return { records: [] };
}

function saveHistory(hist) {
  try {
    fs.writeFileSync(historyPath, JSON.stringify(hist, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存历史失败:', e);
  }
}

// 把当前一次拉取的数据追加为一条历史记录
function appendHistory(data) {
  if (!data.ownedGames) return;
  const hist = loadHistory();
  const games = {};
  for (const g of data.ownedGames.games) {
    games[g.appid] = { name: g.name, pt: g.playtimeForever };
  }
  hist.records.push({
    id: String(data.timestamp),
    timestamp: data.timestamp,
    totalMinutes: data.ownedGames.totalMinutes,
    gameCount: data.ownedGames.games.length,
    games
  });
  // 超过上限则丢弃最早记录
  if (hist.records.length > HISTORY_LIMIT) {
    hist.records = hist.records.slice(hist.records.length - HISTORY_LIMIT);
  }
  saveHistory(hist);
}

// 对比两条历史记录，返回详细增量
function compareHistory(idFrom, idTo) {
  const hist = loadHistory();
  const recFrom = hist.records.find(r => r.id === idFrom);
  const recTo = hist.records.find(r => r.id === idTo);
  if (!recFrom || !recTo) return { error: '找不到指定的历史记录' };

  // 保证时间顺序：把较早的放 from
  let from = recFrom, to = recTo;
  if (from.timestamp > to.timestamp) { [from, to] = [to, from]; }

  const deltaGames = [];
  let playedDelta = 0;
  for (const appid of Object.keys(to.games)) {
    const g = to.games[appid];
    const last = from.games[appid];
    let d = 0;
    let isNew = false;
    if (last) {
      d = (g.pt || 0) - (last.pt || 0);
    } else {
      d = g.pt || 0;
      isNew = true;
    }
    if (d > 0) {
      deltaGames.push({ appid, name: g.name, delta: d, isNew });
      playedDelta += d;
    }
  }
  // 已不再拥有的游戏（from 有，to 没有）
  const removed = [];
  for (const appid of Object.keys(from.games)) {
    if (!to.games[appid]) {
      removed.push({ appid, name: from.games[appid].name, pt: from.games[appid].pt });
    }
  }
  const totalDelta = (to.totalMinutes || 0) - (from.totalMinutes || 0);
  return {
    from: { id: from.id, timestamp: from.timestamp, totalMinutes: from.totalMinutes, gameCount: from.gameCount },
    to:   { id: to.id,   timestamp: to.timestamp,   totalMinutes: to.totalMinutes,   gameCount: to.gameCount },
    totalDelta,
    playedDelta,
    games: deltaGames.sort((a, b) => b.delta - a.delta),
    removed
  };
}

// HTTP GET 请求封装
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          // 非 JSON 响应
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    }).on('error', (err) => reject(err));
  });
}

// 调用 Steam API
async function fetchSteamData(cfg) {
  const { apiKey, steamId, features } = cfg;
  if (!apiKey) throw new Error('未配置 Steam API Key');
  if (!steamId) throw new Error('未配置 Steam ID');

  const result = { timestamp: Date.now() };

  // 1. 玩家信息 & 在线状态
  if (features.summary) {
    try {
      const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`;
      const resp = await httpGet(url);
      if (resp.statusCode === 200 && resp.body?.response?.players?.length) {
        const p = resp.body.response.players[0];
        result.summary = {
          personaname: p.personaname,
          profileurl: p.profileurl,
          avatar: p.avatar,
          avatarfull: p.avatarfull,
          personastate: p.personastate,            // 0=离线, 1=在线, 2=忙碌, 3=离开, 4= snooze, 5=Looking to trade, 6=Looking to play
          lastlogoff: p.lastlogoff,
          realname: p.realname || '',
          primaryclanid: p.primaryclanid || '',
          timecreated: p.timecreated
        };
      } else {
        result.summaryError = `HTTP ${resp.statusCode}`;
      }
    } catch (e) {
      result.summaryError = e.message;
    }
  }

  // 2. 拥有的游戏 & 总时长
  if (features.ownedGames) {
    try {
      const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`;
      const resp = await httpGet(url);
      if (resp.statusCode === 200 && resp.body?.response) {
        const r = resp.body.response;
        const games = (r.games || []).map(g => ({
          appid: g.appid,
          name: g.name,
          playtimeForever: g.playtime_forever,        // 分钟
          playtime2weeks: g.playtime_2weeks || 0       // 分钟
        })).sort((a, b) => b.playtimeForever - a.playtimeForever);
        result.ownedGames = {
          totalCount: r.game_count,
          totalMinutes: games.reduce((s, g) => s + g.playtimeForever, 0),
          games
        };
      } else {
        result.ownedGamesError = `HTTP ${resp.statusCode}`;
      }
    } catch (e) {
      result.ownedGamesError = e.message;
    }
  }

  // 3. 最近玩的游戏
  if (features.recentGames) {
    try {
      const url = `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${apiKey}&steamid=${steamId}`;
      const resp = await httpGet(url);
      if (resp.statusCode === 200 && resp.body?.response) {
        const r = resp.body.response;
        const games = (r.games || []).map(g => ({
          appid: g.appid,
          name: g.name,
          playtime2weeks: g.playtime_2weeks,
          playtimeForever: g.playtime_forever,
          imgIconUrl: g.img_icon_url,
          imgLogoUrl: g.img_logo_url
        }));
        result.recentGames = {
          totalCount: r.total_count,
          games
        };
      } else {
        result.recentGamesError = `HTTP ${resp.statusCode}`;
      }
    } catch (e) {
      result.recentGamesError = e.message;
    }
  }

  return result;
}

// 启动定时器
function startTimer(cfg) {
  stopTimer();
  const ms = Math.max(1, cfg.intervalMin) * 60 * 1000;
  // 立即拉取一次
  tick(cfg);
  timer = setInterval(() => tick(cfg), ms);
}

function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(cfg) {
  try {
    const data = await fetchSteamData(cfg);
    if (data.ownedGames) {
      // 与上次快照对比，生成增量；然后保存新快照 + 追加历史
      data.delta = computeDelta(data, loadSnapshot());
      updateSnapshot(data);
      appendHistory(data);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('steam-data', data);
    }
  } catch (e) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('steam-error', e.message);
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: 'SteamFT - Steam 监控工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopTimer();
  if (process.platform !== 'darwin') app.quit();
});

// IPC 处理
ipcMain.handle('cfg:load', () => loadConfig());
ipcMain.handle('cfg:save', (e, cfg) => {
  const ok = saveConfig(cfg);
  return ok;
});
ipcMain.handle('monitor:start', async (e, cfg) => {
  // 保存配置后启动
  saveConfig(cfg);
  startTimer(cfg);
  return { ok: true };
});
ipcMain.handle('monitor:stop', () => {
  stopTimer();
  return { ok: true };
});
ipcMain.handle('monitor:fetch-once', async (e, cfg) => {
  const data = await fetchSteamData(cfg);
  if (data.ownedGames) {
    // "立即获取一次" 也参与增量对比、快照更新与历史记录
    data.delta = computeDelta(data, loadSnapshot());
    updateSnapshot(data);
    appendHistory(data);
  }
  return data;
});

// 历史记录相关
ipcMain.handle('history:list', () => {
  const hist = loadHistory();
  // 只回传简表，避免一次传输过大数据
  return hist.records.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    totalMinutes: r.totalMinutes,
    gameCount: r.gameCount
  }));
});
ipcMain.handle('history:compare', (e, idFrom, idTo) => compareHistory(idFrom, idTo));
ipcMain.handle('history:clear', () => {
  saveHistory({ records: [] });
  return { ok: true };
});
