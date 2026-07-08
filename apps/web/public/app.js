const root = document.getElementById('app');

const state = {
  selectedOption: 'B',
  submitted: false,
  messages: [
    {
      type: 'system',
      label: '系统',
      time: '第 3 天 上午',
      title: '粮价三日连涨',
      body: '自改桑令下已三日，杭州粮价连涨。各县执行不一，民间怨声渐起。总督府案前新到三封文书，皆指向同一件事：浙江局势正在失去缓冲。'
    },
    {
      type: 'secret',
      label: '密信',
      actor: '清流县令',
      time: '第 3 天 午前',
      title: '卢象升密信送达',
      body: '县令卢象升托人密送一封短札：“粮价再涨，百姓将难以为继。另，巡抚与商会往来密切，似有旧约，但尚未能取得实据。”'
    },
    {
      type: 'private',
      label: '私讯',
      actor: '江南商会',
      time: '第 3 天 午后',
      title: '商会拒绝无条件出粮',
      body: '江南商会掌柜私下传话：“若官府能保商路不受盘查，愿先行代运粮草。然需税赋减免及票据自便。”'
    },
    {
      type: 'player',
      label: '玩家行动',
      actor: '浙江巡抚 刘瑾',
      time: '第 3 天 午后',
      title: '巡抚已经越级上奏',
      body: '巡抚已将改桑初成的奏疏送往京师，奏中称：“浙江改桑已有成效，只待朝廷嘉奖，便可十日内见第一批银。”此举若先到内阁，巡抚声望上升，你的统筹权威将受削弱。'
    },
    {
      type: 'warning',
      label: '系统提示',
      time: '第 3 天 午后',
      title: '你必须决定是否回应',
      body: '巡抚越级上奏已成事实。若不及时应对，内阁可能只听到巡抚一面之词；若处理过急，又可能被定为压制国策。'
    }
  ]
};

const options = [
  {
    key: 'A',
    title: '截留奏疏',
    desc: '派人追回奏疏，责令巡抚不得越级。',
    gain: '阻止巡抚抢功',
    risk: '巡抚反咬你压制国策'
  },
  {
    key: 'B',
    title: '追加密奏',
    desc: '不阻止奏疏，另写密奏给皇帝。',
    gain: '保留解释权',
    risk: '内阁会怀疑你越级自保'
  },
  {
    key: 'C',
    title: '放任巡抚',
    desc: '让他继续抢功，暗中观察其后续动作。',
    gain: '未来可一并清算',
    risk: '巡抚短期声望上升'
  },
  {
    key: 'D',
    title: '自定义决策',
    desc: '自行拟定策略与应对方式。',
    gain: '可能形成奇谋',
    risk: '若越权会被驳回'
  }
];

const worldStats = [
  { name: '国库银两', value: 42, color: 'green' },
  { name: '民心', value: 55, color: 'gold' },
  { name: '粮价', value: 72, color: 'red' },
  { name: '改桑进度', value: 58, color: 'green' },
  { name: '皇帝信任', value: 43, color: 'gold' }
];

const relationships = [
  { name: '浙江巡抚', detail: '刘 瑾', stance: '敌意', score: 25, avatar: '巡' },
  { name: '清流县令', detail: '卢象升', stance: '信任', score: 68, avatar: '令' },
  { name: '江南商会', detail: '掌柜', stance: '观望', score: 40, avatar: '商' },
  { name: '兵部尚书', detail: '梁廷栋', stance: '友好', score: 58, avatar: '兵' },
  { name: '司礼监掌印', detail: '魏忠贤', stance: '警惕', score: 20, avatar: '监' }
];

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render() {
  root.innerHTML = `
    <div class="game-shell">
      ${renderTopbar()}
      <aside class="left-rail">
        ${renderPlayerCard()}
        ${renderGoals()}
        ${renderResources()}
        ${renderLeverage()}
      </aside>
      <main class="center-stage">
        ${renderMessageStream()}
        ${renderDecisionPanel()}
      </main>
      <aside class="right-rail">
        ${renderWorldState()}
        ${renderRelationships()}
        ${renderLatestChanges()}
        ${renderRisks()}
      </aside>
    </div>
  `;
  bindEvents();
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div class="top-chip location">杭州总督府 · 内厅</div>
      <div class="top-chip day">第 3 天　午后</div>
      <div class="top-title">距离御前裁决：<strong>4 天</strong></div>
      <div class="top-actions">
        <button class="top-btn">历史回顾</button>
        <button class="top-btn">设置</button>
      </div>
    </header>
  `;
}

function renderPlayerCard() {
  return `
    <section class="side-card player-card">
      <h2>我的信息</h2>
      <div class="profile-row">
        <div class="portrait portrait-governor"></div>
        <div>
          <div class="role-name">浙江总督</div>
          <div class="role-person">郑帅彬</div>
          <div class="role-tags"><span>从四品</span><span>兵部侍郎衔</span></div>
        </div>
      </div>
    </section>
  `;
}

function renderGoals() {
  return `
    <section class="side-card">
      <h2>当前目标</h2>
      <ul class="compact-list">
        <li>稳定浙江局势</li>
        <li>控制巡抚势力</li>
        <li>避免皇帝生疑</li>
      </ul>
    </section>
  `;
}

function renderResources() {
  const items = [
    ['银两', '42 万两'],
    ['粮草', '23 万石'],
    ['兵丁', '4/5'],
    ['幕僚', '4 人'],
    ['密报', '2 条']
  ];
  return `
    <section class="side-card">
      <h2>我的资源</h2>
      <div class="resource-list">
        ${items.map(([k, v]) => `<div class="resource-row"><span>${k}</span><strong>${v}</strong></div>`).join('')}
      </div>
    </section>
  `;
}

function renderLeverage() {
  return `
    <section class="side-card leverage-card">
      <h2>我的筹码</h2>
      <ul class="chip-list">
        <li>田契暗账（半页）</li>
        <li>清流县令密信</li>
        <li>巡抚与商会旧约传闻</li>
      </ul>
      <div class="seal-watermark">浙</div>
    </section>
  `;
}

function renderMessageStream() {
  return `
    <section class="scroll-panel message-panel">
      <div class="panel-head">
        <h1>局势消息流</h1>
        <select aria-label="筛选消息"><option>全部</option><option>密信</option><option>玩家行动</option></select>
      </div>
      <div class="message-list" id="messageList">
        ${state.messages.map(renderMessage).join('')}
      </div>
    </section>
  `;
}

function renderMessage(message) {
  return `
    <article class="message-card ${esc(message.type)}">
      <div class="msg-avatar ${esc(message.type)}">${esc((message.actor || message.label || '系').slice(0, 1))}</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="msg-badge">${esc(message.label)}</span>
          ${message.actor ? `<span class="msg-actor">${esc(message.actor)}</span>` : ''}
          <span class="msg-time">${esc(message.time)}</span>
        </div>
        <h3>${esc(message.title)}</h3>
        <p>${esc(message.body)}</p>
      </div>
    </article>
  `;
}

function renderDecisionPanel() {
  return `
    <section class="decision-panel">
      <div class="decision-title">
        <h2>你要如何应对？</h2>
        <span>当前事件：巡抚越级上奏</span>
      </div>
      <div class="option-list">
        ${options.map((item) => `
          <button class="decision-option ${state.selectedOption === item.key ? 'active' : ''}" data-option="${item.key}">
            <div class="option-main"><strong>${item.key}. ${esc(item.title)}</strong><span>${esc(item.desc)}</span></div>
            <div class="option-effects"><span class="gain">可能收益：${esc(item.gain)}</span><span class="risk">可能风险：${esc(item.risk)}</span></div>
          </button>
        `).join('')}
      </div>
      <textarea id="customDecision" placeholder="请输入你的决策内容（可详细说明你的计划）"></textarea>
      <div class="decision-actions">
        <span class="hint">提交后，剧情会进入下一条消息，并更新右侧局势。</span>
        <button id="submitDecision" class="submit-btn">提交决策</button>
      </div>
    </section>
  `;
}

function renderWorldState() {
  return `
    <section class="side-card">
      <h2>当前局势</h2>
      <div class="stats-list">
        ${worldStats.map((item) => `
          <div class="stat-row">
            <div class="stat-label"><span>${esc(item.name)}</span><strong>${item.value}/100</strong></div>
            <div class="bar"><i class="${item.color}" style="width:${item.value}%"></i></div>
          </div>
        `).join('')}
      </div>
      <div class="overall-risk">局势总体风险：<strong>高</strong></div>
    </section>
  `;
}

function renderRelationships() {
  return `
    <section class="side-card relation-card">
      <h2>人物关系</h2>
      ${relationships.map((person) => `
        <div class="relation-row">
          <div class="mini-portrait">${esc(person.avatar)}</div>
          <div class="relation-info"><strong>${esc(person.name)}</strong><span>${esc(person.detail)}</span></div>
          <div class="stance ${person.stance}">${esc(person.stance)} ${person.score}</div>
        </div>
      `).join('')}
    </section>
  `;
}

function renderLatestChanges() {
  return `
    <section class="side-card">
      <h2>最新变化</h2>
      <ul class="change-list">
        <li>粮价较昨日 <b class="up">↑ 5</b></li>
        <li>民心较昨日 <b class="down">↓ 3</b></li>
        <li>巡抚声望 <b class="up">↑ 10</b></li>
        <li>司礼监警惕 <b class="up">↑ 2</b></li>
      </ul>
    </section>
  `;
}

function renderRisks() {
  return `
    <section class="side-card">
      <h2>潜在风险</h2>
      <ul class="risk-list">
        <li>粮价失控 <b>中</b></li>
        <li>巡抚越级 <b>高</b></li>
        <li>商会结党 <b>中</b></li>
        <li>县令失控 <b>中</b></li>
      </ul>
    </section>
  `;
}

function bindEvents() {
  document.querySelectorAll('[data-option]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedOption = button.dataset.option;
      render();
    });
  });
  const submit = document.getElementById('submitDecision');
  if (submit) submit.addEventListener('click', submitDecision);
  const list = document.getElementById('messageList');
  if (list) list.scrollTop = list.scrollHeight;
}

function submitDecision() {
  const option = options.find((item) => item.key === state.selectedOption) || options[1];
  const custom = document.getElementById('customDecision')?.value.trim();
  const decisionText = state.selectedOption === 'D' && custom ? custom : option.title;
  if (state.submitted) return;
  state.submitted = true;
  state.messages.push({
    type: 'result',
    label: '你的决策',
    time: '第 3 天 傍晚',
    title: decisionText,
    body: state.selectedOption === 'B'
      ? '你没有截留巡抚奏疏，而是连夜起草密奏。密奏封入火漆，交由亲信快马送往京师。皇帝或许会因此看到浙江真实局势，但内阁也会嗅到你越级自保的味道。'
      : `你选择“${decisionText}”。总督府开始按此计策行事，局势随之改写。巡抚、商会与司礼监都会在下一条消息中给出反应。`
  });
  state.messages.push({
    type: 'system',
    label: '后台推演',
    time: '第 3 天 夜',
    title: '新的暗线已经形成',
    body: '司礼监注意到浙江奏报口径不一。若此暗线延续至第 5 天，织造局可能派人查问总督府密奏。'
  });
  render();
}

render();
