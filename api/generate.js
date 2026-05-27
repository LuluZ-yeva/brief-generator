import Anthropic from '@anthropic-ai/sdk';

export const config = { maxDuration: 60 };

const client = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

// ── Tool schemas ──────────────────────────────────────────────
const ANALYZE_TOOL = {
  name: 'extract_brief',
  description: '从商业计划书中提取结构化信息，用于生成投资初次考察报告',
  input_schema: {
    type: 'object',
    properties: {
      companyName:  { type: 'string', description: '公司全称' },
      shortName:    { type: 'string', description: '公司简称或品牌名' },
      address:      { type: 'string', description: '注册地址或运营地址，找不到填"未披露"' },
      foundedDate:  { type: 'string', description: '成立时间，找不到填"未披露"' },
      regCapital:   { type: 'string', description: '注册资本，找不到填"未披露"' },
      legalRep:     { type: 'string', description: '法定代表人或CEO姓名，找不到填"未披露"' },
      website:      { type: 'string', description: '官方网站，找不到填"未披露"' },
      contact:      { type: 'string', description: '联系方式（电话或邮箱），找不到填"未披露"' },
      summary:      { type: 'string', description: '项目简介，2-3句话说明核心业务和价值主张' },
      mainBiz:      { type: 'string', description: '主营业务详述，不少于200字，涵盖业务模式、服务对象、核心价值' },
      products: {
        type: 'array',
        description: '主要产品或服务列表',
        items: {
          type: 'object',
          properties: {
            name:     { type: 'string', description: '产品或服务名称' },
            desc:     { type: 'string', description: '产品描述，100-150字' },
            imgPage:  { type: 'integer', description: '该产品配图最可能所在的页面索引（0-based），无则填-1' },
            hasImg:   { type: 'boolean', description: '计划书中是否有该产品的配图' }
          },
          required: ['name', 'desc', 'imgPage', 'hasImg']
        }
      },
      team: {
        type: 'array',
        description: '核心团队成员列表',
        items: {
          type: 'object',
          properties: {
            name:  { type: 'string', description: '姓名' },
            title: { type: 'string', description: '职位或头衔' },
            bg:    { type: 'string', description: '教育与工作背景，1-2句' }
          },
          required: ['name', 'title', 'bg']
        }
      },
      finance:    { type: 'string', description: '财务情况，含历史营收、盈亏状况，未披露则说明' },
      round:      { type: 'string', description: '本轮融资阶段，如天使轮、Pre-A轮，找不到填"未披露"' },
      amount:     { type: 'string', description: '本轮融资金额，找不到填"未披露"' },
      valuation:  { type: 'string', description: '本轮投后估值，找不到填"未披露"' },
      useOfFunds: { type: 'string', description: '融资用途，找不到填"未披露"' },
      prevRounds: { type: 'string', description: '历史融资记录，找不到填"未披露"' },
      industry:   { type: 'string', description: '所属细分行业，精确描述，如"工业协作机器人"' },
      industryDesc: { type: 'string', description: '行业概况，不少于200字，含行业规模、增速、政策背景、发展趋势' },
      imgPages: {
        type: 'array',
        description: '包含产品或技术展示图片的页面索引（0-based），最多6个',
        items: { type: 'integer' }
      },
      risks: {
        type: 'array',
        description: '主要风险点，3-5条',
        items: { type: 'string' }
      },
      evaluation: { type: 'string', description: '综合评价，不少于150字，含亮点和关注点' }
    },
    required: [
      'companyName','shortName','address','foundedDate','regCapital','legalRep',
      'website','contact','summary','mainBiz','products','team','finance',
      'round','amount','valuation','useOfFunds','prevRounds','industry',
      'industryDesc','imgPages','risks','evaluation'
    ]
  }
};

const COMPETITOR_TOOL = {
  name: 'list_competitors',
  description: '列出指定行业的主要竞品信息',
  input_schema: {
    type: 'object',
    properties: {
      competitors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            company:  { type: 'string', description: '竞品公司名称' },
            product:  { type: 'string', description: '核心产品或服务' },
            desc:     { type: 'string', description: '竞品简介，50-80字' },
            strength: { type: 'string', description: '核心优势' },
            diff:     { type: 'string', description: '与目标公司的主要差异' }
          },
          required: ['company', 'product', 'desc', 'strength', 'diff']
        }
      }
    },
    required: ['competitors']
  }
};

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: '未配置 API Key。请在 Vercel Settings → Environment Variables 中添加 ANTHROPIC_API_KEY 并 Redeploy。'
    });
  }

  try {
    const { action, text, images, companyName, shortName, industry, mainBiz } = req.body;
    const ai = client();

    // ── analyze ──
    if (action === 'analyze') {
      const truncated = (text || '').substring(0, 80000);
      const content = [
        {
          type: 'text',
          text: `你是专业的一级市场股权投资分析师。请仔细阅读以下商业计划书，调用 extract_brief 工具提取所有关键信息。所有信息必须来自计划书中真实存在的内容，找不到的字段填"未披露"。\n\n【计划书文字内容】\n${truncated}${(text || '').length > 80000 ? '\n（内容较长，已截取）' : ''}\n\n${images?.length ? `【计划书各页截图（共${images.length}页）】` : ''}`
        }
      ];

      if (images?.length) {
        for (const img of images.slice(0, 10)) {
          content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
        }
      }

      const msg = await ai.messages.create({
        model: MODEL,
        max_tokens: 8000,
        tools: [ANALYZE_TOOL],
        tool_choice: { type: 'tool', name: 'extract_brief' },
        messages: [{ role: 'user', content }]
      });

      const toolUse = msg.content.find(c => c.type === 'tool_use');
      if (!toolUse) throw new Error('AI 未返回结构化数据，请重试');
      return res.json({ data: toolUse.input });
    }

    // ── competitors ──
    if (action === 'competitors') {
      const name = shortName || companyName || '本项目';
      const msg = await ai.messages.create({
        model: MODEL,
        max_tokens: 3000,
        tools: [COMPETITOR_TOOL],
        tool_choice: { type: 'tool', name: 'list_competitors' },
        messages: [{
          role: 'user',
          content: `公司：${companyName}（${shortName}）\n行业：${industry}\n主营：${(mainBiz || '').substring(0, 300)}\n\n请调用 list_competitors 工具，列出3-5个该行业的主要竞争对手（国内外均可），与${name}进行对比分析。`
        }]
      });

      const toolUse = msg.content.find(c => c.type === 'tool_use');
      return res.json({ data: toolUse?.input?.competitors || [] });
    }

    return res.status(400).json({ error: '无效的 action' });

  } catch (err) {
    console.error('[generate]', err);
    return res.status(500).json({ error: err.message || '服务器内部错误' });
  }
}
